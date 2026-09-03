import React, { useCallback, useEffect, useRef, useState } from 'react';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import './Coliseum.css';

/**
 * Coliseum — thin React shell.
 *
 * SEO, header, and footer stay in React; the game itself is a Phaser canvas
 * mounted into a single container. Every in-game menu, button, and HUD element
 * is drawn inside that canvas, never as DOM layered above it.
 *
 * The Phaser engine + game code are NOT bundled into this route's chunk.
 * They are fetched on demand (dynamic import) only after the player taps the
 * start gate, so the heavy engine (~1.4 MB) stays out of the initial load and
 * the AudioContext is unlocked by a real user gesture.
 */

export default function Coliseum() {
  const containerRef = useRef(null);
  const liveRegionRef = useRef(null);
  const handleRef = useRef(null);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'loading' | 'error' | 'playing'

  const startGame = useCallback(async () => {
    if (phase === 'loading' || phase === 'playing' || !containerRef.current) return;
    setPhase('loading');
    try {
      // Dynamic import keeps Phaser + game code out of this route chunk.
      const { createGame } = await import('./game');
      if (!containerRef.current) return; // unmounted while loading
      handleRef.current = createGame(containerRef.current);
      setPhase('playing');
    } catch (err) {
      console.error('Coliseum failed to load:', err);
      setPhase('error');
    }
  }, [phase]);

  // Tear down the Phaser instance on unmount (no leaks across navigations).
  useEffect(
    () => () => {
      if (handleRef.current) {
        handleRef.current.destroy();
        handleRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    // Bridge so the Phaser core can announce events to screen readers.
    window.__coliseumAnnounce = (message) => {
      if (liveRegionRef.current) liveRegionRef.current.textContent = message;
    };
    return () => {
      delete window.__coliseumAnnounce;
    };
  }, []);

  const gateLabel =
    phase === 'loading'
      ? 'Loading the arena…'
      : phase === 'error'
        ? 'Could not load the game — tap to retry'
        : 'Play Coliseum';

  return (
    <div className="coliseum-page">
      <SEO
        title="Coliseum"
        description="A gladiator-management RPG: recruit, train, and fight turn-based arena battles."
        path="/coliseum"
      />
      <Header />
      <main className="coliseum-shell">
        <div
          ref={containerRef}
          className="coliseum-game"
          role="application"
          aria-label="Coliseum game"
        >
          {phase !== 'playing' && (
            <button
              type="button"
              className="coliseum-play"
              onClick={startGame}
              disabled={phase === 'loading'}
              aria-busy={phase === 'loading'}
            >
              <span className="coliseum-play-title">Coliseum</span>
              <span className="coliseum-play-sub">{gateLabel}</span>
            </button>
          )}
        </div>
        <div ref={liveRegionRef} className="coliseum-sr" aria-live="polite" role="status" />
      </main>
      <Footer />
    </div>
  );
}
