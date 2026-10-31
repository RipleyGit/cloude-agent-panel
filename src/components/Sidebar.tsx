import type { SessionRow } from '../types';

interface Props {
  sessions: SessionRow[];
  running: Set<string>;
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  onArchive: (id: string) => void;
}

function projectName(projectPath: string | null): string {
  if (!projectPath) return 'Unknown project';
  const parts = projectPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

export default function Sidebar({
  sessions,
  running,
  activeSessionId,
  onSelect,
  onNewSession,
  onArchive,
}: Props) {
  const byProject = new Map<string, SessionRow[]>();
  for (const session of sessions) {
    const key = session.project_path ?? '';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(session);
  }

  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-925 bg-zinc-900/40">
      <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
        <span className="font-semibold text-sm">Agent Sessions</span>
        <button
          onClick={onNewSession}
          className="text-xs bg-blue-600 hover:bg-blue-500 rounded px-2 py-1"
        >
          + New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto chat-scroll">
        {[...byProject.entries()].map(([projectPath, projectSessions]) => (
          <div key={projectPath} className="mt-2">
            <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-zinc-500 truncate" title={projectPath}>
              {projectName(projectPath)}
            </div>
            {projectSessions.map((session) => (
              <div
                key={session.session_id}
                onClick={() => onSelect(session.session_id)}
                className={`group px-3 py-2 cursor-pointer text-sm flex items-center gap-2 ${
                  session.session_id === activeSessionId
                    ? 'bg-zinc-800'
                    : 'hover:bg-zinc-800/50'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    running.has(session.session_id) ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'
                  }`}
                />
                <span className="truncate flex-1" title={session.title ?? undefined}>
                  {session.title ?? 'Untitled session'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Archive this session? (transcript files are kept)')) {
                      onArchive(session.session_id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 text-xs"
                  title="Archive"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="p-4 text-sm text-zinc-500">
            No sessions yet. Local Claude Code sessions will appear here automatically.
          </div>
        )}
      </div>
    </aside>
  );
}
