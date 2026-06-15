/**
 * browser_* — Chromium-based browser automation via playwright-core.
 *
 * Design choices:
 *
 *   - `playwright-core` only (no bundled browser). We auto-detect a Chromium
 *     channel in this order:
 *         env CSIMPLE_BROWSER_PATH → channel=msedge → channel=chrome
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
        ? path.join(process.env.APPDATA, 'csimple-addon')
        : path.join(os.homedir(), '.csimple-addon');
    return path.join(base, 'playwright-profiles');
}

function resolveBrowserChannel() {
    if (process.env.CSIMPLE_BROWSER_PATH && fs.existsSync(process.env.CSIMPLE_BROWSER_PATH)) {
        return { channel: 'msedge', executablePath: process.env.CSIMPLE_BROWSER_PATH };
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
        'or set CSIMPLE_BROWSER_PATH to a Chromium executable.'
    );
}

async function ensureSession({ headless, profile, viewport } = {}) {
    if (_session) return _session;
    const pw = loadPlaywright();
    const { channel, executablePath } = resolveBrowserChannel();
    const profileName = String(profile || 'default').replace(/[^\w.-]/g, '_');
    const userDataDir = path.join(userDataRoot(), profileName);
    fs.mkdirSync(userDataDir, { recursive: true });

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
        startedAt: Date.now(),
    };
    return _session;
}

async function closeSession() {
    if (!_session) return false;
    try { await _session.context.close(); } catch {}
    _session = null;
    return true;
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
        'wants to watch the browser visibly.',
    parameters: {
        type: 'object',
        properties: {
            headless: { type: 'boolean', description: 'Default true. Set false to show the window.' },
            profile: { type: 'string', description: 'Profile dir name (alphanumeric). Default "default".' },
            viewport: {
                type: 'object',
                properties: { width: { type: 'integer' }, height: { type: 'integer' } },
            },
        },
    },
    async run(args = {}) {
        const s = await ensureSession(args);
        return {
            opened: true,
            channel: s.channel,
            executablePath: s.executablePath,
            profile: s.profile,
            userDataDir: s.userDataDir,
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
        'Waits for the network to be roughly idle before returning.',
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
        return {
            url: s.page.url(),
            title: await s.page.title(),
            status: resp ? resp.status() : null,
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

const browserStatus = {
    name: 'browser_status',
    category: 'safe-read',
    description: 'Return whether a browser session is open and its current url/title/profile.',
    parameters: { type: 'object', properties: {} },
    async run() {
        if (!_session) return { open: false };
        return {
            open: true,
            url: _session.page.url(),
            title: await _session.page.title().catch(() => ''),
            profile: _session.profile,
            channel: _session.channel,
            startedAt: _session.startedAt,
            uptimeMs: Date.now() - _session.startedAt,
        };
    },
};

const browserClose = {
    name: 'browser_close',
    category: 'sandboxed-write',
    description: 'Close the browser session and release resources.',
    parameters: { type: 'object', properties: {} },
    async run() {
        const closed = await closeSession();
        return { closed };
    },
};

module.exports = {
    browserOpen,
    browserGoto,
    browserClick,
    browserFill,
    browserText,
    browserEval,
    browserScreenshot,
    browserStatus,
    browserClose,
    // Exposed for tests / shutdown hooks.
    _closeSession: closeSession,
};
