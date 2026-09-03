import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import NotFound from '../NotFound/NotFound';
import useScrollReveal from '../../hooks/useScrollReveal';
import './Muse.css';

// Same pattern used to gate /admin and /deepstorage — the girlfriend's
// account nickname (case-insensitive) or the site owner's admin id.
const ADMIN_USER_ID = '6770a067c725cbceab958619';
const GIRLFRIEND_NICKNAME = 'girlfriend';

// Every date below is the real moment it happened — kept here so the
// "time together" counters and story timeline always stay accurate.
const FIRST_MESSAGE_DATE = new Date(2026, 6, 17); // July 17
const FIRST_TEXT_DATE = new Date(2026, 6, 20); // July 20
const ASKED_OUT_DATE = new Date(2026, 6, 29); // July 29
const SAID_LOVE_DATE = new Date(2026, 6, 30); // July 30
const FIRST_DATE_DATE = new Date(2026, 7, 1); // August 1

const TIMELINE = [
  {
    date: FIRST_MESSAGE_DATE,
    emoji: '💬',
    title: 'The First Message',
    description: 'I would check the message was but the Tinder account doesn\'t exist anymore <3',
  },
  {
    date: FIRST_TEXT_DATE,
    emoji: '📱',
    title: 'The First Text',
    description: 'I gave you my phone number, and was so thrilled when you texted me back <3',
  },
  {
    date: ASKED_OUT_DATE,
    emoji: '💌',
    title: 'Will You Be My Girlfriend?',
    description: 'After talking constantly everyday, I didn\'t want to wait any longer.',
  },
  {
    date: SAID_LOVE_DATE,
    emoji: '❤️',
    title: 'Three Words',
    description: 'You helped me conquer my fear of vulnerability and open up in ways I never thought I could.',
  },
  {
    date: FIRST_DATE_DATE,
    emoji: '🌅',
    title: 'Our First Date',
    description: 'The aquarium was so much fun with you, and I had almost more fun on the musical car ride there.',
  },
];

// The deeper, everyday truths about who she is — always visible, not just
// part of the shuffled reasons below, because they matter too much to miss.
const QUALITIES = [
  {
    emoji: '🤝',
    title: 'Always In My Corner',
    text: 'Any time I complain about work or something you\'re always there to listen and support me.',
  },
  {
    emoji: '🌱',
    title: 'You Help Me Grow',
    text: 'You help me become a better version of myself every day.',
  },
  {
    emoji: '📚',
    title: 'You Teach Me Things',
    text: 'You have taught me so much about family, communication, and love.',
  },
  {
    emoji: '👩\u200d👦',
    title: 'An Incredible, Responsible Mom',
    text: 'You\'re an incredible mother, and it is so beautiful spending time together.',
  },
  {
    emoji: '⭐',
    title: 'You Give It Your All',
    text: 'You\'re so passionate about everything you do and always brighten my mood.',
  },
  {
    emoji: '🗣️',
    title: 'You Tell the Truth',
    text: 'Even when honesty is uncomfortable, you choose it anyway. I always know exactly where I stand with you.',
  },
  {
    emoji: '🧭',
    title: 'You Do What\'s Right',
    text: 'You choose the right thing over the easy thing, even when no one would blame you for just going along with the crowd.',
  },
  {
    emoji: '🏆',
    title: 'I Am So Proud of You',
    text: 'I am so proud of everything you do and the person you are.',
  },
];

const REASONS = [
  'You always make me smile when I am around you.',
  'You make me sweet treats, and always find ways to make me happy.',
  'You have an incredible memory about the things that I say.',
  'I love hearing you say my name.',
  'You solved the Rubik\'s Cube, and you appreciate my interests.',
  'You play games with me, and you feel like so much more than a best friend.',
  'Talking to you on the phone helps me feel comfortable and go to sleep.',
  'I love you and all of our playful moments and inside jokes.',
  'You are like family, and I would do anything for you. I know you would do the same for me.',
  'You make me feel comfortable with myself and give me lots of confidence.',
  'You know like everything about me, and it makes me feel valued and appreciated.',
  'You are an amazing parent, and I admire your dedication and love for your child.',
  'You want to build a family, along with many other positive goals we share.',
];

// The hearts that burst up when she taps the hero.
const HEART_EMOJIS = ['💗', '💕', '💖', '💞', '💘', '🩷', '💝'];

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
  const [bursts, setBursts] = useState([]);

  // Scroll-triggered reveals — one per band (see docs/guides/FRONTEND_UI_STANDARD.md).
  const [counterRef, counterVisible] = useScrollReveal();
  const [timelineRef, timelineVisible] = useScrollReveal();
  const [qualitiesRef, qualitiesVisible] = useScrollReveal();
  const [reasonsRef, reasonsVisible] = useScrollReveal();
  const [noteRef, noteVisible] = useScrollReveal();

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

  // Tap the hero to send up a little burst of hearts.
  const spawnHearts = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const burstId = `${Date.now()}-${Math.random()}`;
    const next = Array.from({ length: 9 }, (_, i) => ({
      id: `${burstId}-${i}`,
      left: x,
      top: y,
      dx: (Math.random() - 0.5) * 150,
      dy: -(50 + Math.random() * 140),
      size: 0.5 + Math.random() * 0.7,
      emoji: HEART_EMOJIS[Math.floor(Math.random() * HEART_EMOJIS.length)],
      delay: Math.random() * 0.18,
    }));
    setBursts((prev) => [...prev, ...next]);
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((h) => !h.id.startsWith(`${burstId}-`)));
    }, 1100);
  };

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
      <Header />
      <div className="muse">
        {/* ── Hero: animated vibrant gradient + floating hearts ── */}
        <section className="muse-hero" onClick={spawnHearts}>
          <div className="muse-hero-floating" aria-hidden="true">
            <span className="muse-heart muse-heart-1">💗</span>
            <span className="muse-heart muse-heart-2">💕</span>
            <span className="muse-heart muse-heart-3">💖</span>
            <span className="muse-heart muse-heart-4">💞</span>
            <span className="muse-heart muse-heart-5">💘</span>
            <div className="muse-hero-circle muse-hero-circle-1" />
            <div className="muse-hero-circle muse-hero-circle-2" />
            <div className="muse-hero-circle muse-hero-circle-3" />
          </div>
          <div className="muse-hero-wrap">
            <p className="muse-eyebrow">For my muse</p>
            <h1 className="muse-title">Dakota Jade Prince</h1>
            <p className="muse-subtitle">
              I love you so incredibly much, and I made this to remind you just how much you mean to me.
            </p>
            <div className="muse-hero-beat" aria-hidden="true"><span>❤️</span></div>
            <p className="muse-hero-hint" aria-hidden="true">Tap anywhere for a little surprise 💗</p>
          </div>
          <div className="muse-heart-burst" aria-hidden="true">
            {bursts.map((h) => (
              <span
                key={h.id}
                className="muse-burst-heart"
                style={{
                  left: `${h.left}%`,
                  top: `${h.top}%`,
                  fontSize: `calc(var(--nav-size) * ${h.size})`,
                  '--dx': `${h.dx}px`,
                  '--dy': `${h.dy}px`,
                  animationDelay: `${h.delay}s`,
                }}
              >
                {h.emoji}
              </span>
            ))}
          </div>
        </section>

        {/* ── Live counter ── */}
        <section ref={counterRef} className={`muse-band muse-band--surface muse-counter-band muse-reveal ${counterVisible ? 'is-visible' : ''}`}>
          <div className="muse-wrap">
            <div className="muse-section-head">
              <p className="muse-eyebrow">Since day one</p>
              <h2 className="muse-heading">Officially Together Since July 29</h2>
              <p className="muse-lead">Counting every second, because they all matter.</p>
            </div>
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
            <p className="muse-counter-caption">I'll need to update this later to account for years as well ❤️</p>
          </div>
        </section>

        {/* ── Timeline: our story ── */}
        <section ref={timelineRef} className={`muse-band muse-band--tint muse-timeline-band muse-reveal ${timelineVisible ? 'is-visible' : ''}`}>
          <div className="muse-wrap">
            <div className="muse-section-head">
              <p className="muse-eyebrow">The journey</p>
              <h2 className="muse-heading">Our Story So Far</h2>
            </div>
            <ol className="muse-timeline">
              {TIMELINE.map((item, i) => (
                <li className={`muse-timeline-item ${i % 2 === 1 ? 'is-flipped' : ''}`} key={item.title}>
                  <div className="muse-timeline-marker" aria-hidden="true">{item.emoji}</div>
                  <div className="muse-timeline-card">
                    <div className="muse-timeline-date">
                      {formatMilestoneDate(item.date)}
                      <span className="muse-timeline-ago">· {daysSince(item.date, now)} days ago</span>
                    </div>
                    <h3 className="muse-timeline-title">{item.title}</h3>
                    <p className="muse-timeline-description">{item.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Qualities: why I'm proud ── */}
        <section ref={qualitiesRef} className={`muse-band muse-band--surface muse-qualities-band muse-reveal ${qualitiesVisible ? 'is-visible' : ''}`}>
          <div className="muse-wrap">
            <div className="muse-section-head">
              <p className="muse-eyebrow">All of you</p>
              <h2 className="muse-heading">Why I'm So Proud of You</h2>
            </div>
            <div className="muse-qualities-grid">
              {QUALITIES.map((quality) => (
                <article className="muse-quality-card" key={quality.title}>
                  <div className="muse-quality-icon" aria-hidden="true">{quality.emoji}</div>
                  <h3 className="muse-quality-title">{quality.title}</h3>
                  <p className="muse-quality-text">{quality.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Reasons: interactive quote ── */}
        <section ref={reasonsRef} className={`muse-band muse-band--tint muse-reasons-band muse-reveal ${reasonsVisible ? 'is-visible' : ''}`}>
          <div className="muse-wrap">
            <div className="muse-section-head">
              <p className="muse-eyebrow">Endless</p>
              <h2 className="muse-heading">Reasons I Adore You</h2>
              <p className="muse-lead">Too many to count — here's one at a time.</p>
            </div>
            <div className="muse-reason-card">
              <div className="muse-reason-badge" aria-hidden="true">💗</div>
              <p className="muse-reason-quote" key={reasonIndex}>&ldquo;{REASONS[reasonIndex]}&rdquo;</p>
              <div className="muse-reason-progress" role="tablist" aria-label="Reasons">
                {REASONS.map((reason, i) => (
                  <button
                    key={reason}
                    type="button"
                    role="tab"
                    aria-selected={i === reasonIndex}
                    aria-label={`Reason ${i + 1}`}
                    className={`muse-reason-dot ${i === reasonIndex ? 'is-active' : ''}`}
                    onClick={() => setReasonIndex(i)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="muse-btn"
                onClick={() => setReasonIndex((prev) => (prev + 1) % REASONS.length)}
              >
                Tell me another reason <span aria-hidden="true">💗</span>
              </button>
            </div>
          </div>
        </section>

        {/* ── Closing note ── */}
        <section ref={noteRef} className={`muse-band muse-note muse-reveal ${noteVisible ? 'is-visible' : ''}`}>
          <div className="muse-wrap muse-note-inner">
            <span className="muse-note-heart" aria-hidden="true">❤️</span>
            <p className="muse-note-text">
              Dakota, I made this to show you how much I appreciate and adore you. I am truly thankful to have met you and to have you in my life.
              Every moment with you is so beautiful, and I cherish every second we spend together on the phone, texting, or in person.
              You're so strong, passionate, smart, funny, beautiful, and incredibly loving, and I have learned so much from you and about you since we first met.
              Every morning we wake up together is so incredible, and you always help me start my day with a smile and a loving heart.
              I am so excited to continue building our life together.
            </p>
            <p className="muse-note-signature">Yours always, Steven</p>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}

export default Muse;
