# Sands of the Coliseum: Complete Gameplay & Mechanics Manual

---

## 1. Overview & Core Game Loop

**Sands of the Coliseum** is a turn-based tactical gladiator management RPG set across the ancient Roman Empire and its mythological fringes. The core gameplay loop revolves around managing a gladiator stable (*Ludus*), recruiting and training slaves, outfitting fighters with precision-targeted armor and weaponry, and entering gladiatorial combats across multiple historical coliseums to climb both single-player campaigns and multiplayer rankings.

```
       ┌────────────────────────────────────────────────────────┐
       │                   THE LUDUS (HUB)                      │
       │  • Manage Roster & Stats    • Skill Tree Allocation    │
       │  • Blacksmith (Craft/Forge) • Slave Market (Recruit)   │
       │  • Shop (Gear/Consumables)  • Travel Map (Cities)      │
       └──────────────────────────┬─────────────────────────────┘
                                  │
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │                   TACTICAL ARENA                       │
       │  • Speed-Driven Turn Order  • Body-Part Targeting     │
       │  • Armor Layer vs Body HP   • Dismemberment & Wounds   │
       │  • Shield Stances & Blocks  • MP/Skill Execution       │
       └──────────────────────────┬─────────────────────────────┘
                                  │
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │                 REWARDS & PROGRESSION                  │
       │  • Gold & Experience (XP)   • Metal Ingots & Gear Drops│
       │  • Campaign Progression     • PvP Trophies & Medals    │
       └────────────────────────────────────────────────────────┘
```

---

## 2. Character Attributes & Statistics

Every gladiator possesses six core base attributes, alongside secondary combat calculations derived from gear, skills, and attribute thresholds.

### Primary Attributes

| Attribute | Primary Function | Tactical Impact & Value |
| :--- | :--- | :--- |
| **Strength (STR)** | Increases flat melee and physical skill damage. | **Primary Offensive Stat.** Directly scales auto-attacks, *Power Attack*, and *Shield Bash* damage. Essential for damage-focused builds. |
| **Dexterity (DEX)** | Governs hit accuracy and Critical Hit chance (`Crit %`). | Determines how reliably attacks connect against high-defense foes and scales lethal burst potential. |
| **Speed (SPD)** | Determines initiative and turn order in combat. | **Highest Tactical Stat for Control/Support.** Acting first allows setting up defensive shield stances, debuffing enemies with shouts, or disabling enemy limbs before they strike. |
| **Defense (DEF)** | Reduces enemy hit chance and mitigates unblocked incoming damage. | Provides passive survivability; however, returns diminish relative to active shield blocking and directional armor. |
| **Vitality (VIT)** | Directly increases overall maximum Health Points (HP). | Broadens survival thresholds against burst attacks; most efficient when paired with high-quality armor. |
| **Charisma (CHA)** | Affects morale, scream/shout skill efficacy, crowd favor, and special support abilities. | Core attribute for support/screamer archetypes using *Intimidation* or team buffs. |

### Derived / Combat Stats

- **Hit Points (HP):** Divided into an overall health pool and individual health pools for each anatomical limb/section (Head, Torso, Arms, Legs).
- **Mana / Stamina Points (MP):** Resource consumed to execute active skills, shouts, and weapon abilities.
- **Armor Rating:** Calculated per equipped anatomical slot.
- **Block Chance (%):** The percentage probability to completely deflect incoming damage via an equipped shield.
- **Block Value:** The amount of physical damage absorbed when an attack is successfully blocked.
- **Damage (DMG):** Displayed as a Min–Max range determined by the equipped weapon, scaled by Strength and skill multipliers.

---

## 3. Anatomical Targeting & Combat Mechanics

Combat is strictly turn-based and features a directional, anatomical damage model where attacking specific body parts yields tactical advantages.

```
                     ┌──────────────────┐
                     │   HEAD (Lethal)  │ -> Decapitation (Instant Kill)
                     └────────┬─────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
   ┌──────┴──────┐    ┌───────┴────────┐    ┌─────┴──────┐
   │  LEFT ARM   │    │ TORSO (Lethal) │    │ RIGHT ARM  │
   │ Drops Shield│    │ Disembowelment │    │ Drops Main │
   │ / Off-Hand  │    └───────┬────────┘    │   Weapon   │
   └─────────────┘            │             └────────────┘
                      ┌───────┴────────┐
                      │      LEGS      │ -> Disables Melee Movement
                      │ (Left & Right) │    (Ranged/Throw Only)
                      └────────────────┘
```

### Body Part Mechanics & Status Conditions

1. **Head (Lethal Zone):**
   - Typically features low base HP and lighter armor on many gladiator types.
   - Reducing Head HP to zero causes **Decapitation**, resulting in an immediate instant kill regardless of total remaining gladiator health.
2. **Torso / Body (Lethal Zone):**
   - The central health reservoir of the gladiator.
   - Reducing Torso HP to zero inflicts **Disembowelment / Fatal Trauma**, terminating the gladiator.
3. **Arms (Functional Disablement):**
   - **Right Arm Disabled:** The gladiator drops their main-hand weapon, severely crippling their damage output and disabling two-handed weapons.
   - **Left Arm Disabled:** The gladiator drops their shield or off-hand weapon, eliminating block capabilities or dual-wield combos.
4. **Legs (Mobility Disablement):**
   - Disabling leg HP cripples movement. Melee-distance strikes and charges cannot be performed; the gladiator can only utilize ranged abilities like *Throw*.

### Armor Layering vs. Direct Flesh Damage

- Every body part has two bars: **Armor Durability** (blue/gray) and **Body Part Health** (red).
- When an attack strikes a limb, damage is first applied against the armor assigned to that specific slot.
- Heavy armor on the chest offers **zero protection** if an enemy targets an exposed head or unarmored leg.
- Once the armor on a specific body part reaches `0`, subsequent blows deal direct flesh damage, triggering limb breakages, severe bleeding, or instant dismemberment.

---

## 4. Skills & Skill Trees

Gladiators invest skill points earned upon leveling into active abilities, passive stat multipliers, and stances.

```
                            [ BASE SKILLS ]
                                   │
         ┌─────────────────────────┼────────────────────────┐
         ▼                         ▼                        ▼
  [ OFFENSIVE PATH ]        [ DEFENSIVE PATH ]       [ SUPPORT / SHOUT ]
   • Power Attack            • Shield Bash            • Intimidation
   • Double Attack (2x)      • Protect                • War Cry
   • Throw                   • Defense Boost          • Cure / Heal
   • Cleave / Decapitate     • Life Boost             • Speed Boost
```

### Comprehensive Skill Breakdown

#### 1. Offensive Abilities
- **Power Attack:**
  - Delivers a high-multiplier single blow. Essential for Two-Handed weapon users and 1H brawlers to break through high-armor body parts in fewer actions.
- **Double Attack / 2x Combo:**
  - Strikes the target twice in a single turn. Particularly potent for Dual Wielders and serves as a hard counter against shield-blocking opponents by testing block checks twice.
- **Throw:**
  - Ranged projectile attack (most effective with spears/javelins). High base critical chance; crucially, can be thrown even if the gladiator's legs have been crippled.
- **Cleave / Whirlwind:**
  - Wide-arc melee attacks that hit multiple targets or deal heavy collateral damage across neighboring hitboxes.

#### 2. Defensive & Stance Abilities
- **Shield Bash:**
  - Deals moderate blunt damage with the shield while immediately placing the gladiator into a **Blocking Stance**.
  - Investing up to Level 5 guarantees active block protection for **3 combat rounds**. At Level 10, both the damage scaling (via Strength) and block mitigation reach peak efficiency.
- **Protect:**
  - Intercepts or redirects incoming damage directed at adjacent or vulnerable team members.
- **Defense Boost (Passive):**
  - Multiplies the flat defensive threshold and damage reduction of equipped armor sets.
- **Life Boost (Passive):**
  - Scales maximum Vitality and overall HP capacity.

#### 3. Support, Shouts & Healing
- **Cure / Heal:**
  - Restores health to the user or an ally during combat. Critical for sustain-heavy support gladiators in long arena gauntlets.
- **Intimidation (Scream):**
  - A crowd-control shout that reduces enemy offensive damage, hit chance, or morale for multiple rounds.
- **War Cry:**
  - Team-wide buff that boosts ally attack power and speed.
- **Speed Boost (Passive):**
  - Permanently raises the gladiator's initiative stat, guaranteeing earlier turns in the round sequence.

---

## 5. Equipment, Armor & Weapons

Equipment quality directly governs survivability and offensive thresholds.

### Equipment Slots

| Slot | Category | Primary Function |
| :--- | :--- | :--- |
| **Head** | Helmet | Protects against instant decapitation; critical vs. overhead strikes. |
| **Chest / Torso** | Cuirass / Tunic / Armor | Shields the central vitals from fatal body wounds. |
| **Left Arm / Shoulder** | Pauldron / Arm Guard | Prevents off-hand disarming and shield loss. |
| **Right Arm** | Gauntlet / Vambrace | Prevents main weapon disarming. |
| **Legs** | Greaves / Boots | Maintains battlefield mobility and melee skill availability. |
| **Main Hand** | Weapon | Determines base damage, attack type, and skill availability. |
| **Off Hand** | Shield / Secondary Weapon | Grants Block % and Block Value, or enables 2x Combo attacks. |

### Weapon Categories & Combat Styles

```
┌─────────────────────────┬─────────────────────────┬─────────────────────────┐
│     SPEAR + SHIELD      │       DUAL WIELD        │       TWO-HANDED        │
│   (Highest Survival)    │    (Block Breaker)      │    (Single-Hit Burst)   │
│ • Long reach & high crits│ • Two attacks per turn  │ • Highest raw damage    │
│ • Ranged Throw skill    │ • Rapid armor shredding │ • Vulnerable to arm     │
│ • Sustained block stance│ • Weak defensive base   │   disabling             │
└─────────────────────────┴─────────────────────────┴─────────────────────────┘
```

1. **Spears & Polearms:**
   - Balanced reach, solid critical multipliers, and access to the *Throw* skill.
   - Optimal pairing: Tower or Round Shield for the safest build in the game.
2. **One-Handed Swords / Axes / Maces:**
   - **Swords (Gladius):** Balanced damage and precision.
   - **Axes:** Higher variance damage with high critical limb-severing bonuses.
   - **Maces/Clubs:** High armor-crushing efficiency and stun chance.
3. **Dual Wielding (Daggers / Dual Gladius):**
   - Sacrifices all shield blocking in exchange for rapid multi-hit flurries (*2x Combo*), tearing through unarmored limbs and overwhelming blocking stances.
4. **Two-Handed Greatswords / Mauls / Halberds:**
   - Highest single-turn damage in the game. Capable of one-shotting enemies via *Power Attack* to the head or torso, but leaves the user helpless if their weapon arm takes critical damage.
5. **Shields (Bucklers, Round, Tower):**
   - Provide flat Block Chance (%) and Block Value (damage absorbed). Essential for executing *Shield Bash*.

---

## 6. Town Facilities & Menu Systems

Outside of battle, players manage resources, equipment, and roster health across town facilities.

```
┌────────────────────────────────────────────────────────────────────────┐
│                               TOWN MAP                                 │
├───────────────────┬───────────────────┬────────────────────────────────┤
│    [ LUDUS ]      │  [ BLACKSMITH ]   │       [ SLAVE MARKET ]         │
│ Roster Management │ Forging & Upgrades│ Recruit New Gladiators         │
│ Equipment / Stats │ Gem Socketing     │ Filter by Base Tiers & Levels  │
├───────────────────┼───────────────────┼────────────────────────────────┤
│    [ SHOP ]       │   [ INFIRMARY ]   │          [ ARENA ]             │
│ Purchase Standard │ Heal Wounds       │ Campaign Battles / Bosses      │
│ Weapons & Armor   │ Post-Fight Care   │ Multiplayer / PvP Matchmaking  │
└───────────────────┴───────────────────┴────────────────────────────────┘
```

### 1. The Ludus (Barracks / School)
- **Roster Capacity:** Holds up to 12 gladiators (11 actively managed fighters recommended to keep a recruitment slot open).
- **Customization & Loadout:** Inspect detailed character sheets, distribute attribute points, allocate skill points, rename gladiators, and swap equipment between active party members and reserve inventory.

### 2. The Blacksmith (Crafting, Forging & Upgrades)
The Blacksmith is the source of the highest-tier equipment in the game:
- **Quality Multipliers:** Items forged at the Blacksmith feature a quality multiplier between **1.3x and 1.6x**, making them far superior to standard shop inventory.
- **Materials (Metal Ingots):** Forging requires Gold and Metal bars (Bronze, Iron, Silver, Gold). Higher-tier metals dramatically increase the chance of crafting higher-rarity equipment.
- **Affixes & Bonuses:**
  - Standard shop items feature a maximum of 4 random bonuses.
  - Blacksmith-crafted gear can attain up to **6 bonus attributes**, with individual bonuses reaching up to **+20 points** each.
- **True Gems:** Rare crafting outcomes yield "True Gems" embedded in gear, providing massive stat amplifications.

### 3. The Slave Market
- Purchase new gladiators with variable starting levels, stat spreads, and baseline skill distributions.
- Essential for replacing gladiators lost permanently to arena deaths or acquiring high-stat recruits in later cities.

### 4. General Shop
- Sells standard, tiered weapons, armor, and gear.
- Inventory automatically refreshes and scales up in base power with each new city reached in the campaign.

### 5. Infirmary / Medical Care
- Combat injuries, severed limb statuses, and HP deficits must be treated between arena matches.
- Players spend gold on medical treatment and rest cycles to ensure gladiators enter the arena at 100% capacity.

---

## 7. Campaign Progression & Arenas

The campaign spans historical and mythic Roman territories, progressing through ten distinct Coliseums of increasing difficulty:

```
  1. Londinium (Britain)
        │
  2. Massilia (Gaul)
        │
  3. Syracuse (Sicily)
        │
  4. Nicomedia (Asia Minor)
        │
  5. Tarsus (Cilicia)
        │
  6. Carthage (North Africa)
        │
  7. Alexandria (Egypt)
        │
  8. Athena (Greece)
        │
  9. Rome (The Grand Coliseum)
        │
 10. Olympus (Mythic Final Frontier)
```

Each city introduces:
- **Higher Level Encounters:** Ranging from 1v1 duels to 3v3 team skirmishes.
- **Unique Arena Champions / Bosses:** Heavily armored gladiators with specialized weapon loadouts and lethal skill combinations.
- **Shop & Market Tier Scaling:** Higher base equipment stats and higher-level slave market recruits.

---

## 8. Multiplayer & Competitive PvP

Sands of the Coliseum includes an asynchronous and ranked multiplayer system where players pit their best gladiator teams against other players' builds.

### Ranked Ladder Tiers

Players earn trophies with each victory, climbing through 11 distinct rank tiers:

1. **Slave**
2. **Thug**
3. **Fighter**
4. **Combat Master**
5. **Champion**
6. **Primus**
7. **Palus**
8. **War Master**
9. **Conqueror**
10. **Empire Hero**
11. **God of the Arena** *(Peak Rank — typically requires ~600+ PvP wins)*

### Medals & Blacksmith Rank Synergies
- **Medal Milestones:** Players earn competitive Medals (approximately 1 Medal per 10 PvP victories).
- **Multiplayer Blacksmith Bonus:** Achieving higher multiplayer ranks directly enhances Blacksmith forging quality and quality multiplier ceilings in both single-player and multiplayer modes.

---

## 9. Proven Builds & Tactical Archetypes

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TOP META ARCHETYPES                             │
├────────────────────────────────────────────────────────────────────────┤
│ 1. THE SPEAR & SHIELD JUGGERNAUT                                       │
│    • Main Stats: Speed (to act first) -> Strength (damage)             │
│    • Key Skills: Shield Bash 10/10, Throw 10/10, Speed Boost 15/15     │
│    • Strategy: Maintain permanent 3-round blocking stance with Shield   │
│      Bash. Use Throw for heavy crits; remains lethal even if crippled. │
├────────────────────────────────────────────────────────────────────────┤
│ 2. THE TWO-HANDED BERSERKER                                            │
│    • Main Stats: Pure Strength                                         │
│    • Key Skills: Power Attack 10/10, Life Boost 10/10                  │
│    • Strategy: Target low-armor Heads or Torsos for instant kills.     │
│      Weakness: Must heavily armor both arms to prevent disarming.      │
├────────────────────────────────────────────────────────────────────────┤
│ 3. THE DUAL-WIELD COMBO SHREDDER                                       │
│    • Main Stats: Strength & Dexterity                                  │
│    • Key Skills: Double Attack (2x Combo) 10/10                        │
│    • Strategy: Breaks through enemy Shield Bashes with double hits;    │
│      rapidly strips limb armor to cause bleeding and dismemberment.    │
├────────────────────────────────────────────────────────────────────────┤
│ 4. THE SUPPORT SCREAMER                                                │
│    • Main Stats: Max Speed -> Charisma                                 │
│    • Key Skills: Intimidation 10/10, War Cry, Cure 10/10, Protect      │
│    • Strategy: Always acts first. Screams to debuff entire enemy team, │
│      heals wounded frontline gladiators, and redirects lethal blows.   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Summary of Combat Strategy Rules

1. **Target the Weakest Armor Slot:** Always inspect opponent armor distribution before attacking. If head armor is minimal, aim exclusively for the head for quick decapitation.
2. **Neutralize Enemy Threats by Body Part:**
   - Against **Two-Handers:** Attack the weapon arm to disarm them.
   - Against **Dual Wielders:** Attack the legs to cripple mobility.
   - Against **Shield Tanks:** Use *Double Attack* or bypass the shield by targeting unprotected lower limbs.
3. **Prioritize Single-Target Elimination:** In 3v3 team fights, focus all attacks on one enemy until dead. A gladiator at 10% health deals just as much damage as one at 100%.
4. **Never Ignore the Blacksmith:** Standard shop items hit a stat ceiling quickly. Use high-grade metals to forge gear with up to 6 custom bonuses and 1.6x quality multipliers.

---

## 11. The Five Gladiator Classes (Weapon-Defined Skill Trees)

Every gladiator's skill tree is defined by their weapon loadout. There are five distinct class trees, each named after a historical Roman gladiator type. Switching a gladiator's equipped weapon type switches which skill tree they can spend points in.

```
┌───────────────────────────────────────────────────────────────────────┐
│                     THE FIVE CLASS SKILL TREES                        │
├───────────────────┬─────────────────┬─────────────────────────────────┤
│ CLASS NAME        │ WEAPON LOADOUT  │ ROLE                            │
├───────────────────┼─────────────────┼─────────────────────────────────┤
│ Provocatores       │ Spear + Shield  │ Support "Screamer" — MP control,│
│                    │                 │ crowd control, morale/cure      │
│ Murmillo           │ Shield + 1H Wpn │ "Protector" — tanking, blocking,│
│                    │                 │ ally-shielding                  │
│ Retiarius          │ Net + Trident   │ "Netter/Thrower" — entangles,   │
│                    │                 │ ranged throws, utility support  │
│ Dimachaerus        │ Dual Wield      │ Burst DPS — 2x/4x Combo strikes │
│ Thraex             │ Two-Handed Wpn  │ Heavy single-hit damage (weakest│
│                    │                 │ tier at end-game per experts)   │
└───────────────────┴─────────────────┴─────────────────────────────────┘
```

### Provocatores (Screamer / Support)
- Core role: control the Morale Point (MP) economy of the whole match using **Intimidation** and **Intimidate All** to strip enemy MP, while using **Crowd Appeal** to restore their own.
- Requires overwhelming **Speed** to guarantee the first turn — whichever screamer intimidates first typically wins the MP war and, by extension, the match.
- Key skills: Boost Morale, Intimidation, Charisma Boost, Crowd Appeal Boost, Morale All, Intimidate All, Cure All, 2x Combo, Speed Boost.
- **sCreamer variant:** A refined low-MP screamer (see Section 13) that fully restores its MP pool every Crowd Appeal, flipping the MP war in its favor after the first exchange.

### Murmillo (Protector / Tank)
- Core role: stand in front of teammates and intercept attacks meant for them using **Protect**, while using **Shield Bash** for reliable chip damage and self-block.
- Two protector sub-styles:
  - **Defense-based Protector:** Sacrifices Speed for raw Defense; relies on passive block chance. Considered inferior because Dexterity counters Defense at a 1:2 ratio (see Section 12), making pure Defense stacking inefficient.
  - **Speed/Vitality-based Protector ("Meat Shield"):** The preferred build — high Speed guarantees first turn (protecting allies before the enemy can act) and enables far more frequent **Cure** casts. High Vitality lets them absorb repeated hits.
- Skills beyond "Protect" in the Murmillo tree (Counter Attack, Regeneration) are considered largely obsolete/low-value by expert players — Counter Attack only targets the chest (a poor target priority) and Regeneration heals far less HP than Cure/Cure All.

### Retiarius (Netter / Thrower)
- Signature ability: **Net**, unlocked at level 40. The very first net thrown by a team each match has a guaranteed **100% hit rate**; hit rate then drops sharply for several turns before climbing back up.
- **Netters** run max Speed + high Vitality + 760 MP (so a full Intimidate All still leaves enough MP for one Net) and also carry Cure and a small Boost Morale for emergency MP transfers to teammates.
- **Throwers** are a Retiarius variant that trade Speed for Dexterity/Strength, relying on **Throw** (the highest critical-hit-rate skill in the game when maxed) for damage instead of pure support.
- Skill note: prioritize **Bleed Reduce** over **Dodge Plus** on high-Vitality netters — higher HP pools bleed for more, making bleed mitigation the better investment.

### Dimachaerus (Dual Wielder / Burst DPS)
- Signature ability: **4x Combo**, unlocked at level 40 — capable of 1,500–4,500 damage in a single turn depending on stat allocation.
- Extremely fragile (low Defense/Vitality) and must be paired with a Speed-based Protector, or it will lose a leg almost immediately and become useless.
- **Must maintain 760+ MP** — anything less risks being unable to afford the 4x Combo's MP cost after a single enemy Intimidate All.
- Three stat-priority variants:
  - **Dexterity-based DW:** ~250 Speed / 350 Dex / 150 Str. Relies on high critical-hit frequency to shred high-Defense tanks (little benefit past ~380–400 Dex, since 516 Defense is the practical cap countered by that amount).
  - **Speed-based DW:** ~350 Speed / 250 Dex / 150 Str. Trades per-hit damage for drastically more frequent turns — can out-tempo a slower Protector+DW pairing entirely and avoids "wasted" overkill damage.
  - **Strength-based DW (community-tested best for end-game PvP):** ~400 Str / 150 Dex / 197 Speed, plus high Vitality and 760 MP. Deals heavy guaranteed damage even at 0 MP (locked out of combo skills), which matters against double-screamer enemy teams.
  - Rule of thumb: never drop a DW below **197 Speed** — below that threshold, a 515-Speed enemy Screamer gets two turns before the DW gets even one, which is enough for two Intimidate Alls to zero their MP.
  - Weapon-hand tip: place the **higher-damage weapon in the left hand** — combo hit order (strong/medium/weak) is weighted so the left-hand weapon contributes more total damage.

### Thraex (Two-Handed Weapon User)
- Uses massive single-hit weapons for high burst damage, but expert consensus considers this the weakest end-game archetype:
  - A two-handed weapon occupies both equipment slots that a dual-wielder would otherwise fill with two separately-bonused one-handed weapons — meaning a Thraex effectively forfeits an entire second item's worth of stat bonuses (e.g., losing out on an extra +20 STR/+20 SPD/+10 DEX roll).
  - The class's unique power-up skills (**Berserk**, **Strike of the Will**) are considered "useless": Berserk wastes an entire turn to power up (a turn in which the enemy could instead cripple your leg or land the first hit), and Strike of the Will's MP drain isn't offset by a worthwhile payoff.

---

## 12. Core Combat Formulas & Hard Numeric Caps

These are empirically-derived numeric constants and thresholds discovered through extensive player testing — critical for min-maxing a gladiator build.

### Stat Caps (Maximum Achievable Values)

| Stat | Maximum Value |
| :--- | :--- |
| Strength (STR) | **521** |
| Dexterity (DEX) | **508** |
| Defense (DEF) | **516** |
| Speed (SPD) | **515** |
| Vitality (VIT) | **383** |

### Hit / Miss Resolution
- **Rule of thumb: 1 Dexterity effectively counters 2 Defense.** If your Dexterity is not at least half of the opponent's Defense, you will miss indefinitely regardless of Strength.
- **340 Dexterity** is sufficient to guarantee hits against a gladiator with the maximum possible Defense (516).
- Misses are purely a function of insufficient Dexterity relative to the target's Defense — Strength has no bearing on accuracy.

### HP, Vitality & Body-Part Distribution
- **1 Vitality = 56 HP at level 70** (Vitality's HP value scales with character level; each additional level makes 1 Vitality point worth ~0.8 more HP).
- Total HP is split across body parts in fixed percentages:
  - **Torso: 23%**
  - **Head: 17%**
  - **Each Arm: 15%**
  - **Each Leg: 15%**
  *(Torso + Head + 2 Arms + 2 Legs = 100% of total HP)*
- **Life Boost** grants **100 HP per skill point invested**, capping at **+1,500 HP** at max rank (15/15).
- **Armor value effectively doubles in actual combat application** versus its displayed/listed number.

### Blocking & Critical Hits
- Block Chance is a flat percentage derived directly from a shield's Block Value stat.
- The **highest obtainable Block Value/Chance is 72%**.
- **Throw** has the single highest critical-hit rate of any skill in the game when fully maxed.
- **Shield Bash** hits harder per-combo than any other single skill, but has a lower crit rate than Throw.
- Weapons with **wider min–max damage ranges crit less often** than weapons with tighter/smaller damage ranges.

### Equipment (Max-Speed Set) Requirements
- Achieving the maximum 515 Speed cap requires a very specific gear combination:
  - **Leg armor:** Chainmail-type greaves/boots (uniquely only −4 Speed penalty vs. heavier leg armor types).
  - **Shield:** A "Bladed" shield type (uniquely grants +4 Speed, effectively +5 net after chainmail's reduction).
  - Remaining slots (Head, Chest, Arms, Weapon) ideally rolled with **+20 Speed** each via Blacksmith crafting or Olympus shop farming.

### Skills Considered "Useless" by Expert/End-Game Players
Per extensive PvP testing, the following skills are widely regarded as low-value traps not worth investing points into:
- Berserk
- Strike of the Will
- Critical Boost
- Armor Break
- Crowd Appeal Boost
- Regeneration
- Counter Attack Boost
- Blood Rage

---

## 13. Morale Points (MP): The Hidden Second Resource System

MP (referred to interchangeably as "Morale Points" and — in some contexts — "Mana Points") is the resource that fuels every active skill, and top-level PvP is largely a game of controlling the opponent's MP pool rather than raw damage racing.

### Core MP Mechanics
- **Crowd Appeal** is the in-combat action used to regenerate a gladiator's own MP.
- **Intimidation** removes roughly **75–80% of a target's maximum MP** in a single cast; **Intimidate All** applies this to the *entire* enemy team simultaneously.
- Whichever team's Screamer successfully casts Intimidate All *first* typically dictates the outcome of the whole match — this is why Speed is the single most valuable stat for support gladiators.
- **5 MP invested/gained roughly correlates to +1.00 greater Crowd Appeal restoration capacity.**

### Charisma-to-MP Restoration Table
The amount of Charisma required to fully restore 100% of a gladiator's MP pool in a *single* Crowd Appeal scales with their maximum MP total:

| Max MP Pool | Charisma Required for Full Restore (1 Crowd Appeal) |
| :--- | :--- |
| 760 MP | 365 Charisma |
| 750 MP | 360 Charisma |
| 600 MP | 285 Charisma |
| 550 MP | 260 Charisma |
| 440 MP | 204 Charisma |
| 320 MP | 145 Charisma |

### The "sCreamer" Technique (Low-MP Screamer Optimization)
A key discovered exploit-of-mechanics: rather than chasing the highest possible MP pool (as older community wisdom assumed), an expert-tier Screamer instead **deliberately keeps MP low (commonly 440 MP)** paired with high Charisma (~200):
- At 440 MP, an enemy Intimidate All only strips 75% (330 MP), leaving the sCreamer able to Crowd Appeal back to **full** MP using achievable Charisma — something mathematically impossible at higher MP pools (which would require 280+ Charisma while also maintaining max Speed).
- This flips the entire MP war: after the first exchange, the *enemy* screamer ends up permanently pinned near 0 MP while the sCreamer enjoys full MP every single turn.
- Minimum sCreamer build requirements: **515 Speed, ~200 Charisma, 440 MP.**

### The "Buildup Technique"
- A slower but more universal method of winning the MP war: even a gladiator that *cannot* fully restore MP in one Crowd Appeal can still gain net MP over several turns faster than the enemy can strip it, gradually "swimming upstream" until they cross the threshold needed to use a big skill (e.g., a Retiarius's Net, or a Dual Wielder's 4x Combo).
- Example progression for a "Cnetter" (Charisma-based Netter) with 760 MP / 271+ Charisma: `0 MP → Crowd Appeal (+605) → enemy Intimidate All (−570, leaves 35) → Crowd Appeal (+605) → Intimidate All (leaves 70) → ...` — each cycle nets a growing MP surplus until enough is banked to cast Net again.

### Rapid MP-Leveling Trick (Single-Player Farming)
- A gladiator's **maximum MP pool itself levels up over time**, and the primary driver of that permanent MP growth is how many times **Crowd Appeal** was used *during* a battle.
- To farm this efficiently: fight an easy, low-level opponent (e.g., the first Londinium enemy) with a high-Speed gladiator, spam **Crowd Appeal** repeatedly every turn, and deliberately **avoid finishing the enemy off** (killing requires dealing more than 50 damage past their last 0 HP threshold) — instead let them "bleed out" naturally so the fight runs long enough to rack up dozens of Crowd Appeal casts before it ends.
- This trick can raise a gladiator's max MP by 100+ points in under an hour of farming — a process that would otherwise take hundreds of matches.
- Conversely, to *avoid* raising MP on a purpose-built low-MP gladiator (like a sCreamer), simply refrain from Crowd Appealing, or refresh/reload before the post-victory loot screen registers the match as complete.

---

## 14. Turn Order: The Early-Game "Chess Match"

Expert PvP players describe the first few turns of any match as the most decisive part of the entire fight, governed by several distinct, testable variables:

1. **Match Invitation Bias:** When Speed is tied between opposing gladiators, the player who *receives* the battle invitation appears to gain a slight first-turn advantage over the player who *sent* it. Competitive players mitigate this by playing an even number of matches, alternating who sends the invite.
2. **Row/Slot Placement:** Positioning a gladiator in the **Top / Middle / Bottom** roster slot (not simply front/back) can determine turn priority between gladiators who otherwise share identical Speed values — a frequently overlooked tactical lever.
3. **The "Triple Max-Speed" Turn-Skip Bug/Quirk:** Fielding *three* gladiators who all sit at maximum Speed (515) simultaneously causes an early turn in the sequence to be skipped entirely. To avoid losing a turn during the critical opening exchanges, at least one team member must be kept intentionally below the max-Speed threshold.

### Practical Early-Game Sequencing (Recommended Team Order of Operations)
For a standard three-gladiator team (Screamer + Dual Wielder + Protector), expert guides recommend this exact opening sequence every match:
1. **Screamer casts Intimidate All first** — this denies the enemy team the MP needed for their own high-cost skills (e.g., preventing an enemy net throw or 4x Combo).
2. **Protector casts Protect on the Dual Wielder** (never on the Screamer, whose low-MP sCreamer build doesn't need shielding as urgently).
3. **Dual Wielder finishes off weakened opponents**, since both enemy Dual Wielders and Two-Handers have their primary weapon-hand disabled/targeted first, neutralizing their highest-damage threats before they can retaliate.

---

## 15. Full Beginner-to-Endgame Progression Path

A condensed, no-mistakes leveling path assembled from community walkthroughs:

### Early Game (Londinium Onward)
1. Start with a female first gladiator (historically noted as slightly statistically favorable) and immediately equip a **Shield + Spear**, learning Shield Bash ASAP.
2. Spend **all early stat points into Speed only** — this single-mindedly ensures first-turn advantage as a baseline habit before specializing further.
3. Loot/buy armor, shields, and spears from early shops; supplement the roster with 720–730 MP gladiators purchased from the Slave Market, built identically.
4. Recommended early skill order for every gladiator: `Shield Bash 5/10 → Throw 10/10 → Shield Bash 10/10 → Life Boost 1/10 → Cure 10/10 → 2x Combo 5/10 → Speed Boost 15/15`.

### Mid Game (Shopping & Gearing)
- Continuously swap shields for higher block-rate versions and prioritize any bonus Vitality on found equipment.
- Hold off on serious equipment shopping until reaching **Olympus**, the best/final-tier shop location.
- In Olympus, farm specifically for a **max-Speed gear set** (+20 Speed per slot, Chainmail legs, Bladed shield) — raw Armor value on items is not a priority at this stage.
- Aim to assemble one full high-Speed/Dex/Str set and one high-Speed/Vitality set for build flexibility.

### Late Game (Finishing the Campaign)
- Rush through remaining Coliseums, deliberately skipping side-goals at first, prioritizing simply reaching Olympus (the shopping hub) as fast as possible.
- Return afterward to mop up all remaining city goals, saving the 20 Rome "Contenders" gauntlet for last.
- Respec the team into its final endgame trio:
  1. **Original gladiator → sCreamer:** Max-Speed gear, `15/15 Speed Boost + 10/10 Intimidate All`, all stat points into Speed.
  2. **Second gladiator → Dual Wielder:** Speed/Dex/Str gear set, `10/10 Combo (4x) + 15/15 Dex Boost`, ~340 Dex / 197+ Speed minimum / remainder Strength.
  3. **Third gladiator → Protector:** `15/15 Speed Boost + 10/10 Protect` (Defense Boost capped at 10/15), 150+ Vitality (160 ideal), remainder into Speed.
- Use the exact three-step opening sequence from Section 14 against every one of the 20 Rome Contenders.

---

## 16. Post-Battle "Crowd's Wishes" Screen

At the conclusion of a victorious arena battle, the game presents a **Crowd Verdict / Loot** screen with a binary decision on the fallen opponent's fate:

- **Spare:** Letting the defeated (but not overkilled) enemy live. This is required if you intend to farm a repeatable, non-lethal match for MP-leveling purposes (see Section 13's Crowd Appeal farming trick), since the opposing gladiator must survive to be fought again.
- **Execute:** Finishing the opponent off, which is the default expected outcome of a decisive win and ties into the game's Roman "thumbs up/thumbs down" arena theming.
- **Overkill Threshold:** Dealing more than 50 damage past an enemy's last point of HP counts as a kill outright during the fight itself, bypassing the crowd's-wishes prompt entirely — relevant when trying to deliberately *avoid* ending a farming match early.
- Refreshing the browser at this loot screen (in the original Flash version) before confirming was a known technique to reroll blacksmith crafting results or avoid an unwanted permanent MP-level gain from a completed match.

---

## 17. Quick-Reference Cheat Sheet

```
┌───────────────────────────────────────────────────────────────────────┐
│ STAT CAPS      STR 521 | DEX 508 | DEF 516 | SPD 515 | VIT 383         │
│ HIT RULE       1 DEX counters 2 DEF | 340 DEX beats max 516 DEF        │
│ HP SPLIT       Torso 23% | Head 17% | Each Arm 15% | Each Leg 15%      │
│ VITALITY       1 VIT = 56 HP @ Lvl70 (scales ~+0.8HP/level thereafter) │
│ LIFE BOOST     +100 HP per point | Max = +1,500 HP (15/15)            │
│ BLOCK CAP      Highest shield Block Chance/Value = 72%                │
│ ARMOR NOTE     Displayed armor value effectively doubles in combat    │
│ MAX-SPEED KIT  Chainmail legs (-4 SPD) + Bladed shield (+4 SPD)       │
│                + 20 SPD rolls on remaining slots = 515 SPD cap        │
│ INTIMIDATE     Removes ~75-80% of target(s) current Max MP            │
│ CROWD APPEAL   Restores MP; 5 MP ≈ +1.00 Crowd Appeal power           │
│ FARM MP        Spam Crowd Appeal vs weak foe, Spare (don't kill) them │
│ NEVER INVEST   Berserk, Strike of the Will, Critical Boost,           │
│                Armor Break, Crowd Appeal Boost, Regeneration,         │
│                Counter Attack Boost, Blood Rage                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 18. Visual & Appearance Guide (For Accessibility / Full Sensory Description)

This section describes exactly what the game *looks* like — colors, shapes, textures, layout, and art style — verified directly from the actual game (captured via a live emulator playthrough), so it can be read aloud or converted to a mental image without ever seeing the screen.

### 18.1 Overall Art Style

Sands of the Coliseum uses a **hand-painted, semi-realistic illustrated art style** for its "camera-facing" character portraits (the large head-and-shoulders bust shown during combat and dialogue), combined with **flat-shaded, simplified cartoon-style sprites** for the small full-body characters that actually move around the arena floor. This creates two distinct visual "layers" on screen at once:

1. **Portrait layer** — painterly, almost photo-real digital painting with soft shading, wrinkles, stubble, and moody lighting. Used for the trainer, opponents, and dialogue "talking head" shots.
2. **Sprite layer** — small, simplified, brightly colored 2D animated figures (the actual gladiators fighting), styled more like a flash-animation cartoon: thick smooth limbs, minimal facial detail, and bold simple color blocking (skin tone, tunic color, hair color) rather than fine texture.

The overall mood is **gritty, blood-and-sand Roman epic** — think "history-channel documentary meets flash-cartoon" — rendered mostly in warm earth tones (sand, leather-brown, bronze, blood-red) contrasted against cool stone grays and blues.

### 18.2 Color Palette by Screen

| Screen/Context | Dominant Colors | Description |
|---|---|---|
| **Title screen** | Cream/tan, blood-red, gold, black | A bloodied gladiator helmet (tan/cream metal streaked with dark red blood) sits beside large gold-and-red ornate lettering reading "SPQR" over "SANDS OF THE COLISEUM." Background is a dim, blurred stone arena with indistinct crowd silhouettes. |
| **Studio splash screen** | Pure black & white | A stark, high-contrast viking/warrior skull emblem with dangling chain and skull ornaments, presented like a stencil/woodcut, on a plain white background. No color at all — a deliberate contrast to every other screen. |
| **Intro cinematic** | Warm gold-orange sky gradient, gray-blue silhouette, tan stone | A bold black-outlined silhouette of a crouched gladiator figure in the foreground, positioned in front of sunlit stone Coliseum exterior arches. The sky graduates from deep gold at the horizon to lighter orange/cream higher up, evoking sunrise or sunset over Rome. |
| **Main menu** | Black background, orange/gold fire-glow, bronze armor tones | A full-color painted gladiator in ornate bronze/steel plate armor and a horsehair-crested helmet stands to the right in a dramatic action pose, lit from below by an orange-gold fire glow that fills the bottom third of the screen like embers or torchlight. A gold-and-bronze eagle (the SPQR eagle) with outstretched wings spans the top of the screen. Menu buttons ("START," "CREDITS," "MORE GAMES") are rendered as red ribbon-banners with gold winged accents and gold rope/rivet borders, cream-white all-caps text. |
| **Gender-select screen** | Black background, orange-red fire glow at base, cream/red/brown character colors | A muscular red-haired male gladiator in a white toga-like tunic with a brown leather belt stands on a round stone pedestal/column, sword drawn, silhouetted against the same gold eagle emblem. Orange-red flame/ember glow fills the bottom of the screen beneath the pedestal. Two option panels (MALE/FEMALE) use the same red-ribbon-and-gold styling as the main menu. |
| **Character customization** | Black background, red ribbon UI, orange fire-glow base | Same red-haired male gladiator sprite as above, now larger and posed mid-action (crouched, blade forward). To the right, a stack of red ribbon-style option bars (SKIN / HEAD / HAIR / CLOTH) each with gold left/right triangle arrow buttons for cycling choices, and text-entry ribbons for Team Name and gladiator Name at the top. |
| **Battle/arena screen** | Sandy tan floor, warm gray stone walls, blood-red UI trim | The fighting arena is a flat sandy-tan floor (like a desert or beach), bordered at the top by tall, weathered gray stone archways/tunnels (the entrances gladiators emerge from), with visible cracks, moss-dark shadows, and metal portcullis-style grates in the tunnel mouths. All UI chrome (buttons, health/MP tray) uses the same blood-red-and-gold ribbon styling as the menus, giving strong visual continuity across the whole game. |
| **Trainer/NPC portraits** | Olive-green/sallow skin tones, bronze armor, muted browns | The trainer character has a weathered, aged, slightly sickly olive-green complexion, thinning blond/gray hair, and heavy bronze pauldron (shoulder armor) over a dark leather harness — a deliberately unglamorous, world-weary "grizzled veteran" look contrasted against the more idealized player-gladiator sprite. |

### 18.3 UI Chrome & Interface Styling (Consistent Across the Whole Game)

Every menu, button, and dialogue box in the game shares one unified visual language:

- **Buttons** are shaped like wide horizontal ribbons or banners with pointed/notched ends (like a stone tablet or military standard), colored **deep blood-red** with a **gold rope-and-rivet border** running around the edge. Small gold "wings" or angular flourishes often decorate the left and right ends of the more important buttons (START, DONE, RANDOM).
- **Text** is always **all-capital letters**, in a bold, slightly condensed serif/gothic-inspired font. Body/instructional text is **cream-white**; button labels and important keywords are rendered in **bright gold/yellow**, making them "pop" against the red background.
- **Dialogue and tutorial pop-up boxes** are large rounded-rectangle panels with a **gradient red interior** (darker red at the edges fading to a brighter red-orange center glow) and a **thick gold picture-frame border** with a distinctive circular rivet/bolt detail in each of the four corners — visually resembling an ornate framed parchment or shield.
- **Confirm/navigation buttons** (SKIP, NEXT, BACK, DONE, OK) are smaller versions of the same red-and-gold ribbon button, always placed at the bottom corners of dialogue boxes.
- **Background textures** throughout the non-battle menus are **solid black or near-black**, which makes the red/gold UI elements and the colorful character art stand out sharply — there is no cluttered background pattern behind menus, just character art and a soft glow.
- **Left-side action menu** (used in combat) is a vertical stack of the same red ribbon buttons — ATTACK, TECHNIQUE, BLOCK, CROWD APPEAL, ROW — running down the top-left corner of the screen. Buttons that are currently unavailable (e.g., TECHNIQUE or BLOCK when not usable that turn) are shown in flat **desaturated gray** instead of red, giving an immediate color-coded "greyed out" cue.
- **Attack sub-menu**: selecting ATTACK slides out a secondary column of three smaller red buttons — WEAK, MEDIUM, STRONG — directly to the right of the main button, each pointed at by a small red arrow icon during tutorial callouts.

### 18.4 The Turn-Order Queue (Right Edge of Battle Screen)

Running down the right edge of the arena screen is a vertical strip of small circular **portrait tokens**, one per combatant, stacked in the order they will act. Each token is a small round "coin" bearing a close-up face icon — reddish/warm-toned for human gladiators, and a different beast-like reddish icon for certain enemies (e.g., a boar-like face was observed for one enemy type) — all outlined in the same gold ring styling as the rest of the UI. A red-ribbon "NEXT TURN" button sits directly above this queue at the very top-right corner of the screen.

### 18.5 Health/MP Tray (Bottom of Battle Screen)

A single wide horizontal red-and-gold ribbon bar spans the full width of the screen at the very bottom of the arena view. It is split into a **left half** (your team) and a **right half** (enemy team), each showing:
- A small circular portrait icon of the fighter's face.
- A small full-body silhouette icon (colored solid red) representing that fighter's body, used as the target reticle when choosing which body part to attack — an arrow icon points at the silhouette during tutorial explanations.
- A numeric **"MP: 40"** style readout in cream-white text next to the portrait, showing current Morale Points.
- Small gold-winged flourish icons bookend each end of the tray, matching the eagle-and-wing motif used throughout the game's borders.

### 18.6 Character & Armor Appearance

- **Base/unarmored gladiator sprite**: a simplified cartoon figure with visible skin tone (default sample: fair skin, red/auburn hair), wearing only a **white cloth tunic/loincloth** cinched with a **brown leather belt**, and simple **strap sandals**. This is the "naked" starting silhouette before armor is equipped.
- **Armor changes the sprite's silhouette directly** — as pieces are equipped, the flat-colored sprite gains visibly chunkier, angular shapes over the corresponding body part (e.g., a helmet adds a rounded metallic head shape covering the hair, shoulder-guards add wide rectangular blocks over the arms, greaves add articulated shin plates over the legs). Because combat targets six distinct body zones (Head, Torso, L/R Arm, L/R Leg), and armor is itemized per zone, a fully-armored gladiator looks visibly "built up" and blocky compared to the slim unarmored default sprite — you can tell how equipped a fighter is at a glance just from how bulky/angular their outline looks.
- **Metal armor pieces** are rendered in **muted bronze, steel-gray, or tan/cream metallic tones** (matching the bloodied cream-tan helmet seen on the title screen), often with a darker shaded underside to imply curvature and weight.
- **Weapons** appear as small, simple flat-shaded icons/props in-hand (e.g., a short curved blade/sica was visible on the default starting sprite) and also appear as standalone "dropped weapon" set-dressing objects on the arena floor (a large stylized sword stuck blade-down in the sand was visible near the center of the tutorial arena, unrelated to any character — likely decorative arena dressing).
- **NPC/veteran portraits** (like the trainer) intentionally use **duller, sicklier skin tones** (olive/gray-green) and heavier, more weathered armor to visually separate "grizzled background/mentor characters" from the more vibrant, idealized player-controlled gladiator sprites.

### 18.7 Sound Cues (Non-Visual Accessibility Note)

The main menu includes a visible **Quality (Low/Med/High)** toggle and separate **Sound** and **Music** volume sliders (shown as a row of small square gold-bordered blocks that fill in to indicate volume level, similar to a bar graph), plus a mute/speaker icon in the top-right corner of the game viewport that can silence audio entirely — useful to note for anyone adjusting audio-based feedback.

### 18.8 Summary "Mental Image" for a Blind Player

If you had to picture the whole game in one sentence: *it looks like a moody, painted Roman history poster (warm gold firelight, dark blood-red banners, bronze armor, sun-baked sandstone arches) wrapped around a simple, colorful flash-cartoon of two little gladiators trading hits on a sandy floor, with every single menu, button, and health bar sharing the same "ancient battle-standard" red-ribbon-and-gold-rivet picture frame so the whole interface feels like one continuous carved stone/leather artifact rather than a modern flat UI.*

---

## 19. Complete Menu & Button Reference (Every Screen, Every Button)

This section walks through **every menu screen in the game in the order you naturally encounter them**, listing every visible button, field, and control on that screen, what it does, and where it takes you. All entries below were confirmed directly against a live playthrough of the actual game.

### 19.1 Boot / Pre-Game Screens

```
┌───────────────────────────────────────────────────────────────────────┐
│ SCREEN            │ BUTTONS/CONTROLS               │ WHAT IT DOES     │
├────────────────────┼─────────────────────────────────┼──────────────────┤
│ Loading screen     │ (single click-anywhere prompt)  │ Boots the Flash  │
│                    │                                  │ engine.          │
│ Studio splash      │ (auto-advances / click to skip)  │ Shows "Berzerk   │
│                    │                                  │ Studio" logo.    │
│ "BERZERK STUFF"    │ PLAY                             │ Starts the game  │
│ splash             │                                  │ proper.          │
│ Intro cinematic    │ SKIP                             │ Skips the        │
│                    │                                  │ animated intro   │
│                    │                                  │ narration.       │
└───────────────────────────────────────────────────────────────────────┘
```

### 19.2 Main Menu (Title Screen)

The main menu is a single black screen with a large painted gladiator on the right, the gold SPQR eagle at the top, and the "SANDS OF THE COLISEUM" logo in the center. Controls, top to bottom / corner to corner:

| Button/Control | Location | Function |
|---|---|---|
| **Quality (Low/Med/High)** toggle | Top-left | Switches rendering quality (affects visual fidelity, not gameplay). |
| **Language arrows (◀ English ▶)** | Top-left, below Quality | Cycles the game's text language. |
| **Sound slider** | Top-left | Adjusts sound-effect volume (bar-graph style, click to set level). |
| **Music slider** | Top-left | Adjusts background-music volume. |
| **Speaker/mute icon** | Top-right corner | Instantly mutes/unmutes all game audio. |
| **Fullscreen icon** | Top-right corner | Expands the game to fill the browser/screen. |
| **START** | Center, red ribbon button | Begins a **new game** — leads into Gender Select if no save exists, or resumes an existing save. |
| **CREDITS** | Center, below START | Shows the development team credits. |
| **MORE GAMES** | Center, below CREDITS | Opens a promotional list of other Berzerk Studio games (an ad wall — non-functional in the archived offline version). |
| **DELETE ALL** | Bottom-left | Wipes all save data — used to restart from scratch. |
| **HOST GAME** | Bottom-right | Legacy multiplayer/lobby hosting option (from when the game was hosted on portals with live servers — non-functional offline). |

A "**VERSION UPDATE**" patch-notes popup may appear over this screen on first load, with a single **OK** button to dismiss it.

### 19.3 Character Creation Flow

**Screen 1 — Gender Select**
| Button | Function |
|---|---|
| **MALE** | Chooses a male gladiator; grants a **Strength bonus** (males start with higher STR). |
| **FEMALE** | Chooses a female gladiator; grants a **Charisma bonus** (females start with higher CHA). |
| **BACK** | Returns to the main menu. |
| **DONE** | Confirms gender choice and proceeds to the Customization screen. |

The on-screen bonus text reads: **MALE** — *"STRENGTH BONUS — MALES START WITH MORE STRENGTH THAN FEMALES"*; **FEMALE** — *"CHARISMA BONUS! — FEMALES START WITH MORE CHARISMA THAN MALES."*

**Observed starting stats** (fresh male gladiator, Level 2 after the tutorial): Charisma 10, Strength 13, Dexterity 10, Defense 10, Speed 10, Vitality 10 — producing **HP 508**, **MP 40**, **Damage 17–34**, and **Armor 20**. (The elevated starting Strength of 13 reflects the male STR bonus.)

**Screen 2 — Customization**
| Button/Field | Function |
|---|---|
| **TEAM NAME** (text field) | Names your gladiator school/stable (defaults to a random name like "Remus' Gladiators"). |
| **NAME** (text field) | Names your individual starting gladiator (defaults to a random Roman name like "Hortensius Antonius"). |
| **SKIN ◀ / ▶** | Cycles the character's skin tone. |
| **HEAD ◀ / ▶** | Cycles face/head shape options. |
| **HAIR ◀ / ▶** | Cycles hairstyle/color options. |
| **CLOTH ◀ / ▶** | Cycles the starting tunic's color/pattern. |
| **RANDOM** | Randomizes all four appearance options at once. |
| **BACK** | Returns to Gender Select. |
| **DONE** | Confirms the character and begins the Tutorial Battle. |

### 19.4 Battle Screen (In-Combat Menu & Buttons)

The battle screen has a persistent left-side vertical action menu, a right-side turn-order queue, and a bottom health/MP tray. All are visible simultaneously during combat.

**Left action menu (top-left corner):**
| Button | Function |
|---|---|
| **ATTACK** | Opens a fly-out sub-menu with three attack-strength choices (see below). This is your basic weapon attack. |
| **TECHNIQUE** | Opens your equipped active skills/special moves menu (costs MP). Greyed out/unusable if no MP or no techniques equipped. |
| **BLOCK** | Raises your shield/guard for the turn, increasing chance to block incoming hits (costs a turn; no target selection needed). |
| **CROWD APPEAL** | Performs a showman action to the crowd, restoring your own MP (no damage dealt). |
| **ROW** | Changes/swaps your fighter's front-row/back-row position, affecting turn order and who can be targeted. |

**Attack fly-out sub-menu (appears beside ATTACK):**
| Button | Function |
|---|---|
| **WEAK** | Low damage, **high accuracy/precision** — safest choice, good vs. well-armored or high-DEF enemies. |
| **MEDIUM** | Balanced damage and accuracy — the default all-purpose option. |
| **STRONG** | High damage, **low accuracy/precision** — riskiest, best used against low-DEF, low-block targets or to finish a wounded enemy. |

**Targeting reticle (appears after choosing an attack type):**
- A full-body silhouette of the enemy appears in the center of the arena floor, divided into 6 clickable zones (Head, Torso/"Body," Left Arm, Right Arm, Left Leg, Right Leg).
- Hovering a zone highlights it gold/yellow and shows a floating tooltip with the zone name (e.g., "BODY"), your **Hit %** chance against that zone, and the target's current **HP** for that zone (e.g., "117/117").
- Clicking a highlighted zone commits the attack against that specific body part.

**Top-right corner:**
| Button | Function |
|---|---|
| **NEXT TURN** | Ends your current fighter's turn and advances the turn order to the next combatant (used once you have no more actions to take, or to pass). |

**Right-edge turn-order queue:**
- A vertical stack of small circular portrait tokens shows the upcoming turn order for every combatant (yours and the enemy's), soonest-to-act at the top.

**Bottom health/MP tray (spans full width):**
- **Left half** = your team: circular portrait, red body-silhouette icon (click-target shortcut), and "**MP: 40**"-style numeric readout.
- **Right half** = enemy team: mirrored layout.
- **QUIT** button (bottom-right corner) — forfeits/exits the current battle immediately.

**Post-attack floating labels:** When an attack resolves, a small floating banner reading **WEAK / MEDIUM / STRONG** (matching the attack type used) pops up near the turn-order queue to confirm what just happened.

### 19.5 Post-Battle Screens

**"Crowd's Wishes" screen** (appears after defeating the final enemy, before the victory screen):
| Button | Function |
|---|---|
| **MERCY** | Spares the defeated foe. Grants **bonus XP + MP-level boost**. |
| **BLOOD** | Executes the defeated foe. Grants **extra loot** instead. |

**Victory/Loot screen:**
| Button/Element | Function |
|---|---|
| Gladiator card (portrait, name, Level, EXP bar, MP-Level bar) | Shows your fighter's post-battle status and any level-up progress. |
| **+[X] GP** (gold coin icon) | Shows gold earned from the fight. |
| **LOOT** grid | Shows items dropped by the defeated enemy (locked/empty slots shown with a red "X" if nothing dropped there). |
| **INVENTORY** grid | Your school's shared item storage — loot can be dragged here. |
| **LOOT ALL** | Instantly claims every item in the loot grid into your inventory. |
| **DONE** | Confirms and exits the results screen (may trigger a "discard unclaimed loot?" **YES/NO** confirmation if you leave items unclaimed). |

### 19.6 World/Campaign Map Screen

The map is a parchment-style illustration of the Mediterranean/Roman Empire with diamond-shaped city nodes and a compass rose. Controls:

| Button/Element | Location | Function |
|---|---|---|
| **Quality/Sound/Music controls** | Top-left | Same audio/quality settings as the main menu, always accessible. |
| **Gold count** (coin icon + number) | Left side | Shows your current gold total. |
| **"+" (Gladiator quick-add) icon** | Left side | Shortcut, likely to recruit/add a new gladiator slot (context-dependent availability). |
| **City nodes (diamond icons)** | Scattered across the map | Click to select/travel to that city; locked cities may be greyed out until you reach the required rank. |
| **City name banner** (e.g., "LONDINIUM") | Bottom-center | Displays the currently selected city's name in a ribbon banner. |
| **City description text** | Bottom | Flavor text describing the selected city's history/specialty. |
| **BACK** | Bottom-right | Returns to whichever screen led here (or closes the city panel). |

**Right-side vertical menu (always visible on the map):**
| Menu Item | Function |
|---|---|
| **INVENTORY** | Opens your gladiator's equipment/stats screen (see 19.7). |
| **SKILL** | Opens the attribute + skill-tree allocation screen (see 19.8). |
| **TEAM** | Opens your full roster of gladiators (for managing/swapping which fighters are active — requires more than one gladiator to be meaningful). |
| **BLACKSMITH** | Opens gear crafting/upgrading (requires materials/ingots to be useful; appears greyed out early on). |
| **TROPHIES** | Opens your achievements/trophy case. |

**Left-side city sub-menu (appears once a city is selected):**
| Menu Item | Function |
|---|---|
| **COLISEUM** | Opens the opponent-selection/fight-list screen for that city (see 19.9). |
| **SHOP** | Opens that city's equipment shop (see 19.10). |
| **SLAVE MARKET** | Opens the recruitment screen to buy new gladiator slaves (locked until a sufficient level/rank is reached). |
| **MULTIPLAYER** | Opens PvP team-battle options against other players' rosters. |

### 19.7 Inventory / Character Screen

| Element | Function |
|---|---|
| Character sprite (left pedestal) | Shows your gladiator wearing currently equipped gear. |
| Equipment mannequin (right pedestal, gold silhouette) | The "paper doll" you drag gear onto to equip it. |
| Name plate | Shows the gladiator's name. |
| **Level / Exp bar / Fame bar** | Shows current level and progress to next level, plus overall "fame" meter. |
| **Stat list** (Charisma, Strength, Dexterity, Defense, Speed, Vitality) | Shows raw attribute values. |
| **Derived stats** (Damage, Armor, HP, MP) | Shows the combat numbers those attributes produce. |
| **Inventory grid** (6 columns × multiple rows of red slots) | Your stored, unequipped items. |
| Gold count | Shows current gold. |
| **SKILL** | Jumps to the Skill/Attribute allocation screen. |
| **DONE** | Closes this screen and returns to the map. |

### 19.8 Skill / Attribute Allocation Screen

| Element | Function |
|---|---|
| **Remaining Points: [X]** (attribute side) | Shows unspent stat points available to allocate. |
| **[+] Charisma / Strength / Dexterity / Defense / Speed / Vitality** | Each has its own gold "+" button — click to spend one point raising that stat by 1. |
| **RESET** | Refunds all spent attribute points so you can reallocate from scratch. |
| Gladiator card (bottom-left: name, Level, HP, MP, Exp, MP-Lvl bar, gold) | Status summary, same as elsewhere. |
| **Skill tree (right side)** — 5 columns labeled **Retiarius, Thraex, Provocatores, Murmillo, Dimachaerus** | Each column is one of the five weapon-class skill trees; hexagonal nodes are individual skills connected by branch lines, each showing a point-cost fraction (e.g., "0/15"). Clicking a node (if unlocked/affordable) invests a skill point into it. |
| **Remaining Points: [X]** (skill side) | Shows unspent *skill* points (separate pool from attribute points) available for the tree. |
| **INV** | Jumps back to the Inventory screen. |
| **BACK** | Returns to the map. |

**Skill-tree node caps (verified):** each of the five columns is a vertical chain of 8 hexagonal nodes, and each node displays a maximum-rank fraction. Observed caps are **0/5**, **0/10**, and **0/15** — i.e., individual skills max out at 5, 10, or 15 ranks. The *first* node in each tree caps at **5** for Retiarius, Thraex, and Provocatores, and at **10** for Murmillo and Dimachaerus. The 0/15-cap nodes correspond to the high-value passives referenced throughout this manual (e.g., Speed Boost 15/15, Life Boost 15/15).

### 19.9 Coliseum (Fight Selection) Screen

| Element | Function |
|---|---|
| **COLISEUM** header banner | Screen title. |
| **Numbered opponent list** (scrollable, e.g., "13. Vesta's Troublemakers," "14. Titans' Troublemakers"…) | Each row is a rival team you can challenge, shown with their team portrait thumbnail. |
| **FIGHT** (per row) | Challenges that specific team, leading to the VS matchup screen. |
| **"TEAM LOCKED"** label (in place of FIGHT) | Indicates you need a higher rank to challenge that particular team yet. |
| **MULTIPLAYER** (right panel) | Shortcut promoting/opening the multiplayer PvP mode. |
| **GIMME MY REWARD!** | Claims your free once-per-day login/daily bonus. |
| **GOAL** | Opens a screen describing your current objective/quest. |
| **BACK** | Returns to the map. |

**VS Matchup screen (appears after clicking FIGHT):**
| Element | Function |
|---|---|
| Team name banners (left = you, right = opponent) | Confirms the matchup. |
| SPQR eagle emblem | Decorative centerpiece. |
| Fighter name + Level (both sides) | Shows the specific gladiators about to fight and their levels. |
| **VS** | Purely decorative divider text. |
| **FIGHT!** | Commits to starting the battle. |
| **BACK** | Cancels and returns to the Coliseum list. |

### 19.10 Shop Screen

| Element | Function |
|---|---|
| Character sprite + equipment mannequin (left, same as Inventory screen) | Shows your gladiator and equip-target silhouette. |
| Gold count | Shows current gold. |
| **SORT BY:** icon row (weapon / shield / helmet / armor / boots / **ALL**) | Filters the shop's stock grid to only show that category of item; **ALL** shows everything. |
| **SHOP** header, "New stock in: [mm:ss]" | A countdown timer until the shop's inventory refreshes with new randomized items. |
| **Item grid** (2 rows × 6 columns) | Shows purchasable items as icons; empty/sold-out slots show a red "X." |
| **Page [1/3] ▷** | Paginates through additional pages of shop stock. |
| **Item tooltip** (appears on click/hover) | Shows the item's full name (e.g., "Cheap Simple Leather"), **Price** in GP, and its stat bonus (e.g., "Armor: 96"), plus a preview of how equipping it would change your stat panel (shown in colored +/- text). |
| **INVENTORY grid** (below the shop grid) | Your already-owned, unequipped items — items can be dragged between Shop, Inventory, and the equip-mannequin. |
| **BACK** | Returns to the map. |

*Buying/equipping is done by dragging an item icon directly onto the gladiator's mannequin (to equip it immediately) or onto the Inventory grid (to purchase and store it for later).*

### 19.11 Confirmation / Utility Popups (Appear Contextually Throughout)

| Popup | Buttons | Trigger |
|---|---|---|
| "Are you sure you want to QUIT?" | **YES / NO** | Attempting to back out to the main menu/browser from deep in the game. |
| "Are you sure you want to discard items left in loot?" | **YES / NO** | Leaving the Victory/Loot screen without claiming all drops. |
| "VERSION UPDATE" patch notes | **OK** | First load after a game update (archived version shows this once). |
| Tutorial callout boxes (red parchment box with instructional text) | **SKIP / BACK / NEXT** | Appear automatically the first time you reach a new screen type (battle, shop, map, etc.), teaching that screen's mechanics step-by-step. |

---

## 20. Monetization, Daily Rewards & Social Features

The game (a free Flash title) monetizes and retains players through an in-game "get more money" hub, a once-a-day login bonus, and social-media tie-ins to Berzerk Studio. All of this was captured directly from the archived playthrough.

### 20.1 The "There Are 2 Ways To Get More Money!" Screen

A dedicated screen with two tabs is reachable from the in-game economy:

**Tab 1 — "BY SUPPORTING BERZERK STUDIO" (Real-Money / Microtransaction Shop)**
- Header: *"YOU CAN BUY MONEY OR METALS AND DIRECTLY SUPPORT BERZERK STUDIO!"*
- Gold bundles: **10,000 GP**, **25,000 GP**, **50,000 GP** (each with a red **BUY** button).
- Metal-ingot bundles (crafting materials for the Blacksmith), shown as colored ingots:
  - **2 red + 1 blue ingot**
  - **3 red + 2 blue ingots**
  - **"(BEST VALUE)" bundle: 3 red + 2 blue + 1 gold ingot**
- Flavor text: *"SUPPORTING SMALL INDIE STUDIOS MAKES YOU COOL."* — accompanied by an illustration of the studio's characters giving thumbs-ups.
- A **LIKE** (Facebook) button with *"AND GET [ingots]"* — liking the studio page grants free crafting materials.

**Tab 2 — "DAILY REWARD"**
- A 5-day streak calendar (Day 1–Day 5). **Day 1** (marked *"TODAY"*) grants **100 GP**; **Day 2** grants **500 GP**; Days 3–5 show progressively larger stacks of higher-tier ingots.
- Claiming requires an online account connection:
  - *"CONNECTED ON GAMESAFE: NOPE! (CLICK TO CONNECT)"*
  - *"CONNECTED ON FACEBOOK: [Connect with Facebook]"*
- Connecting to an account also grants **free Medals on the first connect** (*"YOU'LL GET FREE MEDALS ON YOUR FIRST CONNECT!"*).

### 20.2 Passive / Offline Earnings

- *"DID YOU KNOW: YOU'LL EARN MONEY AT EVERY BATTLE, EVEN OFFLINE!"*
- *"EVERY TIME A FRIEND BATTLES YOUR TEAM, YOU EARN MONEY... EVEN WHEN YOU'RE OFFLINE!!!"*
- In short: friends challenging your shared team link generate passive gold for you, with or without you being online.

### 20.3 Multiplayer Achievements (3 Pages)

The multiplayer menu contains an **ACHIEVEMENTS** panel spread across three pages, each rewarding gold or crafting materials:

| Achievement | Reward |
| :--- | :--- |
| **WIN 5 BATTLES** | 250 GP |
| **WIN 20 BATTLES** | 500 GP |
| **WIN 50 BATTLES** | 1,000 GP |
| **WIN 100 BATTLES** | 1 silver ingot |
| **WIN 200 BATTLES** | 1 blue gem/crystal |
| **WIN 500 BATTLES** | 1 gold ingot |
| **CHALLENGE A FRIEND** | 150 GP |
| **CHALLENGE 5 FRIENDS** | 250 GP |
| **CHALLENGE 10 FRIENDS** | 750 GP |
| **SHARE THE GAME ON FACEBOOK** | 500 GP |
| **LOGIN INTO FACEBOOK** | 1 crafting material |
| **LOGIN INTO GAMESAFE** | 1 crafting material |
| **LIKE BERZERK STUDIO ON FACEBOOK** | 1 crafting material |
| **WIN 10 MATCHES WITH ONLY ONE GLADIATOR IN YOUR TEAM** | 1,000 GP |
| **WIN 10 GAMES IN A ROW** | 750 GP + 1 crafting material |

> Note: the non-gold reward icons are resource ingots/materials used in Blacksmith crafting (the exact material name for the last few rows is icon-based and not printed as text).

---

## 21. Multiplayer Coliseum & Leaderboard (Friend-Challenge Mode)

The **MULTIPLAYER COLISEUM** screen combines a personal rank readout with a leaderboard and a friend-challenge system (now non-functional offline, but historically important).

- **Rank panel (right side):** shows *"YOUR RANK"*, your current tier (starting at **SLAVE**), an **Exp.** progress bar, and a **RANKED MATCH → FIGHT!** button.
- **Leaderboard (right side):** view the best teams in the world.
- **Friend challenge tutorial (step-by-step popups):**
  1. *"IN THIS SCREEN, YOU CAN BATTLE AGAINST OTHER PLAYERS AROUND THE WORLD."*
  2. *"YOU CAN CHOOSE TO PLAY AGAINST YOUR FRIENDS OR VIEW THE BEST TEAM ON THE LEADERBOARD."*
  3. *"GIVE THIS LINK TO YOUR FRIENDS AND CHALLENGE THEM! WWW.BERZERKSTUDIO.COM/MYLINK"*
  4. *"WHEN CONNECTED ON GAMERSAFE, YOU WILL HAVE A UNIQUE ADDRESS THAT YOU CAN SHARE WITH YOUR FRIENDS TO CHALLENGE THEM."*
  5. *"OR YOU CAN SIMPLY POST YOUR LINK ON FACEBOOK ALONG WITH YOUR RANKED MATCH RANK."*
  6. *"YOU WILL RECEIVE MONEY EACH TIME A FRIEND BATTLES AGAINST YOU. SPREAD THE WORD AND YOU'LL BE GREATLY REWARDED!"*
- Account services are referred to as both **GameSafe** and **GamerSafe** in different screens (an early rebrand — functionally the same login system).

---

## 22. Verified In-Game Text: Tutorials, Tooltips & City Lore

Every string below was read directly off the archived screenshots and confirms or extends the button/mechanics sections above.

### 22.1 Battle Tutorial (Exact Strings)

- *"ALRIGHT! LET'S SEE IF YOU HAVE WHAT IT TAKES TO BE A GLADIATOR!"*
- *"ON THE BOTTOM OF THE SCREEN, YOU WILL SEE YOUR GLADIATORS AND THEIR HEALTH."*
- *"EACH GLADIATOR HAS 6 SPOTS THAT CAN BE AIMED AT AND DAMAGED. THE HEAD, THE BODY, BOTH LEGS AND BOTH ARMS."*
- Attack-strength explanation:
  - **WEAK:** *"LOW DAMAGE, HIGH PRECISION"*
  - **NORMAL/MEDIUM:** *"MEDIUM DAMAGE, MEDIUM PRECISION"* (the tutorial says *NORMAL*, the on-screen button reads *MEDIUM*)
  - **STRONG:** *"HIGH DAMAGE, LOW PRECISION"*
- **Targeting tooltip** (hovering a body zone): shows the zone name, your hit chance, and the zone's HP — e.g., **`Body` `Hit: 83%` `117/117`**.

### 22.2 Map & Travel Tutorial

- *"FOR NOW, ONLY LONDINIUM IS AVAILABLE. YOU'LL HAVE TO BATTLE YOUR WAY UP IN THE RANK TO ACCESS NEW CITIES."*
- *"YOU CAN VISIT THE CITY'S SHOP TO BUY NEW EQUIPMENT AND GLADIATORS, OR FIGHT IN ITS COLISEUM."*
- Locked-city travel requirements are shown in the city panel, e.g., **"REQUIREMENTS: COMPLETE LONDINIUM'S COLISEUM"** (for Massilia).

### 22.3 City Flavor Descriptions (Verified)

| City | In-Game Description |
| :--- | :--- |
| **Londinium** | *"AFTER ITS CREATION, LONDINIUM FAST BECAME THE MOST IMPORTANT BUSINESS CENTER OF THE NORTH OF THE EMPIRE. ARENAS ARE POPULAR, WHICH MAKES IT A GOOD PLACE TO START BUILDING YOUR REPUTATION."* |
| **Massilia** | *"IF A LOT OF GLADIATORS HAVE FALLEN UNDER THE MASSILLIAN SUN, A LOT HAVE USED THIS CITY AS A SPRINGBOARD TO ACCESS MORE PRESTIGIOUS CITIES."* |

### 22.4 Shop Tutorial & Tooltip Strings

- *"HERE, YOU CAN BUY OR SELL EQUIPMENT."*
- *"EACH CITY HAS ITS OWN SHOP AND NEW VILLAGES WILL HAVE THE BEST EQUIPMENT."*
- *"YOU CAN BUY AN ITEM BY DRAGGING IT DIRECTLY ONTO YOUR GLADIATOR, OR IN YOUR SCHOOL'S INVENTORY."*
- *"YOU CAN FILTER THE SHOP'S STOCK BY CLICKING ON A CATEGORY."*
- The shop header shows a restock countdown — **"NEW STOCK IN: [mm:ss]"** (e.g., 14:22, 8:24) early on, and **"NEW STOCK IN: [N] DAYS"** for higher-tier shops.
- Verified item tooltip example: **`CHEAP SIMPLE LEATHER` — `PRICE: 185 GP` — `ARMOR: 96`**.

### 22.5 Early-Game Opponent Roster (Londinium Coliseum)

The numbered opponent list includes the following teams (higher numbers appear after lower ones are beaten):

| # | Team | Status |
| :--- | :--- | :--- |
| 13 | **Vesta's Troublemakers** | TEAM LOCKED (*"You need a higher rank to fight against this team."*) |
| 14 | **Titans' Troublemakers** | FIGHT |
| 15 | **Centaurs' Syndicate** | FIGHT (centaur portrait icon) |
| 16 | **Remus' Gladiators** | (next available) |

**VS Matchup screen** (after choosing FIGHT): team banners left/right, the two fighters with levels (e.g., *HORTENSIUS ANTONIUS — LEVEL 2* vs *CLAUDIUS ANECHAN — LEVEL 1*), the SPQR eagle, a **VS** divider, and **FIGHT! / BACK** buttons.

### 22.6 Post-Battle "Crowd's Wishes" Screen (Exact Wording)

- Screen title: **"THE CROWD ASKS FOR MERCY"**
- Sub-text: *"GRANTING THE CROWD'S WISH BOOSTS YOUR MP LEVEL."*
- **MERCY** button: labeled **"XP BONUS + MP LEVEL BOOST"** (spares the foe).
- **BLOOD** button: labeled **"EXTRA LOOT"** (executes the foe).
- Victory screen banner: **"YOU ARE VICTORIOUS!"**, showing the gladiator card (name, Level, Exp, MP-Lvl), **+[X] GP**, the **LOOT** grid, the **INVENTORY** grid, **LOOT ALL**, **DONE**, and a "MORE BERZERK STUFF" promo strip.
- Leaving unclaimed loot triggers **"ARE YOU SURE YOU WANT TO DISCARD ITEMS LEFT IN LOOT?"** with **YES / NO**.

---

## 23. Version History, Patch Notes & Technical Archive Notes

### 23.1 Version Numbers Observed

Screenshots of the archived item show the main menu reporting **VERSION 1.05**, then **VERSION 1.06**, and a later update banner titled **"VERSION UPDATE 1 (1.43)"** — i.e., the archived build is version **1.43**.

### 23.2 Official Patch Notes (Version Update 1 — v1.43)

The first-load update popup reads:

> *"HEY GUYS! THANKS FOR YOUR COMMENTS! WE TRY TO READ THEM ALL. BUT SORRY IF WE CAN'T ALWAYS ANSWER BACK!*
>
> *ANYWAY, BASED ON YOUR COMMENTS, HERE'S WHAT WE FIXED:*
> - *DECREASE MISS RATE!*
> - *UNEQUIP ALL DESTROY WEAPON ISSUE FIXED*
> - *SPEED STATS NOT WORKING FIXED*
> - *DUMB BEHAVIOR ON AUTO BATTLE ISSUE FIXED*
> - *DAILY REWARD IN A ROW ISSUE FIXED*
>
> *WE'RE STILL WORKING ON THE GAME, SO KEEP TELLING US WHAT YOU LIKE AND DON'T LIKE!*
>
> *CHEERS! — BERZERK CREW"*

(The popup is dismissed with **OK**, over the main menu showing **DELETE ALL** / **HOST GAME**.)

### 23.3 Archive Metadata & Provenance

- Item: **"Sands Of The Coliseum"** — Internet Archive `softwarelibrary_flash_games` collection.
- Developer: **Berzerk Studio** — original hosting portal: **notdoppler.com** (`sandsofthecoliseum.php`).
- Publication date: **2012-05-31**; language: English; license: Public Domain Mark 1.0; emulated via **Ruffle (ruffle-swf)**.
- Official store blurb: *"Do you have what it takes to become a gladiator? Take down opponent after opponent in blood-filled battles and become the ultimate gladiator!"*

### 23.4 SWF Packaging / DRM ("mochicrypt")

The downloadable `sandsofthecoliseum.swf` is wrapped in a **mochicrypt** encryption/DRM shell. Decompilation of the wrapper yields symbol classes `mochicrypt.Preloader`, `mochicrypt.LockIcon`, `mochicrypt.ConfigData`, `mochicrypt.Payload`, and `mochicrypt.Background`:

- **LockIcon:** a 50-frame animated pixel **padlock** (the pre-load lock graphic).
- **Background:** the loading-screen title art — the gold **SPQR** eagle over the *SANDS OF THE COLISEUM* banner, beside two gladiators mid-combat (one standing over a fallen opponent).
- The real game code/assets sit inside an encrypted **`assets.swf`** payload, which is why the art above is extracted from screenshots rather than from the encrypted binary.

---
