import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import useScrollReveal from '../../../hooks/useScrollReveal.js';
import { HUB_QUIZZES, QUIZ_SOURCE_URL } from './meta';
import './Quizzes.css';

/**
 * /quizzes — the hub. Lists every quiz in the catalogue as a card that links
 * straight to its own page.
 *
 * The IQ Test deliberately stays a separate card on /projects rather than
 * being folded in here; the catalogue in ./meta.js is therefore not the whole
 * set of quizzes on the site, just this family.
 */
function Quizzes() {
  const [gridRef, gridVisible] = useScrollReveal();

  return (
    <>
      <SEO
        title="Quizzes & Personality Tests"
        description="Free quizzes with instant results and a full breakdown — the adaptive IQ test, 16 personality types, Big Five, Enneagram, attachment style, love languages, and couples quizzes. No sign-up needed."
        path="/quizzes"
      />
      <Header />

      <div className="quizzes">
        <div className="quizzes-floating" aria-hidden="true">
          <div className="quizzes-circle quizzes-circle-1" />
          <div className="quizzes-circle quizzes-circle-2" />
          <div className="quizzes-circle quizzes-circle-3" />
        </div>

        <section className="quizzes-section">
          <div className="quizzes-title-wrap">
            <p className="quizzes-eyebrow">
              <span aria-hidden="true">🧠</span>
              Projects · Quizzes
            </p>
            <h1 className="quizzes-title">Quizzes</h1>
            <div className="quizzes-underline" aria-hidden="true" />
            <p className="quizzes-subtitle">
              Short personality, relationship and self-reflection questionnaires, plus the adaptive IQ
              test. Each one runs in the browser and gives you a full breakdown of your answers rather
              than a single number.
            </p>
          </div>

          <div
            className={`quizzes-grid${gridVisible ? ' is-visible' : ''}`}
            ref={gridRef}
          >
            {HUB_QUIZZES.map((quiz) => (
              <Link className="quizzes-card" to={quiz.path} key={quiz.slug}>
                <span className="quizzes-card-emoji" aria-hidden="true">{quiz.emoji}</span>
                <h2 className="quizzes-card-name">{quiz.name}</h2>
                <p className="quizzes-card-tagline">{quiz.tagline}</p>
                <div className="quizzes-card-meta">
                  <span className="quizzes-chip">{quiz.tags[0]}</span>
                  <span className="quizzes-card-time">~{quiz.minutes} min</span>
                </div>
              </Link>
            ))}
          </div>

          <p className="quizzes-disclaimer">
            Every quiz here is for entertainment and self-reflection. They are original questionnaires
            inspired by well-known instruments — not copies of them, not validated psychometric tests, and
            not a substitute for assessment by a qualified professional. The two screening questionnaires
            in particular cannot diagnose anything.
          </p>

          <div className="quizzes-links">
            <Link className="quizzes-source-link" to="/projects">← All projects</Link>
            <a
              className="quizzes-source-link"
              href={QUIZ_SOURCE_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              View Source Code
            </a>
          </div>
        </section>
      </div>
      <Footer />
    </>
  );
}

export default Quizzes;
