/**
 * Unit tests for the addon chat's conversation store.
 *
 * Run: node renderer/chat/chat-store.test.js
 *
 * Plain node + assert, and a FAKE storage object — so this exercises the persistence
 * path (round-trip, corrupt value, wrong version, full store) without a browser and
 * without ever touching a real profile.
 */

'use strict';

const assert = require('assert');

const store = require('./chat-store');

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

/** An in-memory localStorage stand-in. `fail` makes every write throw (quota). */
function fakeStorage(opts) {
  const map = new Map();
  const o = opts || {};
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (o.fail) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    _raw: map,
  };
}

console.log('\nchat-store.test: titles');

test('a title is the first line of what was asked, flattened and clipped', () => {
  assert.strictEqual(store.titleFromText('Open Edge\nand go to Messages'), 'Open Edge');
  assert.strictEqual(store.titleFromText('   spaced   out   '), 'spaced out');
  assert.strictEqual(store.titleFromText(''), 'New chat');
  assert.strictEqual(store.titleFromText(null), 'New chat');
});

test('a very long ask is clipped to a label, not a paragraph', () => {
  const title = store.titleFromText('x'.repeat(500));
  assert.strictEqual(title.length, store.TITLE_MAX);
  assert(title.endsWith('…'), title);
});

console.log('\nchat-store.test: conversation shape');

test('a new conversation starts empty, titled, and stamped in ISO', () => {
  const c = store.newConversation({ now: Date.parse('2026-09-19T10:00:00.000Z') });
  assert.strictEqual(c.title, 'New chat');
  assert.deepStrictEqual(c.messages, []);
  assert.strictEqual(c.createdAt, '2026-09-19T10:00:00.000Z');
  assert.strictEqual(c.updatedAt, c.createdAt);
  assert(c.id);
});

test('timestamps are ISO strings, because the BACKEND Date.parse()s them', () => {
  // The website's merge helpers read recency and order with Date.parse(). An
  // epoch-ms number parses to NaN = "no recency", which sorts a thread last and
  // loses message ordering against the website's copy — a silent corruption.
  const c = store.appendMessage(store.newConversation({ now: 1 }), { role: 'user', content: 'x' });
  assert.strictEqual(typeof c.messages[0].timestamp, 'string');
  assert(!Number.isNaN(Date.parse(c.messages[0].timestamp)), c.messages[0].timestamp);
  assert(!Number.isNaN(Date.parse(c.updatedAt)), c.updatedAt);
});

test('appending the first user message NAMES the thread', () => {
  let c = store.newConversation();
  c = store.appendMessage(c, { role: 'user', content: 'Open Notepad and write a list' });
  assert.strictEqual(c.title, 'Open Notepad and write a list');
});

test('a later message does NOT rename the thread', () => {
  let c = store.newConversation();
  c = store.appendMessage(c, { role: 'user', content: 'first' });
  c = store.appendMessage(c, { role: 'user', content: 'second' });
  assert.strictEqual(c.title, 'first');
});

test('appending returns a NEW conversation — the caller re-renders on identity', () => {
  const c = store.newConversation();
  const next = store.appendMessage(c, { role: 'user', content: 'hi' });
  assert.notStrictEqual(next, c);
  assert.strictEqual(c.messages.length, 0, 'the input must not be mutated');
});

test('an assistant turn keeps its steps and its stop kind', () => {
  let c = store.newConversation();
  c = store.appendMessage(c, { role: 'assistant', content: 'done', kind: 'stopped', steps: [{ id: 'a', tool: 'x' }], goalSlug: 'g' });
  const msg = c.messages[0];
  assert.strictEqual(msg.kind, 'stopped');
  assert.strictEqual(msg.goalSlug, 'g');
  assert.strictEqual(msg.steps.length, 1);
});

test('a message with no content is stored as an empty string, never undefined', () => {
  let c = store.newConversation();
  c = store.appendMessage(c, { role: 'assistant' });
  assert.strictEqual(c.messages[0].content, '');
});

test('junk conversations are ignored instead of stored', () => {
  assert.strictEqual(store.appendMessage(null, { role: 'user', content: 'x' }), null);
  assert.strictEqual(store.appendMessage(undefined, { role: 'user', content: 'x' }), undefined);
});

test('a conversation can be patched in place by message id', () => {
  let c = store.newConversation();
  c = store.appendMessage(c, { id: 'm1', role: 'assistant', content: '' });
  c = store.updateMessage(c, 'm1', { content: 'the answer', kind: 'answer' });
  assert.strictEqual(c.messages[0].content, 'the answer');
  assert.strictEqual(c.messages[0].kind, 'answer');
});

test('patching an unknown id returns the SAME object, so the caller can skip a redraw', () => {
  let c = store.newConversation();
  c = store.appendMessage(c, { id: 'm1', role: 'assistant', content: 'x' });
  assert.strictEqual(store.updateMessage(c, 'nope', { content: 'y' }), c);
});

test('a runaway thread is trimmed from the OLDEST end', () => {
  let c = store.newConversation();
  for (let i = 0; i < store.MAX_MESSAGES + 5; i++) c = store.appendMessage(c, { role: 'user', content: `m${i}` });
  assert.strictEqual(c.messages.length, store.MAX_MESSAGES);
  assert.strictEqual(c.messages[c.messages.length - 1].content, `m${store.MAX_MESSAGES + 4}`);
});

console.log('\nchat-store.test: the list');

test('the list keeps the newest threads, newest first', () => {
  const list = [
    { id: 'old', updatedAt: '2026-09-19T10:00:00.000Z', messages: [] },
    { id: 'new', updatedAt: '2026-09-19T12:00:00.000Z', messages: [] },
    { id: 'mid', updatedAt: '2026-09-19T11:00:00.000Z', messages: [] },
  ];
  assert.deepStrictEqual(store.pruneConversations(list).map((c) => c.id), ['new', 'mid', 'old']);
});

test('recency falls back to the newest message when updatedAt is missing', () => {
  const noStamp = { id: 'a', messages: [{ role: 'user', content: 'x', timestamp: '2026-09-19T09:00:00.000Z' }] };
  const stamped = { id: 'b', updatedAt: '2026-09-19T08:00:00.000Z', messages: [] };
  assert.deepStrictEqual(store.pruneConversations([stamped, noStamp]).map((c) => c.id), ['a', 'b']);
});

test('the list is capped so a long-lived profile cannot grow without bound', () => {
  const list = [];
  for (let i = 0; i < store.MAX_CONVERSATIONS + 10; i++) {
    list.push({ id: `c${String(i).padStart(3, '0')}`, updatedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(), messages: [] });
  }
  const pruned = store.pruneConversations(list);
  assert.strictEqual(pruned.length, store.MAX_CONVERSATIONS);
  assert.strictEqual(pruned[0].id, `c${String(store.MAX_CONVERSATIONS + 9).padStart(3, '0')}`);
});

test('junk entries are dropped from the list rather than rendered', () => {
  const pruned = store.pruneConversations([null, 'x', { id: 'keep', updatedAt: '2026-09-19T10:00:00.000Z', messages: [] }, {}]);
  assert.deepStrictEqual(pruned.map((c) => c.id), ['keep']);
});

test('deleting removes exactly one thread, and returns a new list', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  const next = store.deleteConversation(list, 'a');
  assert.deepStrictEqual(next.map((c) => c.id), ['b']);
  assert.strictEqual(list.length, 2, 'the input must not be mutated');
});

test('mostRecent is the thread the window opens on, or null when there is none', () => {
  assert.strictEqual(store.mostRecent([]), null);
  assert.strictEqual(store.mostRecent(null), null);
  const list = [
    { id: 'a', updatedAt: '2026-09-19T09:00:00.000Z', messages: [] },
    { id: 'b', updatedAt: '2026-09-19T17:00:00.000Z', messages: [] },
  ];
  assert.strictEqual(store.mostRecent(list).id, 'b');
});

console.log('\nchat-store.test: tombstones');

test('a tombstone is added once, newest first, and bounded', () => {
  let ids = [];
  ids = store.addTombstone(ids, 'a');
  ids = store.addTombstone(ids, 'b');
  ids = store.addTombstone(ids, 'a');
  assert.deepStrictEqual(ids, ['a', 'b']);

  let many = [];
  for (let i = 0; i < store.MAX_DELETED_IDS + 20; i++) many = store.addTombstone(many, `c${i}`);
  assert.strictEqual(many.length, store.MAX_DELETED_IDS);
  assert.strictEqual(many[0], `c${store.MAX_DELETED_IDS + 19}`);
});

test('junk ids never become tombstones', () => {
  assert.deepStrictEqual(store.addTombstone([], null), []);
  assert.deepStrictEqual(store.addTombstone([], ''), []);
  assert.deepStrictEqual(store.addTombstone([], undefined), []);
});

test('unionTombstones mirrors the backend, and tolerates junk', () => {
  assert.deepStrictEqual(store.unionTombstones(['a'], ['b', 'a']).sort(), ['a', 'b']);
  assert.deepStrictEqual(store.unionTombstones(null, ['b']), ['b']);
  assert.deepStrictEqual(store.unionTombstones(['a'], undefined), ['a']);
});

test('a tombstoned conversation is filtered out of a list', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  assert.deepStrictEqual(store.filterTombstoned(list, ['a']).map((c) => c.id), ['b']);
});

console.log('\nchat-store.test: adopting a synced list');

test('the server list is adopted, and a tombstone beats a stale local copy', () => {
  const local = [{ id: 'gone', messages: [{ id: 'm', role: 'user', content: 'x' }] }];
  const remote = [{ id: 'from-web', title: 'Web thread', updatedAt: '2026-09-19T10:00:00.000Z', messages: [] }];
  const out = store.adoptSynced(local, remote, ['gone']);
  assert.deepStrictEqual(out.map((c) => c.id), ['from-web']);
});

test('a local-only conversation WITH messages survives an adopt', () => {
  // The poll runs while a turn is in flight, and an unsent turn is absent from the
  // server's answer. Dropping it would delete a turn the user just watched happen.
  const local = [{ id: 'in-flight', updatedAt: '2026-09-19T12:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'sent just now' }] }];
  const out = store.adoptSynced(local, [], []);
  assert.deepStrictEqual(out.map((c) => c.id), ['in-flight']);
});

test('an EMPTY local-only conversation is dropped — the server filters those on purpose', () => {
  const local = [store.newConversation({ id: 'placeholder' })];
  assert.deepStrictEqual(store.adoptSynced(local, [], []), []);
});

test('a conversation present on both sides keeps the server copy once', () => {
  const local = [{ id: 'same', title: 'Local', updatedAt: '2026-09-19T09:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x' }] }];
  const remote = [{ id: 'same', title: 'Merged by the server', updatedAt: '2026-09-19T10:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x' }] }];
  const out = store.adoptSynced(local, remote, []);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].title, 'Merged by the server');
  assert.strictEqual(out[0].messages.length, 1, 'the shared message must not be duplicated');
});

test('⚠️ a pull UNIONS messages, so a field only this device holds survives', () => {
  // The bug: the cloud only ever receives a STRIPPED payload when a thread is heavy, so
  // its copy has no `steps`. An adopt that REPLACED local messages deleted the tool rows
  // from the only place they existed.
  const local = [{
    id: 'c1', title: 't', updatedAt: '2026-09-19T10:00:00.000Z',
    messages: [
      { id: 'm1', role: 'user', content: 'do it', timestamp: '2026-09-19T10:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: 'done', timestamp: '2026-09-19T10:00:01.000Z', steps: [{ id: 's1', tool: 'window_list' }], plan: [{ id: 'p1' }] },
    ],
  }];
  const stripped = [{
    id: 'c1', title: 't', updatedAt: '2026-09-19T10:00:00.000Z',
    messages: [
      { id: 'm1', role: 'user', content: 'do it', timestamp: '2026-09-19T10:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: 'done', timestamp: '2026-09-19T10:00:01.000Z' },
    ],
  }];
  const out = store.adoptSynced(local, stripped, []);
  assert.deepStrictEqual(out[0].messages[1].steps, [{ id: 's1', tool: 'window_list' }]);
  assert.deepStrictEqual(out[0].messages[1].plan, [{ id: 'p1' }]);
  assert.strictEqual(out[0].messages[1].content, 'done');
});

test('a message the cloud has and we do not is added', () => {
  const local = [{ id: 'c1', messages: [{ id: 'm1', role: 'user', content: 'mine', timestamp: '2026-09-19T10:00:00.000Z' }] }];
  const remote = [{
    id: 'c1',
    messages: [
      { id: 'm1', role: 'user', content: 'mine', timestamp: '2026-09-19T10:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: 'theirs', timestamp: '2026-09-19T10:00:01.000Z' },
    ],
  }];
  const out = store.adoptSynced(local, remote, []);
  assert.deepStrictEqual(out[0].messages.map((m) => m.id), ['m1', 'm2']);
});

test('a message we have that the cloud does not is KEPT by the merge', () => {
  const local = [{ id: 'c1', messages: [{ id: 'm1', role: 'user', content: 'mine', timestamp: '2026-09-19T10:00:00.000Z' }] }];
  const remote = [{ id: 'c1', messages: [] }];
  const out = store.adoptSynced(local, remote, []);
  assert.deepStrictEqual(out[0].messages.map((m) => m.id), ['m1']);
});

test('the longer body wins, so a reply still growing is not truncated', () => {
  const local = [{ id: 'c1', messages: [{ id: 'm1', role: 'assistant', content: 'half a re', timestamp: '2026-09-19T10:00:00.000Z' }] }];
  const remote = [{ id: 'c1', messages: [{ id: 'm1', role: 'assistant', content: 'half a reply', timestamp: '2026-09-19T10:00:00.000Z' }] }];
  assert.strictEqual(store.adoptSynced(local, remote, [])[0].messages[0].content, 'half a reply');
});

test('merged messages come back in timestamp order', () => {
  const local = [{ id: 'c1', messages: [{ id: 'late', role: 'assistant', content: 'b', timestamp: '2026-09-19T10:00:05.000Z' }] }];
  const remote = [{ id: 'c1', messages: [{ id: 'early', role: 'user', content: 'a', timestamp: '2026-09-19T10:00:00.000Z' }] }];
  assert.deepStrictEqual(store.adoptSynced(local, remote, [])[0].messages.map((m) => m.id), ['early', 'late']);
});

test('a placeholder title never clobbers the website\'s title', () => {
  const local = [{ id: 'c1', title: 'New chat', updatedAt: '2026-09-19T12:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x', timestamp: '2026-09-19T12:00:00.000Z' }] }];
  const remote = [{ id: 'c1', title: 'Renamed on the website', updatedAt: '2026-09-19T11:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x', timestamp: '2026-09-19T12:00:00.000Z' }] }];
  assert.strictEqual(store.adoptSynced(local, remote, [])[0].title, 'Renamed on the website');
});

test('the merged updatedAt is the LATER of the two, so a merge cannot look stale', () => {
  const local = [{ id: 'c1', updatedAt: '2026-09-19T09:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x', timestamp: '2026-09-19T09:00:00.000Z' }] }];
  const remote = [{ id: 'c1', updatedAt: '2026-09-19T11:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x', timestamp: '2026-09-19T09:00:00.000Z' }] }];
  assert.strictEqual(store.adoptSynced(local, remote, [])[0].updatedAt, '2026-09-19T11:00:00.000Z');
});

test('a second adopt of the same answer is idempotent', () => {
  const local = [{ id: 'c1', title: 't', updatedAt: '2026-09-19T10:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x', timestamp: '2026-09-19T10:00:00.000Z' }] }];
  const remote = [{ id: 'c1', title: 't', updatedAt: '2026-09-19T10:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x', timestamp: '2026-09-19T10:00:00.000Z' }] }];
  const once = store.adoptSynced(local, remote, []);
  const twice = store.adoptSynced(once, remote, []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(twice)), JSON.parse(JSON.stringify(once)), 'a poll repeating its own answer must not grow anything');
});

test('junk on either side never throws an adopt', () => {
  assert.deepStrictEqual(store.adoptSynced(null, null, null), []);
  assert.doesNotThrow(() => store.adoptSynced([null, 'x', { id: 'c' }], [null, 'y', { id: 'c' }], [null, '']));
  assert.doesNotThrow(() => store.adoptSynced([{ id: 'c', messages: [null, 'x'] }], [{ id: 'c', messages: [null, 'y'] }], []));
});

console.log('\nchat-store.test: persistence');

test('a saved state round-trips through storage, tombstones included', () => {
  const s = fakeStorage();
  const convo = store.appendMessage(store.newConversation({ id: 'c1' }), { role: 'user', content: 'hello' });
  assert.strictEqual(store.saveState(s, { conversations: [convo], deletedIds: ['dead-1'] }), true);
  const back = store.loadState(s);
  assert.strictEqual(back.conversations.length, 1);
  assert.strictEqual(back.conversations[0].id, 'c1');
  assert.strictEqual(back.conversations[0].title, 'hello');
  assert.strictEqual(back.conversations[0].messages[0].content, 'hello');
  assert.deepStrictEqual(back.deletedIds, ['dead-1']);
});

test('a v1 payload is ignored, not mis-read as v2', () => {
  const s = fakeStorage();
  s.setItem(store.STORAGE_KEY, JSON.stringify({ version: 1, conversations: [{ id: 'x', messages: [], createdAt: 1, updatedAt: 2 }] }));
  assert.deepStrictEqual(store.loadState(s), { conversations: [], deletedIds: [] });
});

test('an empty profile reads as nothing yet', () => {
  assert.deepStrictEqual(store.loadState(fakeStorage()), { conversations: [], deletedIds: [] });
});

test('a corrupt value reads as empty — a chat window must still OPEN', () => {
  const s = fakeStorage();
  s.setItem(store.STORAGE_KEY, '{not json');
  assert.deepStrictEqual(store.loadState(s), { conversations: [], deletedIds: [] });
});

test('a version this build does not understand is ignored, not half-read', () => {
  const s = fakeStorage();
  s.setItem(store.STORAGE_KEY, JSON.stringify({ version: 99, conversations: [{ id: 'x', messages: [] }] }));
  assert.deepStrictEqual(store.loadState(s), { conversations: [], deletedIds: [] });
});

test('malformed messages are dropped on load, the good ones survive', () => {
  const s = fakeStorage();
  s.setItem(store.STORAGE_KEY, JSON.stringify({
    version: store.STORAGE_VERSION,
    conversations: [{
      id: 'c1', title: 't', createdAt: '2026-09-19T09:00:00.000Z', updatedAt: '2026-09-19T10:00:00.000Z',
      messages: [
        { id: 'm1', role: 'user', content: 'ok', timestamp: '2026-09-19T09:00:00.000Z' },
        { role: 'user', content: 'no id' },
        null,
        { id: 'm3', role: 'system', content: 'wrong role' },
      ],
    }],
  }));
  const back = store.loadState(s);
  assert.deepStrictEqual(back.conversations[0].messages.map((m) => m.id), ['m1']);
});

test('a storage that throws on write is reported, never fatal', () => {
  const s = fakeStorage({ fail: true });
  assert.strictEqual(store.saveState(s, { conversations: [store.newConversation()], deletedIds: [] }), false);
});

test('a storage that is missing entirely is reported, never fatal', () => {
  assert.strictEqual(store.saveState(null, { conversations: [] }), false);
  assert.deepStrictEqual(store.loadState(null), { conversations: [], deletedIds: [] });
});

test('saving prunes, so the stored payload cannot exceed the cap either', () => {
  const s = fakeStorage();
  const conversations = [];
  for (let i = 0; i < store.MAX_CONVERSATIONS + 5; i++) {
    conversations.push({ id: `c${i}`, updatedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(), messages: [] });
  }
  store.saveState(s, { conversations, deletedIds: [] });
  assert.strictEqual(store.loadState(s).conversations.length, store.MAX_CONVERSATIONS);
});

console.log(`\nchat-store.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
