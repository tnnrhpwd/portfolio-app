/**
 * GoalReviewPanel.jsx — "Work on my goals" on /simple.
 *
 * One pass over the goal list proposes changes to it: a goal aimed at the wrong
 * horizon, a long-term aim with nothing under it, a goal with nothing to work
 * from, a goal that implies another one. The pass is the backend's (it needs the
 * whole list and a model, not the PC), and it is STORED — so the panel opens on
 * the last review, and re-running it is a deliberate act.
 *
 * Proposing and writing are separate on purpose: staging is free, and one button
 * applies the batch server-side in a single request. That is also what makes
 * "the loop may run a review on its own" safe — a review the user did not ask for
 * can change nothing by itself.
 *
 * The panel also carries the observations the review made (kept as real `lesson`
 * items, the same store the agent's own critic writes to) — so what the pass
 * notices outlives the panel.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  getWorkspaceItem,
  upsertWorkspaceItem,
  generateGoalReviewViaBackend,
  applyGoalReviewViaBackend,
} from '../../../services/workspaceApi.js';
import {
  HORIZON_LABELS,
  isContainerHorizon,
} from '../../../constants/goalHorizons.js';
import {
  groupProposals,
  toggleStaged,
  liveStaged,
  reviewAge,
  horizonChange,
  batchSummary,
  batchSummaryText,
  stagedItems,
  lessonToWorkspaceItem,
} from './goalReviewUtils.js';
import './GoalReviewPanel.css';

const REVIEW_KIND = 'review';
const REVIEW_SLUG = 'goal-review';

/** Parse the stored review out of its workspace item. Bad JSON is "no review". */
function parseStoredReview(item) {
  if (!item?.content) return null;
  try {
    const parsed = JSON.parse(item.content);
    return parsed && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

/** A slug the workspace store will accept, for a kept observation. */
function lessonSlug(text) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `review-${base || 'observation'}`;
}

export default function GoalReviewPanel({ token, goalCount, onGoalsChanged }) {
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [staged, setStaged] = useState(new Set());
  const [error, setError] = useState('');

  // Read what the last pass produced. A missing or unreadable snapshot is an
  // empty state, not an error — the panel's job is then to offer the button.
  useEffect(() => {
    let alive = true;
    if (!token) { setReview(null); setLoading(false); return undefined; }
    setLoading(true);
    getWorkspaceItem(token, REVIEW_KIND, REVIEW_SLUG)
      .then((item) => { if (alive) setReview(parseStoredReview(item)); })
      .catch(() => { if (alive) setReview(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const run = useCallback(async (force = true) => {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await generateGoalReviewViaBackend(token, { force });
      if (res?.review) {
        setReview(res.review);
        setStaged(new Set());
        const n = res.review.items.length;
        toast.success(n
          ? `Reviewed — ${n} change${n === 1 ? '' : 's'} proposed.`
          : 'Reviewed — nothing to change.');
      } else {
        toast.info('There is nothing to review yet — add a goal first.');
      }
    } catch (e) {
      setError(e?.message || 'The review could not be generated.');
    } finally {
      setBusy(false);
    }
  }, [token, busy]);

  const items = review?.items || [];
  const stagedIds = liveStaged(staged, items);
  const ready = stagedItems(items, new Set(stagedIds));
  const summary = batchSummary(ready.map((i) => i.kind));
  const summaryText = batchSummaryText(summary);

  const apply = async () => {
    if (!token || !stagedIds.length || applying) return;
    setApplying(true);
    setError('');
    try {
      const res = await applyGoalReviewViaBackend(token, stagedIds);
      const parts = [];
      if (res?.counts?.goals) parts.push(`${res.counts.goals} goal${res.counts.goals === 1 ? '' : 's'}`);
      if (res?.counts?.plans) parts.push(`${res.counts.plans} plan${res.counts.plans === 1 ? '' : 's'}`);
      toast.success(parts.length ? `Applied — ${parts.join(' and ')} ${res.counts.goals + res.counts.plans === 1 ? 'created' : 'created'}.` : 'Applied.');
      if (res?.review) setReview(res.review);
      setStaged(new Set());
      if (res?.skipped?.length) {
        // Say so rather than pretending the batch was complete.
        toast.info(`${res.skipped.length} change${res.skipped.length === 1 ? '' : 's'} no longer applied — the goals had changed since the review.`);
      }
      onGoalsChanged?.();
    } catch (e) {
      setError(e?.message || 'Could not apply those changes.');
    } finally {
      setApplying(false);
    }
  };

  const keepLesson = async (lesson) => {
    if (!token) return;
    const body = lessonToWorkspaceItem(lesson.text, lessonSlug);
    if (!body) return;
    try {
      await upsertWorkspaceItem(token, 'lesson', body.slug, { name: body.name, content: body.content });
      toast.success('Kept as a lesson — the agent will recall it.');
      setReview((prev) => prev ? { ...prev, lessons: prev.lessons.filter((l) => l.id !== lesson.id) } : prev);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const age = review ? reviewAge(review.generatedAt) : '';
  const sections = groupProposals(items);
  const lessons = review?.lessons || [];

  return (
    <section className="sd-panel sd-panel--wide" aria-label="Work on my goals">
      <header className="sd-panel-head">
        <h2 className="sd-panel-title">🧭 Work on my goals</h2>
        {items.length > 0 && <span className="sd-badge">{items.length}</span>}
        <div className="sd-panel-actions">
          <button
            type="button"
            className="sd-btn sd-btn--primary sd-btn--sm"
            onClick={() => run(true)}
            disabled={busy || !token || !goalCount}
            title={goalCount ? 'Read the goal list and propose changes to it' : 'Add a goal first'}
          >
            {busy ? 'Reading your goals…' : review ? '↻ Review again' : '✨ Work on my goals'}
          </button>
        </div>
      </header>

      <div className="sd-panel-body sd-panel-body--list">
        {loading && <p className="sd-hint">Loading the last review…</p>}

        {!loading && !token && <p className="sd-hint">Sign in to have your goals reviewed.</p>}

        {!loading && token && !goalCount && (
          <p className="sd-hint">
            No goals yet. Add a couple on <Link to="/plans">Goals</Link>, then this
            button will look them over and propose changes.
          </p>
        )}

        {error && <p className="sd-hint sd-hint--error" role="alert">{error}</p>}

        {!loading && token && goalCount > 0 && !review && !busy && (
          <p className="sd-hint">
            Nothing reviewed yet. This reads your goal list once and proposes changes:
            goals aimed at the wrong horizon, long-term aims with no first step, goals
            with nothing to work from, and goals that follow from what you already have.
            Nothing changes until you apply it.
          </p>
        )}

        {review && (
          <>
            <p className="sd-review-meta">
              {age ? `Reviewed ${age}` : 'Reviewed'}
              {review.stats?.totalGoals ? ` · ${review.stats.totalGoals} goals` : ''}
              {review.stats?.truncated ? ` · ${review.stats.truncated} not looked at` : ''}
              {' · nothing changes until you apply it'}
            </p>

            {!items.length && !lessons.length && (
              <p className="sd-hint">
                Nothing to change — your list reads consistently as it stands.
              </p>
            )}

            {sections.map((section) => (
              <div className="sd-review-section" key={section.kind}>
                <h3 className="sd-review-section-title">
                  <span aria-hidden="true">{section.icon}</span> {section.title}
                  <span className="sd-review-section-blurb">{section.blurb}</span>
                </h3>
                <ul className="sd-review-list">
                  {section.items.map((item) => {
                    const isStaged = staged.has(item.id);
                    return (
                      <li key={item.id} className={`sd-review-item${isStaged ? ' is-staged' : ''}`}>
                        <div className="sd-review-item-head">
                          <span className="sd-review-item-title">{item.title}</span>
                          <button
                            type="button"
                            className={`sd-btn sd-btn--sm ${isStaged ? 'sd-btn--ghost' : 'sd-btn--primary'}`}
                            onClick={() => setStaged((prev) => toggleStaged(prev, item.id))}
                            aria-pressed={isStaged}
                          >
                            {isStaged ? '✓ Staged' : 'Stage'}
                          </button>
                        </div>

                        {item.why && <p className="sd-review-why">{item.why}</p>}

                        {item.goalSlug && (
                          <Link className="sd-review-goal" to={`/plans/goal/${encodeURIComponent(item.goalSlug)}`}>
                            {item.goalName || item.goalSlug} →
                          </Link>
                        )}

                        {/* What the change actually IS, before staging it. */}
                        {item.kind === 'horizon' && (
                          <p className="sd-review-patch">
                            {horizonChange(item.patch.from, item.patch.horizon, HORIZON_LABELS)}
                          </p>
                        )}
                        {item.kind === 'split' && (
                          <ul className="sd-review-children">
                            {item.patch.children.map((child, i) => (
                              <li key={`${item.id}-${i}`}>
                                <span className={`sd-review-horizon${isContainerHorizon(child.horizon) ? ' is-long' : ''}`}>
                                  {HORIZON_LABELS[child.horizon] || child.horizon}
                                </span>
                                {child.title}
                              </li>
                            ))}
                          </ul>
                        )}
                        {item.kind === 'plan' && (
                          <ol className="sd-review-steps">
                            {item.patch.steps.map((step, i) => <li key={`${item.id}-${i}`}>{step}</li>)}
                          </ol>
                        )}
                        {item.kind === 'new-goal' && (
                          <p className="sd-review-patch">
                            <span className={`sd-review-horizon${isContainerHorizon(item.patch.horizon) ? ' is-long' : ''}`}>
                              {HORIZON_LABELS[item.patch.horizon] || item.patch.horizon}
                            </span>
                            {item.patch.description}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {lessons.length > 0 && (
              <div className="sd-review-section">
                <h3 className="sd-review-section-title">
                  <span aria-hidden="true">📚</span> What it noticed
                  <span className="sd-review-section-blurb">not a change — keep one and the agent remembers it</span>
                </h3>
                <ul className="sd-review-list">
                  {lessons.map((lesson) => (
                    <li key={lesson.id} className="sd-review-item">
                      <div className="sd-review-item-head">
                        <span className="sd-review-item-title">{lesson.text}</span>
                        <button
                          type="button"
                          className="sd-btn sd-btn--ghost sd-btn--sm"
                          onClick={() => keepLesson(lesson)}
                        >
                          Keep
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {/* The batch: staging is a decision, applying is the act. */}
      {stagedIds.length > 0 && (
        <footer className="sd-review-batch">
          <span className="sd-review-batch-text">
            {summary.count} staged{summaryText ? ` — ${summaryText}` : ''}
          </span>
          <button type="button" className="sd-btn sd-btn--ghost sd-btn--sm" onClick={() => setStaged(new Set())} disabled={applying}>
            Unstage all
          </button>
          <button type="button" className="sd-btn sd-btn--primary sd-btn--sm" onClick={apply} disabled={applying}>
            {applying ? 'Applying…' : `Apply ${summary.count} change${summary.count === 1 ? '' : 's'}`}
          </button>
        </footer>
      )}
    </section>
  );
}
