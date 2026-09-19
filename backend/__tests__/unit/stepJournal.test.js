/**
 * stepJournal.test.js — the turn record, and what it is allowed to contain.
 *
 * Two things are being pinned here, and the second matters more than the first:
 *
 *   1. the ring arithmetic (bounds, newest-first, one write per turn)
 *   2. **the redaction rule** — a journal is a report, not a transcript. For the
 *      tools whose arguments ARE the user's private writing, the values are
 *      withheld entirely; everything else is clipped. A single leak here puts a
 *      note body or a support message into a record that a later screen renders.
 */

const journal = require('../../services/harness/stepJournal.js');

/**
 * In-memory store, mirroring the shape the DynamoDB one exposes — INCLUDING its
 * revision and its conditional write, because the lost-race path is the point.
 */
function memStore() {
  const rows = new Map();
  return {
    rows,
    async load(userId) {
      const row = rows.get(userId);
      return row ? { runs: row.runs, revision: row.revision } : { runs: [], revision: null };
    },
    async save(userId, runs, { expectedRevision = null } = {}) {
      const row = rows.get(userId);
      if ((row?.revision ?? null) !== expectedRevision) {
        const err = new Error('the conditional request failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      revisionSeq += 1;
      rows.set(userId, { runs, revision: `rev-${revisionSeq}` });
    },
  };
}

let revisionSeq = 0;

let store;

beforeEach(() => {
  store = memStore();
  journal.setRunStoreForTests(store);
});

afterAll(() => {
  journal.setRunStoreForTests(null);
});

describe('describeStepArgs', () => {
  test('keeps code-shaped arguments, clipped', () => {
    expect(journal.describeStepArgs('repo_edit_file', {
      path: 'src/a.js',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    })).toEqual({
      preview: { path: 'src/a.js', old_string: 'const x = 1;', new_string: 'const x = 2;' },
      redacted: false,
      keys: [],
    });
  });

  test('withholds the VALUES of tools whose arguments are the user\'s own writing', () => {
    const result = journal.describeStepArgs('save_note', { text: 'my therapy appointment is Tuesday' });
    expect(result.redacted).toBe(true);
    expect(result.preview).toBeNull();
    // The names are kept so the UI can say "private argument: text" without
    // saying what it was.
    expect(result.keys).toEqual(['text']);
    expect(JSON.stringify(result)).not.toContain('therapy');
  });

  test.each([
    ['save_goal', 'title'],
    ['submit_support_ticket', 'message'],
    ['update_memory', 'content'],
    ['log_action', 'text'],
  ])('%s is private too', (tool, key) => {
    expect(journal.describeStepArgs(tool, { [key]: 'secret' })).toMatchObject({ redacted: true, preview: null });
  });

  test('clips long values rather than dropping or storing them whole', () => {
    const preview = journal.describeStepArgs('repo_read_file', {
      path: 'src/a.js',
      offset: 800,
      huge: 'x'.repeat(9000),
      big: 'y'.repeat(300),
    }).preview;

    expect(preview.offset).toBe(800);
    expect(preview.huge).toBe('[string, 9000 chars]');
    expect(preview.big).toBe(`${'y'.repeat(120)}…`);
  });

  test('data URLs never reach the record, whatever the key', () => {
    const preview = journal.describeStepArgs('generate_image', {
      prompt: 'a fox',
      data: `data:image/png;base64,${'A'.repeat(5000)}`,
    }).preview;
    expect(preview.prompt).toBe('a fox');
    expect(preview.data).toBe('[data-url, 5022 chars]');
  });

  test('arrays and nested objects become counts and bounded strings', () => {
    const preview = journal.describeStepArgs('save_goals', null).preview; // private tool, no args
    expect(preview).toBeNull();
    const other = journal.describeStepArgs('calculate', {
      items: [1, 2, 3, 4],
      options: { deep: { deeper: true } },
      nothing: null,
    }).preview;
    expect(other.items).toBe('[4 item(s)]');
    expect(other.options).toBe('{"deep":{"deeper":true}}');
    expect(other.nothing).toBeNull();
  });

  test('missing or non-object arguments are not an error', () => {
    expect(journal.describeStepArgs('calculate', null)).toEqual({ preview: null, redacted: false, keys: [] });
    expect(journal.describeStepArgs('calculate', undefined)).toEqual({ preview: null, redacted: false, keys: [] });
    expect(journal.describeStepArgs('calculate', [1, 2])).toEqual({ preview: null, redacted: false, keys: [] });
    expect(journal.describeStepArgs('calculate', {})).toEqual({ preview: {}, redacted: false, keys: [] });
  });
});

describe('step lifecycle', () => {
  test('start → complete records status, duration, plane and a bounded preview', async () => {
    const run = journal.createRun({ userId: 'u1', provider: 'bedrock', model: 'm', message: 'hi' });
    const step = journal.startStep(run, {
      tool: 'repo_search',
      args: { query: 'MARKER' },
      round: 2,
      label: 'Searching the repository…',
      plane: 'repo',
    });

    expect(step).toMatchObject({ index: 1, tool: 'repo_search', plane: 'repo', status: 'running', ms: null });
    expect(step.argsPreview).toEqual({ query: 'MARKER' });

    const done = journal.completeStep(step, { result: '2 matching line(s)' });
    expect(done.status).toBe('ok');
    expect(done.ms).toBeGreaterThanOrEqual(0);
    expect(done.resultPreview).toBe('2 matching line(s)');
    expect(done).toBe(step); // same record: the client updates one row
  });

  test('an "Error:" result is an error step even without a thrown exception', () => {
    const run = journal.createRun({ userId: 'u1' });
    const step = journal.startStep(run, { tool: 'repo_read_file' });
    expect(journal.completeStep(step, { result: 'Error: invalid file path.' }).status).toBe('error');
  });

  test('a refusal is its own status, not a tick beside a step that never ran', () => {
    const run = journal.createRun({ userId: 'u1' });
    const denied = journal.startStep(run, { tool: 'repo_commit_changes' });
    expect(journal.completeStep(denied, { result: 'Denied: you declined' }).status).toBe('denied');

    const cancelled = journal.startStep(run, { tool: 'repo_write_file' });
    expect(journal.completeStep(cancelled, { result: 'Cancelled: the user stopped the turn before this step ran.' }).status)
      .toBe('denied');

    // Still a real error when the executor threw — a denial must not mask it.
    const threw = journal.startStep(run, { tool: 'repo_push' });
    expect(journal.completeStep(threw, { result: 'Error: boom', error: new Error('boom') }).status).toBe('error');
  });

  test('a thrown error is recorded as the message, not the object', () => {
    const run = journal.createRun({ userId: 'u1' });
    const step = journal.startStep(run, { tool: 'repo_push' });
    const done = journal.completeStep(step, { result: '', error: new Error('not confirmed') });
    expect(done).toMatchObject({ status: 'error', error: 'not confirmed' });
  });

  test('a huge tool result is previewed, not stored', () => {
    const run = journal.createRun({ userId: 'u1' });
    const step = journal.startStep(run, { tool: 'repo_read_file' });
    journal.completeStep(step, { result: 'z'.repeat(40000) });
    expect(step.resultPreview.length).toBeLessThan(200);
    expect(step.resultPreview).toMatch(/\[40000 chars\]$/);
  });

  test('steps are capped, and the overflow is counted rather than silently dropped', () => {
    const run = journal.createRun({ userId: 'u1' });
    for (let i = 0; i < journal.MAX_STEPS + 5; i++) journal.startStep(run, { tool: 'calculate' });
    expect(run.steps).toHaveLength(journal.MAX_STEPS);
    expect(run.stepsDropped).toBe(5);
    expect(journal.startStep(run, { tool: 'calculate' })).toBeNull();
  });

  test('no run means no steps and no crash', () => {
    expect(journal.startStep(null, { tool: 'calculate' })).toBeNull();
    expect(journal.completeStep(null, { result: 'x' })).toBeNull();
  });
});

describe('fitRuns — the item budget', () => {
  const huge = (id) => ({ id, steps: [{ resultPreview: 'x'.repeat(journal.RUN_ITEM_MAX_CHARS) }] });

  test('drops the OLDEST runs first, and stays inside the budget', () => {
    const out = journal.fitRuns([huge('new'), huge('mid'), huge('old')]);

    expect(out.runs[0].id).toBe('new');
    expect(out.runs.map((r) => r.id)).not.toContain('old');
    expect(out.dropped).toBeGreaterThan(0);
    expect(JSON.stringify(out.runs).length).toBeLessThanOrEqual(journal.RUN_ITEM_MAX_CHARS);
  });

  test('trims the surviving record rather than losing the run entirely', () => {
    const out = journal.fitRuns([{ ...huge('only'), plan: { items: [{ text: 'x' }] } }]);

    expect(out.runs).toHaveLength(1);
    expect(out.trimmed).toBe(true);
    expect(out.runs[0].id).toBe('only');            // the run is still identifiable
    expect(out.runs[0].steps).toEqual([]);
    expect(out.runs[0].stepsTrimmed).toBe(1);       // …and says what it lost
    expect(out.runs[0].plan).toBeNull();
  });

  test('leaves a ring that fits exactly as it was', () => {
    const runs = [{ id: 'a', steps: [] }, { id: 'b', steps: [] }];
    expect(journal.fitRuns(runs)).toEqual({ runs, dropped: 0, trimmed: false });
    expect(runs[0].steps).toEqual([]);               // and does not mutate its input
  });
});

describe('finishRun — the per-user ring', () => {
  test('writes once, newest first, and is readable back', async () => {
    const run = journal.createRun({ userId: 'u1', provider: 'bedrock', model: 'm' });
    const step = journal.startStep(run, { tool: 'repo_search' });
    journal.completeStep(step, { result: 'ok' });
    run.rounds = 1;

    await journal.finishRun(run, { outcome: 'completed', usage: { total: 42 } });

    const runs = await journal.readRuns('u1');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: run.id, outcome: 'completed', rounds: 1, usage: { total: 42 } });
    expect(runs[0].steps).toHaveLength(1);
    expect(runs[0].at).toMatch(/^\d{4}-/);
  });

  test('caps at MAX_RUNS, keeping the newest', async () => {
    for (let i = 0; i < journal.MAX_RUNS + 3; i++) {
      const run = journal.createRun({ userId: 'u1' });
      run.rounds = i;
      await journal.finishRun(run, { outcome: 'completed' });
    }
    const runs = await journal.readRuns('u1');
    expect(runs).toHaveLength(journal.MAX_RUNS);
    expect(runs[0].rounds).toBe(journal.MAX_RUNS + 2); // newest first
  });

  test('never breaks the turn when the store is down', async () => {
    journal.setRunStoreForTests({
      async load() { throw new Error('table missing'); },
      async save() { throw new Error('table missing'); },
    });
    const run = journal.createRun({ userId: 'u1' });

    await expect(journal.finishRun(run, { outcome: 'cancelled' })).resolves.toEqual({ saved: false });
    await expect(journal.readRuns('u1')).resolves.toEqual([]);
  });

  test('a run with no user is not persisted', async () => {
    await expect(journal.finishRun(journal.createRun({}), { outcome: 'completed' }))
      .resolves.toEqual({ saved: false });
    expect(store.rows.size).toBe(0);
  });

  test('reports an untroubled save as untroubled', async () => {
    const run = journal.createRun({ userId: 'u1' });
    await expect(journal.finishRun(run, { outcome: 'completed' }))
      .resolves.toEqual({ saved: true, dropped: 0, trimmed: false });
  });

  test('a lost race is retried once and re-merged, so the other turn survives', async () => {
    const other = { id: 'other-run', at: '2026-01-01T00:00:00.000Z', steps: [] };
    let stored = [];
    let revision = null;
    let writes = 0;
    journal.setRunStoreForTests({
      async load() {
        // By the retry's read, the concurrent turn has committed — which is
        // exactly what a non-retrying save would have silently overwritten.
        if (writes === 1) { stored = [other]; revision = 'rev-2'; }
        return { runs: stored, revision };
      },
      async save(_userId, runs) {
        writes += 1;
        if (writes === 1) {
          const err = new Error('the conditional request failed');
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
        stored = runs;
        revision = `rev-${writes}`;
      },
    });

    const run = journal.createRun({ userId: 'u1' });
    await expect(journal.finishRun(run, { outcome: 'completed' })).resolves.toMatchObject({ saved: true });

    const runs = await journal.readRuns('u1');
    expect(runs.map((r) => r.id)).toEqual([run.id, 'other-run']);
  });

  test('a second conflict gives up rather than holding the turn open', async () => {
    journal.setRunStoreForTests({
      async load() { return { runs: [], revision: 'rev' }; },
      async save() {
        const err = new Error('the conditional request failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      },
    });

    const run = journal.createRun({ userId: 'u1' });
    await expect(journal.finishRun(run, { outcome: 'completed' })).resolves.toEqual({ saved: false });
  });

  test('tolerates a store that returns a bare array', async () => {
    // The harness scenario suite's fake still has this shape; a journal that
    // only understood `{runs, revision}` would break it on the read path.
    journal.setRunStoreForTests({
      async load() { return []; },
      async save() {},
    });

    const run = journal.createRun({ userId: 'u1' });
    await expect(journal.finishRun(run, { outcome: 'completed' })).resolves.toMatchObject({ saved: true });
    await expect(journal.readRuns('u1')).resolves.toEqual([]);
  });
});

describe('journalHooks', () => {
  const call = (name, args) => ({ id: `c_${name}`, function: { name, arguments: JSON.stringify(args) } });

  test('opens and closes the same record for a tool call', () => {
    const run = journal.createRun({ userId: 'u1' });
    const seen = [];
    const hooks = journal.journalHooks(run, { onStep: (s) => seen.push(s) });

    hooks.onToolStart({ toolCall: call('repo_search', { query: 'x' }), name: 'repo_search', round: 1 });
    hooks.onToolEnd({ toolCall: call('repo_search', { query: 'x' }), result: '2 matches', error: null });

    expect(run.steps).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[1]).toMatchObject({ tool: 'repo_search', plane: 'repo', status: 'ok', resultPreview: '2 matches' });
  });

  test('announces before the step exists, so a progress line can go out first', () => {
    const run = journal.createRun({ userId: 'u1' });
    const order = [];
    const hooks = journal.journalHooks(run, {
      onAnnounce: ({ name, label }) => order.push(['announce', name, label]),
      onStep: () => order.push(['step']),
    });

    hooks.onToolStart({ toolCall: call('repo_read_file', { path: 'a/b/Net.jsx' }), name: 'repo_read_file', round: 1 });

    expect(order[0]).toEqual(['announce', 'repo_read_file', 'Reading Net.jsx…']);
    expect(order[1]).toEqual(['step']);
  });

  test('an unmatched end is ignored, and no run means no hooks', () => {
    const run = journal.createRun({ userId: 'u1' });
    const hooks = journal.journalHooks(run, { onStep: jest.fn() });
    expect(() => hooks.onToolEnd({ toolCall: { id: 'never-seen' }, result: 'x' })).not.toThrow();
    expect(journal.journalHooks(null, {})).toEqual({});
  });

  test('redaction survives the whole path: a private argument is not in the record', () => {
    const run = journal.createRun({ userId: 'u1' });
    const hooks = journal.journalHooks(run);
    hooks.onToolStart({ toolCall: call('save_note', { text: 'private diary entry' }), name: 'save_note', round: 1 });

    expect(run.steps[0]).toMatchObject({ argsPreview: null, argsRedacted: true, argKeys: ['text'] });
    expect(JSON.stringify(run.steps[0])).not.toContain('diary');
  });
});
