import { useState } from 'react';

interface Props {
  onClose: () => void;
  onCreate: (projectPath: string, title?: string) => Promise<void>;
}

export default function NewSessionDialog({ onClose, onCreate }: Props) {
  const [projectPath, setProjectPath] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!projectPath.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(projectPath.trim(), title.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 w-[28rem] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold mb-4">New Agent Session</h2>
        <label className="block text-xs text-zinc-400 mb-1">Project path (working directory)</label>
        <input
          autoFocus
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
          placeholder="/Users/you/code/my-project"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm mb-3 placeholder-zinc-600"
        />
        <label className="block text-xs text-zinc-400 mb-1">Title (optional)</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Fix login bug"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm mb-4 placeholder-zinc-600"
        />
        {error && <div className="text-red-400 text-xs mb-3">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!projectPath.trim() || busy}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded px-4 py-1.5 text-sm"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
