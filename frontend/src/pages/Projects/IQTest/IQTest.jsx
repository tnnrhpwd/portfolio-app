import React, { useState, useRef, useEffect, useCallback } from 'react';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import BANK, { CAT_LABELS, CAT_KEYS, DIFF_TIERS } from './questionBank';
import { formatTime, ordinal, computeIQ, DIFF_TO_B } from './iqStats';
import './IQTest.css';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestions() {
  let selected = [];
  CAT_KEYS.forEach((cat) => {
    // Draw exactly one question from each difficulty tier per category, so
    // every attempt is guaranteed a stratified easy-to-expert spread instead
    // of a fully random (and sometimes accidentally all-easy) draw.
    DIFF_TIERS.forEach((tier) => {
      const pool = BANK.filter((q) => q.cat === cat && q.diff === tier);
      if (pool.length > 0) {
        selected.push(pool[Math.floor(Math.random() * pool.length)]);
      }
    });
  });
  selected = shuffle(selected);

  // Shuffle option order per question while tracking the new correct index.
  return selected.map((q) => {
    const optIdx = q.options.map((_, i) => i);
    const shuffledIdx = shuffle(optIdx);
    const newOptions = shuffledIdx.map((i) => q.options[i]);
    const newAnswer = shuffledIdx.indexOf(q.answer);
    return { ...q, options: newOptions, answer: newAnswer };
  });
}

const LETTERS = ['A', 'B', 'C', 'D'];

function IQTest() {
  const [screen, setScreen] = useState('start'); // 'start' | 'quiz' | 'results'
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [userAnswers, setUserAnswers] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [showReview, setShowReview] = useState(false);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startTest = useCallback(() => {
    setQuestions(pickQuestions());
    setCurrentIndex(0);
    setUserAnswers([]);
    setSelectedOption(null);
    setShowReview(false);
    setElapsed(0);
    startTimeRef.current = Date.now();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    setScreen('quiz');
  }, []);

  const goToNext = useCallback((chosenIdx) => {
    const q = questions[currentIndex];
    const newAnswers = [...userAnswers, {
      cat: q.cat,
      diff: q.diff,
      question: q.q,
      passage: q.passage || null,
      options: q.options,
      correctIdx: q.answer,
      selectedIdx: chosenIdx,
      exp: q.exp
    }];
    setUserAnswers(newAnswers);

    const nextIndex = currentIndex + 1;
    if (nextIndex >= questions.length) {
      if (timerRef.current) clearInterval(timerRef.current);
      setScreen('results');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setCurrentIndex(nextIndex);
      setSelectedOption(null);
    }
  }, [currentIndex, questions, userAnswers]);

  const handleSelect = (idx) => setSelectedOption(idx);
  const handleNext = () => goToNext(selectedOption);
  const handleSkip = () => goToNext(null);

  // ---- Scoring ----
  // Ability is estimated with a Rasch (1PL IRT) model: each answer becomes a
  // { b, correct } response using the item's difficulty parameter, so a
  // correct answer on a hard (tier 4/5) question raises the estimate far more
  // than one on an easy (tier 1) question — and getting every question right
  // (including the expert-tier ones) is what it takes to reach the top scores.
  let correctCount = 0;
  const catStats = {};
  CAT_KEYS.forEach((c) => { catStats[c] = { correct: 0, total: 0 }; });

  const irtResponses = userAnswers.map((a) => {
    catStats[a.cat].total += 1;
    const correct = a.selectedIdx === a.correctIdx;
    if (correct) {
      correctCount += 1;
      catStats[a.cat].correct += 1;
    }
    return { b: DIFF_TO_B[a.diff] ?? 0, correct };
  });

  const { iq, percentile } = computeIQ(irtResponses);

  return (
    <>
      <Header />
      <div className="iq-test">
        <div className="iq-test-floating" aria-hidden="true">
          <div className="iq-test-circle iq-test-circle-1" />
          <div className="iq-test-circle iq-test-circle-2" />
          <div className="iq-test-circle iq-test-circle-3" />
        </div>

        {screen === 'start' && (
          <section className="iq-test-section">
            <div className="iq-test-title-wrap">
              <h1 className="iq-test-title">IQ Test</h1>
              <div className="iq-test-underline" aria-hidden="true" />
              <p className="iq-test-subtitle">
                A fresh, randomized set of 25 questions every time, spanning easy to expert
                difficulty — English &amp; vocabulary, reading comprehension, science reasoning,
                logic/pattern matching, and math. Get your score, an estimated IQ, your
                percentile, and a full breakdown of every answer.
              </p>
            </div>

            <div className="iq-test-card">
              <h2>What to expect</h2>
              <div className="iq-test-category-grid">
                <div className="iq-test-category-pill"><span className="emoji">🔤</span>English</div>
                <div className="iq-test-category-pill"><span className="emoji">📖</span>Reading</div>
                <div className="iq-test-category-pill"><span className="emoji">🔬</span>Science</div>
                <div className="iq-test-category-pill"><span className="emoji">🧩</span>Logic</div>
                <div className="iq-test-category-pill"><span className="emoji">🔢</span>Math</div>
              </div>
              <p className="iq-test-hint">
                25 questions total (5 per category, one from each difficulty tier from easy to
                expert), multiple choice, no time limit — but we&apos;ll track how long you take
                just for fun. Expect the last question or two in each category to be genuinely
                hard; getting a perfect score isn&apos;t supposed to be easy. Questions and answer
                order are shuffled on every attempt.
              </p>
              <div className="iq-test-btn-row">
                <button className="iq-test-btn" onClick={startTest}>Start Test</button>
              </div>
            </div>

            <p className="iq-test-disclaimer">
              For entertainment and self-reflection purposes only. This is not a clinically
              validated psychometric instrument and should not be used for diagnosis,
              employment, educational placement, or any official purpose.
            </p>
          </section>
        )}

        {screen === 'quiz' && questions.length > 0 && currentIndex < questions.length && (
          <section className="iq-test-section iq-test-section-narrow">
            <div className="iq-test-card">
              <div className="iq-test-progress-row">
                <span>Question {currentIndex + 1} of {questions.length}</span>
                <div className="iq-test-progress-track">
                  <div className="iq-test-progress-fill" style={{ width: `${Math.round((currentIndex / questions.length) * 100)}%` }} />
                </div>
                <span>{formatTime(elapsed)}</span>
              </div>

              <span className={`iq-test-cat-badge iq-test-cat-${questions[currentIndex].cat}`}>
                {CAT_LABELS[questions[currentIndex].cat]}
              </span>

              {questions[currentIndex].passage && (
                <div className="iq-test-passage">{questions[currentIndex].passage}</div>
              )}

              <div className="iq-test-question">{questions[currentIndex].q}</div>

              <div className="iq-test-options" role="radiogroup" aria-label="Answer options">
                {questions[currentIndex].options.map((opt, idx) => (
                  <button
                    key={idx}
                    className={`iq-test-option${selectedOption === idx ? ' selected' : ''}`}
                    role="radio"
                    aria-checked={selectedOption === idx}
                    onClick={() => handleSelect(idx)}
                  >
                    <span className="iq-test-letter">{LETTERS[idx]}</span>
                    <span>{opt}</span>
                  </button>
                ))}
              </div>

              <div className="iq-test-btn-row">
                <button className="iq-test-btn secondary" onClick={handleSkip}>Skip Question</button>
                <button className="iq-test-btn" onClick={handleNext} disabled={selectedOption === null}>
                  {currentIndex === questions.length - 1 ? 'Finish →' : 'Next →'}
                </button>
              </div>
            </div>
          </section>
        )}

        {screen === 'results' && (
          <section className="iq-test-section iq-test-section-narrow">
            <div className="iq-test-title-wrap">
              <h1 className="iq-test-title iq-test-title-sm">Your Results</h1>
              <div className="iq-test-underline" aria-hidden="true" />
            </div>

            <div className="iq-test-card">
              <div className="iq-test-score-hero">
                <div className="iq-test-iq-number">{iq}</div>
                <div className="iq-test-iq-label">Estimated IQ Score</div>
              </div>

              <div className="iq-test-stat-grid">
                <div className="iq-test-stat-box">
                  <div className="val">{correctCount}/{userAnswers.length}</div>
                  <div className="lbl">Correct</div>
                </div>
                <div className="iq-test-stat-box">
                  <div className="val">{ordinal(percentile)}</div>
                  <div className="lbl">Percentile</div>
                </div>
                <div className="iq-test-stat-box">
                  <div className="val">{formatTime(elapsed)}</div>
                  <div className="lbl">Time Taken</div>
                </div>
              </div>

              <div className="iq-test-cat-breakdown">
                <h2>Category Breakdown</h2>
                {CAT_KEYS.map((c) => {
                  const s = catStats[c];
                  const pctBar = s.total ? Math.round((s.correct / s.total) * 100) : 0;
                  return (
                    <div className="iq-test-cat-row" key={c}>
                      <span className="name">{CAT_LABELS[c]}</span>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${pctBar}%` }} /></div>
                      <span className="count">{s.correct}/{s.total}</span>
                    </div>
                  );
                })}
              </div>

              <p className="iq-test-disclaimer" style={{ marginTop: 0 }}>
                Estimated IQ uses an item-response (Rasch) model: each answer is weighted by how
                hard that specific question is, so correctly answering the expert-level questions
                counts far more than the easy ones. Scores assume a normal distribution (mean 100,
                SD 15). For entertainment only — not a clinical assessment.
              </p>

              <div className="iq-test-btn-row">
                <button className="iq-test-btn" onClick={startTest}>Take a New Test</button>
                <button className="iq-test-btn secondary" onClick={() => setShowReview((v) => !v)}>
                  {showReview ? 'Hide Answer Review' : 'Show Answer Review'}
                </button>
              </div>
            </div>

            {showReview && (
              <div className="iq-test-card">
                <h2 style={{ marginTop: 0 }}>Answer Review</h2>
                {userAnswers.map((a, i) => {
                  const isCorrect = a.selectedIdx === a.correctIdx;
                  return (
                    <div className={`iq-test-review-item ${isCorrect ? 'correct' : 'incorrect'}`} key={i}>
                      <div className="review-q">{i + 1}. [{CAT_LABELS[a.cat]}] {a.question}</div>
                      {a.selectedIdx === null ? (
                        <div className="review-ans your-wrong">Your answer: (skipped)</div>
                      ) : (
                        <div className={`review-ans ${isCorrect ? 'right' : 'your-wrong'}`}>
                          Your answer: {LETTERS[a.selectedIdx]}. {a.options[a.selectedIdx]}
                        </div>
                      )}
                      {!isCorrect && (
                        <div className="review-ans right">
                          Correct answer: {LETTERS[a.correctIdx]}. {a.options[a.correctIdx]}
                        </div>
                      )}
                      <div className="review-explain">{a.exp}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
      <Footer />
    </>
  );
}

export default IQTest;
