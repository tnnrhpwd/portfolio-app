import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import SEO from '../../components/SEO/SEO.jsx';
import NotFound from '../NotFound/NotFound.jsx';
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
  'You play games with me, and you feel like so much more than a best friend.',
  'Talking to you on the phone helps me feel comfortable and go to sleep.',
  'I love you and all of our playful moments and inside jokes.',
  'You are like family, and I would do anything for you. I know you would do the same for me.',
  'You make me feel comfortable with myself and give me lots of confidence.',
  'You know like everything about me, and it makes me feel valued and appreciated.',
  'You are an amazing parent, and I admire your dedication and love for your child.',
  'You want to build a family, along with many other positive goals we share.',
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
              I love you so incredibly much, and I made this to remind you just how much you mean to me.
            </div>
          </div>

          <div className="muse-content">
            <section className="muse-section muse-counter-section">
              <h2 className="muse-section-title">Officially Together Since July 29</h2>
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
              <div className="muse-counter-caption">I'll need to update this later to account for years as well ❤️</div>
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

            <section className="muse-section muse-qualities-section">
              <h2 className="muse-section-title">Why I'm So Proud of You</h2>
              <div className="muse-qualities-grid">
                {QUALITIES.map((quality) => (
                  <div className="muse-quality-card" key={quality.title}>
                    <div className="muse-quality-icon" aria-hidden="true">{quality.emoji}</div>
                    <div className="muse-quality-title">{quality.title}</div>
                    <div className="muse-quality-text">{quality.text}</div>
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
                  Dakota, I made this to show you how much I appreciate and adore you. I am truly thankful to have met you and to have you in my life.
                  Every moment with you is so beautiful, and I cherish every second we spend together on the phone, texting, or in person.
                  You're so strong, passionate, smart, funny, beautiful, and incredibly loving, and I have learned so much from you and about you since we first met.
                  Every morning we wake up together is so incredible, and you always help me start my day with a smile and a loving heart.
                  I am so excited to continue building our life together.
                </p>
                <p className="muse-note-signature">Yours always, Steven</p>
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
