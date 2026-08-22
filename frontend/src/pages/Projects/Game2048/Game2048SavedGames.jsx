import React from 'react';
import { Link } from 'react-router-dom';

/**
 * "Saved Games" view. Saving is explicit/manual only (never automatic on
 * every move) — see Game2048.jsx's `saveGame` handler. Logged-out visitors
 * can still play, they just get a friendly login prompt here instead of a
 * broken/empty list.
 */
function Game2048SavedGames({ user, saves, isLoading, error, onContinue, onDelete, onRefresh }) {
  if (!user) {
    return (
      <div className="g2048-panel">
        <h2>Saved Games</h2>
        <div className="g2048-empty">
          <p>Log in to save your game and pick up where you left off later.</p>
          <Link className="g2048-btn g2048-btn--primary" to="/login">Log in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="g2048-panel">
      <div className="g2048-panel__header">
        <h2>Saved Games</h2>
        <button type="button" className="g2048-btn g2048-btn--ghost" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      <p className="g2048-panel__hint">Saved manually from the Play tab — never auto-saved on every move.</p>

      {error && <div className="g2048-alert g2048-alert--error">{error}</div>}

      {!error && !isLoading && saves.length === 0 && (
        <div className="g2048-empty">No saved games yet. Play a round and hit "Save Game" to create one.</div>
      )}

      {saves.length > 0 && (
        <ul className="g2048-saves">
          {saves.map((save) => (
            <li className="g2048-saves__row" key={save.id}>
              <div className="g2048-saves__info">
                <div className="g2048-saves__score">Score: {save.score.toLocaleString()}</div>
                <div className="g2048-saves__meta">Moves: {save.moves} · Saved {save.savedAtLabel}</div>
              </div>
              <div className="g2048-saves__actions">
                <button type="button" className="g2048-btn g2048-btn--primary" onClick={() => onContinue(save)}>
                  Continue
                </button>
                <button type="button" className="g2048-btn g2048-btn--danger" onClick={() => onDelete(save.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default Game2048SavedGames;
