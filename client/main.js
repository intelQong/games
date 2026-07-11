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

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function connect(code) {
  errEl.textContent = '';
  const name = (nameEl.value || 'Soldier').slice(0, 16);
  const roomCode = code.toUpperCase();
  try {
    const room = await client.joinOrCreate('game', { roomCode, name });
    startGame(room, roomCode);
  } catch (e) {
    console.error(e);
    errEl.textContent = 'Could not join room. It may be full or unavailable.';
  }
}

document.getElementById('create').onclick = () => {
  const code = codeEl.value.trim() || randomCode();
  codeEl.value = code.toUpperCase();
  connect(code);
};
document.getElementById('join').onclick = () => {
  const code = codeEl.value.trim();
  if (code.length < 3) {
    errEl.textContent = 'Enter a room code to join.';
    return;
  }
  connect(code);
};

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
}
