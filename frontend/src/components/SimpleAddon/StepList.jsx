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
 */

/** Plane badge text. Three planes exist; see NET_HARNESS_PLAN.md §3. */
const PLANE_LABEL = {
  cloud: 'site',
  repo: 'repo',
  addon: 'PC',
};

const GLYPH = {
  running: '•',
  ok: '✓',
  error: '✕',
  denied: '⊘',
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

export default function StepList({ steps }) {
  const [openIds, setOpenIds] = useState(() => new Set());

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
      <div className="steps__summary">{summarise(steps)}</div>
      <ol className="steps__list">
        {steps.map((step) => {
          const isOpen = openIds.has(step.id);
          const detailId = `step-detail-${step.id}`;
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
                {step.plane && step.plane !== 'cloud' && (
                  <span className={`steps__plane steps__plane--${step.plane}`}>
                    {PLANE_LABEL[step.plane] || step.plane}
                  </span>
                )}
                {step.ms != null && <span className="steps__ms">{formatMs(step.ms)}</span>}
              </button>

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
