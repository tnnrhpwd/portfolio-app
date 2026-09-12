import { TUNING, waveClearBonus } from './constants';
import {
  MAX_STEP_MS,
  applyUpgrades,
  createWorld,
  currentBoss,
  resizeWorld,
  spawnEnemyAt,
  spawnPickupAt,
  startWave,
  stepWorld,
  type WorldConfig,
} from './engine';
import { createUpgradeLevels } from './upgrades';
import type { Enemy, Pickup, Player, RunInput, World, WorldEvent } from './types';

const W = 1280;
const H = 720;

const IDLE: RunInput = { moveX: 0, moveY: 0, firing: false };
const FIRE: RunInput = { moveX: 0, moveY: 0, firing: true };
const RIGHT: RunInput = { moveX: 1, moveY: 0, firing: false };

function makeWorld(overrides: Partial<WorldConfig> = {}): World {
  return createWorld({
    width: W,
    height: H,
    ship: 'retro',
    levels: createUpgradeLevels(),
    seed: 4242,
    ...overrides,
  });
}

/**
 * An arena the test fully controls: nothing on screen, and — crucially — no
 * wave-clear bonus firing mid-assertion. A spawn scheduled far in the future
 * keeps the wave "running" without putting anything in the arena; call
 * `finishWave()` when the test wants the wave to be able to complete.
 */
function emptyWorld(overrides: Partial<WorldConfig> = {}): World {
  const world = makeWorld(overrides);
  world.enemies = [];
  world.bullets = [];
  world.pickups = [];
  world.pending = [
    { atMs: world.timeMs + 1_000_000_000, kind: 'debris', pattern: 'drift', side: 'center' },
  ];
  return world;
}

/** Let the arena's wave complete (clears the placeholder spawn). */
function finishWave(world: World): void {
  world.pending = [];
}

function run(world: World, steps: number, input: RunInput = IDLE, ms = 16): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let i = 0; i < steps; i++) events.push(...stepWorld(world, ms, input));
  return events;
}

const player = (world: World): Player => world.player;

describe('createWorld', () => {
  it('starts the player low and centred, at full hull', () => {
    const world = makeWorld();
    const p = player(world);
    expect(p.x).toBeCloseTo(W / 2);
    expect(p.y).toBeCloseTo(H * 0.82);
    expect(p.hull).toBe(p.maxHull);
    expect(p.hull).toBeGreaterThan(0);
  });

  it('drops straight into wave 1 with a schedule', () => {
    const world = makeWorld();
    expect(world.wave).toBe(1);
    expect(world.status).toBe('running');
    expect(world.pending.length).toBeGreaterThan(0);
  });

  it('honours the chosen ship', () => {
    const hauler = makeWorld({ ship: 'hauler' });
    const scout = makeWorld({ ship: 'scout' });
    expect(hauler.player.maxHull).toBeGreaterThan(scout.player.maxHull);
    expect(hauler.player.sprite).toBe('lifter-rocket-1');
    expect(scout.player.sprite).toBe('probe-rocket-1');
  });
});

describe('movement', () => {
  it('moves the ship in the input direction', () => {
    const world = emptyWorld();
    const startX = player(world).x;
    run(world, 20, RIGHT);
    expect(player(world).x).toBeGreaterThan(startX);
    expect(player(world).vx).toBeGreaterThan(0);
  });

  it('never lets the ship leave the arena', () => {
    const world = emptyWorld();
    run(world, 400, RIGHT);
    expect(player(world).x).toBeLessThanOrEqual(W - player(world).radius + 0.001);

    run(world, 400, { moveX: -1, moveY: -1, firing: false });
    expect(player(world).x).toBeGreaterThanOrEqual(player(world).radius - 0.001);
    expect(player(world).y).toBeGreaterThanOrEqual(player(world).radius - 0.001);
  });

  it('gives the ship weight instead of snapping to input', () => {
    const world = emptyWorld();
    stepWorld(world, 16, RIGHT);
    // One 16ms frame at 9/s acceleration is well below the target speed.
    const target = world.derived.speed * H;
    expect(player(world).vx).toBeGreaterThan(0);
    expect(player(world).vx).toBeLessThan(target * 0.5);
  });
});

describe('shooting', () => {
  it('fires upward and stops when the trigger is released', () => {
    const world = emptyWorld();
    const events = run(world, 1, FIRE);
    expect(events.some((e) => e.type === 'shot')).toBe(true);
    expect(world.bullets.length).toBeGreaterThan(0);
    expect(world.bullets.every((b) => b.vy < 0 && b.from === 'player')).toBe(true);

    world.bullets = [];
    run(world, 60, IDLE);
    expect(world.bullets).toHaveLength(0);
  });

  it('respects the fire-rate cooldown', () => {
    const world = emptyWorld();
    run(world, 60, FIRE, 16); // 960ms
    const expected = Math.ceil(960 / world.derived.fireMs) + 1;
    expect(world.stats.shotsFired).toBeLessThanOrEqual(expected);
    expect(world.stats.shotsFired).toBeGreaterThan(1);
  });

  it('adds barrels with the weapon upgrade', () => {
    const levels = { ...createUpgradeLevels(), weapon: 2 };
    const world = emptyWorld({ levels });
    stepWorld(world, 16, FIRE);
    expect(world.stats.shotsFired).toBe(3);
    expect(world.bullets).toHaveLength(3);
  });

  it('caps the simulated step so a stalled tab cannot tunnel shots through enemies', () => {
    const world = emptyWorld();
    stepWorld(world, 16, FIRE);
    const bullet = world.bullets[0];
    const before = bullet.y;
    // A 5-second frame gap must be clamped, not simulated in one leap.
    stepWorld(world, 5000, IDLE);
    const travelled = before - bullet.y;
    const maxTravel = TUNING.playerBulletSpeed * H * (MAX_STEP_MS / 1000);
    expect(travelled).toBeLessThanOrEqual(maxTravel + 0.001);
  });
});

describe('combat', () => {
  it('damages and then destroys an enemy, scoring for it', () => {
    const world = emptyWorld();
    spawnEnemyAt(world, 'asteroid', W / 2, 250);
    expect(world.enemies).toHaveLength(1);
    const startScore = world.score;

    // Step until it dies rather than a fixed count, so the death effect is
    // still alive when we assert on it (effects age out in ~300ms).
    const events: WorldEvent[] = [];
    let steps = 0;
    while (world.enemies.length && steps < 120) {
      events.push(...stepWorld(world, 16, FIRE));
      steps += 1;
    }

    expect(world.enemies).toHaveLength(0);
    expect(world.stats.kills).toBe(1);
    expect(world.score).toBeGreaterThan(startScore);
    expect(events.some((e) => e.type === 'kill-enemy')).toBe(true);
    expect(world.effects.length).toBeGreaterThan(0);
  });

  it('counts hits, so accuracy can be shown at the end', () => {
    const world = emptyWorld();
    spawnEnemyAt(world, 'gunship', W / 2, 200); // tanky: survives several hits
    run(world, 60, FIRE);
    expect(world.stats.shotsHit).toBeGreaterThan(0);
    expect(world.stats.shotsHit).toBeLessThanOrEqual(world.stats.shotsFired);
  });

  it('speeds up with a damage upgrade', () => {
    const plain = emptyWorld();
    const strong = emptyWorld({ levels: { ...createUpgradeLevels(), damage: 5 } });
    spawnEnemyAt(plain, 'gunship', W / 2, 200);
    spawnEnemyAt(strong, 'gunship', W / 2, 200);
    run(plain, 40, FIRE);
    run(strong, 40, FIRE);
    expect(strong.enemies[0].hull).toBeLessThan(plain.enemies[0].hull);
  });

  it('removes enemies that drift off the bottom without scoring', () => {
    const world = emptyWorld();
    const debris = spawnEnemyAt(world, 'debris', 200, H - 10);
    const startScore = world.score;
    run(world, 200, IDLE);
    expect(world.enemies.find((e) => e.id === debris.id)).toBeUndefined();
    expect(world.score).toBe(startScore);
  });
});

describe('taking damage', () => {
  /** A single enemy bullet parked on the player. */
  function bulletOnPlayer(world: World, damage = 1): void {
    world.bullets.push({
      id: world.nextId++,
      x: world.player.x,
      y: world.player.y,
      vx: 0,
      vy: 0,
      radius: TUNING.enemyBulletRadius,
      damage,
      from: 'enemy',
      sprite: 'power-bolt-yellow',
      ttlMs: 5000,
    });
  }

  it('spends a shield before it touches the hull', () => {
    const world = emptyWorld({ levels: { ...createUpgradeLevels(), shield: 2 } });
    expect(world.player.shield).toBe(2);
    const hull = world.player.hull;

    const events = run(world, 1, IDLE);
    bulletOnPlayer(world);
    const more = run(world, 1, IDLE);

    expect(world.player.shield).toBe(1);
    expect(world.player.hull).toBe(hull);
    expect([...events, ...more].some((e) => e.type === 'player-shielded')).toBe(true);
  });

  it('costs exactly one hull per hit, no matter how many bullets land at once', () => {
    const world = emptyWorld();
    const hull = world.player.hull;
    bulletOnPlayer(world);
    bulletOnPlayer(world);
    bulletOnPlayer(world);
    run(world, 1, IDLE);
    // Invulnerability frames must absorb the rest of the volley.
    expect(world.player.hull).toBe(hull - 1);
  });

  it('lets a boss shell hurt more than a stray mine', () => {
    const world = emptyWorld();
    const hull = world.player.hull;
    bulletOnPlayer(world, 2);
    run(world, 1, IDLE);
    expect(world.player.hull).toBe(hull - 2);
  });

  it('is briefly invulnerable after a hit, then vulnerable again', () => {
    const world = emptyWorld();
    bulletOnPlayer(world);
    run(world, 1, IDLE);
    const afterFirst = world.player.hull;

    bulletOnPlayer(world);
    run(world, 5, IDLE); // still inside the invulnerability window
    expect(world.player.hull).toBe(afterFirst);

    run(world, Math.ceil(TUNING.invulnMs / 16) + 4, IDLE);
    bulletOnPlayer(world);
    run(world, 1, IDLE);
    expect(world.player.hull).toBe(afterFirst - 1);
  });

  it('brings shields back after a quiet spell', () => {
    const world = emptyWorld({ levels: { ...createUpgradeLevels(), shield: 1 } });
    world.player.shield = 0;
    // No hits for longer than the regen delay + one regen tick.
    run(world, Math.ceil((TUNING.shieldRegenDelayMs + TUNING.shieldRegenMs) / 16) + 4, IDLE);
    expect(world.player.shield).toBe(1);
  });

  it('ends the run when the hull is gone', () => {
    const world = emptyWorld();
    world.player.hull = 1;
    bulletOnPlayer(world);
    const events = run(world, 1, IDLE);

    expect(world.status).toBe('dead');
    expect(world.player.hull).toBe(0);
    expect(events.some((e) => e.type === 'died')).toBe(true);
    // A dead world must stop simulating.
    const snapshot = world.timeMs;
    run(world, 10, IDLE);
    expect(world.timeMs).toBe(snapshot);
  });
});

describe('waves', () => {
  it('clears when the arena empties, paying a bonus once', () => {
    const world = emptyWorld();
    finishWave(world);
    const bonus = waveClearBonus(1);
    const coins = world.coins;
    const score = world.score;

    const events = run(world, 1, IDLE);

    expect(world.status).toBe('wave-clear');
    const cleared = events.find((e) => e.type === 'wave-clear');
    expect(cleared).toBeDefined();
    // The bonus has to travel on the event: the renderer banks it from there.
    expect(cleared).toMatchObject({ wave: 1, coins: bonus.coins });
    expect(world.coins).toBe(coins + bonus.coins);
    expect(world.score).toBeGreaterThanOrEqual(score + bonus.score);

    // Further steps must not pay the bonus again.
    const coinsAfter = world.coins;
    run(world, 30, IDLE);
    expect(world.coins).toBe(coinsAfter);
  });

  it('does not clear while enemies or spawns remain', () => {
    const world = emptyWorld();
    world.pending = [{ atMs: world.timeMs + 5000, kind: 'debris', pattern: 'drift', side: 'left' }];
    run(world, 40, IDLE);
    expect(world.status).toBe('running');
  });

  it('advances to the next wave with a fresh schedule', () => {
    const world = emptyWorld();
    finishWave(world);
    run(world, 1, IDLE);
    expect(world.status).toBe('wave-clear');

    const plan = startWave(world, 2);
    expect(world.wave).toBe(2);
    expect(world.status).toBe('running');
    expect(world.pending.length).toBe(plan.spawns.length);
    expect(world.bullets).toHaveLength(0);
  });

  it('sends a boss on a boss wave and keeps it alive until it dies', () => {
    const world = emptyWorld({ levels: { ...createUpgradeLevels(), damage: 5, weapon: 2 } });
    startWave(world, TUNING.bossEvery);
    run(world, 120, IDLE); // past the 900ms boss entrance

    const boss = currentBoss(world);
    expect(boss).toBeDefined();
    expect(world.bossAlive).toBe(true);
    expect(boss?.radius).toBeGreaterThan(60);
  });
});

describe('pickups', () => {
  it('banks a coin, scaled by the luck upgrade', () => {
    const world = emptyWorld({ levels: { ...createUpgradeLevels(), luck: 3 } });
    const before = world.coins;
    spawnPickupAt(world, 'coin', world.player.x, world.player.y, 4);
    run(world, 1, IDLE);

    const multiplier = world.derived.coinMultiplier;
    expect(multiplier).toBeGreaterThan(1);
    expect(world.coins).toBe(before + Math.round(4 * multiplier));
    expect(world.stats.coinsCollected).toBeGreaterThan(0);
  });

  it('repairs the hull, and pays score instead when already full', () => {
    const hurt = emptyWorld();
    hurt.player.hull = 1;
    spawnPickupAt(hurt, 'repair', hurt.player.x, hurt.player.y);
    run(hurt, 1, IDLE);
    expect(hurt.player.hull).toBe(2);

    const full = emptyWorld();
    const score = full.score;
    spawnPickupAt(full, 'repair', full.player.x, full.player.y);
    run(full, 1, IDLE);
    expect(full.player.hull).toBe(full.player.maxHull);
    expect(full.score).toBeGreaterThan(score);
  });

  it('pulls loot in with the magnet upgrade', () => {
    const world = emptyWorld({ levels: { ...createUpgradeLevels(), magnet: 3 } });
    // Just outside the base radius but inside the upgraded one.
    const distance = TUNING.baseMagnetRadius * 1.6;
    const coin = spawnPickupAt(world, 'coin', world.player.x + distance, world.player.y);
    const startX = coin.x;
    run(world, 12, IDLE);
    expect(coin.x).toBeLessThan(startX);
  });

  it('does not collect loot that stays out of reach', () => {
    const world = emptyWorld();
    const before = world.coins;
    spawnPickupAt(world, 'coin', world.player.x + 400, world.player.y - 200);
    run(world, 20, IDLE);
    expect(world.coins).toBe(before);
  });
});

describe('upgrades mid-run', () => {
  it('grants the new hull immediately', () => {
    const world = emptyWorld();
    const before = world.player.maxHull;
    applyUpgrades(world, { ...createUpgradeLevels(), hull: 3 });
    expect(world.player.maxHull).toBe(before + 3);
    expect(world.player.hull).toBe(before + 3);
    expect(world.levels.hull).toBe(3);
  });

  it('does not heal damage already taken', () => {
    const world = emptyWorld();
    world.player.hull = 1;
    applyUpgrades(world, { ...createUpgradeLevels(), hull: 2 });
    expect(world.player.hull).toBe(3); // 1 + the 2 granted
  });

  it('raises the shield ceiling and grants the new shields', () => {
    const world = emptyWorld();
    applyUpgrades(world, { ...createUpgradeLevels(), shield: 2 });
    expect(world.player.maxShield).toBe(2);
    expect(world.player.shield).toBe(2);
  });

  it('takes effect on the very next shot', () => {
    const world = emptyWorld();
    spawnEnemyAt(world, 'gunship', W / 2, 200);
    applyUpgrades(world, { ...createUpgradeLevels(), damage: 5 });
    run(world, 30, FIRE);
    const withUpgrade = world.enemies[0].hull;

    const base = emptyWorld();
    spawnEnemyAt(base, 'gunship', W / 2, 200);
    run(base, 30, FIRE);
    expect(withUpgrade).toBeLessThan(base.enemies[0].hull);
  });
});

describe('determinism and resizing', () => {
  it('produces identical runs from the same seed', () => {
    const a = makeWorld({ seed: 777 });
    const b = makeWorld({ seed: 777 });

    run(a, 240, FIRE);
    run(b, 240, FIRE);

    expect(a.score).toBe(b.score);
    expect(a.stats.kills).toBe(b.stats.kills);
    expect(a.enemies.map((e: Enemy) => e.sprite)).toEqual(b.enemies.map((e: Enemy) => e.sprite));
  });

  it('diverges with a different seed', () => {
    const a = makeWorld({ seed: 1 });
    const b = makeWorld({ seed: 2 });
    run(a, 240, FIRE);
    run(b, 240, FIRE);
    expect(a.enemies.length !== b.enemies.length || a.score !== b.score).toBe(true);
  });

  it('keeps the ship inside the arena when the canvas changes size', () => {
    const world = emptyWorld();
    world.player.x = 1200;
    world.player.y = 700;
    resizeWorld(world, 800, 600);
    expect(world.width).toBe(800);
    expect(world.height).toBe(600);
    expect(world.player.x).toBeLessThanOrEqual(800 - world.player.radius);
    expect(world.player.y).toBeLessThanOrEqual(600 - world.player.radius);
  });

  it('ignores a zero or negative frame time', () => {
    const world = emptyWorld();
    const before = world.timeMs;
    expect(stepWorld(world, 0, IDLE)).toEqual([]);
    expect(stepWorld(world, -50, IDLE)).toEqual([]);
    expect(world.timeMs).toBe(before);
  });

  it('tracks the pickups it hands out', () => {
    const world = emptyWorld();
    const pickup = spawnPickupAt(world, 'gem', 100, 100);
    expect(world.pickups.map((p: Pickup) => p.id)).toContain(pickup.id);
  });
});
