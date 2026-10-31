export interface SessionRow {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  title: string | null;
  project_path: string | null;
  jsonl_path: string | null;
  model: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

export type MessageKind =
  | 'user'
  | 'assistant'
  | 'stream_delta'
  | 'stream_end'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'complete'
  | 'session_upserted'
  | 'chat_subscribed'
  | 'protocol_error'
  | 'sessions_changed';

export interface NormalizedMessage {
  id: string;
  sessionId: string;
  provider: string;
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
  success?: boolean;
  aborted?: boolean;
  error?: string;
  isProcessing?: boolean;
  lastSeq?: number;
}
