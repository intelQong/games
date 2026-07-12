// Lobby wiring + Phaser boot. Connects to Colyseus, then launches the game scene.
import Phaser from 'phaser';
import { Client } from 'colyseus.js';
import { GameScene } from './GameScene.js';
import { WORLD_W, WORLD_H } from '../shared/constants.js';

const endpoint = import.meta.env.DEV
  ? `ws://${location.hostname}:2567`
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

const client = new Client(endpoint);

const lobby = document.getElementById('lobby');
const errEl = document.getElementById('err');
const nameEl = document.getElementById('name');
const codeEl = document.getElementById('code');
const createBtn = document.getElementById('create');
const joinBtn = document.getElementById('join');

// Full-screen overlay shown when the in-game connection drops; the button
// reloads the page for a clean state reset back to the lobby.
document.getElementById('back-to-lobby').onclick = () => location.reload();

let connecting = false;

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function connect(code) {
  if (connecting) return; // guard against double-connect (rapid clicks / Enter)
  connecting = true;
  createBtn.disabled = true;
  joinBtn.disabled = true;
  errEl.textContent = 'Connecting…';
  const name = (nameEl.value || 'Soldier').slice(0, 16);
  const roomCode = code.toUpperCase();
  try {
    const room = await client.joinOrCreate('game', { roomCode, name });
    startGame(room, roomCode);
  } catch (e) {
    console.error(e);
    errEl.textContent = 'Could not join room. It may be full or unavailable.';
    connecting = false;
    createBtn.disabled = false;
    joinBtn.disabled = false;
  }
}

function doCreate() {
  const code = codeEl.value.trim() || randomCode();
  codeEl.value = code.toUpperCase();
  connect(code);
}

function doJoin() {
  const code = codeEl.value.trim();
  if (code.length < 3) {
    errEl.textContent = 'Enter a room code to join.';
    return;
  }
  connect(code);
}

createBtn.onclick = doCreate;
joinBtn.onclick = doJoin;

// Enter on either input submits: join if a code is typed, otherwise create.
for (const el of [nameEl, codeEl]) {
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (codeEl.value.trim().length >= 3) doJoin();
    else doCreate();
  });
}

function startGame(room, roomCode) {
  lobby.style.display = 'none';
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#140f0a',
    pixelArt: false,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: false },
    scene: [GameScene],
  });
  game.registry.set('room', room);
  game.registry.set('roomCode', roomCode);
  game.registry.set('world', { w: WORLD_W, h: WORLD_H });
  // Dev-only handle for debugging/automation; stripped from production builds.
  if (import.meta.env.DEV) window.__game = game;
}
