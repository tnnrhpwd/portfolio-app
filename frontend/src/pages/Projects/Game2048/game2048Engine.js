// game2048Engine.js
//
// Pure, framework-free 2048 game logic. Every function here is deterministic
// given its inputs (RNG and ID generation are injected as parameters so the
// module is easy to unit test) and has no DOM/React dependencies, matching
// the "pure functions" requirement for the game engine.
//
// Board representation:
//   - A "tile" is { id, value, row, col } — tiles carry a stable id so a
//     React component can key off it and let CSS transitions animate the
//     tile sliding from its old row/col to its new one.
//   - A "board" is a flat array of length size*size (row-major), used for
//     game-over/win detection and for compact save/leaderboard encoding.

export const DEFAULT_SIZE = 4;
export const WINNING_VALUE = 2048;

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let idCounter = 0;

/** Default tile-id generator. Deterministic tests should pass their own. */
export function defaultIdGen() {
  idCounter += 1;
  return `tile-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Board <-> tiles helpers
// ---------------------------------------------------------------------------

export function createEmptyBoard(size = DEFAULT_SIZE) {
  return new Array(size * size).fill(0);
}

export function tilesToBoard(tiles, size = DEFAULT_SIZE) {
  const board = createEmptyBoard(size);
  tiles.forEach((t) => {
    board[t.row * size + t.col] = t.value;
  });
  return board;
}

export function boardToTiles(board, size = DEFAULT_SIZE, idGen = defaultIdGen) {
  const tiles = [];
  board.forEach((value, i) => {
    if (value) {
      tiles.push({ id: idGen(), value, row: Math.floor(i / size), col: i % size });
    }
  });
  return tiles;
}

/** Serialize a board to a compact comma-separated string (safe for the
 * pipe/colon-delimited `text` convention used by the generic Data model). */
export function encodeBoard(board) {
  return board.join(',');
}

export function decodeBoard(str, size = DEFAULT_SIZE) {
  if (!str) return createEmptyBoard(size);
  const values = str.split(',').map((v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  });
  // Pad/truncate defensively so a malformed save can't crash the board render.
  const board = createEmptyBoard(size);
  for (let i = 0; i < board.length; i++) {
    board[i] = values[i] || 0;
  }
  return board;
}

// ---------------------------------------------------------------------------
// Empty cell lookups
// ---------------------------------------------------------------------------

export function getEmptyPositions(tiles, size = DEFAULT_SIZE) {
  const occupied = new Set(tiles.map((t) => `${t.row}-${t.col}`));
  const positions = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!occupied.has(`${r}-${c}`)) positions.push({ row: r, col: c });
    }
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

/**
 * Spawn a new tile (90% chance of 2, 10% chance of 4) in a random empty
 * cell. Returns the original tiles array unchanged (spawned: false) when the
 * board is full.
 */
export function spawnTile(tiles, size = DEFAULT_SIZE, idGen = defaultIdGen, rng = Math.random) {
  const empties = getEmptyPositions(tiles, size);
  if (empties.length === 0) {
    return { tiles, spawned: false };
  }
  const pos = empties[Math.floor(rng() * empties.length)];
  const value = rng() < 0.9 ? 2 : 4;
  const tile = { id: idGen(), value, row: pos.row, col: pos.col };
  return { tiles: [...tiles, tile], spawned: true, tile };
}

/** Build a fresh board with two starting tiles (the standard 2048 opening). */
export function createInitialTiles(size = DEFAULT_SIZE, idGen = defaultIdGen, rng = Math.random) {
  let tiles = [];
  tiles = spawnTile(tiles, size, idGen, rng).tiles;
  tiles = spawnTile(tiles, size, idGen, rng).tiles;
  return tiles;
}

// ---------------------------------------------------------------------------
// Move / merge
// ---------------------------------------------------------------------------

/**
 * Slide + merge a single line of tiles (already sorted in traversal order,
 * i.e. index 0 is the tile closest to the destination edge). A tile may only
 * merge once per move — this mirrors real 2048 rules.
 */
function mergeLine(lineTiles) {
  const result = [];
  let i = 0;
  while (i < lineTiles.length) {
    if (i + 1 < lineTiles.length && lineTiles[i].value === lineTiles[i + 1].value) {
      result.push({
        id: lineTiles[i].id,
        value: lineTiles[i].value * 2,
        mergedFrom: [lineTiles[i].id, lineTiles[i + 1].id],
        removedId: lineTiles[i + 1].id,
      });
      i += 2;
    } else {
      result.push({
        id: lineTiles[i].id,
        value: lineTiles[i].value,
        mergedFrom: null,
        removedId: null,
      });
      i += 1;
    }
  }
  return result;
}

const VALID_DIRECTIONS = new Set(['up', 'down', 'left', 'right']);

/**
 * Apply a move in the given direction to a tile list.
 * Returns { tiles, moved, scoreDelta, mergedIds }:
 *   - tiles: new tile list (merged tiles keep the "leading" tile's id so
 *     React can key on it and animate the slide/merge via CSS transitions)
 *   - moved: whether the board actually changed (only then should a new
 *     tile be spawned)
 *   - scoreDelta: sum of newly-merged tile values (real-2048 scoring rule)
 *   - mergedIds: ids of tiles that were just created by a merge (useful for
 *     a "pop" animation class)
 */
export function moveTiles(tiles, direction, size = DEFAULT_SIZE) {
  if (!VALID_DIRECTIONS.has(direction)) {
    throw new Error(`Invalid direction: ${direction}`);
  }

  const lines = [];
  if (direction === 'left' || direction === 'right') {
    for (let r = 0; r < size; r++) {
      const lineTiles = tiles.filter((t) => t.row === r).sort((a, b) => a.col - b.col);
      lines.push({ tiles: direction === 'right' ? lineTiles.slice().reverse() : lineTiles, index: r });
    }
  } else {
    for (let c = 0; c < size; c++) {
      const lineTiles = tiles.filter((t) => t.col === c).sort((a, b) => a.row - b.row);
      lines.push({ tiles: direction === 'down' ? lineTiles.slice().reverse() : lineTiles, index: c });
    }
  }

  const newTiles = [];
  const mergedIds = [];
  let scoreDelta = 0;
  let moved = false;

  lines.forEach(({ tiles: lineTiles, index }) => {
    const merged = mergeLine(lineTiles);
    merged.forEach((entry, pos) => {
      let row;
      let col;
      if (direction === 'left') { row = index; col = pos; }
      else if (direction === 'right') { row = index; col = size - 1 - pos; }
      else if (direction === 'up') { row = pos; col = index; }
      else { row = size - 1 - pos; col = index; }

      const original = lineTiles.find((t) => t.id === entry.id);
      if (original.row !== row || original.col !== col) moved = true;

      newTiles.push({ id: entry.id, value: entry.value, row, col, merged: !!entry.mergedFrom });

      if (entry.mergedFrom) {
        moved = true;
        scoreDelta += entry.value;
        mergedIds.push(entry.id);
      }
    });
  });

  return { tiles: newTiles, moved, scoreDelta, mergedIds };
}

// ---------------------------------------------------------------------------
// Game state checks
// ---------------------------------------------------------------------------

export function canMove(tiles, size = DEFAULT_SIZE) {
  if (getEmptyPositions(tiles, size).length > 0) return true;
  const board = tilesToBoard(tiles, size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const val = board[r * size + c];
      if (c + 1 < size && board[r * size + c + 1] === val) return true;
      if (r + 1 < size && board[(r + 1) * size + c] === val) return true;
    }
  }
  return false;
}

export function isGameOver(tiles, size = DEFAULT_SIZE) {
  return !canMove(tiles, size);
}

export function getMaxTileValue(tiles) {
  return tiles.reduce((max, t) => Math.max(max, t.value), 0);
}

export function hasWinningTile(tiles) {
  return getMaxTileValue(tiles) >= WINNING_VALUE;
}

// ---------------------------------------------------------------------------
// Input helpers (keyboard / swipe / mouse-drag direction detection)
// ---------------------------------------------------------------------------

const KEY_DIRECTION_MAP = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

/** Map a KeyboardEvent.key (Arrow keys or WASD, case-insensitive) to a move direction, or null. */
export function getDirectionFromKey(key) {
  if (!key || typeof key !== 'string') return null;
  return KEY_DIRECTION_MAP[key.toLowerCase()] || null;
}

/**
 * Map a drag/swipe delta to a cardinal direction once it clears `threshold`
 * pixels of travel; used by both the mouse-drag and touch-swipe handlers.
 */
export function getDirectionFromDelta(dx, dy, threshold = 30) {
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
