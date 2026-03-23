/**
 * Thin IPC client for communicating with the daemon from the CLI.
 */

import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  encodeMessage,
  decodeMessages,
  type IpcRequest,
  type IpcResponse,
  type IpcRequestType,
} from './protocol.js';

/** Default timeout for IPC requests: 30 seconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

export class DaemonClient {
  private readonly socketPath?: string;
  private readonly tcpHost?: string;
  private readonly tcpPort?: number;

  /**
   * Create a client that connects to the daemon.
   *
   * @param address - Either a Unix socket path or "tcp://host:port"
   */
  constructor(address: string) {
    if (address.startsWith('tcp://')) {
      const url = new URL(address.replace('tcp://', 'http://'));
      this.tcpHost = url.hostname;
      this.tcpPort = parseInt(url.port, 10);
    } else {
      this.socketPath = address;
    }
  }

  /**
   * Send a request to the daemon and wait for the response.
   */
  async send(type: IpcRequestType, payload: unknown = {}): Promise<IpcResponse> {
    const id = randomUUID();
    const request: IpcRequest = { id, type, payload };

    return new Promise((resolve, reject) => {
      let socket: Socket;
      let buffer = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error(`Daemon request timed out after ${String(DEFAULT_TIMEOUT_MS)}ms`));
        }
      }, DEFAULT_TIMEOUT_MS);

      const cleanup = (): void => {
        clearTimeout(timeout);
        if (!socket.destroyed) socket.destroy();
      };

      if (this.socketPath !== undefined) {
        socket = createConnection({ path: this.socketPath });
      } else if (this.tcpHost !== undefined && this.tcpPort !== undefined) {
        socket = createConnection({ host: this.tcpHost, port: this.tcpPort });
      } else {
        reject(new Error('No daemon address configured'));
        return;
      }

      socket.on('connect', () => {
        socket.write(encodeMessage(request));
      });

      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const { messages } = decodeMessages(buffer);

        for (const msg of messages) {
          const response = msg as IpcResponse;
          if (response.id === id && !settled) {
            settled = true;
            cleanup();
            resolve(response);
            return;
          }
        }
      });

      socket.on('error', (err: Error) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(
            new Error(
              `Cannot connect to OnlyFence daemon.\n` +
                `  Address:  ${this.socketPath ?? `tcp://${this.tcpHost ?? ''}:${String(this.tcpPort ?? '')}`}\n` +
                `  Reason:   ${err.message}\n` +
                `\n` +
                `  To fix:\n` +
                `    fence start           Start in foreground\n` +
                `    fence start --detach  Start as background service\n` +
                `\n` +
                `  If using Docker:\n` +
                `    export FENCE_DAEMON_ADDR="tcp://127.0.0.1:19876"`,
            ),
          );
        }
      });

      socket.on('close', () => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('Connection closed before response received'));
        }
      });
    });
  }
}
