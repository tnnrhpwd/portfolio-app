import React from 'react';
import { Link } from 'react-router-dom';
import './PurchaseGateNotice.css';

/**
 * PurchaseGateNotice — the ONE way this site says "upgrading is paused right now".
 *
 * The gate itself is deliberate: we don't take money until the readiness bar is
 * met (docs/implementation/agent.md §12), and the admin controls it per
 * environment (`backend/controllers/purchaseGateController.js`).
 *
 * The bug this component exists to prevent is what the gate *looks like* when it
 * is on. A gate that only hides or disables the upgrade control is a dead end: a
 * Free user who is over their storage limit, or who came to `/pricing` on
 * purpose, is left with nothing to click and no explanation — and the notice on
 * `/pricing` used to carry no way to ask about it either. So every gated surface
 * renders this instead: the admin's message (or the default), plus one route out
 * to a human. §16.5 rule 6 — never hard-block without a way out.
 *
 * One component, because three hand-written notice variants is how one of them
 * ends up without the link again.
 *
 * @param {object}  props
 * @param {string}  [props.message]          the admin's gate copy
 * @param {boolean} [props.compact]          inline shape for inside a warning box
 * @param {boolean} [props.showSupportLink]  set false for a purely informational
 *   surface that already offers a way out
 * @param {string}  [props.className]        layout tweaks from the call site only
 */
export const DEFAULT_GATE_MESSAGE = 'Upgrading is temporarily paused. Please check back soon.';

/** Where "I want to pay you and I can't" goes. */
export const GATE_SUPPORT_PATH = '/support?tab=contact';

export default function PurchaseGateNotice({
  message,
  compact = false,
  showSupportLink = true,
  className = '',
}) {
  return (
    <div className={`gate-notice ${compact ? 'gate-notice--compact' : ''} ${className}`.trim()} role="status">
      <span className="gate-notice__text">{message || DEFAULT_GATE_MESSAGE}</span>
      {showSupportLink && (
        <Link className="gate-notice__link" to={GATE_SUPPORT_PATH}>
          Ask us about Pro <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
