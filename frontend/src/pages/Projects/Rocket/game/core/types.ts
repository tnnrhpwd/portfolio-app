/**
 * Rocket — simulation types.
 *
 * Nothing in `core/` imports Phaser. The whole game loop lives here as plain
 * data + pure functions, which is what lets it be unit-tested without a canvas
 * (and why `PlayScene` is only a renderer + input adapter).
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Playable ships. Each maps to one of the rocket sprites from the sheet. */
export type ShipKey = 'scout' | 'hauler' | 'retro';

export interface ShipDef {
  key: ShipKey;
  name: string;
  /** Short line shown on the ship-select screen. */
  blurb: string;
  /** Texture key suffix from the asset manifest (e.g. 'probe-rocket-1'). */
  sprite: string;
  /** Hull points before upgrades. */
  hull: number;
  /** Movement speed multiplier before upgrades. */
  speed: number;
  /** Weapon damage multiplier before upgrades. */
  damage: number;
  /** Fire-rate multiplier before upgrades (higher = faster). */
  fireRate: number;
  /** Cost in coins to unlock. 0 = available from the start. */
  cost: number;
}

export type EnemyKind = 'debris' | 'asteroid' | 'mine' | 'drone' | 'gunship' | 'boss';

/**
 * Movement shape. Kept as data (not a function) so a wave is fully described by
 * serialisable values and can be asserted in tests.
 */
export type EnemyPattern = 'drift' | 'weave' | 'strafe' | 'rush' | 'hover';

export interface EnemyDef {
  kind: EnemyKind;
  /** Hull points at wave 1; scaled by `hpGrowth` per wave. */
  hp: number;
  /** Collision radius in world units. */
  radius: number;
  /** Downward speed as a fraction of world height per second. */
  speed: number;
  /** Score awarded on kill. */
  score: number;
  /** Coins dropped on kill (before luck). */
  coins: number;
  /** Minimum ms between shots; 0 = cannot shoot. */
  fireMs: number;
  /** Damage per shot. */
  shotDamage: number;
  /** Sprite names to pick from at spawn. */
  sprites: string[];
  /** Explosion animation to play on death. */
  deathEffect: EffectKind;
}

/** Visual effects the renderer knows how to play. */
export type EffectKind = 'explosion' | 'explosion-small' | 'shield-hit' | 'spark' | 'smoke';

export type PickupKind = 'coin' | 'gem' | 'shield' | 'repair';

export interface PickupDef {
  kind: PickupKind;
  value: number;
  radius: number;
  sprites: string[];
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

export type UpgradeKey =
  | 'weapon'
  | 'damage'
  | 'fireRate'
  | 'hull'
  | 'shield'
  | 'speed'
  | 'magnet'
  | 'luck';

export interface UpgradeDef {
  key: UpgradeKey;
  name: string;
  /** One line explaining what the next level buys. */
  blurb: string;
  /** Maximum purchasable level. */
  maxLevel: number;
  /** Cost of level n (1-indexed), in coins. */
  cost: (level: number) => number;
  /** Icon sprite from the manifest. */
  sprite: string;
}

/** Purchased levels, one entry per upgrade. */
export type UpgradeLevels = Record<UpgradeKey, number>;

/** The numbers the simulation actually runs on, after ship + upgrades. */
export interface DerivedStats {
  damage: number;
  /** ms between shots. */
  fireMs: number;
  /** Number of parallel bullets. */
  barrels: number;
  maxHull: number;
  maxShield: number;
  /** World units per second at full input. */
  speed: number;
  /** Pickups inside this radius are pulled toward the ship. */
  magnetRadius: number;
  /** Multiplier on coin drops. */
  coinMultiplier: number;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  /** Ms of invulnerability remaining after a hit. */
  invulnMs: number;
  /** Ms until the next shot is allowed. */
  cooldownMs: number;
  ship: ShipKey;
  sprite: string;
}

export interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  from: 'player' | 'enemy';
  sprite: string;
  /** Ms before it is culled even if it never leaves the screen. */
  ttlMs: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  /** Index into the wave's spawn table — used to keep bosses unique. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hull: number;
  maxHull: number;
  score: number;
  coins: number;
  fireMs: number;
  cooldownMs: number;
  pattern: EnemyPattern;
  /** Seconds alive — drives the movement pattern. */
  age: number;
  /** Anchor used by 'hover'/'weave' so they don't drift off-screen. */
  anchorX: number;
  /** Y a 'hover' enemy settles at. */
  anchorY: number;
  sprite: string;
  shotDamage: number;
  /** Boss health bar + heavier effects. */
  boss: boolean;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  value: number;
  sprite: string;
}

export interface Effect {
  id: number;
  kind: EffectKind;
  x: number;
  y: number;
  ageMs: number;
  ttlMs: number;
  scale: number;
  /** Sprite frames, played back over `ttlMs`. */
  frames: string[];
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface RunInput {
  /** -1..1, right positive. */
  moveX: number;
  /** -1..1, down positive. */
  moveY: number;
  firing: boolean;
}

/**
 * Events emitted by a single `stepWorld` call. The renderer turns these into
 * sound, screen shake and announcements; the simulation never touches audio or
 * the DOM itself.
 */
export type WorldEvent =
  | { type: 'shot' }
  | { type: 'enemy-shot' }
  | { type: 'hit-enemy'; x: number; y: number }
  | { type: 'kill-enemy'; x: number; y: number; kind: EnemyKind; boss: boolean }
  | { type: 'shield-hit'; x: number; y: number }
  | { type: 'player-hit'; hull: number }
  | { type: 'player-shielded' }
  | { type: 'pickup'; kind: PickupKind; value: number }
  | { type: 'wave-clear'; wave: number; coins: number }
  | { type: 'died' };

export interface RunStats {
  shotsFired: number;
  shotsHit: number;
  kills: number;
  coinsCollected: number;
  msAlive: number;
}

export type WorldStatus = 'running' | 'wave-clear' | 'dead';

export interface World {
  width: number;
  height: number;
  /** Total elapsed match time. */
  timeMs: number;
  status: WorldStatus;
  wave: number;
  score: number;
  /** Coins banked this run (added to the save when the run ends). */
  coins: number;
  player: Player;
  bullets: Bullet[];
  enemies: Enemy[];
  pickups: Pickup[];
  effects: Effect[];
  stats: RunStats;
  /** Remaining ms of the current wave before it counts as cleared. */
  waveRemainingMs: number;
  /** Queue of wave spawns not yet released. */
  pending: PendingSpawn[];
  /** RNG state (explicit so a run is reproducible from a seed). */
  rng: RngState;
  bossAlive: boolean;
  nextId: number;
  /** Ms since the player was last hurt — drives shield regeneration. */
  msSinceHit: number;
  /** Countdown to the next regenerated shield. */
  shieldRegenMs: number;
  /** Upgrade levels this run is using. */
  levels: UpgradeLevels;
  /** Cached derived stats, recomputed by `applyUpgrades` — never per frame. */
  derived: DerivedStats;
}

/** A spawn scheduled by the wave generator. */
export interface PendingSpawn {
  atMs: number;
  kind: EnemyKind;
  pattern: EnemyPattern;
  side: 'left' | 'center' | 'right' | 'random';
}

export interface RngState {
  s: number;
}
