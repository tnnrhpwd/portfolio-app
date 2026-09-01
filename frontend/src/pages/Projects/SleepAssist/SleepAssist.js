import React, { useEffect, useMemo, useState } from 'react';
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import SEO from '../../../components/SEO/SEO.jsx';
import './SleepAssist.css';

const MINUTES_PER_DAY = 24 * 60;
const CYCLE_MINUTES = 90; // one natural sleep cycle ≈ 90 minutes
const CYCLE_COUNTS = [4, 5, 6]; // 6h, 7.5h, 9h of sleep
const IDEAL_CYCLES = 5;
const FALL_ASLEEP_BUFFER = 15; // extra minutes to drift off

const MODES = [
    {
        key: 'bedtime',
        label: 'Bedtime',
        timeLabel: 'Wake Time',
        timePlaceholder: '700',
        resultLabel: 'Go to bed at',
        buttonLabel: 'Calculate Bedtime',
    },
    {
        key: 'wakeup',
        label: 'Wake-up',
        timeLabel: 'Bedtime',
        timePlaceholder: '2230',
        resultLabel: 'Wake up at',
        buttonLabel: 'Calculate Wake-up',
    },
    {
        key: 'now',
        label: 'Sleep now',
        timeLabel: null,
        timePlaceholder: null,
        resultLabel: null,
        buttonLabel: null,
    },
];

const SLIDER_MIN = 180; // 3 hours
const SLIDER_MAX = 720; // 12 hours
const SLIDER_STEP = 30;

const DURATION_PRESETS = [
    { label: '6h', minutes: 360 },
    { label: '7h 30m', minutes: 450 },
    { label: '9h', minutes: 540 },
];

// Accepts "700", "07:00", "9:00" and returns minutes since midnight,
// or null when the input isn't a valid 24-hour time.
function parseTimeInput(input) {
    const cleaned = String(input ?? '').trim();
    if (!cleaned) return null;

    let hours;
    let minutes;
    if (cleaned.includes(':')) {
        const [h, m] = cleaned.split(':');
        hours = parseInt(h, 10);
        minutes = parseInt(m || '0', 10);
    } else {
        const padded = cleaned.padStart(4, '0');
        hours = parseInt(padded.slice(0, 2), 10);
        minutes = parseInt(padded.slice(2, 4), 10);
    }

    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function toHHMM(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}${m}`;
}

function describeTime(minutes) {
    const total = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hours24 = Math.floor(total / 60);
    const mins = total % 60;
    const hh = String(hours24).padStart(2, '0');
    const mm = String(mins).padStart(2, '0');
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return {
        hhmm: `${hh}:${mm}`,
        h12: `${hours12}:${mm} ${period}`,
    };
}

function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

function SleepAssist() {
    const [mode, setMode] = useState('bedtime');
    const [timeInput, setTimeInput] = useState('');
    const [durationMinutes, setDurationMinutes] = useState(450);
    const [addBuffer, setAddBuffer] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [now, setNow] = useState(() => new Date());

    // Keep the "Now" quick-fill and sleep-now clock current.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30 * 1000);
        return () => clearInterval(id);
    }, []);

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const activeMode = MODES.find((m) => m.key === mode);

    // The time we calculate from: wake time (bedtime mode), bedtime
    // (wake-up mode), or the current time (sleep-now mode).
    const anchorMinutes = mode === 'now' ? nowMinutes : parseTimeInput(timeInput);

    const recommendations = useMemo(() => {
        if (anchorMinutes === null) return [];
        const direction = mode === 'bedtime' ? 'backward' : 'forward';
        const buffer = addBuffer ? FALL_ASLEEP_BUFFER : 0;
        return CYCLE_COUNTS.map((cycles) => {
            const duration = cycles * CYCLE_MINUTES + buffer;
            const target = direction === 'backward'
                ? (anchorMinutes - duration + MINUTES_PER_DAY) % MINUTES_PER_DAY
                : (anchorMinutes + duration) % MINUTES_PER_DAY;
            return { cycles, duration, time: describeTime(target), ideal: cycles === IDEAL_CYCLES };
        });
    }, [anchorMinutes, mode, addBuffer]);

    function handleCalculate() {
        if (mode === 'now') return;

        const anchor = parseTimeInput(timeInput);
        if (anchor === null) {
            setError(`Please enter a valid ${activeMode.timeLabel.toLowerCase()} (e.g. ${activeMode.timePlaceholder} or 07:00).`);
            setResult(null);
            return;
        }

        const buffer = addBuffer ? FALL_ASLEEP_BUFFER : 0;
        const duration = durationMinutes + buffer;

        const target = mode === 'bedtime'
            ? (anchor - duration + MINUTES_PER_DAY) % MINUTES_PER_DAY
            : (anchor + duration) % MINUTES_PER_DAY;
        setError('');
        setResult(describeTime(target));
    }

    function handleKeyPress(event) {
        if (event.key === 'Enter') handleCalculate();
    }

    function fillTimeNow() {
        setTimeInput(toHHMM(now));
        setError('');
    }

    const cycleAligned = durationMinutes % CYCLE_MINUTES === 0;
    const cycleCount = Math.round(durationMinutes / CYCLE_MINUTES);

    const recTitle = mode === 'bedtime' ? 'Recommended bedtimes' : 'Recommended wake-up times';
    const recHint = mode === 'bedtime'
        ? 'Go to bed at one of these times to finish a complete cycle by your alarm — tap one to set your duration:'
        : 'Aim for one of these times to wake up at the end of a full cycle — tap one to set your duration:';

    return (
        <>
            <SEO
                title="SleepAssist"
                description="Calculate optimal sleep and wake times based on natural sleep cycles."
                path="/sleepassist"
            />
            <Header />
            <div className="sleepassist">
                <div className="sleepassist-floating" aria-hidden="true">
                    <div className="sleepassist-circle sleepassist-circle-1" />
                    <div className="sleepassist-circle sleepassist-circle-2" />
                    <div className="sleepassist-circle sleepassist-circle-3" />
                </div>

                <section className="sleepassist-section">
                    <div className="sleepassist-title-wrap">
                        <h1 className="sleepassist-title">SleepAssist</h1>
                        <div className="sleepassist-underline" aria-hidden="true" />
                        <p className="sleepassist-subtitle">
                            Plan the perfect night's sleep. Calculate bedtimes and wake-up times around natural 90-minute sleep cycles.
                        </p>
                    </div>

                    <div className="sleepassist-modes" role="group" aria-label="Calculator mode">
                        {MODES.map((m) => (
                            <button
                                key={m.key}
                                type="button"
                                className={`sleepassist-mode${mode === m.key ? ' is-active' : ''}`}
                                aria-pressed={mode === m.key}
                                onClick={() => { setMode(m.key); setResult(null); setError(''); }}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>

                    <div className="sleepassist-card">
                        <h2>{mode === 'now' ? 'Right Now' : `${activeMode.label} Calculator`}</h2>

                        {mode === 'now' ? (
                            <div className="sleepassist-now">
                                <div className="sleepassist-now-clock">{describeTime(nowMinutes).hhmm}</div>
                                <p className="sleepassist-now-hint">It's {describeTime(nowMinutes).h12} right now.</p>
                            </div>
                        ) : (
                            <>
                                <div className="sleepassist-field">
                                    <label className="sleepassist-label" htmlFor="sleepassist-time">{activeMode.timeLabel}</label>
                                    <div className="sleepassist-field-row">
                                        <input
                                            id="sleepassist-time"
                                            className="sleepassist-input"
                                            placeholder={activeMode.timePlaceholder}
                                            value={timeInput}
                                            onChange={(event) => setTimeInput(event.target.value)}
                                            onKeyDown={handleKeyPress}
                                            inputMode="numeric"
                                        />
                                        <button type="button" className="sleepassist-btn secondary" onClick={fillTimeNow}>Now</button>
                                    </div>
                                </div>

                                <div className="sleepassist-field">
                                    <span className="sleepassist-label">Sleep Duration</span>
                                    <div className="sleepassist-slider-value">
                                        <span className="sleepassist-slider-duration">{formatDuration(durationMinutes)}</span>
                                        {cycleAligned && <span className="sleepassist-slider-cycles">· {cycleCount} cycles</span>}
                                    </div>
                                    <input
                                        type="range"
                                        className="sleepassist-slider"
                                        min={SLIDER_MIN}
                                        max={SLIDER_MAX}
                                        step={SLIDER_STEP}
                                        value={durationMinutes}
                                        onChange={(event) => setDurationMinutes(Number(event.target.value))}
                                        aria-label="Sleep duration"
                                    />
                                    <div className="sleepassist-preset-row" role="group" aria-label="Cycle-aligned duration presets">
                                        {DURATION_PRESETS.map((preset) => (
                                            <button
                                                key={preset.label}
                                                type="button"
                                                className="sleepassist-preset"
                                                onClick={() => setDurationMinutes(preset.minutes)}
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        <label className="sleepassist-buffer">
                            <input
                                type="checkbox"
                                checked={addBuffer}
                                onChange={(event) => setAddBuffer(event.target.checked)}
                            />
                            <span>Add {FALL_ASLEEP_BUFFER} minutes to fall asleep</span>
                        </label>

                        {mode !== 'now' && (
                            <>
                                {error && <div className="sleepassist-error" role="alert">{error}</div>}

                                <div className="sleepassist-btn-row">
                                    <button type="button" className="sleepassist-btn" onClick={handleCalculate}>{activeMode.buttonLabel}</button>
                                </div>

                                {result && (
                                    <div className="sleepassist-result" aria-live="polite">
                                        <span className="sleepassist-result-label">{activeMode.resultLabel}</span>
                                        <span className="sleepassist-result-time">{result.hhmm}</span>
                                        <span className="sleepassist-result-time-alt">{result.h12}</span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {recommendations.length > 0 && (
                        <div className="sleepassist-card">
                            <h2>{recTitle}</h2>
                            <p className="sleepassist-cycle-hint">{recHint}</p>
                            <div className="sleepassist-recommendations">
                                {recommendations.map((rec) => (
                                    <button
                                        key={rec.cycles}
                                        type="button"
                                        className={`sleepassist-recommendation${rec.ideal ? ' is-ideal' : ''}`}
                                        onClick={() => setDurationMinutes(rec.cycles * CYCLE_MINUTES)}
                                    >
                                        {rec.ideal && <span className="sleepassist-recommendation-badge">Recommended</span>}
                                        <span className="sleepassist-recommendation-time">{rec.time.hhmm}</span>
                                        <span className="sleepassist-recommendation-meta">{rec.cycles} cycles · {formatDuration(rec.cycles * CYCLE_MINUTES)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="sleepassist-card">
                        <h2>Sleep cycles, briefly</h2>
                        <p className="sleepassist-cycle-hint">
                            A full sleep cycle lasts roughly {CYCLE_MINUTES} minutes. Waking at the end of a cycle — after about 6, 7.5, or 9 hours — usually feels better than waking mid-cycle.
                        </p>
                    </div>

                    <a
                        className="sleepassist-source-link"
                        href="https://github.com/tnnrhpwd/portfolio-app/tree/master/frontend/src/pages/Projects/SleepAssist"
                        rel="noopener noreferrer"
                        target="_blank"
                    >
                        View Source Code
                    </a>
                </section>
            </div>
            <Footer />
        </>
    );
}

export default SleepAssist;