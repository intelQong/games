import Phaser from 'phaser';
import {
  MAP_FILE, MAX_HP, WORLD_W, WORLD_H,
  MOVE_SPEED, JET_SPEED, MAX_FALL, DT,
} from '../shared/constants.js';
import { createWorld, createPlayerBody, Body, Composite, Engine } from '../shared/physics.js';

const ASSET = '/assets/game/';
// Cache-buster: assets keep the same filenames across re-extraction, so bump
// this whenever assets/game/ regenerates to force browsers past a stale copy
// (a cached old tileset makes Phaser miscount columns and garbles the map).
const ASSET_VER = '3';
const V = (p) => `${ASSET}${p}?v=${ASSET_VER}`;
const AVATAR_H = 64; // on-screen character height (head+torso+legs)

const TRACER_TTL_MS = 300; // shot tracers live ~300ms and fade over that span
const REMOTE_SNAP_DIST = 180; // remote pos delta beyond this snaps instead of lerps (respawn teleport)
const PRED_SNAP_DIST = 200; // local reconciliation error beyond this snaps instead of smoothing

const hpColor = (frac) => (frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xe0a83a : 0xd14a3a);

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
    this.entities = new Map(); // sessionId -> { container, head, gun, nameText, hpBg, hpFill, tx, ty, hpBand, flip }
    this.tracers = []; // { x1,y1,x2,y2,ttl }
    this.lastInputSent = 0;
    this.killFeed = []; // { text, ttl }
    this.blastPool = []; // free-list of reusable blast images
    this.msgUnbinders = [];
  }

  preload() {
    this.load.tilemapTiledJSON('map', V(MAP_FILE));
    this.load.image('tileImg', V('tile64Desert_new.png'));
    this.load.image('bg', V('bgDesert_new.png'));
    this.load.image('soldier', V('soldier.png'));
    this.load.image('blast', V('blast_new.png'));
  }

  create() {
    this.room = this.registry.get('room');
    this.roomCode = this.registry.get('roomCode');

    // Background (tiled) behind everything.
    this.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'bg').setOrigin(0, 0).setDepth(-10);

    // Tilemap.
    const map = this.make.tilemap({ key: 'map' });
    const ts = map.addTilesetImage('tiles', 'tileImg');
    // Darken the background fill layer so foreground platforms read as solid
    // ground against cave walls (matches the original game's depth cue).
    map.createLayer('tilebg', ts, 0, 0).setDepth(-5).setTint(0x8a8070);
    map.createLayer('tile', ts, 0, 0).setDepth(-4);

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

    // Graphics layer for shot tracers.
    this.fx = this.add.graphics().setDepth(5);

    this.setupPrediction();
    this.setupHud();
    this.setupInput();
    this.setupTouch();
    this.setupStateSync();

    // Tab-out safety: a hidden tab freezes update(), so the server would keep
    // re-applying the last input (endless fly/fire). Send one neutral input.
    this.onVisibility = () => { if (document.hidden) this.sendNeutral(); };
    this.onBlur = () => this.sendNeutral();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);

    this.events.once('shutdown', () => this.teardown());
  }

  // --- Client-side prediction: a local Matter world simulating only our body. ---
  setupPrediction() {
    const mapData = this.cache.tilemap.get('map').data;
    const { engine, world } = createWorld(mapData);
    this.predEngine = engine;
    this.predWorld = world;
    this.localBody = null;
    this.pending = []; // [{ seq, input }] inputs not yet acked by the server
    this.inputSeq = 0;
    this.ackedSeq = 0;
    this.predErrX = 0; // display offset from the true body, decays to hide corrections
    this.predErrY = 0;
    this.wasDead = false;
  }

  setupStateSync() {
    const players = this.room.state.players;
    players.onAdd((player, sessionId) => this.addEntity(player, sessionId));
    players.onRemove((_player, sessionId) => this.removeEntity(sessionId));
    // Entities already present (in case onAdd missed pre-existing).
    players.forEach((player, sessionId) => {
      if (!this.entities.has(sessionId)) this.addEntity(player, sessionId);
    });

    this.msgUnbinders.push(this.room.onMessage('shot', (m) => {
      this.tracers.push({ ...m, ttl: TRACER_TTL_MS });
      if (m.hit) this.spawnBlast(m.x2, m.y2);
    }));

    this.msgUnbinders.push(this.room.onMessage('kill', (m) => {
      const text = m.killer ? `${m.killer} ▸ ${m.victim}` : `${m.victim} died`;
      this.killFeed.unshift({ text, ttl: 4000 });
      this.killFeed = this.killFeed.slice(0, 5);
    }));

    // Unexpected disconnect / server error: freeze input and surface an overlay.
    this.room.onLeave(() => this.handleDisconnect());
    this.room.onError(() => this.handleDisconnect());
  }

  handleDisconnect() {
    if (this.disconnected) return;
    this.disconnected = true;
    const el = document.getElementById('disconnected');
    if (el) el.style.display = 'flex';
  }

  spawnBlast(x, y) {
    const b = this.blastPool.pop() || this.add.image(0, 0, 'blast').setDepth(6);
    b.setVisible(true).setActive(true).setPosition(x, y).setAlpha(1).setScale(0.6);
    this.tweens.add({
      targets: b, alpha: 0, scale: 1.1, duration: 220,
      onComplete: () => { b.setVisible(false).setActive(false); this.blastPool.push(b); },
    });
  }

  addEntity(player, sessionId) {
    // Scale the composited full-body sprite to a target on-screen height.
    const head = this.add.image(0, 0, 'soldier');
    head.setScale(AVATAR_H / head.height);
    const gun = this.add.rectangle(0, 0, 26, 6, 0x2b2b2b).setOrigin(-0.2, 0.5);
    const isMe = sessionId === this.room.sessionId;
    const nameText = this.add
      .text(0, -AVATAR_H, player.name, { fontSize: '12px', color: isMe ? '#ffd27f' : '#ffffff' })
      .setOrigin(0.5, 1);
    const hpBg = this.add.rectangle(0, -AVATAR_H - 4, 40, 4, 0x000000).setOrigin(0.5, 1);
    const hpFill = this.add.rectangle(-20, -AVATAR_H - 4, 40, 4, 0x4caf50).setOrigin(0, 1);

    const container = this.add.container(player.x, player.y, [gun, head, hpBg, hpFill, nameText]);
    container.setDepth(1);

    const ent = { container, head, gun, nameText, hpBg, hpFill, tx: player.x, ty: player.y, hpBand: 0x4caf50, flip: false };
    this.entities.set(sessionId, ent);

    if (isMe) {
      this.me = ent;
      // Seed the local prediction body at the authoritative spawn.
      this.localBody = createPlayerBody(player.x, player.y);
      Composite.add(this.predWorld, this.localBody);
      this.ackedSeq = player.lastSeq || 0;
      this.wasDead = !!player.dead;
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
  }

  removeEntity(sessionId) {
    const ent = this.entities.get(sessionId);
    if (ent) ent.container.destroy();
    this.entities.delete(sessionId);
    if (this.me && !this.entities.has(this.room.sessionId)) {
      this.me = null;
      this.cameras.main.stopFollow();
      if (this.localBody) {
        Composite.remove(this.predWorld, this.localBody);
        this.localBody = null;
      }
    }
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

  // --- Touch controls: left half = virtual movement stick, right half = aim + fire. ---
  setupTouch() {
    this.touchEnabled = this.sys.game.device.input.touch;
    if (!this.touchEnabled) return;
    this.input.addPointer(2); // allow simultaneous stick + aim touches

    this.stickPointer = null;
    this.stickBase = { x: 0, y: 0 };
    this.aimPointer = null;

    this.stickBaseGfx = this.add.circle(0, 0, 46, 0xffffff, 0.12)
      .setScrollFactor(0).setDepth(30).setVisible(false);
    this.stickThumbGfx = this.add.circle(0, 0, 22, 0xffffff, 0.25)
      .setScrollFactor(0).setDepth(31).setVisible(false);

    this.input.on('pointerdown', (p) => {
      if (p.x < this.scale.width / 2 && !this.stickPointer) {
        this.stickPointer = p;
        this.stickBase = { x: p.x, y: p.y };
        this.stickBaseGfx.setPosition(p.x, p.y).setVisible(true);
        this.stickThumbGfx.setPosition(p.x, p.y).setVisible(true);
      } else if (p.x >= this.scale.width / 2 && !this.aimPointer) {
        this.aimPointer = p;
      }
    });
    this.input.on('pointermove', (p) => {
      if (this.stickPointer && p.id === this.stickPointer.id) {
        const clamp = 46;
        const tx = this.stickBase.x + Math.max(-clamp, Math.min(clamp, p.x - this.stickBase.x));
        const ty = this.stickBase.y + Math.max(-clamp, Math.min(clamp, p.y - this.stickBase.y));
        this.stickThumbGfx.setPosition(tx, ty);
      }
    });
    this.input.on('pointerup', (p) => {
      if (this.stickPointer && p.id === this.stickPointer.id) {
        this.stickPointer = null;
        this.stickBaseGfx.setVisible(false);
        this.stickThumbGfx.setVisible(false);
      }
      if (this.aimPointer && p.id === this.aimPointer.id) this.aimPointer = null;
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
    this.hpBand = 0xd14a3a;
    this.hpLabel = this.add.text(18, this.scale.height - 24, 'HP', { ...s, fontStyle: 'bold' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(22);

    this.onResize = (gameSize) => {
      this.scoreText.setPosition(gameSize.width - 12, 10);
      this.feedText.setPosition(gameSize.width - 12, 34);
      this.hpBarBg.setPosition(12, gameSize.height - 24);
      this.hpBarFill.setPosition(14, gameSize.height - 22);
      this.hpLabel.setPosition(18, gameSize.height - 24);
    };
    this.scale.on('resize', this.onResize);
  }

  // Step the local body one tick with the SAME rules as GameRoom.update() 1–2b.
  applyInput(input) {
    const body = this.localBody;
    if (!body) return;
    let vx = 0;
    if (input.left) vx -= MOVE_SPEED * DT;
    if (input.right) vx += MOVE_SPEED * DT;
    let vy = body.velocity.y;
    if (input.jet) vy = -JET_SPEED * DT;
    Body.setVelocity(body, { x: vx, y: vy });
    Engine.update(this.predEngine, DT * 1000);
    const maxFallStep = MAX_FALL * DT;
    if (body.velocity.y > maxFallStep) Body.setVelocity(body, { x: body.velocity.x, y: maxFallStep });
  }

  sendInput(input, dead) {
    if (this.disconnected || !this.room) return;
    const seq = ++this.inputSeq;
    this.room.send('input', { ...input, seq });
    if (!dead && this.localBody) {
      this.pending.push({ seq, input });
      this.applyInput(input);
    }
  }

  sendNeutral() {
    if (this.disconnected || !this.room) return;
    this.input.keyboard.resetKeys();
    if (this.touchEnabled) {
      this.stickPointer = null;
      this.aimPointer = null;
      this.stickBaseGfx.setVisible(false);
      this.stickThumbGfx.setVisible(false);
    }
    const me = this.room.state.players.get(this.room.sessionId);
    this.sendInput({ left: false, right: false, jet: false, fire: false, angle: this.lastAngle || 0 }, me && me.dead);
  }

  // Snap to server truth, drop acked inputs, replay the rest; smooth the residual.
  reconcile(me) {
    if (!this.localBody || me.dead) return;
    if (me.lastSeq <= this.ackedSeq) return;
    this.ackedSeq = me.lastSeq;
    const body = this.localBody;
    const prevX = body.position.x + this.predErrX;
    const prevY = body.position.y + this.predErrY;
    Body.setPosition(body, { x: me.x, y: me.y });
    Body.setVelocity(body, { x: me.vx, y: me.vy });
    this.pending = this.pending.filter((pi) => pi.seq > me.lastSeq);
    for (const pi of this.pending) this.applyInput(pi.input);
    const errX = prevX - body.position.x;
    const errY = prevY - body.position.y;
    if (Math.hypot(errX, errY) > PRED_SNAP_DIST) { this.predErrX = 0; this.predErrY = 0; }
    else { this.predErrX = errX; this.predErrY = errY; }
  }

  teardown() {
    this.scale.off('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    for (const off of this.msgUnbinders) { if (typeof off === 'function') off(); }
    this.msgUnbinders = [];
  }

  update(time, delta) {
    if (!this.room || this.disconnected) return;

    const me = this.room.state.players.get(this.room.sessionId);

    // --- Death / respawn: suspend prediction while dead, snap on respawn. ---
    if (me && this.localBody) {
      if (me.dead) {
        Body.setPosition(this.localBody, { x: me.x, y: me.y });
        Body.setVelocity(this.localBody, { x: 0, y: 0 });
        this.pending = [];
        this.predErrX = 0; this.predErrY = 0;
        this.ackedSeq = me.lastSeq;
        this.wasDead = true;
      } else {
        if (this.wasDead) {
          Body.setPosition(this.localBody, { x: me.x, y: me.y });
          Body.setVelocity(this.localBody, { x: me.vx, y: me.vy });
          this.pending = [];
          this.predErrX = 0; this.predErrY = 0;
          this.ackedSeq = me.lastSeq;
          this.wasDead = false;
        }
        this.reconcile(me);
      }
    }

    // --- Send input (predict local body with it). ---
    if (time - this.lastInputSent > 33) {
      this.lastInputSent = time;
      const k = this.keys;

      // Aim origin: authoritative state position (matches server hitscan origin),
      // falling back to the rendered container before the first sync.
      const origin = me ? { x: me.x, y: me.y } : (this.me ? this.me.container : { x: 0, y: 0 });

      let angle = this.lastAngle || 0;
      let fire = false;
      if (this.touchEnabled) {
        if (this.aimPointer && this.aimPointer.isDown) {
          const w = this.cameras.main.getWorldPoint(this.aimPointer.x, this.aimPointer.y);
          angle = Math.atan2(w.y - origin.y, w.x - origin.x);
          fire = true;
        }
      } else {
        const pointer = this.input.activePointer;
        const w = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        angle = Math.atan2(w.y - origin.y, w.x - origin.x);
        fire = pointer.isDown;
      }
      this.lastAngle = angle;

      // Merge keyboard with the virtual stick.
      let left = k.left.isDown || k.leftArrow.isDown;
      let right = k.right.isDown || k.rightArrow.isDown;
      let jet = k.jetW.isDown || k.jetUp.isDown || k.jetSpace.isDown;
      if (this.touchEnabled && this.stickPointer) {
        const DZ = 18;
        const dx = this.stickPointer.x - this.stickBase.x;
        const dy = this.stickPointer.y - this.stickBase.y;
        if (dx < -DZ) left = true; else if (dx > DZ) right = true;
        if (dy < -DZ) jet = true;
      }

      this.sendInput({ left, right, jet, fire, angle }, me && me.dead);
    }

    // --- Interpolate + render players ---
    const lerp = 1 - Math.pow(0.001, delta / 1000); // frame-rate independent smoothing
    const errDecay = Math.pow(0.001, delta / 1000); // decay the local correction offset
    this.predErrX *= errDecay;
    this.predErrY *= errDecay;
    this.room.state.players.forEach((player, sessionId) => {
      const ent = this.entities.get(sessionId);
      if (!ent) return;

      if (sessionId === this.room.sessionId && this.localBody && !player.dead) {
        // Local player: render the predicted body position (+ smoothed correction).
        ent.container.x = this.localBody.position.x + this.predErrX;
        ent.container.y = this.localBody.position.y + this.predErrY;
      } else {
        // Remote (or dead) players: interpolate, but snap on a big jump (respawn).
        ent.tx = player.x;
        ent.ty = player.y;
        const dx = ent.tx - ent.container.x;
        const dy = ent.ty - ent.container.y;
        if (Math.hypot(dx, dy) > REMOTE_SNAP_DIST) {
          ent.container.x = ent.tx;
          ent.container.y = ent.ty;
        } else {
          ent.container.x += dx * lerp;
          ent.container.y += dy * lerp;
        }
      }
      ent.container.setVisible(!player.dead);

      const flip = player.facing < 0;
      if (ent.flip !== flip) { ent.head.setFlipX(flip); ent.flip = flip; }
      ent.gun.setRotation(player.angle);
      const hpFrac = Math.max(0, player.hp / MAX_HP);
      ent.hpFill.scaleX = hpFrac;
      const band = hpColor(hpFrac);
      if (ent.hpBand !== band) { ent.hpFill.setFillStyle(band); ent.hpBand = band; }
    });

    // --- Tracers ---
    this.fx.clear();
    this.tracers = this.tracers.filter((t) => (t.ttl -= delta) > 0);
    for (const t of this.tracers) {
      const a = Math.min(1, t.ttl / TRACER_TTL_MS);
      this.fx.lineStyle(2, 0xffe08a, a);
      this.fx.beginPath();
      this.fx.moveTo(t.x1, t.y1);
      this.fx.lineTo(t.x2, t.y2);
      this.fx.strokePath();
    }

    // --- HUD ---
    if (me) {
      const frac = Math.max(0, me.hp / MAX_HP);
      this.hpBarFill.scaleX = frac;
      const band = hpColor(frac);
      if (this.hpBand !== band) { this.hpBarFill.setFillStyle(band); this.hpBand = band; }
    }
    // Throttle HUD text rebuilds (scoreboard + kill feed) off the 60fps path:
    // setText forces Phaser text re-layout, but these only change on kills.
    this.killFeed = this.killFeed.filter((f) => (f.ttl -= delta) > 0);
    this.hudAccum = (this.hudAccum || 0) + delta;
    if (this.hudAccum >= 200) {
      this.hudAccum = 0;
      const scores = [];
      this.room.state.players.forEach((p) => scores.push({ name: p.name, score: p.score }));
      scores.sort((a, b) => b.score - a.score);
      const scoreStr = scores.map((s) => `${s.name}  ${s.score}`).join('\n');
      if (scoreStr !== this.lastScoreStr) { this.scoreText.setText(scoreStr); this.lastScoreStr = scoreStr; }
      const feedStr = this.killFeed.map((f) => f.text).join('\n');
      if (feedStr !== this.lastFeedStr) { this.feedText.setText(feedStr); this.lastFeedStr = feedStr; }
    }
  }
}
