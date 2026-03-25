/**
 * Socket server for the daemon, accepting connections over Unix domain
 * socket and TCP. Messages use newline-delimited JSON framing.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, unlinkSync, existsSync } from 'node:fs';
import { assertLoopbackOnly } from '../security/tcp-guard.js';
import { toErrorMessage } from '../utils/index.js';
import { encodeMessage, decodeMessages, type IpcRequest, type IpcResponse } from './protocol.js';
import { RateLimiter, ConnectionTracker } from './rate-limiter.js';

export interface DaemonServerOptions {
  readonly socketPath: string;
  readonly tcpHost: string;
  readonly tcpPort: number;
  readonly allowRemote: boolean;
  readonly maxRequestsPerMin?: number;
  readonly maxConnections?: number;
}

export type RequestHandler = (req: IpcRequest) => Promise<IpcResponse>;

export class DaemonServer {
  private unixServer: Server | null = null;
  private tcpServer: Server | null = null;
  private readonly rateLimiter: RateLimiter;
  private readonly connectionTracker: ConnectionTracker;
  private readonly options: DaemonServerOptions;

  constructor(options: DaemonServerOptions) {
    this.options = options;
    this.rateLimiter = new RateLimiter(options.maxRequestsPerMin);
    this.connectionTracker = new ConnectionTracker(options.maxConnections);
  }

  get activeConnections(): number {
    return this.connectionTracker.activeConnections;
  }

  /**
   * Start listening on both Unix socket and TCP.
   */
  async start(handler: RequestHandler): Promise<void> {
    assertLoopbackOnly(this.options.tcpHost, this.options.allowRemote);

    // Clean up stale socket file
    if (existsSync(this.options.socketPath)) {
      unlinkSync(this.options.socketPath);
    }

    await Promise.all([this.startUnixServer(handler), this.startTcpServer(handler)]);
  }

  /**
   * Stop all servers and close all connections.
   */
  async stop(): Promise<void> {
    await Promise.all([this.closeServer(this.unixServer), this.closeServer(this.tcpServer)]);

    // Clean up socket file
    try {
      if (existsSync(this.options.socketPath)) {
        unlinkSync(this.options.socketPath);
      }
    } catch {
      // ignore
    }
  }

  private async startUnixServer(handler: RequestHandler): Promise<void> {
    return new Promise((resolve, reject) => {
      this.unixServer = createServer((socket) => {
        this.handleConnection(socket, handler, 'unix');
      });
      this.unixServer.on('error', reject);
      this.unixServer.listen(this.options.socketPath, () => {
        // Restrict socket to owner-only so other users can't connect.
        chmodSync(this.options.socketPath, 0o600);
        resolve();
      });
    });
  }

  private async startTcpServer(handler: RequestHandler): Promise<void> {
    return new Promise((resolve, reject) => {
      this.tcpServer = createServer((socket) => {
        this.handleConnection(socket, handler, 'tcp');
      });
      this.tcpServer.on('error', reject);
      this.tcpServer.listen(this.options.tcpPort, this.options.tcpHost, () => {
        resolve();
      });
    });
  }

  /** Max buffer size per connection: 1 MB. Prevents memory exhaustion from malicious clients. */
  private static readonly MAX_BUFFER_SIZE = 1024 * 1024;

  /** Monotonic counter for unique per-connection rate-limit keys. */
  private connectionCounter = 0;

  private handleConnection(socket: Socket, handler: RequestHandler, source: string): void {
    if (!this.connectionTracker.acquire()) {
      socket.write(encodeMessage({ id: 'system', ok: false, error: 'Too many connections' }));
      socket.end();
      return;
    }

    // Each connection gets a unique rate-limit key, even on Unix sockets
    // where remoteAddress is undefined. This prevents a single attacker
    // from exhausting the shared rate limit for all local connections.
    const connectionId = this.connectionCounter++;
    const sourceKey =
      source === 'unix'
        ? `unix:${String(connectionId)}`
        : `${source}:${socket.remoteAddress ?? 'unknown'}`;
    let buffer = '';

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // Guard against buffer accumulation DoS (no newlines → unbounded growth)
      if (buffer.length > DaemonServer.MAX_BUFFER_SIZE) {
        socket.write(encodeMessage({ id: 'system', ok: false, error: 'Message too large' }));
        socket.destroy();
        return;
      }

      const { messages, remainder } = decodeMessages(buffer);
      buffer = remainder;

      for (const msg of messages) {
        const req = msg as IpcRequest;

        if (!this.rateLimiter.check(sourceKey)) {
          socket.write(encodeMessage({ id: req.id, ok: false, error: 'Rate limit exceeded' }));
          continue;
        }

        void handler(req)
          .then((response) => {
            if (!socket.destroyed) {
              socket.write(encodeMessage(response));
            }
          })
          .catch((err: unknown) => {
            if (!socket.destroyed) {
              socket.write(
                encodeMessage({
                  id: req.id,
                  ok: false,
                  error: toErrorMessage(err),
                }),
              );
            }
          });
      }
    });

    let released = false;
    const releaseOnce = (): void => {
      if (released) return;
      released = true;
      this.connectionTracker.release();
      this.rateLimiter.clear(sourceKey);
    };

    socket.on('close', releaseOnce);
    socket.on('error', releaseOnce);
  }

  private async closeServer(server: Server | null): Promise<void> {
    if (server === null) return;
    return new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}
