// Colyseus game server. Also serves the built client + extracted assets.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import colyseus from 'colyseus';
import wsTransport from '@colyseus/ws-transport';
const { Server } = colyseus;
const { WebSocketTransport } = wsTransport;
import { GameRoom } from './GameRoom.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 2567;

const app = express();

// Extracted game assets (map JSON + sprites) — needed in dev and prod.
app.use('/assets/game', express.static(join(ROOT, 'assets', 'game')));

// In production, serve the built client. In dev, Vite serves the client itself.
const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// filterBy roomCode makes joinOrCreate('game', { roomCode }) act as join-by-code.
gameServer.define('game', GameRoom).filterBy(['roomCode']);

gameServer.listen(PORT).then(() => {
  console.log(`Game server listening on :${PORT}`);
});
