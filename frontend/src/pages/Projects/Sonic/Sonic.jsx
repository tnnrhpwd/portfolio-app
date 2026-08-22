import React, { useMemo } from 'react';
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import SEO from '../../../components/SEO/SEO.jsx';
import useFrequencyAnalyzer from './FrequencyAnalyzer';
import './Sonic.css';

const NOTE_STRINGS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const REFERENCE_OCTAVES = [3, 4, 5];

function buildReferenceNotes() {
    const notes = [];
    REFERENCE_OCTAVES.forEach(octave => {
        NOTE_STRINGS.forEach((name, i) => {
            const midiNote = (octave + 1) * 12 + i;
            const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);
            notes.push({ name, octave, frequency });
        });
    });
    return notes;
}

function Sonic() {
    const { listening, noteData, spectrum, error, start, stop } = useFrequencyAnalyzer();
    const referenceNotes = useMemo(buildReferenceNotes, []);

    const centsClamped = noteData ? Math.max(-50, Math.min(50, noteData.cents)) : 0;
    const needlePosition = 50 + (centsClamped / 50) * 50; // 0%–100%
    const inTune = noteData && Math.abs(noteData.cents) <= 5;

    function handleMicToggle() {
        if (listening) { stop(); } else { start(); }
    }

    return (
        <>
            <SEO
                title="Sonic"
                description="Analyze audio frequencies and musical notes in real time with Sonic, a free browser-based pitch detector and tuner."
                path="/sonic"
            />
            <Header />
            <div className="sonic">
                <div className="sonic-floating" aria-hidden="true">
                    <div className="sonic-circle sonic-circle-1" />
                    <div className="sonic-circle sonic-circle-2" />
                    <div className="sonic-circle sonic-circle-3" />
                </div>

                <section className="sonic-section">
                    <div className="sonic-title-wrap">
                        <h1 className="sonic-title">Sonic</h1>
                        <div className="sonic-underline" aria-hidden="true" />
                        <p className="sonic-subtitle">
                            A real-time pitch detector and tuner. Sing or play a note into your microphone and Sonic will identify the closest musical note, how in-tune it is, and the live frequency spectrum.
                        </p>
                    </div>

                    <div className="sonic-card">
                        <h2>Live Pitch Detection</h2>
                        <div className="sonic-mic-row">
                            <button
                                type="button"
                                className={`sonic-btn${listening ? ' stop' : ''}`}
                                onClick={handleMicToggle}
                            >
                                {listening ? '⏹ Stop Microphone' : '🎙 Start Microphone'}
                            </button>
                            <span className="sonic-mic-status">
                                <span className={`sonic-mic-dot${listening ? ' live' : ''}`} />
                                {listening ? 'Listening…' : 'Microphone off'}
                            </span>
                        </div>

                        {error && <div className="sonic-error">{error}</div>}

                        {noteData ? (
                            <>
                                <div className="sonic-note-display">
                                    <span className="sonic-note-name">
                                        {noteData.noteName}<span className="sonic-note-octave">{noteData.octave}</span>
                                    </span>
                                    <div className="sonic-note-freq">{noteData.frequency.toFixed(1)} Hz</div>
                                </div>

                                <div className="sonic-tuner">
                                    <div className="sonic-tuner-track">
                                        <div className="sonic-tuner-center" />
                                        <div className="sonic-tuner-needle" style={{ left: `${needlePosition}%` }} />
                                    </div>
                                    <div className="sonic-tuner-labels">
                                        <span>-50¢ flat</span>
                                        <span>in tune</span>
                                        <span>+50¢ sharp</span>
                                    </div>
                                    <div className={`sonic-tuner-cents${inTune ? ' in-tune' : ''}`}>
                                        {noteData.cents > 0 ? '+' : ''}{noteData.cents} cents {inTune ? '— in tune!' : ''}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="sonic-note-placeholder">
                                {listening ? 'Listening for a note… try humming or playing a note.' : 'Start the microphone to detect a note.'}
                            </div>
                        )}
                    </div>

                    <div className="sonic-card">
                        <h2>Frequency Spectrum</h2>
                        <div className="sonic-spectrum" aria-hidden="true">
                            {(spectrum.length > 0 ? spectrum : new Array(48).fill(0)).map((value, i) => (
                                <div key={i} className="sonic-spectrum-bar" style={{ height: `${Math.max(2, (value / 255) * 100)}%` }} />
                            ))}
                        </div>
                        <p className="sonic-hint">
                            Each bar represents the loudness of a frequency band from low (left) to high (right), updated live from your microphone.
                        </p>
                    </div>

                    <div className="sonic-card">
                        <h2>Reference Notes</h2>
                        <p className="sonic-hint">Standard equal-tempered tuning, A4 = 440 Hz.</p>
                        <div className="sonic-note-ref-grid">
                            {referenceNotes.map(ref => (
                                <div
                                    key={`${ref.name}${ref.octave}`}
                                    className={`sonic-note-ref${noteData && noteData.noteName === ref.name && noteData.octave === ref.octave ? ' active' : ''}`}
                                >
                                    <span className="ref-name">{ref.name}{ref.octave}</span>
                                    <span className="ref-freq">{ref.frequency.toFixed(1)} Hz</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="sonic-info-grid">
                        <div className="sonic-card">
                            <h2>How It Works</h2>
                            <p className="sonic-hint">
                                Sonic uses your browser&apos;s Web Audio API to run a Fast Fourier Transform (FFT) on your microphone input, finds the dominant frequency, and matches it to the nearest musical note using equal temperament tuning.
                            </p>
                        </div>
                        <div className="sonic-card">
                            <h2>Privacy</h2>
                            <p className="sonic-hint">
                                All audio processing happens locally in your browser. Nothing is recorded, stored, or sent anywhere — closing or stopping the microphone immediately releases access.
                            </p>
                        </div>
                    </div>

                    <p className="sonic-disclaimer">
                        For best results, use headphones or a quiet room to reduce background noise, and allow microphone access when prompted.
                    </p>

                    <div className="sonic-mic-row">
                        <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/frontend/src/pages/Projects/Sonic" rel="noopener noreferrer" target="_blank">
                            <button className="sonic-btn secondary" type="button">View Source Code</button>
                        </a>
                    </div>
                </section>
            </div>
            <Footer />
        </>
    );
}

export default Sonic;
