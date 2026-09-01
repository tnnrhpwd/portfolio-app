import React, { useEffect, useRef } from 'react';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import { createGame } from './game';
import './Colosseum.css';

/**
 * Colosseum — thin React shell.
 *
 * SEO, header, and footer stay in React; the game itself is a Phaser canvas
 * mounted into a single container. Every in-game menu, button, and HUD element
 * is drawn inside that canvas, never as DOM layered above it.
 */
export default function Colosseum() {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const handle = createGame(containerRef.current);
    return () => {
      handle.destroy();
    };
  }, []);

  return (
    <div className="colosseum-page">
      <SEO
        title="Colosseum"
        description="A gladiator-management RPG: recruit, train, and fight turn-based arena battles."
        path="/colosseum"
      />
      <Header />
      <main className="colosseum-shell">
        <div
          ref={containerRef}
          className="colosseum-game"
          role="application"
          aria-label="Colosseum game"
        />
      </main>
      <Footer />
    </div>
  );
}
