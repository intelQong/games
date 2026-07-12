# Militia Web

A browser deathmatch remake that reuses the maps and art from Mini Militia
(Doodle Army 2). The original game is a Cocos2d-x app whose logic is compiled
into a native `.so`, so the gameplay here is **rebuilt from scratch** — only the
recoverable assets (Tiled maps, tilesets, sprites) are reused.

> Reuses copyrighted art/maps for private play with friends only. Do not
> distribute as a product.

## Features (MVP)

- One map: **Catacombs** (`11catacombs`), desert theme.
- Server-authoritative sim: jetpack flight (**unlimited fuel**), gravity, and
  collision against the map's concave polygon geometry (Matter.js).
- Hitscan combat with **unlimited ammo** (fire-rate cooldown only), HP,
  death/respawn, score, and a kill feed.
- Up to 8 player online rooms, **join by 4-char room code**.

## Controls

- Move: `A` / `D` (or arrow keys)
- Jetpack: `W`, `Up`, or `Space`
- Aim: mouse · Fire: click/hold

## Stack

- **Client:** Phaser 3 (renders the Tiled-JSON map + sprites), Vite.
- **Server:** Colyseus (rooms, matchmaking, state sync) + Matter.js (physics).
- **Shared:** tuning constants in `shared/constants.js`.

## Setup

```bash
npm install
npm run extract   # one-time: pull map + art out of the APK into assets/game/
npm run dev       # Vite client (:5173) + Colyseus server (:2567)
```

Open <http://localhost:5173> in two tabs, create a room in one, join with the
same code in the other.

## Production

```bash
npm run build:client   # -> dist/
npm start              # serves dist/ + game server on :2567 (PORT env respected)
```

## Layout

```
tools/extract.js   APK -> assets/game/ (TMX->Tiled JSON, polygon extraction, sprite crop)
shared/            tuning constants shared by client + server
server/            Colyseus room, Matter physics, state schema, self-check test
client/            Phaser boot, lobby, game scene
assets/game/       extracted map JSON + sprites (generated)
```

## Tests

```bash
npm test   # assert-based physics + combat self-check
```
