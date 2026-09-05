import React, { useEffect, useMemo, useRef, useState } from 'react';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

// Filled chess glyphs for both colors — color is applied with CSS so the
// pieces look identical across every platform and operating system.
// The U+FE0E variation selector forces text (not emoji) presentation.
const GLYPH = {
  k: '\u265A\uFE0E',
  q: '\u265B\uFE0E',
  r: '\u265C\uFE0E',
  b: '\u265D\uFE0E',
  n: '\u265E\uFE0E',
  p: '\u265F\uFE0E',
};

const PROMOTION_PIECES = ['q', 'r', 'b', 'n'];
const PROMOTION_LABELS = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

function squareName(fileIndex, rank) {
  return `${FILES[fileIndex]}${rank}`;
}

function isPawnPromotion(piece, toSquare) {
  if (!piece || piece.type !== 'p') return false;
  const rank = Number(toSquare[1]);
  return (piece.color === 'w' && rank === 8) || (piece.color === 'b' && rank === 1);
}

/**
 * A chess board that renders whatever position the supplied `chess` instance
 * holds and never mutates it — the parent owns the game and calls `onMove`
 * when a legal move is completed.
 *
 * Supports both click-to-move and pointer drag-and-drop.
 */
function ChessBoard({
  chess,
  orientation = 'white',
  interactive = false,
  onMove,
  disabled = false,
  showCoordinates = true,
}) {
  const [selected, setSelected] = useState(null);
  const [targets, setTargets] = useState([]);
  const [pendingPromotion, setPendingPromotion] = useState(null);
  const [drag, setDrag] = useState(null); // { from, color, type, x, y }

  const dragRef = useRef(null); // { from, piece, targets }
  const didDragRef = useRef(false);
  const boardWrapRef = useRef(null);
  const onMoveRef = useRef(onMove);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  const fen = chess.fen();
  const turn = chess.turn();

  // Reset transient selection state whenever the position changes.
  useEffect(() => {
    setSelected(null);
    setTargets([]);
    setPendingPromotion(null);
  }, [fen]);

  const lastMove = useMemo(() => {
    const history = chess.history({ verbose: true });
    if (!history.length) return null;
    const last = history[history.length - 1];
    return { from: last.from, to: last.to };
  }, [fen, chess]);

  const checkSquare = useMemo(() => {
    if (!chess.isCheck()) return null;
    const board = chess.board();
    for (let r = 0; r < 8; r += 1) {
      for (let f = 0; f < 8; f += 1) {
        const cell = board[r][f];
        if (cell && cell.type === 'k' && cell.color === turn) return cell.square;
      }
    }
    return null;
  }, [fen, chess, turn]);

  const pieceAt = (square) => {
    const board = chess.board();
    for (let r = 0; r < 8; r += 1) {
      for (let f = 0; f < 8; f += 1) {
        const cell = board[r][f];
        if (cell && cell.square === square) return cell;
      }
    }
    return null;
  };

  const handleSquareClick = (square) => {
    if (!interactive || disabled || pendingPromotion) return;
    // A click that immediately follows a drag should not trigger a move.
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    if (selected && targets.includes(square)) {
      const piece = pieceAt(selected);
      if (isPawnPromotion(piece, square)) {
        setPendingPromotion({ from: selected, to: square });
        return;
      }
      if (onMoveRef.current) onMoveRef.current({ from: selected, to: square, promotion: 'q' });
      setSelected(null);
      setTargets([]);
      return;
    }

    const piece = pieceAt(square);
    if (piece && piece.color === turn) {
      setSelected(square);
      const moves = chess.moves({ square, verbose: true });
      setTargets(moves.map((m) => m.to));
    } else {
      setSelected(null);
      setTargets([]);
    }
  };

  // ── Drag and drop ──────────────────────────────────────────
  const handlePointerDown = (square, e) => {
    if (!interactive || disabled || pendingPromotion) return;
    const piece = pieceAt(square);
    if (!piece || piece.color !== turn) return;

    const moves = chess.moves({ square, verbose: true });
    const moveTargets = moves.map((m) => m.to);
    if (!moveTargets.length) return;

    dragRef.current = { from: square, piece, targets: moveTargets };
    didDragRef.current = false;

    const rect = boardWrapRef.current.getBoundingClientRect();
    setDrag({
      from: square,
      color: piece.color,
      type: piece.type,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });

    if (e.cancelable) e.preventDefault();

    const handleMove = (ev) => {
      const r = boardWrapRef.current.getBoundingClientRect();
      setDrag((d) => (d ? { ...d, x: ev.clientX - r.left, y: ev.clientY - r.top } : d));
    };

    const handleUp = (ev) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);

      const from = dragRef.current && dragRef.current.from;
      const draggedPiece = dragRef.current && dragRef.current.piece;
      const dragTargets = (dragRef.current && dragRef.current.targets) || [];

      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const squareEl = el && el.closest ? el.closest('.chess-square') : null;
      const to = squareEl ? squareEl.getAttribute('aria-label') : null;

      if (from && to && dragTargets.includes(to)) {
        if (isPawnPromotion(draggedPiece, to)) {
          setPendingPromotion({ from, to });
        } else if (onMoveRef.current) {
          onMoveRef.current({ from, to, promotion: 'q' });
        }
        didDragRef.current = true;
      }

      dragRef.current = null;
      setDrag(null);
      setSelected(null);
      setTargets([]);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const choosePromotion = (promotion) => {
    if (!pendingPromotion) return;
    if (onMoveRef.current) {
      onMoveRef.current({ from: pendingPromotion.from, to: pendingPromotion.to, promotion });
    }
    setPendingPromotion(null);
    setSelected(null);
    setTargets([]);
  };

  // Build the 8×8 grid. chess.board() row 0 is rank 8; flip for black.
  const rawRows = [];
  for (let r = 0; r < 8; r += 1) {
    const rank = 8 - r;
    const cells = [];
    for (let f = 0; f < 8; f += 1) {
      cells.push({ square: squareName(f, rank), piece: chess.board()[r][f] });
    }
    rawRows.push({ rank, cells });
  }
  const rows = orientation === 'white' ? rawRows : [...rawRows].reverse();

  return (
    <div className="chess-board-wrap" ref={boardWrapRef}>
      <div className="chess-board" role="grid" aria-label="Chess board">
        {rows.map((row) =>
          row.cells.map(({ square, piece }) => {
            const fileIndex = FILES.indexOf(square[0]);
            const rank = Number(square[1]);
            const isLight = (fileIndex + rank) % 2 === 0;
            const isDraggedFrom = drag && drag.from === square;

            const classes = ['chess-square'];
            classes.push(isLight ? 'chess-square--light' : 'chess-square--dark');
            if (square === selected) classes.push('chess-square--selected');
            if (lastMove && square === lastMove.from) classes.push('chess-square--last-from');
            if (lastMove && square === lastMove.to) classes.push('chess-square--last-to');
            if (square === checkSquare) classes.push('chess-square--check');
            if (targets.includes(square)) {
              classes.push(piece ? 'chess-square--capture' : 'chess-square--target');
            }

            // Rank labels on the left and right edges; file labels top/bottom.
            const showFile = rank === 1 || rank === 8;
            const showRank = fileIndex === 0 || fileIndex === 7;

            return (
              <button
                type="button"
                key={square}
                className={classes.join(' ')}
                onClick={() => handleSquareClick(square)}
                onPointerDown={(e) => handlePointerDown(square, e)}
                disabled={!interactive || disabled}
                aria-label={square}
              >
                {showCoordinates && showRank && (
                  <span className="chess-coord chess-coord--rank">{rank}</span>
                )}
                {piece && !isDraggedFrom && (
                  <span
                    className={`chess-piece chess-piece--${piece.color}`}
                    aria-hidden="true"
                  >
                    {GLYPH[piece.type]}
                  </span>
                )}
                {showCoordinates && showFile && (
                  <span className="chess-coord chess-coord--file">{square[0]}</span>
                )}
              </button>
            );
          }),
        )}
      </div>

      {drag && (
        <span
          className={`chess-piece chess-piece--drag chess-piece--${drag.color}`}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          {GLYPH[drag.type]}
        </span>
      )}

      {pendingPromotion && (
        <div className="chess-promotion" role="dialog" aria-label="Choose promotion piece">
          {PROMOTION_PIECES.map((p) => (
            <button
              type="button"
              key={p}
              className="chess-promotion-btn"
              onClick={() => choosePromotion(p)}
              aria-label={`Promote to ${PROMOTION_LABELS[p]}`}
            >
              <span className={`chess-piece chess-piece--${turn}`}>{GLYPH[p]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ChessBoard;
