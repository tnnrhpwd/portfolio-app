import React, { useEffect, useState } from 'react';
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import SEO from '../../../components/SEO/SEO.jsx';
import { getSunrise, getSunset } from 'sunrise-sunset-js';
import './Halfway.css';

const MINUTES_PER_DAY = 24 * 60;

// Accepts "1400", "14:00", "900", "9:00" and returns minutes since midnight,
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

function formatClock(date) {
    if (!date) return '—';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toHHMM(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}${m}`;
}

function describeHalfway(minutes) {
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

function Halfway() {
    const [startInput, setStartInput] = useState('');
    const [endInput, setEndInput] = useState('');
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [now, setNow] = useState(() => new Date());
    const [sunrise, setSunrise] = useState(null);
    const [sunset, setSunset] = useState(null);
    const [geoStatus, setGeoStatus] = useState('loading'); // loading | success | denied | unavailable

    // Keep the "current time" readout fresh without re-rendering constantly.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30 * 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (!navigator.geolocation) {
            setGeoStatus('unavailable');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                try {
                    setSunrise(getSunrise(position.coords.latitude, position.coords.longitude));
                    setSunset(getSunset(position.coords.latitude, position.coords.longitude));
                    setGeoStatus('success');
                } catch {
                    setGeoStatus('unavailable');
                }
            },
            () => setGeoStatus('denied')
        );
    }, []);

    function handleSubmit() {
        const start = parseTimeInput(startInput);
        const end = parseTimeInput(endInput);
        if (start === null) {
            setError('Please enter a valid start time (e.g. 1400 or 14:00).');
            setResult(null);
            return;
        }
        if (end === null) {
            setError('Please enter a valid end time (e.g. 1950 or 19:50).');
            setResult(null);
            return;
        }
        if (start === end) {
            setError('Start and end times can\u2019t be the same.');
            setResult(null);
            return;
        }

        let duration = end - start;
        if (duration < 0) duration += MINUTES_PER_DAY; // trip crosses midnight
        const halfwayMinutes = (start + duration / 2) % MINUTES_PER_DAY;

        setError('');
        setResult(describeHalfway(halfwayMinutes));
    }

    function handleKeyPress(event) {
        if (event.key === 'Enter') handleSubmit();
    }

    function fillStartFromClock(date) {
        if (!date) return;
        setStartInput(toHHMM(date));
        setError('');
    }

    function fillEndFromClock(date) {
        if (!date) return;
        setEndInput(toHHMM(date));
        setError('');
    }

    return (
        <>
            <SEO
                title="Halfway"
                description="Find the halfway meeting point in time between sunrise and sunset for two locations."
                path="/halfway"
            />
            <Header />
            <div className="halfway">
                <div className="halfway-floating" aria-hidden="true">
                    <div className="halfway-circle halfway-circle-1" />
                    <div className="halfway-circle halfway-circle-2" />
                    <div className="halfway-circle halfway-circle-3" />
                </div>

                <section className="halfway-section">
                    <div className="halfway-title-wrap">
                        <h1 className="halfway-title">Halfway</h1>
                        <div className="halfway-underline" aria-hidden="true" />
                        <p className="halfway-subtitle">
                            Find the exact halfway point in time between two moments — perfect for planning meeting times, shifts, or splitting a trip in two. Enter times in 24-hour format.
                        </p>
                    </div>

                    <div className="halfway-card">
                        <h2>Time Calculator</h2>

                        <div className="halfway-field">
                            <label className="halfway-label" htmlFor="halfway-start">Start Time</label>
                            <div className="halfway-field-row">
                                <input
                                    id="halfway-start"
                                    className="halfway-input"
                                    placeholder="1400"
                                    value={startInput}
                                    onChange={(event) => setStartInput(event.target.value)}
                                    onKeyDown={handleKeyPress}
                                    inputMode="numeric"
                                />
                                <button type="button" className="halfway-btn secondary" onClick={() => fillStartFromClock(now)}>Now</button>
                                <button type="button" className="halfway-btn secondary" onClick={() => fillStartFromClock(sunrise)}>Sunrise</button>
                            </div>
                        </div>

                        <div className="halfway-field">
                            <label className="halfway-label" htmlFor="halfway-end">End Time</label>
                            <div className="halfway-field-row">
                                <input
                                    id="halfway-end"
                                    className="halfway-input"
                                    placeholder="1950"
                                    value={endInput}
                                    onChange={(event) => setEndInput(event.target.value)}
                                    onKeyDown={handleKeyPress}
                                    inputMode="numeric"
                                />
                                <button type="button" className="halfway-btn secondary" onClick={() => fillEndFromClock(now)}>Now</button>
                                <button type="button" className="halfway-btn secondary" onClick={() => fillEndFromClock(sunset)}>Sunset</button>
                            </div>
                        </div>

                        {error && <div className="halfway-error" role="alert">{error}</div>}

                        <div className="halfway-btn-row">
                            <button type="button" className="halfway-btn" onClick={handleSubmit}>Calculate Halfway</button>
                        </div>

                        {result && (
                            <div className="halfway-result" aria-live="polite">
                                <span className="halfway-result-label">Halfway point</span>
                                <span className="halfway-result-time">{result.hhmm}</span>
                                <span className="halfway-result-time-alt">{result.h12}</span>
                            </div>
                        )}
                    </div>

                    <div className="halfway-card halfway-sun-card">
                        <h2>Your Solar Times</h2>
                        <p className="halfway-sun-hint">
                            {geoStatus === 'success'
                                ? 'Based on your current location.'
                                : geoStatus === 'denied'
                                    ? 'Location access was denied — solar times are unavailable.'
                                    : geoStatus === 'unavailable'
                                        ? 'Solar times are unavailable on this device.'
                                        : 'Requesting your location…'}
                        </p>
                        <div className="halfway-sun-grid">
                            <div className="halfway-sun-item">
                                <span className="halfway-sun-icon" aria-hidden="true">🌅</span>
                                <span className="halfway-sun-label">Sunrise</span>
                                <span className="halfway-sun-value">{formatClock(sunrise)}</span>
                            </div>
                            <div className="halfway-sun-item">
                                <span className="halfway-sun-icon" aria-hidden="true">🌇</span>
                                <span className="halfway-sun-label">Sunset</span>
                                <span className="halfway-sun-value">{formatClock(sunset)}</span>
                            </div>
                            <div className="halfway-sun-item">
                                <span className="halfway-sun-icon" aria-hidden="true">🕒</span>
                                <span className="halfway-sun-label">Now</span>
                                <span className="halfway-sun-value">{formatClock(now)}</span>
                            </div>
                        </div>
                    </div>

                    <a
                        className="halfway-source-link"
                        href="https://github.com/tnnrhpwd/portfolio-app/tree/master/frontend/src/pages/Projects/Halfway"
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

export default Halfway;