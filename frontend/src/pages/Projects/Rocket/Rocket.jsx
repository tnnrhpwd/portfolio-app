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
 * and its UI on a single scale (the game runs in Phaser's FIT mode over one of
 * two fixed design boxes, so the arena is always the same shape).
 *
 * Orientation is the shell's business, not the game's: the frame's aspect ratio
 * follows the media query in `Rocket.css`, and flipping it destroys and rebuilds
 * the game so the correct fixed layout is constructed from scratch. The run
 * itself lives in the game's session rather than in the scene tree, so a rebuild
 * puts the player straight back into the wave they were in.
 *
 * Phaser and the game code are NOT in this route's chunk: they are fetched by
 * dynamic import only after the player taps through the gate, so the heavy
 * engine stays out of the initial load and the browser's autoplay policy is
 * satisfied by a real user gesture.
 */

/** The same signal `Rocket.css` and the game's layout picker both use. */
const detectLayout = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(orientation: portrait)')?.matches
    ? 'portrait'
    : 'landscape';

export default function Rocket() {
  const containerRef = useRef(null);
  const liveRegionRef = useRef(null);
  const handleRef = useRef(null);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'loading' | 'error' | 'playing'
  const [layout, setLayout] = useState(detectLayout);

  // Which layout the live instance was actually built for. `createGame` detects
  // the orientation itself, so this is read from the same source after mounting
  // rather than from state, which may have moved on while the chunk loaded.
  const mountedLayoutRef = useRef(null);

  const mountGame = useCallback(async () => {
    if (!containerRef.current) return;
    const { createGame } = await import('./game');
    if (!containerRef.current) return; // unmounted while loading
    handleRef.current?.destroy();
    handleRef.current = createGame(containerRef.current);
    mountedLayoutRef.current = detectLayout();
  }, []);

  const startGame = useCallback(async () => {
    if (phase === 'loading' || phase === 'playing' || !containerRef.current) return;
    setPhase('loading');
    try {
      await mountGame();
      setPhase('playing');
    } catch (err) {
      console.error('Rocket failed to load:', err);
      setPhase('error');
    }
  }, [phase, mountGame]);

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
    const query = window.matchMedia?.('(orientation: portrait)');
    if (!query) return undefined;
    const onChange = () => setLayout(query.matches ? 'portrait' : 'landscape');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Rotating rebuilds the game in the box that now fits. Rebuilding beats
  // reflowing: no scene needs a resize path, and boot resumes the run. The
  // guard also catches a flip that happened while the chunk was still loading,
  // in which case the phase change is what brings us here.
  useEffect(() => {
    if (phase !== 'playing') return;
    if (mountedLayoutRef.current === layout) return;
    mountGame().catch((err) => {
      console.error('Rocket failed to rebuild after a rotation:', err);
      setPhase('error');
    });
  }, [phase, layout, mountGame]);

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
