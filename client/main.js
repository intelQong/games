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

  // Create HTML overlay for reliable mobile touch buttons
  const overlay = document.createElement('div');
  overlay.id = 'game-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999';
  overlay.innerHTML = `
    <button id="start-match-btn" style="display:none; position:absolute; left:50%; top:90px; transform:translateX(-50%);
      padding:10px 32px; font-size:18px; font-weight:bold; border:none; border-radius:8px;
      background:#4caf50; color:#fff; z-index:1000; cursor:pointer; touch-action:manipulation; pointer-events:auto;">START MATCH</button>
    <div id="mobile-fire" style="display:none; position:absolute; right:24px; bottom:24px;
      width:72px; height:72px; border-radius:50%; background:rgba(209,74,58,0.7);
      z-index:1000; touch-action:manipulation; pointer-events:auto;"></div>
    <div id="mobile-nade" style="display:none; position:absolute; right:100px; bottom:50px;
      width:52px; height:52px; border-radius:50%; background:rgba(76,175,80,0.7);
      z-index:1000; touch-action:manipulation; pointer-events:auto;"></div>
  `;
  document.body.appendChild(overlay);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#140f0a',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: false },
    scene: [GameScene],
  });
  game.registry.set('room', room);
  game.registry.set('roomCode', roomCode);
  game.registry.set('world', { w: WORLD_W, h: WORLD_H });
  game.registry.set('overlay', overlay);
}
