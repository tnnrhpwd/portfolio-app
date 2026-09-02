import type {
  Action,
  AttackOutcome,
  AttackPrecision,
  BodyZone,
  Equipment,
  Fighter,
  Loadout,
  StyleKey,
  TurnEvent,
  ZoneMap,
} from './types';
import type { MetalId } from './equipment';
import type { Rng } from './rng';
import { pick } from './rng';
import { isStyleKey, STYLES } from './classes';
import { createEquipment } from './equipment';
import { buildZones, canMeleeAttack, currentHp, destroyedLimbCount, effectiveAttributes, isDefeated, isZoneDestroyed, legsCrippled, totalHp } from './stats';
import { hitChance, initiative, resolveAttack, resolveHit, type HitMods } from './combat';
import { getSkill } from './skills';
import { ARMOR_COMBAT_MULTIPLIER, BODY_ZONES, LIMB_BLEED_PER_TURN, START_FAME, START_GOLD } from './constants';

export interface GameState {
  roster: Fighter[];
  inventory: Equipment[];
  metals: Record<MetalId, number>;
  unlockedAchievements: string[];
  tutorialSeen: boolean;
  gold: number;
  fame: number;
  /** The player's gladiator school name (shown on the map and arena ladder). */
  teamName: string;
  /** Current ladder rank per city id (16 = weakest, 1 = champion). */
  coliseumRanks: Record<string, number>;
}

export const EMPTY_METALS: Record<MetalId, number> = { bronze: 0, iron: 0, silver: 0, gold: 0 };

/** Default gladiator-school name before the player renames it. */
export const DEFAULT_TEAM_NAME = 'The Untamed';

const EMPTY_LOADOUT: Loadout = {
  head: null,
  torso: null,
  leftArm: null,
  rightArm: null,
  legs: null,
  mainHand: null,
  offHand: null,
};

export interface CreateFighterOptions {
  id?: string;
  name?: string;
  /** Any string is accepted; unknown values fall back to the default style. */
  style?: string;
  level?: number;
}

let fighterSeq = 0;

export function createFighter(opts: CreateFighterOptions = {}): Fighter {
  const style: StyleKey = opts.style && isStyleKey(opts.style) ? opts.style : 'murmillo';
  fighterSeq += 1;

  const fighter: Fighter = {
    id: opts.id ?? `fighter_${fighterSeq}_${Math.random().toString(36).slice(2, 8)}`,
    name: opts.name ?? 'Recruit',
    style,
    level: opts.level ?? 1,
    xp: 0,
    attributes: { ...STYLES[style].base },
    baseAttributes: { ...STYLES[style].base },
    attributePoints: 0,
    skillPoints: 0,
    skills: {},
    morale: 40,
    maxMorale: 40,
    loadout: { ...EMPTY_LOADOUT },
    status: { stun: 0, slow: 0, defending: false, bleeding: 0, buffed: 0 },
    alive: true,
    row: 'front',
    auto: false,
    zones: {} as ZoneMap,
  };
  fighter.zones = buildZones(fighter);
  return fighter;
}

export function createGameState(rand: Rng = Math.random): GameState {
  void rand;
  return {
    roster: [createFighter({ style: 'murmillo', name: 'Recruit' })],
    inventory: [],
    metals: { ...EMPTY_METALS },
    unlockedAchievements: [],
    tutorialSeen: true,
    gold: START_GOLD,
    fame: START_FAME,
    teamName: DEFAULT_TEAM_NAME,
    coliseumRanks: {},
  };
}

/** Starting state for the vertical slice: one equipped fighter, points, and gold. */
export function createCampaignStart(rand: Rng = Math.random): GameState {
  const fighter = createFighter({ style: 'murmillo', name: 'Brutus' });
  fighter.attributePoints = 10;
  fighter.loadout.mainHand = createEquipment('mainHand', 0, { rand });
  fighter.loadout.offHand = createEquipment('offHand', 0, { rand });
  fighter.zones = buildZones(fighter);
  return {
    roster: [fighter],
    inventory: [],
    metals: { ...EMPTY_METALS },
    unlockedAchievements: [],
    tutorialSeen: false,
    gold: 500,
    fame: START_FAME,
    teamName: DEFAULT_TEAM_NAME,
    coliseumRanks: {},
  };
}

export interface RoundResult {
  playerTeam: Fighter[];
  enemyTeam: Fighter[];
  events: TurnEvent[];
  playerWon: boolean;
  enemyWon: boolean;
}

function cloneZones(zones: ZoneMap): ZoneMap {
  const out = {} as ZoneMap;
  for (const zone of BODY_ZONES) out[zone] = { ...zones[zone] };
  return out;
}

export function cloneFighter(fighter: Fighter): Fighter {
  return {
    ...fighter,
    attributes: { ...fighter.attributes },
    baseAttributes: { ...fighter.baseAttributes },
    skills: { ...fighter.skills },
    loadout: { ...fighter.loadout },
    status: { ...fighter.status },
    zones: cloneZones(fighter.zones),
  };
}

export function weakestZone(fighter: Fighter): BodyZone {
  let weakest: BodyZone = 'torso';
  let lowest = Number.POSITIVE_INFINITY;
  for (const zone of BODY_ZONES) {
    const z = fighter.zones[zone];
    if (z.hp <= 0) continue; // never re-target a destroyed zone
    const score = z.hp + z.armor * ARMOR_COMBAT_MULTIPLIER;
    if (score < lowest) {
      lowest = score;
      weakest = zone;
    }
  }
  return weakest;
}

/** Living fighters that may be hit by melee: the front row, or everyone when no front row remains. */
function validMeleeTargets(team: Fighter[]): Fighter[] {
  const living = team.filter((f) => f.alive && !isDefeated(f));
  const front = living.filter((f) => f.row === 'front');
  return front.length > 0 ? front : living;
}

function emitHit(
  events: TurnEvent[],
  actor: Fighter,
  defender: Fighter,
  zone: BodyZone,
  outcome: AttackOutcome,
  skillId?: string,
): void {
  if (isDefeated(defender)) {
    defender.alive = false;
    events.push({
      kind: 'death',
      actorId: actor.id,
      targetId: defender.id,
      zone,
      damage: outcome.damage,
      skillId,
    });
  } else {
    events.push({
      kind: 'attack',
      actorId: actor.id,
      targetId: defender.id,
      zone,
      damage: outcome.damage,
      crit: outcome.crit,
      blocked: outcome.blocked,
      skillId,
    });
  }
}

function healTorso(fighter: Fighter, amount: number): number {
  const zone = fighter.zones.torso;
  const healed = Math.min(amount, zone.maxHp - zone.hp);
  zone.hp = Math.min(zone.maxHp, zone.hp + amount);
  return healed;
}

/** Resolves an active skill against the opposing team. */
function applySkill(
  fighter: Fighter,
  defenders: Fighter[],
  meleeTargets: Fighter[],
  action: Action,
  rand: Rng,
  events: TurnEvent[],
): void {
  const skillId = action.skillId;
  if (!skillId) return;
  const node = getSkill(skillId);
  if (!node || node.mpCost <= 0) return;
  if (fighter.morale < node.mpCost) {
    events.push({ kind: 'miss', actorId: fighter.id });
    return;
  }
  fighter.morale -= node.mpCost;
  const rank = fighter.skills[skillId] ?? 0;
  if (rank < 1) {
    events.push({ kind: 'miss', actorId: fighter.id });
    return;
  }
  const scale = 1 + 0.04 * (rank - 1);
  const eff = node.effect;

  // Crippled fighters can't swing a weapon, but shouts/thrown/ranged skills still work.
  const needsMelee = eff.kind === 'strike' || eff.kind === 'combo';
  const needsShield = eff.kind === 'shieldBash';
  if (needsMelee && !canMeleeAttack(fighter)) {
    events.push({
      kind: 'unable',
      actorId: fighter.id,
      reason: legsCrippled(fighter) ? 'legs crippled' : 'weapon arm disabled',
    });
    return;
  }
  if (needsShield && (legsCrippled(fighter) || isZoneDestroyed(fighter, 'leftArm'))) {
    events.push({ kind: 'unable', actorId: fighter.id, reason: 'shield arm disabled' });
    return;
  }

  const ranged = eff.kind === 'throw' || eff.kind === 'demoralize';
  const pool = ranged ? defenders : meleeTargets;
  const defender =
    (action.targetId ? pool.find((f) => f.id === action.targetId) : undefined) ??
    pool[0];
  const zone: BodyZone = action.targetZone ?? weakestZone(defender);

  if (eff.kind === 'combo') {
    for (let i = 0; i < eff.hits; i += 1) {
      if (isDefeated(defender)) break;
      const outcome = resolveHit(fighter, defender, 'medium', zone, rand, {
        damageMult: eff.multiplier * scale,
      });
      emitHit(events, fighter, defender, zone, outcome, skillId);
    }
    return;
  }

  if (eff.kind === 'strike' || eff.kind === 'throw' || eff.kind === 'shieldBash') {
    const mods: HitMods = { damageMult: eff.multiplier * scale };
    if (eff.kind === 'throw') mods.critBonus = eff.critBonus;
    const outcome = resolveHit(fighter, defender, 'medium', zone, rand, mods);
    if (eff.kind === 'shieldBash') fighter.status.defending = true;
    emitHit(events, fighter, defender, zone, outcome, skillId);
    return;
  }

  if (eff.kind === 'heal') {
    const healed = healTorso(fighter, eff.amount * rank);
    events.push({ kind: 'skill', actorId: fighter.id, damage: healed, skillId });
    return;
  }

  if (eff.kind === 'demoralize') {
    const stripped = Math.round(defender.maxMorale * eff.fraction);
    defender.morale = Math.max(0, defender.morale - stripped);
    events.push({
      kind: 'skill',
      actorId: fighter.id,
      targetId: defender.id,
      damage: stripped,
      skillId,
    });
    return;
  }

  if (eff.kind === 'warCry') {
    fighter.status.buffed = 2; // buffs attacks next round
    events.push({ kind: 'skill', actorId: fighter.id, damage: 0, skillId });
  }
}

/** Enemy AI: block when hurt, pick precision by hit chance, and use skills. */
function enemyAction(actor: Fighter, targets: Fighter[], rand: Rng): Action {
  const target = pick(targets, rand);

  if (currentHp(actor) < totalHp(actor) * 0.3 && rand() < 0.3) {
    return { kind: 'block' };
  }

  const canMelee = canMeleeAttack(actor);

  // Ranged / support skills remain usable even when the legs are gone.
  const utilityIds = Object.keys(actor.skills).filter((id) => {
    const node = getSkill(id);
    if (!node || node.mpCost <= 0) return false;
    return node.effect.kind === 'throw' || node.effect.kind === 'demoralize';
  });

  if (!canMelee) {
    if (utilityIds.length > 0 && rand() < 0.6) {
      const skillId = pick(utilityIds, rand);
      const node = getSkill(skillId);
      if (node && actor.morale >= node.mpCost) {
        return { kind: 'skill', skillId, targetId: target.id, targetZone: weakestZone(target) };
      }
    }
    return { kind: 'block' };
  }

  const baseHit = hitChance(
    effectiveAttributes(actor).dexterity,
    effectiveAttributes(target).defense,
  );
  let precision: AttackPrecision = 'medium';
  if (baseHit < 0.7) precision = 'weak';
  else if (baseHit > 0.95) precision = 'strong';

  const activeIds = Object.keys(actor.skills).filter((id) => {
    const node = getSkill(id);
    if (!node || node.mpCost <= 0) return false;
    return (
      node.effect.kind === 'strike' ||
      node.effect.kind === 'combo' ||
      node.effect.kind === 'throw' ||
      node.effect.kind === 'shieldBash'
    );
  });
  if (activeIds.length > 0 && rand() < 0.25) {
    const skillId = pick(activeIds, rand);
    const node = getSkill(skillId);
    if (node && actor.morale >= node.mpCost) {
      return { kind: 'skill', skillId, targetId: target.id, targetZone: weakestZone(target) };
    }
  }

  return { kind: 'attack', precision, targetId: target.id, targetZone: weakestZone(target) };
}

/**
 * Resolves one full combat round: every living fighter acts once in
 * speed order, then end-of-round upkeep runs. All inputs are cloned so
 * callers may keep the previous state. Deterministic given a fixed `rand`.
 */
export function resolveRound(
  playerTeam: readonly Fighter[],
  enemyTeam: readonly Fighter[],
  playerActions: Readonly<Record<string, Action>>,
  rand: Rng = Math.random,
): RoundResult {
  const players = playerTeam.map(cloneFighter);
  const enemies = enemyTeam.map(cloneFighter);
  const events: TurnEvent[] = [];

  const actors: { fighter: Fighter; side: 'player' | 'enemy' }[] = [];
  for (const fighter of players) {
    if (fighter.alive && !isDefeated(fighter)) actors.push({ fighter, side: 'player' });
  }
  for (const fighter of enemies) {
    if (fighter.alive && !isDefeated(fighter)) actors.push({ fighter, side: 'enemy' });
  }
  actors.sort((a, b) => initiative(b.fighter) - initiative(a.fighter));

  for (const { fighter, side } of actors) {
    if (!fighter.alive || isDefeated(fighter)) continue;

    const opposing = (side === 'player' ? enemies : players).filter(
      (f) => f.alive && !isDefeated(f),
    );
    if (opposing.length === 0) continue;
    const meleeTargets = validMeleeTargets(opposing);

    const action: Action =
      side === 'player'
        ? (playerActions[fighter.id] ?? { kind: 'attack', precision: 'medium', targetZone: 'torso' })
        : enemyAction(fighter, meleeTargets, rand);

    if (action.kind === 'block') {
      fighter.status.defending = true;
      events.push({ kind: 'block', actorId: fighter.id });
      continue;
    }

    if (action.kind === 'crowdAppeal') {
      const restored = Math.ceil(fighter.maxMorale * 0.5);
      fighter.morale = Math.min(fighter.maxMorale, fighter.morale + restored);
      events.push({ kind: 'restore', actorId: fighter.id, damage: restored });
      continue;
    }

    if (action.kind === 'row') {
      fighter.row = fighter.row === 'front' ? 'back' : 'front';
      events.push({ kind: 'row', actorId: fighter.id, row: fighter.row });
      continue;
    }

    if (action.kind === 'skill') {
      applySkill(fighter, opposing, meleeTargets, action, rand, events);
      continue;
    }

    if (action.kind !== 'attack') continue;

    if (!canMeleeAttack(fighter)) {
      events.push({
        kind: 'unable',
        actorId: fighter.id,
        reason: legsCrippled(fighter) ? 'legs crippled' : 'weapon arm disabled',
      });
      continue;
    }

    const defender =
      (action.targetId ? meleeTargets.find((f) => f.id === action.targetId) : undefined) ??
      meleeTargets[0];
    const zone: BodyZone = action.targetZone ?? 'torso';
    const precision: AttackPrecision = action.precision ?? 'medium';

    const outcome = resolveAttack(fighter, defender, precision, zone, rand);
    if (!outcome.hit) {
      events.push({ kind: 'miss', actorId: fighter.id, targetId: defender.id, zone });
      continue;
    }

    if (isDefeated(defender)) {
      defender.alive = false;
      events.push({
        kind: 'death',
        actorId: fighter.id,
        targetId: defender.id,
        zone,
        damage: outcome.damage,
      });
    } else {
      events.push({
        kind: 'attack',
        actorId: fighter.id,
        targetId: defender.id,
        zone,
        damage: outcome.damage,
        crit: outcome.crit,
        blocked: outcome.blocked,
      });
    }
  }

  // End-of-round upkeep.
  for (const fighter of [...players, ...enemies]) {
    if (fighter.status.stun > 0) fighter.status.stun -= 1;
    if (fighter.status.slow > 0) fighter.status.slow -= 1;
    if (fighter.status.buffed > 0) fighter.status.buffed -= 1;
    fighter.status.defending = false;
    if (fighter.status.bleeding > 0) {
      fighter.status.bleeding -= 1;
      fighter.zones.torso.hp = Math.max(0, fighter.zones.torso.hp - 2);
    }
    // Destroyed limbs bleed the torso every round.
    const limbs = destroyedLimbCount(fighter);
    if (limbs > 0) {
      fighter.zones.torso.hp = Math.max(0, fighter.zones.torso.hp - limbs * LIMB_BLEED_PER_TURN);
    }
    if (isDefeated(fighter)) fighter.alive = false;
  }

  return {
    playerTeam: players,
    enemyTeam: enemies,
    events,
    playerWon: enemies.every((f) => !f.alive),
    enemyWon: players.every((f) => !f.alive),
  };
}

/** Brings a defeated fighter back with 1 HP on destroyed zones (arena defeat). */
export function stabilize(fighter: Fighter): Fighter {
  for (const zone of BODY_ZONES) {
    if (fighter.zones[zone].hp <= 0) fighter.zones[zone].hp = 1;
  }
  fighter.alive = true;
  return fighter;
}
