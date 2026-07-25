import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import url from './Dictionary.txt';

import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import './WordleSolver.css';

// Tile colour states
const ABSENT = 0;   // grey  - letter not in the word
const PRESENT = 1;  // yellow - letter in the word, wrong spot
const CORRECT = 2;  // green - letter in the word, right spot

const MAX_ROWS = 6;
const MIN_LEN = 3;
const MAX_LEN = 8;
const DEFAULT_LEN = 5;
const RESULT_LIMIT = 400; // cap how many chips we render for performance

const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'DEL'],
];

// Loads and normalises the dictionary text file into an array of upper-case words.
function parseDictionary(text) {
  let words = text.toUpperCase().split('\r\n');
  if (words[0] !== 'AA') {
    words = words[0].split('\n');
  }
  return words.map((w) => w.trim()).filter(Boolean);
}

/**
 * Returns true when `candidate` is consistent with a single scored guess.
 * Handles duplicate letters using the standard Wordle counting rules.
 */
function candidatePassesRow(candidate, letters, states) {
  const len = candidate.length;

  // Position checks for greens/yellows.
  for (let i = 0; i < len; i++) {
    const g = letters[i];
    if (states[i] === CORRECT && candidate[i] !== g) return false;
    if (states[i] === PRESENT && candidate[i] === g) return false;
  }

  // Per-letter count constraints.
  const minCount = {}; // greens + yellows for a letter
  const capped = {};   // letter had an absent marking -> count is exact
  for (let i = 0; i < len; i++) {
    const g = letters[i];
    if (states[i] === CORRECT || states[i] === PRESENT) {
      minCount[g] = (minCount[g] || 0) + 1;
    } else {
      capped[g] = true;
    }
  }

  const letterList = Object.keys(minCount).concat(Object.keys(capped));
  for (const letter of letterList) {
    let count = 0;
    for (let i = 0; i < len; i++) if (candidate[i] === letter) count++;

    const required = minCount[letter] || 0;
    if (count < required) return false;
    if (capped[letter] && count !== required) return false;
  }

  return true;
}

function WordleSolver() {
  const navigate = useNavigate();

  const [dictionary, setDictionary] = useState([]);
  const [wordLength, setWordLength] = useState(DEFAULT_LEN);
  const [rows, setRows] = useState([]);           // committed guesses: {letters, states}
  const [current, setCurrent] = useState({ letters: [], states: [] }); // active row
  const [results, setResults] = useState(null);   // null = not solved yet
  const [message, setMessage] = useState('');

  const dictionaryLoadedRef = useRef(false);

  // ---- Dictionary load ----
  useEffect(() => {
    if (dictionaryLoadedRef.current) return;
    fetch(url)
      .then((res) => res.text())
      .then((text) => {
        setDictionary(parseDictionary(text));
        dictionaryLoadedRef.current = true;
      })
      .catch((err) => {
        console.error('Failed to load dictionary', err);
        setMessage('Could not load the dictionary. Please refresh the page.');
      });
  }, []);

  // ---- Core solver: recompute possibilities from every committed row ----
  const solve = useCallback((committedRows) => {
    if (dictionary.length === 0) return [];
    let pool = dictionary.filter((w) => w.length === wordLength);
    committedRows.forEach(({ letters, states }) => {
      pool = pool.filter((word) => candidatePassesRow(word, letters, states));
    });
    return pool;
  }, [dictionary, wordLength]);

  // ---- Input handlers ----
  const addLetter = useCallback((letter) => {
    setCurrent((prev) => {
      if (prev.letters.length >= wordLength) return prev;
      return {
        letters: [...prev.letters, letter],
        states: [...prev.states, ABSENT],
      };
    });
  }, [wordLength]);

  const removeLetter = useCallback(() => {
    setCurrent((prev) => {
      if (prev.letters.length === 0) return prev;
      return {
        letters: prev.letters.slice(0, -1),
        states: prev.states.slice(0, -1),
      };
    });
  }, []);

  // Cycle a tile's colour: absent -> present -> correct -> absent
  const cycleTile = useCallback((index) => {
    setCurrent((prev) => {
      if (index >= prev.letters.length) return prev;
      const states = [...prev.states];
      states[index] = (states[index] + 1) % 3;
      return { ...prev, states };
    });
  }, []);

  const commitRow = useCallback(() => {
    if (current.letters.length !== wordLength) {
      setMessage(`Enter all ${wordLength} letters before adding the guess.`);
      return;
    }
    if (rows.length >= MAX_ROWS) {
      setMessage('You have reached the maximum number of guesses.');
      return;
    }
    const newRows = [...rows, current];
    setRows(newRows);
    setCurrent({ letters: [], states: [] });
    setResults(solve(newRows));
    setMessage('');
  }, [current, wordLength, rows, solve]);

  const handleKeyInput = useCallback((key) => {
    if (key === 'ENTER') {
      commitRow();
    } else if (key === 'DEL') {
      removeLetter();
    } else {
      addLetter(key);
    }
  }, [commitRow, removeLetter, addLetter]);

  // Physical keyboard support
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key;
      if (key === 'Enter') {
        e.preventDefault();
        handleKeyInput('ENTER');
      } else if (key === 'Backspace' || key === 'Delete') {
        e.preventDefault();
        handleKeyInput('DEL');
      } else if (/^[a-zA-Z]$/.test(key)) {
        handleKeyInput(key.toUpperCase());
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleKeyInput]);

  const reset = useCallback(() => {
    setRows([]);
    setCurrent({ letters: [], states: [] });
    setResults(null);
    setMessage('');
  }, []);

  const changeLength = useCallback((len) => {
    setWordLength(len);
    setRows([]);
    setCurrent({ letters: [], states: [] });
    setResults(null);
    setMessage('');
  }, []);

  // ---- Render helpers ----
  const stateClass = (state) => {
    switch (state) {
      case CORRECT: return 'state-correct';
      case PRESENT: return 'state-present';
      default: return 'state-absent';
    }
  };

  const renderRow = (row, { active = false } = {}) => {
    const tiles = [];
    for (let i = 0; i < wordLength; i++) {
      const letter = row.letters[i] || '';
      const filled = Boolean(letter);
      const state = row.states[i] ?? ABSENT;
      tiles.push(
        <button
          key={i}
          type="button"
          className={`solver-tile ${filled ? stateClass(state) : ''} ${filled ? 'filled' : ''}`}
          onClick={active && filled ? () => cycleTile(i) : undefined}
          disabled={!active || !filled}
          aria-label={filled ? `${letter}, tap to change colour` : 'empty tile'}
        >
          {letter}
        </button>
      );
    }
    return <div className="solver-row" key={active ? 'active' : `row-${row.__id}`}>{tiles}</div>;
  };

  const canSolve = rows.length > 0 || current.letters.length === wordLength;
  const remainingCount = results ? results.length : null;
  const shownResults = results ? results.slice(0, RESULT_LIMIT) : [];

  return (
    <div className="wordle-solver">
      <Header />
      <main className="solver-main">
        <h1 className="solver-title">Wordle Solver</h1>
        <p className="solver-subtitle">
          Type a word you guessed, tap each letter to match Wordle&apos;s colours,
          then add it to narrow down the possible answers.
        </p>

        {/* Legend */}
        <div className="solver-legend" aria-hidden="true">
          <span className="legend-item"><span className="legend-swatch state-correct" />Correct spot</span>
          <span className="legend-item"><span className="legend-swatch state-present" />Wrong spot</span>
          <span className="legend-item"><span className="legend-swatch state-absent" />Not in word</span>
        </div>

        {/* Word length selector */}
        <div className="solver-length">
          <span className="solver-length-label">Word length</span>
          <div className="solver-length-options" role="group" aria-label="Word length">
            {Array.from({ length: MAX_LEN - MIN_LEN + 1 }, (_, k) => MIN_LEN + k).map((len) => (
              <button
                key={len}
                type="button"
                className={`length-chip ${len === wordLength ? 'active' : ''}`}
                onClick={() => changeLength(len)}
              >
                {len}
              </button>
            ))}
          </div>
        </div>

        {/* Board */}
        <div className="solver-board">
          {rows.map((row, idx) => renderRow({ ...row, __id: idx }))}
          {rows.length < MAX_ROWS && renderRow(current, { active: true })}
        </div>

        {message && <div className="solver-message">{message}</div>}

        {/* On-screen keyboard */}
        <div className="solver-keyboard">
          {KEYBOARD_ROWS.map((krow, r) => (
            <div className="solver-key-row" key={r}>
              {krow.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`solver-key ${key === 'ENTER' || key === 'DEL' ? 'solver-key-wide' : ''}`}
                  onClick={() => handleKeyInput(key)}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {key === 'DEL' ? '⌫' : key === 'ENTER' ? 'Enter' : key}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="solver-actions">
          <button type="button" className="solver-btn solver-btn-primary" onClick={commitRow} disabled={current.letters.length !== wordLength}>
            Add guess
          </button>
          <button type="button" className="solver-btn solver-btn-ghost" onClick={reset}>
            Reset
          </button>
          <button type="button" className="solver-btn solver-btn-accent" onClick={() => navigate('/wordle')}>
            Play Wordle
          </button>
        </div>

        {/* Results */}
        {results !== null && (
          <div className="solver-results">
            <div className="solver-results-header">
              {remainingCount === 0
                ? 'No matching words found — double-check your colours.'
                : `${remainingCount} possible ${remainingCount === 1 ? 'word' : 'words'}`}
              {remainingCount > RESULT_LIMIT && ` (showing first ${RESULT_LIMIT})`}
            </div>
            {remainingCount > 0 && (
              <div className="solver-word-list">
                {shownResults.map((word, i) => (
                  <span className="solver-word-chip" key={`${word}-${i}`}>{word}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {!canSolve && results === null && (
          <div className="solver-hint">
            Enter your first guess above to get started.
          </div>
        )}

        <a
          className="solver-source"
          href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/WordleSolver"
          rel="noopener noreferrer"
          target="_blank"
        >
          View source code
        </a>
      </main>
      <Footer />
    </div>
  );
}

export default WordleSolver;
