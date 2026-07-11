// Matter.js world built from the map's collision polygons.
import Matter from 'matter-js';
import decomp from 'poly-decomp';
import { PLAYER_W, PLAYER_H, GRAVITY_SCALE } from '../shared/constants.js';

// Enable concave polygon decomposition for Bodies.fromVertices.
Matter.Common.setDecomp(decomp);

const { Engine, Bodies, Body, Composite, Vertices, Query } = Matter;

export function createWorld(mapJson) {
  const engine = Engine.create();
  // Matter owns gravity + collision resolution; the game loop only steers
  // horizontal velocity and overrides vertical velocity while jetpacking.
  engine.gravity.y = 1;
  engine.gravity.scale = GRAVITY_SCALE;
  const world = engine.world;

  const collision = mapJson.layers.find((l) => l.name === 'collision');
  const statics = [];
  for (const o of collision.objects) {
    if (!o.polygon) continue;
    // Polygon points are relative to the object's (x, y); make them absolute.
    const verts = o.polygon.map((p) => ({ x: o.x + p.x, y: o.y + p.y }));
    const centre = Vertices.centre(verts);
    // fromVertices re-centres the shape onto (centre) => keeps original placement.
    const body = Bodies.fromVertices(centre.x, centre.y, [verts], { isStatic: true, friction: 0.4 }, true);
    if (body) statics.push(body);
  }
  Composite.add(world, statics);
  return { engine, world };
}

export function createPlayerBody(x, y) {
  return Bodies.rectangle(x, y, PLAYER_W, PLAYER_H, {
    inertia: Infinity, // never rotate
    friction: 0.02,
    frictionAir: 0,
    frictionStatic: 0.1,
    restitution: 0,
  });
}

export { Matter, Body, Composite, Query, Engine };
