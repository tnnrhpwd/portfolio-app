import type {
  Action,
  AttackPrecision,
  BodyZone,
  Fighter,
  Loadout,
  StyleKey,
  TurnEvent,
  ZoneMap,
} from './types';
import type { Rng } from './rng';
import { pick } from './rng';
import { isStyleKey, STYLES } from './classes';
import { buildZones, isDefeated } from './stats';
import { initiative, resolveAttack } from './combat';
import { ARMOR_COMBAT_MULTIPLIER, BODY_ZONES, START_FAME, START_GOLD } from './constants';

export interface GameState {
  roster: Fighter[];
  gold: number;
  fame: number;
}

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
    id: opts.id ?? `fighter_${fighterSeq}`,
    name: opts.name ?? 'Recruit',
    style,
    level: opts.level ?? 1,
    xp: 0,
    attributes: { ...STYLES[style].base },
    attributePoints: 0,
    skillPoints: 0,
    morale: 40,
    maxMorale: 40,
    loadout: { ...EMPTY_LOADOUT },
    status: { stun: 0, slow: 0, defending: false, bleeding: 0 },
    alive: true,
    zones: {} as ZoneMap,
  };
  fighter.zones = buildZones(fighter);
  return fighter;
}

export function createGameState(rand: Rng = Math.random): GameState {
  void rand;
  return { roster: [createFighter({ style: 'murmillo', name: 'Recruit' })], gold: START_GOLD, fame: START_FAME };
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

function cloneFighter(fighter: Fighter): Fighter {
  return {
    ...fighter,
    attributes: { ...fighter.attributes },
    loadout: { ...fighter.loadout },
    status: { ...fighter.status },
    zones: cloneZones(fighter.zones),
  };
}

function weakestZone(fighter: Fighter): BodyZone {
  let weakest: BodyZone = 'torso';
  let lowest = Number.POSITIVE_INFINITY;
  for (const zone of BODY_ZONES) {
    const z = fighter.zones[zone];
    const score = z.hp + z.armor * ARMOR_COMBAT_MULTIPLIER;
    if (score < lowest) {
      lowest = score;
      weakest = zone;
    }
  }
  return weakest;
}

/** Simple enemy AI: attack the defender's most vulnerable zone. */
function enemyAction(targets: Fighter[], rand: Rng): Action {
  const target = pick(targets, rand);
  const roll = rand();
  const precision: AttackPrecision = roll < 0.2 ? 'strong' : roll < 0.6 ? 'medium' : 'weak';
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

    const action: Action =
      side === 'player'
        ? (playerActions[fighter.id] ?? { kind: 'attack', precision: 'medium', targetZone: 'torso' })
        : enemyAction(opposing, rand);

    if (action.kind === 'block') {
      fighter.status.defending = true;
      events.push({ kind: 'block', actorId: fighter.id });
      continue;
    }

    if (action.kind !== 'attack') continue;

    const defender =
      (action.targetId ? opposing.find((f) => f.id === action.targetId) : undefined) ??
      opposing[0];
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
    fighter.status.defending = false;
    if (fighter.status.bleeding > 0) {
      fighter.status.bleeding -= 1;
      fighter.zones.torso.hp = Math.max(0, fighter.zones.torso.hp - 2);
      if (isDefeated(fighter)) fighter.alive = false;
    }
  }

  return {
    playerTeam: players,
    enemyTeam: enemies,
    events,
    playerWon: enemies.every((f) => !f.alive),
    enemyWon: players.every((f) => !f.alive),
  };
}
