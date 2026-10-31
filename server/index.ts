import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiRoutes } from './routes.js';
import { broadcastSessionsChanged, createChatWebSocketServer } from './ws.js';
import { closeSessionsWatcher, initializeSessionsWatcher } from './watcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PANEL_SERVER_PORT ?? 3100);
const HOST = process.env.PANEL_HOST ?? '127.0.0.1';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api', apiRoutes);
app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'cloude-agent-panel' }));

// In production, serve the built client.
const distDir = path.resolve(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const server = http.createServer(app);
createChatWebSocketServer(server);

server.listen(PORT, HOST, () => {
  console.log(`[panel] cloude-agent-panel listening on http://${HOST}:${PORT}`);
  void initializeSessionsWatcher(broadcastSessionsChanged).catch((err) =>
    console.warn('[panel] session watcher failed to start:', err),
  );
});

async function shutdown() {
  await closeSessionsWatcher();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
