import { Link, useLocation } from 'react-router-dom';
import { useAddonDetection } from '../../../hooks/simpleAddon/useAddonDetection';
import { SIMPLE_SURFACES } from '../../../constants/simpleSurfaces';
import './SimpleNav.css';

/**
 * SimpleNav — the shared "you are here" switcher for the three product surfaces.
 *
 * Simple is one product with three rooms, and the user must be able to move
 * between them without guessing:
 *
 *   💬 Chat   (/net)     — tell the agent what you want, in words
 *   🎛️ Control(/simple)  — watch it, trust it, change how much it may do
 *   🎯 Goals  (/plans)   — where your intent lives; the durable record
 *
 * It is designed to be rendered INSIDE the site header, which costs no vertical
 * space at all:
 *
 *   <Header center={<SimpleNav compact />} />
 *
 * Stacking it as its own row instead costs ~57px on every page and reads as a
 * second header, so prefer the header slot.
 *
 * @param {object}  props
 * @param {boolean} [props.running]  - an agent run is live (enriches the badge)
 * @param {string}  [props.goalName] - the goal currently being worked
 * @param {boolean} [props.compact]  - render for the site header band: no brand,
 *   no card chrome, tighter spacing.
 */
function SimpleNav({ running = false, goalName = '', compact = false }) {
  const { pathname } = useLocation();
  const { isConnected, addonStatus } = useAddonDetection();

  // `/plans/goal/<slug>` should light up the Goals tab.
  const isActive = (to) => pathname === to || pathname.startsWith(`${to}/`);

  // The three rooms, from the shared list — the same words the closing CTA band
  // shows, so the switcher stays a landmark rather than a fourth thing to learn.
  const links = SIMPLE_SURFACES;

  const statusLabel = !isConnected
    ? 'PC agent offline'
    : running
      ? (goalName ? `Working on ${goalName}` : 'Agent working')
      : `${addonStatus?.version ? `v${addonStatus.version}` : ''}`;

  return (
    <nav className={`snav ${compact ? 'snav--compact' : ''}`} aria-label="Simple surfaces">
      <div className="snav-inner">
        {!compact && <span className="snav-brand" aria-hidden="true">Simple</span>}

        <ul className="snav-links">
          {links.map((l) => (
            <li key={l.to}>
              <Link
                to={l.to}
                className={`snav-link ${isActive(l.to) ? 'is-active' : ''}`}
                aria-current={isActive(l.to) ? 'page' : undefined}
              >
                <span className="snav-link-icon" aria-hidden="true">{l.icon}</span>
                <span className="snav-link-label">{l.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <span
          className={`snav-agent ${isConnected ? (running ? 'is-busy' : 'is-on') : 'is-off'}`}
          title={statusLabel}
        >
          <span className="snav-agent-dot" aria-hidden="true" />
          <span className="snav-agent-text">{statusLabel}</span>
        </span>
      </div>
    </nav>
  );
}

export default SimpleNav;
