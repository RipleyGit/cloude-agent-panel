// Watches provider transcript directories and re-indexes changed files.
// Debounced broadcast so clients see new/updated sessions in near real time.

import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import { CLAUDE_PROJECTS_ROOT, syncAllTranscripts, syncTranscriptFile } from './providers/claude/sync.js';

let watcher: FSWatcher | null = null;

export async function initializeSessionsWatcher(
  broadcastSessionsChanged: () => void,
): Promise<void> {
  const indexed = await syncAllTranscripts();
  console.log(`[watcher] indexed ${indexed} claude transcript(s)`);
  if (indexed > 0) broadcastSessionsChanged();

  if (!fs.existsSync(CLAUDE_PROJECTS_ROOT)) return;

  let debounceTimer: NodeJS.Timeout | null = null;
  const scheduleBroadcast = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(broadcastSessionsChanged, 500);
  };

  watcher = chokidar.watch(CLAUDE_PROJECTS_ROOT, {
    usePolling: true,
    interval: 2000,
    depth: 3,
    ignoreInitial: true,
    ignored: (p, stats) =>
      !!stats?.isDirectory() &&
      ['subagents', 'tool-results', 'node_modules', '.git'].some((d) => p.includes(d)),
  });

  watcher.on('add', (p) => void handleFile(p));
  watcher.on('change', (p) => void handleFile(p));

  async function handleFile(filePath: string) {
    try {
      if (await syncTranscriptFile(filePath)) scheduleBroadcast();
    } catch (err) {
      console.warn(`[watcher] failed to sync ${filePath}:`, err);
    }
  }
}

export async function closeSessionsWatcher(): Promise<void> {
  await watcher?.close();
  watcher = null;
}
