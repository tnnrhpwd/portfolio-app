import {
  DEFAULT_SIZE,
  WINNING_VALUE,
  createEmptyBoard,
  tilesToBoard,
  boardToTiles,
  encodeBoard,
  decodeBoard,
  getEmptyPositions,
  spawnTile,
  createInitialTiles,
  moveTiles,
  canMove,
  isGameOver,
  getMaxTileValue,
  hasWinningTile,
  getDirectionFromKey,
  getDirectionFromDelta,
} from './game2048Engine';

// Sequential id generator so tile identity is predictable/testable.
function makeIdGen() {
  let n = 0;
  return () => `id-${n++}`;
}

// A queue-based RNG mock: each call returns the next value from the queue
// (or the last value if the queue is exhausted), letting tests control both
// "which empty cell is picked" and "is it a 2 or a 4" deterministically.
function makeRngQueue(values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : values[values.length - 1]);
}

describe('board <-> tiles helpers', () => {
  test('createEmptyBoard creates a zero-filled board of the right size', () => {
    expect(createEmptyBoard(4)).toEqual(new Array(16).fill(0));
    expect(createEmptyBoard(2)).toEqual([0, 0, 0, 0]);
  });

  test('tilesToBoard places tile values at row*size+col', () => {
    const tiles = [
      { id: 'a', value: 2, row: 0, col: 0 },
      { id: 'b', value: 4, row: 1, col: 2 },
    ];
    const board = tilesToBoard(tiles, 4);
    expect(board[0]).toBe(2);
    expect(board[1 * 4 + 2]).toBe(4);
    expect(board.filter((v) => v !== 0)).toHaveLength(2);
  });

  test('boardToTiles is the inverse of tilesToBoard for occupied cells', () => {
    const board = createEmptyBoard(4);
    board[0] = 2;
    board[5] = 4;
    const idGen = makeIdGen();
    const tiles = boardToTiles(board, 4, idGen);
    expect(tiles).toHaveLength(2);
    expect(tiles).toEqual(
      expect.arrayContaining([
        { id: 'id-0', value: 2, row: 0, col: 0 },
        { id: 'id-1', value: 4, row: 1, col: 1 },
      ])
    );
  });

  test('encodeBoard/decodeBoard round-trip', () => {
    const board = createEmptyBoard(4);
    board[0] = 2;
    board[15] = 2048;
    const encoded = encodeBoard(board);
    expect(typeof encoded).toBe('string');
    expect(decodeBoard(encoded, 4)).toEqual(board);
  });

  test('decodeBoard tolerates malformed/short strings without throwing', () => {
    expect(decodeBoard('', 4)).toEqual(createEmptyBoard(4));
    expect(decodeBoard('2,4,not-a-number', 4)).toEqual([2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(decodeBoard(null, 4)).toEqual(createEmptyBoard(4));
  });
});

describe('getEmptyPositions', () => {
  test('returns every position when there are no tiles', () => {
    expect(getEmptyPositions([], 2)).toHaveLength(4);
  });

  test('excludes occupied positions', () => {
    const tiles = [{ id: 'a', value: 2, row: 0, col: 0 }];
    const empties = getEmptyPositions(tiles, 2);
    expect(empties).toHaveLength(3);
    expect(empties).not.toContainEqual({ row: 0, col: 0 });
  });
});

describe('spawnTile', () => {
  test('does nothing when the board is full', () => {
    const tiles = boardToTiles(new Array(4).fill(2), 2, makeIdGen());
    const result = spawnTile(tiles, 2, makeIdGen(), makeRngQueue([0]));
    expect(result.spawned).toBe(false);
    expect(result.tiles).toBe(tiles);
  });

  test('spawns a 2 ~90% of the time and a 4 ~10% of the time (via mocked rng)', () => {
    const idGen = makeIdGen();
    // rng() call 1 picks the empty-cell index, rng() call 2 picks the value.
    const low = spawnTile([], 2, idGen, makeRngQueue([0, 0.05]));
    expect(low.tile.value).toBe(2);

    const high = spawnTile([], 2, idGen, makeRngQueue([0, 0.95]));
    expect(high.tile.value).toBe(4);
  });

  test('only ever places the new tile in an empty cell', () => {
    const idGen = makeIdGen();
    const tiles = [{ id: 'a', value: 2, row: 0, col: 0 }];
    // Force rng to "pick" whatever index the empties array resolves to; run
    // many trials to make sure the occupied cell is never reused.
    for (let i = 0; i < 20; i++) {
      const rng = makeRngQueue([Math.random(), Math.random()]);
      const result = spawnTile(tiles, 2, idGen, rng);
      expect(result.tile.row === 0 && result.tile.col === 0).toBe(false);
    }
  });

  test('createInitialTiles spawns exactly two tiles', () => {
    const tiles = createInitialTiles(4, makeIdGen(), makeRngQueue([0, 0.1, 0.99, 0.1]));
    expect(tiles).toHaveLength(2);
  });
});

describe('moveTiles — sliding without merges', () => {
  test('slides tiles left, compacting gaps', () => {
    const tiles = [
      { id: 'a', value: 2, row: 0, col: 2 },
      { id: 'b', value: 4, row: 0, col: 3 },
    ];
    const result = moveTiles(tiles, 'left', 4);
    expect(result.moved).toBe(true);
    expect(result.scoreDelta).toBe(0);
    expect(result.tiles).toEqual(
      expect.arrayContaining([
        { id: 'a', value: 2, row: 0, col: 0, merged: false },
        { id: 'b', value: 4, row: 0, col: 1, merged: false },
      ])
    );
  });

  test('reports moved:false when nothing changes', () => {
    const tiles = [{ id: 'a', value: 2, row: 0, col: 0 }];
    const result = moveTiles(tiles, 'left', 4);
    expect(result.moved).toBe(false);
    expect(result.scoreDelta).toBe(0);
  });

  test('slides tiles right', () => {
    const tiles = [{ id: 'a', value: 2, row: 0, col: 0 }];
    const result = moveTiles(tiles, 'right', 4);
    expect(result.moved).toBe(true);
    expect(result.tiles[0]).toMatchObject({ row: 0, col: 3 });
  });

  test('slides tiles up', () => {
    const tiles = [{ id: 'a', value: 2, row: 3, col: 0 }];
    const result = moveTiles(tiles, 'up', 4);
    expect(result.moved).toBe(true);
    expect(result.tiles[0]).toMatchObject({ row: 0, col: 0 });
  });

  test('slides tiles down', () => {
    const tiles = [{ id: 'a', value: 2, row: 0, col: 0 }];
    const result = moveTiles(tiles, 'down', 4);
    expect(result.moved).toBe(true);
    expect(result.tiles[0]).toMatchObject({ row: 3, col: 0 });
  });

  test('throws on an invalid direction', () => {
    expect(() => moveTiles([], 'sideways', 4)).toThrow('Invalid direction');
  });
});

describe('moveTiles — merging', () => {
  test('merges two equal adjacent tiles and sums their value into score', () => {
    const tiles = [
      { id: 'a', value: 2, row: 0, col: 0 },
      { id: 'b', value: 2, row: 0, col: 1 },
    ];
    const result = moveTiles(tiles, 'left', 4);
    expect(result.moved).toBe(true);
    expect(result.scoreDelta).toBe(4);
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0]).toMatchObject({ value: 4, row: 0, col: 0, merged: true });
    expect(result.mergedIds).toContain(result.tiles[0].id);
  });

  test('a tile cannot merge twice in the same move (three-in-a-row rule)', () => {
    // [2, 2, 2, 0] moving left should become [4, 2, 0, 0], NOT [4, 4, 0, 0].
    const tiles = [
      { id: 'a', value: 2, row: 0, col: 0 },
      { id: 'b', value: 2, row: 0, col: 1 },
      { id: 'c', value: 2, row: 0, col: 2 },
    ];
    const result = moveTiles(tiles, 'left', 4);
    expect(result.scoreDelta).toBe(4); // only one merge happened
    const values = result.tiles.sort((x, y) => x.col - y.col).map((t) => t.value);
    expect(values).toEqual([4, 2]);
  });

  test('four equal tiles merge into two pairs, not one', () => {
    // [2, 2, 2, 2] moving left should become [4, 4, 0, 0].
    const tiles = [
      { id: 'a', value: 2, row: 0, col: 0 },
      { id: 'b', value: 2, row: 0, col: 1 },
      { id: 'c', value: 2, row: 0, col: 2 },
      { id: 'd', value: 2, row: 0, col: 3 },
    ];
    const result = moveTiles(tiles, 'left', 4);
    expect(result.scoreDelta).toBe(8);
    const values = result.tiles.sort((x, y) => x.col - y.col).map((t) => t.value);
    expect(values).toEqual([4, 4]);
  });

  test('merges correctly when sliding right', () => {
    const tiles = [
      { id: 'a', value: 8, row: 0, col: 0 },
      { id: 'b', value: 8, row: 0, col: 1 },
    ];
    const result = moveTiles(tiles, 'right', 4);
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0]).toMatchObject({ value: 16, row: 0, col: 3 });
    expect(result.scoreDelta).toBe(16);
  });

  test('merges correctly when sliding up and down (columns)', () => {
    const up = moveTiles(
      [
        { id: 'a', value: 4, row: 2, col: 1 },
        { id: 'b', value: 4, row: 3, col: 1 },
      ],
      'up',
      4
    );
    expect(up.tiles).toHaveLength(1);
    expect(up.tiles[0]).toMatchObject({ value: 8, row: 0, col: 1 });

    const down = moveTiles(
      [
        { id: 'a', value: 4, row: 0, col: 1 },
        { id: 'b', value: 4, row: 1, col: 1 },
      ],
      'down',
      4
    );
    expect(down.tiles).toHaveLength(1);
    expect(down.tiles[0]).toMatchObject({ value: 8, row: 3, col: 1 });
  });
});

describe('game-over / win detection', () => {
  test('canMove is true when there is any empty cell', () => {
    const tiles = [{ id: 'a', value: 2, row: 0, col: 0 }];
    expect(canMove(tiles, 4)).toBe(true);
    expect(isGameOver(tiles, 4)).toBe(false);
  });

  test('canMove is true on a full board with an adjacent equal pair', () => {
    // Fill a 2x2 board fully but leave one mergeable pair.
    const board = [2, 2, 4, 8];
    const tiles = boardToTiles(board, 2, makeIdGen());
    expect(canMove(tiles, 2)).toBe(true);
  });

  test('isGameOver is true on a full board with no possible merges', () => {
    const board = [2, 4, 4, 2]; // full 2x2, no equal neighbors (checkerboard)
    const tiles = boardToTiles(board, 2, makeIdGen());
    expect(canMove(tiles, 2)).toBe(false);
    expect(isGameOver(tiles, 2)).toBe(true);
  });

  test('getMaxTileValue / hasWinningTile', () => {
    const tiles = [
      { id: 'a', value: 1024, row: 0, col: 0 },
      { id: 'b', value: 2048, row: 0, col: 1 },
    ];
    expect(getMaxTileValue(tiles)).toBe(2048);
    expect(hasWinningTile(tiles)).toBe(true);
    expect(WINNING_VALUE).toBe(2048);
    expect(hasWinningTile([{ id: 'a', value: 4, row: 0, col: 0 }])).toBe(false);
  });
});

describe('input direction helpers', () => {
  test('getDirectionFromKey maps arrow keys', () => {
    expect(getDirectionFromKey('ArrowUp')).toBe('up');
    expect(getDirectionFromKey('ArrowDown')).toBe('down');
    expect(getDirectionFromKey('ArrowLeft')).toBe('left');
    expect(getDirectionFromKey('ArrowRight')).toBe('right');
  });

  test('getDirectionFromKey maps WASD case-insensitively', () => {
    expect(getDirectionFromKey('w')).toBe('up');
    expect(getDirectionFromKey('W')).toBe('up');
    expect(getDirectionFromKey('a')).toBe('left');
    expect(getDirectionFromKey('S')).toBe('down');
    expect(getDirectionFromKey('d')).toBe('right');
  });

  test('getDirectionFromKey returns null for unrelated keys', () => {
    expect(getDirectionFromKey('Enter')).toBeNull();
    expect(getDirectionFromKey('')).toBeNull();
    expect(getDirectionFromKey(null)).toBeNull();
    expect(getDirectionFromKey(undefined)).toBeNull();
  });

  test('getDirectionFromDelta requires clearing the threshold', () => {
    expect(getDirectionFromDelta(5, 5, 30)).toBeNull();
    expect(getDirectionFromDelta(40, 0, 30)).toBe('right');
    expect(getDirectionFromDelta(-40, 0, 30)).toBe('left');
    expect(getDirectionFromDelta(0, 40, 30)).toBe('down');
    expect(getDirectionFromDelta(0, -40, 30)).toBe('up');
  });

  test('getDirectionFromDelta picks the dominant axis', () => {
    expect(getDirectionFromDelta(50, 10, 5)).toBe('right');
    expect(getDirectionFromDelta(10, 50, 5)).toBe('down');
  });
});

describe('DEFAULT_SIZE', () => {
  test('is 4 (standard 2048 board)', () => {
    expect(DEFAULT_SIZE).toBe(4);
  });
});
