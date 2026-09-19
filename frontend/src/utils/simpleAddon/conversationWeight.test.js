/**
 * conversationWeight.test.js — the guard that keeps history syncing once every
 * tool turn carries its agent trace.
 *
 * The failure this prevents is quiet: the sync store rejects a payload over
 * 380 KB, the client logs a warn, and the user's conversations stop moving between
 * devices with nothing on screen. So the tests are about the two things that must
 * be true for the retry to be safe — that stripping removes ONLY the agent detail,
 * and that the live conversation is never mutated while doing it.
 */

import {
  AGENT_DETAIL_KEYS,
  PRESUMED_TOO_LARGE_CHARS,
  estimateConversationsChars,
  stripAgentDetail,
  isCertainlyTooLarge,
  prepareConversationsForSync,
  isConversationTooLargeError,
  syncWithFallback,
} from './conversationWeight.js';

/** A conversation with one tool-heavy assistant turn. */
const withDetail = () => ([
  {
    id: '1',
    title: 'Net',
    createdAt: '2026-09-18T10:00:00.000Z',
    messages: [
      { id: 'm1', role: 'user', content: 'raise the goal limit', timestamp: '2026-09-18T10:00:00.000Z' },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Done.',
        timestamp: '2026-09-18T10:00:05.000Z',
        steps: [
          { id: 's1', tool: 'repo_search', status: 'ok', ms: 40, resultPreview: '2 matches' },
          { id: 's2', tool: 'repo_edit_file', status: 'ok', ms: 90, resultPreview: 'edited' },
        ],
        plan: { items: [{ id: 'p1', text: 'find it', status: 'done' }], counts: { done: 1 } },
        toolsUsed: ['repo_search', 'repo_edit_file'],
      },
    ],
  },
]);

describe('estimateConversationsChars', () => {
  it('measures the serialised payload', () => {
    const conversations = withDetail();
    expect(estimateConversationsChars(conversations)).toBe(JSON.stringify(conversations).length);
  });

  it('is 0 for anything that is not a list, and for a payload it cannot read', () => {
    // A sync that receives nonsense should stay on the reactive path (send it and
    // let the server answer) rather than crash trying to measure it.
    expect(estimateConversationsChars(null)).toBe(0);
    expect(estimateConversationsChars({})).toBe(0);

    const circular = { id: '1', messages: [] };
    circular.self = circular;
    expect(estimateConversationsChars([circular])).toBe(0);
  });
});

describe('stripAgentDetail', () => {
  it('removes exactly the agent trace, keeping every other field', () => {
    const [lean] = stripAgentDetail(withDetail());
    const assistant = lean.messages[1];

    for (const key of AGENT_DETAIL_KEYS) expect(assistant).not.toHaveProperty(key);
    // The things a conversation IS: prose, ids, order, and the fields other parts
    // of the chat rely on.
    expect(assistant).toMatchObject({
      id: 'm2',
      role: 'assistant',
      content: 'Done.',
      timestamp: '2026-09-18T10:00:05.000Z',
      toolsUsed: ['repo_search', 'repo_edit_file'],
    });
    expect(lean.messages[0]).toMatchObject({ id: 'm1', role: 'user', content: 'raise the goal limit' });
    expect(lean).toMatchObject({ id: '1', title: 'Net' });
  });

  it('does NOT mutate the live conversation', () => {
    // The retry payload is built from the same objects the UI is rendering, so a
    // mutation here would wipe the steps off the screen the moment a sync was
    // rejected — losing the trace for a reason the user could not see.
    const conversations = withDetail();
    const before = JSON.stringify(conversations);

    stripAgentDetail(conversations);

    expect(JSON.stringify(conversations)).toBe(before);
    expect(conversations[0].messages[1].steps).toHaveLength(2);
    expect(conversations[0].messages[1].plan).toBeDefined();
  });

  it('leaves messages and conversations it cannot understand alone', () => {
    const odd = [
      null,
      'not a conversation',
      { id: '2' },                                   // no messages array
      { id: '3', messages: 'nope' },
      { id: '4', messages: [null, 'string', { id: 'm', role: 'user' }] },
    ];
    expect(() => stripAgentDetail(odd)).not.toThrow();
    const out = stripAgentDetail(odd);
    expect(out[1]).toBe('not a conversation');
    expect(out[2]).toEqual({ id: '2' });
    expect(out[4].messages[2]).toEqual({ id: 'm', role: 'user' });
  });

  it('returns non-arrays unchanged, so a caller cannot lose its payload', () => {
    expect(stripAgentDetail(null)).toBeNull();
    expect(stripAgentDetail(undefined)).toBeUndefined();
  });

  it('only strips messages that actually carry the detail', () => {
    // Rebuilding every message object would be wasted work on a long history where
    // most turns never touched a tool.
    const conversations = withDetail();
    const out = stripAgentDetail(conversations);
    expect(out[0].messages[0]).toBe(conversations[0].messages[0]);
    expect(out[0].messages[1]).not.toBe(conversations[0].messages[1]);
  });
});

describe('prepareConversationsForSync', () => {
  it('sends a normal conversation untouched', () => {
    const conversations = withDetail();
    const prepared = prepareConversationsForSync(conversations);

    expect(prepared.stripped).toBe(false);
    expect(prepared.conversations).toBe(conversations);
  });

  it('strips only when the payload cannot possibly fit', () => {
    const small = withDetail();
    expect(isCertainlyTooLarge(small)).toBe(false);

    // The reactive path handles everything below this line — the server's own
    // answer is the authority on size, so guessing its compression ratio here
    // would either lose detail for nothing or keep failing.
    const huge = [{ id: '1', messages: [{ id: 'm', role: 'assistant', content: 'x'.repeat(PRESUMED_TOO_LARGE_CHARS) }] }];
    const prepared = prepareConversationsForSync(huge);

    expect(prepared.stripped).toBe(true);
    expect(prepared.chars).toBeGreaterThan(PRESUMED_TOO_LARGE_CHARS);
  });

  it('reports the size it measured, even when it stripped', () => {
    // The caller logs this, and the useful number is the one that was too big —
    // not the size after the fix.
    const huge = [{ id: '1', messages: [{ id: 'm', role: 'assistant', content: 'x'.repeat(PRESUMED_TOO_LARGE_CHARS) }] }];
    expect(prepareConversationsForSync(huge).chars).toBe(estimateConversationsChars(huge));
  });
});

describe('isConversationTooLargeError', () => {
  it('trusts the status when the API attaches one', () => {
    expect(isConversationTooLargeError(Object.assign(new Error('nope'), { status: 413 }))).toBe(true);
    expect(isConversationTooLargeError(Object.assign(new Error('nope'), { statusCode: 413 }))).toBe(true);
    // A different failure must NOT be mistaken for a size problem: retrying without
    // the agent detail would then hide a real error behind a successful-looking
    // degraded sync.
    expect(isConversationTooLargeError(Object.assign(new Error('nope'), { status: 500 }))).toBe(false);
    expect(isConversationTooLargeError(Object.assign(new Error('nope'), { status: 401 }))).toBe(false);
  });

  it('falls back to the message, because the 413 body is the other signal', () => {
    expect(isConversationTooLargeError(new Error('Failed to merge conversations: Conversation data too large. Try clearing old conversations.'))).toBe(true);
    expect(isConversationTooLargeError(new Error('Payload Too Large'))).toBe(true);
    expect(isConversationTooLargeError(new Error('Failed to fetch'))).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(isConversationTooLargeError(null)).toBe(false);
    expect(isConversationTooLargeError(undefined)).toBe(false);
  });
});

describe('syncWithFallback — the whole retry policy', () => {
  /** A transport that records every payload it was handed. */
  const transport = (...answers) => {
    const calls = [];
    const merge = async (conversations) => {
      calls.push(conversations);
      const answer = answers[calls.length - 1];
      if (answer instanceof Error) throw answer;
      return answer ?? { conversations, updatedAt: 'now' };
    };
    return { merge, calls };
  };
  const tooLarge = () => Object.assign(new Error('Conversation data too large.'), { status: 413 });

  it('sends the full payload when it fits, and reports a clean sync', async () => {
    const { merge, calls } = transport({ conversations: [], deletedIds: [], updatedAt: 'now' });

    const result = await syncWithFallback({ conversations: withDetail(), deletedIds: ['x'], merge });

    expect(calls).toHaveLength(1);
    // Sent as-is: the steps are part of what a synced conversation should show.
    expect(calls[0][0].messages[1].steps).toHaveLength(2);
    expect(result.trimmed).toBe(false);
  });

  it('retries ONCE without the agent trace when the server refuses the size', async () => {
    const { merge, calls } = transport(tooLarge(), { conversations: [], updatedAt: 'now' });

    const result = await syncWithFallback({ conversations: withDetail(), merge });

    expect(calls).toHaveLength(2);
    expect(calls[1][0].messages[1]).not.toHaveProperty('steps');
    expect(calls[1][0].messages[1]).not.toHaveProperty('plan');
    // The conversation itself still went, with its content and its other fields.
    expect(calls[1][0].messages[1]).toMatchObject({ content: 'Done.', toolsUsed: ['repo_search', 'repo_edit_file'] });
    expect(result.trimmed).toBe(true);
  });

  it('does NOT retry a failure that is not about size', async () => {
    // Retrying a 500 or an auth failure without the trace would turn a real error
    // into a "successful" degraded sync, which is the worst of both.
    const { merge, calls } = transport(Object.assign(new Error('boom'), { status: 500 }));

    await expect(syncWithFallback({ conversations: withDetail(), merge })).rejects.toThrow('boom');
    expect(calls).toHaveLength(1);
  });

  it('does not retry an identical payload after pre-emptively stripping', async () => {
    const huge = [{ id: '1', messages: [{ id: 'm', role: 'assistant', content: 'x'.repeat(PRESUMED_TOO_LARGE_CHARS) }] }];
    const { merge, calls } = transport(tooLarge());

    // The detail is already gone, so there is nothing left to give up: the failure
    // must surface rather than being retried forever against the same size.
    await expect(syncWithFallback({ conversations: huge, merge })).rejects.toThrow(/too large/i);
    expect(calls).toHaveLength(1);
  });

  it('reports `trimmed` when it had to pre-strip, even though the sync succeeded', async () => {
    // "✓ Synced" would be a lie the user only discovers on their other device.
    const huge = [{ id: '1', messages: [{ id: 'm', role: 'assistant', content: 'x'.repeat(PRESUMED_TOO_LARGE_CHARS), steps: [{ id: 's' }] }] }];
    const { merge } = transport({ conversations: [], updatedAt: 'now' });

    expect((await syncWithFallback({ conversations: huge, merge })).trimmed).toBe(true);
  });

  it('never mutates the conversations it was given', async () => {
    // The same objects are on screen showing the user their steps.
    const conversations = withDetail();
    const before = JSON.stringify(conversations);
    const { merge } = transport(tooLarge(), { conversations: [], updatedAt: 'now' });

    await syncWithFallback({ conversations, merge });

    expect(JSON.stringify(conversations)).toBe(before);
  });
});
