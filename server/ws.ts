// /ws protocol.
// Inbound:  chat.send | chat.abort | chat.subscribe
// Outbound: NormalizedMessage frames (with seq), chat_subscribed,
//           sessions_changed, protocol_error.
//
// Provider and project path always come from the DB, never from the client.

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import {
  attachSocket,
  createRunWriter,
  decorateAndRecord,
  detachSocket,
  getRun,
  isRunning,
  replaySince,
  startRun,
} from './runRegistry.js';
import { getRuntime, isProviderId } from './providers/registry.js';
import { createNormalizedMessage, type PermissionMode, type ProviderId } from './providers/types.js';
import { getSession, type SessionRow } from './db.js';

interface ChatSendPayload {
  type: 'chat.send';
  sessionId: string;
  content: string;
  options?: { model?: string; permissionMode?: PermissionMode };
}

interface ChatAbortPayload {
  type: 'chat.abort';
  sessionId: string;
}

interface ChatSubscribePayload {
  type: 'chat.subscribe';
  sessions: Array<{ sessionId: string; lastSeq?: number }>;
}

type InboundPayload = ChatSendPayload | ChatAbortPayload | ChatSubscribePayload;

const clients = new Set<WebSocket>();

function sendJson(socket: WebSocket, data: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
}

function sendProtocolError(socket: WebSocket, sessionId: string | null, error: string): void {
  sendJson(socket, {
    id: `err_${Date.now()}`,
    sessionId,
    provider: 'claude',
    kind: 'protocol_error',
    timestamp: new Date().toISOString(),
    error,
  });
}

export function broadcastSessionsChanged(): void {
  const payload = JSON.stringify({ kind: 'sessions_changed', timestamp: new Date().toISOString() });
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

async function handleChatSend(socket: WebSocket, payload: ChatSendPayload): Promise<void> {
  const { sessionId, content, options } = payload;
  if (!sessionId || typeof content !== 'string' || !content.trim()) {
    sendProtocolError(socket, sessionId ?? null, 'chat.send requires sessionId and content');
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    sendProtocolError(socket, sessionId, 'Unknown sessionId');
    return;
  }
  if (!isProviderId(session.provider)) {
    sendProtocolError(socket, sessionId, `Unknown provider: ${session.provider}`);
    return;
  }
  const runtime = getRuntime(session.provider);
  if (!runtime) {
    sendProtocolError(socket, sessionId, `Provider not available yet: ${session.provider}`);
    return;
  }
  if (isRunning(sessionId)) {
    sendProtocolError(socket, sessionId, 'Session already has a running task');
    return;
  }

  const run = startRun(sessionId, session.provider as ProviderId);
  if (!run) {
    sendProtocolError(socket, sessionId, 'Failed to start run');
    return;
  }
  attachSocket(sessionId, socket);

  decorateAndRecord(
    run,
    createNormalizedMessage(sessionId, session.provider as ProviderId, 'user', { content }),
  );

  const writer = createRunWriter(run);
  const context = {
    resolveProviderSessionId(id: string) {
      return getSession(id)?.provider_session_id ?? null;
    },
  };

  const finished = runtime.run(
    content,
    { model: options?.model, permissionMode: options?.permissionMode, cwd: session.project_path ?? undefined },
    writer,
    context,
    sessionId,
  );

  run.abort = () => runtime.abort(sessionId);

  try {
    await finished;
  } finally {
    // Belt-and-braces: if the runtime returned without completing, close the run.
    if (run.status === 'running') {
      decorateAndRecord(
        run,
        createNormalizedMessage(sessionId, session.provider as ProviderId, 'complete', {
          success: false,
          exitCode: 1,
          isError: true,
          content: 'Run ended without a terminal event',
        }),
      );
    }
  }
}

function handleChatAbort(socket: WebSocket, payload: ChatAbortPayload): void {
  const run = getRun(payload.sessionId);
  if (!run || run.status !== 'running' || !run.abort) {
    sendProtocolError(socket, payload.sessionId, 'No running task for session');
    return;
  }
  run.abort();
}

function handleChatSubscribe(socket: WebSocket, payload: ChatSubscribePayload): void {
  for (const { sessionId, lastSeq = 0 } of payload.sessions ?? []) {
    attachSocket(sessionId, socket);
    const run = getRun(sessionId);
    if (run) {
      replaySince(run, lastSeq, socket);
      sendJson(socket, {
        id: `sub_${Date.now()}`,
        sessionId,
        provider: run.provider,
        kind: 'chat_subscribed',
        timestamp: new Date().toISOString(),
        isProcessing: run.status === 'running',
        lastSeq: run.lastSeq,
      });
    } else {
      sendJson(socket, {
        id: `sub_${Date.now()}`,
        sessionId,
        provider: 'claude',
        kind: 'chat_subscribed',
        timestamp: new Date().toISOString(),
        isProcessing: false,
        lastSeq: 0,
      });
    }
  }
}

export function createChatWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket) => {
    clients.add(socket);

    socket.on('message', (raw) => {
      let payload: InboundPayload;
      try {
        payload = JSON.parse(raw.toString()) as InboundPayload;
      } catch {
        sendProtocolError(socket, null, 'Invalid JSON');
        return;
      }

      switch (payload.type) {
        case 'chat.send':
          void handleChatSend(socket, payload);
          break;
        case 'chat.abort':
          handleChatAbort(socket, payload);
          break;
        case 'chat.subscribe':
          handleChatSubscribe(socket, payload);
          break;
        default:
          sendProtocolError(socket, null, `Unknown message type: ${(payload as { type?: string }).type}`);
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
      detachSocket(socket);
    });
  });

  return wss;
}

export type { SessionRow };
