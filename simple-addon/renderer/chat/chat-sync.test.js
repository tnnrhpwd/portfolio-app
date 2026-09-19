/**
 * Unit tests for the addon chat's sync-weight policy.
 *
 * Run: node renderer/chat/chat-sync.test.js
 *
 * Plain node + assert. The interesting section is the last one: it reads the
 * website's `conversationWeight.js` and asserts the two still agree on WHICH fields
 * are droppable and HOW LARGE a payload may be before it is hopeless. The addon
 * cannot import that module (an ES module vs. a `file://` classic script), so the
 * drift alarm is a test rather than a shared constant â€” the same pattern
 * `appearance.test.js` uses for the scheme list.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sync = require('./chat-sync');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

const WEBSITE_MODULE = path.join(
  __dirname, '..', '..', '..', 'frontend', 'src', 'utils', 'simpleAddon', 'conversationWeight.js',
);

function conversationWithWeight(chars, extra) {
  return [{
    id: 'c1',
    title: 'heavy',
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: '2026-09-19T10:00:00.000Z',
    messages: [
      { id: 'm1', role: 'user', content: 'do the thing', timestamp: '2026-09-19T10:00:00.000Z' },
      {
        id: 'm2',
        role: 'assistant',
        content: 'done',
        timestamp: '2026-09-19T10:00:01.000Z',
        kind: 'answer',
        goalSlug: 'do-the-thing',
        ...(extra || {}),
        steps: [{ id: 's1', tool: 'window_list', status: 'ok', detail: 'x'.repeat(chars) }],
      },
    ],
  }];
}

console.log('\nchat-sync.test: measuring');

test('an empty or non-array list measures zero rather than throwing', () => {
  assert.strictEqual(sync.estimateConversationsChars(null), 0);
  assert.strictEqual(sync.estimateConversationsChars(undefined), 0);
  assert.strictEqual(sync.estimateConversationsChars('nope'), 0);
  assert.strictEqual(sync.estimateConversationsChars([]), 2);
});

test('the measure is the serialised length of the list', () => {
  const list = conversationWithWeight(0);
  assert.strictEqual(sync.estimateConversationsChars(list), JSON.stringify(list).length);
});

console.log('\nchat-sync.test: what gets dropped');

test('stripAgentDetail removes the agent trace and nothing else', () => {
  const stripped = sync.stripAgentDetail(conversationWithWeight(0, { plan: [{ id: 'p' }] }));
  const message = stripped[0].messages[1];
  assert(!('steps' in message), 'steps must go');
  assert(!('plan' in message), 'plan must go');
  // Everything the conversation IS must survive â€” a strip is a concession, not a wipe.
  assert.strictEqual(message.content, 'done');
  assert.strictEqual(message.id, 'm2');
  assert.strictEqual(message.kind, 'answer');
  assert.strictEqual(message.goalSlug, 'do-the-thing');
  assert.strictEqual(message.timestamp, '2026-09-19T10:00:01.000Z');
  assert.strictEqual(stripped[0].title, 'heavy');
  assert.strictEqual(stripped[0].id, 'c1');
});

test('stripAgentDetail never mutates the live conversation', () => {
  const original = conversationWithWeight(0);
  const before = JSON.stringify(original);
  sync.stripAgentDetail(original);
  assert.strictEqual(JSON.stringify(original), before, 'the in-memory thread is still showing the user its steps');
});

test('a message with no agent detail is returned unchanged, by identity', () => {
  const plain = [{ id: 'c', messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: '2026-09-19T10:00:00.000Z' }] }];
  const out = sync.stripAgentDetail(plain);
  assert.strictEqual(out[0].messages[0], plain[0].messages[0]);
});

test('junk inside a list does not throw a sync', () => {
  const junk = [null, 'x', { id: 'c' }, { id: 'c2', messages: 'nope' }, { id: 'c3', messages: [null, 'x'] }];
  assert.doesNotThrow(() => sync.stripAgentDetail(junk));
  assert.strictEqual(sync.stripAgentDetail(junk).length, junk.length);
});

console.log('\nchat-sync.test: the decision');

test('a normal payload is sent as-is', () => {
  const list = conversationWithWeight(0);
  const prepared = sync.prepareConversationsForSync(list);
  assert.strictEqual(prepared.stripped, false);
  assert.strictEqual(prepared.conversations, list, 'the same array, so nothing is copied for the common case');
});

test('a payload past the hopeless threshold is stripped BEFORE it is sent', () => {
  const list = conversationWithWeight(sync.SYNC_PRESUMED_TOO_LARGE_CHARS);
  const prepared = sync.prepareConversationsForSync(list);
  assert.strictEqual(prepared.stripped, true);
  assert(!('steps' in prepared.conversations[0].messages[1]));
});

test('isCertainlyTooLarge honours the threshold it is given', () => {
  const list = conversationWithWeight(10);
  assert.strictEqual(sync.isCertainlyTooLarge(list, 10), true);
  assert.strictEqual(sync.isCertainlyTooLarge(list, 1_000_000), false);
});

test('a size error is recognised by value or by wording', () => {
  assert.strictEqual(sync.isConversationTooLargeError(Object.assign(new Error('x'), { status: 413 })), true);
  assert.strictEqual(sync.isConversationTooLargeError(new Error('Conversation data too large. Try clearing old conversations.')), true);
  assert.strictEqual(sync.isConversationTooLargeError(new Error('Payload too large')), true);
  assert.strictEqual(sync.isConversationTooLargeError(new Error('Request failed with status code 500')), false);
  assert.strictEqual(sync.isConversationTooLargeError(null), false);
});


console.log('\nchat-sync.test: should we write at all?');

test('a fresh device with nothing to say does NOT write', () => {
  // The failure this replaces: the first draft merged on every open, so an empty
  // "New chat" placeholder was pushed to the cloud before anything was pulled.
  assert.strictEqual(sync.pendingUpload([], [], [], []), false);
});

test('an empty placeholder is never a reason to write â€” the server filters those out', () => {
  const placeholder = [{ id: 'p1', title: 'New chat', updatedAt: '2026-09-19T10:00:00.000Z', messages: [] }];
  assert.strictEqual(sync.pendingUpload(placeholder, [], [], []), false);
});

test('a conversation the cloud has never seen IS a reason to write', () => {
  const local = [{ id: 'c1', updatedAt: '2026-09-19T10:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x' }] }];
  assert.strictEqual(sync.pendingUpload(local, [], [], []), true);
});

test('a turn the cloud has not got IS a reason to write', () => {
  const local = [{ id: 'c1', updatedAt: '2026-09-19T10:00:05.000Z', messages: [{ id: 'm1', role: 'user', content: 'x' }, { id: 'm2', role: 'assistant', content: 'y' }] }];
  const remote = [{ id: 'c1', updatedAt: '2026-09-19T10:00:00.000Z', messages: [{ id: 'm1', role: 'user', content: 'x' }] }];
  assert.strictEqual(sync.pendingUpload(local, remote, [], []), true);
});

test('an in-place edit shows up as a newer updatedAt', () => {
  const local = [{ id: 'c1', updatedAt: '2026-09-19T10:00:05.000Z', messages: [{ id: 'm1', role: 'user', content: 'edited' }] }];
  const remote = [{ id: 'c1', updatedAt: '2026-09-19T10:00:00.000Z', messages: [{ id: 'm1', role: 'user', content: 'x' }] }];
  assert.strictEqual(sync.pendingUpload(local, remote, [], []), true);
});

test('the cloud already holding our work is NOT a reason to write', () => {
  const same = {
    id: 'c1', updatedAt: '2026-09-19T10:00:00.000Z',
    messages: [{ id: 'm1', role: 'user', content: 'x' }, { id: 'm2', role: 'assistant', content: 'y' }],
  };
  assert.strictEqual(sync.pendingUpload([same], [same], [], []), false);
});

test('a just-merged echo is not re-pushed forever (clock tolerance)', () => {
  const local = [{ id: 'c1', updatedAt: '2026-09-19T10:00:00.900Z', messages: [{ id: 'm1', role: 'user', content: 'x' }] }];
  const remote = [{ id: 'c1', updatedAt: '2026-09-19T10:00:00.000Z', messages: [{ id: 'm1', role: 'user', content: 'x' }] }];
  assert.strictEqual(sync.pendingUpload(local, remote, [], []), false, 'sub-second skew must not cause a permanent write loop');
});

test('a tombstone the cloud has not recorded IS a reason to write', () => {
  assert.strictEqual(sync.pendingUpload([], [], ['gone'], []), true);
  assert.strictEqual(sync.pendingUpload([], [], ['gone'], ['gone']), false);
});

test('junk on either side never throws a sync decision', () => {
  assert.strictEqual(sync.pendingUpload(null, undefined, null, undefined), false);
  assert.strictEqual(sync.pendingUpload([null, 'x', { id: 'c' }], [null, 'y'], [null, ''], [null]), false);
});

console.log('\nchat-sync.test: syncWithFallback');

(async () => {
  await asyncTest('a clean sync reports trimmed: false', async () => {
    const calls = [];
    const result = await sync.syncWithFallback({
      conversations: conversationWithWeight(0),
      deletedIds: ['gone'],
      merge: async (conversations, deletedIds) => {
        calls.push(deletedIds);
        return { conversations, deletedIds, ok: true };
      },
    });
    assert.strictEqual(result.trimmed, false);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(calls, [['gone']]);
  });

  await asyncTest('a 413 retries ONCE without the agent trace, and says it trimmed', async () => {
    let attempt = 0;
    const seen = [];
    const result = await sync.syncWithFallback({
      conversations: conversationWithWeight(0),
      merge: async (conversations) => {
        attempt++;
        seen.push('steps' in conversations[0].messages[1]);
        if (attempt === 1) throw Object.assign(new Error('Conversation data too large'), { status: 413 });
        return { conversations, ok: true };
      },
    });
    assert.strictEqual(attempt, 2, 'exactly one retry');
    assert.deepStrictEqual(seen, [true, false], 'the retry must be the stripped payload');
    assert.strictEqual(result.trimmed, true);
  });

  await asyncTest('a non-size failure is NOT retried and is not hidden', async () => {
    let attempt = 0;
    await assert.rejects(
      () => sync.syncWithFallback({
        conversations: conversationWithWeight(0),
        merge: async () => { attempt++; throw new Error('backend error 500'); },
      }),
      /backend error 500/,
    );
    assert.strictEqual(attempt, 1, 'a real failure must surface, not be retried into a degraded success');
  });

  await asyncTest('a payload that was ALREADY stripped is not retried into a second 413', async () => {
    let attempt = 0;
    await assert.rejects(
      () => sync.syncWithFallback({
        conversations: conversationWithWeight(sync.SYNC_PRESUMED_TOO_LARGE_CHARS),
        merge: async () => { attempt++; throw Object.assign(new Error('too large'), { status: 413 }); },
      }),
      /too large/,
    );
    assert.strictEqual(attempt, 1, 'there is nothing left to give up â€” report the failure');
  });

  await asyncTest('a missing transport is a programming error, not a silent no-op', async () => {
    await assert.rejects(() => sync.syncWithFallback({ conversations: [] }), /merge transport/);
  });

  // The trace-survival property these tests used to pin now lives where it belongs:
  // `chat-store.test.js` → "adopting a synced list", because the adopt is what merges
  // and there is no longer a separate repair step to test.

  console.log('\nchat-sync.test: agreement with the website');

  test('the droppable keys are the same set the website drops', () => {
    const source = fs.readFileSync(WEBSITE_MODULE, 'utf-8');
    const match = /AGENT_DETAIL_KEYS\s*=\s*\[([^\]]*)\]/.exec(source);
    assert(match, 'could not find AGENT_DETAIL_KEYS in conversationWeight.js â€” the check must not pass by reading nothing');
    const websiteKeys = match[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    assert.deepStrictEqual(sync.SYNC_AGENT_DETAIL_KEYS, websiteKeys);
  });

  test('the hopeless-size threshold is the number the website uses', () => {
    const source = fs.readFileSync(WEBSITE_MODULE, 'utf-8');
    const match = /PRESUMED_TOO_LARGE_CHARS\s*=\s*([\d_]+)/.exec(source);
    assert(match, 'could not find PRESUMED_TOO_LARGE_CHARS in conversationWeight.js');
    const websiteLimit = Number(match[1].replace(/_/g, ''));
    assert.strictEqual(sync.SYNC_PRESUMED_TOO_LARGE_CHARS, websiteLimit);
  });

  console.log(`\nchat-sync.test: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
