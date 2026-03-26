/**
 * IPC protocol types for daemon ↔ CLI communication.
 *
 * Messages are newline-delimited JSON (\n terminated) over Unix domain
 * sockets or TCP. Each message is a single JSON object.
 */

import type { ActionIntent, PipelineResult } from '../core/action-types.js';

// ─── Lifecycle messages (Node IPC between parent ↔ forked daemon) ────────────

/** Message type sent by the daemon to signal it is ready to accept connections. */
export const DAEMON_READY_MSG = 'daemon-ready' as const;

export interface DaemonReadyMessage {
  readonly type: typeof DAEMON_READY_MSG;
  readonly pid: number;
}

export function isDaemonReadyMessage(msg: unknown): msg is DaemonReadyMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as Record<string, unknown>)['type'] === DAEMON_READY_MSG
  );
}

// ─── Request types ────────────────────────────────────────────────────────────

export type IpcRequestType = 'execute' | 'trade' | 'status' | 'stop' | 'config';

export interface IpcRequest {
  readonly id: string;
  readonly type: IpcRequestType;
  readonly payload: unknown;
}

export interface TradePayload {
  readonly intent: ActionIntent;
  readonly tradeValueUsd?: number;
}

// ─── Response types ───────────────────────────────────────────────────────────

export interface IpcResponse {
  readonly id: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export interface DaemonStatus {
  readonly pid: number;
  readonly uptime: number;
  readonly tier: 'standalone' | 'daemon' | 'docker';
  readonly configHash: string;
  readonly rolling24hVolume: Record<string, number>;
  readonly connections: number;
}

export interface TradeResponse {
  readonly result: PipelineResult;
}

// ─── Generic execute types ───────────────────────────────────────────────────

export interface ExecutePayload {
  readonly intent: ActionIntent;
}

/** Response for the generic 'execute' IPC request. */
export interface ExecuteResponse {
  readonly result: PipelineResult;
  readonly resolvedIntent: ActionIntent;
  readonly walletAddress: string;
  readonly tradeValueUsd?: number | undefined;
}

// ─── Framing helpers ──────────────────────────────────────────────────────────

/** Serialize a message to newline-delimited JSON. */
export function encodeMessage(msg: IpcRequest | IpcResponse): string {
  return JSON.stringify(msg) + '\n';
}

/** Parse a newline-delimited JSON buffer into messages. */
export function decodeMessages(buffer: string): { messages: unknown[]; remainder: string } {
  const messages: unknown[] = [];
  let start = 0;

  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === '\n') {
      const line = buffer.slice(start, i).trim();
      if (line.length > 0) {
        messages.push(JSON.parse(line));
      }
      start = i + 1;
    }
  }

  return { messages, remainder: buffer.slice(start) };
}
