import { useState } from 'react';

interface Props {
  running: boolean;
  onSend: (content: string, options: { model?: string; permissionMode?: string }) => void;
  onAbort: () => void;
}

export default function MessageInput({ running, onSend, onAbort }: Props) {
  const [text, setText] = useState('');
  const [model, setModel] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');

  const submit = () => {
    const content = text.trim();
    if (!content || running) return;
    onSend(content, {
      ...(model.trim() ? { model: model.trim() } : {}),
      permissionMode,
    });
    setText('');
  };

  return (
    <div className="border-t border-zinc-800 p-3">
      <div className="flex gap-2 mb-2 text-xs">
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Model (optional, e.g. claude-sonnet-4-5)"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-300 placeholder-zinc-600"
        />
        <select
          value={permissionMode}
          onChange={(e) => setPermissionMode(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-300"
          title="Permission mode"
        >
          <option value="default">default</option>
          <option value="acceptEdits">acceptEdits</option>
          <option value="plan">plan</option>
          <option value="bypassPermissions">bypassPermissions</option>
        </select>
      </div>
      <div className="flex gap-2 items-end">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Send a task to the agent… (Enter to send, Shift+Enter for newline)"
          rows={2}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm resize-none placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        {running ? (
          <button
            onClick={onAbort}
            className="bg-red-600 hover:bg-red-500 rounded-lg px-4 py-2 text-sm shrink-0"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!text.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm shrink-0"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
