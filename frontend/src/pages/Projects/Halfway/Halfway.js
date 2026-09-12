import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSunrise, getSunset } from 'sunrise-sunset-js';

import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import SEO from '../../../components/SEO/SEO.jsx';

import './Halfway.css';
import {
  GEOLOCATION,
  isPermissionEnabled,
  queryPermissionState,
  setPermissionEnabled,
} from '../../../utils/browserPermissions.js';
import {
  MINUTES_PER_DAY,
  formatDuration,
  minutesTo12h,
  minutesToCompact,
  minutesToHhmm,
  minutesToLabel,
  parseTimeInput,
  solveTimeMath,
} from './halfwayUtils.js';

const MODE_KEYS = ['midpoint', 'end', 'start'];

const MODES = {
  midpoint: {
    tabName: 'Halfway point',
    tabDesc: 'Start + end → middle',
    blurb: 'You know the start and end of a window — find its exact middle.',
    aLabel: 'Start time',
    bLabel: 'End time',
    answerLabel: 'Halfway point',
  },
  end: {
    tabName: 'End time',
    tabDesc: 'Start + halfway → end',
    blurb:
      'You know when you start and when you want to hit the middle — find the end.',
    aLabel: 'Start time',
    bLabel: 'Halfway time',
    answerLabel: 'End time',
    rangeError:
      'The halfway time must come after the start time and within the next 12 hours. Pick a later halfway time or an earlier start.',
  },
  start: {
    tabName: 'Start time',
    tabDesc: 'End + halfway → start',
    blurb:
      'You know when you finish and when you want to hit the middle — find the start.',
    aLabel: 'End time',
    bLabel: 'Halfway time',
    answerLabel: 'Start time',
    rangeError:
      'The halfway time must come before the end time and within the previous 12 hours. Pick an earlier halfway time or a later end.',
  },
};

const QUICK_CHIPS = [
  { key: 'now', label: 'Now' },
  { key: 'sunrise', label: 'Sunrise' },
  { key: 'sunset', label: 'Sunset' },
];

const COORDS_STORAGE_KEY = 'halfway-coords-v1';

/** Read ?a=&b=&mode= from the address bar so results can be shared/bookmarked. */
function readInitialState() {
  try {
    const params = new URLSearchParams(window.location.search);
    const rawMode = params.get('mode');
    return {
      mode: MODE_KEYS.includes(rawMode) ? rawMode : 'midpoint',
      a: params.get('a') || '',
      b: params.get('b') || '',
    };
  } catch {
    return { mode: 'midpoint', a: '', b: '' };
  }
}

/** Seconds-level live clock. Isolated so the rest of the page does not re-render each second. */
function NowClock() {
  const [value, setValue] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setValue(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className='halfway-now-clock'>
      {value.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </span>
  );
}

function getTimeZoneLabel() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
    const offsetMin = -new Date().getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${tz} (UTC${sign}${hh}:${mm})`;
  } catch {
    return 'local time';
  }
}

/** Clipboard helper with a fallback for older browsers / non-secure contexts. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function loadSavedCoords() {
  try {
    const raw = localStorage.getItem(COORDS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng)
    ) {
      return {
        lat: parsed.lat,
        lng: parsed.lng,
        source: parsed.source === 'manual' ? 'manual' : 'device',
      };
    }
  } catch {
    // ignore unreadable storage
  }
  return null;
}

function saveCoords(coords) {
  try {
    if (!coords) localStorage.removeItem(COORDS_STORAGE_KEY);
    else localStorage.setItem(COORDS_STORAGE_KEY, JSON.stringify(coords));
  } catch {
    // storage may be unavailable (private browsing) — solar times still work in-memory
  }
}

function Halfway() {
  const [initial] = useState(readInitialState);
  const [mode, setMode] = useState(initial.mode);
  const [fieldA, setFieldA] = useState(initial.a);
  const [fieldB, setFieldB] = useState(initial.b);

  // ── Location & solar times ─────────────────────────────────────────
  const [coords, setCoords] = useState(null); // { lat, lng, source: 'device' | 'manual' }
  const [geoStatus, setGeoStatus] = useState('idle'); // idle | loading | ready | denied | unavailable | unsupported
  const [showManual, setShowManual] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [manualError, setManualError] = useState('');
  const requestCounter = useRef(0);

  const requestDeviceLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('unsupported');
      return;
    }
    setGeoStatus('loading');
    setShowManual(false);
    const requestId = ++requestCounter.current;
    navigator.geolocation.getCurrentPosition(
      position => {
        if (requestId !== requestCounter.current) return; // a newer request superseded this one
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          source: 'device',
        });
        setGeoStatus('ready');
        // Clicking through a prompted grant counts as the opt-in for next time.
        setPermissionEnabled(GEOLOCATION, true);
      },
      error => {
        if (requestId !== requestCounter.current) return;
        const denied = error && error.code === 1;
        // A denied prompt forgets the opt-in so we do not keep nagging.
        if (denied) setPermissionEnabled(GEOLOCATION, false);
        setGeoStatus(denied ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  };

  // Never prompt on mount. A saved location (manual or from an earlier grant)
  // is used straight away; otherwise we only pull the device location when the
  // browser will be quiet about it (already granted) or the user opted in via
  // Settings — everyone else gets the explicit "Use my location" button.
  useEffect(() => {
    let cancelled = false;
    const saved = loadSavedCoords();
    if (saved) {
      setCoords(saved);
      setGeoStatus('ready');
      return undefined;
    }
    if (!('geolocation' in navigator)) {
      setGeoStatus('unsupported');
      return undefined;
    }
    (async () => {
      const state = await queryPermissionState(GEOLOCATION);
      if (cancelled) return;
      if (state === 'granted' || isPermissionEnabled(GEOLOCATION)) {
        requestDeviceLocation();
      } else if (state === 'denied') {
        setGeoStatus('denied');
      } else {
        setGeoStatus('idle'); // 'prompt' — stay quiet and wait for the button
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayKey = new Date().toDateString();
  const solar = useMemo(() => {
    if (!coords) return null;
    try {
      const date = new Date();
      const sunrise = getSunrise(coords.lat, coords.lng, date);
      const sunset = getSunset(coords.lat, coords.lng, date);
      if (
        !sunrise ||
        !sunset ||
        Number.isNaN(sunrise.getTime()) ||
        Number.isNaN(sunset.getTime())
      ) {
        return null; // polar day/night for this location today
      }
      const sunriseMin = sunrise.getHours() * 60 + sunrise.getMinutes();
      const sunsetMin = sunset.getHours() * 60 + sunset.getMinutes();
      const daylightMin = sunsetMin - sunriseMin;
      const validDaylight = daylightMin > 0 && daylightMin <= MINUTES_PER_DAY;
      return {
        sunriseMin,
        sunsetMin,
        daylightMin: validDaylight ? daylightMin : null,
        middayMin: validDaylight
          ? Math.round((sunriseMin + sunsetMin) / 2)
          : null,
      };
    } catch {
      return null;
    }
  }, [coords, todayKey]);

  const geoMessage =
    geoStatus === 'loading'
      ? 'Finding your location…'
      : geoStatus === 'denied'
        ? 'Location access was denied, so sunrise and sunset are unavailable. You can still enter coordinates manually.'
        : geoStatus === 'unavailable'
          ? 'Your location could not be determined.'
          : geoStatus === 'unsupported'
            ? 'This browser does not support geolocation.'
            : geoStatus === 'idle'
              ? 'Use your location for sunrise and sunset — or enter coordinates manually. Nothing is requested until you choose.'
              : coords && !solar
                ? 'No sunrise/sunset data is available for that location today.'
                : '';

  function openManualEditor() {
    setManualLat(coords ? String(coords.lat) : '');
    setManualLng(coords ? String(coords.lng) : '');
    setManualError('');
    setShowManual(true);
  }

  function applyManualCoords() {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (
      manualLat.trim() === '' ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90
    ) {
      setManualError('Latitude must be a number between −90 and 90.');
      return;
    }
    if (
      manualLng.trim() === '' ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180
    ) {
      setManualError('Longitude must be a number between −180 and 180.');
      return;
    }
    setCoords({ lat, lng, source: 'manual' });
    setGeoStatus('ready');
    setShowManual(false);
    setManualError('');
  }

  useEffect(() => {
    saveCoords(coords);
  }, [coords]);

  // ── Derived calculation (pure render-time derivation, never stored) ─
  const info = MODES[mode];
  const trimmedA = fieldA.trim();
  const trimmedB = fieldB.trim();
  const parsedA = parseTimeInput(fieldA);
  const parsedB = parseTimeInput(fieldB);

  let error = '';
  let showPrompt = false;
  let derived = null;
  let answerMinutes = null;

  if (trimmedA === '' && trimmedB === '') {
    showPrompt = true;
  } else if (trimmedA === '' || trimmedB === '') {
    const missingLabel = trimmedA === '' ? info.aLabel : info.bLabel;
    error = `Enter a ${missingLabel.toLowerCase()} to continue.`;
  } else if (parsedA === null || parsedB === null) {
    const bad = parsedA === null ? fieldA : fieldB;
    error = `“${bad}” isn’t a valid time. Try 24-hour (1400 or 14:00) or 12-hour (2:00 pm).`;
  } else {
    const solved = solveTimeMath(mode, parsedA, parsedB);
    if (solved.error === 'same') {
      error = `The ${info.aLabel.toLowerCase()} and ${info.bLabel.toLowerCase()} can’t be identical — a window needs some length.`;
    } else if (solved.error === 'range') {
      error = info.rangeError;
    } else {
      derived = solved;
      answerMinutes =
        mode === 'midpoint'
          ? derived.midpoint
          : mode === 'end'
            ? derived.end
            : derived.start;
    }
  }

  const urlKey = derived ? `${mode}|${fieldA.trim()}|${fieldB.trim()}` : '';

  useEffect(() => {
    try {
      const query = urlKey
        ? `?a=${encodeURIComponent(fieldA.trim())}&b=${encodeURIComponent(fieldB.trim())}&mode=${mode}`
        : '';
      const target = query
        ? `${window.location.pathname}${query}`
        : window.location.pathname;
      if (window.location.search !== query) {
        window.history.replaceState(null, '', target);
      }
    } catch {
      // history may be unavailable in embedded contexts — sharing simply won't update the URL
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  // ── Fill helpers ───────────────────────────────────────────────────
  function minutesOfNow() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function handleQuickChip(target, chipKey) {
    let minutes = null;
    if (chipKey === 'now') minutes = minutesOfNow();
    else if (chipKey === 'sunrise' && solar) minutes = solar.sunriseMin;
    else if (chipKey === 'sunset' && solar) minutes = solar.sunsetMin;
    if (minutes === null) return;
    if (target === 'a') setFieldA(minutesToCompact(minutes));
    else setFieldB(minutesToCompact(minutes));
  }

  function fillDaylightWindow() {
    if (!solar) return;
    setFieldA(minutesToCompact(solar.sunriseMin));
    setFieldB(minutesToCompact(solar.sunsetMin));
  }

  function handleSwap() {
    setFieldA(fieldB);
    setFieldB(fieldA);
  }

  function handleClear() {
    setFieldA('');
    setFieldB('');
  }

  // ── Copy / share ───────────────────────────────────────────────────
  const [copied, setCopied] = useState(null); // 'answer' | 'link'
  const copyTimer = useRef(null);
  const resultRef = useRef(null);
  const [calcNonce, setCalcNonce] = useState(0);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  function handleCalculate() {
    if (!derived) return;
    setCalcNonce(nonce => nonce + 1);
    requestAnimationFrame(() => {
      resultRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }

  function flashCopied(kind) {
    setCopied(kind);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1800);
  }

  function buildShareUrl() {
    try {
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({
        a: minutesToCompact(parsedA),
        b: minutesToCompact(parsedB),
        mode,
      }).toString();
      return url.toString();
    } catch {
      return window.location.href;
    }
  }

  function buildAnswerText() {
    const parts = [
      `${info.answerLabel}: ${minutesToLabel(answerMinutes)}`,
      `Window ${minutesToHhmm(derived.start)} to ${minutesToHhmm(derived.end)}`,
      formatDuration(derived.duration),
    ];
    if (derived.crossesMidnight) parts.push('crosses midnight');
    return parts.join(' · ');
  }

  async function handleCopyAnswer() {
    if (!derived) return;
    const ok = await copyText(buildAnswerText());
    if (ok) flashCopied('answer');
  }

  async function handleCopyLink() {
    if (!derived) return;
    const ok = await copyText(buildShareUrl());
    if (ok) flashCopied('link');
  }

  // ── Render helpers ─────────────────────────────────────────────────
  function renderFieldRow(target, labelText) {
    const value = target === 'a' ? fieldA : fieldB;
    const setter = target === 'a' ? setFieldA : setFieldB;
    return (
      <div className='halfway-field'>
        <label className='halfway-label' htmlFor={`halfway-field-${target}`}>
          {labelText}
        </label>
        <div className='halfway-field-row'>
          <input
            id={`halfway-field-${target}`}
            className='halfway-input'
            placeholder='1400, 14:00, or 2:00 pm'
            value={value}
            onChange={event => setter(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') handleCalculate();
            }}
            inputMode='text'
            autoComplete='off'
            spellCheck='false'
            aria-describedby='halfway-format-hint'
          />
          <div
            className='halfway-chip-row'
            role='group'
            aria-label={`${labelText} shortcuts`}
          >
            {QUICK_CHIPS.map(chip => {
              const needsSolar = chip.key !== 'now';
              return (
                <button
                  key={chip.key}
                  type='button'
                  className='halfway-chip'
                  disabled={needsSolar && !solar}
                  onClick={() => handleQuickChip(target, chip.key)}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const tzLabel = getTimeZoneLabel();

  const geoCopy =
    coords && coords.source === 'manual'
      ? `Manual location · ${coords.lat.toFixed(2)}°, ${coords.lng.toFixed(2)}°`
      : coords && coords.source === 'device'
        ? `Your current location · ${coords.lat.toFixed(2)}°, ${coords.lng.toFixed(2)}°`
        : '';

  return (
    <>
      <SEO
        title='Halfway — Time Midpoint Calculator'
        description='Split any stretch of time in two: find the exact halfway point between two times in 24-hour or 12-hour format, across midnight, with sunrise and sunset quick-fills.'
        path='/halfway'
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: 'Halfway — Time Midpoint Calculator',
          url: 'https://sthopwood.com/halfway',
          applicationCategory: 'UtilityApplication',
          operatingSystem: 'Any',
          browserRequirements: 'Requires JavaScript',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          description:
            'Find the exact halfway point in time between two moments, including windows that cross midnight.',
        }}
      />
      <Header />
      <div className='halfway'>
        <div className='halfway-floating' aria-hidden='true'>
          <div className='halfway-circle halfway-circle-1' />
          <div className='halfway-circle halfway-circle-2' />
          <div className='halfway-circle halfway-circle-3' />
        </div>

        <section className='halfway-section'>
          <div className='halfway-title-wrap'>
            <h1 className='halfway-title'>Halfway</h1>
            <div className='halfway-underline' aria-hidden='true' />
            <p className='halfway-subtitle'>
              Split any stretch of time exactly in two. Plan a meeting, shift,
              trip, or shared daylight window — whether or not it crosses
              midnight. Times are in your local time zone: {tzLabel}.
            </p>
          </div>

          {/* ── Calculator ─────────────────────────────────────────────── */}
          <div className='halfway-card'>
            <h2>What would you like to find?</h2>
            <div
              className='halfway-modes'
              role='radiogroup'
              aria-label='Calculation mode'
            >
              {MODE_KEYS.map(key => {
                const entry = MODES[key];
                const selected = mode === key;
                return (
                  <button
                    key={key}
                    type='button'
                    className={`halfway-mode${selected ? ' selected' : ''}`}
                    role='radio'
                    aria-checked={selected}
                    onClick={() => setMode(key)}
                  >
                    <span className='halfway-mode-name'>{entry.tabName}</span>
                    <span className='halfway-mode-desc'>{entry.tabDesc}</span>
                  </button>
                );
              })}
            </div>
            <p className='halfway-mode-blurb'>{info.blurb}</p>

            {renderFieldRow('a', info.aLabel)}
            {mode === 'midpoint' && (
              <div className='halfway-swap-row'>
                <button
                  type='button'
                  className='halfway-chip halfway-chip--swap'
                  onClick={handleSwap}
                >
                  ⇄ Swap times
                </button>
              </div>
            )}
            {renderFieldRow('b', info.bLabel)}

            <p className='halfway-format-hint' id='halfway-format-hint'>
              Accepted formats: 1400 · 14:00 · 2:00 pm. Windows that end before
              they start are treated as crossing midnight.
            </p>

            {mode === 'midpoint' && (
              <div className='halfway-preset-row'>
                <button
                  type='button'
                  className='halfway-chip'
                  disabled={!solar}
                  onClick={fillDaylightWindow}
                >
                  🌅 Use today’s daylight window (sunrise → sunset)
                </button>
              </div>
            )}

            {error && (
              <div className='halfway-error' role='alert'>
                {error}
              </div>
            )}
            {showPrompt && !error && (
              <p className='halfway-prompt'>
                Enter {info.aLabel.toLowerCase()} and{' '}
                {info.bLabel.toLowerCase()} to see the{' '}
                {info.answerLabel.toLowerCase()}.
              </p>
            )}

            <div className='halfway-btn-row'>
              <button
                type='button'
                className='halfway-btn'
                onClick={handleCalculate}
              >
                Calculate
              </button>
              <button
                type='button'
                className='halfway-btn secondary'
                onClick={handleClear}
              >
                Clear
              </button>
            </div>
          </div>

          {/* ── Result ─────────────────────────────────────────────────── */}
          {derived && (
            <div
              key={calcNonce}
              ref={resultRef}
              className='halfway-card halfway-result-card'
              tabIndex={-1}
            >
              <h2>{info.answerLabel}</h2>
              <div className='halfway-result' aria-live='polite'>
                <div className='halfway-result-main'>
                  <span className='halfway-result-time'>
                    {minutesToHhmm(answerMinutes)}
                  </span>
                  <span className='halfway-result-time-alt'>
                    {minutesTo12h(answerMinutes)}
                  </span>
                </div>

                <div className='halfway-result-meta'>
                  <span className='halfway-meta-chip'>
                    {minutesToHhmm(derived.start)} →{' '}
                    {minutesToHhmm(derived.end)}
                  </span>
                  <span className='halfway-meta-chip'>
                    {formatDuration(derived.duration)} window
                  </span>
                  {derived.crossesMidnight && (
                    <span className='halfway-meta-chip halfway-meta-chip--accent'>
                      crosses midnight
                    </span>
                  )}
                </div>

                <div className='halfway-timeline' aria-hidden='true'>
                  <div className='halfway-timeline-track'>
                    <span className='halfway-timeline-fill' />
                    <span className='halfway-timeline-pip' />
                  </div>
                  <div className='halfway-timeline-labels'>
                    <span className='halfway-timeline-label'>
                      {minutesToHhmm(derived.start)} <small>start</small>
                    </span>
                    <span className='halfway-timeline-label halfway-timeline-label--mid'>
                      {minutesToHhmm(derived.midpoint)} <small>halfway</small>
                    </span>
                    <span className='halfway-timeline-label halfway-timeline-label--end'>
                      {minutesToHhmm(derived.end)} <small>end</small>
                    </span>
                  </div>
                </div>

                <div className='halfway-result-actions'>
                  <button
                    type='button'
                    className='halfway-btn'
                    onClick={handleCopyAnswer}
                  >
                    {copied === 'answer' ? '✓ Copied' : 'Copy answer'}
                  </button>
                  <button
                    type='button'
                    className='halfway-btn secondary'
                    onClick={handleCopyLink}
                  >
                    {copied === 'link' ? '✓ Link copied' : 'Copy share link'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Solar times ────────────────────────────────────────────── */}
          <div className='halfway-card halfway-solar-card'>
            <div className='halfway-solar-heading'>
              <h2>Sunrise &amp; sunset</h2>
              <span className='halfway-now-wrap'>
                <span className='halfway-now-label'>Now</span>
                <NowClock />
              </span>
            </div>

            {coords && solar ? (
              <>
                <div className='halfway-sun-grid'>
                  <div className='halfway-sun-item'>
                    <span className='halfway-sun-icon' aria-hidden='true'>
                      🌅
                    </span>
                    <span className='halfway-sun-label'>Sunrise</span>
                    <span className='halfway-sun-value'>
                      {minutesToHhmm(solar.sunriseMin)}
                    </span>
                  </div>
                  <div className='halfway-sun-item'>
                    <span className='halfway-sun-icon' aria-hidden='true'>
                      🌇
                    </span>
                    <span className='halfway-sun-label'>Sunset</span>
                    <span className='halfway-sun-value'>
                      {minutesToHhmm(solar.sunsetMin)}
                    </span>
                  </div>
                  <div className='halfway-sun-item'>
                    <span className='halfway-sun-icon' aria-hidden='true'>
                      ☀️
                    </span>
                    <span className='halfway-sun-label'>Daylight</span>
                    <span className='halfway-sun-value'>
                      {solar.daylightMin
                        ? formatDuration(solar.daylightMin)
                        : '—'}
                    </span>
                  </div>
                  <div className='halfway-sun-item'>
                    <span className='halfway-sun-icon' aria-hidden='true'>
                      🕛
                    </span>
                    <span className='halfway-sun-label'>Midday</span>
                    <span className='halfway-sun-value'>
                      {solar.middayMin !== null
                        ? minutesToHhmm(solar.middayMin)
                        : '—'}
                    </span>
                  </div>
                </div>
                <p className='halfway-sun-note'>
                  {geoCopy} · approx. times for today. Midday is the exact
                  middle of daylight.
                </p>
                <div className='halfway-solar-actions'>
                  <button
                    type='button'
                    className='halfway-chip'
                    onClick={requestDeviceLocation}
                  >
                    📍 Use my location
                  </button>
                  <button
                    type='button'
                    className='halfway-chip'
                    onClick={openManualEditor}
                  >
                    ✏️ Edit coordinates
                  </button>
                </div>
              </>
            ) : (
              <>
                {geoMessage && <p className='halfway-sun-hint'>{geoMessage}</p>}
                <div className='halfway-solar-actions'>
                  <button
                    type='button'
                    className='halfway-chip'
                    onClick={requestDeviceLocation}
                  >
                    📍 Use my location
                  </button>
                  <button
                    type='button'
                    className='halfway-chip'
                    onClick={openManualEditor}
                  >
                    ⌨️ Enter coordinates
                  </button>
                </div>
              </>
            )}

            {showManual && (
              <div className='halfway-manual'>
                <p className='halfway-manual-note'>
                  Sunrise and sunset are calculated for any point on Earth, so
                  you can look up the daylight window for the other side of your
                  trip too.
                </p>
                <div className='halfway-manual-fields'>
                  <div className='halfway-field'>
                    <label className='halfway-label' htmlFor='halfway-lat'>
                      Latitude
                    </label>
                    <input
                      id='halfway-lat'
                      className='halfway-input halfway-input-sm'
                      placeholder='e.g. 40.7128'
                      inputMode='decimal'
                      value={manualLat}
                      onChange={event => setManualLat(event.target.value)}
                    />
                  </div>
                  <div className='halfway-field'>
                    <label className='halfway-label' htmlFor='halfway-lng'>
                      Longitude
                    </label>
                    <input
                      id='halfway-lng'
                      className='halfway-input halfway-input-sm'
                      placeholder='e.g. -74.0060'
                      inputMode='decimal'
                      value={manualLng}
                      onChange={event => setManualLng(event.target.value)}
                    />
                  </div>
                </div>
                {manualError && (
                  <div className='halfway-error' role='alert'>
                    {manualError}
                  </div>
                )}
                <button
                  type='button'
                  className='halfway-btn'
                  onClick={applyManualCoords}
                >
                  Apply coordinates
                </button>
              </div>
            )}
          </div>

          {/* ── How it works ───────────────────────────────────────────── */}
          <div className='halfway-card halfway-info-card'>
            <h2>How it works</h2>
            <ul className='halfway-info-list'>
              <li>
                The halfway point splits the window between your two times into
                two equal halves — the same amount of time before it as after
                it.
              </li>
              <li>
                If an end time is earlier than the start time, the window simply
                crosses midnight and keeps going into the next day.
              </li>
              <li>
                Times are interpreted in your local time zone and rounded to the
                nearest minute.
              </li>
              <li>
                Reverse modes work the same way backwards: give a halfway time
                and one end of the window, and Halfway finds the other end.
              </li>
            </ul>
          </div>

          <a
            className='halfway-source-link'
            href='https://github.com/tnnrhpwd/portfolio-app/tree/master/frontend/src/pages/Projects/Halfway'
            rel='noopener noreferrer'
            target='_blank'
          >
            View Source Code
          </a>
        </section>
      </div>
      <Footer />
    </>
  );
}

export default Halfway;
