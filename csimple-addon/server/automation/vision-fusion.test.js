const assert = require('assert');

const screenPath = require.resolve('./tools/screen');
const permissionsPath = require.resolve('./permissions');
const eventsPath = require.resolve('./events');
const ghModelsPath = require.resolve('../github-models-service');

const fakeScreen = {
    async _captureBuffer() {
        return { base64: 'AAAA', buffer: Buffer.from('png-bytes') };
    },
};

const fakePermissions = {
    _cloudVisionConsent: false,
    _grantCalls: 0,
    hasCloudVisionConsent() { return this._cloudVisionConsent; },
    grantCloudVisionConsent() {
        this._grantCalls += 1;
        this._cloudVisionConsent = true;
    },
    revokeCloudVisionConsent() {
        this._cloudVisionConsent = false;
    },
};

const fakeEvents = {
    _published: [],
    publish(type, payload) {
        this._published.push({ type, payload });
    },
};

class FakeGitHubModelsService {
    setToken() {}
    async chatWithImage() {
        return { text: '{"x":10,"y":20,"confidence":0.9,"note":"ok"}' };
    }
}

require.cache[screenPath] = {
    id: screenPath, filename: screenPath, loaded: true, exports: fakeScreen,
};
require.cache[permissionsPath] = {
    id: permissionsPath, filename: permissionsPath, loaded: true, exports: fakePermissions,
};
require.cache[eventsPath] = {
    id: eventsPath, filename: eventsPath, loaded: true, exports: fakeEvents,
};
require.cache[ghModelsPath] = {
    id: ghModelsPath, filename: ghModelsPath, loaded: true, exports: { GitHubModelsService: FakeGitHubModelsService },
};

const { findVisualTarget } = require('./vision-fusion');

let pass = 0;
let fail = 0;
const queue = [];
function asyncTest(name, fn) {
    queue.push(async () => {
        try { await fn(); console.log(`  PASS  ${name}`); pass++; }
        catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); fail++; }
    });
}

asyncTest('run: no consent and no confirmCloudVisionCapture -> throws actionable error', async () => {
    fakePermissions._cloudVisionConsent = false;
    await assert.rejects(
        () => findVisualTarget.run({ description: 'Submit button', dryRun: true }, {}),
        /Cloud vision consent required/i
    );
});

asyncTest('run: consent can be granted via confirmCloudVisionCapture then dry-run succeeds', async () => {
    fakePermissions._cloudVisionConsent = false;
    fakePermissions._grantCalls = 0;
    fakeEvents._published = [];

    const out = await findVisualTarget.run({
        description: 'Submit button',
        confirmCloudVisionCapture: true,
        dryRun: true,
        region: { x: 5, y: 7, width: 100, height: 80 },
    }, {});

    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.dryRun, true);
    assert.deepStrictEqual(out.coords, { x: 15, y: 27 });
    assert.strictEqual(fakePermissions._grantCalls, 1);
    assert.strictEqual(fakePermissions.hasCloudVisionConsent(), true);
    const evt = fakeEvents._published.find(e => e.type === 'permissions.changed');
    assert.ok(evt, 'permissions.changed event should be published on first grant');
});

asyncTest('run: after consent revoke, flow blocks again until reconfirmed', async () => {
    fakePermissions._cloudVisionConsent = true;
    fakePermissions.revokeCloudVisionConsent();
    await assert.rejects(
        () => findVisualTarget.run({ description: 'Toolbar icon', dryRun: true }, {}),
        /Cloud vision consent required/i
    );
});

(async () => {
    for (const t of queue) await t();
    console.log(`\nvision-fusion.test: ${pass}/${pass + fail} PASS`);
    process.exit(fail > 0 ? 1 : 0);
})();
