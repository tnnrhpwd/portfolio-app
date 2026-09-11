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
 * The surface switcher lives in the header (zero extra height); the logged-out
 * view explains the whole loop before asking anyone to sign in, because /simple
 * is a landing target from Home and a bare sign-in wall was losing the visit.
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

      <div className="simple">
        <div className="simple-floating" aria-hidden="true">
          <div className="simple-circle simple-circle-1" />
          <div className="simple-circle simple-circle-2" />
          <div className="simple-circle simple-circle-3" />
        </div>

        {/* Hero */}
        <section className="simple-hero">
          <div className="simple-title-wrap">
            <p className="simple-eyebrow">Simple · Control</p>
            <h1 className="simple-title">Your agent, live</h1>
            <p className="simple-subtitle">
              See what it&apos;s doing, decide how far it can go, and stop it any time.
            </p>
          </div>
        </section>

        {user ? (
          <SimpleDashboard />
        ) : (
          <>
            {/* The whole loop, explained before asking anyone to sign in. */}
            <section className="simple-journey" aria-labelledby="simple-journey-title">
              <h2 id="simple-journey-title" className="simple-section-title">How Simple works</h2>
              <ol className="simple-journey-list">
                {JOURNEY.map((step) => (
                  <li key={step.title} className={`simple-journey-card ${step.current ? 'is-current' : ''}`}>
                    <span className="simple-journey-icon" aria-hidden="true">{step.icon}</span>
                    <h3 className="simple-journey-heading">{step.title}</h3>
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
              <p className="simple-journey-note">
                Free to start — no credit card required. Simple runs on your own PC; the
                cloud only keeps your goals and settings in sync.
              </p>
            </section>

            <LoginGate redirectTo="/simple" />
          </>
        )}
      </div>

      <Footer />
    </>
  );
}

export default SimplePage;
