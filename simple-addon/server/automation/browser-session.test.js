/**
 * browser-session.test.js — the two decisions that make a web task work or stall.
 *
 * Both are pure on purpose. The condition they exist for ("the site is signed in on
 * the user's real browser, and our own profile shows a sign-in page") cannot be
 * reproduced in CI, so the replaceable part of the decision is separated from the
 * part that needs a browser — and pinned here.
 */

const assert = require('assert');
const {
    DEFAULT_CDP_PORTS,
    cdpEndpoint,
    cdpCandidates,
    launchHint,
    classifyPageWall,
    wallExplanation,
} = require('./browser-session');

let pass = 0, fail = 0;
function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); pass++; }
    catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}

// ── Which browser to drive ──────────────────────────────────────────────────
test('cdpEndpoint: accepts every shape a model will produce', () => {
    // All four mean the same thing; rejecting one costs a round trip that looks
    // like a broken tool.
    assert.strictEqual(cdpEndpoint(9222), 'http://127.0.0.1:9222');
    assert.strictEqual(cdpEndpoint('9222'), 'http://127.0.0.1:9222');
    assert.strictEqual(cdpEndpoint('http://127.0.0.1:9222'), 'http://127.0.0.1:9222');
    assert.strictEqual(cdpEndpoint('127.0.0.1:9222/json/version'), 'http://127.0.0.1:9222');
    assert.strictEqual(cdpEndpoint('localhost:9333'), 'http://127.0.0.1:9333');
});

test('cdpEndpoint: defaults to the first candidate port when unspecified', () => {
    assert.strictEqual(cdpEndpoint(undefined), `http://127.0.0.1:${DEFAULT_CDP_PORTS[0]}`);
    assert.strictEqual(cdpEndpoint(''), `http://127.0.0.1:${DEFAULT_CDP_PORTS[0]}`);
});

test('cdpEndpoint: refuses a non-loopback host', () => {
    // A CDP endpoint is an UNAUTHENTICATED control channel for a browser the user
    // is signed into. Pointing it at another machine would hand that away, so the
    // host is fixed here rather than trusted from a tool argument.
    assert.strictEqual(cdpEndpoint('https://example.com:9222'), null);
    assert.strictEqual(cdpEndpoint('192.168.1.50:9222'), null);
    assert.strictEqual(cdpEndpoint('evil.test'), null);
    assert.strictEqual(cdpEndpoint('not a url'), null);
    assert.strictEqual(cdpEndpoint('99999'), null);
});

test('cdpCandidates: an explicit endpoint is the only one tried', () => {
    assert.deepStrictEqual(cdpCandidates(9333), ['http://127.0.0.1:9333']);
    // …and an invalid explicit endpoint tries NOTHING, rather than silently
    // falling back to a port the user did not name.
    assert.deepStrictEqual(cdpCandidates('example.com:9222'), []);
});

test('cdpCandidates: without a port, all the usual ports are tried in order', () => {
    assert.deepStrictEqual(cdpCandidates(undefined), DEFAULT_CDP_PORTS.map((p) => `http://127.0.0.1:${p}`));
});

test('launchHint: warns about the non-default profile, which is not optional', () => {
    const hint = launchHint(9222);
    // Chrome/Edge ≥136 IGNORE the debugging port on the default profile, so a
    // command without --user-data-dir silently does nothing and looks like our bug.
    assert.match(hint.command, /--remote-debugging-port=9222/);
    assert.match(hint.command, /--user-data-dir=/);
    assert.match(hint.why, /ignore the debugging port/i);
    // …and it explains why the profile matters: that is where the sign-in lives.
    assert.match(hint.why, /sign in to the site ONCE/i);
});

// ── Is this page a wall? ────────────────────────────────────────────────────
test('wall: Google Messages pairing screen (the reported case)', () => {
    const r = classifyPageWall({
        url: 'https://messages.google.com/web/pairing',
        title: 'Messages for web',
        text: 'Scan this QR code with your phone to pair Messages for web.',
    });
    assert.strictEqual(r.wall, 'pairing');
    assert.match(r.explanation, /PAIRING/);
    // It must tell the agent to STOP, because trying selectors is the stall.
    assert.match(r.explanation, /STOP trying selectors/);
});

test('wall: a Google sign-in / account chooser', () => {
    const r = classifyPageWall({
        url: 'https://accounts.google.com/signin/v2/identifier',
        title: 'Sign in - Google Accounts',
        text: 'Use your Google Account. Sign in to continue.',
    });
    assert.strictEqual(r.wall, 'sign-in');
    assert.match(r.explanation, /sign-in screen/);
});

test('wall: a two-factor / passkey challenge', () => {
    const r = classifyPageWall({ url: 'https://example.com/step', title: '', text: "2-Step Verification: enter the code" });
    assert.strictEqual(r.wall, 'challenge');
    assert.match(r.explanation, /verification step/);
});

test('wall: a generic login page on a login-ish URL', () => {
    const r = classifyPageWall({ url: 'https://site.test/login', title: 'Log in', text: 'Enter your password to continue' });
    assert.strictEqual(r.wall, 'sign-in');
});

test('NOT a wall: an ordinary signed-in page that merely mentions signing in', () => {
    // The most important negative. A detector that cries wolf on a working page
    // makes the agent stop and ask the user to do something unnecessary — worse
    // than no detector, because the task *was* going fine.
    const r = classifyPageWall({
        url: 'https://chat.test/inbox',
        title: 'Inbox',
        text: 'Hey — I forgot my password, can you help? Also the sign in screen looks broken on mobile.',
    });
    assert.strictEqual(r.wall, null);
    assert.strictEqual(r.explanation, null);
});

test('NOT a wall: a settings page about passwords', () => {
    const r = classifyPageWall({
        url: 'https://site.test/settings/security',
        title: 'Security settings',
        text: 'Change your password. Forgot your password? Reset it here.',
    });
    // `login-ish URL AND password wording` is the rule — settings/security is not
    // a login URL, so the phrase alone must not fire.
    assert.strictEqual(r.wall, null);
});

test('NOT a wall: an empty page, and a blank session', () => {
    assert.strictEqual(classifyPageWall({}).wall, null);
    assert.strictEqual(classifyPageWall({ url: 'about:blank' }).wall, null);
    assert.strictEqual(classifyPageWall().wall, null);
});

test('NOT a wall: /auth/ in a path with no login wording', () => {
    // A URL fragment alone is not proof — plenty of apps put `/auth/` in a callback
    // path that lands on a working page.
    const r = classifyPageWall({ url: 'https://site.test/auth/callback?ok=1', title: 'Dashboard', text: 'Welcome back' });
    assert.strictEqual(r.wall, null);
});

// ── The advice has to name the right escape hatch ───────────────────────────
test('advice: a HEADLESS session is called out as uncompletable', () => {
    const r = classifyPageWall({
        url: 'https://accounts.google.com/signin',
        text: 'Use your Google Account',
        headless: true,
    });
    // Nobody can sign in to a window that is not on screen — saying so is the
    // difference between one clear instruction and another stall.
    assert.match(r.explanation, /HEADLESS/);
    assert.match(r.explanation, /headless:false/);
});

test('advice: a visible session tells the user to sign in once', () => {
    const r = classifyPageWall({ url: 'https://accounts.google.com/signin', text: 'Use your Google Account', headless: false });
    assert.doesNotMatch(r.explanation, /HEADLESS/);
    assert.match(r.explanation, /sign in once/i);
    assert.match(r.explanation, /persistent profile/i);
});

test('advice: an ATTACHED session tells the agent not to restart anything', () => {
    const r = classifyPageWall({ url: 'https://accounts.google.com/signin', text: 'Use your Google Account', attached: true });
    // We are already in the user's browser — closing it would destroy the very
    // session that makes the task possible.
    assert.match(r.explanation, /OWN browser/);
    assert.match(r.explanation, /do not restart the session/i);
    assert.doesNotMatch(r.explanation, /headless:false/);
});

test('advice: always offers the attach route with the command to run', () => {
    const r = classifyPageWall({ url: 'https://accounts.google.com/signin', text: 'Use your Google Account', headless: false });
    assert.match(r.explanation, /attach: true/);
    assert.match(r.explanation, /--remote-debugging-port/);
});

test('every wall names a next move, and never just restates the problem', () => {
    const walls = [
        { url: 'https://messages.google.com/web/pairing', text: 'Scan this QR code' },
        { url: 'https://accounts.google.com/signin', text: 'Use your Google Account' },
        { url: 'https://site.test/login', text: 'Enter your password' },
        { url: 'https://x.test/a', text: 'Verify it\'s you' },
    ];
    for (const page of walls) {
        const r = classifyPageWall(page);
        assert.ok(r.wall, `expected a wall for ${page.url}`);
        assert.ok(r.explanation.length > 60, `thin explanation for ${r.wall}`);
        assert.ok(
            /STOP|ask them|sign in once|attach: true|headless:false/i.test(r.explanation),
            `no next move for ${r.wall}`,
        );
    }
});

test('wallExplanation stays useful when called directly', () => {
    assert.match(wallExplanation('pairing', {}), /PAIRING/);
    assert.match(wallExplanation('sign-in', { url: 'https://a.test' }), /https:\/\/a\.test/);
    assert.match(wallExplanation('something-else', {}), /needs something from the user/);
});

console.log(`\nbrowser-session.test: ${pass}/${pass + fail} PASS`);
process.exit(fail > 0 ? 1 : 0);
