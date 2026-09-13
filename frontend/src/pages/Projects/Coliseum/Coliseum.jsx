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
 * The game runs in Phaser's FIT mode over ONE of two fixed design boxes —
 * landscape 1280x720 or portrait 720x1280 — so the frame must be the same shape
 * as the canvas or the letterboxing reappears *inside* the canvas. Orientation
 * is therefore the shell's business: the frame's aspect ratio follows the media
 * query in `Coliseum.css`, and flipping it destroys and rebuilds the game so the
 * correct fixed layout is constructed from scratch. Rebuilding beats reflowing:
 * no scene needs a resize path and every repositioned element is a bug you only
 * ever see on a device you don't own.
 *
 * The Phaser engine + game code are NOT bundled into this route's chunk.
 * They are fetched on demand (dynamic import) only after the player taps the
 * start gate, so the heavy engine (~1.4 MB) stays out of the initial load and
 * the AudioContext is unlocked by a real user gesture.
 */

/** The same signal `Coliseum.css` and the game's layout picker both use. */
const detectLayout = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(orientation: portrait)')?.matches
    ? 'portrait'
    : 'landscape';

export default function Coliseum() {
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
    // Dynamic import keeps Phaser + game code out of this route chunk.
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
      console.error('Coliseum failed to load:', err);
      setPhase('error');
    }
  }, [phase, mountGame]);

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
    const query = window.matchMedia?.('(orientation: portrait)');
    if (!query) return undefined;
    const onChange = () => setLayout(query.matches ? 'portrait' : 'landscape');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Rotating rebuilds the game in the box that now fits. The guard also catches
  // a flip that happened while the chunk was still loading, in which case the
  // phase change is what brings us here.
  useEffect(() => {
    if (phase !== 'playing') return;
    if (mountedLayoutRef.current === layout) return;
    mountGame().catch((err) => {
      console.error('Coliseum failed to rebuild after a rotation:', err);
      setPhase('error');
    });
  }, [phase, layout, mountGame]);

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
        <div className="coliseum-frame">
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
        </div>
        <div ref={liveRegionRef} className="coliseum-sr" aria-live="polite" role="status" />
      </main>
      <Footer />
    </div>
  );
}
