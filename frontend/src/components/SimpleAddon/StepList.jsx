import React, { useState } from 'react';
import './StepList.css';

/**
 * StepList — what the agent actually DID, one row per tool call.
 *
 * Before this the only trace of a tool-heavy turn was `progressNote`: a single
 * line the client OVERWRITES as each tool runs, so by the time the answer
 * arrived the user had seen "Reading Net.jsx…" for a moment and nothing else.
 * Nothing survived the turn, and a failure was invisible.
 *
 * The rows come from the backend journal (`backend/services/harness/stepJournal.js`),
 * which emits a step twice — once when it opens (`running`) and once when it
 * closes (`ok` / `error`) — so a row is UPDATED, not appended twice.
 *
 * What a row may show is decided server-side, not here: a tool whose arguments
 * are the user's private writing arrives with `argsPreview: null` and
 * `argsRedacted: true`, and this component says "private argument" rather than
 * rendering anything. Do not add a fallback that reads the arguments some other
 * way — that would undo a deliberate rule for a cosmetic gain.
 *
 * The same holds for the "Try again" affordance on a refused step. Whether a
 * retry is offered is `step.reaskable`, which the journal computes from the
 * refusal vocabulary (`backend/services/harness/refusalCause.js`) — NOT from
 * guessing here. A policy denial and the emergency kill switch are not re-askable,
 * because they would refuse identically; only a human's "no" or a prompt nobody
 * answered can go differently the second time.
 */

/** Plane badge text. Three planes exist; see NET_HARNESS_PLAN.md §3. */
const PLANE_LABEL = {
  cloud: 'site',
  repo: 'repo',
  addon: 'PC',
};

/** Monotonic, so two lists on screen never share an id (see `listId`). */
let listSeq = 0;

const GLYPH = {
  running: '•',
  ok: '✓',
  error: '✕',
  denied: '⊘',
};

/**
 * Why a step failed, in the user's words (see backend services/harness/toolOutcome.js).
 * The kind decides what the agent does next, so showing it is what lets a user
 * understand a failure instead of just seeing a red row.
 */
const OUTCOME_LABEL = {
  transient: 'temporary failure',
  'invalid-input': 'the arguments were wrong',
  'not-found': 'that does not exist',
  permission: 'refused by policy',
  fatal: 'failed',
};

function formatMs(ms) {
  if (ms == null) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Human summary of a finished run: "6 steps · 1 not approved · 2.4s". */
function summarise(steps) {
  const done = steps.filter((s) => s.status !== 'running');
  const failed = steps.filter((s) => s.status === 'error');
  const denied = steps.filter((s) => s.status === 'denied');
  const totalMs = done.reduce((sum, s) => sum + (s.ms || 0), 0);
  const parts = [`${steps.length} step${steps.length === 1 ? '' : 's'}`];
  if (failed.length) parts.push(`${failed.length} failed`);
  if (denied.length) parts.push(`${denied.length} not approved`);
  if (totalMs) parts.push(formatMs(totalMs));
  return parts.join(' · ');
}

export default function StepList({ steps, onRetryStep }) {
  const [openIds, setOpenIds] = useState(() => new Set());
  // The LIST folds as well as each row. It opens by default — the point of the
  // list is that the user can SEE what ran, and a run in flight should show its
  // rows as they arrive — so this is an affordance for folding a long turn away
  // afterwards, not a drawer that hides the work.
  const [collapsed, setCollapsed] = useState(false);
  // Per-INSTANCE, because two lists can be on screen at once (a live one in the
  // working bubble and a finished one in the message above it) and a duplicate
  // id would point `aria-controls` at the wrong list.
  const [listId] = useState(() => `steps-list-${(listSeq += 1)}`);

  if (!Array.isArray(steps) || steps.length === 0) return null;

  const toggle = (id) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="steps" aria-label="Agent steps">
      <button
        type="button"
        className="steps__summary steps__summary--toggle"
        aria-expanded={!collapsed}
        aria-controls={listId}
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <span className="steps__caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        {summarise(steps)}
      </button>
      {/* `hidden` needs the guard below it in the stylesheet: any class rule that
          sets `display` beats the UA sheet's `[hidden] { display: none }`. */}
      <ol className="steps__list" id={listId} hidden={collapsed}>
        {steps.map((step) => {
          const isOpen = openIds.has(step.id);
          const detailId = `step-detail-${step.id}`;
          // The ONE thing the user can do about a refusal. Offered only when the
          // server says this refusal could be answered differently next time
          // (`step.reaskable`) AND a turn is not already running. A policy denial
          // and the kill switch never get one: they would refuse identically, and
          // a button that cannot work is worse than no button.
          const canRetry = step.reaskable === true && typeof onRetryStep === 'function';
          return (
            <li key={step.id} className={`steps__item steps__item--${step.status}`}>
              <button
                type="button"
                className="steps__row"
                aria-expanded={isOpen}
                aria-controls={detailId}
                onClick={() => toggle(step.id)}
              >
                <span className="steps__glyph" aria-hidden="true">{GLYPH[step.status] || '•'}</span>
                <span className="steps__label">{step.label || step.tool}</span>
                {/* A step that took two attempts is still one step. Marking it is
                    the difference between "the agent is flaky" and "the network
                    hiccuped once and the agent handled it". */}
                {step.retried && (
                  <span
                    className="steps__plane steps__plane--retry"
                    title="The first attempt failed transiently and the agent retried it"
                  >
                    ↻ retried
                  </span>
                )}
                {step.plane && step.plane !== 'cloud' && (
                  <span className={`steps__plane steps__plane--${step.plane}`}>
                    {PLANE_LABEL[step.plane] || step.plane}
                  </span>
                )}
                {step.ms != null && <span className="steps__ms">{formatMs(step.ms)}</span>}
              </button>

              {/* Sibling of the row, never a child: the row is itself a <button>
                  (it expands the detail), and a nested button is invalid HTML that
                  browsers silently re-parent. */}
              {canRetry && (
                <button
                  type="button"
                  className="steps__retry"
                  onClick={() => onRetryStep(step)}
                  title="Ask your PC again — you will get the approval prompt again, and you can still say no"
                >
                  Try again
                </button>
              )}
              {isOpen && (
                <div className="steps__detail" id={detailId}>
                  <div className="steps__detail-tool">{step.tool}</div>
                  {step.argsRedacted ? (
                    <div className="steps__detail-private">
                      private argument{(step.argKeys || []).length ? ` (${step.argKeys.join(', ')})` : ''} — not recorded
                    </div>
                  ) : step.argsPreview && Object.keys(step.argsPreview).length > 0 ? (
                    <pre className="steps__detail-args">{JSON.stringify(step.argsPreview, null, 2)}</pre>
                  ) : null}
                  {step.error && <div className="steps__detail-error">{step.error}</div>}
                  {step.outcome && (
                    <div className="steps__detail-error">
                      {OUTCOME_LABEL[step.outcome] || step.outcome}
                    </div>
                  )}
                  {step.resultPreview && (
                    <pre className="steps__detail-result">{step.resultPreview}</pre>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
