import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import { createData, createPublicData, getData } from '../../../features/data/dataSlice';
import BANK, { CAT_LABELS, CAT_KEYS, DIFF_TIERS } from './questionBank';
import { formatTime, ordinal, computeIQ, DIFF_TO_B } from './iqStats';
import { PatternSequence, PatternGrid, PatternOptionContent } from './PatternVisual';
import './IQTest.css';

// Parses a pipe-delimited "Key:Value|Key2:Value2" record (the same convention
// used across the app's generic Data model, e.g. bug reports/contact forms)
// back into a plain object.
function parseRecord(text) {
  const out = {};
  (text || '').split('|').forEach((chunk) => {
    const idx = chunk.indexOf(':');
    if (idx === -1) return;
    out[chunk.slice(0, idx)] = chunk.slice(idx + 1);
  });
  return out;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Test length presets. "count" is the total number of questions; each
// category gets as even a share as possible (see pickQuestions). Fewer
// questions means a faster test but a less precise ability estimate, since
// the IRT model has less data to work with — hence "low accuracy".
export const TEST_LENGTHS = {
  fast: { label: 'Fast', count: 10, blurb: '~5 min, low accuracy' },
  normal: { label: 'Normal', count: 25, blurb: '~12 min, balanced accuracy' },
  high: { label: 'High Accuracy', count: 45, blurb: '~20 min, highest accuracy' },
};

// When a category gets fewer than all 5 tiers, this order picks the most
// spread-out tiers first (easy + hard extremes before filling in the
// middle), so even a short test still samples a range of difficulty.
const TIER_PRIORITY = [1, 5, 3, 2, 4];

function pickQuestions(totalCount) {
  const catKeys = shuffle(CAT_KEYS);
  const perCatBase = Math.floor(totalCount / catKeys.length);
  let remainder = totalCount % catKeys.length;

  let selected = [];
  catKeys.forEach((cat) => {
    let n = perCatBase;
    if (remainder > 0) {
      n += 1;
      remainder -= 1;
    }
    n = Math.min(n, DIFF_TIERS.length);

    // Draw one question from each of this category's assigned difficulty
    // tiers, so every attempt is guaranteed a stratified easy-to-expert
    // spread instead of a fully random (and sometimes accidentally
    // all-easy) draw.
    TIER_PRIORITY.slice(0, n).forEach((tier) => {
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
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.data);

  const [screen, setScreen] = useState('start'); // 'start' | 'quiz' | 'results'
  const [testMode, setTestMode] = useState('normal'); // 'fast' | 'normal' | 'high'
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [userAnswers, setUserAnswers] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [showReview, setShowReview] = useState(false);
  const [reportModal, setReportModal] = useState(null); // { index, feedback } | null
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyEntries, setHistoryEntries] = useState([]);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const historySavedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startTest = useCallback(() => {
    setQuestions(pickQuestions(TEST_LENGTHS[testMode].count));
    setCurrentIndex(0);
    setUserAnswers([]);
    setSelectedOption(null);
    setShowReview(false);
    setElapsed(0);
    historySavedRef.current = false;
    startTimeRef.current = Date.now();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    setScreen('quiz');
  }, [testMode]);

  // Returns to the start screen instead of immediately restarting with the
  // same test length, so the user can pick a fresh mode each time — like
  // reloading the page rather than repeating the last test.
  const resetToStart = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setQuestions([]);
    setCurrentIndex(0);
    setUserAnswers([]);
    setSelectedOption(null);
    setShowReview(false);
    setElapsed(0);
    setScreen('start');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goToNext = useCallback((chosenIdx) => {
    const q = questions[currentIndex];
    const newAnswers = [...userAnswers, {
      cat: q.cat,
      diff: q.diff,
      question: q.q,
      passage: q.passage || null,
      visual: q.visual || null,
      prompt: q.prompt || null,
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

  // Steps back to the previous question, discarding its recorded answer so
  // the user can reconsider and re-select it via goToNext/handleNext.
  const goToPrevious = useCallback(() => {
    if (currentIndex === 0) return;
    const prevIndex = currentIndex - 1;
    const prevAnswer = userAnswers[prevIndex];
    setUserAnswers(userAnswers.slice(0, prevIndex));
    setCurrentIndex(prevIndex);
    setSelectedOption(prevAnswer ? prevAnswer.selectedIdx : null);
  }, [currentIndex, userAnswers]);

  const handleSelect = (idx) => setSelectedOption(idx);
  const handleNext = () => goToNext(selectedOption);
  const handleSkip = () => goToNext(null);
  const handleBack = () => goToPrevious();

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

  // Persists a summary of the completed attempt to the user's account (as a
  // generic Data record, same convention as bug reports/contact messages) so
  // it can be listed later in the Quiz History modal. Runs once per attempt.
  useEffect(() => {
    if (screen !== 'results' || !user?._id || historySavedRef.current) return;
    historySavedRef.current = true;

    const record = {
      text: `Creator:${user._id}|Quiz:IQTest|Mode:${testMode}|IQ:${iq}|Percentile:${percentile}|Correct:${correctCount}/${userAnswers.length}|Time:${elapsed}|Timestamp:${new Date().toISOString()}`
    };
    dispatch(createData(record)).unwrap().catch((error) => {
      console.error('Failed to save quiz history:', error);
    });
    // Only the values needed to build the record matter here; re-running on
    // every render (e.g. from userAnswers/testMode identity changes) would
    // otherwise be harmless since historySavedRef guards duplicate saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, user, iq, percentile]);

  const openReportModal = (index) => setReportModal({ index, feedback: '' });
  const closeReportModal = () => {
    if (reportSubmitting) return;
    setReportModal(null);
  };
  const handleReportFeedbackChange = (e) => {
    setReportModal((prev) => (prev ? { ...prev, feedback: e.target.value } : prev));
  };

  const submitReport = async () => {
    if (!reportModal) return;
    const a = userAnswers[reportModal.index];
    setReportSubmitting(true);
    try {
      const creatorPrefix = user?._id ? `Creator:${user._id}|` : '';
      const bugData = {
        text: `${creatorPrefix}Bug:IQ Test Question Issue|Category:${CAT_LABELS[a.cat] || a.cat}|Question:${a.question}|UserFeedback:${reportModal.feedback || '(none provided)'}|Status:Open|Timestamp:${new Date().toISOString()}`
      };
      await dispatch(createPublicData(bugData)).unwrap();
      toast.success('Thanks — this question has been reported.', { autoClose: 4000 });
      setReportModal(null);
    } catch (error) {
      console.error('Error submitting question report:', error);
      toast.error('Failed to submit report. Please try again.', { autoClose: 3000 });
    } finally {
      setReportSubmitting(false);
    }
  };

  const openHistoryModal = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const result = await dispatch(getData({ data: 'Quiz:IQTest' })).unwrap();
      const entries = (result?.data || [])
        .map((item) => ({ ...parseRecord(item.data), _id: item._id }))
        .filter((entry) => entry.Quiz === 'IQTest')
        .sort((x, y) => new Date(y.Timestamp || 0) - new Date(x.Timestamp || 0));
      setHistoryEntries(entries);
    } catch (error) {
      console.error('Failed to load quiz history:', error);
      setHistoryError('Failed to load quiz history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  };
  const closeHistoryModal = () => setHistoryOpen(false);

  return (
    <>
      <SEO
        title="IQ Test"
        description="Take a free adaptive IQ test with multiple difficulty tiers and instant results."
        path="/iq"
      />
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
                A fresh, randomized set of questions every time, spanning easy to expert
                difficulty — English &amp; vocabulary, reading comprehension, science reasoning,
                logic, math, spatial reasoning, critical reasoning, and pattern matching. Get
                your score, an estimated IQ, your percentile, and a full breakdown of every
                answer.
              </p>
            </div>

            <div className="iq-test-card">
              <h2>Choose a test length</h2>
              <div className="iq-test-mode-row" role="radiogroup" aria-label="Test length">
                {Object.entries(TEST_LENGTHS).map(([key, mode]) => (
                  <button
                    key={key}
                    type="button"
                    className={`iq-test-mode-btn${testMode === key ? ' selected' : ''}`}
                    role="radio"
                    aria-checked={testMode === key}
                    onClick={() => setTestMode(key)}
                  >
                    <span className="mode-label">{mode.label}</span>
                    <span className="mode-count">{mode.count} questions</span>
                    <span className="mode-blurb">{mode.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="iq-test-card">
              <h2>What to expect</h2>
              <div className="iq-test-category-grid">
                <div className="iq-test-category-pill"><span className="emoji">🔤</span>English</div>
                <div className="iq-test-category-pill"><span className="emoji">📖</span>Reading</div>
                <div className="iq-test-category-pill"><span className="emoji">🔬</span>Science</div>
                <div className="iq-test-category-pill"><span className="emoji">🧩</span>Logic</div>
                <div className="iq-test-category-pill"><span className="emoji">🔢</span>Math</div>
                <div className="iq-test-category-pill"><span className="emoji">🧊</span>Spatial Reasoning</div>
                <div className="iq-test-category-pill"><span className="emoji">🧠</span>Critical Reasoning</div>
                <div className="iq-test-category-pill"><span className="emoji">🔷</span>Pattern Matching</div>
              </div>
              <p className="iq-test-hint">
                {TEST_LENGTHS[testMode].count} questions total, spread as evenly as possible
                across all {CAT_KEYS.length} categories and stratified across difficulty tiers
                from easy to expert, multiple choice, no time limit — but we&apos;ll track how
                long you take just for fun. Expect the hardest questions to be genuinely hard;
                getting a perfect score isn&apos;t supposed to be easy. Questions and answer order
                are shuffled on every attempt.
              </p>
              <div className="iq-test-btn-row">
                <button className="iq-test-btn" onClick={startTest}>Start Test</button>
                {user?._id && (
                  <button className="iq-test-btn secondary" type="button" onClick={openHistoryModal}>
                    Quiz History
                  </button>
                )}
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

              {questions[currentIndex].visual === 'sequence' && (
                <PatternSequence items={questions[currentIndex].prompt} />
              )}
              {questions[currentIndex].visual === 'grid' && (
                <PatternGrid items={questions[currentIndex].prompt} />
              )}

              <div className={`iq-test-options${questions[currentIndex].visual ? ' iq-test-options-visual' : ''}`} role="radiogroup" aria-label="Answer options">
                {questions[currentIndex].options.map((opt, idx) => (
                  <button
                    key={idx}
                    className={`iq-test-option${selectedOption === idx ? ' selected' : ''}`}
                    role="radio"
                    aria-checked={selectedOption === idx}
                    onClick={() => handleSelect(idx)}
                  >
                    <span className="iq-test-letter">{LETTERS[idx]}</span>
                    {questions[currentIndex].visual ? (
                      <PatternOptionContent token={opt} />
                    ) : (
                      <span>{opt}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="iq-test-btn-row">
                <button className="iq-test-btn secondary" onClick={handleBack} disabled={currentIndex === 0}>
                  ← Back
                </button>
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
                <button className="iq-test-btn" onClick={resetToStart}>Take a New Test</button>
                <button className="iq-test-btn secondary" onClick={() => setShowReview((v) => !v)}>
                  {showReview ? 'Hide Answer Review' : 'Show Answer Review'}
                </button>
                {user?._id && (
                  <button className="iq-test-btn secondary" type="button" onClick={openHistoryModal}>
                    Quiz History
                  </button>
                )}
              </div>
            </div>

            {showReview && (
              <div className="iq-test-card">
                <h2 style={{ marginTop: 0 }}>Answer Review</h2>
                {userAnswers.map((a, i) => {
                  const isCorrect = a.selectedIdx === a.correctIdx;
                  return (
                    <div className={`iq-test-review-item ${isCorrect ? 'correct' : 'incorrect'}`} key={i}>
                      <div className="review-q-row">
                        <div className="review-q">{i + 1}. [{CAT_LABELS[a.cat]}] {a.question}</div>
                        <button
                          type="button"
                          className="iq-test-report-btn"
                          onClick={() => openReportModal(i)}
                        >
                          🚩 Report Question
                        </button>
                      </div>
                      {a.visual === 'sequence' && <PatternSequence items={a.prompt} size={40} />}
                      {a.visual === 'grid' && <PatternGrid items={a.prompt} size={40} />}
                      {a.selectedIdx === null ? (
                        <div className="review-ans your-wrong">Your answer: (skipped)</div>
                      ) : (
                        <div className={`review-ans ${isCorrect ? 'right' : 'your-wrong'}`}>
                          Your answer: {LETTERS[a.selectedIdx]}.
                          {a.visual ? <PatternOptionContent token={a.options[a.selectedIdx]} size={32} /> : ` ${a.options[a.selectedIdx]}`}
                        </div>
                      )}
                      {!isCorrect && (
                        <div className="review-ans right">
                          Correct answer: {LETTERS[a.correctIdx]}.
                          {a.visual ? <PatternOptionContent token={a.options[a.correctIdx]} size={32} /> : ` ${a.options[a.correctIdx]}`}
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

        {reportModal && (
          <div className="iq-test-modal-overlay" role="presentation" onClick={closeReportModal}>
            <div
              className="iq-test-modal iq-test-card"
              role="dialog"
              aria-modal="true"
              aria-label="Report question"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ marginTop: 0 }}>Report Question</h2>
              <p className="iq-test-modal-question">
                {userAnswers[reportModal.index]?.question}
              </p>
              <label className="iq-test-modal-label" htmlFor="iq-test-report-feedback">
                What&apos;s wrong with this question? (optional)
              </label>
              <textarea
                id="iq-test-report-feedback"
                className="iq-test-modal-textarea"
                rows={4}
                value={reportModal.feedback}
                onChange={handleReportFeedbackChange}
                placeholder="e.g. the correct answer looks wrong, the wording is confusing, a typo, etc."
              />
              <div className="iq-test-btn-row">
                <button className="iq-test-btn secondary" type="button" onClick={closeReportModal} disabled={reportSubmitting}>
                  Cancel
                </button>
                <button className="iq-test-btn" type="button" onClick={submitReport} disabled={reportSubmitting}>
                  {reportSubmitting ? 'Submitting…' : 'Submit Report'}
                </button>
              </div>
            </div>
          </div>
        )}

        {historyOpen && (
          <div className="iq-test-modal-overlay" role="presentation" onClick={closeHistoryModal}>
            <div
              className="iq-test-modal iq-test-card"
              role="dialog"
              aria-modal="true"
              aria-label="Quiz history"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ marginTop: 0 }}>Quiz History</h2>
              {historyLoading && <p className="iq-test-hint">Loading your past attempts…</p>}
              {!historyLoading && historyError && <p className="iq-test-hint">{historyError}</p>}
              {!historyLoading && !historyError && historyEntries.length === 0 && (
                <p className="iq-test-hint">No past attempts yet — take a test to start your history.</p>
              )}
              {!historyLoading && !historyError && historyEntries.length > 0 && (
                <div className="iq-test-history-list">
                  {historyEntries.map((entry) => (
                    <div className="iq-test-history-item" key={entry._id}>
                      <div className="iq-test-history-main">
                        <span className="iq-test-history-iq">IQ {entry.IQ}</span>
                        <span className="iq-test-history-detail">{ordinal(Number(entry.Percentile))} pct</span>
                        <span className="iq-test-history-detail">{entry.Correct} correct</span>
                        <span className="iq-test-history-detail">{formatTime(Number(entry.Time) || 0)}</span>
                      </div>
                      <div className="iq-test-history-date">
                        {entry.Timestamp ? new Date(entry.Timestamp).toLocaleString() : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="iq-test-btn-row">
                <button className="iq-test-btn secondary" type="button" onClick={closeHistoryModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}

export default IQTest;
