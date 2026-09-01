import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO';
import './TypeTest.css';

// Original, short practice sentences (safe for all audiences).
const TEXTS = [
  'The quick brown fox jumps over the lazy dog near the river bank.',
  'Typing quickly and accurately is a skill that improves with daily practice.',
  'A calm mind and steady hands make for fast and accurate typing.',
  'Computers help us write, learn, and connect with people around the world.',
  'Practice makes progress, so keep typing every single day to improve.',
  'Reading a book while sipping warm tea is a relaxing way to spend an evening.',
  'Good habits are built slowly over time with patience and consistency.',
];

function pickText() {
  return TEXTS[Math.floor(Math.random() * TEXTS.length)];
}

// Classic dynamic-programming edit distance (Levenshtein).
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const curr = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

// Correct a single typed word to the reference word when it is "close enough",
// mimicking how real autocorrect fixes minor mistakes (but not gibberish).
function autocorrectWord(typedWord, refWord) {
  if (!refWord || typedWord === refWord) return typedWord;
  const maxDist = Math.max(1, Math.min(3, Math.floor(refWord.length / 2)));
  return levenshtein(typedWord, refWord) <= maxDist ? refWord : typedWord;
}

// Apply autocorrect to the word the user just completed (typed a space).
function applyAutocorrect(typed, reference) {
  if (!typed.endsWith(' ')) return typed;
  const refWords = reference.split(' ');
  const typedWords = typed.slice(0, -1).split(' ');
  const idx = typedWords.length - 1;
  if (idx < 0 || idx >= refWords.length) return typed;
  typedWords[idx] = autocorrectWord(typedWords[idx], refWords[idx]);
  return `${typedWords.join(' ')} `;
}

// Correct the final word (which has no trailing space) when the test ends.
function correctFinalWord(typed, reference) {
  const refWords = reference.split(' ');
  const typedWords = typed.split(' ');
  const idx = typedWords.length - 1;
  if (idx < 0 || idx >= refWords.length) return typed;
  typedWords[idx] = autocorrectWord(typedWords[idx], refWords[idx]);
  return typedWords.join(' ');
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function TypeTest() {
  const [text, setText] = useState(pickText);
  const [typed, setTyped] = useState('');
  const [autocorrect, setAutocorrect] = useState(false);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [stats, setStats] = useState(null);

  const inputRef = useRef(null);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(null);

  const focusInput = useCallback(() => {
    if (inputRef.current && !finished) {
      inputRef.current.focus({ preventScroll: true });
    }
  }, [finished]);

  // Focus on mount.
  useEffect(() => {
    focusInput();
  }, [focusInput]);

  // Keep the interval cleaned up on unmount.
  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const computeStats = useCallback((finalTyped, finalText, seconds) => {
    const totalTyped = finalTyped.length;
    const len = Math.min(totalTyped, finalText.length);
    let correct = 0;
    for (let i = 0; i < len; i += 1) {
      if (finalTyped[i] === finalText[i]) correct += 1;
    }
    const minutes = seconds / 60;
    // Net WPM: (correct characters / 5) per minute.
    const wpm = minutes > 0 ? Math.round(correct / 5 / minutes) : 0;
    const accuracy = totalTyped > 0 ? Math.round((correct / totalTyped) * 100) : 0;
    return { wpm, accuracy };
  }, []);

  const finishTest = useCallback(
    (finalTyped, seconds) => {
      stopTimer();
      let effective = finalTyped;
      if (autocorrect) effective = correctFinalWord(effective, text);
      setTyped(effective);
      setStats(computeStats(effective, text, seconds));
      setFinished(true);
      if (inputRef.current) inputRef.current.blur();
    },
    [stopTimer, autocorrect, text, computeStats],
  );

  const handleInput = useCallback(
    (e) => {
      if (finished) return;
      let value = e.target.value;

      // Simulated autocorrect: fix the word just completed on each space.
      if (autocorrect) {
        const corrected = applyAutocorrect(value, text);
        if (corrected !== value) {
          e.target.value = corrected;
          value = corrected;
        }
      }

      // Auto-start the timer on the first keystroke.
      if (startTimeRef.current === null && value.length > 0) {
        startTimeRef.current = Date.now();
        setStarted(true);
        intervalRef.current = setInterval(() => {
          setElapsed((Date.now() - startTimeRef.current) / 1000);
        }, 100);
      }

      setTyped(value);

      // Auto-end once the reference text has been fully typed.
      if (value.length >= text.length) {
        const seconds = startTimeRef.current
          ? (Date.now() - startTimeRef.current) / 1000
          : 0;
        finishTest(value, Math.max(seconds, 0.1));
      }
    },
    [finished, autocorrect, text, finishTest],
  );

  const resetTest = useCallback(() => {
    stopTimer();
    startTimeRef.current = null;
    setText(pickText());
    setTyped('');
    setStarted(false);
    setElapsed(0);
    setFinished(false);
    setStats(null);
    if (inputRef.current) inputRef.current.value = '';
    setTimeout(() => focusInput(), 0);
  }, [stopTimer, focusInput]);

  const toggleAutocorrect = useCallback((e) => {
    setAutocorrect(e.target.checked);
  }, []);

  // Live, in-test stats.
  const live = useMemo(() => {
    if (!typed || elapsed <= 0) {
      return { wpm: 0, accuracy: 100, progress: 0 };
    }
    const len = Math.min(typed.length, text.length);
    let correct = 0;
    for (let i = 0; i < len; i += 1) {
      if (typed[i] === text[i]) correct += 1;
    }
    const minutes = elapsed / 60;
    const wpm = minutes > 0 ? Math.round(correct / 5 / minutes) : 0;
    const accuracy = typed.length > 0 ? Math.round((correct / typed.length) * 100) : 100;
    const progress = Math.min(100, Math.round((typed.length / text.length) * 100));
    return { wpm, accuracy, progress };
  }, [typed, elapsed, text]);

  const chars = useMemo(() => text.split(''), [text]);

  return (
    <div className="type-space">
      <SEO
        title="Typing Test"
        description="Test your typing speed and accuracy, with an optional autocorrect mode to compare normal and autocorrect typing speed."
        path="/type"
      />
      <Header />
      <main className="type-main">
        <h1 className="type-title">Typing Test</h1>
        <p className="type-subtitle">
          Start typing to begin. Green is correct, red is wrong (capitalization counts).
        </p>

        <div className="type-controls">
          <span className="type-mode-label" id="type-autocorrect-label">
            Autocorrect mode
          </span>
          <label className="type-switch">
            <input
              type="checkbox"
              checked={autocorrect}
              onChange={toggleAutocorrect}
              disabled={started && !finished}
              aria-labelledby="type-autocorrect-label"
            />
            <span className="type-slider" aria-hidden="true" />
          </label>
          <span className="type-mode-hint">
            {autocorrect ? 'On — words are auto-fixed as you finish them' : 'Off — normal typing'}
          </span>
        </div>

        <div className="type-stats" aria-live="off">
          <div className="type-stat">
            <span className="type-stat-value">{formatTime(elapsed)}</span>
            <span className="type-stat-label">Time</span>
          </div>
          <div className="type-stat">
            <span className="type-stat-value">{finished ? stats.wpm : live.wpm}</span>
            <span className="type-stat-label">WPM</span>
          </div>
          <div className="type-stat">
            <span className="type-stat-value">{finished ? `${stats.accuracy}%` : `${live.accuracy}%`}</span>
            <span className="type-stat-label">Accuracy</span>
          </div>
        </div>

        <div className="type-progress" aria-hidden="true">
          <div
            className="type-progress-fill"
            style={{ width: `${finished ? 100 : live.progress}%` }}
          />
        </div>

        <div className="type-card" onClick={focusInput}>
          <div className="type-text" aria-hidden="true">
            {chars.map((ch, i) => {
              let cls = 'type-char';
              if (i < typed.length) {
                cls += typed[i] === ch ? ' correct' : ' incorrect';
              } else if (i === typed.length) {
                cls += ' current';
              }
              return (
                <span key={i} className={cls}>
                  {ch}
                </span>
              );
            })}
          </div>
          <input
            ref={inputRef}
            className="type-input"
            onInput={handleInput}
            onPaste={(e) => e.preventDefault()}
            disabled={finished}
            autoFocus
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck="false"
            aria-label="Typing test input. Type the text shown above."
          />
        </div>

        {finished && (
          <div className="type-results" role="status" aria-live="polite">
            <h2 className="type-results-title">Results</h2>
            <div className="type-results-grid">
              <div className="type-result">
                <span className="type-result-value">{stats.wpm}</span>
                <span className="type-result-label">WPM</span>
              </div>
              <div className="type-result">
                <span className="type-result-value">{stats.accuracy}%</span>
                <span className="type-result-label">Accuracy</span>
              </div>
              <div className="type-result">
                <span className="type-result-value">{formatTime(elapsed)}</span>
                <span className="type-result-label">Time</span>
              </div>
            </div>
            <button className="type-again" onClick={resetTest} autoFocus>
              Try Again
            </button>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

export default TypeTest;
