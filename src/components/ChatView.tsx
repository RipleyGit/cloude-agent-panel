import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../api';
import { panelSocket } from '../ws';
import type { NormalizedMessage, SessionRow } from '../types';
import MessageInput from './MessageInput';

interface Props {
  session: SessionRow;
  onRunningChange: (sessionId: string, running: boolean) => void;
}

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'error' | 'status';
  content: string;
  toolName?: string;
  toolId?: string;
  toolInput?: unknown;
  isError?: boolean;
}

export default function ChatView({ session, onRunningChange }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const streamRef = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const sessionId = session.session_id;

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    streamRef.current = '';
    setStreamBuffer('');

    void api.getMessages(sessionId).then(({ messages: history }) => {
      if (cancelled) return;
      setMessages(history.map(toDisplay).filter((m): m is DisplayMessage => m !== null));
    });

    panelSocket.send({ type: 'chat.subscribe', sessions: [{ sessionId, lastSeq: 0 }] });

    const unsubscribe = panelSocket.subscribe((message) => {
      if (message.sessionId !== sessionId) return;
      if (cancelled) return;

      switch (message.kind) {
        case 'chat_subscribed':
          setRunning(!!message.isProcessing);
          onRunningChange(sessionId, !!message.isProcessing);
          break;
        case 'stream_delta':
          streamRef.current += message.content ?? '';
          setStreamBuffer(streamRef.current);
          break;
        case 'stream_end':
          flushStream();
          break;
        case 'complete':
          flushStream();
          setRunning(false);
          onRunningChange(sessionId, false);
          if (message.isError && message.content) {
            pushDisplay({
              id: message.id,
              role: 'error',
              content: message.content,
              isError: true,
            });
          }
          break;
        case 'protocol_error':
          setRunning(false);
          onRunningChange(sessionId, false);
          pushDisplay({ id: message.id, role: 'error', content: message.error ?? 'Protocol error', isError: true });
          break;
        default: {
          const display = toDisplay(message);
          if (display) {
            flushStream();
            pushDisplay(display);
          }
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const pushDisplay = useCallback((display: DisplayMessage) => {
    setMessages((prev) => [...prev, display]);
  }, []);

  const flushStream = useCallback(() => {
    const text = streamRef.current;
    streamRef.current = '';
    setStreamBuffer('');
    if (text.trim()) {
      setMessages((msgs) => [
        ...msgs,
        { id: `stream_${Date.now()}`, role: 'assistant', content: text },
      ]);
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamBuffer]);

  const send = (content: string, options: { model?: string; permissionMode?: string }) => {
    setRunning(true);
    onRunningChange(sessionId, true);
    panelSocket.send({ type: 'chat.send', sessionId, content, options });
  };

  const abort = () => {
    panelSocket.send({ type: 'chat.abort', sessionId });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{session.title ?? 'Untitled session'}</div>
          <div className="text-xs text-zinc-500 truncate">{session.project_path}</div>
        </div>
        <span className="ml-auto text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
          {session.provider}
        </span>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll px-4 py-4 space-y-3">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {streamBuffer && (
          <MessageBubble
            message={{ id: 'streaming', role: 'assistant', content: streamBuffer }}
          />
        )}
        {running && !streamBuffer && (
          <div className="text-xs text-zinc-500 animate-pulse">Agent is working…</div>
        )}
      </div>

      <MessageInput running={running} onSend={send} onAbort={abort} />
    </div>
  );
}

function toDisplay(message: NormalizedMessage): DisplayMessage | null {
  switch (message.kind) {
    case 'user':
      return { id: message.id, role: 'user', content: message.content ?? '' };
    case 'assistant':
      return { id: message.id, role: 'assistant', content: message.content ?? '' };
    case 'thinking':
      return { id: message.id, role: 'thinking', content: message.content ?? '' };
    case 'tool_use':
      return {
        id: message.id,
        role: 'tool',
        content: '',
        toolName: message.toolName,
        toolId: message.toolId,
        toolInput: message.toolInput,
      };
    case 'tool_result':
      return {
        id: message.id,
        role: 'tool',
        content: message.toolResult?.content ?? '',
        toolId: message.toolId,
        isError: message.toolResult?.isError,
      };
    case 'error':
      return { id: message.id, role: 'error', content: message.content ?? '', isError: true };
    default:
      return null;
  }
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-blue-600/90 px-3 py-2 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }
  if (message.role === 'thinking') {
    return (
      <details className="text-xs text-zinc-500 border-l-2 border-zinc-700 pl-3">
        <summary className="cursor-pointer">Thinking…</summary>
        <div className="whitespace-pre-wrap mt-1">{message.content}</div>
      </details>
    );
  }
  if (message.role === 'tool') {
    if (message.toolName) {
      return (
        <details className="text-xs border border-zinc-800 rounded-md bg-zinc-900/60">
          <summary className="cursor-pointer px-3 py-1.5 text-zinc-300">
            🔧 {message.toolName}
          </summary>
          <pre className="px-3 py-2 overflow-x-auto text-zinc-400">
            {JSON.stringify(message.toolInput, null, 2)}
          </pre>
        </details>
      );
    }
    return (
      <details
        className={`text-xs border rounded-md ${
          message.isError ? 'border-red-900 bg-red-950/40' : 'border-zinc-800 bg-zinc-900/40'
        }`}
      >
        <summary className="cursor-pointer px-3 py-1.5 text-zinc-400">
          Tool result {message.isError ? '(error)' : ''}
        </summary>
        <pre className="px-3 py-2 overflow-x-auto max-h-64 text-zinc-400 whitespace-pre-wrap">
          {message.content.slice(0, 4000)}
          {message.content.length > 4000 ? '\n…(truncated)' : ''}
        </pre>
      </details>
    );
  }
  if (message.role === 'error') {
    return (
      <div className="text-sm text-red-400 border border-red-900 bg-red-950/40 rounded-md px-3 py-2">
        {message.content}
      </div>
    );
  }
  return (
    <div className="max-w-[90%] text-sm text-zinc-100 markdown-body">
      <ReactMarkdown>{message.content}</ReactMarkdown>
    </div>
  );
}
