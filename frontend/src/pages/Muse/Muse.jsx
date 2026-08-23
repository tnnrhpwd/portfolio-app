import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import NotFound from '../NotFound/NotFound';
import './Muse.css';

// Same pattern used to gate /admin and /deepstorage — the girlfriend's
// account nickname (case-insensitive) or the site owner's admin id.
const ADMIN_USER_ID = '6770a067c725cbceab958619';
const GIRLFRIEND_NICKNAME = 'girlfriend';

// Every date below is the real moment it happened — kept here so the
// "time together" counters and story timeline always stay accurate.
const FIRST_MESSAGE_DATE = new Date(2026, 6, 17); // July 17
const FIRST_TEXT_DATE = new Date(2026, 6, 20); // July 20
const SAID_LOVE_DATE = new Date(2026, 6, 29); // July 29
const ASKED_OUT_DATE = new Date(2026, 6, 30); // July 30
const FIRST_DATE_DATE = new Date(2026, 7, 1); // August 1

const TIMELINE = [
  {
    date: FIRST_MESSAGE_DATE,
    emoji: '💬',
    title: 'The First Message',
    description: 'A "hi" that I had no idea would turn into everything.',
  },
  {
    date: FIRST_TEXT_DATE,
    emoji: '📱',
    title: 'The First Text',
    description: 'Our conversation moved to texting — and it never really stopped since.',
  },
  {
    date: SAID_LOVE_DATE,
    emoji: '❤️',
    title: 'Three Words',
    description: 'I told you I loved you, and I meant every letter of it.',
  },
  {
    date: ASKED_OUT_DATE,
    emoji: '💌',
    title: 'Will You Be My Girlfriend?',
    description: 'You said yes. Easiest, best decision I\'ve ever watched you make.',
  },
  {
    date: FIRST_DATE_DATE,
    emoji: '🌅',
    title: 'Our First Date',
    description: 'The first of many, many more to come.',
  },
];

const REASONS = [
  'The way you laugh at your own jokes before you even finish telling them.',
  'How you make ordinary, boring days feel like an adventure.',
  'You listen — really listen — like it matters. Because to you, it does.',
  'The way you say my name when you\'re trying not to smile.',
  'You\'re kind to people who can never repay you for it.',
  'How easy it is to talk to you about absolutely anything.',
  'That look right before you\'re about to tease me.',
  'You make me want to be a better version of myself, every single day.',
  'You feel like home, and we\'ve barely even started.',
  'Simply put — you\'re my favorite person.',
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function daysSince(date, now) {
  const ms = now - date;
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function formatMilestoneDate(date) {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function Muse() {
  const { user } = useSelector((state) => state.data);

  const isAuthorized = !!user && (
    String(user._id) === ADMIN_USER_ID
    || String(user.nickname || '').trim().toLowerCase() === GIRLFRIEND_NICKNAME
  );

  const [now, setNow] = useState(() => new Date());
  const [reasonIndex, setReasonIndex] = useState(0);

  useEffect(() => {
    if (!isAuthorized) return undefined;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [isAuthorized]);

  const elapsed = useMemo(() => {
    const totalMs = Math.max(0, now - ASKED_OUT_DATE);
    const totalSeconds = Math.floor(totalMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { days, hours, minutes, seconds };
  }, [now]);

  if (!isAuthorized) {
    return <NotFound />;
  }

  return (
    <>
      <SEO
        title="For My Muse"
        description="A little love letter, just for you."
        path="/muse"
        noindex
      />
      <div className="muse">
        <Header />
        <div className="muse-container">
          <div className="muse-floating-hearts" aria-hidden="true">
            <span className="muse-heart muse-heart-1">💗</span>
            <span className="muse-heart muse-heart-2">💕</span>
            <span className="muse-heart muse-heart-3">💖</span>
            <span className="muse-heart muse-heart-4">💞</span>
            <span className="muse-heart muse-heart-5">💘</span>
          </div>

          <div className="muse-hero">
            <div className="muse-eyebrow">For my muse</div>
            <h1 className="muse-title">Dakota Jade Prince</h1>
            <div className="muse-subtitle">
              Every version of "us" so far, kept somewhere safe.
            </div>
          </div>

          <div className="muse-content">
            <section className="muse-section muse-counter-section">
              <h2 className="muse-section-title">Officially Together Since July 30</h2>
              <div className="muse-counter">
                <div className="muse-counter-unit">
                  <span className="muse-counter-value">{elapsed.days}</span>
                  <span className="muse-counter-label">days</span>
                </div>
                <div className="muse-counter-unit">
                  <span className="muse-counter-value">{pad(elapsed.hours)}</span>
                  <span className="muse-counter-label">hours</span>
                </div>
                <div className="muse-counter-unit">
                  <span className="muse-counter-value">{pad(elapsed.minutes)}</span>
                  <span className="muse-counter-label">minutes</span>
                </div>
                <div className="muse-counter-unit">
                  <span className="muse-counter-value">{pad(elapsed.seconds)}</span>
                  <span className="muse-counter-label">seconds</span>
                </div>
              </div>
              <div className="muse-counter-caption">...and every second has been my favorite one yet.</div>
            </section>

            <section className="muse-section">
              <h2 className="muse-section-title">Our Story So Far</h2>
              <div className="muse-timeline">
                {TIMELINE.map((item, i) => (
                  <div className="muse-timeline-item" key={item.title} style={{ animationDelay: `${i * 0.12}s` }}>
                    <div className="muse-timeline-marker">{item.emoji}</div>
                    <div className="muse-timeline-body">
                      <div className="muse-timeline-date">
                        {formatMilestoneDate(item.date)}
                        <span className="muse-timeline-ago">· {daysSince(item.date, now)} days ago</span>
                      </div>
                      <div className="muse-timeline-title">{item.title}</div>
                      <div className="muse-timeline-description">{item.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="muse-section muse-reasons-section">
              <h2 className="muse-section-title">Reasons I Adore You</h2>
              <div className="muse-reason-card">
                <div className="muse-reason-quote">"{REASONS[reasonIndex]}"</div>
                <button
                  type="button"
                  className="muse-reason-button"
                  onClick={() => setReasonIndex((prev) => (prev + 1) % REASONS.length)}
                >
                  Tell me another reason 💗
                </button>
              </div>
            </section>

            <section className="muse-section muse-note-section">
              <div className="muse-note">
                <p>
                  Dakota, you turned a random message into the best part of my summer.
                  I can't wait for every date, every text, and every "I love you" still ahead of us.
                </p>
                <p className="muse-note-signature">Yours always, Tanner</p>
              </div>
            </section>
          </div>
        </div>
        <Footer />
      </div>
    </>
  );
}

export default Muse;
