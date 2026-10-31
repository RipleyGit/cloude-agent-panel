// Provider abstraction contracts.
//
// Every agent (claude, cursor, codex, agy) implements IProviderRuntime and
// emits only NormalizedMessage objects through the writer. The UI never sees
// provider-native event shapes.

export type ProviderId = 'claude' | 'cursor' | 'codex' | 'agy';

export type MessageKind =
  | 'user'
  | 'assistant'
  | 'stream_delta'
  | 'stream_end'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'session_created'
  | 'complete'
  | 'session_upserted'
  | 'chat_subscribed'
  | 'protocol_error';

export interface NormalizedMessage {
  id: string;
  sessionId: string;
  provider: ProviderId;
  kind: MessageKind;
  timestamp: string;
  seq?: number;
  content?: string;
  model?: string;
  toolName?: string;
  toolId?: string;
  toolInput?: unknown;
  toolResult?: { content: string; isError?: boolean };
  isError?: boolean;
  exitCode?: number | null;
  success?: boolean;
  aborted?: boolean;
  newSessionId?: string;
  error?: string;
  isProcessing?: boolean;
  lastSeq?: number;
}

let messageCounter = 0;

export function createNormalizedMessage(
  sessionId: string,
  provider: ProviderId,
  kind: MessageKind,
  fields: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  messageCounter += 1;
  return {
    id: `msg_${Date.now().toString(36)}_${messageCounter}`,
    sessionId,
    provider,
    kind,
    timestamp: new Date().toISOString(),
    ...fields,
  };
}

export function createCompleteMessage(
  sessionId: string,
  provider: ProviderId,
  fields: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  return createNormalizedMessage(sessionId, provider, 'complete', {
    exitCode: 0,
    success: true,
    aborted: false,
    ...fields,
  });
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface RunOptions {
  model?: string;
  permissionMode?: PermissionMode;
}

export interface ProviderRuntimeWriter {
  send(message: NormalizedMessage): void;
  // Channel for the runtime to report the provider-native session id once the
  // CLI reveals it. Never forwarded to clients (dual-id rule).
  setSessionId(providerSessionId: string): void;
}

export interface ProviderRuntimeContext {
  // app session id -> provider-native id, for resume
  resolveProviderSessionId(sessionId: string): string | null;
}

export interface IProviderRuntime {
  run(
    command: string,
    options: RunOptions & { cwd?: string },
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
    appSessionId: string,
  ): Promise<void>;
  abort(appSessionId: string): boolean;
}
