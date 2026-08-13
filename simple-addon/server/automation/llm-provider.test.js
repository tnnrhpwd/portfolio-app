'use strict';

const assert = require('assert');

// Fake the addon's ONE network dependency (workspace-client.js) so llm-provider.js's
// default backend-proxy adapter can be exercised with no real HTTP calls. This
// replaces the old require.cache fake for github-models-service.js — GitHub
// Models is retired, and every LLM call now proxies through the backend via
// workspace-client.js's agentChat/agentVision.
const wsClientPath = require.resolve('./workspace-client');

let chatCallCount = 0;
let chatShouldFailTimes = 0;
let chatFailError = new Error('network timeout');

const fakeWsClient = {
    setTokenGetter() {},
    getToken() { return 'fake-jwt'; },
    async agentChat({ messages } = {}) {
        chatCallCount++;
        if (chatShouldFailTimes > 0) {
            chatShouldFailTimes--;
            throw chatFailError;
        }
        const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
        return { ok: true, text: `echo:${last && last.content}`, toolCalls: null };
    },
    async agentVision({ prompt } = {}) {
        return { ok: true, text: `image-echo:${prompt}` };
    },
};

require.cache[wsClientPath] = {
    id: wsClientPath, filename: wsClientPath, loaded: true, exports: fakeWsClient,
};

const { createLlmProvider, createLocalStubProvider, withRetries, CAPABILITIES } = require('./llm-provider');

let pass = 0;
let fail = 0;
const queue = [];
function test(name, fn) {
    queue.push(async () => {
        try {
            await fn();
            pass++;
            console.log(`  ok - ${name}`);
        } catch (err) {
            fail++;
            console.log(`  FAIL - ${name}`);
            console.log(`    ${err.message}`);
        }
    });
}

test('passes an injected llmClient straight through unchanged', () => {
    const injected = { chat: async () => ({ text: 'x' }) };
    const provider = createLlmProvider({ llmClient: injected });
    assert.strictEqual(provider, injected);
});

test('default mode is backend-proxy — chat()/chatMultimodal() proxy through workspace-client (never GitHub Models directly)', async () => {
    chatShouldFailTimes = 0;
    const provider = createLlmProvider();
    assert.strictEqual(provider.providerName, 'backend-proxy');
    assert.deepStrictEqual(provider.capabilities, CAPABILITIES['backend-proxy']);
    assert.strictEqual(typeof provider.setToken, 'function');
    const chatResult = await provider.chat({ message: 'hi' });
    assert.strictEqual(chatResult.text, 'echo:hi');
    const imgResult = await provider.chatMultimodal({ prompt: 'describe' });
    assert.strictEqual(imgResult.text, 'image-echo:describe');
    // chatWithImage is an alias for chatMultimodal (vision-fusion.js et al).
    const imgResult2 = await provider.chatWithImage({ prompt: 'describe again' });
    assert.strictEqual(imgResult2.text, 'image-echo:describe again');
});

test('setToken() is accepted (interface-compat no-op / explicit override) and never throws', async () => {
    const provider = createLlmProvider();
    assert.doesNotThrow(() => provider.setToken('some-token'));
    const result = await provider.chat({ message: 'still works' });
    assert.strictEqual(result.text, 'echo:still works');
});

test('local-stub mode never touches the network and echoes deterministically', async () => {
    const provider = createLlmProvider({ mode: 'local-stub' });
    assert.strictEqual(provider.providerName, 'local-stub');
    assert.deepStrictEqual(provider.capabilities, CAPABILITIES['local-stub']);
    const chatResult = await provider.chat({ message: 'hello world' });
    assert.ok(chatResult.text.includes('hello world'));
    assert.ok(chatResult.text.includes('local-stub'));
    const imgResult = await provider.chatWithImage({ prompt: 'a cat' });
    assert.ok(imgResult.text.includes('a cat'));
});

test('createLocalStubProvider() is usable standalone (matches mode:"local-stub")', async () => {
    const provider = createLocalStubProvider();
    const result = await provider.chat({ message: 'standalone' });
    assert.ok(result.text.includes('standalone'));
});

test('withRetries retries on a transient/network-shaped error then succeeds', async () => {
    let calls = 0;
    const flaky = async () => {
        calls++;
        if (calls < 3) throw new Error('ETIMEDOUT connecting to model host');
        return 'ok';
    };
    const wrapped = withRetries(flaky, { retries: 3, backoffMs: 1 });
    const result = await wrapped();
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 3);
});

test('withRetries does NOT retry a non-retryable (auth/config) error', async () => {
    let calls = 0;
    const alwaysAuthFails = async () => {
        calls++;
        throw new Error('No auth token — sign in on the web app first, then try again.');
    };
    const wrapped = withRetries(alwaysAuthFails, { retries: 3, backoffMs: 1 });
    await assert.rejects(() => wrapped(), /no auth token/i);
    assert.strictEqual(calls, 1);
});

test('withRetries gives up after exhausting the retry budget and throws the last error', async () => {
    let calls = 0;
    const alwaysNetworkFails = async () => {
        calls++;
        throw new Error('fetch failed: network error');
    };
    const wrapped = withRetries(alwaysNetworkFails, { retries: 2, backoffMs: 1 });
    await assert.rejects(() => wrapped(), /fetch failed/);
    assert.strictEqual(calls, 3); // 1 initial attempt + 2 retries
});

test('createLlmProvider({ retries }) transparently applies retry policy to chat()', async () => {
    chatShouldFailTimes = 2;
    chatFailError = new Error('ECONNRESET while calling backend');
    chatCallCount = 0;
    const provider = createLlmProvider({ retries: 3, backoffMs: 1 });
    const result = await provider.chat({ message: 'retried' });
    assert.strictEqual(result.text, 'echo:retried');
    assert.strictEqual(chatCallCount, 3);
});

test('createLlmProvider() with retries:0 (default) does not wrap/retry at all', async () => {
    chatShouldFailTimes = 1;
    chatFailError = new Error('ETIMEDOUT');
    chatCallCount = 0;
    const provider = createLlmProvider();
    await assert.rejects(() => provider.chat({ message: 'no-retry' }));
    assert.strictEqual(chatCallCount, 1);
    chatShouldFailTimes = 0;
});

(async () => {
    for (const t of queue) await t();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
})();
