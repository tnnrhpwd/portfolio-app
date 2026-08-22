import React from 'react';

/**
 * Public leaderboard view — readable by everyone (including guests), backed
 * by the generic `/api/data/public` endpoint. Rendering uses plain JSX text
 * interpolation (never dangerouslySetInnerHTML), so even if a stored
 * nickname contained markup it would render as inert text, not run as HTML.
 */
function Game2048Leaderboard({ entries, isLoading, error, onRefresh }) {
  return (
    <div className="g2048-panel">
      <div className="g2048-panel__header">
        <h2>Leaderboard</h2>
        <button type="button" className="g2048-btn g2048-btn--ghost" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      <p className="g2048-panel__hint">Top scores submitted by players, worldwide and all-time.</p>

      {error && <div className="g2048-alert g2048-alert--error">{error}</div>}

      {!error && !isLoading && entries.length === 0 && (
        <div className="g2048-empty">No scores yet — be the first to reach the top!</div>
      )}

      {entries.length > 0 && (
        <ol className="g2048-leaderboard">
          {entries.map((entry, index) => (
            <li className="g2048-leaderboard__row" key={entry.id || index}>
              <span className="g2048-leaderboard__rank">#{index + 1}</span>
              <span className="g2048-leaderboard__name">{entry.name || 'Anonymous'}</span>
              <span className="g2048-leaderboard__tile">Tile {entry.tile || '—'}</span>
              <span className="g2048-leaderboard__score">{entry.score.toLocaleString()}</span>
              <span className="g2048-leaderboard__date">{entry.dateLabel}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default Game2048Leaderboard;
