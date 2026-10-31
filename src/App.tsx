import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { panelSocket } from './ws';
import type { SessionRow } from './types';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import NewSessionDialog from './components/NewSessionDialog';

export default function App() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);

  const refreshSessions = useCallback(async () => {
    try {
      const { sessions: rows, running: runningIds } = await api.listSessions();
      setSessions(rows);
      setRunning(new Set(runningIds));
    } catch (err) {
      console.error('failed to load sessions', err);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    return panelSocket.subscribe((message) => {
      if (message.kind === 'sessions_changed') {
        void refreshSessions();
      } else if (message.kind === 'complete' || message.kind === 'error') {
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(message.sessionId);
          return next;
        });
      }
    });
  }, [refreshSessions]);

  const activeSession = sessions.find((s) => s.session_id === activeSessionId) ?? null;

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={sessions}
        running={running}
        activeSessionId={activeSessionId}
        onSelect={setActiveSessionId}
        onNewSession={() => setShowNewSession(true)}
        onArchive={async (id) => {
          await api.archiveSession(id);
          if (activeSessionId === id) setActiveSessionId(null);
          await refreshSessions();
        }}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        {activeSession ? (
          <ChatView
            key={activeSession.session_id}
            session={activeSession}
            onRunningChange={(id, isRunningNow) =>
              setRunning((prev) => {
                const next = new Set(prev);
                if (isRunningNow) next.add(id);
                else next.delete(id);
                return next;
              })
            }
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            <div className="text-center">
              <p className="text-lg mb-2">Cloud Agent Panel</p>
              <p className="text-sm">Select a session on the left, or create a new one.</p>
            </div>
          </div>
        )}
      </main>
      {showNewSession && (
        <NewSessionDialog
          onClose={() => setShowNewSession(false)}
          onCreate={async (projectPath, title) => {
            const { session } = await api.createSession(projectPath, title);
            await refreshSessions();
            setActiveSessionId(session.session_id);
            setShowNewSession(false);
          }}
        />
      )}
    </div>
  );
}
