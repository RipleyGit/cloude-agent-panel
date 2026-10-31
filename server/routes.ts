import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  archiveSession,
  createSession,
  ensureProject,
  getSession,
  listSessions,
  recordProviderSessionId,
  setSessionTitle,
} from './db.js';
import { isProviderId } from './providers/registry.js';
import { fetchHistory } from './providers/claude/sessions.js';
import { transcriptPathFor } from './providers/claude/sync.js';
import { runningSessionIds } from './runRegistry.js';

export const apiRoutes = Router();

apiRoutes.get('/sessions', (_req, res) => {
  res.json({ sessions: listSessions(), running: runningSessionIds() });
});

apiRoutes.post('/sessions', (req, res) => {
  const { projectPath, provider = 'claude', title } = req.body ?? {};
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }
  if (!isProviderId(provider)) {
    res.status(400).json({ error: `Unknown provider: ${provider}` });
    return;
  }
  const normalizedPath = projectPath.trim();
  if (!fs.existsSync(normalizedPath)) {
    res.status(400).json({ error: `Path does not exist: ${normalizedPath}` });
    return;
  }

  const sessionId = crypto.randomUUID();
  ensureProject(normalizedPath);
  createSession({
    sessionId,
    provider,
    title: typeof title === 'string' && title.trim() ? title.trim() : 'New session',
    projectPath: normalizedPath,
  });
  res.status(201).json({ session: getSession(sessionId) });
});

apiRoutes.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ session });
});

apiRoutes.get('/sessions/:id/messages', async (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    let jsonlPath = session.jsonl_path;
    // Sessions created in the panel get their transcript path once Claude Code
    // has written one; resolve lazily if the watcher hasn't indexed it yet.
    if ((!jsonlPath || !fs.existsSync(jsonlPath)) && session.provider_session_id && session.project_path) {
      const candidate = transcriptPathFor(session.project_path, session.provider_session_id);
      if (fs.existsSync(candidate)) jsonlPath = candidate;
    }

    if (!jsonlPath || !fs.existsSync(jsonlPath)) {
      res.json({ messages: [] });
      return;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 0), 1000);
    const messages = await fetchHistory(jsonlPath, session.session_id, limit);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

apiRoutes.patch('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const { title, providerSessionId } = req.body ?? {};
  if (typeof title === 'string' && title.trim()) {
    setSessionTitle(session.session_id, title.trim());
  }
  if (typeof providerSessionId === 'string' && providerSessionId.trim()) {
    recordProviderSessionId(session.session_id, providerSessionId.trim());
  }
  res.json({ session: getSession(session.session_id) });
});

apiRoutes.delete('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  archiveSession(session.session_id);
  res.json({ ok: true });
});
