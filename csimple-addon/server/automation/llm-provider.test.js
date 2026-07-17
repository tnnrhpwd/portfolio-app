const assert = require('assert');

const ghModelsPath = require.resolve('../github-models-service');

let chatCallCount = 0;
let chatShouldFailTimes = 0;
let chatFailError = new Error('network timeout');

class FakeGitHubModelsService {
    setToken(token) { this._token = token; }
    async chat(opts) {
        chatCallCount++;
        if (chatShouldFailTimes > 0) {
            chatShouldFailTimes--;
            throw chatFailError;
        }
        return { text: `echo:${opts && opts.message}`, generationTime: '1ms', toolCalls: null };
    }
    async chatWithImage(opts) {
        return { text: `image-echo:${opts && opts.prompt}`, generationTime: '1ms' };
    }
}

require.cache[ghModelsPath] = {
    id: ghModelsPath, filename: ghModelsPath, loaded: true, exports: { GitHubModelsService: FakeGitHubModelsService },
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

test('default mode wraps GitHubModelsService with providerName/capabilities/chatMultimodal', async () => {
    chatShouldFailTimes = 0;
    const provider = createLlmProvider();
    assert.strictEqual(provider.providerName, 'github-models');
    assert.deepStrictEqual(provider.capabilities, CAPABILITIES['github-models']);
    assert.strictEqual(typeof provider.setToken, 'function');
    const chatResult = await provider.chat({ message: 'hi' });
    assert.strictEqual(chatResult.text, 'echo:hi');
    const imgResult = await provider.chatMultimodal({ prompt: 'describe' });
    assert.strictEqual(imgResult.text, 'image-echo:describe');
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
        throw new Error('GitHub token not configured. Go to Settings...');
    };
    const wrapped = withRetries(alwaysAuthFails, { retries: 3, backoffMs: 1 });
    await assert.rejects(() => wrapped(), /token not configured/);
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
    chatFailError = new Error('ECONNRESET while calling model host');
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
