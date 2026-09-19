#!/usr/bin/env node
/**
 * walkthrough.js — drive a real task ONE TOOL AT A TIME against the addon that is
 * ALREADY RUNNING, and read what each tool actually returned.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ════════════════════════════════════════════════════════════════════════════
 * Training a chat sentence like
 *
 *   "OPEN EDGE, GO TO GOOGLE MESSAGES. SELECT DAKOTA. CLICK RCS MESSAGE.
 *    TYPE I LOVE YOU. PRESS ENTER"
 *
 * into a working run used to mean: edit a tool → release the addon → update the
 * installed app → run the real task → read main.log → guess → repeat. That is one
 * whole release cycle per hypothesis, and the run gives you ONE failure at a time.
 *
 * This script breaks that cycle in the cheapest way possible: it talks to the
 * addon over its own local HTTP API (`POST /api/automation/execute`), so it can
 * run any single tool, with any arguments, and print the real result — on the
 * build that is INSTALLED, with NO rebuild, NO release and NO reinstall.
 *
 * ⚠️ What that means, precisely: this exercises the INSTALLED build's code. Use it
 * to find out WHERE a run breaks (which tool, and what it actually said). To prove
 * a FIX to a tool's code, use `npm run eval` (eval/cli.js), which loads the tools
 * from THIS REPO into a plain node process — also no install — see the header of
 * docs/implementation/ADDON_TASK_FLOW.md for the three-lane testing strategy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * USAGE
 * ════════════════════════════════════════════════════════════════════════════
 *   npm --prefix simple-addon run walk -- --list          # the stage table, no action
 *   npm --prefix simple-addon run walk -- --tools         # every tool the INSTALLED
 *                                                         # addon offers, by category
 *   npm --prefix simple-addon run walk                    # stages 0-6 (nothing is sent)
 *   npm --prefix simple-addon run walk -- --only 3        # just stage 3
 *   npm --prefix simple-addon run walk -- --from 1 --to 4 --pause
 *   npm --prefix simple-addon run walk -- --confirm       # + stage 7 (asks YOU)
 *   npm --prefix simple-addon run walk -- --send          # + stages 7 & 8 (presses Enter)
 *
 *   # One tool, any arguments — the "test a piece in isolation" primitive:
 *   npm --prefix simple-addon run walk -- --tool window_list
 *   npm --prefix simple-addon run walk -- --tool screen_ocr --raw
 *   npm --prefix simple-addon run walk -- --tool click_at --args '{"x":812,"y":233}'
 *   npm --prefix simple-addon run walk -- --tool text_type   # prints its arg SCHEMA
 *
 * Flags: --list --tools --tool NAME --args JSON --only N --from N --to N --pause
 *        --dry --confirm --send --no-perms --raw --log FILE --base URL
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY
 * ════════════════════════════════════════════════════════════════════════════
 * Stages 1-6 MOVE THE REAL MOUSE AND TYPE ON THE REAL DESKTOP. Do not run them
 * while you are doing something else on this machine.
 *
 * Stage 1 also DRIVES YOUR BROWSER: it opens a NEW TAB (Ctrl+T, never Ctrl+L, so
 * the page you already had open is not replaced) and navigates it to
 * messages.google.com/web. Change the URL in STAGES if you are walking a different
 * task.
 *
 * The last two stages are OFF unless you ask for them, because they are the
 * irreversible ones: stage 7 opens the real approval prompt, stage 8 presses
 * Enter and actually sends the message.
 *
 * While a stage runs, the script sets the `safe-read` and `system` categories to
 * `allow` (otherwise every acting call would block on an approval prompt the
 * script cannot answer), and puts your permission config back in a `finally`
 * block. `--dry` sets dry-run mode instead, so nothing touches the desktop.
 * `--no-perms` leaves the config completely untouched.
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const readline = require('readline');

// ────────────────────────────────────────────────────────────────────────────
// Transport — the addon's own local API (loopback, unauthenticated by design).
// ────────────────────────────────────────────────────────────────────────────

const CANDIDATE_BASES = ['http://127.0.0.1:3001', 'https://127.0.0.1:3444'];

function request(base, method, path, body, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = new URL(base + path); } catch (e) { return reject(e); }
        const lib = url.protocol === 'https:' ? https : http;
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const req = lib.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            // The addon's 3444 listener uses a self-signed cert that includes IP:127.0.0.1.
            rejectUnauthorized: false,
            headers: payload
                ? { 'content-type': 'application/json', 'content-length': payload.length }
                : {},
            timeout: timeoutMs,
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (d) => { raw += d; });
            res.on('end', () => {
                let parsed = raw;
                try { parsed = JSON.parse(raw); } catch { /* leave as text */ }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('timeout', () => req.destroy(new Error(`no answer within ${timeoutMs}ms`)));
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

/** Which loopback listener is up? The addon tries HTTP 3001 then HTTPS 3444. */
async function detectBase(explicit) {
    if (explicit) return explicit.replace(/\/+$/, '');
    for (const base of CANDIDATE_BASES) {
        try {
            const res = await request(base, 'GET', '/api/status', undefined, 2500);
            if (res.status === 200) return base;
        } catch { /* try the next one */ }
    }
    return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Result shaping. A raw uia_snapshot is thousands of chars of JSON; printing it
// whole buries the one field you are looking at. Clip by SHAPE, and say so.
// ────────────────────────────────────────────────────────────────────────────

const IMAGE_KEY_RE = /^(base64|data|dataurl|image|imagebase64|png|jpeg|jpg|screenshot|frameb64)$/i;

function clip(value, opts) {
    const { depth = 0, maxStr = 400, maxArr = 8, maxKeys = 20 } = opts || {};
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        return value.length > maxStr
            ? `${value.slice(0, maxStr)}... [+${value.length - maxStr} chars]`
            : value;
    }
    if (typeof value !== 'object') return value;
    if (depth >= 4) {
        return Array.isArray(value)
            ? `[array of ${value.length}]`
            : `[object with ${Object.keys(value).length} keys]`;
    }
    if (Array.isArray(value)) {
        const head = value.slice(0, maxArr).map((v) => clip(v, { ...opts, depth: depth + 1 }));
        if (value.length > maxArr) head.push(`...+${value.length - maxArr} more`);
        return head;
    }
    const out = {};
    const keys = Object.keys(value);
    for (const k of keys.slice(0, maxKeys)) {
        const v = value[k];
        if (IMAGE_KEY_RE.test(k) && typeof v === 'string') { out[k] = `<${v.length} chars>`;
            continue; }
        out[k] = clip(v, { ...opts, depth: depth + 1 });
    }
    if (keys.length > maxKeys) out['_more_keys'] = keys.length - maxKeys;
    return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Stage helpers
// ────────────────────────────────────────────────────────────────────────────

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * Find a line in a `screen_ocr` result whose text matches `needle`, and return the
 * centre of its box in SCREEN coordinates (the tool already shifts region captures
 * back to screen space, and a full-screen capture is screen space to begin with).
 */
function pickOcrMatch(lines, needle, nth = 0) {
    let seen = 0;
    const re = new RegExp(String(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const line of Array.isArray(lines) ? lines : []) {
        const text = String(line?.text ?? '');
        if (!re.test(text)) continue;
        if (seen++ < nth) continue;
        const x = num(line.x); const y = num(line.y);
        const w = num(line.width) || 0; const h = num(line.height) || 0;
        if (x === null || y === null) continue;
        return { text, x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
    }
    return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────────────────────
// The stages — the real recipe, decomposed. Each stage is ONE hypothesis about
// where the run breaks, and each is runnable on its own with --only N.
//   why  = what this stage settles
//   look = what to check with your own eyes while it runs
// ────────────────────────────────────────────────────────────────────────────

const STAGES = [
    {
        id: 0,
        name: 'preflight — is the addon up, and does it have the acting tools?',
        why: 'A missing tool is the one failure no prompt wording can fix, and an old installed build is a different program from the repo.',
        look: 'Nothing moves. This stage reads only.',
        categories: ['safe-read'],
        steps: [{ tool: 'window_list', args: { titleContains: '' } }],
    },
    {
        id: 1,
        name: 'open the browser AND the site  ("OPEN EDGE, GO TO GOOGLE MESSAGES")',
        why: 'These two clauses are ONE stage because the order is forced: an Edge window is TITLED after its active tab, so nothing called "Google Messages" exists to focus until the page is open. Every later step sends input to whatever is in the FOREGROUND, so if this stage is wrong the typing lands in the wrong window and every later failure is a symptom, not a cause.',
        look: 'Edge should come to the front, a new tab should navigate, and the window title should end up containing "Google Messages". window_focus should name the window it matched.',
        categories: ['system', 'safe-read'],
        steps: [
            { tool: 'open_app', args: { name: 'msedge', windowTitleContains: 'Edge', waitMs: 15000 } },
            { tool: 'window_list', args: {} },
            // Ctrl+T rather than Ctrl+L: a new tab cannot destroy the page the user
            // already had open in this window.
            { tool: 'input_tap', args: { keys: ['ctrl', 't'], focusWindowTitle: 'Edge' } },
            { tool: 'text_type', args: { text: 'https://messages.google.com/web', focusWindowTitle: 'Edge', pressEnterAfter: true } },
            { tool: 'wait_for', args: { windowTitle: 'Messages', timeoutMs: 20000, optional: true } },
            { tool: 'window_focus', args: { titleContains: 'Messages' } },
        ],
    },
    {
        id: 2,
        name: 'read the page  (uia_snapshot)',
        why: 'A Chromium page exposes NO accessibility tree — the snapshot shows browser chrome and the TAB STRIP only. Seeing that happen is what tells you to stop uia_find-ing page content and switch to screen_ocr. windowName is passed explicitly because the foreground window is whatever ran last.',
        look: 'The result should list things like "Back", "Refresh", "Address and search bar" and one TabItem per tab — and nothing from the page itself.',
        categories: ['safe-read'],
        steps: [{ tool: 'uia_snapshot', args: { windowName: 'Edge', mode: 'interactive', maxNodes: 60 } }],
    },
    {
        id: 3,
        name: 'locate the contact  ("SELECT DAKOTA")',
        why: 'uia_find for page content returns count 0 forever — the result says why. screen_ocr turns "Dakota" into coordinates, and it is SCOPED to the browser window: an unscoped capture also reads VS Code, where the words of this very task appear in the chat, so the first match would be the conversation you are typing into.',
        look: 'The script prints the coordinate it derived for the match. That coordinate is the actual claim under test — check it is on the right row.',
        categories: ['safe-read'],
        steps: [
            { tool: 'uia_find', args: { name: 'Dakota' } },
            { tool: 'screen_ocr', args: { window: 'Messages' } },
        ],
    },
    {
        id: 4,
        name: 'open the conversation  (click the located row)',
        why: 'Turns the coordinate from stage 3 into a real click. If stage 3 derived nothing, this stage says so instead of guessing.',
        look: 'The conversation with the contact should open.',
        categories: ['system'],
        steps: [{
            tool: 'click_at',
            args: (ctx) => {
                const hit = ctx.last('screen_ocr') && pickOcrMatch(ctx.last('screen_ocr').lines, 'Dakota');
                if (!hit) throw new Error(
                    'no "Dakota" coordinate — run stage 3 first, or run this stage by hand:\n'
                    + '        --tool click_at --args \'{"x":812,"y":233}\'',
                );
                return { x: hit.x, y: hit.y };
            },
        }],
    },
    {
        id: 5,
        name: 'number the clickables  (find RCS MESSAGE / the composer)',
        why: 'After the conversation opens, the target is a different element. screen_set_of_marks numbers the clickable UI Automation elements it can see — on a Chromium page that is the browser chrome, not the page — so the page controls have to come from the OCR text in stage 3.',
        look: 'The numbered overlay / the returned list.',
        categories: ['safe-read'],
        steps: [{ tool: 'screen_set_of_marks', args: {} }],
    },
    {
        id: 6,
        name: 'type the message  (NO Enter)',
        why: 'Separates "can the addon type into this box at all" from "does the send work". Typing is reversible; sending is not.',
        look: 'The text should appear in the message box and NOT be sent.',
        categories: ['system'],
        steps: [{ tool: 'text_type', args: { text: 'I love you' } }],
    },
    {
        id: 7,
        name: 'ask the human before sending  (user_confirm)',
        why: 'The blocking "verify before you send" gate. Off by default: it waits for YOU to answer a prompt, and it will sit there until you do.',
        look: 'A prompt appears in the addon permission center / tray — answer it there. Answering it here in the terminal does nothing.',
        categories: ['safe-read'],
        requires: 'confirm',
        steps: [{
            tool: 'user_confirm',
            args: { what: 'Send a message to Dakota', details: 'I love you' },
        }],
    },
    {
        id: 8,
        name: 'send  (press Enter — IRREVERSIBLE)',
        why: 'The last primitive: a key press where the focus is. Off by default; this one really sends.',
        look: 'The message should leave the compose box and appear in the thread.',
        categories: ['system'],
        requires: 'send',
        steps: [{ tool: 'input_tap', args: { keys: ['enter'] } }],
    },
];

// Tools every non-optional stage needs. A stage whose tool is absent is reported
// BEFORE anything moves, so an old build cannot look like a broken plan.
const REQUIRED_TOOLS = [
    'window_list', 'window_focus', 'open_app', 'uia_snapshot', 'uia_find',
    'screen_ocr', 'click_at', 'screen_set_of_marks', 'text_type', 'input_tap', 'wait_for',
];

// ────────────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const opts = {
        list: false, tools: false, tool: null, args: null, only: null,
        from: null, to: null, pause: false, dry: false, confirm: false, send: false,
        noPerms: false, raw: false, log: null, base: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--list') opts.list = true;
        else if (a === '--tools') opts.tools = true;
        else if (a === '--tool') opts.tool = argv[++i];
        else if (a === '--args') opts.args = argv[++i];
        else if (a === '--only') opts.only = argv[++i];
        else if (a === '--from') opts.from = Number(argv[++i]);
        else if (a === '--to') opts.to = Number(argv[++i]);
        else if (a === '--pause') opts.pause = true;
        else if (a === '--dry') opts.dry = true;
        else if (a === '--confirm') opts.confirm = true;
        else if (a === '--send') opts.send = true;
        else if (a === '--no-perms') opts.noPerms = true;
        else if (a === '--raw') opts.raw = true;
        else if (a === '--log') opts.log = argv[++i];
        else if (a === '--base') opts.base = argv[++i];
        else if (a === '-h' || a === '--help') opts.help = true;
        else console.warn(`(ignoring unknown argument: ${a})`);
    }
    if (opts.send) opts.confirm = true;   // never press Enter without the gate
    return opts;
}

function printStageTable() {
    console.log('Stages (each is independently runnable with --only N):');
    console.log('');
    for (const s of STAGES) {
        const gate = s.requires ? `  [requires --${s.requires}]` : '';
        console.log(`  ${s.id}  ${s.name}${gate}`);
        console.log(`     why:  ${s.why}`);
        console.log(`     look: ${s.look}`);
        console.log('');
    }
    console.log('Stages 0-6 run by default. 7 and 8 are irreversible and stay off');
    console.log('until you pass --confirm / --send.');
}

async function printToolCatalogue(base, wanted) {
    const res = await request(base, 'GET', '/api/automation/tools');
    const tools = (res.body && res.body.tools) || [];
    if (wanted) {
        const t = tools.find((x) => x.name === wanted);
        if (!t) {
            console.error(`Installed addon does NOT have a tool named "${wanted}".`);
            console.error(`(it offers ${tools.length} tools — run --tools to see them)`);
            return 1;
        }
        console.log(`> ${t.name}  [${t.category}]  effective mode: ${t.effectiveMode}`);
        console.log(`  ${t.description}`);
        console.log('  arguments:');
        console.log(JSON.stringify(t.parameters && t.parameters.properties || {}, null, 2));
        return 0;
    }
    const groups = {};
    for (const t of tools) (groups[t.category] = groups[t.category] || []).push(t.name);
    console.log(`Installed addon offers ${tools.length} tools:`);
    for (const cat of Object.keys(groups).sort()) {
        console.log(`  ${cat} (${groups[cat].length}): ${groups[cat].sort().join(' ')}`);
    }
    const missing = REQUIRED_TOOLS.filter((n) => !tools.some((t) => t.name === n));
    console.log('');
    console.log(missing.length === 0
        ? '  OK: every tool this walkthrough needs is present'
        : `  WARN: MISSING ${missing.join(', ')} - this build cannot run the recipe`);
    return 0;
}

async function runTool(base, tool, args, ctx) {
    const started = Date.now();
    let out;
    try {
        const res = await request(base, 'POST', '/api/automation/execute', { name: tool, args: args || {} }, 180000);
        out = res.body && typeof res.body === 'object'
            ? res.body
            : { ok: false, error: `non-JSON reply (HTTP ${res.status})` };
    } catch (e) {
        out = { ok: false, error: e.message };
    }
    const entry = {
        at: new Date().toISOString(),
        tool,
        args,
        ok: out.ok === true,
        error: out.error,
        mode: out.mode,
        durationMs: out.durationMs ?? (Date.now() - started),
        result: out.result,
    };
    ctx.calls.push(entry);
    if (entry.ok && out.result && typeof out.result === 'object') {
        ctx.results.set(tool, out.result);
    }
    const flag = entry.ok ? 'OK  ' : 'FAIL';
    console.log(`   ${flag} ${tool} ${JSON.stringify(clip(args, { maxStr: 120, maxArr: 4 }))}`);
    console.log(`      ok=${entry.ok}  mode=${entry.mode || '?'}  ${entry.durationMs}ms`);
    if (!entry.ok) console.log(`      error: ${out.error}`);
    if (out.result !== undefined) {
        const shown = ctx.raw ? out.result : clip(out.result);
        console.log('      result: ' + JSON.stringify(shown, null, 2).split('\n').join('\n      '));
    }
    // Stage 2 is about a FACT the next stage depends on; say it out loud.
    if (tool === 'uia_find' && out.result && out.result.count === 0 && out.result.hint) {
        console.log('      note: zero matches - that is the expected answer for page content;');
        console.log('            screen_ocr is the tool that can see inside the page.');
    }
    if (tool === 'screen_ocr' && out.result && typeof out.result === 'object' && !Array.isArray(out.result)) {
        if (Array.isArray(out.result.lines)) {
            if (out.result.window) {
                console.log(`      note: captured ONLY "${out.result.window.title}" `);
                console.log(`            region ${JSON.stringify(out.result.region)} - other apps cannot pollute this`);
            }
            const hit = pickOcrMatch(out.result.lines, 'Dakota');
            console.log(hit
                ? `      note: "Dakota" found at screen (${hit.x}, ${hit.y}) - line: ${JSON.stringify(hit.text)}`
                : '      note: no "Dakota" in the captured text - the page is not showing the contact list.');
        } else if (Object.keys(out.result).filter((k) => /^[0-9]+$/.test(k)).length > 10) {
            // The tell-tale of a build that predates the OCR fixes: the payload arrived as
            // raw text spread one key per character, so there are no `lines` to match on
            // and `window` was ignored. Saying so beats "no Dakota coordinate".
            console.log('      note: this result is a CHAR-SPREAD OBJECT with no `lines`.');
            console.log('            That is the pre-fix screen_ocr bug: this installed build ignores');
            console.log('            `window` and returns its payload one character per key. Update the');
            console.log('            addon (or run this call through repo code with `npm run eval`).');
        }
    }
    return entry;
}

async function waitForEnter(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question(question, resolve));
    rl.close();
}

/** The CLI entry point. Guarded so the helpers above stay requireable (and testable). */
async function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (opts.help) {
        console.log('See the header of this file for usage, or run with --list.');
        return;
    }
    if (opts.list) { printStageTable(); return; }

    const base = await detectBase(opts.base);
    if (!base) {
        console.error('No addon answering on http://127.0.0.1:3001 or https://127.0.0.1:3444.');
        console.error('Start the Simple Addon (or sign in on the web app) and try again.');
        process.exitCode = 2;
        return;
    }
    console.log(`addon: ${base}`);

    if (opts.tools || opts.tool) {
        const code = await printToolCatalogue(base, opts.tool || null);
        if (code !== 0) process.exitCode = code;
        if (!opts.tool) return;
        if (!opts.args) {
            console.log('');
            console.log('(no --args given, so nothing was executed — pass e.g. --args \'{"name":"Dakota"}\')');
            return;
        }
    }

    // ── permission handling: allow what this run needs, then put it back ─────
    let originalPerms = null;
    if (!opts.noPerms) {
        try {
            originalPerms = (await request(base, 'GET', '/api/automation/permissions')).body;
        } catch (e) {
            console.warn(`could not read permission config (${e.message}) — leaving it alone`);
        }
    }

    const ctx = {
        calls: [],
        results: new Map(),
        raw: opts.raw,
        last: (tool) => ctx.results.get(tool),
    };

    try {
        if (originalPerms && !opts.dry) {
            await request(base, 'PUT', '/api/automation/permissions', {
                categories: { 'safe-read': 'allow', system: 'allow' },
            });
            console.log('permissions: safe-read + system set to allow for this run (restored afterwards)');
        } else if (originalPerms) {
            await request(base, 'PUT', '/api/automation/permissions', { dryRunMode: true });
            console.log('permissions: DRY-RUN mode on - tools simulate, nothing touches the desktop');
        }

        // ── single-tool mode ────────────────────────────────────────────────
        if (opts.tool) {
            let args;
            try {
                args = JSON.parse(opts.args);
            } catch (e) {
                // Shell quoting is the usual cause, not a typo: PowerShell strips the
                // double quotes out of '{"x":1}' when it re-parses the argument.
                console.error(`--args is not valid JSON: ${e.message}`);
                console.error(`  you passed: ${opts.args}`);
                console.error('  in PowerShell use the escaped form:');
                console.error(`    --args '{\\"name\\":\\"Dakota\\"}'`);
                process.exitCode = 2;
                return;
            }
            console.log('');
            console.log(`== single tool: ${opts.tool} ==`);
            await runTool(base, opts.tool, args, ctx);
        } else {
            // ── stage mode ──────────────────────────────────────────────────
            const catalogue = ((await request(base, 'GET', '/api/automation/tools')).body || {}).tools || [];
            const have = new Set(catalogue.map((t) => t.name));
            const missing = REQUIRED_TOOLS.filter((n) => !have.has(n));
            if (missing.length) {
                console.log('');
                console.log(`WARN: the installed addon is missing: ${missing.join(', ')}`);
                console.log('    This build cannot run the recipe. Update the addon first.');
                process.exitCode = 1;
                return;
            }

            let stages = STAGES;
            if (opts.only !== null && opts.only !== undefined) {
                const want = String(opts.only);
                stages = stages.filter((s) => String(s.id) === want || s.name.toLowerCase().includes(want.toLowerCase()));
                if (!stages.length) { console.error(`no stage matches "${want}"`); process.exitCode = 2; return; }
            } else {
                if (opts.from !== null) stages = stages.filter((s) => s.id >= opts.from);
                if (opts.to !== null) stages = stages.filter((s) => s.id <= opts.to);
                stages = stages.filter((s) => !s.requires
                    || (s.requires === 'confirm' && opts.confirm)
                    || (s.requires === 'send' && opts.send));
            }

            const willMove = !opts.dry && stages.some((s) => s.categories.includes('system'));
            console.log('');
            console.log(`running ${stages.length} stage(s): ${stages.map((s) => s.id).join(', ')}`);
            console.log(willMove
                ? 'WARN: stages will MOVE YOUR REAL MOUSE AND TYPE. Do not touch the machine.'
                : '   (no acting stages - reads only, or dry-run)');
            console.log('');

            for (const s of stages) {
                console.log(`== stage ${s.id}: ${s.name} ==`);
                console.log(`   why:  ${s.why}`);
                console.log(`   look: ${s.look}`);
                for (const step of s.steps) {
                    let args;
                    try {
                        args = typeof step.args === 'function' ? step.args(ctx) : (step.args || {});
                    } catch (e) {
                        console.log(`   skipped: ${step.tool}: ${e.message}`);
                        continue;
                    }
                    await runTool(base, step.tool, args, ctx);
                }
                console.log('');
                if (opts.pause && s !== stages[stages.length - 1]) {
                    await waitForEnter('   [Enter] to continue to the next stage... ');
                }
                await sleep(250);   // let the desktop settle between stages
            }
        }
    } finally {
        if (originalPerms) {
            try {
                await request(base, 'PUT', '/api/automation/permissions', {
                    categories: originalPerms.categories,
                    dryRunMode: originalPerms.dryRunMode,
                });
                console.log('permissions: restored');
            } catch (e) {
                console.error(`WARN: could not restore permissions (${e.message}) - check the Permission Center`);
            }
        }
        if (opts.log) {
            try {
                fs.writeFileSync(opts.log, ctx.calls.map((c) => JSON.stringify(c)).join('\n') + '\n');
                console.log(`log: ${opts.log} (${ctx.calls.length} call(s))`);
            } catch (e) {
                console.error(`could not write log: ${e.message}`);
            }
        }
        const failed = ctx.calls.filter((c) => !c.ok);
        if (failed.length) {
            console.log('');
            console.log(`== ${failed.length} of ${ctx.calls.length} call(s) failed ==`);
            for (const f of failed) console.log(`   FAIL ${f.tool}: ${f.error}`);
        }
    }
}

if (require.main === module) {
    main().catch((e) => {
        console.error('walkthrough failed:', e && e.stack ? e.stack : e);
        process.exitCode = 1;
    });
}

module.exports = { clip, pickOcrMatch, detectBase, STAGES, REQUIRED_TOOLS };
