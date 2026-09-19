/**
 * contextBudget.test.js — compaction that loses the least, and never a pair.
 *
 * The old behaviour truncated every middle message to 150 characters on a
 * message COUNT trigger. These cases pin the two things that replaces it:
 *
 *   1. the ORDER of loss — tool bulk goes before prose, and the newest results
 *      are untouched while the model is still reasoning about them;
 *   2. the INVARIANT — an `assistant.tool_calls` message and its `role:'tool'`
 *      results are removed together or not at all. Half a pair is a hard
 *      provider error, not a degradation, so every case here asserts the
 *      history is still a legal request afterwards.
 */

const {
  compactMessages,
  estimateTokens,
  totalChars,
  overBudget,
  maxContextChars,
  DEFAULT_MAX_CONTEXT_CHARS,
  THIN_MARK,
} = require('../../services/harness/contextBudget.js');

/** A legal tool round: the assistant's calls followed by one result per call. */
function toolRound(names, resultText) {
  const calls = names.map((name, i) => ({
    id: `call_${name}_${i}`,
    type: 'function',
    function: { name, arguments: JSON.stringify({ target: name }) },
  }));
  return [
    { role: 'assistant', content: '', tool_calls: calls },
    ...calls.map((c) => ({
      role: 'tool',
      tool_call_id: c.id,
      name: c.function.name,
      content: resultText,
    })),
  ];
}

/**
 * No `role:'tool'` message may exist without the call it answers above it. This
 * is the failure a filter-based compaction produces: drop the assistant message,
 * keep its results, and the request is rejected as malformed.
 */
function assertNoOrphanResults(messages) {
  const seenCalls = new Set();
  for (const message of messages) {
    if (message.role === 'tool') {
      expect(seenCalls).toContain(message.tool_call_id);
    }
    for (const call of message.tool_calls || []) seenCalls.add(call.id);
  }
}

/**
 * Every call answered before the next assistant turn — the stronger rule, for
 * histories that were legal to begin with. A trailing assistant message is
 * allowed to still be waiting: that is the model having just asked.
 */
function assertCallsAnswered(messages) {
  const pending = new Set();
  for (const message of messages) {
    if (message.role === 'tool') {
      expect(pending).toContain(message.tool_call_id);
      pending.delete(message.tool_call_id);
      continue;
    }
    const calls = message.tool_calls || [];
    if (calls.length === 0) continue;
    expect([...pending]).toEqual([]);
    for (const call of calls) pending.add(call.id);
  }
}

/** Both rules, for a history that had neither problem to begin with. */
function assertPairingIntact(messages) {
  assertNoOrphanResults(messages);
  assertCallsAnswered(messages);
}

describe('contextBudget — estimation', () => {
  it('estimates ~4 chars per token and tolerates null', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('counts tool ARGUMENTS, not just message text', () => {
    // The case that made a message-count trigger useless: one call carrying a
    // whole file as an argument.
    const fat = [{ role: 'assistant', content: '', tool_calls: [{
      id: 'c1', function: { name: 'repo_write_file', arguments: JSON.stringify({ content: 'x'.repeat(5000) }) },
    }] }];
    expect(totalChars(fat)).toBeGreaterThan(5000);
  });

  it('reports the budget state, and is disabled by a non-positive budget', () => {
    const messages = [{ role: 'user', content: 'x'.repeat(500) }];
    expect(overBudget(messages, 100)).toBe(true);
    expect(overBudget(messages, 5000)).toBe(false);
    expect(overBudget(messages, 0)).toBe(false);
    expect(overBudget(messages, undefined)).toBe(false);
  });
});

describe('contextBudget — under budget is a no-op', () => {
  it('leaves the history byte-identical when nothing needs doing', () => {
    const messages = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'hello' },
      ...toolRound(['fs_read'], 'small result'),
      { role: 'user', content: 'thanks' },
    ];
    const before = JSON.stringify(messages);

    const summary = compactMessages(messages, { maxChars: 100_000 });

    expect(summary).toMatchObject({ changed: false, omittedResults: 0, droppedSteps: 0, overBudget: false });
    expect(JSON.stringify(messages)).toBe(before);
  });
});

describe('contextBudget — phase 1 thins old tool bulk, keeping a headline', () => {
  it('keeps the envelope and the first line, and drops the body', () => {
    const big = `Error: 3 of 40 assertions failed\n${'stack line\n'.repeat(500)}`;
    const messages = [
      { role: 'user', content: 'run the tests' },
      ...toolRound(['repo_run'], big),          // oldest — gets thinned
      ...toolRound(['repo_run'], 'y'.repeat(4000)),
      ...toolRound(['repo_run'], 'z'.repeat(4000)),
      ...toolRound(['repo_run'], 'w'.repeat(4000)),
      ...toolRound(['repo_run'], 'v'.repeat(4000)), // newest 4 — protected
    ];

    // Untouched, this history is ~21.8K chars; thinning the one old result takes
    // it to ~16.3K. 20K therefore proves thinning ALONE is what got it under —
    // no step was dropped to reach it.
    const summary = compactMessages(messages, { maxChars: 20_000, keepRecent: 4 });

    expect(summary.changed).toBe(true);
    expect(summary.omittedResults).toBe(1);
    expect(summary.droppedSteps).toBe(0);

    const thinned = messages.find((m) => m.role === 'tool' && m.content.startsWith(THIN_MARK));
    expect(thinned).toBeDefined();
    // The id survives, so the pair is still legal…
    expect(thinned.tool_call_id).toBe('call_repo_run_0');
    // …the tool is named, so the model knows what it knows…
    expect(thinned.content).toContain('repo_run');
    // …and the verdict is still readable, which is the whole point of thinning.
    expect(thinned.content).toContain('Error: 3 of 40 assertions failed');
    expect(thinned.content).toContain('chars omitted');
    assertPairingIntact(messages);
  });

  it('never thins the newest results — the model is mid-reasoning on them', () => {
    const messages = [
      { role: 'user', content: 'go' },
      ...toolRound(['fs_read'], 'a'.repeat(3000)),
      ...toolRound(['fs_read'], 'b'.repeat(3000)),
    ];

    // A budget so tight that phase 1 would happily thin BOTH if it could.
    compactMessages(messages, { maxChars: 300, keepRecent: 2 });

    const toolMsgs = messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.every((m) => !m.content.startsWith(THIN_MARK))).toBe(true);
  });

  it('is idempotent — a second pass adds nothing', () => {
    const messages = [
      { role: 'user', content: 'go' },
      ...toolRound(['fs_read'], 'a'.repeat(3000)),
      ...toolRound(['fs_read'], 'b'.repeat(3000)),
      ...toolRound(['fs_read'], 'c'.repeat(3000)),
      ...toolRound(['fs_read'], 'd'.repeat(3000)),
    ];
    compactMessages(messages, { maxChars: 7000, keepRecent: 1 });
    const afterFirst = totalChars(messages);

    const second = compactMessages(messages, { maxChars: 7000, keepRecent: 1 });

    expect(second.omittedResults).toBe(0);
    expect(totalChars(messages)).toBe(afterFirst);
    assertPairingIntact(messages);
  });
});

describe('contextBudget — phase 2 drops an old step WHOLE', () => {
  it('removes the calls and every result together, and names them in a note', () => {
    const messages = [
      { role: 'system', content: 'harness prompt' },
      { role: 'user', content: 'fix the failing test' },
      ...toolRound(['repo_search', 'fs_read'], 'huge'.repeat(2000)),
      ...toolRound(['repo_edit_file'], 'edited'),
    ];

    const summary = compactMessages(messages, { maxChars: 3000, keepRecent: 0 });

    expect(summary.droppedSteps).toBe(1);
    expect(summary.droppedTools).toEqual(['repo_search', 'fs_read']);
    // Nothing of that step survives…
    expect(messages.some((m) => m.tool_call_id === 'call_repo_search_0')).toBe(false);
    expect(messages.some((m) => m.role === 'assistant' && m.tool_calls?.length === 2)).toBe(false);
    // …except the note saying it happened, so the model doesn't claim to have
    // never looked.
    const note = messages.find((m) => m.role === 'system' && m.content.includes('CONTEXT TRIMMED'));
    expect(note.content).toContain('repo_search');
    assertPairingIntact(messages);
  });

  it('leaves an INCOMPLETE pair alone rather than half-removing it', () => {
    // A call whose result never made it into history (the turn was cancelled
    // mid-round). Removing the call would orphan nothing and fix nothing —
    // the request would still be illegal — so it must be skipped.
    const messages = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', tool_calls: [
        { id: 'orphan_call', type: 'function', function: { name: 'fs_read', arguments: '{}' } },
      ] },
      ...toolRound(['repo_run'], 'x'.repeat(3000)),
      ...toolRound(['repo_run'], 'y'.repeat(3000)),
    ];

    const summary = compactMessages(messages, { maxChars: 100, keepRecent: 0 });

    // The orphan is still there, untouched…
    expect(messages.some((m) => m.tool_calls?.[0]?.id === 'orphan_call')).toBe(true);
    // …and BOTH complete pairs were dropped instead. Two, not one: the budget
    // here is deliberately impossible (100 chars), so phase 2 keeps going until
    // nothing legal is left to give up. The point is what it refused to touch.
    expect(summary.droppedSteps).toBe(2);
    expect(summary.overBudget).toBe(true);
    // Nothing was made WORSE: an already-illegal history may not gain orphans.
    assertNoOrphanResults(messages);
  });

  it('never removes the system message or the last user message', () => {
    const messages = [
      { role: 'system', content: 'harness prompt' },
      { role: 'user', content: 'please fix the failing test in costs.js' },
      ...toolRound(['repo_run'], 'x'.repeat(4000)),
      { role: 'user', content: 'now summarise what you changed' },
    ];

    compactMessages(messages, { maxChars: 500, keepRecent: 0 });

    expect(messages[0]).toEqual({ role: 'system', content: 'harness prompt' });
    expect(messages.some((m) => m.content === 'now summarise what you changed')).toBe(true);
    assertPairingIntact(messages.filter((m) => m.role !== 'system'));
  });
});

describe('contextBudget — when it cannot fix it, it says so', () => {
  it('reports overBudget instead of mangling the user\'s own message', () => {
    // One enormous pasted message and nothing else to give up: there is no
    // honest fix, so the governor above this must end the turn gracefully —
    // silently truncating what the user just sent is how a request becomes
    // "the model ignored my file".
    const pasted = `here is my file:\n${'code line\n'.repeat(5000)}`;
    const messages = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: pasted },
    ];

    const summary = compactMessages(messages, { maxChars: 1000, keepRecent: 0 });

    expect(summary.overBudget).toBe(true);
    expect(summary.droppedSteps).toBe(0);
    expect(messages[1].content).toBe(pasted);
  });

  it('reports the size it finished at', () => {
    const messages = [
      { role: 'user', content: 'go' },
      ...toolRound(['fs_read'], 'a'.repeat(3000)),
    ];
    const summary = compactMessages(messages, { maxChars: 5000, keepRecent: 0 });

    expect(summary.chars).toBe(totalChars(messages));
    expect(summary.overBudget).toBe(false);
  });
});

describe('contextBudget — the default budget', () => {
  const original = process.env.NET_CONTEXT_MAX_CHARS;
  afterEach(() => {
    if (original === undefined) delete process.env.NET_CONTEXT_MAX_CHARS;
    else process.env.NET_CONTEXT_MAX_CHARS = original;
  });

  it('defaults to a generous backstop, not a cost knob', () => {
    delete process.env.NET_CONTEXT_MAX_CHARS;
    expect(maxContextChars()).toBe(DEFAULT_MAX_CONTEXT_CHARS);
    // ~50K tokens: enough that a long tool history fits, small enough to catch
    // a runaway loop before the provider does.
    expect(estimateTokens('x'.repeat(DEFAULT_MAX_CONTEXT_CHARS))).toBe(50_000);
  });

  it('honours the env override, and ignores a nonsense one', () => {
    process.env.NET_CONTEXT_MAX_CHARS = '12345';
    expect(maxContextChars()).toBe(12345);

    process.env.NET_CONTEXT_MAX_CHARS = 'not-a-number';
    expect(maxContextChars()).toBe(DEFAULT_MAX_CONTEXT_CHARS);

    process.env.NET_CONTEXT_MAX_CHARS = '-5';
    expect(maxContextChars()).toBe(DEFAULT_MAX_CONTEXT_CHARS);
  });
});
