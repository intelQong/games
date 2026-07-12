// Authoritative deathmatch room: input -> fixed-step Matter sim -> broadcast state.
import colyseus from 'colyseus';
const { Room } = colyseus;
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GameState, Player } from './state.js';
import { createWorld, createPlayerBody, Matter, Body, Composite, Query } from './physics.js';
import {
  MAP_FILE, DT, MOVE_SPEED, JET_SPEED, MAX_FALL,
  MAX_HP, RESPAWN_MS, MAX_PLAYERS, WEAPON, PLAYER_W,
} from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapJson = JSON.parse(readFileSync(join(ROOT, 'assets', 'game', MAP_FILE), 'utf8'));
const SPAWNS = mapJson.layers
  .find((l) => l.name === 'objects')
  .objects.filter((o) => o.name && o.name.startsWith('sp_p_'))
  .map((o) => ({ x: o.x, y: o.y }));

function randomSpawn() {
  return SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
}

export class GameRoom extends Room {
  onCreate(options) {
    this.maxClients = MAX_PLAYERS;
    this.roomCode = (options.roomCode || '').toUpperCase();
    this.setMetadata({ roomCode: this.roomCode });

    this.setState(new GameState());

    const { engine, world } = createWorld(mapJson);
    this.engine = engine;
    this.world = world;
    this.bodies = new Map(); // sessionId -> Matter body
    this.inputs = new Map(); // sessionId -> latest input
    this.cooldowns = new Map(); // sessionId -> ms until next shot
    this.respawns = new Map(); // sessionId -> ms until respawn

    this.onMessage('input', (client, msg) => {
      this.inputs.set(client.sessionId, msg);
    });

    this.setSimulationInterval(() => this.update(), 1000 / 30);
  }

  onJoin(client, options) {
    const p = new Player();
    p.name = (options.name || 'Player').slice(0, 16);
    const s = randomSpawn();
    p.x = s.x;
    p.y = s.y;
    p.hp = MAX_HP;
    this.state.players.set(client.sessionId, p);

    const body = createPlayerBody(s.x, s.y);
    body.plugin = { sessionId: client.sessionId };
    Composite.add(this.world, body);
    this.bodies.set(client.sessionId, body);
    this.cooldowns.set(client.sessionId, 0);
  }

  onLeave(client) {
    const body = this.bodies.get(client.sessionId);
    if (body) Composite.remove(this.world, body);
    this.bodies.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.cooldowns.delete(client.sessionId);
    this.respawns.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  update() {
    const dtMs = DT * 1000;

    // 1) Apply inputs -> desired velocities.
    for (const [id, p] of this.state.players) {
      const body = this.bodies.get(id);
      if (!body) continue;

      if (p.dead) {
        const t = (this.respawns.get(id) || 0) - dtMs;
        if (t <= 0) this.respawnPlayer(id);
        else this.respawns.set(id, t);
        Body.setVelocity(body, { x: 0, y: 0 });
        continue;
      }

      const input = this.inputs.get(id) || {};
      // Speeds are px/sec; Matter velocity is px/step => multiply by DT.
      let vx = 0;
      if (input.left) vx -= MOVE_SPEED * DT;
      if (input.right) vx += MOVE_SPEED * DT;

      // Keep the falling velocity Matter accumulated; only override to thrust up.
      let vy = body.velocity.y;
      if (input.jet) vy = -JET_SPEED * DT; // unlimited fuel
      Body.setVelocity(body, { x: vx, y: vy });

      if (typeof input.angle === 'number') {
        p.angle = input.angle;
        p.facing = Math.cos(input.angle) < 0 ? -1 : 1;
      }
    }

    // 2) Step physics (Matter applies gravity + resolves polygon collisions).
    Matter.Engine.update(this.engine, dtMs);

    // 2b) Cap fall speed so nobody tunnels through thin geometry.
    const maxFallStep = MAX_FALL * DT;
    for (const [id, p] of this.state.players) {
      const body = this.bodies.get(id);
      if (!body || p.dead) continue;
      if (body.velocity.y > maxFallStep) {
        Body.setVelocity(body, { x: body.velocity.x, y: maxFallStep });
      }
    }

    // 3) Read back body transforms into state.
    for (const [id, p] of this.state.players) {
      // Ack the latest input seq so the client can reconcile its prediction,
      // even while dead (client suspends prediction until it sees the ack clear).
      const input = this.inputs.get(id);
      if (input && typeof input.seq === 'number') p.lastSeq = input.seq;
      const body = this.bodies.get(id);
      if (!body || p.dead) continue;
      p.x = body.position.x;
      p.y = body.position.y;
      p.vx = body.velocity.x;
      p.vy = body.velocity.y;
    }

    // 4) Firing (unlimited ammo; cooldown gates rate).
    // Fetch the world's body list once per tick, not per shot.
    const allBodies = Composite.allBodies(this.world);
    for (const [id, p] of this.state.players) {
      let cd = (this.cooldowns.get(id) || 0) - dtMs;
      const input = this.inputs.get(id) || {};
      if (!p.dead && input.fire && cd <= 0) {
        this.fire(id, p, allBodies);
        cd = WEAPON.cooldownMs;
      }
      this.cooldowns.set(id, Math.max(0, cd));
    }
  }

  fire(shooterId, shooter, allBodies) {
    const body = this.bodies.get(shooterId);
    const angle = shooter.angle;
    const ox = body.position.x;
    const oy = body.position.y;

    let hitPlayerId = null;
    let endX = ox + Math.cos(angle) * WEAPON.range;
    let endY = oy + Math.sin(angle) * WEAPON.range;

    // Broadphase: only the bodies the ray segment could possibly cross. The fine
    // march below then finds the true first surface among just these few, instead
    // of point-testing every body in the world at each 8px step.
    const candidates = Query.ray(allBodies, { x: ox, y: oy }, { x: endX, y: endY }, 1)
      .map((c) => c.body)
      .filter((b) => b !== body);
    if (candidates.length === 0) {
      this.broadcast('shot', { x1: ox, y1: oy, x2: endX, y2: endY, hit: false });
      return;
    }

    const step = 8;
    for (let d = PLAYER_W * 0.6; d < WEAPON.range; d += step) {
      const px = ox + Math.cos(angle) * d;
      const py = oy + Math.sin(angle) * d;
      const hits = Query.point(candidates, { x: px, y: py });
      let stop = false;
      for (const b of hits) {
        if (b === body) continue;
        if (b.isStatic) {
          endX = px;
          endY = py;
          stop = true;
          break;
        }
        const tid = b.plugin && b.plugin.sessionId;
        const target = tid && this.state.players.get(tid);
        if (target && !target.dead) {
          hitPlayerId = tid;
          endX = px;
          endY = py;
          stop = true;
          break;
        }
      }
      if (stop) break;
    }

    this.broadcast('shot', { x1: ox, y1: oy, x2: endX, y2: endY, hit: !!hitPlayerId });

    if (hitPlayerId) {
      const victim = this.state.players.get(hitPlayerId);
      victim.hp -= WEAPON.damage;
      if (victim.hp <= 0) {
        victim.hp = 0;
        this.killPlayer(hitPlayerId, shooterId);
      }
    }
  }

  killPlayer(victimId, killerId) {
    const victim = this.state.players.get(victimId);
    const killer = this.state.players.get(killerId);
    victim.dead = true;
    this.respawns.set(victimId, RESPAWN_MS);
    if (killer && killerId !== victimId) killer.score += 1;
    this.broadcast('kill', {
      killer: killer ? killer.name : '',
      victim: victim.name,
    });
  }

  respawnPlayer(id) {
    const p = this.state.players.get(id);
    const body = this.bodies.get(id);
    if (!p || !body) return;
    const s = randomSpawn();
    Body.setPosition(body, { x: s.x, y: s.y });
    Body.setVelocity(body, { x: 0, y: 0 });
    p.x = s.x;
    p.y = s.y;
    p.vx = 0;
    p.vy = 0;
    p.hp = MAX_HP;
    p.dead = false;
    this.respawns.delete(id);
  }
}
