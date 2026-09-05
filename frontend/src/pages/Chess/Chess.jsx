import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO';
import ChessBoard from './ChessBoard';
import { getBotMove } from './bot';
import { OPENINGS, PRINCIPLES } from './openings';
import useScrollReveal from '../../hooks/useScrollReveal';
import './Chess.css';

const TABS = [
  { id: 'bot', label: 'Play Bot', icon: '\u265E' },
  { id: 'openings', label: 'Openings', icon: '\u265C' },
  { id: 'principles', label: 'Principles', icon: '\u265B' },
];

const DIFFICULTIES = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
];

const CAPTURED_GLYPH = {
  k: '\u265A\uFE0E',
  q: '\u265B\uFE0E',
  r: '\u265C\uFE0E',
  b: '\u265D\uFE0E',
  n: '\u265E\uFE0E',
  p: '\u265F\uFE0E',
};

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// ──────────────────────────────────────────────────────────────
//  Play Bot
// ──────────────────────────────────────────────────────────────
function PlayBotPanel() {
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(() => gameRef.current.fen());
  const [difficulty, setDifficulty] = useState('medium');
  const [playerColor, setPlayerColor] = useState('w');
  const [orientation, setOrientation] = useState('white');
  const [botThinking, setBotThinking] = useState(false);
  const thinkingRef = useRef(false);

  const game = gameRef.current;
  const turn = game.turn();
  const botColor = playerColor === 'w' ? 'b' : 'w';
  const inCheck = game.isCheck();
  const gameOver = game.isGameOver();
  const checkmate = game.isCheckmate();
  const stalemate = game.isStalemate();
  const draw = game.isDraw();
  const isPlayerTurn = turn === playerColor && !gameOver;
  const moveHistory = game.history();

  // Drive the bot. It only ever acts when it is the bot's side to move, and
  // the small delay keeps the UI feeling responsive instead of teleporting.
  useEffect(() => {
    if (gameOver || turn !== botColor) return undefined;
    if (thinkingRef.current) return undefined;

    thinkingRef.current = true;
    setBotThinking(true);
    const timer = setTimeout(() => {
      try {
        if (!gameRef.current.isGameOver() && gameRef.current.turn() === botColor) {
          const move = getBotMove(gameRef.current, difficulty);
          if (move) gameRef.current.move(move);
        }
      } finally {
        thinkingRef.current = false;
        setBotThinking(false);
        setFen(gameRef.current.fen());
      }
    }, 450);

    return () => {
      clearTimeout(timer);
      thinkingRef.current = false;
      setBotThinking(false);
    };
  }, [fen, difficulty, playerColor, gameOver, turn, botColor]);

  const handleUserMove = ({ from, to, promotion }) => {
    if (gameRef.current.turn() !== playerColor) return;
    let result;
    try {
      result = gameRef.current.move({ from, to, promotion });
    } catch (err) {
      return;
    }
    if (result) setFen(gameRef.current.fen());
  };

  const undoMove = () => {
    const g = gameRef.current;
    let undone = 0;
    while (undone < 2 && g.history().length > 0) {
      g.undo();
      undone += 1;
      if (g.turn() === playerColor) break;
    }
    setFen(g.fen());
  };

  const newGame = (color = playerColor) => {
    gameRef.current = new Chess();
    setPlayerColor(color);
    setOrientation(color === 'w' ? 'white' : 'black');
    setBotThinking(false);
    thinkingRef.current = false;
    setFen(gameRef.current.fen());
  };

  const flipBoard = () => {
    setOrientation((prev) => (prev === 'white' ? 'black' : 'white'));
  };

  let status;
  if (inCheck) status = `${turn === 'w' ? 'White' : 'Black'} is in check.`;
  else if (botThinking) status = 'Bot is thinking\u2026';
  else status = isPlayerTurn ? 'Your move.' : `${turn === 'w' ? 'White' : 'Black'} to move.`;

  let resultTitle = '';
  let resultSub = '';
  if (checkmate) {
    resultTitle = 'Checkmate';
    resultSub = `${turn === 'w' ? 'Black' : 'White'} wins!`;
  } else if (stalemate) {
    resultTitle = 'Stalemate';
    resultSub = 'The game is drawn.';
  } else if (draw) {
    resultTitle = 'Draw';
    resultSub = game.isThreefoldRepetition() ? 'Threefold repetition.' : 'Insufficient material.';
  }

  const captured = useMemo(() => {
    const byWhite = [];
    const byBlack = [];
    for (const move of game.history({ verbose: true })) {
      if (!move.captured) continue;
      if (move.color === 'w') byWhite.push(move.captured);
      else byBlack.push(move.captured);
    }
    const whiteVal = byWhite.reduce((sum, p) => sum + PIECE_VALUE[p], 0);
    const blackVal = byBlack.reduce((sum, p) => sum + PIECE_VALUE[p], 0);
    return { byWhite, byBlack, diff: whiteVal - blackVal };
  }, [fen, game]);

  const moveRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < moveHistory.length; i += 2) {
      rows.push({ num: i / 2 + 1, white: moveHistory[i], black: moveHistory[i + 1] });
    }
    return rows;
  }, [moveHistory]);

  return (
    <section className="chess-panel chess-play">
      <div className="chess-play-controls">
        <div className="chess-control-group" role="group" aria-label="Bot difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              type="button"
              key={d.id}
              className={difficulty === d.id ? 'chess-seg is-active' : 'chess-seg'}
              onClick={() => setDifficulty(d.id)}
              aria-pressed={difficulty === d.id}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="chess-control-group" role="group" aria-label="Play as">
          <button
            type="button"
            className={playerColor === 'w' ? 'chess-seg is-active' : 'chess-seg'}
            onClick={() => newGame('w')}
            aria-pressed={playerColor === 'w'}
          >
            Play White
          </button>
          <button
            type="button"
            className={playerColor === 'b' ? 'chess-seg is-active' : 'chess-seg'}
            onClick={() => newGame('b')}
            aria-pressed={playerColor === 'b'}
          >
            Play Black
          </button>
        </div>

        <div className="chess-control-group" role="group" aria-label="Game actions">
          <button type="button" className="chess-btn" onClick={() => newGame()}>
            New Game
          </button>
          <button
            type="button"
            className="chess-btn chess-btn--outline"
            onClick={undoMove}
            disabled={!moveHistory.length}
          >
            Undo
          </button>
          <button type="button" className="chess-btn chess-btn--outline" onClick={flipBoard}>
            Flip
          </button>
        </div>
      </div>

      <div className="chess-play-layout">
        <ChessBoard
          chess={game}
          orientation={orientation}
          interactive
          onMove={handleUserMove}
          disabled={!isPlayerTurn}
        />
        <div className="chess-play-side">
          {gameOver ? (
            <div className="chess-result" role="status" aria-live="polite">
              <div className="chess-result-title">{resultTitle}</div>
              <div className="chess-result-sub">{resultSub}</div>
              <button type="button" className="chess-btn" onClick={() => newGame()}>
                Play Again
              </button>
            </div>
          ) : (
            <p className="chess-status" role="status" aria-live="polite">
              {botThinking && <span className="chess-status-spinner" aria-hidden="true" />}
              {status}
            </p>
          )}

          {(captured.byWhite.length > 0 || captured.byBlack.length > 0) && (
            <div className="chess-captured">
              <div className="chess-captured-row">
                <span className="chess-captured-side">White</span>
                <span className="chess-captured-pieces">
                  {captured.byWhite.map((p, i) => (
                    <span key={`w-${i}`} className="chess-captured-piece chess-captured-piece--b">
                      {CAPTURED_GLYPH[p]}
                    </span>
                  ))}
                  {captured.diff > 0 && (
                    <span className="chess-captured-diff">+{captured.diff}</span>
                  )}
                </span>
              </div>
              <div className="chess-captured-row">
                <span className="chess-captured-side">Black</span>
                <span className="chess-captured-pieces">
                  {captured.byBlack.map((p, i) => (
                    <span key={`b-${i}`} className="chess-captured-piece chess-captured-piece--w">
                      {CAPTURED_GLYPH[p]}
                    </span>
                  ))}
                  {captured.diff < 0 && (
                    <span className="chess-captured-diff">+{-captured.diff}</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {moveRows.length > 0 && (
            <div className="chess-movelist" aria-label="Moves played">
              {moveRows.map((row) => (
                <div className="chess-moverow" key={row.num}>
                  <span className="chess-movenum">{row.num}.</span>
                  <span className="chess-movesan">{row.white}</span>
                  {row.black && <span className="chess-movesan">{row.black}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
//  Openings
// ──────────────────────────────────────────────────────────────
function OpeningsPanel() {
  const [selectedId, setSelectedId] = useState(OPENINGS[0].id);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const opening = OPENINGS.find((o) => o.id === selectedId) || OPENINGS[0];

  useEffect(() => {
    if (!playing) return undefined;
    if (step >= opening.moves.length) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setStep((s) => Math.min(opening.moves.length, s + 1));
    }, 900);
    return () => clearTimeout(timer);
  }, [playing, step, opening.moves.length]);

  const position = useMemo(() => {
    const chess = new Chess();
    const sans = [];
    for (let i = 0; i < step && i < opening.moves.length; i += 1) {
      const move = chess.move(opening.moves[i]);
      if (move) sans.push(move.san);
    }
    return { chess, sans };
  }, [opening, step]);

  const selectOpening = (id) => {
    setSelectedId(id);
    setStep(0);
    setPlaying(false);
  };

  const moveRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < position.sans.length; i += 2) {
      rows.push({ num: i / 2 + 1, white: position.sans[i], black: position.sans[i + 1] });
    }
    return rows;
  }, [position.sans]);

  return (
    <section className="chess-panel chess-openings">
      <div className="chess-openings-layout">
        <div className="chess-opening-list" role="tablist" aria-label="Choose an opening">
          {OPENINGS.map((o) => (
            <button
              type="button"
              key={o.id}
              role="tab"
              aria-selected={o.id === selectedId}
              className={o.id === selectedId ? 'chess-opening-item is-active' : 'chess-opening-item'}
              onClick={() => selectOpening(o.id)}
            >
              <span className="chess-opening-name">{o.name}</span>
              <span className="chess-opening-eco">{o.eco}</span>
            </button>
          ))}
        </div>

        <div className="chess-opening-detail">
          <div className="chess-opening-head">
            <h2 className="chess-opening-title">{opening.name}</h2>
            <span className="chess-opening-eco chess-opening-eco--badge">{opening.eco}</span>
          </div>
          <p className="chess-opening-desc">{opening.description}</p>

          <div className="chess-opening-board">
            <ChessBoard chess={position.chess} orientation="white" showCoordinates />
          </div>

          <p className="chess-opening-progress">
            Move {step} of {opening.moves.length}
          </p>

          <div className="chess-opening-nav">
            <button
              type="button"
              className="chess-btn chess-btn--outline"
              onClick={() => setStep(0)}
              disabled={step === 0}
            >
              {'\u23EE'} Reset
            </button>
            <button
              type="button"
              className="chess-btn chess-btn--outline"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              {'\u25C0'} Prev
            </button>
            <button
              type="button"
              className="chess-btn"
              onClick={() => setPlaying((p) => !p)}
              disabled={step === opening.moves.length}
            >
              {playing ? '\u23F8 Pause' : '\u25B6 Play'}
            </button>
            <button
              type="button"
              className="chess-btn chess-btn--outline"
              onClick={() => setStep((s) => Math.min(opening.moves.length, s + 1))}
              disabled={step === opening.moves.length}
            >
              Next {'\u25B6'}
            </button>
          </div>

          {moveRows.length > 0 && (
            <div className="chess-movelist" aria-label="Opening moves">
              {moveRows.map((row, rowIndex) => (
                <div className="chess-moverow" key={row.num}>
                  <span className="chess-movenum">{row.num}.</span>
                  <button
                    type="button"
                    className={step === rowIndex * 2 + 1 ? 'chess-movesan is-active' : 'chess-movesan'}
                    onClick={() => setStep(rowIndex * 2 + 1)}
                  >
                    {row.white}
                  </button>
                  {row.black && (
                    <button
                      type="button"
                      className={step === rowIndex * 2 + 2 ? 'chess-movesan is-active' : 'chess-movesan'}
                      onClick={() => setStep(rowIndex * 2 + 2)}
                    >
                      {row.black}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <h3 className="chess-ideas-title">Key ideas</h3>
          <ul className="chess-ideas">
            {opening.ideas.map((idea) => (
              <li key={idea} className="chess-idea">
                {idea}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
//  Principles
// ──────────────────────────────────────────────────────────────
function PrinciplesPanel() {
  const [gridRef, gridVisible] = useScrollReveal();
  return (
    <section className="chess-panel chess-principles">
      <p className="chess-panel-intro">
        Before you memorize move orders, learn <em>why</em> openings work. These
        principles hold in almost every game and tell you what to do when your
        opponent plays something you&apos;ve never seen.
      </p>
      <div
        ref={gridRef}
        className={`chess-principles-grid chess-reveal ${gridVisible ? 'is-visible' : ''}`}
      >
        {PRINCIPLES.map((p, i) => (
          <article className="chess-principle-card" key={p.title}>
            <span className="chess-principle-num">{String(i + 1).padStart(2, '0')}</span>
            <h2 className="chess-principle-title">{p.title}</h2>
            <p className="chess-principle-body">{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
//  Page
// ──────────────────────────────────────────────────────────────
function ChessPage() {
  const [tab, setTab] = useState('bot');
  const [heroRef, heroVisible] = useScrollReveal();

  return (
    <>
      <SEO
        title="Chess"
        description="Learn chess openings, practice against a bot, and master opening principles with interactive chess tools."
        path="/chess"
      />
      <Header />

      <div className="chess">
        <div className="chess-floating" aria-hidden="true">
          <div className="chess-circle chess-circle-1" />
          <div className="chess-circle chess-circle-2" />
          <div className="chess-circle chess-circle-3" />
        </div>

        <section
          ref={heroRef}
          className={`chess-section chess-hero chess-reveal ${heroVisible ? 'is-visible' : ''}`}
        >
          <div className="chess-title-wrap">
            <p className="chess-eyebrow">Learn · Play · Improve</p>
            <h1 className="chess-title">Chess</h1>
            <p className="chess-subtitle">
              Learn openings, play against a bot, and master the fundamentals.
            </p>
            <nav className="chess-tabs" role="tablist" aria-label="Chess tools">
              {TABS.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={tab === t.id ? 'chess-tab is-active' : 'chess-tab'}
                  onClick={() => setTab(t.id)}
                >
                  <span className="chess-tab-icon" aria-hidden="true">
                    {t.icon}
                  </span>
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </section>

        <main id="main" className="chess-section">
          {tab === 'bot' && <PlayBotPanel />}
          {tab === 'openings' && <OpeningsPanel />}
          {tab === 'principles' && <PrinciplesPanel />}
        </main>
      </div>

      <Footer />
    </>
  );
}

export default ChessPage;
