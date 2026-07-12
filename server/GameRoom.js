// Authoritative deathmatch room: input -> fixed-step Matter sim -> broadcast state.
import colyseus from 'colyseus';
const { Room } = colyseus;
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GameState, Player, WeaponDrop } from './state.js';
import { createWorld, createPlayerBody, Matter, Body, Composite, Query } from './physics.js';
import {
  MAP_FILE, DT, MOVE_SPEED, JET_SPEED, MAX_FALL,
  MAX_HP, RESPAWN_MS, MAX_PLAYERS, PLAYER_W,
} from '../shared/constants.js';
import { WEAPONS, DEFAULT_WEAPON } from '../shared/weapons.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapJson = JSON.parse(readFileSync(join(ROOT, 'assets', 'game', MAP_FILE), 'utf8'));
const objectsLayer = mapJson.layers.find((l) => l.name === 'objects');

const SPAWNS = objectsLayer.objects
  .filter((o) => o.name && o.name.startsWith('sp_p_'))
  .map((o) => ({ x: o.x, y: o.y }));

const WEAPON_SPAWNS = objectsLayer.objects
  .filter((o) => o.name && o.name.startsWith('wp_'))
  .map((o) => {
    const wProp = o.properties?.find(p => p.name === 'weapon')?.value || '';
    const types = wProp.split(',').map(s => s.trim()).filter(Boolean);
    return { x: o.x, y: o.y, types };
  });

function randomSpawn() {
  return SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
}

const HEADS = ['avatarOption1.png', 'avatarOption2.png', 'avatarOption3.png', 'avatarOption4.png', 'avatarOption5.png', 'avatarOption6.png'];
const BODIES = ['bodyType1.png', 'bodyType2.png'];
const LEGS = ['legType1.png', 'legType2.png'];

export class GameRoom extends Room {
  onCreate(options) {
    this.maxClients = MAX_PLAYERS;
    this.roomCode = (options.roomCode || '').toUpperCase();
    this.setMetadata({ roomCode: this.roomCode });

    this.setState(new GameState());

    // Initialize weapon drops
    let dropId = 0;
    for (const sp of WEAPON_SPAWNS) {
      if (sp.types.length === 0) continue;
      const drop = new WeaponDrop();
      drop.id = `drop_${dropId++}`;
      drop.x = sp.x;
      drop.y = sp.y;
      // Pick a random supported weapon from this spawn point
      const validTypes = sp.types.filter(t => WEAPONS[t]);
      if (validTypes.length > 0) {
        drop.weaponType = validTypes[Math.floor(Math.random() * validTypes.length)];
        this.state.weaponDrops.set(drop.id, drop);
      }
    }

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

    this.onMessage('startMatch', (client) => {
      if (this.state.status === 'waiting') {
        this.state.status = 'playing';
        this.state.timer = 300000; // 5 minutes
        
        // Reset scores and respawn all
        for (const [id, p] of this.state.players) {
          p.score = 0;
          this.respawnPlayer(id);
        }

        // Reset all weapon drops to active with a new random weapon
        for (const [dropId, drop] of this.state.weaponDrops) {
          // Find the original spawn config to know what types are valid
          const original = WEAPON_SPAWNS.find(sp => Math.abs(sp.x - drop.x) < 1 && Math.abs(sp.y - drop.y) < 1);
          const validTypes = original ? original.types.filter(t => WEAPONS[t]) : [];
          if (validTypes.length > 0) {
            drop.weaponType = validTypes[Math.floor(Math.random() * validTypes.length)];
          }
          drop.active = true;
        }
      }
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
    
    // Randomize outfit
    p.head = HEADS[Math.floor(Math.random() * HEADS.length)];
    p.body = BODIES[Math.floor(Math.random() * BODIES.length)];
    p.leg = LEGS[Math.floor(Math.random() * LEGS.length)];
    p.currentWeapon = DEFAULT_WEAPON.id;
    
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

    // Handle Match Timer
    if (this.state.status === 'playing') {
      this.state.timer -= dtMs;
      if (this.state.timer <= 0) {
        this.state.timer = 0;
        this.state.status = 'finished';
        
        // Auto-restart after 10s
        this.clock.setTimeout(() => {
          this.state.status = 'waiting';
        }, 10000);
      }
    }

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
      let vx = 0;
      let vy = body.velocity.y;
      
      // Only allow movement if playing or waiting (allow messing around in lobby)
      if (this.state.status !== 'finished') {
        if (input.left) vx -= MOVE_SPEED * DT;
        if (input.right) vx += MOVE_SPEED * DT;
        if (input.jet) vy = -JET_SPEED * DT; 
      }
      Body.setVelocity(body, { x: vx, y: vy });

      if (typeof input.angle === 'number') {
        p.angle = input.angle;
        p.facing = Math.cos(input.angle) < 0 ? -1 : 1;
      }
      
      // Weapon Pickup Logic
      for (const [dropId, drop] of this.state.weaponDrops) {
        if (drop.active) {
          const dx = p.x - drop.x;
          const dy = p.y - drop.y;
          if (dx * dx + dy * dy < 2000) { // roughly 45px radius
            drop.active = false;
            p.currentWeapon = drop.weaponType;
            // Respawn drop after 15 seconds
            this.clock.setTimeout(() => {
              if (this.state.weaponDrops.has(dropId)) {
                this.state.weaponDrops.get(dropId).active = true;
              }
            }, 15000);
          }
        }
      }
    }

    // 2) Cap fall speed before stepping physics (so the body never overshoots terminal velocity)
    const maxFallStep = MAX_FALL * DT;
    for (const [id, p] of this.state.players) {
      const body = this.bodies.get(id);
      if (!body || p.dead) continue;
      if (body.velocity.y > maxFallStep) {
        Body.setVelocity(body, { x: body.velocity.x, y: maxFallStep });
      }
    }

    // 3) Step physics
    Matter.Engine.update(this.engine, dtMs);

    // 4) Read back body transforms
    for (const [id, p] of this.state.players) {
      const body = this.bodies.get(id);
      if (!body || p.dead) continue;
      p.x = body.position.x;
      p.y = body.position.y;
      p.vx = body.velocity.x;
      p.vy = body.velocity.y;
    }

    // 5) Firing
    const allBodies = Composite.allBodies(this.world);
    for (const [id, p] of this.state.players) {
      let cd = (this.cooldowns.get(id) || 0) - dtMs;
      const input = this.inputs.get(id) || {};
      const weapon = WEAPONS[p.currentWeapon] || DEFAULT_WEAPON;
      // Only allow firing during active match
      if (!p.dead && input.fire && cd <= 0 && this.state.status === 'playing') {
        this.fire(id, p, weapon, allBodies);
        cd = weapon.cooldownMs;
      }
      this.cooldowns.set(id, Math.max(0, cd));
    }
  }

  fire(shooterId, shooter, weapon, allBodies) {
    const body = this.bodies.get(shooterId);
    const ox = body.position.x;
    const oy = body.position.y;

    for (let i = 0; i < weapon.pellets; i++) {
      let angle = shooter.angle;
      if (weapon.spread > 0) {
        angle += (Math.random() - 0.5) * weapon.spread;
      }

      let hitPlayerId = null;
      let endX = ox + Math.cos(angle) * weapon.range;
      let endY = oy + Math.sin(angle) * weapon.range;

      const candidates = Query.ray(allBodies, { x: ox, y: oy }, { x: endX, y: endY }, 1)
        .map((c) => c.body)
        .filter((b) => b !== body);
        
      if (candidates.length > 0) {
        const step = 8;
        for (let d = PLAYER_W * 0.6; d < weapon.range; d += step) {
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
      }

      this.broadcast('shot', { x1: ox, y1: oy, x2: endX, y2: endY, hit: !!hitPlayerId });

      if (hitPlayerId) {
        const victim = this.state.players.get(hitPlayerId);
        victim.hp -= weapon.damage;
        if (victim.hp <= 0) {
          victim.hp = 0;
          this.killPlayer(hitPlayerId, shooterId);
        }
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
    p.currentWeapon = DEFAULT_WEAPON.id; // Lose weapon on death
    this.respawns.delete(id);
  }
}
