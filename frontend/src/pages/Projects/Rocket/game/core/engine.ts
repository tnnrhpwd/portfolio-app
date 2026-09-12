/**
 * Rocket — the simulation.
 *
 * `stepWorld` is a pure-ish function: it mutates the world it is handed and
 * returns the events that happened this tick, but it never touches Phaser, the
 * DOM, audio or time. That has two payoffs:
 *
 *  1. The whole game is unit-testable without a canvas (`engine.test.ts`).
 *  2. The renderer is replaceable — `PlayScene` merely draws `world` and feeds
 *     it input, so a rendering bug can never corrupt game state.
 *
 * Timestep: the caller passes real elapsed ms. It is capped at `MAX_STEP_MS` so
 * a stalled tab (or a backgrounded one) slows the game down instead of letting
 * bullets tunnel through a boss in one 4-second jump.
 */

import { TUNING, waveClearBonus } from './constants';
import { createRng, nextChance, nextPick, nextRange } from './rng';
import { resolveShip } from './ships';
import { EFFECT_FRAMES, ENEMY_BULLETS, ENEMY_DEFS, PICKUP_DEFS, PLAYER_BULLETS } from './tables';
import { deriveStats } from './upgrades';
import type { DerivedStats, UpgradeLevels, ShipKey } from './types';
import { enemyHpFor, enemySpeedFor, generateWave, type WavePlan } from './waves';
import type {
  Bullet,
  Effect,
  EffectKind,
  Enemy,
  EnemyKind,
  EnemyPattern,
  Pickup,
  PickupKind,
  Player,
  RunInput,
  World,
  WorldEvent,
} from './types';

/** Never simulate more than this in one step (~2 frames at 60fps). */
export const MAX_STEP_MS = 34;

const EFFECT_MS: Record<EffectKind, number> = {
  explosion: TUNING.explosionMs,
  'explosion-small': TUNING.smallExplosionMs,
  'shield-hit': TUNING.shieldHitMs,
  spark: TUNING.sparkMs,
  smoke: TUNING.explosionMs,
};

export interface WorldConfig {
  width: number;
  height: number;
  ship: ShipKey;
  levels: UpgradeLevels;
  seed?: number;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Create a fresh run. The world is immediately on wave 1 and running, so the
 * first frame the player sees is already playable.
 */
export function createWorld(cfg: WorldConfig): World {
  const ship = resolveShip(cfg.ship);
  const stats = deriveStats(ship, cfg.levels);

  const player: Player = {
    x: cfg.width / 2,
    y: cfg.height * 0.82,
    vx: 0,
    vy: 0,
    radius: TUNING.playerRadius,
    hull: stats.maxHull,
    maxHull: stats.maxHull,
    shield: stats.maxShield,
    maxShield: stats.maxShield,
    invulnMs: 0,
    cooldownMs: 0,
    ship: ship.key,
    sprite: ship.sprite,
  };

  const world: World = {
    width: cfg.width,
    height: cfg.height,
    timeMs: 0,
    status: 'running',
    wave: 0,
    score: 0,
    coins: 0,
    player,
    bullets: [],
    enemies: [],
    pickups: [],
    effects: [],
    stats: { shotsFired: 0, shotsHit: 0, kills: 0, coinsCollected: 0, msAlive: 0 },
    waveRemainingMs: 0,
    pending: [],
    rng: createRng(cfg.seed),
    bossAlive: false,
    nextId: 1,
    msSinceHit: 0,
    shieldRegenMs: TUNING.shieldRegenMs,
    levels: cfg.levels,
    derived: stats,
  };

  startWave(world, 1);
  return world;
}

/**
 * Fold newly purchased upgrades in. Hull/shield gains are *granted* rather than
 * only raising the ceiling — buying a hull upgrade mid-run has to help the run
 * you are already in, not just the next one.
 */
export function applyUpgrades(world: World, levels: UpgradeLevels): DerivedStats {
  const ship = resolveShip(world.player.ship);
  const stats = deriveStats(ship, levels);
  const player = world.player;

  const hullGain = stats.maxHull - player.maxHull;
  const shieldGain = stats.maxShield - player.maxShield;

  player.maxHull = stats.maxHull;
  player.maxShield = stats.maxShield;
  if (hullGain > 0) player.hull = Math.min(stats.maxHull, player.hull + hullGain);
  if (shieldGain > 0) player.shield = Math.min(stats.maxShield, player.shield + shieldGain);

  world.levels = levels;
  world.derived = stats;
  return stats;
}

/** Stats for the world's current ship + upgrade levels. */
export function statsFor(ship: ShipKey, levels: UpgradeLevels): DerivedStats {
  return deriveStats(resolveShip(ship), levels);
}

/**
 * Begin a wave: regenerate the schedule and reset the clock. Spawn times are
 * converted to absolute match time so the engine needs no second clock.
 */
export function startWave(world: World, wave: number): WavePlan {
  const plan = generateWave(wave, world.rng);
  world.wave = wave;
  world.pending = plan.spawns
    .map((s) => ({ ...s, atMs: world.timeMs + s.atMs }))
    .sort((a, b) => a.atMs - b.atMs);
  world.waveRemainingMs = plan.durationMs;
  world.status = 'running';
  world.bossAlive = plan.isBoss;
  // A clean slate per wave: no leftover shots crossing the boundary.
  world.bullets = [];
  return plan;
}

/** The live boss, if any — drives the boss health bar. */
export function currentBoss(world: World): Enemy | undefined {
  return world.enemies.find((e) => e.boss);
}

/**
 * Fit a live world to a new arena shape.
 *
 * The game is destroyed and recreated when the device rotates, and the run
 * continues into the new box (720×1280 instead of 1280×720, say). Everything
 * already in flight has to come with it: a wave that was mid-spawn in a wide
 * arena would otherwise leave enemies parked off the right edge of a narrow one,
 * where they can neither be shot nor shoot back — and the wave could not finish.
 *
 * Enemy `anchorX` moves too, because the weave/strafe patterns steer back
 * toward it.
 */
export function resizeWorld(world: World, width: number, height: number): void {
  world.width = width;
  world.height = height;

  world.player.x = clamp(world.player.x, world.player.radius, width - world.player.radius);
  world.player.y = clamp(world.player.y, world.player.radius, height - world.player.radius);

  for (const enemy of world.enemies) {
    enemy.x = clamp(enemy.x, enemy.radius, width - enemy.radius);
    enemy.anchorX = clamp(enemy.anchorX, enemy.radius, width - enemy.radius);
  }
  for (const bullet of world.bullets) {
    bullet.x = clamp(bullet.x, -bullet.radius, width + bullet.radius);
  }
  for (const pickup of world.pickups) {
    pickup.x = clamp(pickup.x, pickup.radius, width - pickup.radius);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

function addEffect(world: World, kind: EffectKind, x: number, y: number, scale = 1): void {
  world.effects.push({
    id: world.nextId++,
    kind,
    x,
    y,
    ageMs: 0,
    ttlMs: EFFECT_MS[kind],
    scale,
    frames: EFFECT_FRAMES[kind],
  });
}

/** Player barrel x-offsets and outward drift, as a fraction of the world width. */
function barrelLayout(barrels: number): Array<{ ox: number; drift: number }> {
  if (barrels >= 3) {
    return [
      { ox: -0.028, drift: -0.05 },
      { ox: 0, drift: 0 },
      { ox: 0.028, drift: 0.05 },
    ];
  }
  if (barrels === 2) {
    return [
      { ox: -0.019, drift: -0.03 },
      { ox: 0.019, drift: 0.03 },
    ];
  }
  return [{ ox: 0, drift: 0 }];
}

/**
 * Spawn one enemy at an explicit position.
 *
 * Exported because spawning is a first-class operation, not an implementation
 * detail of the wave scheduler: the wave path picks a lane for you, tests place
 * one exactly where they need it, and a future "boss arrives" cutscene can drop
 * one anywhere.
 */
export function spawnEnemyAt(
  world: World,
  kind: EnemyKind,
  x: number,
  y: number,
  pattern: EnemyPattern = 'drift',
): Enemy {
  const def = ENEMY_DEFS[kind];
  const hp = enemyHpFor(kind, world.wave);

  const enemy: Enemy = {
    id: world.nextId++,
    kind,
    x,
    y,
    vx: 0,
    vy: enemySpeedFor(kind, world.wave) * world.height,
    radius: def.radius,
    hull: hp,
    maxHull: hp,
    score: def.score,
    coins: def.coins,
    fireMs: def.fireMs,
    // Stagger the first shot so a row of enemies doesn't fire in unison.
    cooldownMs: def.fireMs > 0 ? def.fireMs * nextRange(world.rng, 0.45, 1.0) : 0,
    pattern,
    age: 0,
    anchorX: x,
    anchorY: y,
    sprite: nextPick(world.rng, def.sprites),
    shotDamage: Math.max(1, def.shotDamage),
    boss: kind === 'boss',
  };

  world.enemies.push(enemy);
  return enemy;
}

/** Pick a lane for a scheduled spawn, then hand off to `spawnEnemyAt`. */
function spawnEnemy(world: World, kind: EnemyKind, pattern: EnemyPattern, side: string): void {
  const def = ENEMY_DEFS[kind];

  const x =
    kind === 'boss'
      ? world.width / 2
      : side === 'left'
        ? world.width * 0.2
        : side === 'right'
          ? world.width * 0.8
          : side === 'center'
            ? world.width * 0.5
            : nextRange(world.rng, world.width * 0.12, world.width * 0.88);

  const y = kind === 'boss' ? -def.radius : -def.radius - nextRange(world.rng, 10, 60);
  const enemy = spawnEnemyAt(world, kind, x, y, pattern);

  // Drifting types hover around the lane they entered on; a boss settles high up.
  if (kind === 'boss') enemy.anchorY = world.height * 0.2;
  else if (pattern === 'hover') enemy.anchorY = world.height * nextRange(world.rng, 0.13, 0.26);
}

/** Spawn one pickup at an explicit position (see `spawnEnemyAt`). */
export function spawnPickupAt(
  world: World,
  kind: PickupKind,
  x: number,
  y: number,
  valueOverride?: number,
): Pickup {
  const def = PICKUP_DEFS[kind];
  const pickup: Pickup = {
    id: world.nextId++,
    kind,
    x,
    y,
    vx: 0,
    vy: TUNING.pickupFallSpeed * world.height,
    radius: def.radius,
    value: valueOverride ?? def.value,
    sprite: nextPick(world.rng, def.sprites),
  };
  world.pickups.push(pickup);
  return pickup;
}

/** Drops loot with a little sideways scatter so a cluster doesn't stack up. */
function spawnPickup(
  world: World,
  kind: PickupKind,
  x: number,
  y: number,
  valueOverride?: number,
): void {
  const pickup = spawnPickupAt(world, kind, x, y, valueOverride);
  pickup.vx = nextRange(world.rng, -0.05, 0.05) * world.width;
}

function spawnBullet(
  world: World,
  from: 'player' | 'enemy',
  x: number,
  y: number,
  vx: number,
  vy: number,
  damage: number,
  sprite: string,
): void {
  world.bullets.push({
    id: world.nextId++,
    x,
    y,
    vx,
    vy,
    radius: from === 'player' ? TUNING.playerBulletRadius : TUNING.enemyBulletRadius,
    damage,
    from,
    sprite,
    ttlMs: from === 'player' ? TUNING.playerBulletTtlMs : TUNING.enemyBulletTtlMs,
  });
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

/**
 * Advance the world by `dtMs` and return what happened. Events are advisory:
 * the renderer uses them for sound, shake and screen-reader announcements, and
 * ignoring them cannot desync the simulation.
 */
export function stepWorld(world: World, dtMs: number, input: RunInput): WorldEvent[] {
  const events: WorldEvent[] = [];
  if (world.status === 'dead') return events;

  const dt = Math.min(MAX_STEP_MS, Math.max(0, dtMs)) / 1000;
  if (dt <= 0) return events;

  world.timeMs += dt * 1000;
  world.stats.msAlive += dt * 1000;

  updatePlayer(world, dt, input, events);
  releaseSpawns(world);
  updateEnemies(world, dt, events);
  updateBullets(world, dt);
  collidePlayerBullets(world, events);
  collideEnemyBullets(world, events);
  collideBodies(world, events);
  updatePickups(world, dt, events);
  updateEffects(world, dt);
  checkWaveEnd(world, dt, events);

  return events;
}

function updatePlayer(
  world: World,
  dt: number,
  input: RunInput,
  events: WorldEvent[],
): void {
  const stats = world.derived;
  const p = world.player;

  // Velocity chases the input instead of snapping to it: the ship has weight.
  const targetVx = clamp(input.moveX, -1, 1) * stats.speed * world.height;
  const targetVy = clamp(input.moveY, -1, 1) * stats.speed * world.height;
  const k = Math.min(1, TUNING.playerAccel * dt);
  p.vx += (targetVx - p.vx) * k;
  p.vy += (targetVy - p.vy) * k;

  p.x = clamp(p.x + p.vx * dt, p.radius, world.width - p.radius);
  p.y = clamp(p.y + p.vy * dt, p.radius, world.height - p.radius);

  if (p.invulnMs > 0) p.invulnMs -= dt * 1000;

  // Shield regeneration, gated on not having been hit recently.
  world.msSinceHit += dt * 1000;
  if (world.msSinceHit >= TUNING.shieldRegenDelayMs && p.shield < p.maxShield) {
    world.shieldRegenMs -= dt * 1000;
    if (world.shieldRegenMs <= 0) {
      p.shield += 1;
      world.shieldRegenMs = TUNING.shieldRegenMs;
    }
  }

  p.cooldownMs -= dt * 1000;
  if (input.firing && p.cooldownMs <= 0) {
    const guns = barrelLayout(stats.barrels);
    const sprite = PLAYER_BULLETS[Math.min(guns.length, PLAYER_BULLETS.length) - 1];
    for (const gun of guns) {
      spawnBullet(
        world,
        'player',
        p.x + gun.ox * world.width,
        p.y - p.radius * 1.1,
        gun.drift * world.width,
        -TUNING.playerBulletSpeed * world.height,
        stats.damage,
        sprite,
      );
    }
    p.cooldownMs = stats.fireMs;
    world.stats.shotsFired += guns.length;
    events.push({ type: 'shot' });
  }
}

function releaseSpawns(world: World): void {
  while (world.pending.length && world.pending[0].atMs <= world.timeMs) {
    const next = world.pending.shift();
    if (!next) break;
    if (next.kind === 'boss' && world.enemies.some((e) => e.boss)) continue;
    spawnEnemy(world, next.kind, next.pattern, next.side);
  }
}

function updateEnemies(world: World, dt: number, events: WorldEvent[]): void {
  const kept: Enemy[] = [];

  for (const e of world.enemies) {
    const speed = enemySpeedFor(e.kind, world.wave) * world.height;
    e.age += dt;

    switch (e.pattern) {
      case 'drift':
        e.vx = 0;
        e.vy = speed;
        break;
      case 'rush':
        e.vx = 0;
        e.vy = speed * (1 + Math.min(1.5, e.age * 0.7));
        break;
      case 'weave':
        e.vx = Math.sin(e.age * 2.1) * speed * 0.9;
        e.vy = speed;
        break;
      case 'strafe':
        e.vx = Math.sin(e.age * 1.1) * speed * 1.7;
        e.vy = speed * 0.55;
        break;
      case 'hover':
        e.vy = e.y < e.anchorY ? speed * 1.3 : Math.sin(e.age * 0.9) * speed * 0.25;
        e.vx = Math.sin(e.age * 0.8) * speed * 0.9;
        break;
    }

    e.x = clamp(e.x + e.vx * dt, e.radius, world.width - e.radius);
    e.y += e.vy * dt;

    // Shooting: only once properly on screen, and never off the bottom edge.
    if (e.fireMs > 0 && e.y > 0 && e.y < world.height * 0.86) {
      e.cooldownMs -= dt * 1000;
      if (e.cooldownMs <= 0) {
        fireEnemy(world, e, events);
        e.cooldownMs = e.fireMs;
      }
    }

    // Left the arena without being killed — no score, no drop.
    if (e.y - e.radius > world.height + 40 && !e.boss) continue;
    kept.push(e);
  }

  world.enemies = kept;
}

function fireEnemy(world: World, e: Enemy, events: WorldEvent[]): void {
  const p = world.player;
  const speed = TUNING.enemyBulletSpeed * world.height;
  const angleToPlayer = Math.atan2(p.y - e.y, p.x - e.x);
  const sprite = nextPick(world.rng, ENEMY_BULLETS);

  // Spread widens with the threat: one aimed shot, then fans of 3 and 5.
  const fan = e.boss ? [0, -0.5, 0.5, -0.95, 0.95] : e.kind === 'gunship' ? [0, -0.32, 0.32] : [0];

  for (const offset of fan) {
    const a = angleToPlayer + offset;
    spawnBullet(
      world,
      'enemy',
      e.x,
      e.y + e.radius * 0.4,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      e.shotDamage,
      sprite,
    );
  }
  events.push({ type: 'enemy-shot' });
}

function updateBullets(world: World, dt: number): void {
  const kept: Bullet[] = [];
  for (const b of world.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.ttlMs -= dt * 1000;
    if (b.ttlMs <= 0) continue;
    if (b.y < -60 || b.y > world.height + 60 || b.x < -60 || b.x > world.width + 60) continue;
    kept.push(b);
  }
  world.bullets = kept;
}

function collidePlayerBullets(world: World, events: WorldEvent[]): void {
  if (!world.bullets.length || !world.enemies.length) return;
  const spent = new Set<number>();
  const killed = new Set<number>();

  for (const b of world.bullets) {
    if (b.from !== 'player') continue;
    for (const e of world.enemies) {
      if (killed.has(e.id)) continue;
      const r = b.radius + e.radius;
      if (dist2(b.x, b.y, e.x, e.y) > r * r) continue;

      e.hull -= b.damage;
      spent.add(b.id);
      world.stats.shotsHit += 1;
      events.push({ type: 'hit-enemy', x: b.x, y: b.y });
      addEffect(world, 'spark', b.x, b.y, 0.45);

      if (e.hull <= 0) {
        killed.add(e.id);
        killEnemy(world, e, events);
      }
      break;
    }
  }

  if (spent.size) world.bullets = world.bullets.filter((b) => !spent.has(b.id));
  if (killed.size) world.enemies = world.enemies.filter((e) => !killed.has(e.id));
}

function killEnemy(world: World, e: Enemy, events: WorldEvent[]): void {
  const def = ENEMY_DEFS[e.kind];
  world.score += e.score;
  world.stats.kills += 1;

  addEffect(
    world,
    def.deathEffect,
    e.x,
    e.y,
    e.boss ? 3.2 : Math.max(0.55, e.radius / 40),
  );

  if (e.boss) {
    world.bossAlive = false;
    for (let i = 0; i < 8; i++) {
      spawnPickup(
        world,
        i % 4 === 3 ? 'gem' : 'coin',
        e.x + nextRange(world.rng, -e.radius, e.radius),
        e.y + nextRange(world.rng, -e.radius * 0.5, e.radius * 0.5),
        i % 4 === 3 ? undefined : Math.max(1, Math.round(e.coins / 4)),
      );
    }
  } else {
    rollDrop(world, e);
  }

  events.push({ type: 'kill-enemy', x: e.x, y: e.y, kind: e.kind, boss: e.boss });
}

/** Drop table. `luck` multiplies the coin chance; gems stay rare. */
function rollDrop(world: World, e: Enemy): void {
  const stats = world.derived;

  if (nextChance(world.rng, TUNING.gemDropChance)) {
    spawnPickup(world, 'gem', e.x, e.y);
  } else if (nextChance(world.rng, Math.min(0.9, TUNING.coinDropChance * stats.coinMultiplier))) {
    spawnPickup(world, 'coin', e.x, e.y, e.coins);
  }

  if (nextChance(world.rng, TUNING.utilityDropChance)) {
    // Repair when hurt, shield otherwise — the drop should matter now.
    const hurt = world.player.hull < world.player.maxHull;
    spawnPickup(world, hurt ? 'repair' : 'shield', e.x, e.y);
  }
}

function collideEnemyBullets(world: World, events: WorldEvent[]): void {
  const p = world.player;
  const spent = new Set<number>();

  for (const b of world.bullets) {
    if (b.from !== 'enemy') continue;
    const r = b.radius + p.radius;
    if (dist2(b.x, b.y, p.x, p.y) > r * r) continue;
    spent.add(b.id);
    damagePlayer(world, b.damage, events);
  }

  if (spent.size) world.bullets = world.bullets.filter((b) => !spent.has(b.id));
}

/**
 * Ramming. A non-boss enemy is destroyed by the collision (no score, no drop —
 * you did not shoot it), a boss just shrugs and hits you again later.
 */
function collideBodies(world: World, events: WorldEvent[]): void {
  const p = world.player;
  const wrecked = new Set<number>();

  for (const e of world.enemies) {
    const r = e.radius + p.radius;
    if (dist2(e.x, e.y, p.x, p.y) > r * r) continue;

    if (p.invulnMs <= 0) damagePlayer(world, e.shotDamage || 1, events);

    if (!e.boss) {
      wrecked.add(e.id);
      addEffect(world, 'explosion-small', e.x, e.y, Math.max(0.6, e.radius / 40));
    }
  }

  if (wrecked.size) world.enemies = world.enemies.filter((e) => !wrecked.has(e.id));
}

function damagePlayer(world: World, amount: number, events: WorldEvent[]): void {
  const p = world.player;
  if (p.invulnMs > 0) return;

  world.msSinceHit = 0;
  world.shieldRegenMs = TUNING.shieldRegenMs;

  if (p.shield > 0) {
    p.shield -= 1;
    p.invulnMs = 520;
    addEffect(world, 'shield-hit', p.x, p.y, 1.15);
    events.push({ type: 'player-shielded' });
    return;
  }

  // Enemy damage is expressed directly in hull points, so a boss shell (2) hurts
  // twice as much as a stray mine (1). Shields soak one hit whatever its size.
  p.hull = Math.max(0, p.hull - Math.max(1, Math.round(amount)));
  p.invulnMs = TUNING.invulnMs;
  addEffect(world, 'explosion-small', p.x, p.y, 1.1);
  events.push({ type: 'player-hit', hull: p.hull });

  if (p.hull <= 0) {
    world.status = 'dead';
    addEffect(world, 'explosion', p.x, p.y, 2.4);
    events.push({ type: 'died' });
  }
}

function updatePickups(
  world: World,
  dt: number,
  events: WorldEvent[],
): void {
  const stats = world.derived;
  const p = world.player;
  const kept: Pickup[] = [];

  for (const item of world.pickups) {
    item.y += item.vy * dt;
    item.x += item.vx * dt;
    item.vx *= 1 - Math.min(1, dt * 0.9);

    const d2 = dist2(item.x, item.y, p.x, p.y);
    const magnet = stats.magnetRadius * (1 + p.radius / 120);

    if (d2 < magnet * magnet) {
      // Pull it in: steer directly at the ship, faster the closer it is.
      const d = Math.max(1, Math.sqrt(d2));
      const pull = (1 - d / magnet) * world.height * 1.35;
      item.x += ((p.x - item.x) / d) * pull * dt;
      item.y += ((p.y - item.y) / d) * pull * dt;
    }

    const r = item.radius + p.radius;
    if (dist2(item.x, item.y, p.x, p.y) <= r * r) {
      collect(world, item, events);
      continue;
    }

    if (item.y - item.radius > world.height + 30) {
      // Missed loot drifts off the bottom. (Deliberately no "all gone" timer.)
      continue;
    }
    kept.push(item);
  }

  world.pickups = kept;
}

function collect(world: World, item: Pickup, events: WorldEvent[]): void {
  const stats = world.derived;
  const p = world.player;
  let value = item.value;

  if (item.kind === 'coin') {
    value = Math.max(1, Math.round(item.value * stats.coinMultiplier));
    world.coins += value;
  } else if (item.kind === 'gem') {
    value = Math.max(1, Math.round(item.value * stats.coinMultiplier));
    world.coins += value;
  } else if (item.kind === 'shield') {
    if (p.shield >= p.maxShield) {
      // Already full: pay out in score instead of wasting the pickup.
      world.score += 25;
      value = 0;
    } else {
      p.shield += 1;
    }
  } else if (item.kind === 'repair') {
    if (p.hull >= p.maxHull) {
      world.score += 25;
      value = 0;
    } else {
      p.hull += 1;
    }
  }

  if (value > 0) world.stats.coinsCollected += value;
  events.push({ type: 'pickup', kind: item.kind, value });
}

function updateEffects(world: World, dt: number): void {
  if (!world.effects.length) return;
  const kept: Effect[] = [];
  for (const fx of world.effects) {
    fx.ageMs += dt * 1000;
    if (fx.ageMs < fx.ttlMs) kept.push(fx);
  }
  world.effects = kept;
}

function checkWaveEnd(world: World, dt: number, events: WorldEvent[]): void {
  if (world.status !== 'running') return;
  world.waveRemainingMs = Math.max(0, world.waveRemainingMs - dt * 1000);
  if (world.pending.length || world.enemies.length) return;

  // Everything scheduled has spawned and been dealt with.
  const bonus = waveClearBonus(world.wave);
  world.score += bonus.score;
  world.coins += bonus.coins;
  world.status = 'wave-clear';
  events.push({ type: 'wave-clear', wave: world.wave, coins: bonus.coins });
}
