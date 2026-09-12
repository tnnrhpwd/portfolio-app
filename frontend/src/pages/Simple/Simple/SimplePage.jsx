import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import SEO from '../../../components/SEO/SEO.jsx';
import SimpleNav from '../../../components/Simple/SimpleNav/SimpleNav.jsx';
import SimpleDashboard from './SimpleDashboard';
import LoginGate from '../../../components/Simple/LoginGate/LoginGate.jsx';
import './SimplePage.css';

/**
 * /simple — Control. The "watch it and trust it" half of the product.
 *
 * The three Simple surfaces are one journey, not three pages:
 *   /net    Chat    — say what you want
 *   /simple Control — watch it work, decide how far it may go   ← this page
 *   /plans  Goals   — the durable record of your intent
 *
 * **This is a service page, not a landing page** — FRONTEND_UI_STANDARD.md §5.7.
 * Service pages are workspaces, not stories: one flat surface, no bands, no
 * gradient behind the data, and nothing to scroll past to reach the tool.
 * Signed in, `SimpleDashboard` owns the whole workspace (it holds the addon
 * state); signed out, this is a gate — the one case that gets a little
 * explanation, because there is nothing else on the page yet.
 */

const JOURNEY = [
  {
    icon: '💬',
    title: 'Say what you want',
    body: 'Describe the job in plain English — or just show it once. No scripting, no macros.',
    to: '/net',
    cta: 'Open chat',
  },
  {
    icon: '🎛️',
    title: 'Watch it work',
    body: 'See each step as it happens, approve what you want, and stop it any time.',
    to: '/simple',
    cta: 'You are here',
    current: true,
  },
  {
    icon: '🎯',
    title: 'Keep what it learns',
    body: 'Every goal, plan, action and lesson is saved, so next time is one click.',
    to: '/plans',
    cta: 'See your goals',
  },
];

function SimplePage() {
  const { user } = useSelector((state) => state.data);
  return (
    <>
      <SEO
        title="Simple"
        description="Control your Simple AI agent: watch every step it takes, decide how much it may do on its own, and stop it any time."
        path="/simple"
      />
      <Header center={<SimpleNav compact />} />

      <div className="simple-surface">
        {user ? (
          <SimpleDashboard />
        ) : (
          <div className="simple-intro">
            {/* The one place this page explains itself: there is no tool on
                screen yet, so the visitor gets the name plus one line about why
                the controls need the desktop app. */}
            <header className="simple-intro-bar">
              <h1 className="simple-intro-title">Control</h1>
              <p className="simple-intro-note">
                Watch the agent work on this PC, decide how far it may go, and stop it any
                time. The live controls need the desktop app running.
              </p>
            </header>

            {/* Three tiles, not a story: what the loop is, and the way into the
                other two rooms. */}
            <ol className="simple-journey-list">
              {JOURNEY.map((step) => (
                <li
                  key={step.title}
                  className={`simple-journey-card ${step.current ? 'is-current' : ''}`}
                >
                  <span className="simple-journey-icon" aria-hidden="true">{step.icon}</span>
                  <h2 className="simple-journey-heading">{step.title}</h2>
                  <p className="simple-journey-body">{step.body}</p>
                  {step.current ? (
                    <span className="simple-journey-current" aria-current="step">{step.cta}</span>
                  ) : (
                    <Link className="simple-journey-link" to={step.to}>
                      {step.cta} <span aria-hidden="true">→</span>
                    </Link>
                  )}
                </li>
              ))}
            </ol>

            <LoginGate redirectTo="/simple" />
          </div>
        )}
      </div>

      <Footer />
    </>
  );
}

export default SimplePage;
