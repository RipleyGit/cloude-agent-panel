import type { NormalizedMessage, SessionRow } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listSessions: () =>
    request<{ sessions: SessionRow[]; running: string[] }>('/api/sessions'),
  createSession: (projectPath: string, title?: string) =>
    request<{ session: SessionRow }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectPath, title }),
    }),
  getMessages: (sessionId: string, limit = 300) =>
    request<{ messages: NormalizedMessage[] }>(
      `/api/sessions/${sessionId}/messages?limit=${limit}`,
    ),
  renameSession: (sessionId: string, title: string) =>
    request<{ session: SessionRow }>(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  archiveSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}`, { method: 'DELETE' }),
};
