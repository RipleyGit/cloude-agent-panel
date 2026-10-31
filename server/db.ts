import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = path.join(os.homedir(), '.cloude-agent-panel');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'panel.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  project_path TEXT UNIQUE NOT NULL,
  custom_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  title TEXT,
  project_path TEXT,
  jsonl_path TEXT,
  model TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_provider_session_id ON sessions(provider_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path);
`);

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

const now = () => new Date().toISOString();

export function createSession(row: {
  sessionId: string;
  provider: string;
  providerSessionId?: string | null;
  title?: string | null;
  projectPath?: string | null;
  jsonlPath?: string | null;
  model?: string | null;
}): void {
  db.prepare(
    `INSERT INTO sessions (session_id, provider, provider_session_id, title, project_path, jsonl_path, model)
     VALUES (@sessionId, @provider, @providerSessionId, @title, @projectPath, @jsonlPath, @model)
     ON CONFLICT(session_id) DO UPDATE SET
       provider_session_id = COALESCE(excluded.provider_session_id, sessions.provider_session_id),
       title = COALESCE(excluded.title, sessions.title),
       project_path = COALESCE(excluded.project_path, sessions.project_path),
       jsonl_path = COALESCE(excluded.jsonl_path, sessions.jsonl_path),
       updated_at = @now`,
  ).run({
    sessionId: row.sessionId,
    provider: row.provider,
    providerSessionId: row.providerSessionId ?? null,
    title: row.title ?? null,
    projectPath: row.projectPath ?? null,
    jsonlPath: row.jsonlPath ?? null,
    model: row.model ?? null,
    now: now(),
  });
}

export function getSession(sessionId: string): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as
    | SessionRow
    | undefined;
}

export function findSessionByProviderSessionId(
  provider: string,
  providerSessionId: string,
): SessionRow | undefined {
  return db
    .prepare('SELECT * FROM sessions WHERE provider = ? AND provider_session_id = ?')
    .get(provider, providerSessionId) as SessionRow | undefined;
}

export function listSessions(): SessionRow[] {
  return db
    .prepare('SELECT * FROM sessions WHERE is_archived = 0 ORDER BY updated_at DESC')
    .all() as SessionRow[];
}

export function setSessionTitle(sessionId: string, title: string): void {
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE session_id = ?').run(
    title,
    now(),
    sessionId,
  );
}

export function archiveSession(sessionId: string): void {
  db.prepare('UPDATE sessions SET is_archived = 1, updated_at = ? WHERE session_id = ?').run(
    now(),
    sessionId,
  );
}

export function touchSession(sessionId: string): void {
  db.prepare('UPDATE sessions SET updated_at = ? WHERE session_id = ?').run(now(), sessionId);
}

export function recordProviderSessionId(
  sessionId: string,
  providerSessionId: string,
): SessionRow | undefined {
  db.prepare(
    'UPDATE sessions SET provider_session_id = ?, updated_at = ? WHERE session_id = ?',
  ).run(providerSessionId, now(), sessionId);
  return getSession(sessionId);
}

export function ensureProject(projectPath: string): void {
  db.prepare(
    `INSERT INTO projects (project_id, project_path) VALUES (?, ?)
     ON CONFLICT(project_path) DO UPDATE SET updated_at = ?`,
  ).run(`proj_${Buffer.from(projectPath).toString('hex')}`, projectPath, now());
}

export default db;
