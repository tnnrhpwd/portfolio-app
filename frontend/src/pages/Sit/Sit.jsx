import React, { useEffect, useMemo, useState } from 'react';

import Footer from '../../components/Footer/Footer';
import Header from '../../components/Header/Header';
import SEO from '../../components/SEO/SEO.jsx';
import useScrollReveal from '../../hooks/useScrollReveal';

import './Sit.css';

const CYCLES = {
  sitstandmove: {
    id: 'sitstandmove',
    name: 'Sit & Stand & Move',
    short: '3 steps',
    desc: 'Sit, stand, then step away and move. Adds a short movement break to the loop.',
    phases: ['sit', 'stand', 'move'],
    recommended: { sit: 20, stand: 8, move: 2 },
  },
  sitstand: {
    id: 'sitstand',
    name: 'Sit & Stand',
    short: '2 steps',
    desc: 'Alternate sitting and standing. The simplest rotation for a standing desk.',
    phases: ['sit', 'stand'],
    recommended: { sit: 20, stand: 8 },
  },
};

const PHASES = {
  sit: {
    label: 'Sit',
    glyph: '🪑',
    hint: 'Stay seated and focused',
    color: 'var(--fg-blue)',
  },
  stand: {
    label: 'Stand',
    glyph: '🧍',
    hint: 'Raise the desk and stand tall',
    color: 'var(--fg-mint)',
  },
  move: {
    label: 'Move',
    glyph: '🚶',
    hint: 'Walk, stretch, or grab some water',
    color: 'var(--fg-orange)',
  },
};

// What to do when the phase after `key` begins.
const NEXT_INSTRUCTION = {
  sit: 'Time to sit down',
  stand: 'Time to stand up',
  move: 'Time to move around',
};

// Geometry for the circular phase dial (viewBox 0 0 220 220).
const DIAL = { cx: 110, cy: 110, rOuter: 104, rInner: 72 };

function polar(cx, cy, r, angle) {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

// Builds an annular sector (donut slice) path between two angles in radians.
// 0 = 12 o'clock, increasing clockwise (matching a clock face).
function sectorPath(cx, cy, rOuter, rInner, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOuter, a0);
  const [x1, y1] = polar(cx, cy, rOuter, a1);
  const [x2, y2] = polar(cx, cy, rInner, a1);
  const [x3, y3] = polar(cx, cy, rInner, a0);
  return [
    `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function parseMinutes(raw) {
  const n = Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(n) || n < 1) {
    return null;
  }
  return Math.min(600, Math.round(n));
}

function formatClock(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) {
    return '--:--';
  }
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function playChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const t0 = ctx.currentTime;
    [0, 0.16, 0.32].forEach(offset => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = offset === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.32);
    });
  } catch {
    // Audio is unavailable (no permission, old browser) — the timer still works.
  }
}

function Sit() {
  const [cycleId, setCycleId] = useState('sitstandmove');
  const [durations, setDurations] = useState({ sit: '20', stand: '8', move: '2' });
  const [activeIndex, setActiveIndex] = useState(null);
  const [endAt, setEndAt] = useState(null);
  const [pausedRemaining, setPausedRemaining] = useState(null);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState(null);
  const [soundOn, setSoundOn] = useState(true);
  const [durationError, setDurationError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const [revealRef, revealed] = useScrollReveal();

  const cycle = CYCLES[cycleId];
  const phases = cycle.phases;

  // Tick the clock while a phase is running.
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [running]);

  const activeKey = activeIndex !== null ? phases[activeIndex] : null;
  const activeTotal = activeKey ? (parseMinutes(durations[activeKey]) || 0) * 60 : 0;

  const secondsLeft =
    running && endAt
      ? Math.max(0, Math.ceil((endAt - now) / 1000))
      : activeIndex !== null
        ? (pausedRemaining !== null ? pausedRemaining : activeTotal)
        : null;

  // Auto-advance to the next phase when the current one reaches zero.
  useEffect(() => {
    if (!running || activeIndex === null || endAt === null) return;
    const remaining = Math.max(0, Math.ceil((endAt - now) / 1000));
    if (remaining > 0) return;

    const nextIndex = (activeIndex + 1) % phases.length;
    const nextKey = phases[nextIndex];
    const nextTotal = Math.max(1, (parseMinutes(durations[nextKey]) || 1) * 60);
    setNow(Date.now());
    setFlash(NEXT_INSTRUCTION[nextKey]);
    setActiveIndex(nextIndex);
    setEndAt(Date.now() + nextTotal * 1000);
    if (soundOn) playChime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  function startPhase(index) {
    const key = phases[index];
    const mins = parseMinutes(durations[key]);
    if (mins === null) {
      setDurationError(`Enter a valid duration for “${PHASES[key].label}” (1–600 minutes).`);
      return;
    }
    setDurationError('');
    setNow(Date.now());
    setActiveIndex(index);
    setEndAt(Date.now() + mins * 60 * 1000);
    setPausedRemaining(null);
    setRunning(true);
    setFlash(null);
  }

  function pauseTimer() {
    if (!running || activeIndex === null) return;
    const remaining = Math.max(0, Math.ceil((endAt - now) / 1000));
    setPausedRemaining(remaining);
    setRunning(false);
    setEndAt(null);
  }

  function resumeTimer() {
    if (running || activeIndex === null || pausedRemaining === null) return;
    setNow(Date.now());
    setEndAt(Date.now() + pausedRemaining * 1000);
    setRunning(true);
    setFlash(null);
  }

  function stopTimer() {
    setRunning(false);
    setActiveIndex(null);
    setEndAt(null);
    setPausedRemaining(null);
    setFlash(null);
  }

  function skipToNext() {
    if (activeIndex === null) return;
    const nextIndex = (activeIndex + 1) % phases.length;
    const nextKey = phases[nextIndex];
    const nextTotal = Math.max(1, (parseMinutes(durations[nextKey]) || 1) * 60);
    setNow(Date.now());
    setFlash(NEXT_INSTRUCTION[nextKey]);
    setActiveIndex(nextIndex);
    setEndAt(Date.now() + nextTotal * 1000);
    setPausedRemaining(null);
    setRunning(true);
    if (soundOn) playChime();
  }

  function switchCycle(id) {
    setCycleId(id);
    setRunning(false);
    setActiveIndex(null);
    setEndAt(null);
    setPausedRemaining(null);
    setFlash(null);
    setDurationError('');
  }

  function applyRecommended() {
    const rec = cycle.recommended;
    setDurations({
      sit: String(rec.sit ?? durations.sit),
      stand: String(rec.stand ?? durations.stand),
      move: String(rec.move ?? durations.move),
    });
    setDurationError('');
  }

  function updateDuration(key, value) {
    setDurations(d => ({ ...d, [key]: value }));
    setDurationError('');
  }

  const nextKey = activeKey !== null ? phases[(activeIndex + 1) % phases.length] : null;

  // Circular dial: one colored slice per phase, sized by its duration.
  const dialSegments = useMemo(() => {
    const minutes = phases.map(key => parseMinutes(durations[key]) || 0);
    const total = minutes.reduce((sum, n) => sum + n, 0) || 1;
    const gap = 0.022;
    let cumulative = 0;
    return phases.map((key, index) => {
      const start = (cumulative / total) * Math.PI * 2;
      const end = ((cumulative + minutes[index]) / total) * Math.PI * 2;
      cumulative += minutes[index];
      return {
        key,
        color: PHASES[key].color,
        path: sectorPath(
          DIAL.cx,
          DIAL.cy,
          DIAL.rOuter,
          DIAL.rInner,
          start + gap,
          end - gap
        ),
      };
    });
  }, [phases, durations]);

  // Where the hand sits around the whole loop, in degrees (0 = 12 o'clock).
  const cycleTotalSeconds = Math.max(
    1,
    phases.reduce(
      (sum, key) => sum + (parseMinutes(durations[key]) || 0) * 60,
      0
    )
  );
  const elapsedInCycle =
    activeIndex === null
      ? 0
      : phases
          .slice(0, activeIndex)
          .reduce(
            (sum, key) => sum + (parseMinutes(durations[key]) || 0) * 60,
            0
          ) + Math.max(0, activeTotal - (secondsLeft ?? activeTotal));
  const handAngle = (elapsedInCycle / cycleTotalSeconds) * 360;

  const recommendedSummary = phases
    .map(key => `${PHASES[key].label} ${cycle.recommended[key]} min`)
    .join(' · ');

  return (
    <>
      <SEO
        title="Sit — Sit / Stand Desk Timer"
        description="A sit-stand-move timer that rotates through custom-length phases. Pick a phase and it counts you down to your next stand, sit, or movement break."
        path="/sit"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: 'Sit — Sit / Stand Desk Timer',
          url: 'https://sthopwood.com/sit',
          applicationCategory: 'HealthApplication',
          operatingSystem: 'Any',
          browserRequirements: 'Requires JavaScript',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          description:
            'Rotate between sitting, standing, and moving with custom-length timer phases.',
        }}
      />
      <Header />

      <div className="sit">
        <div className="sit-floating" aria-hidden="true">
          <div className="sit-circle sit-circle-1" />
          <div className="sit-circle sit-circle-2" />
          <div className="sit-circle sit-circle-3" />
        </div>

        <section className="sit-hero">
          <div className="sit-title-wrap">
            <p className="sit-eyebrow">Desk break timer</p>
            <h1 className="sit-title">Sit</h1>
            <p className="sit-subtitle">
              Rotate between sitting, standing, and moving. Pick a cycle, set
              your durations, then tap a phase to start its countdown — it
              loops and tells you when to stand and sit again.
            </p>
          </div>
        </section>

        <main
          id="main"
          ref={revealRef}
          className={`sit-main sit-reveal ${revealed ? 'is-visible' : ''}`}
        >
          {/* 1 · Cycle */}
          <section className="sit-card" aria-label="Choose a cycle">
            <h2>1 · Pick your cycle</h2>
            <div className="sit-cycles" role="radiogroup" aria-label="Cycle">
              {Object.values(CYCLES).map(c => {
                const selected = c.id === cycleId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`sit-cycle${selected ? ' selected' : ''}`}
                    onClick={() => switchCycle(c.id)}
                  >
                    <span className="sit-cycle-top">
                      <span className="sit-cycle-name">{c.name}</span>
                      <span className="sit-cycle-short">{c.short}</span>
                    </span>
                    <span className="sit-cycle-desc">{c.desc}</span>
                    <span className="sit-cycle-rec">
                      Recommended: {c.phases.map(k => `${PHASES[k].label} ${c.recommended[k]} min`).join(' · ')}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2 · Durations */}
          <section className="sit-card" aria-label="Set durations">
            <h2>2 · Set durations</h2>
            <div className="sit-durations">
              {phases.map(key => (
                <div className="sit-duration" key={key}>
                  <label className="sit-label" htmlFor={`sit-duration-${key}`}>
                    <span className="sit-duration-glyph" aria-hidden="true">
                      {PHASES[key].glyph}
                    </span>
                    {PHASES[key].label}
                  </label>
                  <div className="sit-duration-input-wrap">
                    <input
                      id={`sit-duration-${key}`}
                      className="sit-input"
                      type="number"
                      min="1"
                      max="600"
                      inputMode="numeric"
                      value={durations[key]}
                      onChange={event => updateDuration(key, event.target.value)}
                    />
                    <span className="sit-duration-unit">min</span>
                  </div>
                  <span className="sit-duration-rec">
                    Recommended: {cycle.recommended[key]} min
                  </span>
                </div>
              ))}
            </div>

            <div className="sit-recommended-row">
              <button
                type="button"
                className="sit-btn sit-btn-outline"
                onClick={applyRecommended}
              >
                Use recommended ({recommendedSummary})
              </button>
            </div>

            {durationError && (
              <div className="sit-error" role="alert">
                {durationError}
              </div>
            )}
          </section>

          {/* 3 · Timer */}
          <section className="sit-card sit-timer-card" aria-label="Start the timer">
            <h2>3 · Start a phase</h2>

            <div className="sit-stepper" role="group" aria-label="Phases">
              {phases.map((key, index) => {
                const isActive = activeIndex === index;
                const mins = parseMinutes(durations[key]);
                return (
                  <React.Fragment key={key}>
                    {index > 0 && (
                      <span className="sit-step-arrow" aria-hidden="true">
                        →
                      </span>
                    )}
                    <button
                      type="button"
                      className={`sit-phase${isActive ? ' active' : ''}`}
                      onClick={() => startPhase(index)}
                    >
                      <span className="sit-phase-glyph" aria-hidden="true">
                        {PHASES[key].glyph}
                      </span>
                      <span className="sit-phase-label">
                        {PHASES[key].label}
                        {isActive && <span className="sit-phase-now"> now</span>}
                      </span>
                      <span className="sit-phase-time">
                        {mins !== null ? `${mins} min` : '—'}
                      </span>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="sit-dial-wrap">
              <svg
                className="sit-dial"
                viewBox="0 0 220 220"
                role="img"
                aria-label={
                  activeKey === null
                    ? 'Posture loop timer, idle'
                    : `${PHASES[activeKey].label} timer — ${formatClock(secondsLeft)} remaining`
                }
              >
                {dialSegments.map(seg => {
                  const isActive = activeKey === seg.key;
                  const opacity = activeIndex === null ? 0.9 : isActive ? 1 : 0.32;
                  return (
                    <path
                      key={seg.key}
                      d={seg.path}
                      fill={seg.color}
                      opacity={opacity}
                    />
                  );
                })}
                <g
                  className="sit-dial-hand"
                  transform={`rotate(${handAngle} ${DIAL.cx} ${DIAL.cy})`}
                >
                  <line
                    x1={DIAL.cx}
                    y1={DIAL.cy}
                    x2={DIAL.cx}
                    y2={DIAL.cy - (DIAL.rOuter - 8)}
                  />
                </g>
              </svg>

              <div className="sit-dial-center" aria-hidden="true">
                <span className="sit-dial-glyph">
                  {activeKey === null ? '⏱️' : PHASES[activeKey].glyph}
                </span>
                <span className="sit-dial-clock">{formatClock(secondsLeft)}</span>
                <span className="sit-dial-label">
                  {activeKey === null ? 'Ready' : PHASES[activeKey].label}
                  {activeKey !== null && !running && (
                    <span className="sit-dial-paused"> · paused</span>
                  )}
                </span>
              </div>
            </div>

            <p className="sit-dial-next" aria-live="polite">
              {activeKey === null
                ? 'Tap a phase above to start the loop'
                : `Next: ${PHASES[nextKey].label} · ${PHASES[nextKey].hint}`}
            </p>

            {flash && (
              <div className="sit-flash" role="status">
                ⏰ {flash}
              </div>
            )}

            <div className="sit-controls">
              {activeIndex === null ? (
                <span className="sit-controls-hint">Choose a phase to begin</span>
              ) : running ? (
                <button type="button" className="sit-btn" onClick={pauseTimer}>
                  Pause
                </button>
              ) : (
                <button type="button" className="sit-btn" onClick={resumeTimer}>
                  Resume
                </button>
              )}
              {activeIndex !== null && (
                <>
                  <button
                    type="button"
                    className="sit-btn sit-btn-outline"
                    onClick={skipToNext}
                  >
                    Skip to next
                  </button>
                  <button
                    type="button"
                    className="sit-btn sit-btn-outline"
                    onClick={stopTimer}
                  >
                    Reset
                  </button>
                </>
              )}
            </div>

            <label className="sit-sound">
              <input
                type="checkbox"
                checked={soundOn}
                onChange={event => setSoundOn(event.target.checked)}
              />
              Play a chime when a phase ends
            </label>
          </section>

          {/* How it works */}
          <section className="sit-card sit-info-card">
            <h2>How it works</h2>
            <ul className="sit-info-list">
              <li>
                Click any phase — sit, stand, or move — and its timer starts
                counting down immediately.
              </li>
              <li>
                When a phase ends, the loop advances automatically and keeps
                going, so you never have to remember to restart it.
              </li>
              <li>
                The “Use recommended” button applies the Cornell 20–8–2 rule
                (20 min sit · 8 min stand · 2 min move).
              </li>
              <li>
                Pause, skip, or reset at any time. The chime is a gentle cue you
                can turn off.
              </li>
            </ul>
          </section>

          <a
            className="sit-source-link"
            href="https://github.com/tnnrhpwd/portfolio-app/tree/master/frontend/src/pages/Sit"
            rel="noopener noreferrer"
            target="_blank"
          >
            View Source Code
          </a>
        </main>
      </div>

      <Footer />
    </>
  );
}

export default Sit;
