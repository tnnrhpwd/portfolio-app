/**
 * browser-session.js — session strategy for `browser_*`: attaching to the
 * browser the user is ALREADY signed into, and recognising the wall that stops
 * everything when we are not.
 *
 * **The failure this exists for.** A user asked /net to *"google message my
 * girlfriend that I love her — I am already signed into google message on
 * microsoft edge"*. The agent had nine browser tools, `playwright-core`
 * installed, and Edge detected. It stalled and reported nothing.
 *
 * Three things lined up behind that:
 *
 *   1. `ensureSession()` launched **its own fresh profile**
 *      (`%APPDATA%\simple-addon\playwright-profiles\default`). Their Google
 *      session lives in their real Edge profile, so the page that loaded was a
 *      sign-in / device-pairing wall — not their messages. The hint in their
 *      message ("I am already signed in") was exactly the thing the code could
 *      not use.
 *   2. That session was **headless** (`headless: headless !== false`, and every
 *      other tool calls `ensureSession()` with no arguments). Nobody can sign in
 *      to a window that is not on screen, so the dead end was absolute.
 *   3. Nothing DETECTED the wall. `browser_goto` returned `{status: 200, title}`,
 *      which reads as success. The agent then hunted for selectors that do not
 *      exist on that page, each burning a 15 s timeout, scoring no progress —
 *      the `stalled` stop the user saw.
 *
 * So this module holds the two decisions that fix it, as pure functions:
 * **which browser to drive** (`cdpCandidates`, `launchHint`) and **whether the
 * page is a wall** (`classifyPageWall`). Both are testable without launching
 * anything, which matters because the real condition only reproduces on a machine
 * with a signed-in browser.
 *
 * ⚠️ This module must not require playwright. It is imported by the tool module
 * (which does) and by its own tests (which must not need a browser installed).
 */

/** Ports a Chromium-family browser is commonly started with for automation. */
const DEFAULT_CDP_PORTS = Object.freeze([9222, 9223, 9333]);

/** Where a user-launched debugging browser is usually told to keep its profile. */
const DEFAULT_CDP_PROFILE_HINT = '%LOCALAPPDATA%\\simple-addon\\edge-automation';

/**
 * Normalise whatever the model passed into a CDP HTTP endpoint.
 *
 * Accepts a bare port, `9222`, `http://127.0.0.1:9222`, or a full `/json/version`
 * URL — the model will produce any of these, and rejecting one of them costs a
 * round trip that looks like a broken tool.
 *
 * @returns {string|null} e.g. `http://127.0.0.1:9222`
 */
function cdpEndpoint(value, { ports = DEFAULT_CDP_PORTS } = {}) {
    const raw = String(value ?? '').trim();
    if (!raw) return ports.length ? `http://127.0.0.1:${ports[0]}` : null;

    // A bare port number.
    if (/^\d{2,5}$/.test(raw)) {
        const port = Number(raw);
        return port > 0 && port < 65536 ? `http://127.0.0.1:${port}` : null;
    }

    let url;
    try {
        url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    } catch {
        return null;
    }
    // Loopback only. A remote debugging endpoint is an UNauthenticated control
    // channel for a browser the user is signed into — pointing it at a host on the
    // network would hand that away, so the scheme/host is fixed here rather than
    // trusted from a tool argument.
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return null;
    const port = url.port || '9222';
    return `http://127.0.0.1:${port}`;
}

/** The endpoints to try, in order, when `attach` is requested without a port. */
function cdpCandidates(value, opts = {}) {
    const explicit = cdpEndpoint(value, opts);
    if (String(value ?? '').trim()) return explicit ? [explicit] : [];
    return (opts.ports || DEFAULT_CDP_PORTS).map((p) => `http://127.0.0.1:${p}`);
}

/**
 * How to get an attachable browser, in the form a user can copy and run.
 *
 * ⚠️ A separate `--user-data-dir` is REQUIRED, not a preference: since Chrome/Edge
 * 136 the debugging port is ignored when the default profile directory is in use,
 * so `msedge --remote-debugging-port=9222` alone silently does nothing and looks
 * like our tool being broken. The profile is also what keeps the sign-in: the user
 * signs in once in this window and every later run reuses it.
 */
function launchHint(port = DEFAULT_CDP_PORTS[0]) {
    return {
        command: `msedge.exe --remote-debugging-port=${port} --user-data-dir="${DEFAULT_CDP_PROFILE_HINT}"`,
        why: 'Chrome/Edge ignore the debugging port when the default profile is in use, so a separate --user-data-dir is required. '
            + 'That profile is where the sign-in persists: sign in to the site ONCE in the window it opens, and every later run reuses it.',
        profileHint: DEFAULT_CDP_PROFILE_HINT,
    };
}

/**
 * Is this page a wall rather than the thing the user asked for?
 *
 * Returns `{ wall, explanation }` where `wall` is null for an ordinary page. The
 * explanation is written for the AGENT to relay, so it names the next move instead
 * of restating the problem.
 *
 * Signals are matched most-specific-first and deliberately require STRONG evidence:
 * a URL on a known auth host, or a phrase that only appears on a challenge page.
 * A loose match like "sign in" would fire on the nav bar of a signed-in app, and a
 * detector that cries wolf on working pages is worse than none — the agent would
 * stop asking the user to do the one thing that unblocks it.
 */
const WALL_RULES = Object.freeze([
    {
        // Google Messages device pairing (QR link to the phone).
        wall: 'pairing',
        url: /messages\.google\.com\/(?:web\/)?(?:pairing|pair)/i,
        phrases: [/scan this qr code/i, /pair your phone/i, /messages for web/i, /link your phone/i],
    },
    {
        // Any Google sign-in / account chooser.
        wall: 'sign-in',
        url: /^https?:\/\/accounts\.google\.com\//i,
        host: 'accounts.google.com',
        phrases: [/use your google account/i, /sign in to continue/i, /choose an account/i],
    },
    {
        // A second factor or a "verify it's you" step.
        wall: 'challenge',
        url: null,
        phrases: [/2-step verification/i, /two-step verification/i, /verify it's you/i, /enter the (?:code|passkey)/i, /use your passkey/i],
    },
    {
        // A generic login form. Requires a login-ish URL AND password wording, so a
        // signed-in app that merely mentions "password" in a settings screen or a
        // chat message does not trip it.
        wall: 'sign-in',
        url: /\/(?:sign[-_]?in|log[-_]?in|login|auth|session|accounts?)\b/i,
        phrases: [/enter your password/i, /forgot (?:your )?password/i, /sign in to (?:continue|your account)/i, /log in to (?:continue|your account)/i],
    },
]);

/**
 * @param {object} page
 * @param {string} [page.url]
 * @param {string} [page.title]
 * @param {string} [page.text]   visible text sample (a slice is enough)
 * @param {boolean} [page.headless] whether the session that produced this has no window
 * @param {boolean} [page.attached] whether we are driving the user's own browser
 * @returns {{wall: string|null, explanation: string|null}}
 */
function classifyPageWall({ url = '', title = '', text = '', headless = false, attached = false } = {}) {
    const u = String(url || '');
    const t = String(title || '');
    const body = String(text || '').slice(0, 20_000);
    const haystackTitle = t;
    const haystackBody = `${t}\n${body}`;

    for (const rule of WALL_RULES) {
        // Three shapes of rule, and the evidence each needs:
        //   host only            — the host IS the proof (accounts.google.com)
        //   url + phrases        — a login-ish path must AGREE with login wording,
        //                          so `/auth/` on a working page cannot fire alone
        //   phrases only         — a phrase that appears nowhere but a challenge,
        //                          which is the only way to catch a 2FA step on an
        //                          arbitrary URL
        // (The first version ANDed `urlHit` into every branch, so a phrases-only rule
        // could never match at all — a dead rule is worse than none, because the
        // case looks covered.)
        const hostHit = rule.host ? u.includes(rule.host) : false;
        const urlHit = rule.url ? rule.url.test(u) : false;
        const phraseHit = rule.phrases.some((re) => re.test(haystackBody));

        let matched;
        if (rule.host) matched = hostHit || (urlHit && phraseHit);
        else if (rule.url) matched = urlHit && phraseHit;
        else matched = phraseHit;

        if (!matched) continue;

        return { wall: rule.wall, explanation: wallExplanation(rule.wall, { url: u, title: haystackTitle, headless, attached }) };
    }

    return { wall: null, explanation: null };
}

/** The next move for a detected wall, in the agent's words. */
function wallExplanation(wall, { url = '', headless = false, attached = false } = {}) {
    const where = url ? ` (${url})` : '';

    if (wall === 'pairing') {
        return `The page that loaded is Google Messages' device-PAIRING screen${where}, not the user's conversation list. `
            + 'It has to be linked to the user\'s phone by scanning a QR code, which only the user can do, and it has to be done in a browser window they can see. '
            + 'STOP trying selectors on this page — they do not exist here. '
            + attachAdvice({ headless, attached });
    }

    if (wall === 'sign-in' || wall === 'challenge') {
        const what = wall === 'sign-in' ? 'a sign-in screen' : 'a verification step (a code or a passkey)';
        return `The page that loaded is ${what}${where}. Only the user can complete it, and it must be completed in a browser window they can see. `
            + 'STOP trying selectors on this page — they are not the page the user meant. '
            + attachAdvice({ headless, attached });
    }

    return `This page needs something from the user before it can continue${where}. ${attachAdvice({ headless, attached })}`;
}

/** The two ways out, chosen so the agent can offer exactly one of them. */
function attachAdvice({ headless, attached } = {}) {
    if (attached) {
        return 'You are already driving the user\'s OWN browser, so they can simply complete it there — ask them to, then continue (do not restart the session).';
    }
    const headlessNote = headless
        ? 'This session is HEADLESS, so nobody can complete it as it stands: call browser_close, then browser_open with headless:false so the window is on screen. '
        : 'The window is visible, so the user can complete it now. ';
    return `${headlessNote}Then either ask them to sign in once in that window (it is a persistent profile — once is enough, and every later run reuses it), `
        + 'or use browser_open({ attach: true }) to drive the browser they are already signed into '
        + `(it must have been started with ${launchHint().command}). `;
}

module.exports = {
    DEFAULT_CDP_PORTS,
    DEFAULT_CDP_PROFILE_HINT,
    WALL_RULES,
    cdpEndpoint,
    cdpCandidates,
    launchHint,
    classifyPageWall,
    wallExplanation,
};
