import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import SEO from '../../../components/SEO/SEO.jsx';
import { ADDON_DOWNLOAD_URL } from '../../../hooks/simpleAddon/useAddonDetection.js';
import heroImg from '../../../assets/art/simple-hero.png';
import perceiveImg from '../../../assets/art/simple-perceive.png';
import actImg from '../../../assets/art/simple-act.png';
import repeatImg from '../../../assets/art/simple-repeat.png';
import './SimplePage.css';

const FEATURES = [
  {
    img: perceiveImg,
    title: 'Perceives your screen',
    body: "Simple sees the window you're in, what you click, and what you type, so it understands the context of a task instead of guessing.",
  },
  {
    img: actImg,
    title: 'Acts on your behalf',
    body: 'It drives the keyboard and mouse to do the work: open apps, click, type, and run the steps you showed it.',
  },
  {
    img: repeatImg,
    title: 'Repeats on request',
    body: "Record a task once and it becomes a reusable skill. Later, ask for it in plain English \u2014 \u201cdo the invoices\u201d \u2014 and it repeats.",
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Download & run',
    body: 'Get the Simple addon, a portable app for Windows. No installer required \u2014 run it and it lives in your tray.',
  },
  {
    n: '02',
    title: 'Show it once',
    body: 'Record a short task \u2014 rename and file an invoice, save a note, or organize a folder.',
  },
  {
    n: '03',
    title: 'Say it in English',
    body: "Ask for the task in plain language in the chat, and Simple repeats the steps for you.",
  },
];

function SimplePage() {
  return (
    <>
      <SEO
        title="Simple"
        description="Simple is an AI agent for your Windows PC \u2014 describe a task in plain English and it perceives and acts on your behalf."
        path="/simple"
      />
      <Header />

      <div className="simple">
        <div className="simple-floating" aria-hidden="true">
          <div className="simple-circle simple-circle-1" />
          <div className="simple-circle simple-circle-2" />
          <div className="simple-circle simple-circle-3" />
        </div>

        {/* Hero */}
        <section className="simple-hero">
          <div className="simple-title-wrap">
            <p className="simple-eyebrow">AI agent for Windows</p>
            <h1 className="simple-title">Simple</h1>
            <p className="simple-subtitle">
              An AI agent that runs on your PC. You describe what you want in plain English, and it
              perceives what&apos;s on your screen and acts on your behalf.
            </p>
            <p className="simple-example">
              Show it once how you rename and file invoices, and afterward saying &ldquo;do the
              invoices&rdquo; repeats those steps.
            </p>
            <div className="simple-actions">
              <a
                className="simple-btn"
                href={ADDON_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download the addon
              </a>
              <Link className="simple-btn simple-btn-outline" to="/net">
                Try the AI chat
              </Link>
              <Link className="simple-btn simple-btn-outline" to="/pricing">
                See pricing
              </Link>
            </div>
          </div>
          <img className="simple-hero-media" src={heroImg} alt="" loading="eager" />
        </section>

        {/* What it does */}
        <section className="simple-band">
          <div className="simple-section-head">
            <p className="simple-eyebrow">What it does</p>
            <h2 className="simple-heading">Three things, in plain terms</h2>
          </div>
          <div className="simple-grid">
            {FEATURES.map((f) => (
              <article className="simple-tile" key={f.title}>
                <img className="simple-tile-media" src={f.img} alt="" loading="lazy" />
                <h3 className="simple-tile-title">{f.title}</h3>
                <p className="simple-tile-body">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="simple-band">
          <div className="simple-section-head">
            <p className="simple-eyebrow">How it works</p>
            <h2 className="simple-heading">From download to done</h2>
          </div>
          <ol className="simple-steps">
            {STEPS.map((s) => (
              <li className="simple-step" key={s.n}>
                <span className="simple-step-n">{s.n}</span>
                <div>
                  <h3 className="simple-step-title">{s.title}</h3>
                  <p className="simple-step-body">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Pricing */}
        <section className="simple-band simple-band--cta">
          <h2 className="simple-heading">Simple pricing</h2>
          <p className="simple-cta-copy">
            Free includes AI chat, full local automation, and 100&nbsp;MB of storage. Pro adds more
            storage, live phone screen viewing, and email support.
          </p>
          <Link className="simple-btn simple-btn--invert" to="/pricing">
            View plans
          </Link>
        </section>

        {/* Get started */}
        <section className="simple-band">
          <h2 className="simple-heading">Ready to try it?</h2>
          <p className="simple-cta-copy">
            Download the addon, show it one task, and ask for it back in plain English.
          </p>
          <div className="simple-actions">
            <a
              className="simple-btn"
              href={ADDON_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download the addon
            </a>
            <Link className="simple-btn simple-btn-outline" to="/net">
              Open the AI chat
            </Link>
          </div>
        </section>
      </div>

      <Footer />
    </>
  );
}

export default SimplePage;
