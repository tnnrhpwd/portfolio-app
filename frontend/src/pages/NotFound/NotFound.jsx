import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import './NotFound.css';

// Somewhere real to land. A 404 has one job — get the visitor back onto a page
// that exists — so these are destinations, not a pitch (no price-led CTA here;
// see docs/implementation/agent.md §16.6 for where selling belongs).
const DESTINATIONS = [
  { to: '/', title: 'Home', desc: 'Start again from the top of the site.' },
  { to: '/projects', title: 'Projects', desc: 'Every tool, game, and experiment I have built.' },
  { to: '/about', title: 'About me', desc: 'Who makes this, and what I work on.' },
  { to: '/support', title: 'Support', desc: 'Found a broken link? Report it and I will fix it.' },
];

function NotFound() {
  return (
    <>
      <SEO
        title="Page Not Found"
        description="The page you're looking for doesn't exist or has been moved."
        path="/404"
        noindex
      />
      <Header />

      <div className="not-found">
        {/* ── Hero: the animated gradient band, with the Home page's floating circles ── */}
        <section className="not-found-hero">
          <div className="not-found-hero-floating" aria-hidden="true">
            <div className="not-found-hero-circle not-found-hero-circle-1" />
            <div className="not-found-hero-circle not-found-hero-circle-2" />
            <div className="not-found-hero-circle not-found-hero-circle-3" />
          </div>

          <div className="not-found-hero-wrap">
            <p className="not-found-eyebrow">Error 404</p>
            {/* Decorative: the <h1> below is what a screen reader should read. */}
            <div className="not-found-code" aria-hidden="true">404</div>
            <h1 className="not-found-title">This page went missing</h1>
            <p className="not-found-message">
              The page you're looking for doesn't exist or has been moved. Double-check
              the URL, or take one of the routes below.
            </p>
            <div className="not-found-actions">
              <Link className="not-found-btn" to="/">
                Back to home <span aria-hidden="true">→</span>
              </Link>
              <Link className="not-found-btn not-found-btn-text" to="/projects">
                Browse my work <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* ── Destinations: a flat band of color planes, one per real page ── */}
        <section className="not-found-band">
          <div className="not-found-wrap">
            <div className="not-found-section-head">
              <p className="not-found-eyebrow">Try instead</p>
              <h2 className="not-found-heading">Somewhere to land</h2>
              <p className="not-found-lead">Four pages that definitely exist.</p>
            </div>

            <ul className="not-found-links">
              {DESTINATIONS.map((destination) => (
                <li key={destination.to}>
                  <Link className="not-found-link" to={destination.to}>
                    <span className="not-found-link-title">
                      {destination.title}
                      <span className="not-found-link-arrow" aria-hidden="true">→</span>
                    </span>
                    <span className="not-found-link-desc">{destination.desc}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}

export default NotFound;
