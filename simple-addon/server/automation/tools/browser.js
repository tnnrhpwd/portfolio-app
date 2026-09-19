/**
 * browser_* — Chromium-based browser automation via playwright-core.
 *
 * Design choices:
 *
 *   - `playwright-core` only (no bundled browser). We auto-detect a Chromium
 *     channel in this order:
 *         env SIMPLE_BROWSER_PATH → channel=msedge → channel=chrome
 *     Microsoft Edge ships with Windows 10/11, so the default install needs
 *     no extra downloads. If neither is found we throw a clear error.
 *
 *   - One singleton context per addon process (`_session`). The agent rarely
 *     needs more than one concurrent browser, and a singleton makes selector
 *     APIs simple ("click selector X" — no need to address a specific tab).
 *     `browser_open` is idempotent: calling it twice returns the existing
 *     session and updates options like headless/window size if provided.
 *
 *   - Optional `userDataDir` persists cookies/localStorage between calls.
 *     Defaults to `<userData>/playwright-profile/<profile>` so the user can
 *     keep multiple isolated profiles (e.g. work vs personal).
 *
 *   - All actions return JSON-friendly summaries (urls, titles, text), never
 *     raw Page objects.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { cdpCandidates, launchHint, classifyPageWall } = require('../browser-session');

/**
 * Is the current page a wall (sign-in, device pairing, 2FA) rather than the thing
 * the user asked for?
 *
 * Called by `browser_goto` and `browser_status` so the answer reaches the model
 * WITHOUT it having to guess. The old behaviour returned `{status: 200, title}` for
 * a sign-in page, which reads as success — so the agent hunted for selectors that
 * do not exist, each burning a 15 s timeout, and the run scored no progress until
 * it stalled. See `browser-session.js` for why that page was a wall to begin with.
 *
 * Best-effort by design: a page whose body cannot be read still yields a verdict
 * from the URL and title alone.
 */
async function inspectPage(session) {
    const page = session?.page;
    if (!page) return { wall: null, explanation: null };
    let text = '';
    try {
        text = await page.locator('body').innerText({ timeout: 2_000 });
    } catch { /* a page that never settles still has a url and a title */ }
    return classifyPageWall({
        url: page.url(),
        title: await page.title().catch(() => ''),
        text,
        headless: session.headless === true,
        attached: session.attached === true,
    });
}

// playwright-core is loaded lazily so the addon doesn't pay the require cost
// until a browser tool actually runs.
let _pwCore = null;
function loadPlaywright() {
    if (_pwCore) return _pwCore;
    _pwCore = require('playwright-core');
    return _pwCore;
}

// In-process session state. Lives until browser_close (or process exit).
let _session = null;
// { browser, context, page, channel, executablePath, userDataDir, startedAt }

const DEFAULT_NAV_TIMEOUT_MS = 30_000;
const DEFAULT_ACTION_TIMEOUT_MS = 15_000;

function userDataRoot() {
    const base = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'simple-addon')
        : path.join(os.homedir(), '.simple-addon');
    return path.join(base, 'playwright-profiles');
}

function resolveBrowserChannel() {
    if (process.env.SIMPLE_BROWSER_PATH && fs.existsSync(process.env.SIMPLE_BROWSER_PATH)) {
        return { channel: 'msedge', executablePath: process.env.SIMPLE_BROWSER_PATH };
    }
    // Edge default install path on Windows.
    const edgeCandidates = [
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env['ProgramFiles'] && path.join(process.env['ProgramFiles'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ].filter(Boolean);
    for (const p of edgeCandidates) {
        if (fs.existsSync(p)) return { channel: 'msedge', executablePath: p };
    }
    // Chrome fallback.
    const chromeCandidates = [
        process.env['ProgramFiles'] && path.join(process.env['ProgramFiles'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['LOCALAPPDATA'] && path.join(process.env['LOCALAPPDATA'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].filter(Boolean);
    for (const p of chromeCandidates) {
        if (fs.existsSync(p)) return { channel: 'chrome', executablePath: p };
    }
    throw new Error(
        'No Chromium-based browser found. Install Microsoft Edge (ships with Windows) or Google Chrome, ' +
        'or set SIMPLE_BROWSER_PATH to a Chromium executable.'
    );
}

async function ensureSession({ headless, profile, viewport, attach, cdpUrl, cdpPort } = {}) {
    if (_session) return _session;
    const pw = loadPlaywright();
    const { channel, executablePath } = resolveBrowserChannel();
    const profileName = String(profile || 'default').replace(/[^\w.-]/g, '_');
    const userDataDir = path.join(userDataRoot(), profileName);
    fs.mkdirSync(userDataDir, { recursive: true });

    // ── Attach to the browser the user is ALREADY signed into ────────────────
    //
    // This is the difference between "sign in first" and just working. Our own
    // persistent profile starts empty, so every signed-in site is a wall; the
    // user's real browser already has the session. Requires the browser to have
    // been started with --remote-debugging-port on a NON-default profile
    // (Chrome/Edge ≥136 ignore the port on the default one) — see launchHint().
    if (attach) {
        const candidates = cdpCandidates(cdpUrl ?? cdpPort);
        if (!candidates.length) {
            throw new Error(`attach needs a loopback debugging endpoint — tried "${cdpUrl ?? cdpPort}". ${launchHint().command}`);
        }
        let lastErr = null;
        for (const endpoint of candidates) {
            try {
                const browser = await pw.chromium.connectOverCDP(endpoint, { timeout: 8_000 });
                const context = browser.contexts()[0] || await browser.newContext();
                const pages = context.pages();
                const page = pages[pages.length - 1] || await context.newPage();
                _session = {
                    browser,
                    context,
                    page,
                    channel,
                    executablePath,
                    userDataDir: null,
                    profile: profileName,
                    attached: true,
                    cdpUrl: endpoint,
                    startedAt: Date.now(),
                };
                return _session;
            } catch (e) { lastErr = e; }
        }
        throw new Error(
            `Could not attach to a browser on ${candidates.join(' or ')} (${lastErr?.message || 'no endpoint answered'}). `
            + `${launchHint().why} Expected launch: ${launchHint().command}`
        );
    }

    // launchPersistentContext gives us BrowserContext+cookies+localStorage in
    // a single call; far simpler than launch() + newContext().
    const context = await pw.chromium.launchPersistentContext(userDataDir, {
        channel,
        executablePath,
        headless: headless !== false,
        viewport: viewport || { width: 1280, height: 800 },
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
    });

    context.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT_MS);
    context.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);

    // Use the first existing page if there is one (persistent contexts open
    // an about:blank by default), otherwise create one.
    const page = context.pages()[0] || await context.newPage();

    _session = {
        browser: null,           // launchPersistentContext doesn't expose a separate Browser
        context,
        page,
        channel,
        executablePath,
        userDataDir,
        profile: profileName,
        attached: false,
        headless: headless !== false,
        startedAt: Date.now(),
    };
    return _session;
}

/**
 * Close the session.
 *
 * ⚠️ An ATTACHED session is never closed, only disconnected from. `browser.close()`
 * on a CDP connection shuts down the user's browser — with every tab they had open
 * and every sign-in state along with it — which is not something a "close the
 * browser session" tool may do to a browser it did not start. We drop our
 * reference; they keep their browser.
 */
async function closeSession() {
    if (!_session) return { closed: false, reason: 'no session' };
    if (_session.attached) {
        const url = _session.cdpUrl;
        _session = null;
        return { closed: true, detached: true, cdpUrl: url, note: 'detached — the user\'s own browser was left running' };
    }
    try { await _session.context.close(); } catch {}
    _session = null;
    return { closed: true };
}

function describePage(page) {
    return {
        url: page.url(),
        title: undefined,    // filled by callers if needed (title() is async)
    };
}

// ─── Tools ───────────────────────────────────────────────────────────────

const browserOpen = {
    name: 'browser_open',
    category: 'sandboxed-write',
    description:
        'Launch (or attach to) the singleton browser session. Idempotent: if a session ' +
        'is already running, returns its current url/profile. Use `profile` to keep separate ' +
        'cookie jars per workflow (default: "default"). Set `headless: false` if the user ' +
        'wants to watch the browser visibly. ' +
        'IMPORTANT: set `attach: true` when the task needs a site the user is ALREADY signed into ' +
        '(webmail, a chat app, a dashboard) — it drives the browser they are logged into instead of a ' +
        'fresh profile that shows a sign-in page. That browser must have been started with ' +
        'a --remote-debugging-port on a non-default profile; if the attach fails this returns the exact ' +
        'command to run, so relay it to the user rather than retrying.',
    parameters: {
        type: 'object',
        properties: {
            headless: { type: 'boolean', description: 'Default true. Set false to show the window. Irrelevant when attach is true.' },
            profile: { type: 'string', description: 'Profile dir name (alphanumeric). Default "default".' },
            viewport: {
                type: 'object',
                properties: { width: { type: 'integer' }, height: { type: 'integer' } },
            },
            attach: { type: 'boolean', description: 'Drive the browser the user is already signed into, over CDP, instead of launching our own profile.' },
            cdpPort: { type: 'integer', description: 'Debugging port of that browser. Default: try 9222, 9223, 9333.' },
        },
    },
    async run(args = {}) {
        const s = await ensureSession(args);
        return {
            opened: true,
            attached: !!s.attached,
            ...(s.cdpUrl ? { cdpUrl: s.cdpUrl } : {}),
            channel: s.channel,
            executablePath: s.executablePath,
            profile: s.profile,
            ...(s.userDataDir ? { userDataDir: s.userDataDir } : {}),
            url: s.page.url(),
            title: await s.page.title(),
        };
    },
};

const browserGoto = {
    name: 'browser_goto',
    category: 'sandboxed-write',
    description:
        'Navigate the browser to a URL. Opens the session if none exists. ' +
        'Waits for the network to be roughly idle before returning. ' +
        'The result includes `wall` when the page is a sign-in / device-pairing / 2FA screen rather than ' +
        'the page you wanted — when it is set, STOP: no selector you try will work on it, and only the user ' +
        'can clear it. `wallExplanation` says which move to make.',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string' },
            waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle', 'commit'], description: 'Default "domcontentloaded".' },
            timeoutMs: { type: 'integer' },
        },
        required: ['url'],
    },
    async run(args) {
        if (!args.url) throw new Error('url is required');
        const s = await ensureSession();
        const resp = await s.page.goto(args.url, {
            waitUntil: args.waitUntil || 'domcontentloaded',
            timeout: args.timeoutMs || DEFAULT_NAV_TIMEOUT_MS,
        });
        const inspection = await inspectPage(s);
        return {
            url: s.page.url(),
            title: await s.page.title(),
            status: resp ? resp.status() : null,
            // Inline, next to the status, so a 200 cannot read as "we are where we
            // wanted to be" when the page is actually a wall.
            wall: inspection.wall,
            wallExplanation: inspection.explanation,
        };
    },
};

const browserClick = {
    name: 'browser_click',
    category: 'sandboxed-write',
    description:
        'Click an element matched by a Playwright selector (CSS, text=, role=, etc.). ' +
        'See https://playwright.dev/docs/selectors. Set `nth` to disambiguate multiple matches.',
    parameters: {
        type: 'object',
        properties: {
            selector: { type: 'string' },
            nth: { type: 'integer', description: 'Pick this 0-based match if multiple exist.' },
            button: { type: 'string', enum: ['left', 'right', 'middle'] },
            timeoutMs: { type: 'integer' },
        },
        required: ['selector'],
    },
    async run(args) {
        if (!args.selector) throw new Error('selector is required');
        const s = await ensureSession();
        let locator = s.page.locator(args.selector);
        if (Number.isInteger(args.nth)) locator = locator.nth(args.nth);
        await locator.click({
            button: args.button || 'left',
            timeout: args.timeoutMs || DEFAULT_ACTION_TIMEOUT_MS,
        });
        return { clicked: args.selector, url: s.page.url() };
    },
};

const browserFill = {
    name: 'browser_fill',
    category: 'sandboxed-write',
    description: 'Type a value into a form field matched by a selector. Replaces existing content.',
    parameters: {
        type: 'object',
        properties: {
            selector: { type: 'string' },
            value: { type: 'string' },
            timeoutMs: { type: 'integer' },
        },
        required: ['selector', 'value'],
    },
    async run(args) {
        if (!args.selector) throw new Error('selector is required');
        const s = await ensureSession();
        await s.page.locator(args.selector).fill(String(args.value ?? ''), {
            timeout: args.timeoutMs || DEFAULT_ACTION_TIMEOUT_MS,
        });
        return { filled: args.selector };
    },
};

const browserText = {
    name: 'browser_text',
    category: 'safe-read',
    description:
        'Get visible text from an element (or the whole page when no selector is given). ' +
        'Truncates to `maxChars` (default 4000) to keep payloads agent-friendly.',
    parameters: {
        type: 'object',
        properties: {
            selector: { type: 'string' },
            maxChars: { type: 'integer' },
        },
    },
    async run(args = {}) {
        const s = await ensureSession();
        const max = Math.min(50_000, Math.max(100, Number(args.maxChars) || 4_000));
        let text = '';
        if (args.selector) {
            text = await s.page.locator(args.selector).first().innerText({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
        } else {
            text = await s.page.locator('body').innerText({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
        }
        const truncated = text.length > max;
        return { text: truncated ? text.slice(0, max) : text, truncated, length: text.length };
    },
};

const browserEval = {
    name: 'browser_eval',
    category: 'shell',  // arbitrary code execution in the page context — treat like shell
    description:
        'Evaluate a JavaScript expression in the page context and return the (JSON-serializable) result. ' +
        'Use sparingly — prefer browser_text/browser_click/browser_fill for ordinary interactions. ' +
        'The expression is wrapped in `() => (<expr>)` so use ES2020 syntax.',
    parameters: {
        type: 'object',
        properties: {
            expression: { type: 'string', description: 'JS expression. Example: "document.title".' },
        },
        required: ['expression'],
    },
    async run(args) {
        if (!args.expression) throw new Error('expression is required');
        const s = await ensureSession();
        const value = await s.page.evaluate(new Function('return (' + args.expression + ')'));
        return { value };
    },
};

const browserScreenshot = {
    name: 'browser_screenshot',
    category: 'safe-read',
    description:
        'Screenshot the current page (or a specific element via selector). Returns base64 PNG, ' +
        'width, and height. `fullPage: true` captures the entire scrollable document.',
    parameters: {
        type: 'object',
        properties: {
            selector: { type: 'string', description: 'If provided, screenshot just this element.' },
            fullPage: { type: 'boolean', description: 'Default false. Ignored when selector is set.' },
            returnInline: { type: 'boolean', description: 'Default true. Set false to return only bytes count.' },
        },
    },
    async run(args = {}) {
        const s = await ensureSession();
        let buf;
        if (args.selector) {
            buf = await s.page.locator(args.selector).first().screenshot({ type: 'png' });
        } else {
            buf = await s.page.screenshot({ type: 'png', fullPage: !!args.fullPage });
        }
        const returnInline = args.returnInline !== false;
        return {
            mime: 'image/png',
            bytes: buf.length,
            ...(returnInline ? { base64: buf.toString('base64') } : {}),
        };
    },
};

/**
 * Press a key in the page or in a specific element.
 *
 * **Why this had to exist before the chat could send a message anywhere.**
 * `browser_fill` sets a field's value, and that is all — it does not submit. Most
 * web chat inputs are submitted with Enter, and a search box with Enter too, so
 * "type a message and send it" was not expressible with the tools that existed:
 * the agent could put text in the box and then had no way to commit it. That is a
 * capability gap, not a prompting problem, and no amount of retrying would close
 * it.
 *
 * With no selector it presses at page level (`page.keyboard.press`), which is
 * what an input that already has focus needs; with a selector it focuses that
 * element first.
 */
const browserPress = {
    name: 'browser_press',
    category: 'sandboxed-write',
    description:
        'Press a keyboard key — use this to SUBMIT: a chat or search box is usually sent with "Enter". ' +
        'Give `selector` to focus that element first (e.g. the message box), or omit it to press wherever ' +
        'focus already is. Keys are Playwright names: Enter, Tab, Escape, ArrowDown, Control+A, Backspace.',
    parameters: {
        type: 'object',
        properties: {
            key: { type: 'string', description: 'Key name, e.g. "Enter".' },
            selector: { type: 'string', description: 'Optional: focus this element before pressing.' },
            timeoutMs: { type: 'integer' },
        },
        required: ['key'],
    },
    async run(args = {}) {
        const key = String(args.key || '').trim();
        if (!key) throw new Error('key is required (e.g. "Enter")');
        const s = await ensureSession();
        if (args.selector) {
            await s.page.locator(args.selector).first().focus({ timeout: args.timeoutMs || DEFAULT_ACTION_TIMEOUT_MS });
        }
        await s.page.keyboard.press(key);
        return { pressed: key, ...(args.selector ? { inSelector: args.selector } : {}), url: s.page.url() };
    },
};

const browserStatus = {
    name: 'browser_status',
    category: 'safe-read',
    description:
        'Return whether a browser session is open, its current url/title/profile, and — importantly — ' +
        'whether the page is a `wall` (sign-in / pairing / 2FA) with `wallExplanation` naming the next move. ' +
        'Check this before clicking anything you are unsure about.',
    parameters: { type: 'object', properties: {} },
    async run() {
        if (!_session) return { open: false };
        const inspection = await inspectPage(_session);
        return {
            open: true,
            url: _session.page.url(),
            title: await _session.page.title().catch(() => ''),
            profile: _session.profile,
            channel: _session.channel,
            attached: !!_session.attached,
            headless: _session.headless === true,
            startedAt: _session.startedAt,
            uptimeMs: Date.now() - _session.startedAt,
            wall: inspection.wall,
            wallExplanation: inspection.explanation,
        };
    },
};

const browserClose = {
    name: 'browser_close',
    category: 'sandboxed-write',
    description: 'Close the browser session and release resources. An ATTACHED session is only detached from — the user\'s own browser is left running.',
    parameters: { type: 'object', properties: {} },
    async run() {
        return await closeSession();
    },
};

module.exports = {
    browserOpen,
    browserGoto,
    browserClick,
    browserFill,
    browserPress,
    browserText,
    browserEval,
    browserScreenshot,
    browserStatus,
    browserClose,
    // Exposed for tests / shutdown hooks.
    _closeSession: closeSession,
    // …and the wall inspection, so its "is this page a dead end?" decision can be
    // exercised against a fake page without launching a browser.
    _inspectPage: inspectPage,
};
