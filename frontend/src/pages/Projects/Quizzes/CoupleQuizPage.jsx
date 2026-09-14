import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import { shuffle, formatTime, compareResponses, selectItemIndices } from './quizEngine';
import { QUIZ_SOURCE_URL } from './meta';
import './QuizPage.css';
import './CoupleQuizPage.css';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const ADVANCE_MS = 180;

/**
 * The two-person quiz flow, in two flavours.
 *
 * `mode: 'compare'` (Values Alignment) — both partners answer the same scored
 * items, one after the other, then the answers are compared item by item.
 *
 * `mode: 'prompt'` (36 Questions) — nothing is scored. The questions are read
 * aloud and answered out loud, and the only thing recorded is each partner's
 * private closeness rating at the end.
 *
 * Both share the handoff screen, which exists so the second partner never sees
 * the first partner's answers while they are answering — that anchoring is the
 * whole reason the answers are collected in turn rather than side by side.
 *
 * Deliberately does NOT write to quiz history: a record would put one partner's
 * answers in the other's account, and a comparison is about a sitting, not a
 * score to track over time.
 *
 * @param {{quiz: object}} props
 */
function CoupleQuizPage({ quiz }) {
  const isPrompt = quiz.mode === 'prompt';
  const scaleMax = Math.max(((quiz.scale?.length ?? 2) - 1), 1);

  // Length presets, shared with the single-person page's picker.
  const lengthOptions = Object.entries(quiz.lengths || {}).map(([id, preset]) => ({
    id,
    ...preset,
    total: preset.count ?? quiz.items.length,
  }));
  const [lengthId, setLengthId] = useState(quiz.defaultLength || 'standard');
  const selectedLength = lengthOptions.find((option) => option.id === lengthId)
    || { id: 'full', label: 'Full', count: null, total: quiz.items.length, blurb: '' };
  const itemNoun = isPrompt ? 'questions' : 'statements';

  const [screen, setScreen] = useState('start'); // start | quiz | handoff | rate | result
  const [partner, setPartner] = useState('a');
  const [pending, setPending] = useState(null); // { screen, partner } to resume after a handoff
  const [order, setOrder] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answersA, setAnswersA] = useState([]);
  const [answersB, setAnswersB] = useState([]);
  const [ratingA, setRatingA] = useState(null);
  const [ratingB, setRatingB] = useState(null);
  const [names, setNames] = useState({ a: '', b: '' });
  const [elapsed, setElapsed] = useState(0);

  const timerRef = useRef(null);
  const advanceRef = useRef(null);
  const startTimeRef = useRef(null);

  const nameOf = useCallback(
    (which) => (names[which] || '').trim() || (which === 'a' ? 'Partner A' : 'Partner B'),
    [names]
  );

  const stopTimers = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (advanceRef.current) clearTimeout(advanceRef.current);
    advanceRef.current = null;
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  const start = useCallback(() => {
    const positions = selectItemIndices(quiz.items, selectedLength.count);
    // In prompt mode the order IS the content — the sets escalate, so shuffling
    // them would destroy the structure the exercise depends on. Compare mode is
    // free to shuffle, because both partners get the same order either way.
    setOrder(isPrompt || quiz.shuffle === false ? positions : shuffle(positions));
    setAnswersA([]);
    setAnswersB([]);
    setRatingA(null);
    setRatingB(null);
    setCurrentIndex(0);
    setSelected(null);
    setPartner('a');
    setElapsed(0);
    startTimeRef.current = Date.now();

    stopTimers();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    setScreen('quiz');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [isPrompt, quiz.items, quiz.shuffle, selectedLength.count, stopTimers]);

  const reset = useCallback(() => {
    stopTimers();
    setScreen('start');
    setOrder([]);
    setElapsed(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [stopTimers]);

  /** Moves to the next screen, pausing at a handoff when the other partner is up. */
  const goTo = useCallback((nextScreen, nextPartner, reason) => {
    setPending({ screen: nextScreen, partner: nextPartner, reason });
    setScreen(nextScreen === 'result' ? 'result' : 'handoff');
    if (nextScreen === 'result') {
      stopTimers();
    } else {
      setPartner(nextPartner);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [stopTimers]);

  const confirmHandoff = useCallback(() => {
    setScreen(pending?.screen || 'quiz');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pending]);

  // ---- Scored runs (compare mode) ----
  const answers = partner === 'a' ? answersA : answersB;
  const setAnswers = partner === 'a' ? setAnswersA : setAnswersB;

  const commit = useCallback((value) => {
    const next = answers.slice();
    next[currentIndex] = value;
    setAnswers(next);
    setSelected(value);

    if (advanceRef.current) clearTimeout(advanceRef.current);
    advanceRef.current = setTimeout(() => {
      advanceRef.current = null;
      if (currentIndex < order.length - 1) {
        setCurrentIndex((i) => i + 1);
        setSelected(null);
        return;
      }
      // First partner has finished their pass: hand the device over and run
      // the same questions again for the second partner. Only the second
      // partner's final answer produces a result.
      if (partner === 'a') {
        setCurrentIndex(0);
        setSelected(null);
        goTo('quiz', 'b', 'quiz');
      } else {
        goTo('result', 'b');
      }
    }, value === null ? 0 : ADVANCE_MS);
  }, [answers, currentIndex, goTo, order.length, partner, setAnswers]);

  const goBack = useCallback(() => {
    if (advanceRef.current) {
      clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }
    if (currentIndex === 0) return;
    const prev = currentIndex - 1;
    setAnswers((prevAnswers) => prevAnswers.slice(0, prev));
    setCurrentIndex(prev);
    setSelected(answers[prev] ?? null);
  }, [answers, currentIndex, setAnswers]);

  // ---- Prompt run (prompt mode) ----
  const nextPrompt = useCallback(() => {
    if (currentIndex >= order.length - 1) {
      goTo('rate', 'a', 'rate');
    } else {
      setCurrentIndex((i) => i + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentIndex, goTo, order.length]);

  const prevPrompt = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const submitRating = useCallback((value) => {
    if (partner === 'a') {
      setRatingA(value);
      goTo('rate', 'b', 'rate');
    } else {
      setRatingB(value);
      stopTimers();
      setScreen('result');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [goTo, partner, stopTimers]);

  // ---- Derived ----
  const responsesA = useMemo(() => order.map((itemIndex, pos) => ({
    ...quiz.items[itemIndex], value: answersA[pos] ?? null,
  })), [order, answersA, quiz.items]);

  const responsesB = useMemo(() => order.map((itemIndex, pos) => ({
    ...quiz.items[itemIndex], value: answersB[pos] ?? null,
  })), [order, answersB, quiz.items]);

  const comparison = useMemo(
    () => (isPrompt ? null : compareResponses(responsesA, responsesB, scaleMax)),
    [isPrompt, responsesA, responsesB, scaleMax]
  );

  const ctx = useMemo(() => ({
    names: { a: nameOf('a'), b: nameOf('b') },
    scale: quiz.scale || [],
  }), [nameOf, quiz.scale]);

  const result = useMemo(() => {
    if (screen !== 'result') return null;
    if (isPrompt) return quiz.formatSession({ ...ctx, ratings: { a: ratingA, b: ratingB } });
    return quiz.formatComparison(comparison, ctx);
  }, [screen, isPrompt, quiz, comparison, ctx, ratingA, ratingB]);

  const activeItem = order.length > 0 ? quiz.items[order[currentIndex]] : null;
  const progressPct = order.length ? Math.round((currentIndex / order.length) * 100) : 0;
  const bothNamed = Boolean((names.a || '').trim() || (names.b || '').trim());

  const answerLabel = (value) => (value === null || value === undefined
    ? 'Skipped'
    : (quiz.scale?.[value] ?? `Option ${value + 1}`));

  return (
    <>
      <SEO title={quiz.seoTitle || quiz.name} description={quiz.seoDescription} path={quiz.path} />
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
                Quizzes · For two
              </p>
              <h1 className="quiz-title">{quiz.name}</h1>
              <div className="quiz-underline" aria-hidden="true" />
              <p className="quiz-subtitle">{quiz.intro}</p>
            </div>

            <div className="quiz-card">
              <h2>Who&apos;s taking part?</h2>
              <p className="quiz-hint">
                Optional, but everything below reads a lot better with real names in it. Nothing leaves
                the two of you — no answers are saved to either account.
              </p>
              <div className="quiz-duo-names">
                <label className="quiz-duo-field">
                  <span>First partner</span>
                  <input
                    className="quiz-duo-input"
                    type="text"
                    maxLength={24}
                    placeholder="Partner A"
                    value={names.a}
                    onChange={(e) => setNames((n) => ({ ...n, a: e.target.value }))}
                  />
                </label>
                <label className="quiz-duo-field">
                  <span>Second partner</span>
                  <input
                    className="quiz-duo-input"
                    type="text"
                    maxLength={24}
                    placeholder="Partner B"
                    value={names.b}
                    onChange={(e) => setNames((n) => ({ ...n, b: e.target.value }))}
                  />
                </label>
              </div>
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
                  <h2>How it works</h2>
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
                <button className="quiz-btn" onClick={start}>
                  {isPrompt ? 'Begin' : `Start with ${nameOf('a')}`}
                </button>
              </div>
            </div>

            <p className="quiz-disclaimer">{quiz.disclaimer}</p>

            <div className="quiz-links">
              <Link className="quiz-source-link" to="/quizzes">← All quizzes</Link>
              <a className="quiz-source-link" href={QUIZ_SOURCE_URL} rel="noopener noreferrer" target="_blank">
                View Source Code
              </a>
            </div>
          </section>
        )}

        {screen === 'quiz' && activeItem && !isPrompt && (
          <section className="quiz-section quiz-section-narrow">
            <div className="quiz-card">
              <div className="quiz-progress-row">
                <span>{nameOf(partner)} · Question {currentIndex + 1} of {order.length}</span>
                <div className="quiz-progress-track">
                  <div className="quiz-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <span>{formatTime(elapsed)}</span>
              </div>

              <span className="quiz-badge">
                {partner === 'a' ? nameOf('a') : nameOf('b')} answering
              </span>

              <div className="quiz-question">{activeItem.text}</div>
              {activeItem.help && <p className="quiz-question-help">{activeItem.help}</p>}

              <div className="quiz-options" role="radiogroup" aria-label="Answer options">
                {(quiz.scale || []).map((label, idx) => (
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
                <button className="quiz-btn secondary" onClick={() => commit(null)}>Skip</button>
              </div>
            </div>
          </section>
        )}

        {screen === 'quiz' && activeItem && isPrompt && (
          <section className="quiz-section quiz-section-narrow">
            <div className="quiz-card">
              <div className="quiz-progress-row">
                <span>Question {currentIndex + 1} of {order.length}</span>
                <div className="quiz-progress-track">
                  <div className="quiz-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <span>{formatTime(elapsed)}</span>
              </div>

              <span className="quiz-badge">{activeItem.setLabel || `Set ${activeItem.set}`}</span>

              <div className="quiz-question quiz-duo-prompt">{activeItem.text}</div>
              <p className="quiz-question-help">
                {bothNamed ? `${nameOf('a')} and ${nameOf('b')} answer this one out loud, then move on.` : 'Answer this one out loud together, then move on.'}
                {' '}Nothing is recorded — take as long as it needs.
              </p>

              <div className="quiz-btn-row">
                <button className="quiz-btn secondary" onClick={prevPrompt} disabled={currentIndex === 0}>
                  ← Back
                </button>
                <button className="quiz-btn" onClick={nextPrompt}>
                  {currentIndex >= order.length - 1 ? 'Finish →' : 'Next →'}
                </button>
              </div>
            </div>
          </section>
        )}

        {screen === 'handoff' && (
          <section className="quiz-section quiz-section-narrow">
            <div className="quiz-card quiz-duo-handoff">
              <div className="quiz-duo-handoff-icon" aria-hidden="true">🔁</div>
              <h2>
                {pending?.reason === 'rate'
                  ? `${nameOf(pending?.partner)} — your rating, on your own`
                  : `Pass the device to ${nameOf(pending?.partner)}`}
              </h2>
              <p className="quiz-hint">
                {isPrompt
                  ? 'These next answers are better given privately, so the two of you don\u2019t anchor each other.'
                  : `The other set of answers is hidden until you have finished, so ${nameOf('a')} and ${nameOf('b')} each answer without seeing the other\u2019s.`}
              </p>
              <div className="quiz-btn-row">
                <button className="quiz-btn" onClick={confirmHandoff}>
                  I&apos;m {nameOf(pending?.partner)} — continue
                </button>
              </div>
            </div>
          </section>
        )}

        {screen === 'rate' && (
          <section className="quiz-section quiz-section-narrow">
            <div className="quiz-card">
              <span className="quiz-badge">{nameOf(partner)} answering</span>
              <div className="quiz-question">{quiz.closeness?.question}</div>
              <div className="quiz-duo-rating" role="radiogroup" aria-label="Closeness rating">
                {(quiz.closeness?.scale || []).map((step) => (
                  <button
                    key={step.value}
                    className={`quiz-duo-rating-btn${(partner === 'a' ? ratingA : ratingB) === step.value ? ' selected' : ''}`}
                    role="radio"
                    aria-checked={(partner === 'a' ? ratingA : ratingB) === step.value}
                    onClick={() => submitRating(step.value)}
                  >
                    <span className="num">{step.value}</span>
                    <span className="lbl">{step.label}</span>
                  </button>
                ))}
              </div>
              <p className="quiz-hint">
                {quiz.closeness?.note}
              </p>
            </div>
          </section>
        )}

        {screen === 'result' && result && (
          <section className="quiz-section quiz-section-narrow" aria-live="polite">
            <div className="quiz-title-wrap">
              <h1 className="quiz-title quiz-title-sm">
                {isPrompt ? 'Your Evening, Compared' : 'Your Alignment'}
              </h1>
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

              {result.stats?.length > 0 && (
                <div className="quiz-stat-grid">
                  {result.stats.map((stat) => (
                    <div className="quiz-stat-box" key={stat.lbl}>
                      <div className="val">{stat.val}</div>
                      <div className="lbl">{stat.lbl}</div>
                    </div>
                  ))}
                  <div className="quiz-stat-box">
                    <div className="val">{formatTime(elapsed)}</div>
                    <div className="lbl">{isPrompt ? 'Time Together' : 'Time Taken'}</div>
                  </div>
                </div>
              )}

              {result.bars?.length > 0 && (
                <div className="quiz-traits">
                  <h2>{result.barsTitle || 'By Area'}</h2>
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
                          {bar.caption}{bar.caption && bar.note ? ' · ' : ''}{bar.note}
                        </p>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}

              {result.gaps?.length > 0 && (
                <div className="quiz-duo-gaps">
                  <h2>{result.gapsTitle || 'Where You Differ'}</h2>
                  {result.gaps.map((gap) => (
                    <div className="quiz-duo-gap" key={gap.text}>
                      <p className="q">{gap.text}</p>
                      <div className="quiz-duo-pair">
                        <span className="who">
                          <strong>{nameOf('a')}</strong>{gap.aLabel}
                        </span>
                        <span className="who">
                          <strong>{nameOf('b')}</strong>{gap.bLabel}
                        </span>
                      </div>
                      {gap.prompt && <p className="prompt">{gap.prompt}</p>}
                    </div>
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

              {result.note && <p className="quiz-disclaimer quiz-disclaimer-left">{result.note}</p>}

              {order.length < quiz.items.length && (
                <p className="quiz-disclaimer quiz-disclaimer-left">
                  {isPrompt
                    ? `You worked through ${order.length} of ${quiz.items.length} questions. Fewer from each set keeps the arc from light to vulnerable, but a question that lands differently without the ones around it is the price.`
                    : `You each answered the ${selectedLength.label.toLowerCase()} set — ${order.length} of ${quiz.items.length} statements. Every area is still compared the same way, but a shorter set is a rougher read.`}
                </p>
              )}

              <div className="quiz-btn-row">
                <button className="quiz-btn" onClick={reset}>
                  {isPrompt ? 'Run It Again' : 'Take It Again'}
                </button>
              </div>
            </div>

            {isPrompt && (
              <div className="quiz-card">
                <h2 style={{ marginTop: 0 }}>All {quiz.items.length} Questions</h2>
                <p className="quiz-hint">
                  Worth keeping — the order matters, so the later ones land differently once the earlier
                  ones have been answered. Come back to a set at a time rather than all at once.
                </p>
                {(quiz.sets || []).map((set) => (
                  <div className="quiz-duo-set" key={set.key}>
                    <h3>{set.name}</h3>
                    <p className="quiz-hint">{set.blurb}</p>
                    <ol className="quiz-duo-questions">
                      {quiz.items.filter((item) => item.set === set.key).map((item) => (
                        <li key={item.text}>{item.text}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}

            <p className="quiz-disclaimer">{quiz.disclaimer}</p>
          </section>
        )}
      </div>
      <Footer />
    </>
  );
}

export default CoupleQuizPage;
