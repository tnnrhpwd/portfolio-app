import './AgentModes.css';

/**
 * AgentModes — the four trust modes from the platform plan (§3.1).
 *
 * The product promise is "a second set of eyes and hands on your machine" that
 * only escalates as far as the user trusts it. Until now the four modes existed
 * only in the design doc and were unreachable from the UI; this surfaces them as
 * the primary control on /simple.
 *
 * The current mode is *derived* from the live permission state (never stored
 * separately), so the UI can't drift from what the addon is actually allowed to
 * do:
 *
 *   continuousMode (listener) + autoApproveAll  → Autopilot
 *   continuousMode (listener) only              → Suggest
 *   neither                                     → Assist (the default)
 *   globalKillSwitch                            → Paused (overrides everything)
 *
 * Watch is shown for completeness but is not selectable here: read-only
 * monitoring is a per-monitor posture, not a global permission, so offering a
 * toggle that doesn't enforce anything would be dishonest.
 */

const MODES = [
  {
    key: 'watch',
    icon: '👁️',
    label: 'Watch',
    blurb: 'Observes and reports — never acts.',
    detail: 'Read-only by design. Used by monitors like “tell me when the printer dialog appears.”',
    selectable: false,
  },
  {
    key: 'suggest',
    icon: '💡',
    label: 'Suggest',
    blurb: 'Notices repeated work and offers to automate it.',
    detail: 'It watches your patterns and asks. Nothing runs until you say yes.',
    set: { continuousMode: true, autoApproveAll: false },
    selectable: true,
  },
  {
    key: 'assist',
    icon: '🤝',
    label: 'Assist',
    blurb: 'Does it when you ask, checking with you as it goes.',
    detail: 'The default. Start a goal or skill yourself; every risky step asks first.',
    set: { continuousMode: false, autoApproveAll: false },
    selectable: true,
  },
  {
    key: 'autopilot',
    icon: '🚀',
    label: 'Autopilot',
    blurb: 'Runs approved automations unattended.',
    detail: 'Highest trust level. Only skills you explicitly opted in can run; the kill switch always stops it.',
    set: { continuousMode: true, autoApproveAll: true },
    selectable: true,
    elevated: true,
  },
];

/** Which rung the live permission state corresponds to. */
export function currentMode(perms) {
  if (perms?.globalKillSwitch) return 'paused';
  if (perms?.continuousMode && perms?.autoApproveAll) return 'autopilot';
  if (perms?.continuousMode) return 'suggest';
  return 'assist';
}

function AgentModes({ perms = {}, connected = false, busy = false, onChange }) {
  const mode = currentMode(perms);
  const paused = mode === 'paused';

  return (
    <section className="modes" aria-labelledby="modes-title">
      <div className="modes-head">
        <h2 id="modes-title" className="modes-title">How much should Simple do on its own?</h2>
        <p className="modes-sub">
          It only ever escalates as far as you allow. Moving up a level is always
          your choice — never automatic.
        </p>
      </div>

      {paused && (
        <p className="modes-paused" role="status">
          ⛔ <strong>Kill switch is on.</strong> Nothing can run until you turn it off.
        </p>
      )}

      <ul className="modes-ladder" role="radiogroup" aria-label="Agent mode">
        {MODES.map((m) => {
          const isCurrent = m.key === mode;
          const canSelect = m.selectable && connected && !busy && !isCurrent;
          return (
            <li key={m.key}>
              <div
                className={`modes-card ${isCurrent ? 'is-current' : ''} ${m.elevated ? 'is-elevated' : ''}`}
              >
                <div className="modes-card-head">
                  <span className="modes-icon" aria-hidden="true">{m.icon}</span>
                  <span className="modes-label">{m.label}</span>
                  {isCurrent && <span className="modes-here" aria-hidden="true">You’re here</span>}
                </div>
                <p className="modes-blurb">{m.blurb}</p>
                <p className="modes-detail">{m.detail}</p>

                {canSelect ? (
                  <button
                    type="button"
                    className={`modes-btn ${m.elevated ? 'modes-btn--elevated' : ''}`}
                    onClick={() => onChange?.(m.set)}
                    disabled={busy}
                  >
                    Switch to {m.label}
                    {m.elevated && <span className="modes-btn-warn" aria-hidden="true">▲</span>}
                  </button>
                ) : (
                  <span className="modes-state" role="radio" aria-checked={isCurrent} aria-disabled={!m.selectable}>
                    {isCurrent
                      ? 'Active'
                      : m.selectable
                        ? (connected ? 'Available' : 'Needs the PC agent')
                        : 'Read-only'}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {perms.autoApproveAll && !paused && (
        <p className="modes-note" role="status">
          ⚠️ Auto-approve is on, so steps that would normally ask you will run without asking.
        </p>
      )}
    </section>
  );
}

export default AgentModes;
