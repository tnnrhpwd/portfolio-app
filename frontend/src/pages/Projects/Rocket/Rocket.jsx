import React, { useCallback, useEffect, useRef, useState } from 'react';
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import SEO from '../../../components/SEO/SEO.jsx';
import './Rocket.css';

/**
 * Rocket — thin React shell.
 *
 * SEO, header and footer stay in React; the game itself is a Phaser canvas
 * mounted into one container, and every menu, HUD element and button is drawn
 * inside that canvas rather than as DOM layered over it. That keeps the arena
 * and its UI on a single scale at any window size (the game runs in Phaser's
 * FIT mode, so the arena is always 1280×720 with letterbox bars).
 *
 * Phaser and the game code are NOT in this route's chunk: they are fetched by
 * dynamic import only after the player taps through the gate, so the heavy
 * engine stays out of the initial load and the browser's autoplay policy is
 * satisfied by a real user gesture.
 */

export default function Rocket() {
  const containerRef = useRef(null);
  const liveRegionRef = useRef(null);
  const handleRef = useRef(null);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'loading' | 'error' | 'playing'

  const startGame = useCallback(async () => {
    if (phase === 'loading' || phase === 'playing' || !containerRef.current) return;
    setPhase('loading');
    try {
      const { createGame } = await import('./game');
      if (!containerRef.current) return; // unmounted while loading
      handleRef.current = createGame(containerRef.current);
      setPhase('playing');
    } catch (err) {
      console.error('Rocket failed to load:', err);
      setPhase('error');
    }
  }, [phase]);

  // Tear the Phaser instance down on unmount so navigating away leaks nothing
  // (the game also closes its AudioContext on destroy).
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
    // Bridge so the game can narrate wave changes, hits and purchases to
    // screen readers; the canvas itself is opaque to assistive tech.
    window.__rocketAnnounce = (message) => {
      if (liveRegionRef.current) liveRegionRef.current.textContent = message;
    };
    return () => {
      delete window.__rocketAnnounce;
    };
  }, []);

  const gateLabel =
    phase === 'loading'
      ? 'Fuelling up…'
      : phase === 'error'
        ? 'Could not load the game — tap to retry'
        : 'Launch';

  return (
    <div className="rocket-page">
      <SEO
        title="Rocket"
        description="A vertical space shooter: dodge the debris, blast the wrecks, and spend the coins you collect on permanent upgrades."
        path="/rocket"
      />
      <Header />
      <main className="rocket-shell">
        <div className="rocket-frame">
          <div
            ref={containerRef}
            className="rocket-game"
            role="application"
            aria-label="Rocket game"
          >
            {phase !== 'playing' && (
              <button
                type="button"
                className="rocket-play"
                onClick={startGame}
                disabled={phase === 'loading'}
                aria-busy={phase === 'loading'}
              >
                <span className="rocket-play-title">ROCKET</span>
                <span className="rocket-play-sub">{gateLabel}</span>
                <span className="rocket-play-hint">
                  Arrows / WASD or drag to move · guns fire automatically
                </span>
              </button>
            )}
          </div>
        </div>
        <div ref={liveRegionRef} className="rocket-sr" aria-live="polite" role="status" />
      </main>
      <Footer />
    </div>
  );
}
