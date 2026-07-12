import Phaser from 'phaser';
import { MAP_FILE, MAX_HP, WORLD_W, WORLD_H } from '../shared/constants.js';
import { WEAPONS, DEFAULT_WEAPON } from '../shared/weapons.js';

const ASSET = '/assets/game/';
const ASSET_VER = '6';
const V = (p) => `${ASSET}${p}?v=${ASSET_VER}`;
const AVATAR_H = 64;

const hpColor = (frac) => (frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xe0a83a : 0xd14a3a);

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
    this.entities = new Map();
    this.drops = new Map();
    this.tracers = [];
    this.lastInputSent = 0;
    this.killFeed = [];
    this.musicFadingOut = false;
    this.lastAimAngle = 0;
    this.mobileFiring = false;
    this.mobileNading = false;
  }

  preload() {
    this.load.tilemapTiledJSON('map', V(MAP_FILE));
    this.load.image('tileImg', V('tile64Desert_new.png'));
    this.load.image('bg', V('bgDesert_new.png'));
    this.load.image('blast', V('blast_new.png'));
    this.load.atlas('parts', V('partsTexture.png'), V('partsTexture.json'));
    this.load.atlas('menu', V('menuTexture.png'), V('menuTexture.json'));

    this.load.audio('theme', V('theme.mp3'));
    this.load.audio('shoot', V('shoot.mp3'));
    this.load.audio('explode', V('explode.mp3'));
  }

  create() {
    this.room = this.registry.get('room');
    this.roomCode = this.registry.get('roomCode');
    const overlay = this.registry.get('overlay');
    if (overlay) {
      this.startMatchEl = overlay.querySelector('#start-match-btn');
      this.mobileFireEl = overlay.querySelector('#mobile-fire');
      this.mobileNadeEl = overlay.querySelector('#mobile-nade');
    }

    this.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'bg').setOrigin(0, 0).setDepth(-10);

    const map = this.make.tilemap({ key: 'map' });
    const ts = map.addTilesetImage('tiles', 'tileImg');
    map.createLayer('tilebg', ts, 0, 0).setDepth(-5).setTint(0x8a8070);
    map.createLayer('tile', ts, 0, 0).setDepth(-4);

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.fx = this.add.graphics().setDepth(5);

    this.setupHud();
    this.setupInput();
    this.setupMobileControls();
    this.setupStateSync();

    this.themeMusic = this.sound.add('theme', { loop: true, volume: 0.5 });
    this.themeMusic.play();
  }

  setupStateSync() {
    const players = this.room.state.players;
    players.onAdd((player, sessionId) => this.addEntity(player, sessionId));
    players.onRemove((_player, sessionId) => this.removeEntity(sessionId));
    players.forEach((player, sessionId) => {
      if (!this.entities.has(sessionId)) this.addEntity(player, sessionId);
    });

    const weaponDrops = this.room.state.weaponDrops;
    weaponDrops.onAdd((drop, id) => {
      const weapon = WEAPONS[drop.weaponType] || DEFAULT_WEAPON;
      const sprite = this.add.image(drop.x, drop.y, 'menu', weapon.sprite).setDepth(-1).setScale(0.8);
      sprite.setVisible(drop.active);
      this.drops.set(id, sprite);

      this.tweens.add({
        targets: sprite,
        y: drop.y - 10,
        yoyo: true,
        repeat: -1,
        duration: 1500,
        ease: 'Sine.easeInOut'
      });

      drop.listen('active', (isActive) => {
        const s = this.drops.get(id);
        if (s) s.setVisible(isActive);
      });
    });

    this.room.onMessage('shot', (m) => {
      this.tracers.push({ ...m, ttl: 90 });
      const me = this.me ? this.me.container : { x: WORLD_W / 2, y: WORLD_H / 2 };
      const dx = m.x1 - me.x;
      const dy = m.y1 - me.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const vol = Math.max(0, 1 - (dist / 1500));
      this.sound.play('shoot', { volume: vol * 0.5 });

      if (m.hit) {
        const b = this.add.image(m.x2, m.y2, 'blast').setDepth(6).setScale(0.6);
        this.tweens.add({ targets: b, alpha: 0, scale: 1.1, duration: 220, onComplete: () => b.destroy() });
        this.sound.play('explode', { volume: vol * 0.3 });
      }
    });

    this.room.onMessage('kill', (m) => {
      const text = m.killer ? `${m.killer} ▸ ${m.victim}` : `${m.victim} died`;
      this.killFeed.unshift({ text, ttl: 4000 });
      this.killFeed = this.killFeed.slice(0, 5);
    });
  }

  addEntity(player, sessionId) {
    const container = this.add.container(player.x, player.y).setDepth(1);

    const sc = 0.35;

    const leg1 = this.add.image(8, 20, 'parts', player.leg).setScale(sc);
    const leg2 = this.add.image(-8, 20, 'parts', player.leg).setScale(sc).setTint(0xbbbbbb);
    const body = this.add.image(0, 0, 'parts', player.body).setScale(sc);
    const head = this.add.image(0, -30, 'parts', player.head).setScale(sc);

    const weaponDef = WEAPONS[player.currentWeapon] || DEFAULT_WEAPON;
    const gun = this.add.image(10, 5, 'menu', weaponDef.sprite)
      .setScale(weaponDef.scale)
      .setOrigin(0.2, 0.5);

    const isMe = sessionId === this.room.sessionId;
    const nameText = this.add
      .text(0, -60, player.name, { fontSize: '12px', color: isMe ? '#ffd27f' : '#ffffff' })
      .setOrigin(0.5, 1);
    const hpBg = this.add.rectangle(0, -64, 40, 4, 0x000000).setOrigin(0.5, 1);
    const hpFill = this.add.rectangle(-20, -64, 40, 4, 0x4caf50).setOrigin(0, 1);

    container.add([leg2, body, leg1, gun, head, hpBg, hpFill, nameText]);

    const ent = { container, head, body, leg1, leg2, gun, nameText, hpBg, hpFill, tx: player.x, ty: player.y };
    this.entities.set(sessionId, ent);

    if (isMe) {
      this.me = ent;
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }

    player.listen('currentWeapon', (newWeaponId) => {
      const wDef = WEAPONS[newWeaponId] || DEFAULT_WEAPON;
      ent.gun.setTexture('menu', wDef.sprite);
      ent.gun.setScale(wDef.scale);
    });
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
    this.hpBarBg = this.add.rectangle(12, this.scale.height - 24, 200, 16, 0x000000)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(20).setStrokeStyle(1, 0x5a4630);
    this.hpBarFill = this.add.rectangle(14, this.scale.height - 22, 196, 12, 0xd14a3a)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(21);
    this.hpLabel = this.add.text(18, this.scale.height - 24, 'HP', { ...s, fontStyle: 'bold' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(22);

    this.timerText = this.add.text(this.scale.width / 2, 10, '', { ...s, fontSize: '20px', fontStyle: 'bold' })
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(20);
    this.statusText = this.add.text(this.scale.width / 2, 40, '', { ...s, color: '#aaaaaa' })
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(20);

    this.scale.on('resize', (gameSize) => {
      this.scoreText.setPosition(gameSize.width - 12, 10);
      this.feedText.setPosition(gameSize.width - 12, 34);
      this.hpBarBg.setPosition(12, gameSize.height - 24);
      this.hpBarFill.setPosition(14, gameSize.height - 22);
      this.hpLabel.setPosition(18, gameSize.height - 24);
      this.timerText.setPosition(gameSize.width / 2, 10);
      this.statusText.setPosition(gameSize.width / 2, 40);
    });
  }

  setupMobileControls() {
    this.input.addPointer(2);

    this.joyBase = this.add.circle(0, 0, 60, 0xffffff, 0.15).setDepth(100).setScrollFactor(0).setVisible(false);
    this.joyThumb = this.add.circle(0, 0, 30, 0xffffff, 0.4).setDepth(101).setScrollFactor(0).setVisible(false);

    this.fireBtn = this.add.circle(0, 0, 36, 0xd14a3a, 0.7).setDepth(100).setScrollFactor(0);
    this.nadeBtn = this.add.circle(0, 0, 26, 0x4caf50, 0.7).setDepth(100).setScrollFactor(0);

    this.fsBtn = this.add.rectangle(0, 0, 40, 40, 0x555555, 0.8).setDepth(100).setScrollFactor(0).setInteractive();
    this.fsText = this.add.text(0, 0, '[  ]', { fontSize: '16px', fontStyle: 'bold' }).setOrigin(0.5).setDepth(101).setScrollFactor(0);
    this.fsBtn.on('pointerdown', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });

    this.scale.on('resize', (gameSize) => {
      this.fireBtn.setPosition(gameSize.width - 60, gameSize.height - 60);
      this.nadeBtn.setPosition(gameSize.width - 130, gameSize.height - 45);
      this.fsBtn.setPosition(gameSize.width - 30, 80);
      this.fsText.setPosition(gameSize.width - 30, 80);
    });
    this.scale.emit('resize', this.scale.gameSize);

    if (this.startMatchEl) {
      this.startMatchEl.style.display = 'block';
      this.startMatchEl.addEventListener('click', () => this.room.send('startMatch'));
      this.startMatchEl.addEventListener('touchstart', (e) => { e.preventDefault(); this.room.send('startMatch'); });
    }

    if (this.mobileFireEl) {
      this.mobileFireEl.addEventListener('touchstart', (e) => { e.preventDefault(); this.mobileFiring = true; });
      this.mobileFireEl.addEventListener('touchend', (e) => { e.preventDefault(); this.mobileFiring = false; });
      this.mobileFireEl.addEventListener('touchcancel', (e) => { this.mobileFiring = false; });
      this.mobileFireEl.addEventListener('mousedown', () => { this.mobileFiring = true; });
      this.mobileFireEl.addEventListener('mouseup', () => { this.mobileFiring = false; });
      this.mobileFireEl.addEventListener('mouseleave', () => { this.mobileFiring = false; });
    }

    if (this.mobileNadeEl) {
      this.mobileNadeEl.addEventListener('touchstart', (e) => { e.preventDefault(); this.mobileNading = true; });
      this.mobileNadeEl.addEventListener('touchend', (e) => { e.preventDefault(); this.mobileNading = false; });
      this.mobileNadeEl.addEventListener('touchcancel', (e) => { this.mobileNading = false; });
      this.mobileNadeEl.addEventListener('mousedown', () => { this.mobileNading = true; });
      this.mobileNadeEl.addEventListener('mouseup', () => { this.mobileNading = false; });
      this.mobileNadeEl.addEventListener('mouseleave', () => { this.mobileNading = false; });
    }
  }

  update(time, delta) {
    if (!this.room) return;

    if (time - this.lastInputSent > 33) {
      this.lastInputSent = time;

      let joyPointer = null;
      let aimPnt = null;
      let isFiring = this.mobileFiring;
      let isNading = this.mobileNading;

      for (let p of this.input.manager.pointers) {
        if (!p.isDown) continue;
        if (this.fireBtn) {
          const dxF = p.x - this.fireBtn.x;
          const dyF = p.y - this.fireBtn.y;
          if (dxF * dxF + dyF * dyF < 36 * 36) { isFiring = true; continue; }
        }
        if (this.nadeBtn) {
          const dxN = p.x - this.nadeBtn.x;
          const dyN = p.y - this.nadeBtn.y;
          if (dxN * dxN + dyN * dyN < 26 * 26) { isNading = true; continue; }
        }
        if (p.y < 60) continue;
        if (p.x > this.scale.width - 60 && p.y < 120) continue;
        if (p.x < this.scale.width / 2) joyPointer = p;
        else aimPnt = p;
      }

      let mLeft = false, mRight = false, mJet = false;
      if (joyPointer) {
        this.joyBase.setVisible(true);
        this.joyThumb.setVisible(true);
        if (!this.joyBase.activeTouch) {
          this.joyBase.setPosition(joyPointer.downX, joyPointer.downY);
          this.joyBase.activeTouch = true;
        }
        const dx = joyPointer.x - this.joyBase.x;
        const dy = joyPointer.y - this.joyBase.y;
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 60);
        const ang = Math.atan2(dy, dx);
        this.joyThumb.setPosition(this.joyBase.x + Math.cos(ang) * dist, this.joyBase.y + Math.sin(ang) * dist);
        if (dist > 15) {
          if (Math.abs(Math.cos(ang)) > 0.3) {
            if (Math.cos(ang) < 0) mLeft = true;
            else mRight = true;
          }
          if (Math.sin(ang) < -0.5) mJet = true;
        }
      } else {
        this.joyBase.setVisible(false);
        this.joyThumb.setVisible(false);
        this.joyBase.activeTouch = false;
      }

      const k = this.keys;
      let angle = 0;
      if (this.me) {
        const ptr = this.input.activePointer;
        if (ptr.pointerType === 'mouse') {
          const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
          angle = Math.atan2(world.y - this.me.container.y, world.x - this.me.container.x);
          this.lastAimAngle = angle;
        } else {
          if (aimPnt) {
            const world = this.cameras.main.getWorldPoint(aimPnt.x, aimPnt.y);
            angle = Math.atan2(world.y - this.me.container.y, world.x - this.me.container.x);
            this.lastAimAngle = angle;
          } else {
            angle = this.lastAimAngle;
          }
        }
      }
      this.room.send('input', {
        left: mLeft || k.left.isDown || k.leftArrow.isDown,
        right: mRight || k.right.isDown || k.rightArrow.isDown,
        jet: mJet || k.jetW.isDown || k.jetUp.isDown || k.jetSpace.isDown,
        fire: isFiring || (this.input.activePointer.isDown && this.input.activePointer.pointerType === 'mouse'),
        angle,
      });
    }

    const lerp = 1 - Math.pow(0.001, delta / 1000);
    this.room.state.players.forEach((player, sessionId) => {
      const ent = this.entities.get(sessionId);
      if (!ent) return;
      ent.tx = player.x;
      ent.ty = player.y;
      ent.container.x += (ent.tx - ent.container.x) * lerp;
      ent.container.y += (ent.ty - ent.container.y) * lerp;
      ent.container.setVisible(!player.dead);

      const flip = player.facing < 0;
      ent.head.setFlipX(flip);
      ent.body.setFlipX(flip);
      ent.leg1.setFlipX(flip);
      ent.leg2.setFlipX(flip);

      ent.gun.setFlipY(flip);
      ent.gun.setRotation(player.angle);

      const hpFrac = Math.max(0, player.hp / MAX_HP);
      ent.hpFill.scaleX = hpFrac;
      ent.hpFill.setFillStyle(hpColor(hpFrac));
    });

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

    const me = this.room.state.players.get(this.room.sessionId);
    if (me) {
      const frac = Math.max(0, me.hp / MAX_HP);
      this.hpBarFill.scaleX = frac;
      this.hpBarFill.setFillStyle(hpColor(frac));
    }

    this.killFeed = this.killFeed.filter((f) => (f.ttl -= delta) > 0);
    this.hudAccum = (this.hudAccum || 0) + delta;
    if (this.hudAccum >= 200) {
      this.hudAccum = 0;
      const scores = [];
      this.room.state.players.forEach((p) => scores.push({ name: p.name, score: p.score }));
      scores.sort((a, b) => b.score - a.score);
      this.scoreText.setText(scores.map((s) => `${s.name}  ${s.score}`).join('\n'));
      this.feedText.setText(this.killFeed.map((f) => f.text).join('\n'));

      const state = this.room.state;
      if (state.status === 'playing') {
        if (this.themeMusic && this.themeMusic.isPlaying && !this.musicFadingOut) {
          this.musicFadingOut = true;
          this.tweens.add({ targets: this.themeMusic, volume: 0, duration: 1000, onComplete: () => { this.themeMusic.stop(); this.musicFadingOut = false; } });
        }
        const mins = Math.floor(state.timer / 60000);
        const secs = Math.floor((state.timer % 60000) / 1000).toString().padStart(2, '0');
        this.timerText.setText(`${mins}:${secs}`);
        this.statusText.setText('');
        if (this.startMatchEl) this.startMatchEl.style.display = 'none';
      } else if (state.status === 'finished') {
        this.timerText.setText('0:00');
        this.statusText.setText('MATCH FINISHED');
        if (this.startMatchEl) this.startMatchEl.style.display = 'none';
      } else {
        if (this.themeMusic && !this.themeMusic.isPlaying) {
          this.musicFadingOut = false;
          this.themeMusic.setVolume(0);
          this.themeMusic.play();
          this.tweens.add({ targets: this.themeMusic, volume: 0.5, duration: 2000 });
        }
        this.timerText.setText('--:--');
        this.statusText.setText('LOBBY - WAITING TO START');
        if (this.startMatchEl) this.startMatchEl.style.display = 'block';
      }
    }
  }
}
