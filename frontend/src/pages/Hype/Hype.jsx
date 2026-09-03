import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO';
import { generateHypeQuote } from '../../services/hypeApi';
import './Hype.css';

// ── YouTube hype songs (plus a secret rickroll, chosen sometimes) ────────
const HYPE_SONGS = [
  { title: "Survivor — Eye of the Tiger", id: 'btPJPFnesV4' },
  { title: "Eminem — Lose Yourself", id: '_Yhyp-_hX2s' },
  { title: "Fort Minor — Remember the Name", id: 'VDvr08sCPOc' },
  { title: "The Script — Hall of Fame", id: 'mk48xRzuNvA' },
  { title: "Kanye West — Stronger", id: 'PsO6ZnUZI0g' },
  { title: "Queen — Don't Stop Me Now", id: 'HgzGwKwLmgM' },
  { title: "Macklemore — Can't Hold Us", id: '2zNSgSzhBfM' },
  { title: "Imagine Dragons — Whatever It Takes", id: 'gOsM-DYaehU' },
  { title: "Eminem — Till I Collapse", id: 'Obim8BYGnOE' },
  { title: "Sia — Unstoppable", id: 'cxjvTXo9WWM' },
];

const RICKROLL = { title: 'Rick Astley — Never Gonna Give You Up', id: 'dQw4w9WgXcQ' };

// ~1 in 5 presses gets the rickroll — funny, but still mostly real hype.
const RICKROLL_CHANCE = 0.2;

// ── Where the hype song opens ────────────────────────────────────────────
const MUSIC_SERVICES = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'apple', label: 'Apple Music' },
  { id: 'soundcloud', label: 'SoundCloud' },
  { id: 'tidal', label: 'Tidal' },
];

// Build the destination URL for a given song + streaming service.
function buildSongUrl(service, song) {
  const query = encodeURIComponent(song.title.replace(/ — /g, ' '));
  switch (service) {
    case 'spotify':
      return `https://open.spotify.com/search/${query}`;
    case 'apple':
      return `https://music.apple.com/us/search?term=${query}`;
    case 'soundcloud':
      return `https://soundcloud.com/search?q=${query}`;
    case 'tidal':
      return `https://listen.tidal.com/search/${query}`;
    case 'youtube':
    default:
      return `https://www.youtube.com/watch?v=${song.id}`;
  }
}

const MOODS = ['On fire', 'Tired', 'Focused', 'Nervous', 'Unstoppable', 'Chill'];

const STARTER_QUOTE =
  "You're one decision away from a completely different life. Make today the day you stop waiting for permission to be great.";

const TOTAL_STORAGE_KEY = 'hype:total';

function readTotal() {
  try {
    const n = Number(localStorage.getItem(TOTAL_STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

const CONFETTI_COLORS = ['#ff4d6d', '#ffb703', '#4cc9f0', '#80ed99', '#c77dff', '#ff9e00', '#f72585'];

export default function Hype() {
  const [quote, setQuote] = useState(STARTER_QUOTE);
  const [provider, setProvider] = useState('starter');
  const [loading, setLoading] = useState(false);
  const [mood, setMood] = useState('');
  const [hypeLevel, setHypeLevel] = useState(0);
  const [musicService, setMusicService] = useState('youtube');
  const [total, setTotal] = useState(readTotal);
  const [quoteKey, setQuoteKey] = useState(0); // re-triggers the fade-in animation
  const confettiRef = useRef(null);

  // Small UX touch: pulse the title card each time a fresh quote lands.
  useEffect(() => {
    setQuoteKey((k) => k + 1);
  }, [quote]);

  const spawnConfetti = useCallback(() => {
    const container = confettiRef.current;
    if (!container) return;
    for (let i = 0; i < 42; i++) {
      const piece = document.createElement('span');
      piece.className = 'hype-confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.setProperty('--d', `${(Math.random() * 1.6 + 0.8).toFixed(2)}s`);
      piece.style.setProperty('--drift', `${(Math.random() * 120 - 60).toFixed(0)}px`);
      piece.style.setProperty('--rot', `${(Math.random() * 720 - 360).toFixed(0)}deg`);
      piece.style.width = `${Math.random() * 8 + 5}px`;
      piece.style.height = `${Math.random() * 12 + 6}px`;
      container.appendChild(piece);
      setTimeout(() => piece.remove(), 2600);
    }
  }, []);

  const handleGetHype = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await generateHypeQuote(mood);
      const next = data?.quote;
      if (next) {
        setQuote(next);
        setProvider(data.provider || 'llm');
        setHypeLevel((lvl) => (lvl + 1 > 10 ? 1 : lvl + 1));
        setTotal((t) => {
          const n = t + 1;
          try {
            localStorage.setItem(TOTAL_STORAGE_KEY, String(n));
          } catch {
            /* storage unavailable — ignore */
          }
          return n;
        });
        spawnConfetti();
      } else {
        toast.error("The hype machine hiccuped. Try again!");
      }
    } catch {
      toast.error("Couldn't reach the hype machine. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [loading, mood, spawnConfetti]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(quote);
      toast.success('Quote copied — go paste it somewhere loud.');
    } catch {
      toast.error("Couldn't copy. Highlight it and copy manually.");
    }
  }, [quote]);

  const handleHypeSong = useCallback(() => {
    const song = Math.random() < RICKROLL_CHANCE ? RICKROLL : HYPE_SONGS[Math.floor(Math.random() * HYPE_SONGS.length)];
    window.open(buildSongUrl(musicService, song), '_blank', 'noopener,noreferrer');
    if (song === RICKROLL) {
      toast.info('Never gonna give you up…');
    } else if (musicService === 'youtube') {
      toast.info(`Now playing: ${song.title}`);
    } else {
      const label = MUSIC_SERVICES.find((s) => s.id === musicService)?.label || 'music';
      toast.info(`Opening ${song.title} on ${label}`);
    }
  }, [musicService]);

  return (
    <>
      <SEO
        title="Get Hyped"
        description="Press the button. Get an AI-generated motivational quote, a hype song, and a reminder that you've got this. Instant, free, and infinitely repeatable."
        path="/hype"
      />

      <Header />

      <main className="hype">
        <div className="hype-ambient" aria-hidden="true">
          <span className="hype-orb hype-orb--1" />
          <span className="hype-orb hype-orb--2" />
          <span className="hype-orb hype-orb--3" />
        </div>

        <div className="hype-confetti" ref={confettiRef} aria-hidden="true" />

        <section className="hype-hero">
          <p className="hype-eyebrow">⚡ Free, unlimited, AI-powered</p>
          <h1 className="hype-title">
            GET <span className="hype-title__grad">HYPED</span>
          </h1>
          <p className="hype-subtitle">
            One button. One brand-new motivational quote. Zero excuses.
            <br className="hype-subtitle__br" />
            Press it as many times as you need to.
          </p>
        </section>

        <section className="hype-card" aria-live="polite">
          <div className="hype-card__glow" aria-hidden="true" />

          <div className="hype-card__meta">
            <span className="hype-card__badge">AI Hype Coach</span>
            <span className="hype-card__provider">
              {provider === 'starter' ? 'ready when you are' : `via ${provider}`}
            </span>
          </div>

          <blockquote key={quoteKey} className="hype-card__quote">
            {loading ? (
              <span className="hype-card__loading" aria-label="Summoning your quote">
                <span className="hype-card__loading-dot" />
                <span className="hype-card__loading-dot" />
                <span className="hype-card__loading-dot" />
              </span>
            ) : (
              <>
                <span className="hype-card__quote-mark" aria-hidden="true">“</span>
                <p className="hype-card__text">{quote}</p>
              </>
            )}
          </blockquote>

          <div className="hype-card__actions">
            <button
              className="hype-btn hype-btn--primary"
              onClick={handleGetHype}
              disabled={loading}
              aria-label="Generate a new motivational quote"
            >
              {loading ? 'SUMMONING…' : '⚡ GET HYPED'}
            </button>

            <button className="hype-btn hype-btn--ghost" onClick={handleCopy} disabled={loading}>
              📋 Copy
            </button>

            <button className="hype-btn hype-btn--song" onClick={handleHypeSong} disabled={loading}>
              🎧 Hype Song
            </button>
          </div>

          <div className="hype-song-picker">
            <label className="hype-song-picker__label" htmlFor="hype-music-service">
              🎧 Stream on
            </label>
            <select
              id="hype-music-service"
              className="hype-song-picker__select"
              value={musicService}
              onChange={(e) => setMusicService(e.target.value)}
              aria-label="Choose which music service the hype song opens in"
            >
              {MUSIC_SERVICES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <p className="hype-card__song-hint">The song button is mostly fire. Sometimes it's a classic.</p>
        </section>

        <section className="hype-moods" aria-label="Choose your mood">
          <span className="hype-moods__label">How are you feeling?</span>
          <div className="hype-moods__list">
            {MOODS.map((m) => (
              <button
                key={m}
                type="button"
                className={`hype-mood${mood === m ? ' hype-mood--active' : ''}`}
                onClick={() => setMood(mood === m ? '' : m)}
                aria-pressed={mood === m}
              >
                {m}
              </button>
            ))}
          </div>
        </section>

        <section className="hype-stats">
          <div className="hype-meter" aria-label={`Hype level ${hypeLevel} out of 10`}>
            <div className="hype-meter__label">
              <span>Hype Meter</span>
              <span className="hype-meter__value">{hypeLevel === 10 ? 'MAXIMUM OVERDRIVE 🔥' : `${hypeLevel} / 10`}</span>
            </div>
            <div className="hype-meter__track">
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={i}
                  className={`hype-meter__flame${i < hypeLevel ? ' hype-meter__flame--lit' : ''}`}
                >
                  🔥
                </span>
              ))}
            </div>
          </div>

          <div className="hype-total">
            <span className="hype-total__number">{total.toLocaleString()}</span>
            <span className="hype-total__label">{total === 1 ? 'hype delivered' : 'hypes delivered'}</span>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
