import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import { createData, createPublicData, getData } from '../../../features/data/dataSlice';
import { shuffle, formatTime, scoreTraits, selectItemIndices } from './quizEngine';
import { QUIZ_SOURCE_URL } from './meta';
import './QuizPage.css';

// Answer-letter markers for the option buttons (A–E, one per answer choice).
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// How long a picked answer stays highlighted before auto-advancing. Long
// enough to read as "that registered", short enough that a 30-item quiz
// doesn't feel like 30 page transitions.
const ADVANCE_MS = 180;

/**
 * Parses a pipe-delimited "Key:Value|Key2:Value2" record (the convention used
 * across the app's generic Data model) back into a plain object.
 */
function parseRecord(text) {
  const out = {};
  (text || '').split('|').forEach((chunk) => {
    const idx = chunk.indexOf(':');
    if (idx === -1) return;
    out[chunk.slice(0, idx)] = chunk.slice(idx + 1);
  });
  return out;
}

// Result text goes into a pipe-delimited record, so a stray "|" would corrupt
// the record. Headlines are short labels, but strip them defensively.
const clean = (value) => String(value ?? '').replace(/\|/g, '/');

/**
 * Renders one quiz. The quiz's own config supplies the words, the items and
 * the interpretation; this component owns the flow (start → questions →
 * results → review) and the account-level history/report plumbing, so all
 * quizzes behave — and are styled — identically.
 *
 * See data/mbti.js for a fully annotated config example.
 *
 * @param {{quiz: object}} props
 */
function QuizPage({ quiz }) {
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.data);

  const scaleMax = Math.max((quiz.scale?.length ?? 2) - 1, 1);

  const [screen, setScreen] = useState('start'); // 'start' | 'quiz' | 'results'
  const [order, setOrder] = useState([]); // shuffled indices into quiz.items
  const [lengthId, setLengthId] = useState(quiz.defaultLength || 'standard');
  const [answers, setAnswers] = useState([]); // answer index per question position
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState(null);
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
  const advanceRef = useRef(null);
  const savedRef = useRef(false);

  // Length presets (short / standard / full). `count` is how many items that
  // length asks; null means the whole set. `lengths` is an object so its key
  // order is the display order.
  //
  // ⚠️ Derived AFTER the state above, not next to `scaleMax`: `selectedLength`
  // reads `lengthId`, and computing it before the `useState` that declares it
  // trips the temporal dead zone (`Cannot access 'lengthId' before
  // initialization`) and takes the whole page to the error boundary.
  const lengthOptions = Object.entries(quiz.lengths || {}).map(([id, preset]) => ({
    id,
    ...preset,
    total: preset.count ?? quiz.items.length,
  }));
  const selectedLength = lengthOptions.find((option) => option.id === lengthId)
    // A config with no `lengths` still works: one implicit "everything" option.
    || { id: 'full', label: 'Full', count: null, total: quiz.items.length, blurb: '' };

  // The likert quizzes call their items statements; the guided one calls them
  // questions. Derived rather than configured, so it cannot drift.
  const itemNoun = quiz.scale ? 'statements' : 'questions';

  const clearAdvance = useCallback(() => {
    if (advanceRef.current) {
      clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }
  }, []);

  // Both timers outlive the component if the user navigates away mid-quiz,
  // which would let the clock keep ticking (and the advance fire) on a page
  // that no longer exists.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (advanceRef.current) clearTimeout(advanceRef.current);
  }, []);

  const startQuiz = useCallback(() => {
    // The chosen length decides WHICH items, this decides their order. Most
    // quizzes shuffle to blunt order effects; a quiz whose parts carry meaning
    // (the ADHD screener) opts out with `shuffle: false`.
    const positions = selectItemIndices(quiz.items, selectedLength.count);
    setOrder(quiz.shuffle === false ? positions : shuffle(positions));
    setAnswers([]);
    setCurrentIndex(0);
    setSelected(null);
    setShowReview(false);
    setElapsed(0);
    savedRef.current = false;
    startTimeRef.current = Date.now();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    setScreen('quiz');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [quiz.items, quiz.shuffle, selectedLength.count]);

  // Return to the start screen rather than restarting immediately, so the
  // quiz doesn't re-run itself until the user asks for it again.
  const resetToStart = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    clearAdvance();
    setOrder([]);
    setAnswers([]);
    setCurrentIndex(0);
    setSelected(null);
    setShowReview(false);
    setElapsed(0);
    setScreen('start');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [clearAdvance]);

  const finish = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setScreen('results');
    setShowReview(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Records an answer and moves on. Scales auto-advance (with the selection
  // left visible for ADVANCE_MS so the choice registers visually); a skip
  // advances straight away.
  const commit = useCallback((value) => {
    const nextAnswers = answers.slice();
    nextAnswers[currentIndex] = value;
    setAnswers(nextAnswers);
    setSelected(value);

    const isLast = currentIndex >= order.length - 1;
    if (timerRef.current && isLast) clearInterval(timerRef.current);

    clearAdvance();
    advanceRef.current = setTimeout(() => {
      advanceRef.current = null;
      if (currentIndex >= order.length - 1) {
        finish();
      } else {
        setCurrentIndex((i) => i + 1);
        setSelected(null);
      }
    }, value === null ? 0 : ADVANCE_MS);
  }, [answers, clearAdvance, currentIndex, finish, order.length]);

  // Steps back one question, discarding that answer so it can be re-picked.
  const goBack = useCallback(() => {
    clearAdvance();
    if (currentIndex === 0) return;
    const prev = currentIndex - 1;
    setAnswers((prevAnswers) => prevAnswers.slice(0, prev));
    setCurrentIndex(prev);
    setSelected(answers[prev] ?? null);
  }, [answers, clearAdvance, currentIndex]);

  // Every item paired with the answer given for it, in the order asked. This
  // is the single input to scoring and to the answer review.
  const responses = useMemo(() => order.map((itemIndex, pos) => ({
    ...quiz.items[itemIndex],
    index: itemIndex,
    value: answers[pos] ?? null,
  })), [order, answers, quiz.items]);

  const scores = useMemo(() => scoreTraits(responses, scaleMax), [responses, scaleMax]);

  const result = useMemo(
    () => (screen === 'results' && quiz.interpret ? quiz.interpret(scores, responses) : null),
    [screen, quiz, scores, responses]
  );

  // Persists a summary of the finished attempt to the signed-in user's
  // account, so past attempts show up in the Quiz History modal. Runs once
  // per attempt; `savedRef` guards against StrictMode double-invocation.
  useEffect(() => {
    if (screen !== 'results' || !result || !user?._id || savedRef.current) return;
    savedRef.current = true;

    const record = {
      text: `Creator:${user._id}|Quiz:${quiz.slug}|Length:${selectedLength.id}`
        + `|Result:${clean(result.headline)}|Detail:${clean(result.headlineSub)}`
        + `|Questions:${order.length}`
        + `|Time:${elapsed}|Timestamp:${new Date().toISOString()}`,
    };
    dispatch(createData(record)).unwrap().catch((error) => {
      console.error('Failed to save quiz history:', error);
    });
    // Only the values needed to build the record matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, result, user]);

  const openReportModal = (index) => setReportModal({ index, feedback: '' });
  const closeReportModal = () => {
    if (reportSubmitting) return;
    setReportModal(null);
  };

  const submitReport = async () => {
    if (!reportModal) return;
    const item = responses[reportModal.index];
    setReportSubmitting(true);
    try {
      const creatorPrefix = user?._id ? `Creator:${user._id}|` : '';
      // Field names here are the ones the admin Bugs view parses (it reads
      // `bug`, `status`, `creator` and `description`), so the item and the
      // reviewer's note both have to fit in Description to be readable there.
      await dispatch(createPublicData({
        text: `${creatorPrefix}Bug:Quiz Question Issue|Category:${clean(quiz.name)}`
          + `|Description:${clean(item?.text)} — ${clean(reportModal.feedback) || '(no detail given)'}`
          + `|Status:Open|Timestamp:${new Date().toISOString()}`,
      })).unwrap();
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
      const payload = await dispatch(getData({ data: `Quiz:${quiz.slug}` })).unwrap();
      const entries = (payload?.data || [])
        .map((item) => ({ ...parseRecord(item.data), _id: item._id }))
        .filter((entry) => entry.Quiz === quiz.slug)
        .sort((x, y) => new Date(y.Timestamp || 0) - new Date(x.Timestamp || 0));
      setHistoryEntries(entries);
    } catch (error) {
      console.error('Failed to load quiz history:', error);
      setHistoryError('Failed to load quiz history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const activeItem = order.length > 0 ? quiz.items[order[currentIndex]] : null;
  const partLabel = activeItem && quiz.partLabel ? quiz.partLabel(activeItem, currentIndex) : null;
  const progressPct = order.length ? Math.round((currentIndex / order.length) * 100) : 0;

  const answerText = (response) => {
    if (response?.value === null || response?.value === undefined) return '(skipped)';
    return quiz.scale?.[response.value] ?? `Option ${response.value + 1}`;
  };

  return (
    <>
      <SEO
        title={quiz.seoTitle || quiz.name}
        description={quiz.seoDescription}
        path={quiz.path}
      />
      <Header />
      <div className="quiz" style={quiz.accentRole ? { '--quiz-accent': `var(--scheme-${quiz.accentRole})` } : undefined}>
        <div className="quiz-floating" aria-hidden="true">
          <div className="quiz-circle quiz-circle-1" />
          <div className="quiz-circle quiz-circle-2" />
          <div className="quiz-circle quiz-circle-3" />
        </div>

        {screen === 'start' && (
          <section className="quiz-section">
            <div className="quiz-title-wrap">
              <p className="quiz-eyebrow">
                <span aria-hidden="true">{quiz.emoji}</span>
                Quizzes
              </p>
              <h1 className="quiz-title">{quiz.name}</h1>
              <div className="quiz-underline" aria-hidden="true" />
              <p className="quiz-subtitle">{quiz.intro}</p>
            </div>

            {lengthOptions.length > 1 && (
              <div className="quiz-card">
                <h2>Choose a length</h2>
                <div className="quiz-length-row" role="radiogroup" aria-label="Quiz length">
                  {lengthOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`quiz-length-btn${option.id === selectedLength.id ? ' selected' : ''}`}
                      role="radio"
                      aria-checked={option.id === selectedLength.id}
                      onClick={() => setLengthId(option.id)}
                    >
                      <span className="label">{option.label}</span>
                      <span className="count">{option.total} {itemNoun}</span>
                      <span className="blurb">{option.blurb}</span>
                    </button>
                  ))}
                </div>
                <p className="quiz-hint">
                  A shorter run draws evenly from every part of the quiz rather than dropping any of it, so
                  your result still covers all of it — it just gets less precise.
                </p>
              </div>
            )}

            <div className="quiz-card">
              {quiz.pills?.length > 0 && (
                <>
                  <h2>What to expect</h2>
                  <div className="quiz-pill-grid">
                    {quiz.pills.map((pill) => (
                      <div className="quiz-pill" key={pill.label}>
                        <span className="emoji" aria-hidden="true">{pill.emoji}</span>
                        {pill.label}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {quiz.hint && <p className="quiz-hint">{quiz.hint}</p>}
              <div className="quiz-btn-row">
                <button className="quiz-btn" onClick={startQuiz}>Start Quiz</button>
                {user?._id && (
                  <button className="quiz-btn secondary" type="button" onClick={openHistoryModal}>
                    Quiz History
                  </button>
                )}
              </div>
            </div>

            <p className="quiz-disclaimer">{quiz.disclaimer}</p>

            <div className="quiz-links">
              <Link className="quiz-source-link" to="/quizzes">← All quizzes</Link>
              <a
                className="quiz-source-link"
                href={QUIZ_SOURCE_URL}
                rel="noopener noreferrer"
                target="_blank"
              >
                View Source Code
              </a>
            </div>
          </section>
        )}

        {screen === 'quiz' && activeItem && (
          <section className="quiz-section quiz-section-narrow">
            <div className="quiz-card">
              <div className="quiz-progress-row">
                <span>Question {currentIndex + 1} of {order.length}</span>
                <div className="quiz-progress-track">
                  <div className="quiz-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <span>{formatTime(elapsed)}</span>
              </div>

              {partLabel && <span className="quiz-badge">{partLabel}</span>}

              <div className="quiz-question">{activeItem.text}</div>
              {activeItem.help && <p className="quiz-question-help">{activeItem.help}</p>}

              <div className="quiz-options" role="radiogroup" aria-label="Answer options">
                {(quiz.scale || activeItem.options || []).map((label, idx) => (
                  <button
                    key={label}
                    className={`quiz-option${selected === idx ? ' selected' : ''}`}
                    role="radio"
                    aria-checked={selected === idx}
                    onClick={() => commit(idx)}
                  >
                    <span className="quiz-letter" aria-hidden="true">{LETTERS[idx]}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <div className="quiz-btn-row">
                <button className="quiz-btn secondary" onClick={goBack} disabled={currentIndex === 0}>
                  ← Back
                </button>
                {quiz.allowSkip !== false && (
                  <button className="quiz-btn secondary" onClick={() => commit(null)}>
                    Skip
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {screen === 'results' && result && (
          <section className="quiz-section quiz-section-narrow" aria-live="polite">
            <div className="quiz-title-wrap">
              <h1 className="quiz-title quiz-title-sm">Your Results</h1>
              <div className="quiz-underline" aria-hidden="true" />
            </div>

            <div className="quiz-card">
              <div className="quiz-score-hero">
                <div className={`quiz-score-number${(result.headline || '').length > 2 ? ' quiz-score-number-sm' : ''}`}>
                  {result.headline}
                </div>
                {result.headlineSub && <div className="quiz-score-label">{result.headlineSub}</div>}
              </div>

              {result.summary && <p className="quiz-score-summary">{result.summary}</p>}

              <div className="quiz-stat-grid">
                {(result.stats || []).map((stat) => (
                  <div className="quiz-stat-box" key={stat.lbl}>
                    <div className="val">{stat.val}</div>
                    <div className="lbl">{stat.lbl}</div>
                  </div>
                ))}
                <div className="quiz-stat-box">
                  <div className="val">{formatTime(elapsed)}</div>
                  <div className="lbl">Time Taken</div>
                </div>
              </div>

              {result.bars?.length > 0 && (
                <div className="quiz-traits">
                  <h2>{result.barsTitle || 'Your Profile'}</h2>
                  {result.bars.map((bar) => (
                    <React.Fragment key={bar.label}>
                      <div className="quiz-trait-row">
                        <span className="name">{bar.label}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${Math.max(bar.pct, 0)}%` }} />
                        </div>
                        <span className="count">{bar.pct}%</span>
                      </div>
                      {(bar.caption || bar.note) && (
                        <p className="quiz-trait-note">
                          {bar.caption}
                          {bar.caption && bar.note ? ' · ' : ''}
                          {bar.note}
                        </p>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}

              {result.blocks?.length > 0 && (
                <div className="quiz-blocks">
                  {result.blocks.map((block) => (
                    <div className="quiz-block" key={block.title}>
                      <h3>{block.title}</h3>
                      <p className="body">{block.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {result.note && (
                <p className="quiz-disclaimer quiz-disclaimer-left">{result.note}</p>
              )}

              {order.length < quiz.items.length && (
                <p className="quiz-disclaimer quiz-disclaimer-left">
                  You took the {selectedLength.label.toLowerCase()} version — {order.length} of{' '}
                  {quiz.items.length} {itemNoun}. Every area is still covered and scored the same way,
                  but a shorter quiz is a rougher read than the full set.
                </p>
              )}

              <div className="quiz-btn-row">
                <button className="quiz-btn" onClick={resetToStart}>Take It Again</button>
                <button className="quiz-btn secondary" onClick={() => setShowReview((v) => !v)}>
                  {showReview ? 'Hide Answer Review' : 'Show Answer Review'}
                </button>
                {user?._id && (
                  <button className="quiz-btn secondary" type="button" onClick={openHistoryModal}>
                    Quiz History
                  </button>
                )}
              </div>
            </div>

            {showReview && (
              <div className="quiz-card">
                <h2 style={{ marginTop: 0 }}>Your Answers</h2>
                {responses.map((response, i) => (
                  <div className="quiz-review-item" key={i}>
                    <div className="review-q-row">
                      <p className="review-q">{i + 1}. {response.text}</p>
                      <button
                        type="button"
                        className="quiz-report-btn"
                        onClick={() => openReportModal(i)}
                      >
                        🚩 Report
                      </button>
                    </div>
                    <p className="review-ans">Your answer: <strong>{answerText(response)}</strong></p>
                  </div>
                ))}
              </div>
            )}

            <p className="quiz-disclaimer">{quiz.disclaimer}</p>
          </section>
        )}

        {reportModal && (
          <div className="quiz-modal-overlay" role="presentation" onClick={closeReportModal}>
            <div
              className="quiz-modal quiz-card"
              role="dialog"
              aria-modal="true"
              aria-label="Report question"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ marginTop: 0 }}>Report Question</h2>
              <p className="quiz-modal-question">{responses[reportModal.index]?.text}</p>
              <label className="quiz-modal-label" htmlFor="quiz-report-feedback">
                What&apos;s wrong with this question? (optional)
              </label>
              <textarea
                id="quiz-report-feedback"
                className="quiz-modal-textarea"
                rows={4}
                value={reportModal.feedback}
                onChange={(e) => setReportModal((prev) => (prev ? { ...prev, feedback: e.target.value } : prev))}
                placeholder="e.g. the wording is confusing, a typo, it doesn't apply to me at all, etc."
              />
              <div className="quiz-btn-row">
                <button className="quiz-btn secondary" type="button" onClick={closeReportModal} disabled={reportSubmitting}>
                  Cancel
                </button>
                <button className="quiz-btn" type="button" onClick={submitReport} disabled={reportSubmitting}>
                  {reportSubmitting ? 'Submitting…' : 'Submit Report'}
                </button>
              </div>
            </div>
          </div>
        )}

        {historyOpen && (
          <div className="quiz-modal-overlay" role="presentation" onClick={() => setHistoryOpen(false)}>
            <div
              className="quiz-modal quiz-card"
              role="dialog"
              aria-modal="true"
              aria-label="Quiz history"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ marginTop: 0 }}>Quiz History</h2>
              {historyLoading && <p className="quiz-hint">Loading your past attempts…</p>}
              {!historyLoading && historyError && <p className="quiz-hint">{historyError}</p>}
              {!historyLoading && !historyError && historyEntries.length === 0 && (
                <p className="quiz-hint">No past attempts yet — take the quiz to start your history.</p>
              )}
              {!historyLoading && !historyError && historyEntries.length > 0 && (
                <div className="quiz-history-list">
                  {historyEntries.map((entry) => (
                    <div className="quiz-history-item" key={entry._id}>
                      <div className="quiz-history-main">
                        <span className="quiz-history-score">{entry.Result}</span>
                        {entry.Detail && <span className="quiz-history-detail">{entry.Detail}</span>}
                        {entry.Questions && (
                          <span className="quiz-history-detail">
                            {entry.Questions} {itemNoun}
                          </span>
                        )}
                        <span className="quiz-history-detail">{formatTime(Number(entry.Time) || 0)}</span>
                      </div>
                      <div className="quiz-history-date">
                        {entry.Timestamp ? new Date(entry.Timestamp).toLocaleString() : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="quiz-btn-row">
                <button className="quiz-btn secondary" type="button" onClick={() => setHistoryOpen(false)}>
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

export default QuizPage;
