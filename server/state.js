// Colyseus schema definitions (plain-JS, no decorators).
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';

export class Player extends Schema {
  constructor() {
    super();
    this.name = '';
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.hp = 100;
    this.score = 0;
    this.dead = false;
    this.facing = 1; // 1 = right, -1 = left
    this.lastSeq = 0; // last input seq the server has processed (for client reconciliation)
  }
}
defineTypes(Player, {
  name: 'string',
  x: 'number',
  y: 'number',
  vx: 'number',
  vy: 'number',
  angle: 'number',
  hp: 'number',
  score: 'number',
  dead: 'boolean',
  facing: 'int8',
  lastSeq: 'uint32',
});

export class GameState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
  }
}
defineTypes(GameState, {
  players: { map: Player },
});
