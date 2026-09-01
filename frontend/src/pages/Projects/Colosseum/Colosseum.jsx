import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import ArenaCanvas from './ArenaCanvas';
import { WeaponIcon, ArmorIcon } from './ColosseumArt';
import { sfx, isMuted, setMuted as setMutedPref } from './sfx';
import artHero from '../../../assets/art/Hero banner.jpg';
import artIcon from '../../../assets/art/App icon.jpg';
import artBg from '../../../assets/art/Background texture.jpg';
import artMurmillo from '../../../assets/art/Murmillo.jpg';
import artRetiarius from '../../../assets/art/Retiarius.jpg';
import artThraex from '../../../assets/art/Thraex.jpg';
import artSecutor from '../../../assets/art/Secutor.jpg';
import artHoplomachus from '../../../assets/art/Hoplomachus.jpg';
import {
  CLASSES,
  ACTIONS,
  WEAPON_TIERS,
  ARMOR_TIERS,
  MAX_ROSTER,
  START_GOLD,
  START_FAME,
  makeGladiator,
  randomName,
  effectiveStats,
  isAlive,
  addXp,
  healCost,
  trainCost,
  totalTrained,
  victoryRewards,
  rollEnemyTeam,
  resolveRound,
} from './colosseumEngine';
import './Colosseum.css';

const SAVE_KEY = 'colosseumSave';
const TABS = ['Arena', 'Roster', 'Recruit', 'Train', 'Forge', 'Rest'];
const MAX_LOG_LINES = 120;

const CLASS_IMAGES = {
  murmillo: artMurmillo,
  retiarius: artRetiarius,
  thraex: artThraex,
  secutor: artSecutor,
  hoplomachus: artHoplomachus,
};

// ── Presentational helpers ─────────────────────────────────────────────────
function Bar({ value, max, tone = 'hp' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`col-bar col-bar--${tone}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="col-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatLine({ label, value }) {
  return (
    <div className="col-statline">
      <span className="col-statline__label">{label}</span>
      <span className="col-statline__value">{value}</span>
    </div>
  );
}

function ClassChip({ classKey }) {
  return <span className={`col-chip col-chip--${classKey}`}>{CLASSES[classKey].label}</span>;
}

function Portrait({ classKey, alt, small }) {
  return (
    <img
      className={`col-portrait${small ? ' col-portrait--small' : ''}`}
      src={CLASS_IMAGES[classKey] || artMurmillo}
      alt={alt || CLASSES[classKey].label}
      loading="lazy"
    />
  );
}

function playRoundSfx(events) {
  if (!events || !events.length) return;
  const crit = events.some((e) => e.kind === 'attack' && e.crit);
  const heavy = events.some((e) => e.kind === 'attack' && e.label === 'heavy' && !e.miss);
  const landed = events.some((e) => e.kind === 'attack' && !e.miss);
  const skill = events.some((e) => e.kind === 'skill');
  if (crit) sfx.crit();
  else if (heavy) sfx.heavyHit();
  else if (landed) sfx.hit();
  if (skill) sfx.skill();
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Colosseum() {
  const [roster, setRoster] = useState([]);
  const [gold, setGold] = useState(START_GOLD);
  const [fame, setFame] = useState(START_FAME);
  const [arenaPower, setArenaPower] = useState(1);
  const [tab, setTab] = useState('Arena');
  const [loaded, setLoaded] = useState(false);

  // Battle state
  const [enemies, setEnemies] = useState([]);
  const [battleActive, setBattleActive] = useState(false);
  const [round, setRound] = useState(0);
  const [log, setLog] = useState([]);
  const [lastEvents, setLastEvents] = useState([]);
  const [selectedActions, setSelectedActions] = useState({});
  const [pendingTarget, setPendingTarget] = useState(null);
  const [battleResult, setBattleResult] = useState(null);
  const [lastReward, setLastReward] = useState(null);

  const [recruitPool, setRecruitPool] = useState([]);
  const [muted, setMutedState] = useState(isMuted());

  function toggleMute() {
    setMutedState((prev) => {
      setMutedPref(!prev);
      return !prev;
    });
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const save = JSON.parse(raw);
        if (Array.isArray(save.roster)) {
          setRoster(save.roster);
          setGold(typeof save.gold === 'number' ? save.gold : START_GOLD);
          setFame(typeof save.fame === 'number' ? save.fame : START_FAME);
          setArenaPower(save.arenaPower || 1);
        }
      }
    } catch {
      // Corrupt save — start fresh.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ roster, gold, fame, arenaPower }));
    } catch {
      // Storage unavailable — continue in memory.
    }
  }, [roster, gold, fame, arenaPower, loaded]);

  // ── Actions ──────────────────────────────────────────────────────────────
  function newGame() {
    setRoster([makeGladiator(randomName(), 'murmillo')]);
    setGold(START_GOLD);
    setFame(START_FAME);
    setArenaPower(1);
    setTab('Arena');
    toast('A new ludus rises from the sands. Hail, lanista!');
  }

  function startBattle() {
    if (roster.length === 0) return;
    setEnemies(rollEnemyTeam(arenaPower));
    setSelectedActions({});
    setPendingTarget(null);
    setLastEvents([]);
    setLog([`Round 1 — the crowd roars!`]);
    setRound(1);
    setBattleActive(true);
    setBattleResult(null);
    setLastReward(null);
  }

  function selectAction(gladId, action) {
    sfx.select();
    if (action === 'defend' || action === 'rest') {
      setSelectedActions((prev) => ({ ...prev, [gladId]: { action, targetId: null } }));
      setPendingTarget((prev) => (prev === gladId ? null : prev));
      return;
    }
    setSelectedActions((prev) => ({ ...prev, [gladId]: { action, targetId: prev[gladId]?.targetId || null } }));
    setPendingTarget(gladId);
  }

  function pickTarget(enemyId) {
    sfx.click();
    if (!pendingTarget) return;
    setSelectedActions((prev) => ({
      ...prev,
      [pendingTarget]: { action: prev[pendingTarget]?.action || 'strike', targetId: enemyId },
    }));
    setPendingTarget(null);
  }

  const aliveGladiators = roster.filter(isAlive);
  const everyReady =
    battleActive &&
    aliveGladiators.length > 0 &&
    aliveGladiators.every((g) => {
      const a = selectedActions[g.id];
      if (!a) return false;
      if (a.action === 'strike' || a.action === 'heavy' || a.action === 'skill') return !!a.targetId;
      return true;
    });

  function resolve() {
    if (!everyReady) return;
    const result = resolveRound(roster, enemies, selectedActions, arenaPower);

    let newRoster = result.playerTeam;
    let newGold = gold;
    let newFame = fame;
    let newPower = arenaPower;
    let kind = null;
    let reward = null;

    if (result.playerWon) {
      const r = victoryRewards(arenaPower);
      newGold = gold + r.gold;
      newFame = fame + r.fame;
      newRoster = result.playerTeam.map((g) => (isAlive(g) ? addXp(g, r.xp) : g));
      newPower = arenaPower + 1;
      kind = 'win';
      reward = r;
    } else if (result.enemyWon) {
      newFame = Math.max(0, fame - arenaPower * 5);
      newRoster = result.playerTeam.map((g) => ({
        ...g,
        hp: Math.max(1, Math.round(effectiveStats(g).maxHp * 0.3)),
      }));
      kind = 'loss';
    }

    setRoster(newRoster);
    setEnemies(result.enemyTeam);
    setGold(newGold);
    setFame(newFame);
    setArenaPower(newPower);
    setSelectedActions({});
    setPendingTarget(null);
    setLastEvents(result.events || []);
    setRound((r) => r + 1);
    setLog((prev) => [`— Round ${round} —`, ...result.log, ...prev].slice(0, MAX_LOG_LINES));

    playRoundSfx(result.events);

    if (result.playerWon) {
      sfx.victory();
      toast.success(`Victory! +${reward.gold} gold, +${reward.fame} fame.`);
    } else if (result.enemyWon) {
      sfx.defeat();
      toast.error('Defeat! Your gladiators were dragged from the sands.');
    }

    if (result.playerWon || result.enemyWon) {
      setBattleActive(false);
      setBattleResult(kind);
      setLastReward(reward);
    }
  }

  function generateRecruits() {
    const level = Math.max(1, Math.floor(arenaPower / 2));
    const keys = Object.keys(CLASSES);
    const pool = Array.from(
      { length: 3 },
      () => makeGladiator(randomName(), keys[Math.floor(Math.random() * keys.length)], { level }),
    );
    setRecruitPool(pool);
    setTab('Recruit');
  }

  function recruitCost(g) {
    return 40 + (g.level - 1) * 25;
  }

  function hire(g) {
    if (roster.length >= MAX_ROSTER) {
      toast.warn('Your ludus is full (max 3 gladiators).');
      return;
    }
    const cost = recruitCost(g);
    if (gold < cost) {
      toast.warn('Not enough gold to recruit this gladiator.');
      return;
    }
    setGold((v) => v - cost);
    setRoster((prev) => [...prev, { ...g }]);
    setRecruitPool((prev) => prev.filter((r) => r.id !== g.id));
    toast.success(`${g.name} joins your ludus!`);
  }

  function train(gladId, stat) {
    const g = roster.find((x) => x.id === gladId);
    if (!g) return;
    if (totalTrained(g) >= g.level * 6) {
      toast.warn('This gladiator has trained as much as their level allows. Win battles to level up.');
      return;
    }
    const cost = trainCost(totalTrained(g));
    if (gold < cost) {
      toast.warn('Not enough gold to train.');
      return;
    }
    setGold((v) => v - cost);
    setRoster((prev) =>
      prev.map((x) => (x.id === gladId ? { ...x, training: { ...x.training, [stat]: x.training[stat] + 1 } } : x)),
    );
    toast.success(`${g.name} grows stronger.`);
  }

  function forgeWeapon(gladId) {
    const g = roster.find((x) => x.id === gladId);
    if (!g) return;
    const idx = WEAPON_TIERS.findIndex((t) => t.id === g.weaponId);
    const next = WEAPON_TIERS[idx + 1];
    if (!next) {
      toast.info('This gladiator already wields the finest blade.');
      return;
    }
    if (gold < next.cost) {
      toast.warn('Not enough gold for this weapon.');
      return;
    }
    setGold((v) => v - next.cost);
    setRoster((prev) => prev.map((x) => (x.id === gladId ? { ...x, weaponId: next.id } : x)));
    toast.success(`${g.name} is now armed with ${next.label}.`);
  }

  function forgeArmor(gladId) {
    const g = roster.find((x) => x.id === gladId);
    if (!g) return;
    const idx = ARMOR_TIERS.findIndex((t) => t.id === g.armorId);
    const next = ARMOR_TIERS[idx + 1];
    if (!next) {
      toast.info('This gladiator already wears the finest armor.');
      return;
    }
    if (gold < next.cost) {
      toast.warn('Not enough gold for this armor.');
      return;
    }
    setGold((v) => v - next.cost);
    setRoster((prev) => prev.map((x) => (x.id === gladId ? { ...x, armorId: next.id } : x)));
    toast.success(`${g.name} dons ${next.label}.`);
  }

  function heal(gladId) {
    const g = roster.find((x) => x.id === gladId);
    if (!g) return;
    const cost = healCost(g);
    if (cost <= 0) return;
    if (gold < cost) {
      toast.warn('Not enough gold to heal.');
      return;
    }
    setGold((v) => v - cost);
    setRoster((prev) => prev.map((x) => (x.id === gladId ? { ...x, hp: effectiveStats(x).maxHp } : x)));
    toast.success(`${g.name} is restored to full health.`);
  }

  const weaponLabel = (g) => WEAPON_TIERS.find((t) => t.id === g.weaponId)?.label || 'Fists';
  const armorLabel = (g) => ARMOR_TIERS.find((t) => t.id === g.armorId)?.label || 'Tunic';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="col-space">
      <div className="col-bg" style={{ backgroundImage: `url(${artBg})` }} aria-hidden="true" />
      <SEO
        title="Colosseum"
        description="Manage a stable of gladiators, train and equip them, and battle through the arena in this free turn-based strategy game."
        path="/colosseum"
      />
      <Header />
      <main className="col-main">
        <h1 className="col-title">
          <img className="col-emblem" src={artIcon} alt="" aria-hidden="true" />
          Colosseum
        </h1>

        {loaded && roster.length === 0 ? (
          <section className="col-panel col-panel--start">
            <h2 className="col-panel__title">A new ludus awaits</h2>
            <p>
              You are a lanista — the owner of a gladiator school. Recruit fighters, hone their skills, buy them arms
              and armor, and climb the arena ranks for gold and glory.
            </p>
            <button className="col-btn col-btn--primary" onClick={newGame}>
              ⚔️ Begin Your Ludus
            </button>
          </section>
        ) : (
          <>
            {/* Top bar */}
            <div className="col-topbar">
              <div className="col-topbar__stat">
                <span className="col-topbar__icon">🪙</span>
                <span>{gold}</span>
              </div>
              <div className="col-topbar__stat">
                <span className="col-topbar__icon">👑</span>
                <span>{fame}</span>
              </div>
              <div className="col-topbar__stat">
                <span className="col-topbar__icon">🏛️</span>
                <span>Arena {arenaPower}</span>
              </div>
              <button className="col-mute" onClick={toggleMute} aria-label={muted ? 'Unmute sound' : 'Mute sound'}>
                {muted ? '🔇' : '🔊'}
              </button>
            </div>

            {/* Tabs */}
            <nav className="col-tabs" aria-label="Colosseum sections">
              {TABS.map((t) => (
                <button
                  key={t}
                  className={`col-tab ${tab === t ? 'col-tab--active' : ''}`}
                  onClick={() => (t === 'Recruit' ? generateRecruits() : setTab(t))}
                >
                  {t}
                </button>
              ))}
            </nav>

            {/* ── Arena ── */}
            {tab === 'Arena' && (
              <section className="col-panel col-panel--arena">
                {!battleActive && (
                  <div className="col-arena-lobby" style={{ backgroundImage: `url(${artHero})` }}>
                    <div className="col-arena-lobby__veil">
                      <h2 className="col-panel__title">The Arena</h2>
                      {battleResult === 'win' && lastReward && (
                        <div className="col-result col-result--win">
                          🏆 Victory! +{lastReward.gold} gold · +{lastReward.fame} fame · +{lastReward.xp} XP per
                          survivor. Next opponent at Arena {arenaPower}.
                        </div>
                      )}
                      {battleResult === 'loss' && (
                        <div className="col-result col-result--loss">
                          💀 Defeat. Your gladiators survive with a sliver of health and some fame lost. Rest and
                          re-arm before trying again.
                        </div>
                      )}
                      <button className="col-btn col-btn--primary col-btn--big" onClick={startBattle}>
                        ⚔️ Enter the Arena (Rank {arenaPower})
                      </button>
                    </div>
                  </div>
                )}

                {battleActive && (
                  <>
                    <div className="col-battle-round">Round {round}</div>

                    <ArenaCanvas key={round} playerTeam={roster} enemyTeam={enemies} events={lastEvents} round={round} />

                    {/* Target picker */}
                    {pendingTarget && (
                      <div className="col-target-strip">
                        <span className="col-target-strip__label">Choose a target:</span>
                        {enemies
                          .filter(isAlive)
                          .map((e) => (
                            <button key={e.id} className="col-target" onClick={() => pickTarget(e.id)}>
                              <ClassChip classKey={e.classKey} /> {e.name}
                            </button>
                          ))}
                      </div>
                    )}

                    {/* Command bar */}
                    <div className="col-command">
                      {roster.map((g) => {
                        const chosen = selectedActions[g.id];
                        const skill = CLASSES[g.classKey].skill;
                        if (!isAlive(g)) {
                          return (
                            <div key={g.id} className="col-command__card col-command__card--down">
                              <Portrait classKey={g.classKey} alt={g.name} small />
                              <strong>{g.name}</strong>
                              <span className="col-command__note">Down</span>
                            </div>
                          );
                        }
                        return (
                          <div key={g.id} className="col-command__card">
                            <div className="col-command__head">
                              <Portrait classKey={g.classKey} alt={g.name} small />
                              <div>
                                <strong>{g.name}</strong>
                                <div className="col-command__hp">
                                  {g.hp}/{effectiveStats(g).maxHp} HP
                                </div>
                              </div>
                            </div>
                            <div className="col-actions">
                              {['strike', 'heavy', 'defend', 'skill', 'rest'].map((a) => {
                                const isSkill = a === 'skill';
                                const disabled = isSkill ? g.skillCd > 0 : false;
                                return (
                                  <button
                                    key={a}
                                    disabled={disabled}
                                    title={isSkill ? skill.desc : ACTIONS[a].desc}
                                    className={`col-action col-action--${a} ${chosen?.action === a ? 'col-action--selected' : ''}`}
                                    onClick={() => selectAction(g.id, a)}
                                  >
                                    {ACTIONS[a].label}
                                    {isSkill && g.skillCd > 0 ? ` (${g.skillCd})` : ''}
                                  </button>
                                );
                              })}
                            </div>
                            {chosen && (
                              <div className="col-action-summary">
                                {chosen.action === 'defend' || chosen.action === 'rest'
                                  ? `${ACTIONS[chosen.action].label} ready.`
                                  : chosen.targetId
                                    ? `${ACTIONS[chosen.action].label} → ${
                                        enemies.find((e) => e.id === chosen.targetId)?.name || 'target'
                                      }`
                                    : 'Choose a target.'}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button className="col-btn col-btn--primary col-btn--big" disabled={!everyReady} onClick={resolve}>
                      ⚔️ Fight Round
                    </button>
                    {!everyReady && (
                      <p className="col-hint">Pick an action for every standing gladiator (attacks need a target).</p>
                    )}

                    <div className="col-log" aria-live="polite">
                      {log.map((line, i) => (
                        <div key={i} className={line.startsWith('—') ? 'col-log__round' : 'col-log__line'}>
                          {line}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}

            {/* ── Roster ── */}
            {tab === 'Roster' && (
              <section className="col-panel">
                <h2 className="col-panel__title">Your Gladiators</h2>
                <div className="col-grid">
                  {roster.map((g) => {
                    const s = effectiveStats(g);
                    return (
                      <div key={g.id} className={`col-card ${!isAlive(g) ? 'col-card--down' : ''}`}>
                        <Portrait classKey={g.classKey} alt={g.name} />
                        <div className="col-card__head">
                          <strong>{g.name}</strong>
                          <ClassChip classKey={g.classKey} />
                        </div>
                        <div className="col-card__level">Level {g.level}</div>
                        <Bar value={g.hp} max={s.maxHp} tone="hp" />
                        <div className="col-card__hp">{g.hp} / {s.maxHp} HP</div>
                        <StatLine label="Attack" value={s.atk} />
                        <StatLine label="Defense" value={s.def} />
                        <StatLine label="Speed" value={s.spd} />
                        <div className="col-loadout">
                          <WeaponIcon tierId={g.weaponId} size={22} title={weaponLabel(g)} />
                          <span>{weaponLabel(g)}</span>
                        </div>
                        <div className="col-loadout">
                          <ArmorIcon tierId={g.armorId} size={22} title={armorLabel(g)} />
                          <span>{armorLabel(g)}</span>
                        </div>
                        {!isAlive(g) && <div className="col-card__down-badge">Down — heal to fight again</div>}
                      </div>
                    );
                  })}
                </div>
                <p className="col-hint">
                  Own {roster.length}/{MAX_ROSTER} gladiators. Gold: {gold}. Arena rank: {arenaPower}.
                </p>
              </section>
            )}

            {/* ── Recruit ── */}
            {tab === 'Recruit' && (
              <section className="col-panel">
                <h2 className="col-panel__title">Recruit Gladiators</h2>
                {roster.length >= MAX_ROSTER && (
                  <p className="col-hint">Your ludus is full. You own {roster.length}/{MAX_ROSTER}.</p>
                )}
                <div className="col-grid">
                  {recruitPool.map((g) => {
                    const s = effectiveStats(g);
                    const skill = CLASSES[g.classKey].skill;
                    return (
                      <div key={g.id} className="col-card">
                        <Portrait classKey={g.classKey} alt={g.name} />
                        <div className="col-card__head">
                          <strong>{g.name}</strong>
                          <ClassChip classKey={g.classKey} />
                        </div>
                        <div className="col-card__level">Level {g.level}</div>
                        <p className="col-card__blurb">{CLASSES[g.classKey].blurb}</p>
                        <StatLine label="Max HP" value={s.maxHp} />
                        <StatLine label="Attack" value={s.atk} />
                        <StatLine label="Defense" value={s.def} />
                        <StatLine label="Speed" value={s.spd} />
                        <p className="col-card__skill">
                          <strong>{skill.name}:</strong> {skill.desc}
                        </p>
                        <button
                          className="col-btn col-btn--primary"
                          disabled={roster.length >= MAX_ROSTER || gold < recruitCost(g)}
                          onClick={() => hire(g)}
                        >
                          Hire — {recruitCost(g)} gold
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button className="col-btn" onClick={generateRecruits}>
                  Refresh Recruits
                </button>
              </section>
            )}

            {/* ── Train ── */}
            {tab === 'Train' && (
              <section className="col-panel">
                <h2 className="col-panel__title">Train</h2>
                <p className="col-hint">
                  Each session costs more than the last. A gladiator can train up to level × 6 total points.
                </p>
                <div className="col-grid">
                  {roster.map((g) => {
                    const cost = trainCost(totalTrained(g));
                    const capped = totalTrained(g) >= g.level * 6;
                    return (
                      <div key={g.id} className="col-card">
                        <div className="col-card__head">
                          <strong>{g.name}</strong>
                          <span>Lv {g.level}</span>
                        </div>
                        <StatLine label="Trained points" value={totalTrained(g)} />
                        <div className="col-actions">
                          <button className="col-action" disabled={gold < cost || capped} onClick={() => train(g.id, 'hp')}>
                            Vitality (+3 HP)
                          </button>
                          <button className="col-action" disabled={gold < cost || capped} onClick={() => train(g.id, 'atk')}>
                            Attack (+1)
                          </button>
                          <button className="col-action" disabled={gold < cost || capped} onClick={() => train(g.id, 'def')}>
                            Defense (+1)
                          </button>
                        </div>
                        <div className="col-hint">Next session: {cost} gold</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Forge ── */}
            {tab === 'Forge' && (
              <section className="col-panel">
                <h2 className="col-panel__title">Forge</h2>
                <p className="col-hint">Buy the next tier of weapon and armor for each gladiator.</p>
                <div className="col-grid">
                  {roster.map((g) => {
                    const wIdx = WEAPON_TIERS.findIndex((t) => t.id === g.weaponId);
                    const aIdx = ARMOR_TIERS.findIndex((t) => t.id === g.armorId);
                    const nextW = WEAPON_TIERS[wIdx + 1];
                    const nextA = ARMOR_TIERS[aIdx + 1];
                    return (
                      <div key={g.id} className="col-card">
                        <div className="col-card__head">
                          <strong>{g.name}</strong>
                        </div>
                        <div className="col-loadout">
                          <WeaponIcon tierId={g.weaponId} title={weaponLabel(g)} />
                          <span>{weaponLabel(g)} <em>(+{WEAPON_TIERS[wIdx].atk})</em></span>
                        </div>
                        <button className="col-btn" disabled={!nextW || gold < nextW.cost} onClick={() => forgeWeapon(g.id)}>
                          {nextW ? `Forge ${nextW.label} — ${nextW.cost} gold` : 'Best weapon owned'}
                        </button>
                        <div className="col-loadout">
                          <ArmorIcon tierId={g.armorId} title={armorLabel(g)} />
                          <span>{armorLabel(g)} <em>(+{ARMOR_TIERS[aIdx].def})</em></span>
                        </div>
                        <button className="col-btn" disabled={!nextA || gold < nextA.cost} onClick={() => forgeArmor(g.id)}>
                          {nextA ? `Forge ${nextA.label} — ${nextA.cost} gold` : 'Best armor owned'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Rest ── */}
            {tab === 'Rest' && (
              <section className="col-panel">
                <h2 className="col-panel__title">Rest & Heal</h2>
                <p className="col-hint">Heal a gladiator to full health for gold (cost scales with missing health).</p>
                <div className="col-grid">
                  {roster.map((g) => {
                    const s = effectiveStats(g);
                    const cost = healCost(g);
                    return (
                      <div key={g.id} className="col-card">
                        <div className="col-card__head">
                          <strong>{g.name}</strong>
                        </div>
                        <Bar value={g.hp} max={s.maxHp} tone="hp" />
                        <div className="col-card__hp">{g.hp} / {s.maxHp} HP</div>
                        <button className="col-btn" disabled={g.hp >= s.maxHp || gold < cost} onClick={() => heal(g.id)}>
                          {g.hp >= s.maxHp ? 'Healthy' : `Heal — ${cost} gold`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
