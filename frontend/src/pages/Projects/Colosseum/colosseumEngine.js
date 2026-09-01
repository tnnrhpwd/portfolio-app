/**
 * Colosseum — pure game logic for a gladiator-management game.
 *
 * This module contains NO React/DOM code and NO I/O, so every function is
 * deterministic and unit-testable. Randomness is injected via an optional
 * `rand` argument (defaults to Math.random) so tests can pin it.
 *
 * The game is an ORIGINAL implementation of the well-worn "manage a stable of
 * gladiators and fight arena battles" genre. All names, text, numbers, and
 * code here are our own — nothing is copied from any commercial game.
 */

// ── Tunables ───────────────────────────────────────────────────────────────
export const MAX_ROSTER = 3;
export const START_GOLD = 120;
export const START_FAME = 0;

// ── Gladiator classes (real historical types; stats are our own) ──────────
export const CLASSES = {
  murmillo: {
    label: 'Murmillo',
    blurb: 'Balanced sword-and-shield fighter.',
    base: { maxHp: 110, atk: 13, def: 9, spd: 10 },
    skill: {
      name: 'Shield Bash',
      desc: 'A heavy blow that also staggers the target, making it lose its next turn.',
      cooldown: 3,
      power: 1.6,
      effect: 'stun',
    },
  },
  retiarius: {
    label: 'Retiarius',
    blurb: 'Fast net-and-trident fighter in light armor.',
    base: { maxHp: 85, atk: 11, def: 4, spd: 17 },
    skill: {
      name: 'Net Toss',
      desc: 'Entangles the target, halving its speed for two rounds.',
      cooldown: 2,
      power: 0.9,
      effect: 'slow',
    },
  },
  thraex: {
    label: 'Thraex',
    blurb: 'Aggressive curved-sword fighter.',
    base: { maxHp: 95, atk: 16, def: 6, spd: 12 },
    skill: {
      name: 'Fury',
      desc: 'A reckless strike that deals huge damage but costs some of your own health.',
      cooldown: 2,
      power: 2.0,
      effect: 'selfDamage',
    },
  },
  secutor: {
    label: 'Secutor',
    blurb: 'Heavily armored fighter who relentlessly pursues.',
    base: { maxHp: 120, atk: 12, def: 11, spd: 8 },
    skill: {
      name: 'Pursuit',
      desc: 'Lashes out twice in quick succession.',
      cooldown: 3,
      power: 0.8,
      effect: 'double',
    },
  },
  hoplomachus: {
    label: 'Hoplomachus',
    blurb: 'Spear-and-shield fighter, extremely defensive.',
    base: { maxHp: 105, atk: 10, def: 14, spd: 9 },
    skill: {
      name: 'Spear Wall',
      desc: 'Strikes, then braces to return the next blow aimed at you.',
      cooldown: 3,
      power: 1.1,
      effect: 'counter',
    },
  },
};

export const CLASS_KEYS = Object.keys(CLASSES);

// ── Player-selectable actions ──────────────────────────────────────────────
export const ACTIONS = {
  strike: { label: 'Strike', desc: 'A reliable basic attack.', power: 1.0, hit: 1.0 },
  heavy: { label: 'Heavy', desc: 'High damage, lower accuracy.', power: 1.55, hit: 0.75 },
  defend: { label: 'Defend', desc: 'Halve incoming damage until your next turn.', power: 0, hit: 1.0 },
  skill: { label: 'Skill', desc: 'Use your class skill.', power: 0, hit: 1.0 },
  rest: { label: 'Rest', desc: 'Recover a little health.', power: 0, hit: 1.0 },
};

export const ACTION_KEYS = Object.keys(ACTIONS);

// ── Equipment ──────────────────────────────────────────────────────────────
export const WEAPON_TIERS = [
  { id: 'w0', label: 'Fists', atk: 0, cost: 0 },
  { id: 'w1', label: 'Bronze Blade', atk: 3, cost: 60 },
  { id: 'w2', label: 'Iron Gladius', atk: 6, cost: 140 },
  { id: 'w3', label: 'Steel Sword', atk: 10, cost: 300 },
  { id: 'w4', label: 'Mythril Edge', atk: 15, cost: 650 },
];

export const ARMOR_TIERS = [
  { id: 'a0', label: 'Tunic', def: 0, cost: 0 },
  { id: 'a1', label: 'Leather Harness', def: 2, cost: 50 },
  { id: 'a2', label: 'Chain Mail', def: 4, cost: 120 },
  { id: 'a3', label: 'Lorica Plates', def: 7, cost: 280 },
  { id: 'a4', label: 'Mythril Plate', def: 11, cost: 600 },
];

// ── Name pools (original, historically flavored) ───────────────────────────
export const NAME_POOL = [
  'Marcus', 'Lucius', 'Gaius', 'Titus', 'Decimus', 'Cassius', 'Flavius',
  'Maximus', 'Brutus', 'Varro', 'Cato', 'Draxus', 'Silvius', 'Marius',
  'Octavius', 'Petronius', 'Quintus', 'Rufus', 'Servius', 'Tiberius',
];

export const EPITHET_POOL = [
  'the Unbroken', 'the Lion', 'of the Sands', 'the Viper', 'Iron-Hand',
  'the Bull', 'Storm-Crowned', 'the Shadow', 'the Stone', 'Crow-Feeder',
];

// ── Small helpers ──────────────────────────────────────────────────────────
let uidCounter = 0;
export function uid(prefix = 'g') {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function pick(arr, rand = Math.random) {
  return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── Gladiator construction ─────────────────────────────────────────────────
export function makeGladiator(name, classKey, overrides = {}) {
  const resolvedClassKey = CLASSES[classKey] ? classKey : 'murmillo';
  const cls = CLASSES[resolvedClassKey];
  const base = cls.base;
  return {
    id: overrides.id || uid('glad'),
    name,
    classKey: resolvedClassKey,
    level: overrides.level || 1,
    xp: overrides.xp || 0,
    hp: overrides.hp !== undefined ? overrides.hp : base.maxHp,
    weaponId: overrides.weaponId || 'w0',
    armorId: overrides.armorId || 'a0',
    training: { hp: 0, atk: 0, def: 0 },
    skillCd: 0, // rounds until skill is ready; 0 = ready
    status: { stun: 0, slow: 0, defending: false, counter: false },
    ...overrides.training ? { training: { ...overrides.training } } : {},
  };
}

export function randomName(rand = Math.random) {
  return `${pick(NAME_POOL, rand)} ${pick(EPITHET_POOL, rand)}`;
}

// ── Stat computation ───────────────────────────────────────────────────────
export function weaponAtk(g) {
  const tier = WEAPON_TIERS.find((t) => t.id === g.weaponId) || WEAPON_TIERS[0];
  return tier.atk;
}

export function armorDef(g) {
  const tier = ARMOR_TIERS.find((t) => t.id === g.armorId) || ARMOR_TIERS[0];
  return tier.def;
}

export function effectiveStats(g) {
  const cls = CLASSES[g.classKey];
  const lvlMinus1 = (g.level || 1) - 1;
  const maxHp = cls.base.maxHp + lvlMinus1 * 8 + g.training.hp * 3;
  return {
    maxHp,
    atk: cls.base.atk + lvlMinus1 * 2 + g.training.atk + weaponAtk(g),
    def: cls.base.def + lvlMinus1 * 2 + g.training.def + armorDef(g),
    spd: cls.base.spd + lvlMinus1 * 0.5,
  };
}

export function isAlive(g) {
  return g && g.hp > 0;
}

export function teamAliveCount(team) {
  return team.filter(isAlive).length;
}

export function isTeamDefeated(team) {
  return team.length > 0 && teamAliveCount(team) === 0;
}

// ── XP & leveling ──────────────────────────────────────────────────────────
export function xpToNext(level) {
  return 50 + (level - 1) * 35;
}

/** Applies XP and returns a NEW gladiator (may level up multiple times). */
export function addXp(g, amount) {
  let xp = g.xp + amount;
  let level = g.level;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
  }
  return { ...g, xp, level };
}

// ── Training & equipment economy ───────────────────────────────────────────
export function trainCost(totalTrainedPoints) {
  return Math.round(22 * Math.pow(1.2, totalTrainedPoints));
}

export function totalTrained(g) {
  return g.training.hp + g.training.atk + g.training.def;
}

export function healCost(g) {
  const stats = effectiveStats(g);
  const missing = Math.max(0, stats.maxHp - g.hp);
  return Math.max(1, Math.ceil(missing * 0.5));
}

// ── Damage ─────────────────────────────────────────────────────────────────
/**
 * Computes the damage an attacker deals to a defender for a basic/attack roll.
 * `power` is the action multiplier; `accuracy` is the hit chance.
 * Returns { hit, damage, crit }.
 */
export function computeDamage(attacker, defender, power, accuracy, rand = Math.random) {
  const roll = rand();
  if (roll > accuracy) {
    return { hit: false, damage: 0, crit: false };
  }
  const aStats = effectiveStats(attacker);
  const dStats = effectiveStats(defender);
  const variance = 0.85 + rand() * 0.3; // 0.85 .. 1.15
  const crit = rand() < 0.08;
  const critMult = crit ? 1.6 : 1.0;
  const raw = aStats.atk * power * (1 + attacker.level * 0.02) * variance * critMult;
  const mitigation = 100 / (100 + dStats.def * 3.2);
  const damage = Math.max(1, Math.round(raw * mitigation));
  return { hit: true, damage, crit };
}

function applyDefenderReduction(damage, defender) {
  return Math.round(defender.status.defending ? damage * 0.5 : damage);
}

// ── Round resolution ───────────────────────────────────────────────────────
/**
 * Resolves one round of combat.
 *
 * @param {Array} playerTeam  - player gladiators (will be cloned).
 * @param {Array} enemyTeam   - enemy gladiators (will be cloned).
 * @param {Object} playerActions - map of gladiatorId -> { action, targetId }.
 * @param {number} arenaPower - used to scale enemy AI choices (unused for now).
 * @param {Function} rand     - RNG (defaults to Math.random).
 * @returns {{ playerTeam, enemyTeam, log: string[], events: object[], playerWon, enemyWon }}
 */
export function resolveRound(playerTeam, enemyTeam, playerActions, arenaPower = 1, rand = Math.random) {
  const players = playerTeam.map((g) => cloneFighter(g));
  const enemies = enemyTeam.map((g) => cloneFighter(g));

  const log = [];
  const events = [];
  const targets = { player: players, enemy: enemies };

  // Build actor list with their chosen actions.
  const actors = [];

  players.forEach((g) => {
    if (!isAlive(g)) return;
    const choice = playerActions[g.id] || { action: 'strike', targetId: null };
    actors.push({ fighter: g, side: 'player', action: choice.action, targetId: choice.targetId });
  });

  enemies.forEach((g) => {
    if (!isAlive(g)) return;
    const ai = chooseEnemyAction(g, enemies, players, rand);
    actors.push({ fighter: g, side: 'enemy', action: ai.action, targetId: ai.targetId });
  });

  // Resolve in speed order (slow status halves speed).
  actors.sort((a, b) => speedOf(b.fighter) - speedOf(a.fighter));

  actors.forEach(({ fighter, side, action, targetId }) => {
    if (!isAlive(fighter)) return;
    if (fighter.status.stun > 0) {
      fighter.status.stun -= 1;
      log.push(`${fighter.name} is staggered and loses a turn.`);
      events.push({ kind: 'stun', targetId: fighter.id, targetSide: side });
      return;
    }
    const enemySide = side === 'player' ? 'enemy' : 'player';
    const pool = targets[enemySide].filter(isAlive);
    if (pool.length === 0) return;

    performAction(fighter, action, targetId, pool, side, log, events, rand);
  });

  // End-of-round upkeep.
  [...players, ...enemies].forEach((g) => {
    g.skillCd = Math.max(0, g.skillCd - 1);
    if (g.status.slow > 0) g.status.slow -= 1;
    g.status.defending = false;
    g.status.counter = false;
  });

  const playerWon = isTeamDefeated(enemies);
  const enemyWon = isTeamDefeated(players);

  return { playerTeam: players, enemyTeam: enemies, log, events, playerWon, enemyWon };
}

function cloneFighter(g) {
  return { ...g, status: { ...g.status } };
}

function speedOf(g) {
  const base = effectiveStats(g).spd;
  return g.status.slow > 0 ? base * 0.5 : base;
}

function chooseEnemyAction(self, allEnemies, players, rand) {
  const alivePlayers = players.filter(isAlive);
  const targetId = alivePlayers.length ? pick(alivePlayers, rand).id : null;
  const skillReady = self.skillCd <= 0;

  const roll = rand();
  if (skillReady && roll < 0.22) return { action: 'skill', targetId };
  if (roll < 0.6) return { action: 'strike', targetId };
  if (roll < 0.8) return { action: 'heavy', targetId };
  return { action: 'defend', targetId: null };
}

function performAction(fighter, action, targetId, pool, side, log, events, rand) {
  const stats = effectiveStats(fighter);
  const targetSide = side === 'player' ? 'enemy' : 'player';

  switch (action) {
    case 'strike': {
      const target = findTarget(targetId, pool);
      if (!target) return;
      const { hit, damage, crit } = computeDamage(fighter, target, 1.0, 0.95, rand);
      applyAttack(fighter, side, target, targetSide, hit, damage, crit, 'strike', log, events, rand);
      break;
    }
    case 'heavy': {
      const target = findTarget(targetId, pool);
      if (!target) return;
      const { hit, damage, crit } = computeDamage(fighter, target, 1.55, 0.75, rand);
      if (!hit) {
        log.push(`${fighter.name} winds up a heavy blow and misses ${target.name}.`);
        events.push({ kind: 'attack', label: 'heavy', actorId: fighter.id, actorSide: side, targetId: target.id, targetSide, damage: 0, crit: false, miss: true });
      } else {
        applyAttack(fighter, side, target, targetSide, true, damage, crit, 'heavy', log, events, rand);
      }
      break;
    }
    case 'defend': {
      fighter.status.defending = true;
      log.push(`${fighter.name} raises a guard, bracing for the next blow.`);
      events.push({ kind: 'defend', actorId: fighter.id, actorSide: side });
      break;
    }
    case 'rest': {
      const heal = Math.round(stats.maxHp * 0.08);
      const before = fighter.hp;
      fighter.hp = Math.min(stats.maxHp, fighter.hp + heal);
      const healed = fighter.hp - before;
      log.push(`${fighter.name} catches a breath and recovers ${healed} health.`);
      events.push({ kind: 'rest', actorId: fighter.id, actorSide: side, healed });
      break;
    }
    case 'skill': {
      useSkill(fighter, targetId, pool, side, targetSide, log, events, rand);
      break;
    }
    default:
      break;
  }
}

function findTarget(targetId, pool) {
  if (targetId) {
    const found = pool.find((g) => g.id === targetId && isAlive(g));
    if (found) return found;
  }
  return pool.find(isAlive) || null;
}

function applyAttack(attacker, attackerSide, target, targetSide, hit, damage, crit, label, log, events, rand) {
  if (!hit || !isAlive(target)) return;
  let finalDamage = damage;
  let reflected = 0;

  if (target.status.counter && isAlive(attacker)) {
    reflected = Math.max(1, Math.round(finalDamage * 0.5));
    applyDamage(attacker, reflected, attackerSide, log, events, `${target.name} braces and turns the blow back on ${attacker.name}`);
    events.push({ kind: 'reflect', actorId: target.id, actorSide: targetSide, targetId: attacker.id, targetSide: attackerSide, damage: reflected });
  }

  finalDamage = applyDefenderReduction(finalDamage, target);
  applyDamage(target, finalDamage, targetSide, log, events, null);

  const critLabel = crit ? ' — a critical hit!' : '';
  if (reflected === 0) {
    log.push(`${attacker.name} hits ${target.name} for ${finalDamage} damage${critLabel}.`);
  }
  events.push({
    kind: 'attack',
    label,
    actorId: attacker.id,
    actorSide: attackerSide,
    targetId: target.id,
    targetSide,
    damage: finalDamage,
    crit,
    miss: false,
  });
}

function applyDamage(target, amount, targetSide, log, events, overrideLine) {
  target.hp = Math.max(0, target.hp - amount);
  if (overrideLine) {
    log.push(`${overrideLine} for ${amount} damage.`);
  } else if (target.hp <= 0) {
    log.push(`${target.name} falls!`);
  }
  if (target.hp <= 0) {
    events.push({ kind: 'death', targetId: target.id, targetSide });
  }
}

function useSkill(fighter, targetId, pool, side, targetSide, log, events, rand) {
  const cls = CLASSES[fighter.classKey];
  const skill = cls.skill;
  if (fighter.skillCd > 0) {
    // Shouldn't happen (UI gates it), but be safe: fall back to a strike.
    const target = findTarget(targetId, pool);
    if (target) {
      const { hit, damage, crit } = computeDamage(fighter, target, 1.0, 0.95, rand);
      applyAttack(fighter, side, target, targetSide, hit, damage, crit, 'strike', log, events, rand);
    }
    return;
  }

  const target = findTarget(targetId, pool);
  fighter.skillCd = skill.cooldown;
  log.push(`${fighter.name} uses ${skill.name}!`);
  events.push({ kind: 'skill', actorId: fighter.id, actorSide: side, name: skill.name, targetId: target ? target.id : null, targetSide, effect: skill.effect });

  switch (skill.effect) {
    case 'stun': {
      if (target) {
        const { hit, damage, crit } = computeDamage(fighter, target, skill.power, 0.9, rand);
        if (hit) {
          target.status.stun = 1;
          applyAttack(fighter, side, target, targetSide, true, damage, crit, 'skill', log, events, rand);
          events.push({ kind: 'stun', targetId: target.id, targetSide });
        } else {
          log.push(`${fighter.name} misses ${target.name} with ${skill.name}.`);
          events.push({ kind: 'attack', label: 'skill', actorId: fighter.id, actorSide: side, targetId: target.id, targetSide, damage: 0, crit: false, miss: true });
        }
      }
      break;
    }
    case 'slow': {
      if (target) {
        const { hit, damage, crit } = computeDamage(fighter, target, skill.power, 0.95, rand);
        if (hit) {
          target.status.slow = 2;
          applyAttack(fighter, side, target, targetSide, true, damage, crit, 'skill', log, events, rand);
          events.push({ kind: 'slow', targetId: target.id, targetSide });
        }
      }
      break;
    }
    case 'selfDamage': {
      if (target) {
        const { hit, damage, crit } = computeDamage(fighter, target, skill.power, 0.9, rand);
        if (hit) {
          applyAttack(fighter, side, target, targetSide, true, damage, crit, 'skill', log, events, rand);
          const selfCost = Math.max(1, Math.round(damage * 0.15));
          fighter.hp = Math.max(1, fighter.hp - selfCost);
          log.push(`${fighter.name} pays ${selfCost} of their own health in the frenzy.`);
          events.push({ kind: 'selfDamage', actorId: fighter.id, actorSide: side, amount: selfCost });
        } else {
          log.push(`${fighter.name}'s fury swings wide.`);
          events.push({ kind: 'attack', label: 'skill', actorId: fighter.id, actorSide: side, targetId: target.id, targetSide, damage: 0, crit: false, miss: true });
        }
      }
      break;
    }
    case 'double': {
      if (target) {
        const { hit, damage, crit } = computeDamage(fighter, target, skill.power, 0.9, rand);
        if (hit) applyAttack(fighter, side, target, targetSide, true, damage, crit, 'skill', log, events, rand);
        else {
          log.push(`${fighter.name} misses the first of two strikes.`);
          events.push({ kind: 'attack', label: 'skill', actorId: fighter.id, actorSide: side, targetId: target.id, targetSide, damage: 0, crit: false, miss: true });
        }
        if (isAlive(target)) {
          const second = computeDamage(fighter, target, skill.power, 0.9, rand);
          if (second.hit) applyAttack(fighter, side, target, targetSide, true, second.damage, second.crit, 'skill', log, events, rand);
        }
      }
      break;
    }
    case 'counter': {
      if (target) {
        const { hit, damage, crit } = computeDamage(fighter, target, skill.power, 0.9, rand);
        if (hit) applyAttack(fighter, side, target, targetSide, true, damage, crit, 'skill', log, events, rand);
      }
      fighter.status.counter = true;
      break;
    }
    default:
      break;
  }
}

// ── Enemies & rewards ──────────────────────────────────────────────────────
export function rollEnemy(power, rand = Math.random) {
  const classKey = pick(CLASS_KEYS, rand);
  const level = Math.max(1, Math.round(power));
  const enemy = makeGladiator(randomName(rand), classKey, { level });
  // Keep enemies at 90–100% health for a clean readout (never above maxHp).
  const hpScale = 0.9 + rand() * 0.1;
  const stats = effectiveStats(enemy);
  enemy.hp = Math.max(1, Math.round(stats.maxHp * hpScale));
  return enemy;
}

export function rollEnemyTeam(power, rand = Math.random) {
  const count = Math.min(3, 1 + Math.floor(power / 3));
  return Array.from({ length: count }, () => rollEnemy(power, rand));
}

export function victoryRewards(power, rand = Math.random) {
  const gold = Math.round((22 + power * 16) * (0.9 + rand() * 0.2));
  const fame = Math.round(power * 10);
  const xp = Math.round(16 + power * 10);
  return { gold, fame, xp };
}
