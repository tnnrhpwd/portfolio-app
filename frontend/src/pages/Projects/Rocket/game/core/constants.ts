/**
 * Rocket — tuning constants.
 *
 * Sizes and speeds are expressed relative to the world height, because the
 * canvas fills its container (any aspect, any device). A hard-coded px/s would
 * make the game trivial on a big monitor and impossible on a phone; a fraction
 * of the height keeps the *feel* identical everywhere.
 *
 * `DESIGN_HEIGHT` is the reference used when a number genuinely has to be
 * absolute (font sizes, effect scale).
 */

export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 720;

export const TUNING = {
  // Player ------------------------------------------------------------------
  playerRadius: 24,
  /** Fraction of world height per second at full input. */
  playerSpeed: 0.62,
  /** How quickly velocity chases the input (per second). Higher = snappier. */
  playerAccel: 9,
  playerHull: 3,
  /** Ms of invulnerability after taking a hit. */
  invulnMs: 1300,
  fireMs: 190,
  playerDamage: 10,
  /** Fraction of world height per second. */
  playerBulletSpeed: 1.15,
  playerBulletRadius: 9,
  /**
   * How far a bullet may travel before it is culled. Generous, because the
   * whole point of an upgrade is that shots reach the top of the screen.
   */
  playerBulletTtlMs: 2600,

  // Enemy ------------------------------------------------------------------
  enemyBulletSpeed: 0.46,
  enemyBulletRadius: 11,
  enemyBulletTtlMs: 6000,
  /** Hull growth per wave: hp * (1 + growth * (wave - 1)). */
  enemyHpGrowth: 0.19,
  /** Speed growth per wave, capped so late waves stay readable. */
  enemySpeedGrowth: 0.035,
  maxSpeedMultiplier: 1.5,

  // Shield -----------------------------------------------------------------
  /** Ms without being hit before shields start coming back. */
  shieldRegenDelayMs: 4200,
  shieldRegenMs: 2400,

  // Pickups ----------------------------------------------------------------
  baseMagnetRadius: 74,
  /** Chance an enemy drops a coin. */
  coinDropChance: 0.34,
  /** Chance an enemy drops a gem instead of a coin. */
  gemDropChance: 0.06,
  /** Chance an enemy drops a shield/repair pickup. */
  utilityDropChance: 0.045,
  pickupFallSpeed: 0.16,
  pickupTtlMs: 12000,

  // Waves ------------------------------------------------------------------
  waveBaseMs: 17000,
  wavePerWaveMs: 1500,
  waveMaxMs: 42000,
  /** First wave that can contain each enemy kind. */
  unlockWave: {
    debris: 1,
    asteroid: 2,
    mine: 3,
    drone: 4,
    gunship: 6,
  },
  /** Every Nth wave is a boss. */
  bossEvery: 5,

  // Effects ----------------------------------------------------------------
  explosionMs: 420,
  smallExplosionMs: 300,
  shieldHitMs: 260,
  sparkMs: 220,
  shakeOnPlayerHit: 0.012,
  shakeOnBossKill: 0.02,

  // Scoring ----------------------------------------------------------------
  /** Bonus coins for clearing a wave. */
  waveClearCoins: 3,
} as const;

/**
 * The score/coin value of a wave, used for the "wave cleared" reward.
 */
export function waveClearBonus(wave: number): { score: number; coins: number } {
  return {
    score: 100 * wave,
    coins: TUNING.waveClearCoins + Math.floor(wave / 3),
  };
}
