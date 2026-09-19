/**
 * The addon's cloud-conversation proxy routes.
 *
 * Run: node server/automation/conversation-routes.test.js
 *
 * **Why this test exists.** The chat window never holds the user's JWT: the token
 * lives in the addon's process (cloud-relay â†’ `setTokenGetter`) and the renderer calls
 * `GET /api/conversations` / `POST /api/conversations/merge` instead. That makes these
 * two routes the security boundary AND the place a status code can be lost â€” and
 * losing one is not cosmetic: the renderer's size policy
 * (`renderer/chat/chat-sync.js` â†’ `syncWithFallback`) retries without the agent detail
 * ONLY on a 413, so a flattened error would either hide the one signal that says "this
 * payload is too heavy" or turn the retry into a guess at the message's wording.
 *
 * Boots the REAL `mountAutomation()` app on an ephemeral port with a fake
 * workspace-client injected through `require.cache` (the same technique
 * `capability-summary.test.js` and `tools/skill.test.js` use), so the assertions are
 * about route wiring, status passthrough and the request/response shapes.
 *
 * Plain node: `require` at the top plus a top-level `await` makes Node refuse the
 * module format, so everything runs inside an async IIFE.
 */

'use strict';

const assert = require('assert');
const path = require('path');

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

/**
 * The fake the routes will see in place of the real backend client.
 *
 * A Proxy rather than a hand-written stub: `mountAutomation` wires a dozen client
 * methods at boot (token getter, skills, goals, lessonsâ€¦) and this test is about two
 * routes, so anything not explicitly stubbed resolves to an empty answer instead of
 * throwing. The ones that matter are set per-test.
 */
const state = {
  token: 'test-token',
  getConversations: async () => ({ signedIn: true, conversations: [], deletedIds: [], updatedAt: null }),
  mergeConversations: async (body) => ({ success: true, conversations: body.conversations, deletedIds: body.deletedIds || [] }),
};

const fake = new Proxy(state, {
  get(target, prop) {
    if (prop === 'getToken') return () => target.token;
    if (prop in target) return target[prop];
    return async () => ({});
  },
  has: () => true,
});

function resetFake() {
  state.token = 'test-token';
  state.getConversations = async () => ({ signedIn: true, conversations: [], deletedIds: [], updatedAt: null });
  state.mergeConversations = async (body) => ({ success: true, conversations: body.conversations, deletedIds: body.deletedIds || [] });
}

// âš ï¸ BEFORE requiring the app: index.js captures `wsClient` at module load.
const WS_PATH = require.resolve('./workspace-client');
require.cache[WS_PATH] = {
  id: WS_PATH,
  filename: WS_PATH,
  loaded: true,
  exports: fake,
};

const { getEvalHttpBaseUrl, closeEvalHttpServer } = require('./eval/http-app');

(async () => {
  const { baseUrl } = await getEvalHttpBaseUrl();

  const get = (p) => fetch(`${baseUrl}${p}`);
  const post = (p, body) => fetch(`${baseUrl}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  console.log('\nconversation-routes.test: GET /api/conversations');

  await asyncTest('signed out is a 200 with signedIn: false, not an error', async () => {
    resetFake();
    fake.getConversations = async () => ({ signedIn: false, conversations: [], deletedIds: [], updatedAt: null });
    const res = await get('/api/conversations');
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.signedIn, false);
    assert.deepStrictEqual(body.conversations, []);
  });

  await asyncTest('the client\'s answer is passed through unchanged', async () => {
    resetFake();
    const remote = [{ id: 'from-web', title: 'Web thread', messages: [] }];
    fake.getConversations = async () => ({ signedIn: true, conversations: remote, deletedIds: ['gone'], updatedAt: '2026-09-19T10:00:00.000Z' });
    const body = await (await get('/api/conversations')).json();
    assert.deepStrictEqual(body.conversations, remote);
    assert.deepStrictEqual(body.deletedIds, ['gone']);
    assert.strictEqual(body.updatedAt, '2026-09-19T10:00:00.000Z');
  });

  await asyncTest('a client failure keeps its status and message', async () => {
    resetFake();
    fake.getConversations = async () => {
      throw Object.assign(new Error('backend exploded'), { status: 502 });
    };
    const res = await get('/api/conversations');
    assert.strictEqual(res.status, 502);
    assert.strictEqual((await res.json()).error, 'backend exploded');
  });

  console.log('\nconversation-routes.test: POST /api/conversations/merge');

  await asyncTest('no token is a 401 â€” "signed out", not a server fault', async () => {
    resetFake();
    state.token = null;
    let called = false;
    fake.mergeConversations = async () => { called = true; return {}; };
    const res = await post('/api/conversations/merge', { conversations: [] });
    assert.strictEqual(res.status, 401);
    assert.strictEqual((await res.json()).error, 'not signed in');
    assert.strictEqual(called, false, 'a signed-out merge must not reach the network');
  });

  await asyncTest('a good merge forwards both fields and returns the merged list', async () => {
    resetFake();
    const conversations = [{ id: 'c1', title: 't', messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: '2026-09-19T10:00:00.000Z' }] }];
    let seen = null;
    fake.mergeConversations = async (body) => { seen = body; return { success: true, conversations: body.conversations, deletedIds: ['x'] }; };
    const res = await post('/api/conversations/merge', { conversations, deletedIds: ['x'] });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(seen, { conversations, deletedIds: ['x'] });
    const body = await res.json();
    assert.deepStrictEqual(body.conversations, conversations);
    assert.deepStrictEqual(body.deletedIds, ['x']);
  });

  await asyncTest('âš ï¸ a 413 stays a 413 â€” the size policy retries on that and nothing else', async () => {
    resetFake();
    fake.mergeConversations = async () => {
      throw Object.assign(new Error('Conversation data too large. Try clearing old conversations.'), { status: 413 });
    };
    const res = await post('/api/conversations/merge', { conversations: [{}] });
    assert.strictEqual(res.status, 413, 'flattening this to 502 would break the retry-without-steps path');
    assert(/too large/i.test((await res.json()).error));
  });

  await asyncTest('401 from the backend also stays 401', async () => {
    resetFake();
    fake.mergeConversations = async () => {
      throw Object.assign(new Error('Not authorized'), { status: 401 });
    };
    assert.strictEqual((await post('/api/conversations/merge', { conversations: [{}] })).status, 401);
  });

  await asyncTest('an error with no status becomes a 502, with its message', async () => {
    resetFake();
    fake.mergeConversations = async () => { throw new Error('network unreachable'); };
    const res = await post('/api/conversations/merge', { conversations: [{}] });
    assert.strictEqual(res.status, 502);
    assert.strictEqual((await res.json()).error, 'network unreachable');
  });

  await asyncTest('a body with no conversations reaches the client rather than 500-ing here', async () => {
    resetFake();
    let seen = 'unset';
    fake.mergeConversations = async (body) => { seen = body; return { success: true }; };
    const res = await post('/api/conversations/merge', {});
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(seen, { conversations: undefined, deletedIds: undefined });
  });

  await asyncTest('the routes are not shadowed by another handler', async () => {
    resetFake();
    // A 404 here would mean a route-ordering problem (the repo has a static route test
    // for exactly this class of bug in backend/routes/routeData.js).
    fake.getConversations = async () => ({ signedIn: true, conversations: [{ id: 'probe', messages: [] }], deletedIds: [], updatedAt: null });
    const body = await (await get('/api/conversations')).json();
    assert.deepStrictEqual(body.conversations.map((c) => c.id), ['probe']);
  });

  await closeEvalHttpServer();

  console.log(`\nconversation-routes.test: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();

