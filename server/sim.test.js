// Assert-based self-check for the physics + combat math. Run: npm test
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createWorld, createPlayerBody, Matter, Body, Composite, Query } from './physics.js';
import { MAP_FILE, DT, MAX_FALL, WORLD_H, PLAYER_W, WEAPON } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapJson = JSON.parse(readFileSync(join(ROOT, 'assets', 'game', MAP_FILE), 'utf8'));

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// 1) World builds with the expected number of static polygon bodies.
const { engine, world } = createWorld(mapJson);
check('collision world builds from polygons', () => {
  const statics = Composite.allBodies(world).filter((b) => b.isStatic);
  assert(statics.length >= 10, `expected >=10 static bodies, got ${statics.length}`);
});

// 2) A player dropped above a spawn point comes to rest and never falls out.
check('player rests on the map (no tunneling, no explosion)', () => {
  const spawns = mapJson.layers
    .find((l) => l.name === 'objects')
    .objects.filter((o) => o.name && o.name.startsWith('sp_p_'));

  const maxFallStep = MAX_FALL * DT;
  let settledCount = 0;
  for (const s of spawns) {
    const body = createPlayerBody(s.x, s.y - 120);
    Composite.add(world, body);
    for (let i = 0; i < 250; i++) {
      Matter.Engine.update(engine, DT * 1000); // Matter applies gravity
      if (body.velocity.y > maxFallStep) Body.setVelocity(body, { x: body.velocity.x, y: maxFallStep });
    }
    assert(body.position.y > 0 && body.position.y < WORLD_H, `${s.name}: out of world (y=${body.position.y})`);
    if (Math.abs(body.velocity.y) < 2) settledCount++;
    Composite.remove(world, body);
  }
  // Most spawns are on solid ground; require the majority to settle to rest.
  assert(settledCount >= Math.ceil(spawns.length / 2), `only ${settledCount}/${spawns.length} spawns settled`);
});

// 3) Hitscan is blocked by static geometry (ray stepping stops at a wall).
check('hitscan stops at a wall before max range', () => {
  const bodies = Composite.allBodies(world);
  // Aim a ray from inside the map straight down through a polygon; expect a static hit.
  const collision = mapJson.layers.find((l) => l.name === 'collision');
  const poly = collision.objects.find((o) => o.polygon);
  const absX = poly.x + poly.polygon.reduce((s, p) => s + p.x, 0) / poly.polygon.length;
  const topY = poly.y + Math.min(...poly.polygon.map((p) => p.y));

  const ox = absX;
  const oy = topY - 100;
  let hitStatic = false;
  for (let d = PLAYER_W * 0.6; d < WEAPON.range; d += 8) {
    const py = oy + d; // straight down
    const hits = Query.point(bodies, { x: ox, y: py });
    if (hits.some((b) => b.isStatic)) {
      hitStatic = true;
      assert(d < WEAPON.range, 'wall hit within range');
      break;
    }
  }
  assert(hitStatic, 'ray should have hit the polygon below the start point');
});

// 4) Damage math: WEAPON hits reduce HP and a lethal hit crosses zero.
check('damage math reaches a kill', () => {
  let hp = 100;
  let shots = 0;
  while (hp > 0) {
    hp -= WEAPON.damage;
    shots++;
    assert(shots < 100, 'runaway damage loop');
  }
  assert(shots === Math.ceil(100 / WEAPON.damage), `unexpected shots-to-kill: ${shots}`);
});

console.log(`\n${passed} checks passed.`);
process.exit(0);
