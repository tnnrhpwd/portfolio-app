import React, { useCallback, useEffect, useRef } from 'react';
import { getDirectionFromKey, getDirectionFromDelta } from './game2048Engine';

const SWIPE_THRESHOLD = 30; // px of travel before a drag/swipe counts as a move
const DRAG_DEADZONE = 10; // px before we start suppressing page scroll on touch

/**
 * Renders the 4x4 (or size x size) tile board and wires up all three input
 * modes onto the same surface:
 *   - Keyboard: Arrow keys and WASD (handled at the document level so it
 *     works regardless of focus, mirroring Wordle's keydown listener).
 *   - Mouse drag: mousedown -> track window mousemove/mouseup -> direction.
 *   - Touch swipe: touchstart/touchmove/touchend, added as a non-passive
 *     native listener so we can preventDefault() and stop page scroll once a
 *     swipe is clearly underway.
 *
 * Input is intentionally "debounced" via the `disabled` prop (true while a
 * slide animation is in flight or the game is over) so rapid key mashing or
 * multi-touch can't desync the visual board from game state.
 */
function Game2048Board({ tiles, size, disabled, onMove }) {
  const boardRef = useRef(null);
  const dragState = useRef(null); // { x, y, dragging, suppressedScroll }

  const tryMove = useCallback((direction) => {
    if (!direction || disabled) return;
    onMove(direction);
  }, [disabled, onMove]);

  // ---- Keyboard (Arrow keys + WASD) ----
  useEffect(() => {
    const handleKeyDown = (event) => {
      const direction = getDirectionFromKey(event.key);
      if (!direction) return;
      // Don't hijack typing in text inputs elsewhere on the page (e.g. a
      // nickname field), matching Wordle's guard for INPUT/TEXTAREA targets.
      if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA')) {
        return;
      }
      event.preventDefault();
      tryMove(direction);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [tryMove]);

  // ---- Mouse drag ----
  const handleMouseDown = useCallback((event) => {
    dragState.current = { x: event.clientX, y: event.clientY, dragging: true };

    const handleMouseMove = (moveEvent) => {
      if (!dragState.current || !dragState.current.dragging) return;
      // Nothing to do while moving — direction is resolved on mouseup so a
      // single decisive drag maps to exactly one move.
      moveEvent.preventDefault();
    };

    const handleMouseUp = (upEvent) => {
      if (dragState.current && dragState.current.dragging) {
        const dx = upEvent.clientX - dragState.current.x;
        const dy = upEvent.clientY - dragState.current.y;
        tryMove(getDirectionFromDelta(dx, dy, SWIPE_THRESHOLD));
      }
      dragState.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [tryMove]);

  // ---- Touch swipe ----
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return undefined;

    let start = null;
    let suppressingScroll = false;

    const onTouchStart = (event) => {
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY };
      suppressingScroll = false;
    };

    const onTouchMove = (event) => {
      if (!start) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!suppressingScroll && (Math.abs(dx) > DRAG_DEADZONE || Math.abs(dy) > DRAG_DEADZONE)) {
        suppressingScroll = true;
      }
      if (suppressingScroll) {
        // Stop the page from scrolling once the user is clearly swiping the board.
        event.preventDefault();
      }
    };

    const onTouchEnd = (event) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      start = null;
      tryMove(getDirectionFromDelta(dx, dy, SWIPE_THRESHOLD));
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [tryMove]);

  const cells = [];
  for (let i = 0; i < size * size; i++) cells.push(i);

  return (
    <div
      className={`g2048-board${disabled ? ' g2048-board--locked' : ''}`}
      ref={boardRef}
      onMouseDown={handleMouseDown}
      role="application"
      aria-label="2048 game board. Use arrow keys, WASD, swipe, or click-drag to move tiles."
    >
      <div className="g2048-board__grid">
        {cells.map((i) => (
          <div className="g2048-board__cell" key={`cell-${i}`} />
        ))}
      </div>
      <div className="g2048-board__tiles">
        {tiles.map((tile) => (
          <div
            key={tile.id}
            className={`g2048-tile g2048-tile--v${tile.value <= 8192 ? tile.value : 'high'}${tile.merged ? ' g2048-tile--merged' : ''}`}
            style={{ '--row': tile.row, '--col': tile.col }}
            data-value={tile.value}
          >
            {tile.value}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Game2048Board;
