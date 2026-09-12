import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';

import Footer from '../../components/Footer/Footer';
import Header from '../../components/Header/Header';
import SEO from '../../components/SEO/SEO.jsx';
import useScrollReveal from '../../hooks/useScrollReveal';
import { askFitCoach } from '../../services/fitApi';

import {
  DAY_COUNT_OPTIONS,
  DEFAULT_PROFILE,
  EQUIPMENT_OPTIONS,
  GOAL_OPTIONS,
  LEVEL_OPTIONS,
  SESSION_LENGTH_OPTIONS,
  buildPlan,
  dayCardioMinutes,
  dayRunItems,
  formatPrescription,
} from './fitProgram';
import {
  PAIN_AREAS,
  PAIN_GUIDANCE,
  PAIN_TIMINGS,
} from './fitConstants';
import {
  ANCHOR_LIFTS,
  applyLoads,
  buildLoadContext,
  describeContext,
  distanceUnitFor,
  runAdvice,
} from './fitLoads';
import {
  UNITS,
  allTraining,
  buildDraft,
  clearFitState,
  coachPayload,
  createEmptyState,
  createRun,
  createSessionFromDraft,
  currentWeekProgress,
  dataReadout,
  draftTimedEntries,
  exercisePRs,
  formatDateLabel,
  latestCheckIn,
  loadFitState,
  nextRotationDay,
  recommendedSettings,
  rotationIndexAfter,
  runTotals,
  saveFitState,
  sessionCardioMinutes,
  sessionSetCount,
  sessionVolume,
  summarizeDraft,
  todayISO,
  totalCardioMinutes,
  totalVolume,
  upsertCheckIn,
  weeklyRunSeries,
  weeklyStreak,
  weeklyVolumeSeries,
} from './fitStorage';
import './Fit.css';

const RPE_OPTIONS = [6, 7, 8, 9, 10];
const TITLE = 'Fit — Push / Pull / Legs Workout Generator & Tracker';
const DESCRIPTION =
  'Generate a Push / Pull / Legs training week that fits your equipment and your schedule, then log every set and watch your volume, streaks, and personal records climb.';

// ── Small helpers ────────────────────────────────────────────────────────
function playChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const t0 = ctx.currentTime;
    [0, 0.18].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = offset === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.34);
    });
  } catch {
    // Audio is a nicety — never let it break the set you are timing.
  }
}

function clockLabel(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(s / 60);
  return `${minutes}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A countdown for the things that need one: timed holds (planks, wall sits,
 * hangs) and the rest between sets.
 */
function HoldTimer({ seconds, label, variant = 'solid' }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (remaining === null) return undefined;
    if (remaining <= 0) {
      playChime();
      return undefined;
    }
    const timer = window.setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  if (remaining !== null) {
    const done = remaining <= 0;
    return (
      <span className={`fit-timer${done ? ' is-done' : ''}`} role="timer" aria-live="off">
        <span className="fit-timer-value">{done ? 'Done' : clockLabel(remaining)}</span>
        <button type="button" className="fit-link-btn" onClick={() => setRemaining(null)}>
          Reset
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`fit-chip fit-chip--${variant}`}
      onClick={() => setRemaining(seconds)}
    >
      {label}
    </button>
  );
}

function StatTile({ label, value, note }) {
  return (
    <div className="fit-stat">
      <span className="fit-stat-value">{value}</span>
      <span className="fit-stat-label">{label}</span>
      {note && <span className="fit-stat-note">{note}</span>}
    </div>
  );
}

// ── Section chrome ───────────────────────────────────────────────────────
// The single list of sections, so the nav chips, the numbering, and the
// "expand all" control cannot drift apart from what is on the page.
const SECTIONS = [
  { id: 'setup', label: 'Setup', title: '1 · Your week, your rules' },
  { id: 'body', label: 'Body & weights', title: '2 · Your body & starting weights', signedIn: true },
  { id: 'week', label: 'The week', title: '3 · Your week' },
  { id: 'log', label: 'Log a session', title: '4 · Log a session' },
  { id: 'running', label: 'Running', title: '5 · Running', signedIn: true },
  { id: 'progress', label: 'Progress', title: '6 · Progress', signedIn: true },
  { id: 'history', label: 'History', title: '7 · History', signedIn: true },
  { id: 'coach', label: 'Coach', title: '8 · Ask the coach' },
  { id: 'notes', label: 'How it’s built', title: '9 · How this plan is built' },
];

const SECTION_TITLES = SECTIONS.reduce((acc, section) => {
  acc[section.id] = section.title;
  return acc;
}, {});

/**
 * One collapsible card.
 *
 * A disclosure — heading + `aria-expanded` toggle + body — rather than a
 * `<details>` or a hand-rolled accordion: it keeps a real `<h2>` in the
 * document outline, works with a keyboard and a screen reader without extra
 * code, and lets the page control which sections start open. Closed sections
 * render nothing at all, which is the whole point of the exercise.
 */
function Section({ id, title, summary, open, onToggle, children, className = '' }) {
  const headingId = `fit-section-${id}-heading`;
  const bodyId = `fit-section-${id}-body`;
  return (
    <section
      className={`fit-card fit-section${open ? ' is-open' : ''} ${className}`.trim()}
      id={`fit-section-${id}`}
      aria-labelledby={headingId}
    >
      <h2 className="fit-section-heading">
        <button
          type="button"
          className="fit-section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onToggle(id, !open)}
        >
          <span className="fit-section-title" id={headingId}>
            {title}
          </span>
          {summary && <span className="fit-section-summary">{summary}</span>}
          <span className="fit-section-chevron" aria-hidden="true" />
        </button>
      </h2>
      {open && (
        <div className="fit-section-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * One day of the week, in full: warm-up, main lifts, accessories, core,
 * finisher — with the prescribed weight and the reasoning behind it.
 *
 * Only the selected day is rendered. Six of these stacked up is a wall of text
 * that nobody reads, and you only ever train one of them at a time.
 */
function DayCard({ day, isNext, isUser, onLog, onGoToRunning }) {
  const cardio = dayCardioMinutes(day);
  const runs = dayRunItems(day);
  const where = runs.length > 0 ? 'outdoors' : day.location === 'home' ? 'at home' : 'at the gym';

  return (
    <article className="fit-day is-open" id="fit-day-panel" aria-label={`${day.name} session`}>
      <header className="fit-day-head">
        <span className="fit-day-index">
          Day {day.order} · {where}
          {isNext ? ' · next up' : ''}
        </span>
        <h3 className="fit-day-name">{day.name}</h3>
        <p className="fit-day-focus">{day.focus}</p>
        <p className="fit-day-meta">
          {day.itemCount} movements · ~{day.estimatedMinutes} min
          {cardio > 0 ? ` · ${cardio} min cardio` : ''}
        </p>
      </header>

      {day.blocks.map((block) => (
        <div className="fit-block" key={`${day.id}-${block.title}`}>
          <h4 className="fit-block-title">{block.title}</h4>
          {block.items.length === 0 ? (
            <p className="fit-block-note">{block.note}</p>
          ) : (
            <>
              {block.note && <p className="fit-block-note">{block.note}</p>}
              <ul className="fit-move-list">
                {block.items.map((item, index) => (
                  <li className="fit-move" key={`${day.id}-${item.exerciseId}-${index}`}>
                    <span className="fit-move-top">
                      <span className="fit-move-name">{item.name}</span>
                      <span className="fit-move-sets">{formatPrescription(item)}</span>
                    </span>
                    {item.load && (
                      <span className="fit-move-load">
                        <strong>{item.load.text}</strong>
                        {item.load.basis && <span className="fit-move-basis"> · {item.load.basis}</span>}
                      </span>
                    )}
                    {item.bwNote && <span className="fit-move-load">{item.bwNote}</span>}
                    <span className="fit-move-cue">
                      {item.cue}
                      {item.restSeconds ? ` · rest ${item.restSeconds}s` : ''}
                      {item.unilateral ? ' · each side' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}

      <div className="fit-day-actions">
        <button type="button" className="fit-btn fit-btn-outline fit-btn--sm" onClick={() => onLog(day)}>
          Log {day.name}
        </button>
        {runs.length > 0 && isUser && (
          <button type="button" className="fit-link-btn" onClick={onGoToRunning}>
            or log the run on its own
          </button>
        )}
      </div>
    </article>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
function Fit() {
  const { user } = useSelector((state) => state.data);
  const token = user?.token;
  const isUser = Boolean(token);

  const [state, setState] = useState(() => loadFitState());
  const [guestPlan, setGuestPlan] = useState(null);
  const [form, setForm] = useState(() => ({ ...DEFAULT_PROFILE, ...loadFitState().profile }));
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [checkInWeight, setCheckInWeight] = useState('');
  const [runDraft, setRunDraft] = useState({ date: todayISO(), distance: '', minutes: '', effort: '', pain: '' });
  const [question, setQuestion] = useState('');
  const [coach, setCoach] = useState({ loading: false, error: null, result: null });

  // A first visit should show a real week without any interaction. An explicit
  // "clear everything" is the one case where it must not: the athlete asked for
  // an empty slate, so it stays empty until they build a new week.
  const autoGenerate = useRef(true);
  const [revealRef, revealed] = useScrollReveal();

  // Which sections are expanded. Only the parts you are actually using start
  // open — the page is nine sections long and nobody reads it top to bottom.
  const [open, setOpen] = useState(() => {
    const initial = loadFitState();
    return {
      setup: !initial.plan,
      body: !initial.profile.bodyWeight,
      week: true,
      log: false,
      running: false,
      progress: false,
      history: false,
      coach: false,
      notes: false,
    };
  });
  // The week shows one day at a time — a list of six sessions is a wall of
  // text, and you only ever train one of them.
  const [selectedDayId, setSelectedDayId] = useState(null);

  const units = state.units;
  const profile = isUser ? state.profile : form;
  const distanceUnit = distanceUnitFor(units);

  // Only a signed-in athlete's state is ever written back.
  useEffect(() => {
    if (isUser) saveFitState(state);
  }, [state, isUser]);

  const loadContext = useMemo(
    () => buildLoadContext({ profile, checkIns: isUser ? state.checkIns : [], units }),
    [profile, state.checkIns, units, isUser]
  );

  const basePlan = isUser ? state.plan : guestPlan;
  // Loads are derived, never stored: editing your body weight or a working set
  // must update every prescribed number without regenerating the week.
  const plan = useMemo(() => applyLoads(basePlan, loadContext), [basePlan, loadContext]);

  const training = useMemo(() => allTraining(state), [state]);
  const weeklyTarget = plan?.weeklyTarget || profile.daysPerWeek || 4;
  const weeklyProgress = currentWeekProgress(training, weeklyTarget);
  const streak = weeklyStreak(training, weeklyTarget);
  const volumeSeries = useMemo(() => weeklyVolumeSeries(state.sessions, 8, units), [state.sessions, units]);
  const runSeries = useMemo(() => weeklyRunSeries(state.runs, 8, distanceUnit), [state.runs, distanceUnit]);
  const prs = useMemo(() => exercisePRs(state.sessions, units), [state.sessions, units]);
  const readout = useMemo(() => dataReadout(state, loadContext), [state, loadContext]);
  const recommendations = useMemo(() => recommendedSettings(state), [state]);
  const nextDay = nextRotationDay(plan, state.rotationIndex);
  const maxWeekVolume = Math.max(1, ...volumeSeries.map((week) => week.volume));
  const maxRunDistance = Math.max(1, ...runSeries.map((week) => week.distance));
  const latestWeight = latestCheckIn(state.checkIns);
  const runSummary = runTotals(state.runs, distanceUnit);
  const summary = summarizeDraft(draft);
  const activeGoal = GOAL_OPTIONS.find((g) => g.id === form.goal) || GOAL_OPTIONS[0];
  const planGoal = GOAL_OPTIONS.find((g) => g.id === plan?.goal);
  const planLevel = LEVEL_OPTIONS.find((l) => l.id === plan?.level);

  const history = useMemo(
    () =>
      state.sessions
        .map((session) => ({ kind: 'session', date: session.date, item: session }))
        .concat(state.runs.map((run) => ({ kind: 'run', date: run.date, item: run })))
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [state.sessions, state.runs]
  );

  // ── Sections ───────────────────────────────────────────────────────────
  const visibleSections = SECTIONS.filter(
    (section) => (!section.signedIn || isUser) && (section.id !== 'notes' || plan)
  );
  const allOpen = visibleSections.every((section) => open[section.id]);

  const toggleSection = useCallback((id, next) => {
    setOpen((prev) => ({ ...prev, [id]: typeof next === 'boolean' ? next : !prev[id] }));
  }, []);

  const setAllSections = (value) =>
    setOpen((prev) => visibleSections.reduce((acc, section) => ({ ...acc, [section.id]: value }), { ...prev }));

  /** Open a section and bring it into view — the nav chips and the buttons inside cards. */
  const goTo = useCallback((id) => {
    setOpen((prev) => ({ ...prev, [id]: true }));
    // Wait a frame so the section exists before scrolling to it.
    window.setTimeout(() => {
      document.getElementById(`fit-section-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, []);

  const activeDayId =
    (selectedDayId && plan?.days.some((day) => day.id === selectedDayId) ? selectedDayId : null) ||
    nextDay?.id ||
    plan?.days?.[0]?.id ||
    null;
  const activeDay = plan?.days.find((day) => day.id === activeDayId) || null;

  // ── Generation ─────────────────────────────────────────────────────────
  const generate = useCallback(
    (nextProfile) => {
      const target = nextProfile || profile;
      const nextPlan = buildPlan(target, undefined, {
        runningAdvice: runAdvice({
          equipment: target.equipment,
          goal: target.goal,
          level: target.level,
          units,
          runs: isUser ? state.runs : [],
        }),
      });
      if (isUser) {
        setState((prev) => ({ ...prev, profile: target, plan: nextPlan, rotationIndex: 0 }));
      } else {
        setGuestPlan(nextPlan);
      }
      setDraft(null);
      setStatus(`New ${nextPlan.days.length}-day week generated. Day 1 is ${nextPlan.days[0].name}.`);
      // Show the thing they just asked for.
      goTo('week');
      return nextPlan;
    },
    [profile, units, isUser, state.runs, goTo]
  );

  // First visit: show a real week immediately rather than an empty form. Guests
  // get one from the defaults; a signed-in athlete gets one from their saved
  // profile (which is the profile they already chose).
  useEffect(() => {
    if (autoGenerate.current && !basePlan) generate(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePlan]);

  // A guest who signs in keeps the week they just generated.
  useEffect(() => {
    if (isUser && guestPlan && !state.plan) {
      setState((prev) => ({ ...prev, plan: guestPlan }));
      setGuestPlan(null);
      setStatus('Signed in — your generated week has been saved to your account.');
    }
  }, [isUser, guestPlan, state.plan]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const setFormField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleEquipment = (id) => {
    setForm((prev) => {
      const current = Array.isArray(prev.equipment) ? prev.equipment : [];
      const next = current.includes(id) ? current.filter((item) => item !== id) : current.concat(id);
      return { ...prev, equipment: next };
    });
  };

  const updateProfile = (patch) => {
    setState((prev) => ({ ...prev, profile: { ...prev.profile, ...patch } }));
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const updateLift = (id, field, value) => {
    setState((prev) => {
      const lifts = { ...prev.profile.lifts };
      lifts[id] = { ...lifts[id], [field]: value };
      return { ...prev, profile: { ...prev.profile, lifts } };
    });
    setForm((prev) => {
      const lifts = { ...prev.lifts };
      lifts[id] = { ...lifts[id], [field]: value };
      return { ...prev, lifts };
    });
  };

  const useRecommended = () => {
    setForm((prev) => ({
      ...prev,
      daysPerWeek: recommendations.daysPerWeek || prev.daysPerWeek,
      sessionMinutes: recommendations.sessionMinutes || prev.sessionMinutes,
    }));
    setStatus('Applied the settings your logged history suggests.');
  };

  const openDay = (day) => {
    setDraft(buildDraft(day, state.sessions, units));
    setStatus(`Logging ${day.name}.`);
    goTo('log');
  };

  const patchEntry = (blockIndex, entryIndex, patch) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        blocks: prev.blocks.map((block, bi) =>
          bi !== blockIndex
            ? block
            : {
                ...block,
                entries: block.entries.map((entry, ei) => (ei !== entryIndex ? entry : { ...entry, ...patch })),
              }
        ),
      };
    });
  };

  const patchSet = (blockIndex, entryIndex, setIndex, patch) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        blocks: prev.blocks.map((block, bi) =>
          bi !== blockIndex
            ? block
            : {
                ...block,
                entries: block.entries.map((entry, ei) => {
                  if (ei !== entryIndex) return entry;
                  return {
                    ...entry,
                    sets: entry.sets.map((set, si) => (si !== setIndex ? set : { ...set, ...patch })),
                  };
                }),
              }
        ),
      };
    });
  };

  const addSet = (blockIndex, entryIndex) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        blocks: prev.blocks.map((block, bi) =>
          bi !== blockIndex
            ? block
            : {
                ...block,
                entries: block.entries.map((entry, ei) => {
                  if (ei !== entryIndex) return entry;
                  const previous = entry.sets[entry.sets.length - 1] || { reps: '', weight: '' };
                  return { ...entry, sets: entry.sets.concat({ reps: previous.reps, weight: previous.weight, done: false }) };
                }),
              }
        ),
      };
    });
  };

  const removeSet = (blockIndex, entryIndex, setIndex) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        blocks: prev.blocks.map((block, bi) =>
          bi !== blockIndex
            ? block
            : {
                ...block,
                entries: block.entries.map((entry, ei) => {
                  if (ei !== entryIndex || entry.sets.length <= 1) return entry;
                  return { ...entry, sets: entry.sets.filter((_, si) => si !== setIndex) };
                }),
              }
        ),
      };
    });
  };

  const markAllDone = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        blocks: prev.blocks.map((block) => ({
          ...block,
          entries: block.entries.map((entry) =>
            entry.kind === 'cardio'
              ? { ...entry, done: true }
              : { ...entry, sets: entry.sets.map((set) => ({ ...set, done: true })) }
          ),
        })),
      };
    });
  };

  const saveSession = () => {
    if (!draft) return;
    if (!sessionSetCount(draft) && !sessionCardioMinutes(draft)) {
      setStatus('Tick at least one set — or mark the cardio as done — before saving.');
      return;
    }
    const session = createSessionFromDraft(draft);
    const sets = sessionSetCount(session);
    const cardio = sessionCardioMinutes(session);
    const parts = [sets > 0 ? `${sets} set${sets === 1 ? '' : 's'}` : null, cardio > 0 ? `${cardio} min cardio` : null].filter(
      Boolean
    );

    if (isUser) {
      setState((prev) => ({
        ...prev,
        sessions: prev.sessions.concat(session),
        rotationIndex: rotationIndexAfter(prev.plan, session.dayId, prev.rotationIndex),
      }));
      setStatus(
        `Saved ${session.dayName} — ${parts.join(' · ')} · ${sessionVolume(session, units).toLocaleString()} ${units} moved.`
      );
    } else {
      setStatus('Nice session. Sign in to save it and see your progress over time.');
    }
    setDraft(null);
    // Follow the rotation so the panel shows what is next, not what was logged.
    setSelectedDayId(null);
  };

  const saveCheckIn = () => {
    const weight = Number(checkInWeight);
    if (!weight || weight <= 0) {
      setStatus('Enter a body weight first.');
      return;
    }
    setState((prev) => ({
      ...prev,
      checkIns: upsertCheckIn(prev.checkIns, { date: todayISO(), weight, unit: units }),
    }));
    setCheckInWeight('');
    setStatus(`Check-in saved — ${weight} ${units}. Prescribed weights now use this.`);
  };

  const saveRun = () => {
    const minutes = Number(runDraft.minutes);
    if (!minutes || minutes <= 0) {
      setStatus('A run needs a duration — enter how many minutes you ran.');
      return;
    }
    setState((prev) => ({ ...prev, runs: prev.runs.concat(createRun({ ...runDraft, unit: distanceUnit })) }));
    setRunDraft({ date: todayISO(), distance: '', minutes: '', effort: '', pain: '' });
    setStatus('Run logged.');
  };

  const askCoach = async () => {
    if (!isUser) {
      setStatus('Sign in to get coaching on your logged training.');
      return;
    }
    setCoach({ loading: true, error: null, result: null });
    try {
      const payload = coachPayload(state, loadContext, question);
      const result = await askFitCoach(token, payload);
      setCoach({ loading: false, error: null, result });
      setState((prev) => ({ ...prev, coach: { ...result, askedAt: new Date().toISOString() } }));
    } catch (error) {
      setCoach({ loading: false, error, result: null });
    }
  };

  const deleteSession = (id) => {
    setState((prev) => ({ ...prev, sessions: prev.sessions.filter((session) => session.id !== id) }));
    setConfirmId(null);
    setStatus('Session deleted.');
  };

  const deleteRun = (id) => {
    setState((prev) => ({ ...prev, runs: prev.runs.filter((run) => run.id !== id) }));
    setConfirmId(null);
    setStatus('Run deleted.');
  };

  const handleReset = () => {
    clearFitState();
    autoGenerate.current = false;
    setState(createEmptyState());
    setForm({ ...DEFAULT_PROFILE, lifts: {} });
    setDraft(null);
    setConfirmReset(false);
    setCoach({ loading: false, error: null, result: null });
    setStatus('Everything cleared. Generate a new week whenever you are ready.');
  };

  const activeCoach = coach.result || (state.coach && { ...state.coach });
  const hasTrackedData = isUser && (state.sessions.length > 0 || state.runs.length > 0 || state.checkIns.length > 0);
  const timedEntries = draftTimedEntries(draft);

  // One line per collapsed section, so a closed card still tells you what is
  // inside it — otherwise "collapsed" just means "hidden".
  const setupSummary = [
    activeGoal.label,
    LEVEL_OPTIONS.find((level) => level.id === form.level)?.label,
    `${form.daysPerWeek} days`,
    `${form.sessionMinutes} min`,
    (form.equipment || []).length
      ? (form.equipment || [])
          .map((id) => EQUIPMENT_OPTIONS.find((option) => option.id === id)?.label)
          .filter(Boolean)
          .join(' + ')
      : 'Bodyweight only',
  ]
    .filter(Boolean)
    .join(' · ');

  const locations = plan ? Array.from(new Set(plan.days.map((day) => day.location))) : [];
  const weekSummary = plan
    ? `${plan.days.length} sessions · ${
        locations.length > 1 ? 'gym + home' : locations[0] === 'home' ? 'at home' : 'at the gym'
      }${plan.runMinutes > 0 ? ` · ${plan.runMinutes} min running` : ''}`
    : null;
  const bodySummary = isUser
    ? `${loadContext.bodyWeight ? `${loadContext.bodyWeight} ${units}` : 'no body weight yet'}${
        loadContext.hasEnteredLifts ? ' · lifts logged' : ''
      }`
    : null;
  const logSummary = draft ? `${draft.dayName} in progress` : 'nothing open yet';
  const runningSummary = state.runs.length
    ? `${runSummary.distance} ${distanceUnit} across ${runSummary.count} run${runSummary.count === 1 ? '' : 's'}`
    : 'no runs logged';
  const progressSummary = `${weeklyProgress.done}/${weeklyProgress.target} sessions this week · ${streak}-week streak`;
  const historySummary = `${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'} · ${
    state.runs.length
  } run${state.runs.length === 1 ? '' : 's'}`;
  const coachSummary = activeCoach?.advice
    ? `last advice ${formatDateLabel(activeCoach.askedAt || state.coach?.askedAt, { withYear: true })}`
    : isUser
    ? 'ask about a niggle'
    : 'sign in to unlock';
  const notesSummary = plan ? `${plan.notes.length} coaching notes` : null;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <SEO
        title={TITLE}
        description={DESCRIPTION}
        path="/fit"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: TITLE,
          url: 'https://sthopwood.com/fit',
          applicationCategory: 'HealthApplication',
          operatingSystem: 'Any',
          browserRequirements: 'Requires JavaScript',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          description: DESCRIPTION,
        }}
      />
      <Header />

      <div className="fit">
        <div className="fit-floating" aria-hidden="true">
          <div className="fit-circle fit-circle-1" />
          <div className="fit-circle fit-circle-2" />
          <div className="fit-circle fit-circle-3" />
        </div>

        <section className="fit-hero">
          <div className="fit-title-wrap">
            <p className="fit-eyebrow">Training planner</p>
            <h1 className="fit-title">Fit</h1>
            <p className="fit-subtitle">
              A Push / Pull / Legs week built around the equipment you actually have, with a starting weight on every
              bar and a timer for every hold. Sign in and it tracks what you lift, what you run, and what hurts.
            </p>
            <div className="fit-actions fit-actions--hero">
              <button type="button" className="fit-btn" onClick={() => goTo('setup')}>
                {plan ? 'Change my week' : 'Build my week'}
              </button>
              <button type="button" className="fit-btn fit-btn-outline" onClick={() => goTo('log')}>
                {nextDay ? `Log ${nextDay.name}` : 'Log a session'}
              </button>
              <button type="button" className="fit-btn fit-btn-outline" onClick={() => goTo('week')}>
                See the week
              </button>
            </div>
            <p className="fit-mode" data-mode={isUser ? 'user' : 'guest'}>
              {isUser ? (
                <>
                  Tracking on{user?.nickname ? ` as ${user.nickname}` : ''} — sessions, runs, check-ins, and coaching are
                  saved to your account.
                </>
              ) : (
                <>
                  You are browsing as a guest: everything below works and <strong>nothing is saved</strong>.{' '}
                  <Link to="/login" state={{ redirectTo: '/fit' }}>
                    Sign in
                  </Link>{' '}
                  to track your training and get coaching on it.
                </>
              )}
            </p>
          </div>
        </section>

        <main id="main" ref={revealRef} className={`fit-main fit-reveal ${revealed ? 'is-visible' : ''}`}>
          {/* ── Section index ─────────────────────────────────────── */}
          <nav className="fit-nav" aria-label="Page sections">
            {visibleSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`fit-nav-chip${open[section.id] ? ' is-open' : ''}`}
                aria-expanded={open[section.id]}
                onClick={() => goTo(section.id)}
              >
                {section.label}
              </button>
            ))}
            <button
              type="button"
              className="fit-nav-action"
              onClick={() => setAllSections(!allOpen)}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </nav>

          {/* ── 1 · Profile ───────────────────────────────────────── */}
          <Section
            id="setup"
            title={SECTION_TITLES.setup}
            summary={setupSummary}
            open={open.setup}
            onToggle={toggleSection}
          >
            <p className="fit-lead">
              Tick every place you can train — the split is always Push / Pull / Legs, and Fit will put the gym days
              where the heavy kit is and bring the rest home.
            </p>

            <fieldset className="fit-fieldset">
              <legend className="fit-label">Where can you train?</legend>
              <div className="fit-equipment">
                {EQUIPMENT_OPTIONS.map((option) => {
                  const checked = (form.equipment || []).includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className={`fit-equipment-option${checked ? ' is-checked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleEquipment(option.id)}
                        aria-describedby={`fit-equipment-${option.id}-hint`}
                      />
                      <span className="fit-equipment-body">
                        <span className="fit-equipment-label">{option.label}</span>
                        <span className="fit-hint" id={`fit-equipment-${option.id}-hint`}>
                          {option.hint}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="fit-form-grid">
              <label className="fit-field" htmlFor="fit-goal">
                <span className="fit-label">Goal</span>
                <select
                  id="fit-goal"
                  className="fit-input"
                  value={form.goal}
                  onChange={(event) => setFormField('goal', event.target.value)}
                >
                  {GOAL_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="fit-hint">{activeGoal.hint}</span>
              </label>

              <label className="fit-field" htmlFor="fit-level">
                <span className="fit-label">Experience</span>
                <select
                  id="fit-level"
                  className="fit-input"
                  value={form.level}
                  onChange={(event) => setFormField('level', event.target.value)}
                >
                  {LEVEL_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="fit-hint">{LEVEL_OPTIONS.find((l) => l.id === form.level)?.hint}</span>
              </label>

              <div className="fit-field">
                <span className="fit-label" id="fit-days-label">
                  Days per week
                </span>
                <div className="fit-segmented" role="group" aria-labelledby="fit-days-label">
                  {DAY_COUNT_OPTIONS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={`fit-segment${form.daysPerWeek === days ? ' is-active' : ''}`}
                      aria-pressed={form.daysPerWeek === days}
                      onClick={() => setFormField('daysPerWeek', days)}
                    >
                      {days}
                      {recommendations.daysPerWeek === days && <span className="fit-segment-badge">★</span>}
                    </button>
                  ))}
                </div>
                <span className="fit-hint">
                  {form.daysPerWeek >= 6
                    ? 'Push / Pull / Legs twice through, with A/B variations.'
                    : form.daysPerWeek === 5
                    ? 'Push / Pull / Legs, an upper-body top-up, and a cardio day.'
                    : form.daysPerWeek === 4
                    ? 'Push / Pull / Legs plus a dedicated cardio and core day.'
                    : 'One clean Push → Pull → Legs rotation.'}
                </span>
              </div>

              <div className="fit-field">
                <span className="fit-label" id="fit-length-label">
                  Time per session
                </span>
                <div className="fit-segmented" role="group" aria-labelledby="fit-length-label">
                  {SESSION_LENGTH_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`fit-segment${form.sessionMinutes === option.id ? ' is-active' : ''}`}
                      aria-pressed={form.sessionMinutes === option.id}
                      onClick={() => setFormField('sessionMinutes', option.id)}
                    >
                      {option.label}
                      {recommendations.sessionMinutes === option.id && <span className="fit-segment-badge">★</span>}
                    </button>
                  ))}
                </div>
                <span className="fit-hint">Controls how much accessory work lands after the main lifts.</span>
              </div>
            </div>

            {isUser && hasTrackedData && recommendations.reasons.length > 0 && (
              <div className="fit-recommendation">
                <p className="fit-recommendation-title">★ Recommended from your own training</p>
                <ul className="fit-recommendation-list">
                  {recommendations.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {(recommendations.daysPerWeek || recommendations.sessionMinutes) && (
                  <button type="button" className="fit-btn fit-btn-outline fit-btn--sm" onClick={useRecommended}>
                    Use recommended
                  </button>
                )}
              </div>
            )}

            <div className="fit-actions">
              <button type="button" className="fit-btn" onClick={() => generate(isUser ? { ...state.profile, ...form } : form)}>
                {basePlan ? 'Regenerate my week' : 'Build my week'}
              </button>
              {plan && (
                <span className="fit-hint">
                  Generated {formatDateLabel(plan.generatedAt, { withYear: true })} ·{' '}
                  {plan.days.length} sessions · {planGoal?.label.toLowerCase() ?? 'balanced'} ·{' '}
                  {planLevel?.label.toLowerCase() ?? 'intermediate'}
                </span>
              )}
            </div>
          </Section>

          {status && (
            <p className="fit-status" role="status">
              {status}
            </p>
          )}

          {/* ── 2 · Body & starting weights (signed in) ───────────── */}
          {isUser && (
            <Section
              id="body"
              title={SECTION_TITLES.body}
              summary={bodySummary}
              open={open.body}
              onToggle={toggleSection}
            >
              <div className="fit-card-head">
                <p className="fit-lead fit-lead--tight">
                  These are what turn &ldquo;4 × 6–8&rdquo; into an actual number on the bar. Every prescribed weight
                  updates the moment you change one of these.
                </p>
                <div className="fit-segmented" role="group" aria-label="Weight unit">
                  {UNITS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`fit-segment${units === option.id ? ' is-active' : ''}`}
                      aria-pressed={units === option.id}
                      onClick={() => setState((prev) => ({ ...prev, units: option.id }))}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="fit-form-grid">
                <label className="fit-field" htmlFor="fit-height">
                  <span className="fit-label">Height (cm)</span>
                  <input
                    id="fit-height"
                    className="fit-input fit-input--number"
                    type="number"
                    min="90"
                    max="260"
                    inputMode="numeric"
                    value={state.profile.heightCm}
                    onChange={(event) => updateProfile({ heightCm: event.target.value })}
                  />
                </label>

                <label className="fit-field" htmlFor="fit-bodyweight">
                  <span className="fit-label">Body weight ({units})</span>
                  <input
                    id="fit-bodyweight"
                    className="fit-input fit-input--number"
                    type="number"
                    min="20"
                    max="400"
                    step="0.1"
                    inputMode="decimal"
                    value={state.profile.bodyWeight}
                    onChange={(event) => updateProfile({ bodyWeight: event.target.value })}
                  />
                </label>

                <div className="fit-field">
                  <span className="fit-label">Today&rsquo;s check-in</span>
                  <div className="fit-inline-row">
                    <input
                      className="fit-input fit-input--number"
                      type="number"
                      min="20"
                      max="400"
                      step="0.1"
                      inputMode="decimal"
                      aria-label={`Today's body weight in ${units}`}
                      placeholder={latestWeight ? String(latestWeight.weight) : '—'}
                      value={checkInWeight}
                      onChange={(event) => setCheckInWeight(event.target.value)}
                    />
                    <button type="button" className="fit-btn fit-btn-outline fit-btn--sm" onClick={saveCheckIn}>
                      Log
                    </button>
                  </div>
                  <span className="fit-hint">
                    {latestWeight
                      ? `Last check-in ${latestWeight.weight} ${latestWeight.unit || units} on ${formatDateLabel(latestWeight.date, {
                          withYear: true,
                        })}.`
                      : 'One check-in makes your weights personal, not generic.'}
                  </span>
                </div>

                {ANCHOR_LIFTS.map((lift) => (
                  <div className="fit-field" key={lift.id}>
                    <span className="fit-label">{lift.label}</span>
                    <div className="fit-lift-row">
                      <input
                        className="fit-input fit-input--number"
                        type="number"
                        min="0"
                        step="0.5"
                        inputMode="decimal"
                        aria-label={`${lift.label} weight in ${units}`}
                        placeholder={units}
                        value={state.profile.lifts?.[lift.id]?.weight ?? ''}
                        onChange={(event) => updateLift(lift.id, 'weight', event.target.value)}
                      />
                      <span className="fit-lift-times">×</span>
                      <input
                        className="fit-input fit-input--number"
                        type="number"
                        min="1"
                        max="30"
                        inputMode="numeric"
                        aria-label={`${lift.label} reps`}
                        placeholder="reps"
                        value={state.profile.lifts?.[lift.id]?.reps ?? ''}
                        onChange={(event) => updateLift(lift.id, 'reps', event.target.value)}
                      />
                    </div>
                    <span className="fit-hint">{lift.hint}</span>
                  </div>
                ))}
              </div>

              <div className="fit-context">
                {describeContext(loadContext).map((line) => (
                  <p className="fit-hint" key={line}>
                    {line}
                  </p>
                ))}
              </div>
            </Section>
          )}

          {/* ── 3 · The week ──────────────────────────────────────── */}
          {plan && (
            <Section
              id="week"
              title={SECTION_TITLES.week}
              summary={weekSummary}
              open={open.week}
              onToggle={toggleSection}
            >
              <p className="fit-lead">
                Target {weeklyTarget} session{weeklyTarget === 1 ? '' : 's'} a week
                {plan.runMinutes > 0 ? ` · about ${plan.runMinutes} min of running` : ''} · every weight is a starting
                point, not a test. Pick a day to see its movements.
              </p>

              <div className="fit-daytabs" role="group" aria-label="Choose a day">
                {plan.days.map((day) => {
                  const runs = dayRunItems(day);
                  const where = runs.length > 0 ? 'outdoors' : day.location === 'home' ? 'at home' : 'at the gym';
                  const isActive = day.id === activeDayId;
                  return (
                    <button
                      key={day.id}
                      type="button"
                      className={`fit-daytab${isActive ? ' is-active' : ''}`}
                      aria-pressed={isActive}
                      aria-expanded={isActive}
                      aria-controls="fit-day-panel"
                      aria-label={`${day.name} — ${day.focus}, ${day.estimatedMinutes} min, ${where}`}
                      onClick={() => setSelectedDayId(day.id)}
                    >
                      <span className="fit-daytab-top">
                        <span className="fit-daytab-name">{day.name}</span>
                        {nextDay?.id === day.id && (
                          <span className="fit-daytab-dot" aria-label="Next up" />
                        )}
                      </span>
                      <span className="fit-daytab-meta">
                        {day.estimatedMinutes} min · {where}
                      </span>
                    </button>
                  );
                })}
              </div>

              {activeDay && (
                <DayCard
                  day={activeDay}
                  isNext={nextDay?.id === activeDay.id}
                  isUser={isUser}
                  onLog={openDay}
                  onGoToRunning={() => goTo('running')}
                />
              )}
            </Section>
          )}

          {/* ── 4 · Log sheet ─────────────────────────────────────── */}
          <Section
            id="log"
            title={SECTION_TITLES.log}
            summary={logSummary}
            open={open.log}
            onToggle={toggleSection}
            className="fit-log"
          >

            {!draft ? (
              <p className="fit-lead">
                {plan
                  ? 'Pick a day above and its sheet opens here — pre-filled with the prescribed weight for every movement and what you lifted last time. Tick the sets you actually complete.'
                  : 'Build a week above, then each day comes with a log sheet that opens here — pre-filled with the prescribed weight and what you lifted last time.'}
              </p>
            ) : (
              <>
                <p className="fit-lead">
                  {draft.dayName} · {draft.focus}
                  {draft.location ? ` · ${draft.location === 'home' ? 'at home' : 'at the gym'}` : ''} ·{' '}
                  {formatDateLabel(draft.date, { withYear: true })}
                </p>

                {timedEntries.length > 0 && (
                  <p className="fit-hint">
                    Timed holds are on the clock — {timedEntries.map((entry) => `${entry.name} ${entry.holdSeconds}s`).join(', ')}.
                    Use the hold button on the movement, and the rest button between sets.
                  </p>
                )}

                {draft.blocks.map((block, blockIndex) =>
                  block.entries.length === 0 ? null : (
                    <div className="fit-block" key={`${block.title}-${blockIndex}`}>
                      <h4 className="fit-block-title">{block.title}</h4>
                      {block.entries.map((entry, entryIndex) => (
                        <div className="fit-entry" key={`${entry.exerciseId}-${entryIndex}`}>
                          <div className="fit-entry-head">
                            <span className="fit-entry-name">{entry.name}</span>
                            <span className="fit-entry-target">{entry.prescription}</span>
                          </div>

                          {entry.load?.kind === 'weight' && (
                            <p className="fit-entry-load">
                              Prescribed <strong>{entry.load.text}</strong>
                            </p>
                          )}
                          {entry.kind === 'lift' && entry.load?.kind === 'bodyweight' && entry.bwNote && (
                            <p className="fit-entry-load">{entry.bwNote}</p>
                          )}

                          {entry.kind === 'cardio' ? (
                            <div className="fit-entry-row">
                              <label className="fit-inline-check">
                                <input
                                  type="checkbox"
                                  checked={entry.done}
                                  onChange={(event) => patchEntry(blockIndex, entryIndex, { done: event.target.checked })}
                                />
                                Done
                              </label>
                              <label className="fit-inline-field">
                                <span className="fit-label">Minutes</span>
                                <input
                                  className="fit-input fit-input--number"
                                  type="number"
                                  min="0"
                                  max="300"
                                  inputMode="numeric"
                                  value={entry.minutes}
                                  onChange={(event) => patchEntry(blockIndex, entryIndex, { minutes: event.target.value })}
                                />
                              </label>
                            </div>
                          ) : (
                            <>
                              <div className="fit-set-head" aria-hidden="true">
                                <span>Set</span>
                                <span>Weight ({draft.unit})</span>
                                <span>{entry.timed ? 'Seconds' : 'Reps'}</span>
                                <span>Done</span>
                                <span />
                              </div>
                              {entry.sets.map((set, setIndex) => (
                                <div className="fit-set-row" key={setIndex}>
                                  <span className="fit-set-index">{setIndex + 1}</span>
                                  <input
                                    className="fit-input fit-input--number"
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    inputMode="decimal"
                                    value={set.weight}
                                    aria-label={`${entry.name} set ${setIndex + 1} weight in ${draft.unit}`}
                                    onChange={(event) =>
                                      patchSet(blockIndex, entryIndex, setIndex, { weight: event.target.value })
                                    }
                                  />
                                  <input
                                    className="fit-input fit-input--number"
                                    type="number"
                                    min="0"
                                    max={entry.timed ? 600 : 100}
                                    inputMode="numeric"
                                    value={set.reps}
                                    aria-label={`${entry.name} set ${setIndex + 1} reps`}
                                    onChange={(event) =>
                                      patchSet(blockIndex, entryIndex, setIndex, { reps: event.target.value })
                                    }
                                  />
                                  <input
                                    type="checkbox"
                                    checked={set.done}
                                    aria-label={`Mark ${entry.name} set ${setIndex + 1} complete`}
                                    onChange={(event) =>
                                      patchSet(blockIndex, entryIndex, setIndex, { done: event.target.checked })
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="fit-set-remove"
                                    disabled={entry.sets.length <= 1}
                                    aria-label={`Remove ${entry.name} set ${setIndex + 1}`}
                                    onClick={() => removeSet(blockIndex, entryIndex, setIndex)}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}

                              <div className="fit-entry-tools">
                                {entry.holdSeconds ? (
                                  <HoldTimer seconds={entry.holdSeconds} label={`Hold ${entry.holdSeconds}s`} />
                                ) : null}
                                {entry.restSeconds ? (
                                  <HoldTimer
                                    seconds={entry.restSeconds}
                                    label={`Rest ${entry.restSeconds}s`}
                                    variant="outline"
                                  />
                                ) : null}
                                <button type="button" className="fit-link-btn" onClick={() => addSet(blockIndex, entryIndex)}>
                                  + Add set
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}

                <div className="fit-log-footer">
                  <label className="fit-field" htmlFor="fit-duration">
                    <span className="fit-label">Time taken (min)</span>
                    <input
                      id="fit-duration"
                      className="fit-input fit-input--number"
                      type="number"
                      min="1"
                      max="300"
                      inputMode="numeric"
                      value={draft.durationMin || ''}
                      onChange={(event) => setDraft((prev) => ({ ...prev, durationMin: event.target.value }))}
                    />
                  </label>
                  <label className="fit-field" htmlFor="fit-rpe">
                    <span className="fit-label">Session RPE</span>
                    <select
                      id="fit-rpe"
                      className="fit-input"
                      value={draft.rpe}
                      onChange={(event) => setDraft((prev) => ({ ...prev, rpe: event.target.value }))}
                    >
                      <option value="">—</option>
                      {RPE_OPTIONS.map((rpe) => (
                        <option key={rpe} value={rpe}>
                          {rpe}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="fit-field fit-field--wide" htmlFor="fit-notes">
                    <span className="fit-label">Notes</span>
                    <textarea
                      id="fit-notes"
                      className="fit-input fit-textarea"
                      rows={2}
                      placeholder="Felt strong on the press, knee a little cranky on squats…"
                      value={draft.notes}
                      onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
                    />
                  </label>
                </div>

                <p className="fit-live" aria-live="polite">
                  {summary.sets} set{summary.sets === 1 ? '' : 's'} ticked · {summary.exercises} movement
                  {summary.exercises === 1 ? '' : 's'} · {summary.volume.toLocaleString()} {draft.unit}
                  {summary.cardioMinutes > 0 ? ` · ${summary.cardioMinutes} min cardio` : ''}
                </p>

                <div className="fit-actions">
                  <button type="button" className="fit-btn" onClick={saveSession}>
                    {isUser ? 'Save session' : 'Save (sign in to keep it)'}
                  </button>
                  <button type="button" className="fit-btn fit-btn-outline" onClick={markAllDone}>
                    Tick everything
                  </button>
                  <button type="button" className="fit-btn fit-btn-text" onClick={() => setDraft(null)}>
                    Discard
                  </button>
                </div>
              </>
            )}
          </Section>

          {/* ── 5 · Running (signed in) ───────────────────────────── */}
          {isUser && (
            <Section
              id="running"
              title={SECTION_TITLES.running}
              summary={runningSummary}
              open={open.running}
              onToggle={toggleSection}
            >
              <p className="fit-lead">
                Log every run with its distance and time. Fit uses your own pace to turn &ldquo;easy run&rdquo; into a
                distance you can actually hit, and keeps weekly growth inside the safe ~10% window.
              </p>

              <div className="fit-run-form">
                <label className="fit-field" htmlFor="fit-run-date">
                  <span className="fit-label">Date</span>
                  <input
                    id="fit-run-date"
                    className="fit-input"
                    type="date"
                    value={runDraft.date}
                    onChange={(event) => setRunDraft((prev) => ({ ...prev, date: event.target.value }))}
                  />
                </label>
                <label className="fit-field" htmlFor="fit-run-distance">
                  <span className="fit-label">Distance ({distanceUnit})</span>
                  <input
                    id="fit-run-distance"
                    className="fit-input fit-input--number"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={runDraft.distance}
                    onChange={(event) => setRunDraft((prev) => ({ ...prev, distance: event.target.value }))}
                  />
                </label>
                <label className="fit-field" htmlFor="fit-run-minutes">
                  <span className="fit-label">Time (minutes)</span>
                  <input
                    id="fit-run-minutes"
                    className="fit-input fit-input--number"
                    type="number"
                    min="1"
                    max="600"
                    inputMode="numeric"
                    value={runDraft.minutes}
                    onChange={(event) => setRunDraft((prev) => ({ ...prev, minutes: event.target.value }))}
                  />
                </label>
                <label className="fit-field" htmlFor="fit-run-effort">
                  <span className="fit-label">Effort (1–10)</span>
                  <input
                    id="fit-run-effort"
                    className="fit-input fit-input--number"
                    type="number"
                    min="1"
                    max="10"
                    inputMode="numeric"
                    value={runDraft.effort}
                    onChange={(event) => setRunDraft((prev) => ({ ...prev, effort: event.target.value }))}
                  />
                </label>
                <label className="fit-field fit-field--wide" htmlFor="fit-run-pain">
                  <span className="fit-label">Anything hurt? (optional)</span>
                  <input
                    id="fit-run-pain"
                    className="fit-input"
                    type="text"
                    placeholder="Left shin felt tight from about 3 km…"
                    value={runDraft.pain}
                    onChange={(event) => setRunDraft((prev) => ({ ...prev, pain: event.target.value }))}
                  />
                </label>
              </div>

              <div className="fit-actions">
                <button type="button" className="fit-btn" onClick={saveRun}>
                  Log run
                </button>
                <span className="fit-hint">
                  {runSummary.count > 0
                    ? `${runSummary.distance} ${distanceUnit} across ${runSummary.count} run${
                        runSummary.count === 1 ? '' : 's'
                      } · longest ${runSummary.longest} ${distanceUnit}`
                    : 'No runs logged yet.'}
                </span>
              </div>

              {runSeries.some((week) => week.distance > 0) && (
                <div className="fit-chart">
                  <h3 className="fit-subheading">
                    Distance by week <span className="fit-hint">({distanceUnit})</span>
                  </h3>
                  <div className="fit-bars" role="img" aria-label={`Weekly running distance for the last ${runSeries.length} weeks`}>
                    {runSeries.map((week) => (
                      <div className="fit-bar-col" key={week.key}>
                        <span className="fit-bar-value">{week.distance > 0 ? week.distance : '—'}</span>
                        <div className="fit-bar-track">
                          <div
                            className={`fit-bar fit-bar--run${week.isCurrent ? ' is-current' : ''}`}
                            style={{ height: `${Math.round((week.distance / maxRunDistance) * 100)}%` }}
                          />
                        </div>
                        <span className="fit-bar-label">{week.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* ── 6 · Progress (signed in) ──────────────────────────── */}
          {isUser && (
            <Section
              id="progress"
              title={SECTION_TITLES.progress}
              summary={progressSummary}
              open={open.progress}
              onToggle={toggleSection}
            >

              <div className="fit-stats">
                <StatTile
                  label="sessions this week"
                  value={`${weeklyProgress.done}/${weeklyProgress.target}`}
                  note={weeklyProgress.onTrack ? 'Target hit' : `${weeklyProgress.remaining} to go`}
                />
                <StatTile
                  label={`week${streak === 1 ? '' : 's'} on target`}
                  value={streak}
                  note={streak > 0 ? 'Consecutive weeks at target' : 'Build one this week'}
                />
                <StatTile label="sessions logged" value={state.sessions.length} />
                <StatTile label="runs logged" value={state.runs.length} />
                <StatTile label={`total ${units} moved`} value={totalVolume(state.sessions, units).toLocaleString()} />
                <StatTile label="cardio minutes" value={totalCardioMinutes(state.sessions).toLocaleString()} />
              </div>

              <h3 className="fit-subheading">What your data says</h3>
              <ul className="fit-readout">
                {readout.map((item) => (
                  <li key={item.label}>
                    <span className="fit-readout-label">{item.label}</span>
                    <span className="fit-readout-value">{item.value}</span>
                    <span className="fit-readout-note">{item.note}</span>
                  </li>
                ))}
              </ul>

              {state.sessions.length > 0 && (
                <div className="fit-chart">
                  <h3 className="fit-subheading">
                    Volume by week <span className="fit-hint">({units} moved)</span>
                  </h3>
                  <div className="fit-bars" role="img" aria-label={`Weekly training volume for the last ${volumeSeries.length} weeks`}>
                    {volumeSeries.map((week) => (
                      <div className="fit-bar-col" key={week.key}>
                        <span className="fit-bar-value">{week.volume > 0 ? week.volume.toLocaleString() : '—'}</span>
                        <div className="fit-bar-track">
                          <div
                            className={`fit-bar${week.isCurrent ? ' is-current' : ''}`}
                            style={{ height: `${Math.round((week.volume / maxWeekVolume) * 100)}%` }}
                          />
                        </div>
                        <span className="fit-bar-label">{week.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {prs.length > 0 && (
                <div className="fit-chart">
                  <h3 className="fit-subheading">Personal records</h3>
                  <div className="fit-table-wrap">
                    <table className="fit-table">
                      <caption className="fit-sr-only">Heaviest set and best estimated one-rep max per movement</caption>
                      <thead>
                        <tr>
                          <th scope="col">Movement</th>
                          <th scope="col">Heaviest set</th>
                          <th scope="col">Best est. 1RM</th>
                          <th scope="col">Sets</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prs.map((record) => (
                          <tr key={record.exerciseId}>
                            <th scope="row">{record.name}</th>
                            <td>{record.bestWeight > 0 ? `${record.bestWeight} ${units} × ${record.bestWeightReps}` : '—'}</td>
                            <td>{record.bestE1rm > 0 ? `${record.bestE1rm} ${units}` : '—'}</td>
                            <td>{record.totalSets}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="fit-hint">
                    Estimated 1RM uses the Epley formula (weight × (1 + reps ÷ 30)) — useful for comparing a heavy triple
                    against a set of ten, which is exactly what the starting weights are built from.
                  </p>
                </div>
              )}
            </Section>
          )}

          {/* ── 7 · History (signed in) ───────────────────────────── */}
          {isUser && history.length > 0 && (
            <Section
              id="history"
              title={SECTION_TITLES.history}
              summary={historySummary}
              open={open.history}
              onToggle={toggleSection}
            >
              <ul className="fit-history">
                {history.map(({ kind, item }) => {
                  const isRun = kind === 'run';
                  const setCount = isRun ? 0 : sessionSetCount(item);
                  const cardio = isRun ? 0 : sessionCardioMinutes(item);
                  return (
                    <li className="fit-history-item" key={item.id}>
                      <span className="fit-history-main">
                        <span className="fit-history-day">
                          {isRun ? 'Run' : item.dayName}
                          {item.rpe ? <span className="fit-history-rpe">RPE {item.rpe}</span> : null}
                        </span>
                        <span className="fit-history-meta">
                          {formatDateLabel(item.date, { withYear: true })} ·{' '}
                          {isRun
                            ? `${item.distance} ${item.unit} in ${item.minutes} min${item.effort ? ` · effort ${item.effort}/10` : ''}`
                            : `${setCount} set${setCount === 1 ? '' : 's'} · ${sessionVolume(item, item.unit || units).toLocaleString()} ${
                                item.unit || units
                              }${cardio > 0 ? ` · ${cardio} min cardio` : ''}`}
                        </span>
                        {(item.notes || item.pain) && (
                          <span className="fit-history-notes">{item.notes || item.pain}</span>
                        )}
                      </span>

                      {confirmId === item.id ? (
                        <span className="fit-history-confirm">
                          <button
                            type="button"
                            className="fit-btn fit-btn-outline fit-btn--sm"
                            onClick={() => (isRun ? deleteRun(item.id) : deleteSession(item.id))}
                          >
                            Delete
                          </button>
                          <button type="button" className="fit-btn fit-btn-text fit-btn--sm" onClick={() => setConfirmId(null)}>
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="fit-link-btn" onClick={() => setConfirmId(item.id)}>
                          Delete
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {/* ── 8 · Coach ─────────────────────────────────────────── */}
          <Section
            id="coach"
            title={SECTION_TITLES.coach}
            summary={coachSummary}
            open={open.coach}
            onToggle={toggleSection}
            className="fit-coach"
          >

            {!isUser ? (
              <div className="fit-guard">
                <p className="fit-lead">
                  Coaching reads your logged sessions, runs, check-ins, and anything that hurts — so it needs an account
                  to read. You can keep using the generator for free without one, and nothing you do here is stored.
                </p>
                <div className="fit-actions">
                  <Link className="fit-btn" to="/register" state={{ redirectTo: '/fit' }}>
                    Create an account
                  </Link>
                  <Link className="fit-btn fit-btn-outline" to="/login" state={{ redirectTo: '/fit' }}>
                    Sign in
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <p className="fit-lead">
                  Tell Fit where it hurts and what you have been doing. It reads your own logged training and comes back
                  with specific changes to loads, running, and recovery.
                </p>
                <p className="fit-hint">{PAIN_GUIDANCE}</p>

                <div className="fit-form-grid">
                  <label className="fit-field" htmlFor="fit-pain-area">
                    <span className="fit-label">Pain area</span>
                    <select
                      id="fit-pain-area"
                      className="fit-input"
                      value={state.pain.area}
                      onChange={(event) => setState((prev) => ({ ...prev, pain: { ...prev.pain, area: event.target.value } }))}
                    >
                      {PAIN_AREAS.map((area) => (
                        <option key={area} value={area}>
                          {area === 'none' ? 'Nothing hurts' : area.replace(/-/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="fit-field" htmlFor="fit-pain-severity">
                    <span className="fit-label">Severity (0–10)</span>
                    <input
                      id="fit-pain-severity"
                      className="fit-input fit-input--number"
                      type="number"
                      min="0"
                      max="10"
                      inputMode="numeric"
                      value={state.pain.severity}
                      onChange={(event) =>
                        setState((prev) => ({ ...prev, pain: { ...prev.pain, severity: event.target.value } }))
                      }
                    />
                  </label>

                  <label className="fit-field" htmlFor="fit-pain-timing">
                    <span className="fit-label">When does it hurt?</span>
                    <select
                      id="fit-pain-timing"
                      className="fit-input"
                      value={state.pain.timing}
                      onChange={(event) => setState((prev) => ({ ...prev, pain: { ...prev.pain, timing: event.target.value } }))}
                    >
                      {PAIN_TIMINGS.map((timing) => (
                        <option key={timing || 'blank'} value={timing}>
                          {timing || 'Not sure'}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="fit-field fit-field--wide" htmlFor="fit-pain-notes">
                    <span className="fit-label">Anything else about it?</span>
                    <textarea
                      id="fit-pain-notes"
                      className="fit-input fit-textarea"
                      rows={2}
                      placeholder="Aches for a day after squats, worse going down stairs, no swelling…"
                      value={state.pain.notes}
                      onChange={(event) => setState((prev) => ({ ...prev, pain: { ...prev.pain, notes: event.target.value } }))}
                    />
                  </label>

                  <label className="fit-field fit-field--wide" htmlFor="fit-question">
                    <span className="fit-label">Your question (optional)</span>
                    <input
                      id="fit-question"
                      className="fit-input"
                      type="text"
                      placeholder="Should I deload next week?"
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                    />
                  </label>
                </div>

                <div className="fit-actions">
                  <button type="button" className="fit-btn" onClick={askCoach} disabled={coach.loading}>
                    {coach.loading ? 'Reading your training…' : 'Get coaching'}
                  </button>
                  <span className="fit-hint">
                    Uses your monthly AI credits. Sharing nothing? Just leave the pain fields at &ldquo;nothing hurts&rdquo;.
                  </span>
                </div>

                {coach.error && (
                  <div className="fit-error" role="alert">
                    <p>{coach.error.message}</p>
                    {coach.error.planRequired && (
                      <p className="fit-hint">
                        Your plan&rsquo;s AI credits are used up
                        {typeof coach.error.creditsRemaining === 'number'
                          ? ` (${coach.error.creditsRemaining} left)`
                          : ''}
                        . {/* Upgrade path is a real link so it survives middle-click. */}
                        <Link to={coach.error.upgradeUrl || '/pricing'}>See plans</Link>
                      </p>
                    )}
                  </div>
                )}

                {activeCoach?.advice && (
                  <div className="fit-advice">
                    <p className="fit-advice-summary">{activeCoach.advice.summary}</p>

                    {activeCoach.advice.seeAProfessional && (
                      <p className="fit-error" role="alert">
                        {activeCoach.advice.seeAProfessionalReason}{' '}
                        Please have a health professional look at this before you train around it.
                      </p>
                    )}

                    {activeCoach.advice.loadAdjustments?.length > 0 && (
                      <>
                        <h3 className="fit-subheading">Load changes</h3>
                        <ul className="fit-advice-list">
                          {activeCoach.advice.loadAdjustments.map((item) => (
                            <li key={`${item.exercise}-${item.suggestion}`}>
                              <strong>{item.exercise}</strong> — {item.suggestion}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    {activeCoach.advice.running && (
                      <>
                        <h3 className="fit-subheading">Running</h3>
                        <p className="fit-advice-text">{activeCoach.advice.running}</p>
                      </>
                    )}

                    {activeCoach.advice.recovery?.length > 0 && (
                      <>
                        <h3 className="fit-subheading">Recovery</h3>
                        <ul className="fit-advice-list">
                          {activeCoach.advice.recovery.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </>
                    )}

                    {activeCoach.advice.watchOuts?.length > 0 && (
                      <>
                        <h3 className="fit-subheading">Watch out for</h3>
                        <ul className="fit-advice-list">
                          {activeCoach.advice.watchOuts.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </>
                    )}

                    {activeCoach.disclaimer && <p className="fit-disclaimer">{activeCoach.disclaimer}</p>}
                  </div>
                )}
              </>
            )}
          </Section>

          {/* ── 9 · How it is built ───────────────────────────────── */}
          {plan && (
            <Section
              id="notes"
              title={SECTION_TITLES.notes}
              summary={notesSummary}
              open={open.notes}
              onToggle={toggleSection}
            >
              <ul className="fit-notes-list">
                {plan.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <p className="fit-disclaimer">
                Nothing here is medical advice. Fit is not a doctor or physiotherapist and cannot diagnose anything.
                Build up gradually, stop if something hurts, and talk to a qualified professional before starting a new
                programme if you have any concerns — especially after an injury, during pregnancy, or with a heart
                condition.
              </p>
              {isUser && (
                <p className="fit-hint">
                  Sessions, runs, check-ins, and your pain report are stored on your account so they follow you between
                  devices. {state.checkIns.length > 0 ? `${state.checkIns.length} check-in${state.checkIns.length === 1 ? '' : 's'} recorded.` : ''}
                </p>
              )}
              {!isUser && (
                <p className="fit-hint">
                  Guest mode: this week lives in the page only. Nothing is saved, and nothing is sent anywhere.
                </p>
              )}
            </Section>
          )}

          {(isUser && (basePlan || history.length > 0)) && (
            <div className="fit-danger">
              {confirmReset ? (
                <>
                  <span className="fit-hint">Delete your week, every logged session, run, and check-in?</span>
                  <button type="button" className="fit-btn fit-btn-outline fit-btn--sm" onClick={handleReset}>
                    Yes, clear everything
                  </button>
                  <button type="button" className="fit-btn fit-btn-text fit-btn--sm" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="fit-link-btn" onClick={() => setConfirmReset(true)}>
                  Clear my plan and history
                </button>
              )}
            </div>
          )}

          <a
            className="fit-source-link"
            href="https://github.com/tnnrhpwd/portfolio-app/tree/master/frontend/src/pages/Fit"
            rel="noopener noreferrer"
            target="_blank"
          >
            View Source Code
          </a>

          <p className="fit-hint fit-hint--foot">
            {isUser
              ? 'Your training data is stored against your account. Logging runs and check-ins is what makes the coaching specific to you.'
              : 'Guest mode stores nothing — no account, no cookie, no history. Sign in whenever you want Fit to remember.'}
          </p>
        </main>
      </div>

      <Footer />
    </>
  );
}

export default Fit;
