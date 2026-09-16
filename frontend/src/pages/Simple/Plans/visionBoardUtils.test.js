import {
  BOARD_SCOPES,
  SCOPE_LABELS,
  boardCountLabel,
  boardMetaLine,
  costLine,
  parseBoard,
  parseBoards,
  resultLine,
  scopeCounts,
  scopeGlyph,
  toggleScope,
} from './visionBoardUtils';

/** A stored board record, as the backend writes it. */
const board = (over = {}) => ({
  version: 1,
  scope: 'dream',
  source: {
    total: 8,
    used: 3,
    truncated: 0,
    goals: [{ slug: 'a', title: 'Retire by the coast', horizon: 'life' }],
  },
  prompt: 'A wide empty beach at golden hour.',
  promptSource: 'model',
  aspectRatio: '16:9',
  model: 'stability.sd3-5-large-v1:0',
  style: { id: 'golden-warm', name: 'Golden warmth' },
  image: { url: 'https://cdn.example/board.png', s3Key: 'users/u1/generated/board.png', bytes: 1500000, recordId: 'vision_board_u1_1_ab' },
  generatedAt: '2026-09-16T10:00:00.000Z',
  ...over,
});

const entry = (record, over = {}) => ({
  kind: 'vision',
  slug: 'board-20260916-100000-dreams-ab',
  name: 'Vision board — dreams',
  updatedAt: '2026-09-16T10:00:05.000Z',
  content: typeof record === 'string' ? record : JSON.stringify(record),
  ...over,
});

describe('visionBoardUtils · reading a stored board', () => {
  test('a good record becomes a board', () => {
    const parsed = parseBoard(entry(board()));
    expect(parsed).toMatchObject({
      slug: 'board-20260916-100000-dreams-ab',
      scope: 'dream',
      url: 'https://cdn.example/board.png',
      s3Key: 'users/u1/generated/board.png',
      bytes: 1500000,
      prompt: 'A wide empty beach at golden hour.',
      promptSource: 'model',
      generatedAt: '2026-09-16T10:00:00.000Z',
      used: 3,
      total: 8,
    });
    expect(parsed.goals).toEqual([{ slug: 'a', title: 'Retire by the coast', horizon: 'life' }]);
  });

  test('junk is "no board", never an exception', () => {
    // The gallery must survive a corrupt row, an old row, and a row whose image
    // was deleted out from under it.
    expect(parseBoard(null)).toBeNull();
    expect(parseBoard({})).toBeNull();
    expect(parseBoard(entry('{not json'))).toBeNull();
    expect(parseBoard(entry('null'))).toBeNull();
    expect(parseBoard(entry('"a string"'))).toBeNull();
    expect(parseBoard(entry(board({ image: {} })))).toBeNull();
    expect(parseBoard(entry(board({ image: { url: '' } })))).toBeNull();
    // No `image.recordId` (an older board) is still a renderable board.
    expect(parseBoard(entry(board({ image: { url: 'https://cdn.example/a.png' } }))).url)
      .toBe('https://cdn.example/a.png');
  });

  test('a missing or unknown scope is shown as "all goals", not as dreams', () => {
    expect(parseBoard(entry(board({ scope: 'nonsense' }))).scope).toBe('all');
    expect(parseBoard(entry(board({ scope: undefined }))).scope).toBe('all');
  });

  test('the prompt writer falling back is carried through, not hidden', () => {
    expect(parseBoard(entry(board({ promptSource: 'fallback' }))).promptSource).toBe('fallback');
    expect(parseBoard(entry(board({ promptSource: 'anything' }))).promptSource).toBe('model');
  });

  test('the board\'s look is read off the record, tolerantly', () => {
    expect(parseBoard(entry(board())).style).toBe('Golden warmth');
    // Ids have been through a rename or two, and a name is what the line wants.
    expect(parseBoard(entry(board({ style: 'coastal' }))).style).toBe('coastal');
    expect(parseBoard(entry(board({ style: { id: 'x' } }))).style).toBeNull();
    expect(parseBoard(entry(board({ style: { name: '   ' } }))).style).toBeNull();
    // A board made before looks existed still has to render.
    expect(parseBoard(entry(board({ style: undefined }))).style).toBeNull();
  });

  test('the list is newest first, whatever order the server sent', () => {
    const boards = parseBoards([
      entry(board({ generatedAt: '2026-09-01T10:00:00.000Z' }), { slug: 'old' }),
      entry(board({ generatedAt: '2026-09-16T10:00:00.000Z' }), { slug: 'new' }),
      entry('garbage', { slug: 'broken' }),
      entry(board({ generatedAt: '2026-09-10T10:00:00.000Z' }), { slug: 'middle' }),
    ]);
    expect(boards.map((b) => b.slug)).toEqual(['new', 'middle', 'old']);
  });

  test('a board with no generatedAt falls back to the item timestamp', () => {
    const parsed = parseBoard(entry(board({ generatedAt: undefined })));
    expect(parsed.generatedAt).toBe('2026-09-16T10:00:05.000Z');
    expect(parseBoards([entry(board({ generatedAt: undefined }))])).toHaveLength(1);
  });
});

describe('visionBoardUtils · saying what a board is', () => {
  test('the meta line names the source, the count, the look and the age', () => {
    // The look is what makes two boards of the same scope tellable apart, so it
    // belongs in the one line that describes a board.
    expect(boardMetaLine(parseBoard(entry(board())))).toBe('Dreams · 3 goals · Golden warmth');
    expect(boardMetaLine(parseBoard(entry(board())), { ago: '2 days ago' }))
      .toBe('Dreams · 3 goals · Golden warmth · 2 days ago');
    expect(boardMetaLine(parseBoard(entry(board({ source: { total: 1, used: 1, goals: [] } })))))
      .toBe('Dreams · 1 goal · Golden warmth');
    expect(boardMetaLine(null)).toBe('');
    // An older board with no look says everything else and simply omits it.
    expect(boardMetaLine(parseBoard(entry(board({ style: undefined }))))).toBe('Dreams · 3 goals');
  });

  test('a board made from part of the list says so', () => {
    const parsed = parseBoard(entry(board({ source: { total: 40, used: 24, truncated: 16, goals: [] } })));
    expect(boardMetaLine(parsed)).toBe('Dreams · 24 goals · Golden warmth · 16 left out');
  });

  test('a board the fallback prompt made says so too', () => {
    const parsed = parseBoard(entry(board({ promptSource: 'fallback' })));
    expect(boardMetaLine(parsed)).toBe('Dreams · 3 goals · Golden warmth · prompt written for you');
  });

  test('the count reads as English, and disappears at zero', () => {
    expect(boardCountLabel(0)).toBe('');
    expect(boardCountLabel(1)).toBe('1 board');
    expect(boardCountLabel(4)).toBe('4 boards');
  });

  test('the cost is one image per scope, and an empty scope is named', () => {
    expect(costLine(['dream'])).toBe('1 image · 1 credit');
    expect(costLine(['dream', 'all'])).toBe('2 images · 2 credits');
    expect(costLine(['dream'], { dreamCount: 0, allCount: 5 }))
      .toBe('1 image · 1 credit · Dreams would have nothing to draw from yet');
    expect(costLine([])).toBe('Pick at least one set of goals.');
    // An unknown scope can't take part in the count.
    expect(costLine(['nonsense'])).toBe('Pick at least one set of goals.');
  });

  test('scope toggling keeps the canonical order and never duplicates', () => {
    expect(toggleScope([], 'all')).toEqual(['all']);
    expect(toggleScope(['all'], 'dream')).toEqual(['dream', 'all']);
    expect(toggleScope(['dream', 'all'], 'dream')).toEqual(['all']);
    expect(toggleScope(['dream'], 'dream')).toEqual([]);
    expect(toggleScope(null, 'dream')).toEqual(['dream']);
    expect(BOARD_SCOPES).toEqual(['dream', 'all']);
    expect(scopeGlyph('dream')).not.toBe(scopeGlyph('all'));
    expect(scopeGlyph('nonsense')).toBe('🖼️');
    expect(SCOPE_LABELS.dream).toBe('Dreams');
  });

  test('the history counts what it has', () => {
    const boards = parseBoards([
      entry(board({ scope: 'dream' }), { slug: 'a' }),
      entry(board({ scope: 'all' }), { slug: 'b' }),
      entry(board({ scope: 'dream' }), { slug: 'c' }),
    ]);
    expect(scopeCounts(boards)).toEqual({ dream: 2, all: 1 });
    expect(scopeCounts(null)).toEqual({ dream: 0, all: 0 });
  });
});

describe('visionBoardUtils · reporting a generation result', () => {
  test('what was made is said first', () => {
    expect(resultLine({ boards: [{}, {}] })).toBe('Made 2 boards.');
    expect(resultLine({ boards: [{}] })).toBe('Made 1 board.');
  });

  test('a skipped scope is explained, not dropped', () => {
    const line = resultLine({
      boards: [{}],
      skipped: [{ scope: 'dream', reason: 'scope-empty' }],
    });
    expect(line).toBe('Made 1 board — Dreams: none of your goals are on that list yet.');
  });

  test('a scope that failed is named as a failure', () => {
    const line = resultLine({
      boards: [{}],
      failures: [{ scope: 'all', error: 'throttled' }],
    });
    expect(line).toBe('Made 1 board — could not make All goals.');
  });

  test('nothing made and nothing explained is its own sentence', () => {
    expect(resultLine({})).toBe('Nothing to make a board from yet.');
    expect(resultLine()).toBe('Nothing to make a board from yet.');
    expect(resultLine({ skipped: [{ scope: 'dream', reason: 'some-new-reason' }] }))
      .toBe('Dreams: some-new-reason.');
  });
});
