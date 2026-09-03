# Coliseum — Functional Specification (2026 rebuild)

> Clean-room functional spec for the rebuild at `sthopwood.com/coliseum`.
> This document describes **what** the game does, in our own words. It is
> derived from observing the reference game's behavior and contains no copied
> text, names, lore, art, or code. All wording here is original. Functional
> rules and balance numbers are reproduced as tuning targets (rules/facts are
> not copyrightable); creative expression is always original.

## 1. One-line summary
A single-player gladiator-management RPG: run a school of fighters, recruit and
customize them, equip and train them, then fight turn-based arena battles with
anatomical (body-part) targeting to earn gold, gear, and fame while climbing a
campaign of rank-gated cities.

## 2. Core loop
1. Manage the school: inspect fighters, spend stat/skill points, equip gear.
2. Visit city facilities: shop (buy), blacksmith (craft/upgrade), recruit
   (hire), infirmary (heal).
3. Enter the coliseum: pick an opponent team, fight.
4. Win → earn gold, XP, and loot; make a post-battle verdict (spare or execute).
5. Heal, re-equip, train, repeat; unlock the next city by climbing rank.

## 3. Attributes & derived stats

Six core attributes:

| Attribute | Role |
| :-- | :-- |
| Strength (STR) | Flat melee/physical skill damage |
| Dexterity (DEX) | Hit chance and critical chance |
| Speed (SPD) | Turn order / initiative |
| Defense (DEF) | Reduces enemy hit chance; mitigates unblocked damage |
| Vitality (VIT) | Maximum HP |
| Charisma (CHA) | Morale (MP) ability efficacy and crowd skills |

Derived stats: total HP, per-body-part HP, Morale/MP, damage range (min–max),
per-slot armor, block chance, block value.

### Balance targets (functional tuning values to match)
- Stat caps: STR 521, DEX 508, DEF 516, SPD 515, VIT 383.
- Hit resolution: DEX must be ≥ half the target's DEF to hit; ~340 DEX reliably
  hits a max-DEF (516) target. Strength does not affect accuracy.
- HP split across body parts: torso 23%, head 17%, each arm 15%, each leg 15%.
- Vitality → HP: 1 VIT ≈ 56 HP at level 70, scaling ~+0.8 HP/level after.
- Armor: displayed armor value effectively doubles in combat.
- Block: shield block chance/value caps at 72%.

## 4. Combat model

### 4.1 Turn order
Speed-ordered rounds; higher SPD acts first with a stable tie-break. A visible
turn-order queue shows the upcoming sequence.

### 4.2 Anatomical targeting
- Each fighter has six targetable zones: head, torso, left arm, right arm, left
  leg, right leg — each with its own HP pool.
- Damage hits the zone's armor layer first, then its flesh.
- Zone-destruction consequences:
  - Head or torso → lethal (instant defeat regardless of remaining HP).
  - Right arm → drops main-hand weapon (weapon damage lost; two-handers disabled).
  - Left arm → drops shield/off-hand (block lost; dual-wield combos disabled).
  - Legs → melee disabled; only ranged actions remain.

### 4.3 Attack precision tiers
Three strengths trading damage for hit chance: weak (low damage, high
precision), medium (balanced), strong (high damage, low precision).

### 4.4 Defense & blocking
Shields grant block chance + block value (damage absorbed on a block). A guard
action raises block chance for the turn.

### 4.5 Morale (MP)
- A finite resource (MP) gates every active skill.
- Restored in combat by a showmanship action ("Play to the Crowd").
- A demoralize-style skill strips a large fraction (~75–80%) of a target's max
  MP; a team-wide version exists. Controlling the enemy's MP is a core tactic.

### 4.6 Status effects & wounds
Stun/skip, slow, disarm, crippled legs, and ongoing damage from open wounds;
healing/restore actions as counters.

### 4.7 Post-battle verdict
After a decisive win, choose Spare (XP + MP-growth bonus) or Execute (extra
loot). Overkilling past a threshold ends the fight without the prompt.

## 5. Character creation
- Choose a background (grants a small starting stat bonus: one leans offense,
  the other leans Charisma/morale).
- Customize appearance (skin, head, hair, cloth) and name the team + fighter.
- Starting stats and derived values are seeded from the chosen background.

## 6. Play styles & skill trees
A fighter's skill tree is determined by weapon loadout. Five styles (historical
gladiator type names — these are factual categories, not game-invented):

1. **Provocator** (spear + shield) — support/control: MP economy, crowd control,
   buffs, heals; Speed-first.
2. **Murmillo** (shield + one-hander) — protector/tank: block, shield bash,
   guarding allies.
3. **Retiarius** (net + trident) — controller/thrower: entangle, ranged throws,
   utility.
4. **Dimachaerus** (dual wield) — burst damage: multi-hit combos.
5. **Thraex** (two-hander) — heavy single-hit damage.

- Skill points are earned on level-up and spent across the tree; resettable.
- Nodes have ranks (capped at 5/10/15).
- Skill effects (original names to be finalized in Phase 3): power strike,
  double/combo strike, ranged throw, shield bash (damage + block), guard ally,
  heal, war cry (team buff), demoralize (enemy MP drain), speed boost
  (passive), vitality boost (passive).

## 7. Out-of-combat facilities
- **School / roster:** manage fighters, gear, and loadouts; limited slots (~12).
- **Skill/attribute screen:** spend and reset stat points and skill points.
- **Blacksmith:** craft/upgrade gear with a quality multiplier (~1.3–1.6×) and
  up to 6 random bonus affixes (vs 4 on shop items); consumes gold + metal
  ingots (bronze/iron/silver/gold); rare "true gem" outcomes.
- **Shop:** rotating stock that scales per city; filter by slot; buy/sell/equip
  by dragging onto the fighter or inventory.
- **Recruit:** hire fighters of varying starting level and stats.
- **Infirmary:** heal wounds and restore HP between fights (gold cost).

## 8. Campaign & progression
- A world map with a chain of cities unlocked by rank; ten regions, from a
  northern frontier to the capital and a mythic final city. (Original city
  names to be chosen from the historical Roman world.)
- Each city has a coliseum (a ladder of opponent teams, some rank-locked), a
  shop, and a recruit facility; later cities scale up in power and stock.
- Rewards: gold, XP, loot; a fame/rank ladder; meta unlockables (trophies).

## 9. Economy & risk
- Gold comes from victories; sinks are gear, recruits, healing, and crafting.
- Limb damage/wounds create upkeep pressure between fights.
- The post-battle verdict adds risk/reward texture (XP vs loot).

## 10. Meta & achievements
- Trophies/achievements for milestones (wins, win streaks, solo runs, etc.).
- A daily login reward (original schedule and values to be set in Phase 4).

## 11. Multiplayer (deferred — Phase 6 design)
- Asynchronous team-vs-team with a ranked ladder and trophy tiers, plus account
  linking for cloud saves and leaderboards. The single-player loop must not
  depend on it.

## 12. Explicitly out of scope for v1
- Real-money purchases, social-platform tie-ins, and legacy portal ad walls.
- Any reproduction of the reference's wording, art, audio, or trade dress
  (always original).

## 13. Tech & asset plan (Phase 0 summary)
- **Stack:** TypeScript (strict) + Phaser 3 (WebGL) on Vite; the existing React
  route becomes a thin shell that mounts the Phaser game.
- **Architecture:** a pure, framework-free TypeScript game core (deterministic,
  RNG-injected) that Phaser only presents; Jest/Vitest coverage of all rules.
- **Responsive:** fully dynamic sizing (phones/tablets/desktop, portrait +
  landscape) with a 16:9 safe area; all UI drawn inside the Phaser frame.
- **Art:** stylized animated 2D (no photorealistic gore); original character
  designs per style, original UI chrome, spritesheet atlases with a mobile
  asset budget.
- **Audio:** royalty-free stock SFX/music with an `ASSET-LICENSES.md` record.
- **Persistence:** local-first (IndexedDB) + efficient cloud saves (single
  compact JSON per user) via the repo's DynamoDB "Simple" convention.
