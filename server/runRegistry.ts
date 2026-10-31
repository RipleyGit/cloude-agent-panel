// In-memory run state machine. One active run per app session.
// - assigns monotonically increasing seq to every event
// - caches events (for reconnect replay)
// - enforces the exactly-once `complete` contract
// - records the provider-native session id when the runtime reports it
//
// Run state lives in memory; history is always re-read from transcripts.

import type WebSocket from 'ws';
import type { NormalizedMessage, ProviderId } from './providers/types.js';
import { recordProviderSessionId, touchSession, getSession } from './db.js';

const EVENT_CACHE_LIMIT = 5000;
const COMPLETED_RUN_TTL_MS = 5 * 60 * 1000;

export interface ChatRun {
  appSessionId: string;
  provider: ProviderId;
  status: 'running' | 'completed';
  lastSeq: number;
  events: NormalizedMessage[];
  sockets: Set<WebSocket>;
  startedAt: number;
  completedAt: number | null;
  abort: (() => boolean) | null;
  evictTimer: NodeJS.Timeout | null;
}

const runs = new Map<string, ChatRun>();

function deliver(run: ChatRun, message: NormalizedMessage): void {
  const payload = JSON.stringify(message);
  for (const socket of run.sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

export function decorateAndRecord(run: ChatRun, message: NormalizedMessage): void {
  if (run.status === 'completed' && message.kind !== 'complete') return;
  if (message.kind === 'complete' && run.status === 'completed') return; // exactly-once

  run.lastSeq += 1;
  message.seq = run.lastSeq;
  run.events.push(message);
  if (run.events.length > EVENT_CACHE_LIMIT) {
    run.events.splice(0, run.events.length - EVENT_CACHE_LIMIT);
  }

  if (message.kind === 'complete') {
    run.status = 'completed';
    run.completedAt = Date.now();
    run.abort = null;
    touchSession(run.appSessionId);
    run.evictTimer = setTimeout(() => {
      if (runs.get(run.appSessionId) === run) runs.delete(run.appSessionId);
    }, COMPLETED_RUN_TTL_MS);
  }

  deliver(run, message);
}

export function createRunWriter(run: ChatRun) {
  return {
    send(message: NormalizedMessage) {
      // The provider-native id is internal only (dual-id rule).
      if (message.kind === 'session_created') return;
      decorateAndRecord(run, message);
    },
    setSessionId(providerSessionId: string) {
      recordProviderSessionId(run.appSessionId, providerSessionId);
    },
  };
}

export function startRun(appSessionId: string, provider: ProviderId): ChatRun | null {
  const existing = runs.get(appSessionId);
  if (existing && existing.status === 'running') return null;
  if (existing?.evictTimer) clearTimeout(existing.evictTimer);

  const run: ChatRun = {
    appSessionId,
    provider,
    status: 'running',
    lastSeq: 0,
    events: [],
    sockets: existing?.sockets ?? new Set(),
    startedAt: Date.now(),
    completedAt: null,
    abort: null,
    evictTimer: null,
  };
  runs.set(appSessionId, run);
  return run;
}

export function getRun(appSessionId: string): ChatRun | undefined {
  return runs.get(appSessionId);
}

export function isRunning(appSessionId: string): boolean {
  return runs.get(appSessionId)?.status === 'running';
}

export function attachSocket(appSessionId: string, socket: WebSocket): void {
  const run = runs.get(appSessionId);
  if (run) run.sockets.add(socket);
}

export function detachSocket(socket: WebSocket): void {
  for (const run of runs.values()) run.sockets.delete(socket);
}

export function replaySince(run: ChatRun, lastSeq: number, socket: WebSocket): void {
  for (const event of run.events) {
    if ((event.seq ?? 0) > lastSeq && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }
}

export function abortRun(appSessionId: string): boolean {
  const run = runs.get(appSessionId);
  if (!run || run.status !== 'running' || !run.abort) return false;
  return run.abort() !== false;
}

export function runningSessionIds(): string[] {
  return [...runs.values()].filter((r) => r.status === 'running').map((r) => r.appSessionId);
}

export { getSession };
