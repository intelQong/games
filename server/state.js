// Colyseus schema definitions (plain-JS, no decorators).
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';

export class WeaponDrop extends Schema {
  constructor() {
    super();
    this.id = '';
    this.x = 0;
    this.y = 0;
    this.weaponType = '';
    this.active = true;
  }
}
defineTypes(WeaponDrop, {
  id: 'string',
  x: 'number',
  y: 'number',
  weaponType: 'string',
  active: 'boolean',
});

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
    
    // Weapon
    this.currentWeapon = 'magnum';
    
    // Outfit
    this.head = 'head1.png';
    this.body = 'body1.png';
    this.leg = 'leg1.png';
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
  currentWeapon: 'string',
  head: 'string',
  body: 'string',
  leg: 'string',
});

export class GameState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.weaponDrops = new MapSchema();
    this.status = 'waiting'; // 'waiting', 'playing', 'finished'
    this.timer = 0; // ms remaining in match
  }
}
defineTypes(GameState, {
  players: { map: Player },
  weaponDrops: { map: WeaponDrop },
  status: 'string',
  timer: 'number',
});
