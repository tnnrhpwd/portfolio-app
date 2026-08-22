import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO from '../../../components/SEO/SEO.jsx';
import { createData, createPublicData, getData, getPublicData, deleteData } from '../../../features/data/dataSlice.js';
import Game2048Board from './Game2048Board';
import Game2048Leaderboard from './Game2048Leaderboard';
import Game2048SavedGames from './Game2048SavedGames';
import {
  DEFAULT_SIZE,
  createInitialTiles,
  moveTiles,
  spawnTile,
  tilesToBoard,
  boardToTiles,
  encodeBoard,
  decodeBoard,
  isGameOver,
  hasWinningTile,
  getMaxTileValue,
} from './game2048Engine';
import './Game2048.css';

// ============================================================================
// Storage / architecture notes (read before touching the save/leaderboard code)
// ============================================================================
// This app has ONE generic schema-less Data model in a single DynamoDB table
// ("Simple") — see backend/models/dataModel.js. Every feature (Wordle words,
// bug reports, reviews, ...) stores a pipe-delimited `text` string and reuses
// the same handful of generic /api/data routes rather than bespoke ones. This
// page follows that exact convention instead of adding new backend code:
//
//   Saved games  -> createData / getData / deleteData (private, auth'd).
//     createData's controller (postHashData) auto-prefixes "Creator:<id>|",
//     so the raw text we send is just "Game2048Save|Score:...|Board:...".
//     NOTE: we deliberately never use the generic PUT /api/data/:id
//     ("updateData") endpoint for saves — its controller (putHashData) is
//     tightly coupled to unrelated payment-method-gating logic for another
//     feature (Simple/Net) and would either block on "no payment method" or
//     require an unrelated magic bypass string. Instead, "Save Game" always
//     creates a fresh save row, and we prune old ones (oldest deleted first)
//     once more than MAX_SAVED_GAMES exist — simpler and avoids that coupling.
//
//   Leaderboard  -> createPublicData / getPublicData (no auth required).
//     Entries are tagged "Public:true" so the existing public-scan-by-
//     "contains" search (getData.js's public controller) can find them,
//     exactly like the review/bug-report public writes elsewhere in the app.
//
// Neither path stores anything on every move — both only fire from explicit
// button clicks ("Save Game" / "Submit Score"), per the manual-save
// requirement. The current in-progress board and personal best score are
// mirrored to localStorage only (never the backend) purely so a page refresh
// doesn't lose an in-progress game.
// ============================================================================

const SIZE = DEFAULT_SIZE;
const ANIMATION_LOCK_MS = 140;
const MAX_SAVED_GAMES = 5;
const BEST_SCORE_KEY = 'game2048BestScore';
const CURRENT_GAME_KEY = 'game2048CurrentGame';
const SAVE_SEARCH = 'Game2048Save';
const LEADERBOARD_SEARCH = 'Game2048Leaderboard';

// ---------------------------------------------------------------------------
// text <-> fields helpers (mirrors the pipe/colon convention used throughout
// the backend, e.g. backend/controllers/getHashData.js's bug-report parser)
// ---------------------------------------------------------------------------

function parseDelimitedFields(text) {
  const fields = {};
  String(text).split('|').forEach((part) => {
    const idx = part.indexOf(':');
    if (idx === -1) {
      if (part.trim()) fields[part.trim()] = true;
      return;
    }
    const key = part.slice(0, idx).trim();
    // Rejoin any remaining colons (ISO timestamps contain them) rather than
    // truncating at the first one.
    const value = part.slice(idx + 1);
    fields[key] = value;
  });
  return fields;
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseSavedGameRow(row) {
  if (!row || typeof row.data !== 'string') return null;
  const fields = parseDelimitedFields(row.data);
  if (!fields.Game2048Save) return null;
  const savedAt = fields.SavedAt || row.updatedAt || row.createdAt;
  return {
    id: row._id,
    score: parseInt(fields.Score, 10) || 0,
    best: parseInt(fields.Best, 10) || 0,
    moves: parseInt(fields.Moves, 10) || 0,
    board: fields.Board || '',
    savedAt,
    savedAtLabel: formatDateLabel(savedAt),
  };
}

function parseLeaderboardRow(row) {
  if (!row || typeof row.data !== 'string') return null;
  const fields = parseDelimitedFields(row.data);
  if (!fields.Game2048Leaderboard) return null;
  const score = parseInt(fields.Score, 10);
  if (!Number.isFinite(score)) return null;
  return {
    id: row._id,
    score,
    tile: parseInt(fields.Tile, 10) || null,
    name: (fields.Name || 'Anonymous').trim().slice(0, 24) || 'Anonymous',
    dateLabel: formatDateLabel(fields.At || row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// localStorage helpers (guest-friendly personal best + in-progress game)
// ---------------------------------------------------------------------------

function loadBestScore() {
  const stored = parseInt(localStorage.getItem(BEST_SCORE_KEY), 10);
  return Number.isFinite(stored) ? stored : 0;
}

function persistBestScore(value) {
  try { localStorage.setItem(BEST_SCORE_KEY, String(value)); } catch (e) { /* localStorage unavailable — ignore */ }
}

function loadLocalGame() {
  try {
    const raw = localStorage.getItem(CURRENT_GAME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function persistLocalGame(state) {
  try { localStorage.setItem(CURRENT_GAME_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function buildInitialGameState() {
  const local = loadLocalGame();
  if (local && local.board) {
    const board = decodeBoard(local.board, SIZE);
    const tiles = boardToTiles(board, SIZE);
    if (tiles.length > 0) {
      return { tiles, score: local.score || 0, moves: local.moves || 0, gameOver: isGameOver(tiles, SIZE) };
    }
  }
  return { tiles: createInitialTiles(SIZE), score: 0, moves: 0, gameOver: false };
}

function Game2048() {
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.data);

  const [view, setView] = useState('play'); // 'play' | 'leaderboard' | 'saved' | 'help'
  const [game, setGame] = useState(buildInitialGameState);
  const [best, setBest] = useState(loadBestScore);
  const [inputLocked, setInputLocked] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);

  const [savedGames, setSavedGames] = useState([]);
  const [savedGamesLoading, setSavedGamesLoading] = useState(false);
  const [savedGamesError, setSavedGamesError] = useState('');

  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState('');

  const hasWonNotifiedRef = useRef(hasWinningTile(game.tiles));
  const prevMovesRef = useRef(null);

  // ---- Move handling -------------------------------------------------------
  const handleMove = useCallback((direction) => {
    setGame((prev) => {
      if (prev.gameOver) return prev;
      const moveResult = moveTiles(prev.tiles, direction, SIZE);
      if (!moveResult.moved) return prev; // no-op move — bail out, no spawn/re-render
      const { tiles: spawnedTiles } = spawnTile(moveResult.tiles, SIZE);
      const newScore = prev.score + moveResult.scoreDelta;
      const newMoves = prev.moves + 1;
      return {
        tiles: spawnedTiles,
        score: newScore,
        moves: newMoves,
        gameOver: isGameOver(spawnedTiles, SIZE),
      };
    });
  }, []);

  const newGame = useCallback(() => {
    const tiles = createInitialTiles(SIZE);
    setGame({ tiles, score: 0, moves: 0, gameOver: false });
    hasWonNotifiedRef.current = false;
    prevMovesRef.current = 0;
    setScoreSubmitted(false);
    persistLocalGame({ board: encodeBoard(tilesToBoard(tiles, SIZE)), score: 0, moves: 0 });
  }, []);

  // React to every real move: briefly lock input for the slide animation,
  // update the persisted best score, fire the one-time "you won" toast, and
  // mirror progress to localStorage (never the backend).
  useEffect(() => {
    if (prevMovesRef.current === null) {
      // First mount (possibly resuming a locally-persisted game) — don't
      // replay the win toast for an already-won resumed game.
      prevMovesRef.current = game.moves;
      if (hasWinningTile(game.tiles)) hasWonNotifiedRef.current = true;
      return;
    }
    if (game.moves === prevMovesRef.current) return;
    prevMovesRef.current = game.moves;

    setInputLocked(true);
    const unlockTimer = setTimeout(() => setInputLocked(false), ANIMATION_LOCK_MS);

    if (game.score > best) {
      setBest(game.score);
      persistBestScore(game.score);
    }

    if (!hasWonNotifiedRef.current && hasWinningTile(game.tiles)) {
      hasWonNotifiedRef.current = true;
      toast.success('🎉 You reached 2048! Keep playing — the board never locks, so push for an even higher tile.', {
        autoClose: 6000,
      });
    }

    persistLocalGame({
      board: encodeBoard(tilesToBoard(game.tiles, SIZE)),
      score: game.score,
      moves: game.moves,
    });

    return () => clearTimeout(unlockTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  // ---- Saved games (backend, manual only) ----------------------------------
  const fetchSavedGames = useCallback(async ({ prune = false } = {}) => {
    if (!user) {
      setSavedGames([]);
      return;
    }
    setSavedGamesLoading(true);
    setSavedGamesError('');
    try {
      const result = await dispatch(getData({ data: SAVE_SEARCH })).unwrap();
      const rows = (result?.data || [])
        .map(parseSavedGameRow)
        .filter(Boolean)
        .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));

      if (prune && rows.length > MAX_SAVED_GAMES) {
        const extras = rows.slice(MAX_SAVED_GAMES);
        await Promise.all(extras.map((row) => dispatch(deleteData(row.id)).unwrap().catch(() => {})));
        setSavedGames(rows.slice(0, MAX_SAVED_GAMES));
        return;
      }
      setSavedGames(rows);
    } catch (err) {
      console.error('Error fetching saved 2048 games:', err);
      setSavedGamesError('Failed to load saved games. Please try again.');
    } finally {
      setSavedGamesLoading(false);
    }
  }, [user, dispatch]);

  const saveGame = useCallback(async () => {
    if (!user) {
      toast.info('Log in to save your game.', { autoClose: 4000 });
      return;
    }
    setIsSaving(true);
    try {
      const board = tilesToBoard(game.tiles, SIZE);
      const text = `Game2048Save|Score:${game.score}|Best:${best}|Moves:${game.moves}|Board:${encodeBoard(board)}|SavedAt:${new Date().toISOString()}`;
      await dispatch(createData({ text })).unwrap();
      toast.success('Game saved!', { autoClose: 3000 });
      await fetchSavedGames({ prune: true });
    } catch (err) {
      console.error('Error saving 2048 game:', err);
      toast.error('Failed to save game. Please try again.', { autoClose: 4000 });
    } finally {
      setIsSaving(false);
    }
  }, [user, game, best, dispatch, fetchSavedGames]);

  const continueGame = useCallback((save) => {
    const board = decodeBoard(save.board, SIZE);
    const tiles = boardToTiles(board, SIZE);
    hasWonNotifiedRef.current = hasWinningTile(tiles);
    prevMovesRef.current = save.moves;
    setGame({ tiles, score: save.score, moves: save.moves, gameOver: isGameOver(tiles, SIZE) });
    setScoreSubmitted(false);
    setView('play');
    persistLocalGame({ board: save.board, score: save.score, moves: save.moves });
    toast.success('Save loaded — good luck!', { autoClose: 2500 });
  }, []);

  const deleteSave = useCallback(async (id) => {
    try {
      await dispatch(deleteData(id)).unwrap();
      setSavedGames((prev) => prev.filter((s) => s.id !== id));
      toast.success('Save deleted.', { autoClose: 2500 });
    } catch (err) {
      console.error('Error deleting 2048 save:', err);
      toast.error('Failed to delete save. Please try again.', { autoClose: 3000 });
    }
  }, [dispatch]);

  // ---- Leaderboard (backend, public read + explicit submit) ---------------
  const fetchLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    setLeaderboardError('');
    try {
      const result = await dispatch(getPublicData({ data: { text: LEADERBOARD_SEARCH } })).unwrap();
      const rows = (result?.data || [])
        .map(parseLeaderboardRow)
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      setLeaderboard(rows);
    } catch (err) {
      console.error('Error fetching 2048 leaderboard:', err);
      setLeaderboardError('Failed to load the leaderboard. Please try again.');
    } finally {
      setLeaderboardLoading(false);
    }
  }, [dispatch]);

  const submitScore = useCallback(async () => {
    if (!user) {
      toast.info('Log in to submit your score to the leaderboard.', { autoClose: 4000 });
      return;
    }
    if (scoreSubmitted || isSubmittingScore) return;
    setIsSubmittingScore(true);
    try {
      const maxTile = getMaxTileValue(game.tiles);
      const safeName = (user.nickname || 'Anonymous').replace(/[|:]/g, ' ').trim().slice(0, 24) || 'Anonymous';
      // The backend already applies a global sanitizeInput + validateDataCreation
      // pass to every /api/data/public write (see server.js / validation.js),
      // stripping HTML and capping text length, so stored nicknames can't carry
      // markup. There's still no server-side *score plausibility* check though —
      // that's the same generic endpoint reviews/bug-reports already use. These
      // client-side bounds are just a soft guard; real anti-cheat would need a
      // dedicated backend controller (out of scope here, see file header).
      const safeScore = Math.max(0, Math.min(Math.floor(game.score) || 0, 100000000));
      const text = `Game2048Leaderboard|Public:true|Score:${safeScore}|Tile:${maxTile}|Name:${safeName}|At:${new Date().toISOString()}|UserId:${user._id || ''}`;
      await dispatch(createPublicData({ text })).unwrap();
      setScoreSubmitted(true);
      toast.success('Score submitted to the leaderboard!', { autoClose: 3000 });
      fetchLeaderboard();
    } catch (err) {
      console.error('Error submitting 2048 score:', err);
      toast.error('Failed to submit score. Please try again.', { autoClose: 4000 });
    } finally {
      setIsSubmittingScore(false);
    }
  }, [user, scoreSubmitted, isSubmittingScore, game, dispatch, fetchLeaderboard]);

  // Fetch data for whichever tab is opened.
  useEffect(() => {
    if (view === 'leaderboard') fetchLeaderboard();
    else if (view === 'saved') fetchSavedGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, user]);

  return (
    <div className="g2048-space" id="game2048-space">
      <SEO
        title="2048"
        description="Play a custom 2048 tile-merging game in your browser. Swipe, drag, or use arrow keys/WASD, save your progress, and climb the public leaderboard."
        path="/2048"
      />
      <Header />
      <main className="g2048-main">
        <h1 className="g2048-title">2048</h1>

        {/*
          Sub-nav tabs. The board is always rendered by default (view starts
          as 'play'), so a tab labeled "Play" sitting next to an
          already-visible board read as a confusing "start" button. Renaming
          it to "Game" makes clear it's just the section label, and disabling
          + aria-current'ing whichever tab is already active (instead of
          leaving every tab clickable all the time) makes the current
          section obvious and stops clicks on an already-open tab from
          looking like they should do something.
        */}
        <nav className="g2048-subnav" aria-label="2048 sections">
          {[
            { key: 'play', label: 'Game' },
            { key: 'leaderboard', label: 'Leaderboard' },
            { key: 'saved', label: 'Saved Games' },
            { key: 'help', label: 'How to Play' },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={view === key ? 'active' : ''}
              aria-current={view === key ? 'page' : undefined}
              disabled={view === key}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        {view === 'play' && (
          <>
            <div className="g2048-scoreboard">
              <div className="g2048-score-box">
                <span className="g2048-score-box__label">Score</span>
                <span className="g2048-score-box__value">{game.score.toLocaleString()}</span>
              </div>
              <div className="g2048-score-box">
                <span className="g2048-score-box__label">Best</span>
                <span className="g2048-score-box__value">{best.toLocaleString()}</span>
              </div>
              <div className="g2048-score-box">
                <span className="g2048-score-box__label">Moves</span>
                <span className="g2048-score-box__value">{game.moves}</span>
              </div>
            </div>

            <div className="g2048-board-wrap">
              <Game2048Board
                tiles={game.tiles}
                size={SIZE}
                disabled={inputLocked || game.gameOver}
                onMove={handleMove}
              />
              {game.gameOver && (
                <div className="g2048-gameover-overlay">
                  <div className="g2048-gameover-card">
                    <h2>Game Over</h2>
                    <p>Final score: <strong>{game.score.toLocaleString()}</strong></p>
                    <div className="g2048-gameover-actions">
                      <button type="button" className="g2048-btn g2048-btn--primary" onClick={newGame}>New Game</button>
                      {user ? (
                        <button
                          type="button"
                          className="g2048-btn g2048-btn--ghost"
                          onClick={submitScore}
                          disabled={isSubmittingScore || scoreSubmitted}
                        >
                          {scoreSubmitted ? 'Score Submitted ✓' : (isSubmittingScore ? 'Submitting…' : 'Submit Score')}
                        </button>
                      ) : (
                        <Link className="g2048-btn g2048-btn--ghost" to="/login">Log in to submit score</Link>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="g2048-controls">
              <button type="button" className="g2048-btn g2048-btn--primary" onClick={newGame}>New Game</button>
              {user ? (
                <button type="button" className="g2048-btn g2048-btn--ghost" onClick={saveGame} disabled={isSaving}>
                  {isSaving ? 'Saving…' : '💾 Save Game'}
                </button>
              ) : (
                <Link className="g2048-btn g2048-btn--ghost" to="/login">Log in to save</Link>
              )}
            </div>
            <p className="g2048-hint">Arrow keys / WASD, swipe on mobile, or click-and-drag to move tiles.</p>
          </>
        )}

        {view === 'leaderboard' && (
          <Game2048Leaderboard
            entries={leaderboard}
            isLoading={leaderboardLoading}
            error={leaderboardError}
            onRefresh={fetchLeaderboard}
          />
        )}

        {view === 'saved' && (
          <Game2048SavedGames
            user={user}
            saves={savedGames}
            isLoading={savedGamesLoading}
            error={savedGamesError}
            onContinue={continueGame}
            onDelete={deleteSave}
            onRefresh={() => fetchSavedGames()}
          />
        )}

        {view === 'help' && (
          <div className="g2048-panel">
            <h2>How to Play</h2>
            <ul className="g2048-help-list">
              <li>Use the <strong>Arrow keys</strong> or <strong>W / A / S / D</strong>, <strong>swipe</strong> on a touchscreen, or <strong>click-and-drag</strong> with a mouse to slide every tile in one direction.</li>
              <li>When two tiles with the <strong>same number</strong> collide, they merge into one tile with double the value, and that value is added to your score.</li>
              <li>After every move that changes the board, a new tile (a 2, usually, occasionally a 4) appears in a random empty spot.</li>
              <li>Reaching the <strong>2048</strong> tile shows a one-time congratulations banner — but the board never locks, so keep merging toward 4096, 8192, and beyond for a higher score.</li>
              <li>The game ends when the board is full and no two adjacent tiles share a value.</li>
              <li>Your personal best score is remembered on this device even as a guest. Log in to manually <strong>Save Game</strong> for later, and to <strong>Submit Score</strong> to the public leaderboard.</li>
            </ul>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

export default Game2048;
