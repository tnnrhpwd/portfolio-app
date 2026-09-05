// Simple chess engine for the "Play Bot" tab.
//
// This is intentionally lightweight (no opening book, no deep search) so it
// runs instantly in the browser. It layers three difficulty levels on top of
// chess.js, which handles all move legality, check/checkmate and draw rules.

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const MATE = 100000;

// Piece-square tables (white's perspective, index 0 = a8 … index 63 = h1).
// Values nudge pieces toward good squares: pawns push toward the center and
// promotion, knights toward the middle, rooks toward open/center files.
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
};

const ZERO_TABLE = new Array(64).fill(0);

function squareIndex(square) {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0
  const rank = Number(square[1]);
  return (8 - rank) * 8 + file;
}

function mirroredIndex(index) {
  const row = Math.floor(index / 8);
  const file = index % 8;
  return (7 - row) * 8 + file;
}

// Static evaluation from White's perspective (positive = white is better).
function evaluate(chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? -MATE : MATE;
  if (chess.isDraw() || chess.isStalemate()) return 0;

  const board = chess.board();
  let score = 0;
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      const sq = board[r][f];
      if (!sq) continue;
      const index = r * 8 + f;
      const table = PST[sq.type] || ZERO_TABLE;
      const pstIndex = sq.color === 'w' ? index : mirroredIndex(index);
      const value = PIECE_VALUES[sq.type] + table[pstIndex];
      score += sq.color === 'w' ? value : -value;
    }
  }
  return score;
}

function orderMoves(moves) {
  const captureValue = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  return moves.slice().sort(
    (a, b) => (captureValue[b.captured] || 0) - (captureValue[a.captured] || 0),
  );
}

function minimax(chess, depth, alpha, beta, maximizingWhite, deadline) {
  if (depth === 0 || chess.isGameOver() || Date.now() > deadline) {
    return evaluate(chess);
  }
  const moves = orderMoves(chess.moves({ verbose: true }));
  if (!moves.length) return evaluate(chess);

  if (maximizingWhite) {
    let best = -Infinity;
    for (const move of moves) {
      chess.move(move);
      const value = minimax(chess, depth - 1, alpha, beta, false, deadline);
      chess.undo();
      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    chess.move(move);
    const value = minimax(chess, depth - 1, alpha, beta, true, deadline);
    chess.undo();
    if (value < best) best = value;
    if (best < beta) beta = best;
    if (beta <= alpha) break;
  }
  return best;
}

function pickRandom(moves) {
  return moves[Math.floor(Math.random() * moves.length)];
}

function chooseAmongBest(scored, isWhite) {
  scored.sort((a, b) => (isWhite ? b.score - a.score : a.score - b.score));
  const top = scored.slice(0, Math.min(3, scored.length));
  return top[Math.floor(Math.random() * top.length)].move;
}

/**
 * Returns a legal move object ({ from, to, promotion }) for the side to move.
 * `difficulty` is one of 'easy' | 'medium' | 'hard'.
 */
export function getBotMove(chess, difficulty) {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;

  if (difficulty === 'easy') return pickRandom(moves);

  if (difficulty === 'medium') {
    const isWhite = chess.turn() === 'w';
    const scored = moves.map((move) => {
      chess.move(move);
      const score = evaluate(chess);
      chess.undo();
      return { move, score };
    });
    return chooseAmongBest(scored, isWhite);
  }

  // Hard: alpha-beta search, ~3 plies, with a wall-clock safety cutoff.
  const deadline = Date.now() + 1800;
  const isWhite = chess.turn() === 'w';
  const ordered = orderMoves(moves);

  let bestMove = null;
  let bestScore = isWhite ? -Infinity : Infinity;

  for (const move of ordered) {
    chess.move(move);
    const value = minimax(
      chess,
      2,
      -Infinity,
      Infinity,
      chess.turn() === 'w',
      deadline,
    );
    chess.undo();

    const jittered = value + Math.random() * 5;
    if (isWhite) {
      if (jittered > bestScore) {
        bestScore = jittered;
        bestMove = move;
      }
    } else if (jittered < bestScore) {
      bestScore = jittered;
      bestMove = move;
    }
    if (Date.now() > deadline) break;
  }

  return bestMove || pickRandom(moves);
}
