// Shared tuning constants, imported by both the server (Node) and client (Vite).
export const MAP_KEY = '11catacombs';
export const MAP_FILE = '11catacombs.json';

export const TILE = 64;
export const MAP_W_TILES = 55;
export const MAP_H_TILES = 35;
export const WORLD_W = MAP_W_TILES * TILE; // 3520
export const WORLD_H = MAP_H_TILES * TILE; // 2240

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ; // seconds per fixed step

// Player body + movement. Speeds are pixels/sec; Matter works in pixels/step,
// so the game loop multiplies by DT before calling Body.setVelocity.
export const PLAYER_W = 34;
export const PLAYER_H = 46;
export const MOVE_SPEED = 340;
export const JET_SPEED = 360; // upward speed while thrusting (unlimited fuel)
export const MAX_FALL = 780; // terminal fall speed
export const GRAVITY_SCALE = 0.0016; // Matter engine.gravity.scale (tuned)

export const MAX_HP = 100;
export const RESPAWN_MS = 2000;
export const MAX_PLAYERS = 4;

// Single weapon. Unlimited ammo — only the cooldown gates fire rate.
export const WEAPON = { damage: 20, cooldownMs: 110, range: 1500 };
