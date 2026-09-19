import React from 'react';
import './PlanChecklist.css';

/**
 * PlanChecklist — what the agent says it is DOING, above the list of what it did.
 *
 * The step list (StepList.jsx) answers "what happened?". This answers the question
 * a user actually asks while a turn is running, and the only one that lets them
 * correct it before it finishes: *where is it, and is that the right order?* A
 * 16-round repo turn with no plan is a spinner; with a plan it is a checklist you
 * can interrupt.
 *
 * The plan comes from the backend (`harness/planSurface.js`) as an already-validated
 * list — normalisation, bounds and the one-in-progress rule are all decided there,
 * so this component renders what it is given and invents nothing. In particular it
 * does NOT pick which step is current: if two arrived marked, the server has already
 * chosen, and a second opinion here would disagree with the record.
 */

/** Status → glyph. `in_progress` is the one the user is watching, so it is the
 *  only animated one. */
const GLYPH = {
  done: '✓',
  in_progress: '▸',
  blocked: '⊘',
  pending: '·',
};

const STATUS_LABEL = {
  done: 'done',
  in_progress: 'in progress',
  blocked: 'blocked',
  pending: 'pending',
};

/** "3 steps · 1 done · working on: raise the limit" */
function summarise(plan) {
  const items = plan.items || [];
  const counts = plan.counts || {};
  const current = items.find((i) => i.status === 'in_progress');
  const parts = [`${items.length} step${items.length === 1 ? '' : 's'}`];
  if (counts.done) parts.push(`${counts.done} done`);
  if (counts.blocked) parts.push(`${counts.blocked} blocked`);
  if (current) parts.push(`working on: ${current.text}`);
  else if (counts.done === items.length && items.length) parts.push('all done');
  return parts.join(' · ');
}

export default function PlanChecklist({ plan }) {
  if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) return null;

  return (
    <div className="plan" aria-label="Agent plan">
      <div className="plan__summary">{summarise(plan)}</div>
      <ol className="plan__list">
        {plan.items.map((item) => (
          <li
            key={item.id || item.text}
            className={`plan__item plan__item--${item.status}`}
            // The status is already in the glyph and the summary; this is for
            // screen readers, which do not get a strikethrough as a meaning.
            aria-label={`${STATUS_LABEL[item.status] || item.status}: ${item.text}`}
          >
            <span className="plan__glyph" aria-hidden="true">{GLYPH[item.status] || '·'}</span>
            <span className="plan__text">{item.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
