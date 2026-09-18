/**
 * toolLoop.test.js — the ONE tool loop, tested with fakes.
 *
 * This suite is the reason the loop takes `call` and `executeToolCall` as
 * arguments: the sequence (call → execute → feed back → call) is now testable
 * without a provider, a DynamoDB table, or a capability map. Every branch the
 * two former copies of this loop could disagree about is pinned here:
 *
 *   - the act-vs-answer nudge (fires once, never loops, never on a chat turn)
 *   - `exhausted`, which decides whether the caller still needs a wrap-up call
 *   - a THROWING executor (it used to reject the whole turn and lose every step
 *     that had already succeeded)
 */

const { runToolLoop, parseToolArguments } = require('../../services/harness/toolLoop.js');

let seq = 0;

const toolCall = (name, args = {}) => ({
  id: `call_${++seq}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

const asksForTools = (...calls) => ({
  choices: [{ message: { role: 'assistant', content: '', tool_calls: calls } }],
});

const says = (text) => ({
  choices: [{ message: { role: 'assistant', content: text } }],
});

/** A `call` that walks a fixed script, repeating the last response when it runs out. */
function scripted(responses) {
  let i = 0;
  const calls = [];
  const fn = async (messages, options) => {
    calls.push({ messages: messages.length, options });
    return responses[Math.min(i++, responses.length - 1)];
  };
  fn.count = () => i;
  return fn;
}

const SYSTEM = { role: 'system', content: 'base' };

function baseArgs(overrides = {}) {
  return {
    messages: [SYSTEM, { role: 'user', content: 'hello' }],
    llmOptions: { maxTokens: 100, tools: [{ type: 'function', function: { name: 'save_note' } }] },
    toolContext: { userId: 'u1', userMessage: 'hello' },
    ...overrides,
  };
}

beforeEach(() => { seq = 0; });

describe('runToolLoop — sequence', () => {
  test('a plain reply runs one call, no rounds, not exhausted', async () => {
    const call = scripted([says('hi there')]);
    const result = await runToolLoop({
      ...baseArgs(),
      call,
      executeToolCall: jest.fn(),
    });

    expect(call.count()).toBe(1);
    expect(result).toMatchObject({ rounds: 0, nudged: false, exhausted: false });
    expect(result.toolResults).toEqual([]);
    expect(result.response.choices[0].message.content).toBe('hi there');
  });

  test('one tool round executes the tool and feeds the result back', async () => {
    const call = scripted([asksForTools(toolCall('save_note', { text: 'x' })), says('Saved.')]);
    const executeToolCall = jest.fn(async () => ({ fnName: 'save_note', fnArgs: { text: 'x' }, result: 'ok' }));
    const messages = [SYSTEM, { role: 'user', content: 'hello' }];

    const result = await runToolLoop({ ...baseArgs({ messages }), call, executeToolCall });

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ rounds: 1, exhausted: false });
    expect(result.toolResults).toEqual([{ tool: 'save_note', args: { text: 'x' }, result: 'ok' }]);
    // The result is in the history the NEXT call sees — that is the whole loop.
    const toolTurn = messages.find((m) => m.role === 'tool');
    expect(toolTurn).toMatchObject({ name: 'save_note', content: 'ok' });
    expect(result.response.choices[0].message.content).toBe('Saved.');
  });

  test('a throwing executor is fed back as an error and the turn continues', async () => {
    const call = scripted([asksForTools(toolCall('repo_search')), says('That failed, here is why.')]);
    const executeToolCall = jest.fn(async () => { throw new Error('git grep exploded'); });

    const result = await runToolLoop({ ...baseArgs(), call, executeToolCall });

    expect(result.rounds).toBe(1);
    expect(result.toolResults[0].result).toBe('Error: git grep exploded');
    // The old behaviour rejected here, losing the whole turn.
    expect(result.response.choices[0].message.content).toBe('That failed, here is why.');
  });

  test('respects maxRounds and reports exhausted while the model still wants tools', async () => {
    const call = scripted([asksForTools(toolCall('repo_read_file', { path: 'a' }))]);
    const executeToolCall = jest.fn(async () => ({ fnName: 'repo_read_file', fnArgs: {}, result: 'file body' }));

    const result = await runToolLoop({ ...baseArgs(), call, executeToolCall, maxRounds: 3 });

    expect(result.rounds).toBe(3);
    expect(executeToolCall).toHaveBeenCalledTimes(3);
    expect(result.exhausted).toBe(true);
  });

  test('a loop that ends on the model\'s own text is NOT exhausted', async () => {
    const call = scripted([
      asksForTools(toolCall('repo_read_file', { path: 'a' })),
      asksForTools(toolCall('repo_read_file', { path: 'b' })),
      says('Done.'),
    ]);
    const executeToolCall = jest.fn(async () => ({ fnName: 'repo_read_file', fnArgs: {}, result: 'body' }));

    // The cap is reached by the round counter AND the last response has text —
    // the caller must not spend a wrap-up call re-asking for an answer it has.
    const result = await runToolLoop({ ...baseArgs(), call, executeToolCall, maxRounds: 2 });

    expect(result.rounds).toBe(2);
    expect(result.exhausted).toBe(false);
    expect(result.response.choices[0].message.content).toBe('Done.');
  });

  test('without tools armed it never loops', async () => {
    const call = scripted([asksForTools(toolCall('save_note'))]);
    const executeToolCall = jest.fn();

    const result = await runToolLoop({
      ...baseArgs({ llmOptions: { maxTokens: 100 } }),
      call,
      executeToolCall,
    });

    expect(executeToolCall).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rounds: 0, exhausted: false });
  });
});

describe('runToolLoop — the act-vs-answer nudge', () => {
  test('retries once, with the note in the system prompt, on an outcome-shaped turn', async () => {
    const call = scripted([says("I'll add that goal for you."), asksForTools(toolCall('save_goal')), says('Saved it.')]);
    const executeToolCall = jest.fn(async () => ({ fnName: 'save_goal', fnArgs: {}, result: 'ok' }));
    const messages = [SYSTEM, { role: 'user', content: 'add a goal to run a marathon' }];

    const result = await runToolLoop({
      ...baseArgs({ messages, toolContext: { userId: 'u1', userMessage: 'add a goal to run a marathon' } }),
      call,
      executeToolCall,
    });

    expect(result.nudged).toBe(true);
    expect(messages[0].content).toMatch(/YOU ANSWERED WITHOUT ACTING/);
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(result.response.choices[0].message.content).toBe('Saved it.');
  });

  test('believes the model when the retry also declines to act', async () => {
    const call = scripted([says('I would rather explain.'), says('I would rather explain.')]);
    const messages = [SYSTEM, { role: 'user', content: 'remember that my sister is called Ana' }];

    const result = await runToolLoop({
      ...baseArgs({ messages, toolContext: { userId: 'u1', userMessage: 'remember that my sister is called Ana' } }),
      call,
      executeToolCall: jest.fn(),
    });

    expect(call.count()).toBe(2); // initial + one retry, never a third
    expect(result.nudged).toBe(true);
    expect(result.response.choices[0].message.content).toBe('I would rather explain.');
  });

  test('never nudges ordinary conversation', async () => {
    const call = scripted([says('Fine, thanks.')]);

    const result = await runToolLoop({
      ...baseArgs({ toolContext: { userId: 'u1', userMessage: 'how are you?' } }),
      call,
      executeToolCall: jest.fn(),
    });

    expect(call.count()).toBe(1);
    expect(result.nudged).toBe(false);
  });
});

describe('runToolLoop — hooks', () => {
  test('reports each step start then end, and pairs the results by call id', async () => {
    const call = scripted([
      asksForTools(toolCall('repo_search', { query: 'x' }), toolCall('repo_read_file', { path: 'y' })),
      says('done'),
    ]);
    const executeToolCall = jest.fn(async (tc) => ({
      fnName: tc.function.name,
      fnArgs: parseToolArguments(tc).args,
      result: tc.function.name === 'repo_search' ? '2 matches' : 'body',
    }));
    const seen = [];

    await runToolLoop({
      ...baseArgs(),
      call,
      executeToolCall,
      onToolStart: (info) => seen.push(['start', info.name, info.round]),
      onToolEnd: (info) => seen.push(['end', info.name, info.result]),
    });

    expect(seen).toEqual([
      ['start', 'repo_search', 1],
      ['end', 'repo_search', '2 matches'],
      ['start', 'repo_read_file', 1],
      ['end', 'repo_read_file', 'body'],
    ]);
  });

  test('an end hook still fires for a tool that threw', async () => {
    const call = scripted([asksForTools(toolCall('repo_push')), says('nope')]);
    const ends = [];

    await runToolLoop({
      ...baseArgs(),
      call,
      executeToolCall: async () => { throw new Error('not confirmed'); },
      onToolEnd: (info) => ends.push(info),
    });

    expect(ends).toHaveLength(1);
    expect(ends[0].error).toBeInstanceOf(Error);
    expect(ends[0].result).toBe('Error: not confirmed');
  });
});

describe('runToolLoop — cancel and approval', () => {
  test('a denied tool never runs, and the model is told why', async () => {
    const call = scripted([asksForTools(toolCall('repo_commit_changes')), says('Understood — nothing was committed.')]);
    const executeToolCall = jest.fn();
    const beforeTool = jest.fn(async () => ({ allow: false, reason: 'you declined' }));

    const result = await runToolLoop({ ...baseArgs(), call, executeToolCall, beforeTool });

    expect(executeToolCall).not.toHaveBeenCalled();
    expect(beforeTool).toHaveBeenCalledTimes(1);
    expect(result.toolResults[0].result).toBe('Denied: you declined');
    // The refusal reaches the model, which is what lets it adapt instead of the
    // turn just dying.
    expect(result.response.choices[0].message.content).toBe('Understood — nothing was committed.');
  });

  test('a denied tool falls back to a plain reason when the gate gives none', async () => {
    const call = scripted([asksForTools(toolCall('repo_commit_changes')), says('ok')]);
    const result = await runToolLoop({
      ...baseArgs(), call, executeToolCall: jest.fn(), beforeTool: async () => ({ allow: false }),
    });
    expect(result.toolResults[0].result).toMatch(/^Denied: the user did not approve/);
  });

  test('an allowed tool still runs through the gate', async () => {
    const call = scripted([asksForTools(toolCall('repo_read_file', { path: 'a' })), says('read')]);
    const executeToolCall = jest.fn(async () => ({ fnName: 'repo_read_file', fnArgs: {}, result: 'body' }));

    await runToolLoop({ ...baseArgs(), call, executeToolCall, beforeTool: async () => ({ allow: true }) });

    expect(executeToolCall).toHaveBeenCalledTimes(1);
  });

  test('cancelling before any tool runs does no work at all', async () => {
    const call = scripted([
      asksForTools(toolCall('repo_read_file', { path: 'a' }), toolCall('repo_read_file', { path: 'b' })),
      says('should never be reached'),
    ]);
    const executeToolCall = jest.fn();
    const messages = [SYSTEM, { role: 'user', content: 'hello' }];

    const result = await runToolLoop({ ...baseArgs({ messages }), call, executeToolCall, isCancelled: () => true });

    expect(executeToolCall).not.toHaveBeenCalled();
    expect(call.count()).toBe(1); // no further model call after the cancel
    expect(result).toMatchObject({ cancelled: true, exhausted: false, rounds: 0 });
    expect(result.toolResults).toEqual([]);
    // Nothing was pushed, so there is no dangling tool_call either — the turn
    // stops before the model's tool request reaches the history.
    expect(messages.some((m) => m.role === 'tool')).toBe(false);
    expect(messages.some((m) => m.tool_calls)).toBe(false);
  });

  test('cancelling BETWEEN tools finishes the step it is on, and leaves a legal history', async () => {
    let ran = 0;
    const call = scripted([asksForTools(toolCall('repo_read_file', { path: 'a' }), toolCall('repo_write_file', { path: 'b' }))]);
    const executeToolCall = jest.fn(async () => {
      ran += 1;
      return { fnName: 'repo_read_file', fnArgs: null, result: 'body' };
    });
    const messages = [SYSTEM, { role: 'user', content: 'hello' }];

    // The flag flips as soon as the first tool has run — i.e. mid-round, which
    // is exactly the case a user clicking Stop produces.
    const result = await runToolLoop({
      ...baseArgs({ messages }), call, executeToolCall, isCancelled: () => ran >= 1,
    });

    // The first tool was NOT interrupted; the second never ran.
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(result.toolResults[1].result).toMatch(/^Cancelled:/);
    expect(result.cancelled).toBe(true);
    expect(call.count()).toBe(1);

    // ⚠️ The invariant that makes a cancelled turn safe to end: the model's
    // tool_calls turn IS in the history by now, so every call in it needs a
    // result of its own.
    const pushed = messages.find((m) => m.tool_calls);
    expect(pushed.tool_calls).toHaveLength(2);
    const resultIds = messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
    expect(resultIds.sort()).toEqual(pushed.tool_calls.map((c) => c.id).sort());
  });
});

describe('parseToolArguments', () => {
  test('flags truncated or invalid JSON rather than defaulting to {}', () => {
    expect(parseToolArguments({ function: { arguments: '' } })).toEqual({ args: null, truncated: true });
    expect(parseToolArguments({ function: { arguments: '{"a":' } })).toEqual({ args: null, truncated: true });
    expect(parseToolArguments({ function: { arguments: '["a"]' } })).toEqual({ args: null, truncated: true });
    expect(parseToolArguments({})).toEqual({ args: null, truncated: true });
  });

  test('parses a valid object', () => {
    expect(parseToolArguments({ function: { arguments: '{"a":1}' } }))
      .toEqual({ args: { a: 1 }, truncated: false });
  });
});
