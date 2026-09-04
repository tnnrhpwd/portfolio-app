/** The six core attributes. */
export type AttributeKey =
  | 'strength'
  | 'dexterity'
  | 'speed'
  | 'defense'
  | 'vitality'
  | 'charisma';

/** Starting archetype (base stats + starter gear + sprite). Does NOT restrict which skills a fighter can learn. */
export type StyleKey = 'provocator' | 'murmillo' | 'retiarius' | 'dimachaerus' | 'thraex';

/** The six targetable anatomical zones. */
export type BodyZone = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

/** Attack strength tiers that trade damage for hit chance. */
export type AttackPrecision = 'weak' | 'medium' | 'strong';

/** Front/back arena row — back-row fighters are shielded from melee. */
export type RowPosition = 'front' | 'back';

/** Equipment slots, including the two hands. */
export type EquipmentSlot =
  | 'head'
  | 'torso'
  | 'leftArm'
  | 'rightArm'
  | 'legs'
  | 'mainHand'
  | 'offHand';

export type Attributes = Record<AttributeKey, number>;

export interface Equipment {
  id: string;
  slot: EquipmentSlot;
  /** Weapon/shield archetype (e.g. 'gladius', 'spear', 'tower'), armor uses its slot name. */
  kind?: string;
  name: string;
  /** Material tier of the item, 0..4 (higher = better base stats). */
  tier: number;
  /** Quality multiplier: 1.0 for shop stock, 1.3–1.6 for crafted gear. */
  quality: number;
  /** Displayed armor value for this piece (doubles in combat). */
  armor: number;
  /** Weapon damage range (hands only). */
  minDamage?: number;
  maxDamage?: number;
  /** Extra critical-hit chance this weapon grants (0–1). */
  critBonus?: number;
  /** Shield block chance (0–72) and damage absorbed on a block. */
  blockChance?: number;
  blockValue?: number;
  /** Random attribute bonuses (shop ≤4 affixes, crafted ≤6). */
  bonuses: Partial<Attributes>;
  /** How many random bonus affixes this item rolled. */
  affixCount: number;
}

export type Loadout = Record<EquipmentSlot, Equipment | null>;

export interface ZoneState {
  /** Displayed armor durability remaining on this zone. */
  armor: number;
  /** Flesh HP remaining on this zone. */
  hp: number;
  /** Maximum flesh HP for this zone. */
  maxHp: number;
}

export type ZoneMap = Record<BodyZone, ZoneState>;

export interface StatusEffects {
  stun: number;
  slow: number;
  defending: boolean;
  bleeding: number;
  /** Rounds of remaining war-cry damage buff. */
  buffed: number;
}

export interface Fighter {
  id: string;
  name: string;
  style: StyleKey;
  level: number;
  xp: number;
  attributes: Attributes;
  /** Attribute values at creation — the baseline for attribute reset. */
  baseAttributes: Attributes;
  attributePoints: number;
  skillPoints: number;
  /** Skill node id → rank invested. */
  skills: Record<string, number>;
  morale: number;
  maxMorale: number;
  loadout: Loadout;
  zones: ZoneMap;
  status: StatusEffects;
  alive: boolean;
  row: RowPosition;
  /** AI-controlled (auto-battle) flag, toggled from the team screen. */
  auto: boolean;
}

export interface Action {
  kind: 'attack' | 'block' | 'crowdAppeal' | 'pass' | 'skill' | 'row';
  precision?: AttackPrecision;
  targetId?: string;
  targetZone?: BodyZone;
  skillId?: string;
}

export interface AttackOutcome {
  hit: boolean;
  blocked: boolean;
  crit: boolean;
  /** Flesh damage dealt after armor + block. */
  damage: number;
  /** Damage absorbed by the target's armor layer. */
  armorAbsorbed: number;
}

export interface TurnEvent {
  kind: 'attack' | 'block' | 'restore' | 'death' | 'miss' | 'skill' | 'row' | 'unable';
  actorId: string;
  targetId?: string;
  zone?: BodyZone;
  damage?: number;
  crit?: boolean;
  blocked?: boolean;
  skillId?: string;
  row?: RowPosition;
  reason?: string;
}
