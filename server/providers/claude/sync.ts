// Indexes Claude Code transcript files into the sessions table.
// Root: ~/.claude/projects/<project-slug>/<sessionId>.jsonl

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  createSession,
  ensureProject,
  findSessionByProviderSessionId,
} from '../../db.js';
import { readTranscriptMeta } from './sessions.js';

export const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

const SKIP_DIRS = new Set(['subagents', 'tool-results', 'node_modules', '.git']);

// Claude Code encodes a project path into its transcript dir name by
// replacing every non-alphanumeric char with '-'.
export function projectPathToSlug(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

export function transcriptPathFor(
  projectPath: string,
  providerSessionId: string,
): string {
  return path.join(CLAUDE_PROJECTS_ROOT, projectPathToSlug(projectPath), `${providerSessionId}.jsonl`);
}

export async function syncTranscriptFile(filePath: string): Promise<boolean> {
  if (!filePath.endsWith('.jsonl')) return false;
  const parts = filePath.split(path.sep);
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  if (!fs.existsSync(filePath)) return false;

  let meta;
  try {
    meta = await readTranscriptMeta(filePath);
  } catch {
    return false;
  }
  if (!meta.providerSessionId) return false;

  const projectPath = meta.cwd ?? null;
  if (projectPath) ensureProject(projectPath);

  const existing = findSessionByProviderSessionId('claude', meta.providerSessionId);
  createSession({
    sessionId: existing?.session_id ?? crypto.randomUUID(),
    provider: 'claude',
    providerSessionId: meta.providerSessionId,
    title: meta.title,
    projectPath,
    jsonlPath: filePath,
  });
  return true;
}

export async function syncAllTranscripts(root = CLAUDE_PROJECTS_ROOT): Promise<number> {
  if (!fs.existsSync(root)) return 0;
  let count = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (await syncTranscriptFile(full)) count += 1;
      }
    }
  }
  return count;
}
