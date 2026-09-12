import Phaser from 'phaser';
import { announce } from '../accessibility';
import { GLOW_KEY, PLACEHOLDER_KEY, pickBackground } from '../assets';
import { sfx, setMuted } from '../audio/sfx';
import { TUNING } from '../core/constants';
import { currentBoss, stepWorld } from '../core/engine';
import { nextPick } from '../core/rng';
import { STAR_SPRITES, THRUSTER } from '../core/tables';
import type { RunInput, World, WorldEvent } from '../core/types';
import {
  bankCoins,
  finishRun,
  fitRunToView,
  getSave,
  startRun,
  type RunSummary,
} from '../session';
import { loadSettings, updateSettings } from '../settings';
import { addText, createButton, createIconButton } from '../ui/button';
import { PALETTE, TEXT, VIEW_HEIGHT, VIEW_WIDTH, isPortrait } from '../ui/theme';

/** Target on-screen sizes (px), so a sprite of any source size reads the same. */
const SIZE = {
  player: 66,
  bullet: 26,
  enemyBullet: 24,
  pickup: 46,
  effect: 150,
} as const;

interface Sprite {
  img: Phaser.GameObjects.Image;
  texture: string;
}

/**
 * The arena.
 *
 * This scene is a *renderer plus an input adapter* — all rules live in
 * `core/engine.ts`. Each frame it reads input, calls `stepWorld`, turns the
 * returned events into sound/shake/announcements, and paints the world. Nothing
 * here can corrupt game state, which is what makes the simulation testable.
 */
export class PlayScene extends Phaser.Scene {
  private world!: World;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;

  private player!: Phaser.GameObjects.Image;
  private thruster!: Phaser.GameObjects.Image;
  private glow!: Phaser.GameObjects.Image;

  private enemySprites = new Map<number, Sprite>();
  private bulletSprites = new Map<number, Sprite>();
  private pickupSprites = new Map<number, Sprite>();
  private effectSprites = new Map<number, Sprite>();
  private stars: Array<{ img: Phaser.GameObjects.Image; speed: number }> = [];

  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  private banner: Phaser.GameObjects.Text | null = null;
  private bannerTimer = 0;

  private hudScore!: Phaser.GameObjects.Text;
  private hudCoins!: Phaser.GameObjects.Text;
  private hudWave!: Phaser.GameObjects.Text;
  private hullIcons: Phaser.GameObjects.Image[] = [];
  private shieldIcons: Phaser.GameObjects.Image[] = [];
  private hullSlot = { x: 26, y: 0 };
  private shieldSlot = { x: 26, y: 0 };
  private waveBar!: Phaser.GameObjects.Rectangle;
  private bossBarBg: Phaser.GameObjects.Rectangle | null = null;
  private bossBarFill: Phaser.GameObjects.Rectangle | null = null;
  private bossLabel: Phaser.GameObjects.Text | null = null;

  private paused = false;
  private ending: 'none' | 'wave' | 'dead' = 'none';
  private endTimerMs = 0;

  constructor() {
    super('Play');
  }

  create(): void {
    this.resetState();
    // A run survives the game being recreated (the device rotated), so it may
    // still be shaped for the other box: fit it before anything reads it.
    this.world = fitRunToView() ?? startRun();

    this.buildBackground();
    this.buildPlayer();
    this.buildHud();
    this.buildInput();

    this.announceWave();
    announce(
      `Wave ${this.world.wave} begins. Hull ${this.world.player.hull} of ${this.world.player.maxHull}.`,
    );
  }

  private resetState(): void {
    this.enemySprites.clear();
    this.bulletSprites.clear();
    this.pickupSprites.clear();
    this.effectSprites.clear();
    this.stars = [];
    this.hullIcons = [];
    this.shieldIcons = [];
    this.pauseOverlay = null;
    this.banner = null;
    this.bossBarBg = null;
    this.bossBarFill = null;
    this.bossLabel = null;
    this.paused = false;
    // Coming back from the shop resumes the same run, so only a *new* run ends.
    this.ending = 'none';
    this.endTimerMs = 0;
    // Anchored to the bottom of whichever box this game was built for.
    this.hullSlot = { x: 26, y: VIEW_HEIGHT - 34 };
    this.shieldSlot = { x: 26, y: VIEW_HEIGHT - 70 };
  }

  // ── Construction ─────────────────────────────────────────────────────────

  private buildBackground(): void {
    const settings = loadSettings();
    this.cameras.main.setBackgroundColor(PALETTE.bg);

    // Chosen once per run and remembered, so leaving for the shop and coming
    // back doesn't swap the sky underneath the player mid-attempt.
    const remembered = this.registry.get('rocket.bg') as string | undefined;
    const key = remembered && this.textures.exists(remembered) ? remembered : pickBackground(20260912);
    this.registry.set('rocket.bg', key);

    if (this.textures.exists(key)) {
      const img = this.add.image(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, key).setDepth(-30);
      img.setScale(Math.max(VIEW_WIDTH / img.width, VIEW_HEIGHT / img.height));
      img.setAlpha(0.4);
    }

    if (!settings.parallax) return;

    // A drifting starfield gives the arena its sense of speed. Seeded so the
    // same run always looks the same.
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const rng = { s: 4242 };
    for (let i = 0; i < 64; i++) {
      const name = nextPick(rng, STAR_SPRITES);
      if (!this.textures.exists(name)) break;
      const star = this.add
        .image(rand() * VIEW_WIDTH, rand() * VIEW_HEIGHT, name)
        .setDepth(-25)
        .setAlpha(0.25 + rand() * 0.45);
      const target = 7 + rand() * 13;
      star.setScale(target / Math.max(star.width, star.height));
      this.stars.push({ img: star, speed: 26 + rand() * 80 });
    }
  }

  private buildPlayer(): void {
    const p = this.world.player;
    this.glow = this.add
      .image(p.x, p.y, this.tex(GLOW_KEY))
      .setDepth(2)
      .setAlpha(0.22)
      .setTint(PALETTE.accent);

    this.thruster = this.add.image(p.x, p.y + 30, this.tex(THRUSTER[this.world.player.ship])).setDepth(3);

    this.player = this.add.image(p.x, p.y, this.tex(p.sprite)).setDepth(4);
    this.scaleTo(this.player, SIZE.player);
    this.scaleTo(this.thruster, SIZE.player * 0.55);
  }

  private buildHud(): void {
    this.hudScore = addText(this, 26, 22, 'SCORE 0', { size: 22, bold: true, color: TEXT.primary });
    this.hudCoins = addText(this, 26, 52, 'COINS 0', { size: 18, color: TEXT.gold });
    this.hudWave = addText(this, VIEW_WIDTH / 2, 24, 'WAVE 1', {
      size: 24,
      bold: true,
      color: TEXT.primary,
      origin: [0.5, 0],
    });

    this.add
      .rectangle(VIEW_WIDTH / 2, 56, 240, 6, PALETTE.panel)
      .setOrigin(0.5, 0)
      .setDepth(9);
    this.waveBar = this.add
      .rectangle(VIEW_WIDTH / 2 - 120, 56, 240, 6, PALETTE.accent)
      .setOrigin(0, 0)
      .setDepth(10);

    // Boss health, hidden until a boss is actually alive.
    this.bossBarBg = this.add
      .rectangle(VIEW_WIDTH / 2, 92, 560, 16, PALETTE.panel)
      .setOrigin(0.5)
      .setDepth(9)
      .setVisible(false);
    this.bossBarFill = this.add
      .rectangle(VIEW_WIDTH / 2 - 280, 92, 560, 16, PALETTE.enemy)
      .setOrigin(0, 0.5)
      .setDepth(10)
      .setVisible(false);
    this.bossLabel = addText(this, VIEW_WIDTH / 2, 92, 'BOSS', {
      size: 15,
      bold: true,
      color: TEXT.primary,
      origin: [0.5, 0.5],
    })
      .setDepth(11)
      .setVisible(false);

    createIconButton(this, VIEW_WIDTH - 32, 32, '❚❚', () => this.togglePause()).container.setDepth(20);

    const settings = loadSettings();
    const mute = createIconButton(this, VIEW_WIDTH - 84, 32, settings.muted ? '🔇' : '🔊', () => {
      const next = updateSettings({ muted: !loadSettings().muted });
      setMuted(next.muted);
      mute.setLabel(next.muted ? '🔇' : '🔊');
    });
    mute.container.setDepth(20);

    this.banner = addText(this, VIEW_WIDTH / 2, VIEW_HEIGHT * 0.28, '', {
      size: 46,
      bold: true,
      color: TEXT.accent,
      origin: [0.5, 0.5],
    })
      .setDepth(15)
      .setAlpha(0);

    this.refreshCapacityIcons();
  }

  private buildInput(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.createCursorKeys();
      this.keyW = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.keyA = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyS = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keyD = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    }

    // Pause is a plain DOM listener rather than a Phaser Key. Phaser's keyboard
    // plugin drops Escape in this setup (same trap the Coliseum game hit), and a
    // native listener also cannot miss a tap that begins and ends inside one
    // frame.
    window.addEventListener('keydown', this.onKeyDown);
    // SHUTDOWN covers leaving for another scene; DESTROY covers the whole game
    // being torn down (the shell does that when the device rotates). Without the
    // second one the listener outlives the game and Escape later calls into a
    // dead scene, which throws on its null display list.
    const release = (): void => window.removeEventListener('keydown', this.onKeyDown);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, release);
    this.events.once(Phaser.Scenes.Events.DESTROY, release);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' && event.key !== 'p' && event.key !== 'P') return;
    // A scene can be mid-teardown while its DOM listener is still attached.
    if (!this.scene.isActive()) return;
    // Don't let the pause card cover the wave-clear/death transition.
    if (this.ending !== 'none') return;
    event.preventDefault();
    this.togglePause();
  };

  // ── Frame loop ───────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (this.paused) return;

    if (this.ending !== 'none') {
      this.stepEnding(delta);
      return;
    }

    const events = stepWorld(this.world, delta, this.readInput());
    this.handleEvents(events);
    this.syncSprites();
    this.updateHud();
    this.scrollStars(delta);

    if (this.world.status === 'wave-clear') this.beginWaveClear();
    else if (this.world.status === 'dead') this.beginDeath();
  }

  /**
   * Keyboard and touch in one place. Movement is the only player input: guns
   * fire automatically, which keeps the game playable with one thumb and means
   * the whole skill expression is dodging.
   */
  private readInput(): RunInput {
    let moveX = 0;
    let moveY = 0;

    if (this.cursors) {
      if (this.cursors.left.isDown || this.keyA?.isDown) moveX -= 1;
      if (this.cursors.right.isDown || this.keyD?.isDown) moveX += 1;
      if (this.cursors.up.isDown || this.keyW?.isDown) moveY -= 1;
      if (this.cursors.down.isDown || this.keyS?.isDown) moveY += 1;
    }

    // Dragging steers the ship toward the finger/cursor.
    const pointer = this.input.activePointer;
    if (pointer?.isDown) {
      const dx = pointer.x - this.world.player.x;
      const dy = pointer.y - this.world.player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 10) {
        moveX = Phaser.Math.Clamp(dx / 80, -1, 1);
        moveY = Phaser.Math.Clamp(dy / 80, -1, 1);
      } else {
        moveX = 0;
        moveY = 0;
      }
    }

    return { moveX, moveY, firing: true };
  }

  private handleEvents(events: WorldEvent[]): void {
    const reduced = loadSettings().reducedMotion;

    for (const event of events) {
      switch (event.type) {
        case 'shot':
          sfx.shoot();
          break;
        case 'enemy-shot':
          sfx.enemyShoot();
          break;
        case 'hit-enemy':
          sfx.hit();
          break;
        case 'kill-enemy':
          if (event.boss) {
            sfx.explode();
            if (!reduced) this.cameras.main.shake(420, TUNING.shakeOnBossKill);
            announce('Boss destroyed');
          } else {
            sfx.explodeSmall();
          }
          break;
        case 'shield-hit':
          sfx.shieldHit();
          if (!reduced) this.cameras.main.shake(140, TUNING.shakeOnPlayerHit * 0.5);
          break;
        case 'player-shielded':
          announce('Shield absorbed the hit');
          break;
        case 'player-hit':
          sfx.playerHit();
          if (!reduced) this.cameras.main.shake(260, TUNING.shakeOnPlayerHit);
          announce(`Hit. Hull ${event.hull} remaining`);
          break;
        case 'pickup':
          // Coins are banked the moment they are collected: dying costs you the
          // run, never the progress you already earned.
          if (event.kind === 'coin' || event.kind === 'gem') {
            bankCoins(event.value);
            if (event.kind === 'gem') sfx.gem();
            else sfx.pickup();
          } else {
            sfx.pickup();
          }
          break;
        case 'wave-clear':
          sfx.waveClear();
          // The bonus is part of the run's earnings, so it is banked like any
          // other coin — otherwise a careful wave quietly pays nothing.
          bankCoins(event.coins);
          announce(`Wave ${event.wave} cleared. Plus ${event.coins} coins.`);
          break;
        case 'died':
          sfx.death();
          if (!reduced) this.cameras.main.shake(700, TUNING.shakeOnBossKill);
          break;
        default:
          break;
      }
    }
  }

  // ── Sprite sync ──────────────────────────────────────────────────────────

  private syncSprites(): void {
    const world = this.world;
    const time = world.timeMs / 1000;

    // Player -----------------------------------------------------------------
    const p = world.player;
    this.player.setPosition(p.x, p.y);
    // Blink while invulnerable so the state is legible without a UI element.
    const invuln = p.invulnMs > 0 && Math.floor(time * 14) % 2 === 0;
    this.player.setAlpha(invuln ? 0.35 : 1);
    this.glow.setPosition(p.x, p.y);
    this.glow.setAlpha(p.shield > 0 ? 0.3 : 0.16);
    this.glow.setTint(p.shield > 0 ? PALETTE.shield : PALETTE.accent);

    const flicker = loadSettings().reducedMotion ? 1 : 0.85 + Math.sin(time * 40) * 0.15;
    this.thruster.setPosition(p.x, p.y + 30);
    this.thruster.setScale(this.thruster.scaleX, Math.abs(this.thruster.scaleY) * flicker);
    this.thruster.setAlpha(0.9);

    // Enemies ----------------------------------------------------------------
    this.syncGroup(world.enemies, this.enemySprites, (img, enemy, index) => {
      // Chunky rocks tumble; ships and turrets hold their heading.
      const spin = enemy.kind === 'asteroid' || enemy.kind === 'debris' ? (index % 2 ? 0.5 : -0.5) : 0;
      this.paint(img, {
        texture: this.tex(enemy.sprite),
        x: enemy.x,
        y: enemy.y,
        size: enemy.radius * 2.5,
        rotation: spin * time,
      });
    });

    // Bullets ---------------------------------------------------------------
    this.syncGroup(world.bullets, this.bulletSprites, (img, bullet) => {
      this.paint(img, {
        texture: this.tex(bullet.sprite),
        x: bullet.x,
        y: bullet.y,
        size: bullet.from === 'player' ? SIZE.bullet : SIZE.enemyBullet,
        tint: bullet.from === 'player' ? PALETTE.accentSoft : 0xffffff,
      });
    });

    // Loot ------------------------------------------------------------------
    this.syncGroup(world.pickups, this.pickupSprites, (img, pickup) => {
      this.paint(img, {
        texture: this.tex(pickup.sprite),
        x: pickup.x,
        y: pickup.y + Math.sin(time * 5 + pickup.id) * 3,
        size: SIZE.pickup,
      });
    });

    // Effects ---------------------------------------------------------------
    this.syncGroup(world.effects, this.effectSprites, (img, effect) => {
      const progress = Phaser.Math.Clamp(effect.ageMs / effect.ttlMs, 0, 1);
      const frames = effect.frames;
      const frame = frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))];
      const grow = loadSettings().reducedMotion ? 1 : 1 + progress * 0.35;
      this.paint(img, {
        texture: this.tex(frame),
        x: effect.x,
        y: effect.y,
        size: SIZE.effect * effect.scale * grow,
        alpha: 1 - progress * 0.55,
      });
    });
  }

  /**
   * Pool sprites per entity id: create on first sight, reuse while it lives,
   * destroy when it is gone. Cheaper and far less garbage than rebuilding the
   * display list every frame.
   */
  private syncGroup<T extends { id: number }>(
    items: T[],
    pool: Map<number, Sprite>,
    paint: (img: Phaser.GameObjects.Image, item: T, index: number) => void,
  ): void {
    const alive = new Set<number>();
    items.forEach((item, index) => {
      alive.add(item.id);
      let entry = pool.get(item.id);
      if (!entry) {
        entry = { img: this.add.image(0, 0, this.tex(PLACEHOLDER_KEY)), texture: '' };
        pool.set(item.id, entry);
      }
      if (entry.img.depth !== 1) entry.img.setDepth(1);
      paint(entry.img, item, index);
    });

    for (const [id, entry] of pool) {
      if (alive.has(id)) continue;
      entry.img.destroy();
      pool.delete(id);
    }
  }

  private tex(name: string): string {
    if (this.textures.exists(name)) return name;
    return this.textures.exists(PLACEHOLDER_KEY) ? PLACEHOLDER_KEY : '__MISSING';
  }

  private scaleTo(img: Phaser.GameObjects.Image, target: number): void {
    const size = Math.max(img.width, img.height) || 1;
    img.setScale(target / size);
  }

  private paint(
    img: Phaser.GameObjects.Image,
    opts: {
      texture: string;
      x: number;
      y: number;
      size: number;
      rotation?: number;
      alpha?: number;
      tint?: number;
    },
  ): void {
    if (img.texture.key !== opts.texture) img.setTexture(opts.texture);
    this.scaleTo(img, opts.size);
    img.setPosition(opts.x, opts.y);
    img.setRotation(opts.rotation ?? 0);
    img.setAlpha(opts.alpha ?? 1);
    if (opts.tint !== undefined) img.setTint(opts.tint);
    else img.clearTint();
  }

  private scrollStars(delta: number): void {
    if (!this.stars.length) return;
    const dt = delta / 1000;
    for (const star of this.stars) {
      star.img.y += star.speed * dt;
      if (star.img.y > VIEW_HEIGHT + 12) {
        star.img.y = -12;
        star.img.x = Math.random() * VIEW_WIDTH;
      }
    }
  }

  // ── HUD ──────────────────────────────────────────────────────────────────

  private refreshCapacityIcons(): void {
    const p = this.world.player;
    while (this.hullIcons.length < p.maxHull) {
      const img = this.add.image(0, 0, this.tex('medal-star-gold')).setDepth(12);
      this.scaleTo(img, 24);
      this.hullIcons.push(img);
    }
    while (this.shieldIcons.length < p.maxShield) {
      const img = this.add.image(0, 0, this.tex('shield-bubble-blue')).setDepth(12);
      this.scaleTo(img, 22);
      this.shieldIcons.push(img);
    }
  }

  private updateHud(): void {
    const world = this.world;
    this.hudScore.setText(`SCORE ${world.score.toLocaleString('en-US')}`);
    this.hudCoins.setText(`COINS ${world.coins.toLocaleString('en-US')}`);
    this.hudWave.setText(
      `WAVE ${world.wave}${world.wave % TUNING.bossEvery === 0 ? ' — BOSS' : ''}`,
    );

    this.refreshCapacityIcons();

    // Hull: filled stars for remaining hits, dimmed for spent ones.
    this.hullIcons.forEach((icon, index) => {
      icon.setVisible(index < world.player.maxHull);
      const alive = index < world.player.hull;
      icon.setAlpha(alive ? 1 : 0.22);
      icon.setPosition(this.hullSlot.x + index * 30, this.hullSlot.y);
      icon.setDepth(12);
    });

    this.shieldIcons.forEach((icon, index) => {
      icon.setVisible(index < world.player.maxShield);
      icon.setAlpha(index < world.player.shield ? 1 : 0.18);
      icon.setPosition(this.shieldSlot.x + index * 28, this.shieldSlot.y);
      icon.setDepth(12);
    });

    // Wave progress: how much of the spawn schedule has been released.
    const plan = this.waveDurationFor(world);
    const ratio = plan > 0 ? 1 - world.waveRemainingMs / plan : 1;
    this.waveBar.width = 240 * Phaser.Math.Clamp(ratio, 0, 1);

    // Boss bar
    const boss = currentBoss(world);
    const showBoss = Boolean(boss);
    this.bossBarBg?.setVisible(showBoss);
    this.bossBarFill?.setVisible(showBoss);
    this.bossLabel?.setVisible(showBoss);
    if (boss && this.bossBarFill) {
      this.bossBarFill.width = 560 * Phaser.Math.Clamp(boss.hull / boss.maxHull, 0, 1);
    }

    // Banner fade
    if (this.banner && this.bannerTimer > 0) {
      this.bannerTimer -= this.game.loop.delta;
      this.banner.setAlpha(Phaser.Math.Clamp(this.bannerTimer / 700, 0, 1));
    }
  }

  /** Wave length for the progress bar; boss waves have no schedule length. */
  private waveDurationFor(world: World): number {
    if (world.wave % TUNING.bossEvery === 0) return 0;
    return Math.min(
      TUNING.waveMaxMs,
      TUNING.waveBaseMs + TUNING.wavePerWaveMs * (world.wave - 1),
    );
  }

  private showBanner(text: string, holdMs = 1600): void {
    if (!this.banner) return;
    this.banner.setText(text);
    this.bannerTimer = holdMs;
    this.banner.setAlpha(loadSettings().reducedMotion ? 0.9 : 1);
    if (!loadSettings().reducedMotion) {
      this.tweens.add({
        targets: this.banner,
        scale: { from: 0.86, to: 1 },
        duration: 260,
        ease: 'Back.easeOut',
      });
    }
  }

  // ── Pause ────────────────────────────────────────────────────────────────

  private togglePause(): void {
    if (this.paused) {
      this.paused = false;
      this.pauseOverlay?.destroy();
      this.pauseOverlay = null;
      announce('Resumed');
      return;
    }

    this.paused = true;
    announce('Paused. Resume, review the controls, or quit to the menu.');
    const cx = VIEW_WIDTH / 2;
    const cy = VIEW_HEIGHT / 2;

    const shade = this.add.rectangle(cx, cy, VIEW_WIDTH, VIEW_HEIGHT, PALETTE.bg, 0.86);
    shade.setInteractive();
    const title = addText(this, cx, cy - 150, 'PAUSED', {
      size: 44,
      bold: true,
      color: TEXT.primary,
      origin: [0.5, 0.5],
    });
    const stats = addText(
      this,
      cx,
      cy - 90,
      `Wave ${this.world.wave}   ·   Score ${this.world.score.toLocaleString('en-US')}   ·   Coins ${this.world.coins}`,
      { size: 18, color: TEXT.muted, origin: [0.5, 0.5] },
    );

    const resume = createButton(this, cx, cy - 20, 'RESUME', () => this.togglePause(), {
      width: 260,
      height: 52,
      fill: PALETTE.accent,
      textColor: '#04121c',
    });
    const howto = createButton(this, cx, cy + 44, 'CONTROLS', () => this.showControls(), {
      width: 260,
      height: 48,
      outline: true,
    });
    const quit = createButton(
      this,
      cx,
      cy + 108,
      'QUIT TO MENU',
      () => {
        // Leaving mid-run still records it — the score is real even if abandoned.
        finishRun();
        this.scene.start('Menu');
      },
      { width: 260, height: 48, outline: true, textColor: TEXT.danger },
    );

    this.pauseOverlay = this.add
      .container(0, 0, [shade, title, stats, resume.container, howto.container, quit.container])
      .setDepth(60);
  }

  private showControls(): void {
    this.pauseOverlay?.destroy();
    const cx = VIEW_WIDTH / 2;
    const cy = VIEW_HEIGHT / 2;

    const shade = this.add.rectangle(cx, cy, VIEW_WIDTH, VIEW_HEIGHT, PALETTE.bg, 0.92);
    shade.setInteractive();
    const title = addText(this, cx, cy - 110, 'CONTROLS', {
      size: 30,
      bold: true,
      color: TEXT.primary,
      origin: [0.5, 0.5],
    });
    const body = addText(
      this,
      cx,
      cy - 10,
      'ARROWS / W A S D — move\nDRAG anywhere — the ship follows your finger or cursor\nGUNS — automatic, always firing\nESC or P — pause\n\nA shield absorbs one hit and regenerates after a few quiet seconds. Coins are banked as you collect them, so dying never costs you progress.',
      {
        // The long lines are what make this overlay layout-sensitive: a 720-wide
        // portrait box cannot hold them unwrapped.
        size: isPortrait() ? 16 : 18,
        color: TEXT.muted,
        align: 'center',
        origin: [0.5, 0.5],
        wrap: Math.min(880, VIEW_WIDTH - 80),
      },
    );
    const back = createButton(this, cx, cy + 140, 'BACK', () => {
      this.pauseOverlay?.destroy();
      this.paused = false;
      this.togglePause();
    }, { width: 200, height: 48 });

    this.pauseOverlay = this.add.container(0, 0, [shade, title, body, back.container]).setDepth(60);
  }

  // ── Endings ──────────────────────────────────────────────────────────────

  private announceWave(): void {
    const boss = this.world.wave % TUNING.bossEvery === 0;
    if (boss) {
      this.showBanner('BOSS INCOMING', 2200);
      sfx.bossWarning();
      announce(`Wave ${this.world.wave}. Boss incoming.`);
    } else {
      this.showBanner(`WAVE ${this.world.wave}`);
      announce(`Wave ${this.world.wave}`);
    }
  }

  private beginWaveClear(): void {
    this.ending = 'wave';
    this.endTimerMs = 1400;
    this.showBanner('WAVE CLEAR', 1400);
    announce(`Wave ${this.world.wave} cleared.`);
  }

  private beginDeath(): void {
    this.ending = 'dead';
    this.endTimerMs = 1800;
    // Check the best *before* recording, or the new score would always win.
    this.registry.set('rocket.wasBest', this.world.score > getSave().bestScore);
    // Record the run before the game-over screen reads it, and hand the summary
    // over so it cannot be recorded twice.
    const summary = finishRun();
    this.registry.set('rocket.lastRun', summary);
  }

  private stepEnding(delta: number): void {
    this.endTimerMs -= delta;
    this.syncSprites();
    this.updateHud();
    this.scrollStars(delta);

    if (this.endTimerMs > 0) return;

    if (this.ending === 'wave') {
      this.scene.start('Shop');
    } else {
      const summary = (this.registry.get('rocket.lastRun') as RunSummary | undefined) ?? undefined;
      this.scene.start('GameOver', summary);
    }
  }
}
