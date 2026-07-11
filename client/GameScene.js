import Phaser from 'phaser';
import { MAP_FILE, MAX_HP, WORLD_W, WORLD_H } from '../shared/constants.js';

const ASSET = '/assets/game/';
const AVATAR_H = 46; // on-screen head height

const hpColor = (frac) => (frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xe0a83a : 0xd14a3a);

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
    this.entities = new Map(); // sessionId -> { container, head, gun, nameText, hpBg, hpFill, tx, ty }
    this.tracers = []; // { gfx-less: {x1,y1,x2,y2,ttl} }
    this.lastInputSent = 0;
    this.killFeed = []; // { text, ttl }
  }

  preload() {
    this.load.tilemapTiledJSON('map', ASSET + MAP_FILE);
    this.load.image('tileImg', ASSET + 'tile64Desert_new.png');
    this.load.image('bg', ASSET + 'bgDesert_new.png');
    this.load.image('soldier', ASSET + 'soldier.png');
    this.load.image('blast', ASSET + 'blast_new.png');
  }

  create() {
    this.room = this.registry.get('room');
    this.roomCode = this.registry.get('roomCode');

    // Background (tiled) behind everything.
    this.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'bg').setOrigin(0, 0).setDepth(-10);

    // Tilemap.
    const map = this.make.tilemap({ key: 'map' });
    const ts = map.addTilesetImage('tiles', 'tileImg');
    map.createLayer('tilebg', ts, 0, 0).setDepth(-5);
    map.createLayer('tile', ts, 0, 0).setDepth(-4);

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

    // Graphics layer for shot tracers.
    this.fx = this.add.graphics().setDepth(5);

    this.setupHud();
    this.setupInput();
    this.setupStateSync();
  }

  setupStateSync() {
    const players = this.room.state.players;
    players.onAdd((player, sessionId) => this.addEntity(player, sessionId));
    players.onRemove((_player, sessionId) => this.removeEntity(sessionId));
    // Entities already present (in case onAdd missed pre-existing).
    players.forEach((player, sessionId) => {
      if (!this.entities.has(sessionId)) this.addEntity(player, sessionId);
    });

    this.room.onMessage('shot', (m) => {
      this.tracers.push({ ...m, ttl: 90 });
      if (m.hit) {
        const b = this.add.image(m.x2, m.y2, 'blast').setDepth(6).setScale(0.6);
        this.tweens.add({ targets: b, alpha: 0, scale: 1.1, duration: 220, onComplete: () => b.destroy() });
      }
    });

    this.room.onMessage('kill', (m) => {
      const text = m.killer ? `${m.killer} ▸ ${m.victim}` : `${m.victim} died`;
      this.killFeed.unshift({ text, ttl: 4000 });
      this.killFeed = this.killFeed.slice(0, 5);
    });
  }

  addEntity(player, sessionId) {
    const scale = AVATAR_H / 118;
    const head = this.add.image(0, 0, 'soldier').setScale(scale);
    const gun = this.add.rectangle(0, 0, 26, 6, 0x2b2b2b).setOrigin(-0.2, 0.5);
    const isMe = sessionId === this.room.sessionId;
    const nameText = this.add
      .text(0, -AVATAR_H, player.name, { fontSize: '12px', color: isMe ? '#ffd27f' : '#ffffff' })
      .setOrigin(0.5, 1);
    const hpBg = this.add.rectangle(0, -AVATAR_H - 4, 40, 4, 0x000000).setOrigin(0.5, 1);
    const hpFill = this.add.rectangle(-20, -AVATAR_H - 4, 40, 4, 0x4caf50).setOrigin(0, 1);

    const container = this.add.container(player.x, player.y, [gun, head, hpBg, hpFill, nameText]);
    container.setDepth(1);

    const ent = { container, head, gun, nameText, hpBg, hpFill, tx: player.x, ty: player.y };
    this.entities.set(sessionId, ent);

    if (isMe) {
      this.me = ent;
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
  }

  removeEntity(sessionId) {
    const ent = this.entities.get(sessionId);
    if (ent) ent.container.destroy();
    this.entities.delete(sessionId);
    if (this.me && !this.entities.has(this.room.sessionId)) this.me = null;
  }

  setupInput() {
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      leftArrow: Phaser.Input.Keyboard.KeyCodes.LEFT,
      rightArrow: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      jetW: Phaser.Input.Keyboard.KeyCodes.W,
      jetUp: Phaser.Input.Keyboard.KeyCodes.UP,
      jetSpace: Phaser.Input.Keyboard.KeyCodes.SPACE,
    });
  }

  setupHud() {
    const s = { fontSize: '13px', color: '#f2e9d8', fontFamily: 'system-ui' };
    this.codeText = this.add.text(12, 10, `ROOM ${this.roomCode}`, { ...s, color: '#ffd27f', fontStyle: 'bold' })
      .setScrollFactor(0).setDepth(20);
    this.scoreText = this.add.text(this.scale.width - 12, 10, '', { ...s, align: 'right' })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(20);
    this.feedText = this.add.text(this.scale.width - 12, 34, '', { ...s, align: 'right', color: '#e0c9a6' })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(20);
    // HP bar bottom-left.
    this.hpBarBg = this.add.rectangle(12, this.scale.height - 24, 200, 16, 0x000000)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(20).setStrokeStyle(1, 0x5a4630);
    this.hpBarFill = this.add.rectangle(14, this.scale.height - 22, 196, 12, 0xd14a3a)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(21);
    this.hpLabel = this.add.text(18, this.scale.height - 24, 'HP', { ...s, fontStyle: 'bold' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(22);

    this.scale.on('resize', (gameSize) => {
      this.scoreText.setPosition(gameSize.width - 12, 10);
      this.feedText.setPosition(gameSize.width - 12, 34);
      this.hpBarBg.setPosition(12, gameSize.height - 24);
      this.hpBarFill.setPosition(14, gameSize.height - 22);
      this.hpLabel.setPosition(18, gameSize.height - 24);
    });
  }

  update(time, delta) {
    if (!this.room) return;

    // --- Send input ---
    if (time - this.lastInputSent > 33) {
      this.lastInputSent = time;
      const k = this.keys;
      const pointer = this.input.activePointer;
      let angle = 0;
      if (this.me) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        angle = Math.atan2(world.y - this.me.container.y, world.x - this.me.container.x);
      }
      this.room.send('input', {
        left: k.left.isDown || k.leftArrow.isDown,
        right: k.right.isDown || k.rightArrow.isDown,
        jet: k.jetW.isDown || k.jetUp.isDown || k.jetSpace.isDown,
        fire: pointer.isDown,
        angle,
      });
    }

    // --- Interpolate + render players ---
    const lerp = 1 - Math.pow(0.001, delta / 1000); // frame-rate independent smoothing
    this.room.state.players.forEach((player, sessionId) => {
      const ent = this.entities.get(sessionId);
      if (!ent) return;
      ent.tx = player.x;
      ent.ty = player.y;
      ent.container.x += (ent.tx - ent.container.x) * lerp;
      ent.container.y += (ent.ty - ent.container.y) * lerp;
      ent.container.setVisible(!player.dead);

      ent.head.setFlipX(player.facing < 0);
      ent.gun.setRotation(player.angle);
      const hpFrac = Math.max(0, player.hp / MAX_HP);
      ent.hpFill.scaleX = hpFrac;
      ent.hpFill.setFillStyle(hpColor(hpFrac));
    });

    // --- Tracers ---
    this.fx.clear();
    this.tracers = this.tracers.filter((t) => (t.ttl -= delta) > 0);
    for (const t of this.tracers) {
      const a = Math.min(1, t.ttl / 90);
      this.fx.lineStyle(2, 0xffe08a, a);
      this.fx.beginPath();
      this.fx.moveTo(t.x1, t.y1);
      this.fx.lineTo(t.x2, t.y2);
      this.fx.strokePath();
    }

    // --- HUD ---
    const me = this.room.state.players.get(this.room.sessionId);
    if (me) {
      const frac = Math.max(0, me.hp / MAX_HP);
      this.hpBarFill.scaleX = frac;
      this.hpBarFill.setFillStyle(hpColor(frac));
    }
    const scores = [];
    this.room.state.players.forEach((p) => scores.push({ name: p.name, score: p.score }));
    scores.sort((a, b) => b.score - a.score);
    this.scoreText.setText(scores.map((s) => `${s.name}  ${s.score}`).join('\n'));

    this.killFeed = this.killFeed.filter((f) => (f.ttl -= delta) > 0);
    this.feedText.setText(this.killFeed.map((f) => f.text).join('\n'));
  }
}
