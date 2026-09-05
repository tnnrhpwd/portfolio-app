#!/usr/bin/env node
/**
 * Live core-functionality validation script.
 *
 * Automates the 10 scenarios described in docs/guides/ACTION_PLAN.md's
 * Phase 0 readiness bar ("The 10 validation scenarios, in detail"), plus a
 * workspace-profile capture/restore regression (scenario 11). Unlike
 * server/automation/eval/scenarios/ (safe to run in CI — dry-run, mocked, or
 * purely read-only), THIS script drives the REAL Windows desktop: it opens
 * real apps, types real keystrokes, moves the real mouse, and reads back
 * real files/UI state. It is deliberately NOT part of `npm test` or the
 * default `eval` run — it's an opt-in tool for manually checking "does the
 * core perceive/act loop actually work today", run periodically (see
 * Phase 0/4 of ACTION_PLAN.md), not on every commit.
 *
 * Usage (from simple-addon/):
 *   node server/automation/eval/validate-core-functionality.js
 *   node server/automation/eval/validate-core-functionality.js --only=1,4,7
 *   node server/automation/eval/validate-core-functionality.js --runs=10
 *   node server/automation/eval/validate-core-functionality.js --interactive
 *   node server/automation/eval/validate-core-functionality.js --list
 *
 * Requirements:
 *   - Windows, with nothing important in the foreground — this WILL steal
 *     focus, open/close Notepad/Calculator/Explorer windows, and move the
 *     real mouse cursor. Don't run this while doing other work on the box.
 *   - Scenario 5 (perceive human-typed input) needs a human at the keyboard;
 *     it's skipped unless --interactive is passed.
 *   - Scenario 8 (planner/NL-driven auto-execution) needs a signed-in JWT
 *     (this addon proxies all LLM calls through the backend); it's skipped
 *     (not failed) unless one is resolvable — sign in via the web app once.
 *
 * Output: a human-readable summary to stdout, a JSON results log appended to
 * eval/live-results/<timestamp>.json, and a non-zero exit code if any
 * scenario failed (skips do not count as failures). Use the JSON log to feed
 * the "reliability tally" described in ACTION_PLAN.md's Phase 0/4.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Wire up the tool registry (same tool set as eval/cli.js, plus open_app
//    and text_type which the deterministic scenario runner doesn't need but
//    these live scenarios do). ────────────────────────────────────────────
function registerAllTools() {
    const registry = require('../tool-registry');
    const shell = require('../tools/shell');
    const { fsRead, fsWrite, fsList } = require('../tools/fs');
    const { windowList, windowFocus, windowSetRect, processList, processKill, clipboardRead, clipboardWrite } = require('../tools/system');
    const screen = require('../tools/screen');
    const screenRelay = require('../tools/screen-relay');
    const { screenOcr } = require('../tools/ocr');
    const { screenSetOfMarks } = require('../tools/set-of-marks');
    const {
        browserOpen, browserGoto, browserClick, browserFill,
        browserText, browserEval, browserScreenshot, browserStatus, browserClose,
    } = require('../tools/browser');
    const { uiaFind, uiaInvoke, uiaGetText, uiaSnapshot } = require('../tools/uia');
    const { perceptionRecent } = require('../perception');
    const { inputHold, inputTap, clickAt, mousePath, mouseDrag } = require('../tools/input');
    const { skillRun } = require('../tools/skill');
    const { openApp } = require('../tools/open-app');
    const { textType } = require('../tools/text-type');

    const all = [
        fsRead, fsList, windowList, processList, clipboardRead, screen, screenOcr, screenSetOfMarks,
        uiaFind, uiaGetText, uiaSnapshot, perceptionRecent,
        browserOpen, browserGoto, browserText, browserScreenshot, browserStatus,
        fsWrite, clipboardWrite, browserClick, browserFill, browserClose,
        windowFocus, uiaInvoke, inputHold, inputTap, clickAt, mousePath, mouseDrag, windowSetRect,
        processKill, shell, browserEval,
        skillRun, screenRelay, openApp, textType,
    ];
    for (const t of all) {
        try { registry.register(t); }
        catch (e) { if (!String(e.message).includes('Duplicate')) throw e; }
    }
    return registry;
}

const registry = registerAllTools();
const permissions = require('../permissions');
const recorder = require('../recorder/index');

const SANDBOX_DIR = path.join(os.homedir(), '.simple-eval', 'core-functionality');
const RESULTS_DIR = path.join(__dirname, 'live-results');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run a tool through the registry with permissive, non-interactive settings. Throws on failure so scenario bodies read as a linear script. */
async function exec(tool, args = {}) {
    const outcome = await registry.executeTool(tool, args, {
        userInitiated: true,           // bypass approval prompts
        addAction: async () => {},     // suppress cloud audit during validation
    });
    if (!outcome.ok) {
        throw new Error(`${tool} failed: ${outcome.error || '(no error message)'}`);
    }
    return outcome.result;
}

/** Best-effort process cleanup so each scenario starts from an unambiguous desktop state. */
async function killByName(nameContains) {
    try {
        const { processes } = await exec('process_list', { nameContains });
        for (const p of processes || []) {
            try { await exec('process_kill', { pid: p.pid, force: true }); } catch (e) { /* best-effort */ }
        }
    } catch (e) { /* best-effort */ }
}

async function cleanDesktop() {
    await killByName('notepad');
    await killByName('calculatorapp');
    await _clearNotepadSessionState();
    await sleep(400);
}

// Modern (packaged) Notepad restores its previous tab session on next
// launch, straight from LocalState\TabState\WindowState -- across enough
// kill+relaunch cycles (every scenario here force-kills it between runs)
// that piles up several restored tabs, each carrying whatever stale text
// (or reference to a since-deleted sandbox file) an earlier run left
// behind. That silently breaks the "type into a known-blank document"
// premise every scenario here depends on -- typed text lands appended
// after old content instead of alone, and a restored tab already pointing
// at a real path makes Ctrl+S save in place with no Save-As dialog at all.
// Clearing this state (only ever right after force-killing the process
// this same function just killed) guarantees the next launch is a genuine
// blank Untitled document, which no amount of in-scenario Ctrl+N/Ctrl+A
// defensive-typing fully guaranteed on its own.
async function _clearNotepadSessionState() {
    const base = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Packages', 'Microsoft.WindowsNotepad_8wekyb3d8bbwe', 'LocalState')
        : null;
    if (!base) return;
    for (const sub of ['TabState', 'WindowState']) {
        const dir = path.join(base, sub);
        let entries = [];
        try { entries = fs.readdirSync(dir); } catch { continue; }
        for (const f of entries) {
            try { fs.unlinkSync(path.join(dir, f)); } catch { /* best-effort */ }
        }
    }
}

// A restored tab can also point at a file that no longer exists (e.g. a
// sandbox file a previous run already cleaned up), which pops a blocking
// "Notepad — Cannot find the <path> file." modal that steals focus from
// everything after it (Ctrl+N, typing, etc. all get swallowed). Its window
// title is the bare app name "Notepad" (real documents are titled "<name>
// - Notepad"), so it's cheaply distinguishable and safe to dismiss with
// Enter (its only button is "OK"). _clearNotepadSessionState() above
// should make this unreachable going forward, but this stays as a
// defensive backstop against whatever state existed before this fix.
async function _dismissStrayNotepadDialog() {
    const wl = await exec('window_list', { titleContains: 'Notepad' });
    const dialog = (wl.windows || []).find(w => w.title === 'Notepad');
    if (!dialog) return false;
    await exec('window_focus', { titleContains: 'Notepad' });
    await sleep(100);
    await exec('input_tap', { keys: ['enter'] });
    await sleep(200);
    return true;
}

function sandboxPath() {
    const p = path.join(SANDBOX_DIR, ...arguments);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
}

/** Apply a permissive permission config for the duration of the run; returns a restore() function. Mirrors the snapshot/restore pattern eval/runner.js already uses. */
function applyPermissiveConfig() {
    const original = JSON.parse(JSON.stringify(permissions.load()));
    permissions.save({
        dryRunMode: false,
        globalKillSwitch: false,
        autoApproveAll: true,
        categories: { 'safe-read': 'allow', 'sandboxed-write': 'allow', shell: 'allow', destructive: 'ask', system: 'allow' },
        fsRoots: [os.homedir()],
    });
    return function restore() {
        const cfgPath = path.join(
            process.env.APPDATA ? path.join(process.env.APPDATA, 'simple-addon') : path.join(os.homedir(), '.simple-addon'),
            'automation-permissions.json',
        );
        try {
            fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
            fs.writeFileSync(cfgPath, JSON.stringify(original, null, 2), 'utf-8');
        } catch (e) { /* best-effort restore */ }
        permissions._reset();
    };
}

// ─── Scenario 1: type + save in Notepad (key simulation + text fidelity) ───
async function scenario1() {
    const text = 'Simple validation 42! Line-two.';
    const filePath = sandboxPath('s1', 'note-' + Date.now() + '.txt');
    await cleanDesktop();
    await exec('open_app', { name: 'notepad.exe', waitMs: 8000 });
    await sleep(300);
    await _dismissStrayNotepadDialog();
    // Modern Notepad doesn't just restore stray unsaved TEXT from its last
    // session -- it can reopen the exact file that was previously open,
    // asterisk and all. If that happens, this scenario's Ctrl+S would
    // silently re-save that OLD file in place (no Save-As dialog at all,
    // since it's no longer untitled), and the brand-new `filePath` below
    // would never receive anything. Ctrl+N forces a guaranteed-blank,
    // guaranteed-untitled new tab regardless of whatever the previous
    // session left behind, so Ctrl+S below is guaranteed to hit Save-As.
    await exec('input_tap', { keys: ['ctrl', 'n'], focusWindowTitle: 'Notepad' });
    await sleep(300);
    await exec('input_tap', { keys: ['ctrl', 'a'], focusWindowTitle: 'Notepad' });
    await sleep(100);
    await exec('input_tap', { keys: ['delete'] });
    await sleep(150);
    await exec('text_type', { text: text, focusWindowTitle: 'Notepad' });
    await sleep(200);
    await exec('input_tap', { keys: ['ctrl', 's'], focusWindowTitle: 'Notepad' });
    await sleep(700); // Save-As dialog for a new/untitled document
    // The Save-As dialog is a separate top-level window from Notepad's own
    // (same process, different HWND) -- it doesn't automatically take OS
    // foreground/keyboard focus just because it appeared, so the filename
    // typed next needs to explicitly target it by title, or it silently
    // lands back in Notepad's own document instead of the dialog's filename
    // box (which is exactly why no file ever used to get created here).
    await exec('text_type', { text: filePath, focusWindowTitle: 'Save' });
    await sleep(200);
    await exec('input_tap', { keys: ['enter'] });
    await sleep(600);
    if (!fs.existsSync(filePath)) throw new Error('expected file was not created: ' + filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content !== text) throw new Error('content mismatch. expected=' + JSON.stringify(text) + ' got=' + JSON.stringify(content));
    return { filePath: filePath, bytes: content.length };
}

// ─── Scenario 2: click through Calculator, read result back via UIA ───────
async function scenario2() {
    await cleanDesktop();
    await exec('open_app', { name: 'calc.exe', waitMs: 8000 });
    await sleep(800); // modern Calculator (UWP) can take a beat to finish loading its UIA tree
    const buttons = ['One', 'Two', 'Plus', 'Seven', 'Equals'];
    for (let i = 0; i < buttons.length; i++) {
        await exec('uia_invoke', { name: buttons[i], action: 'invoke' });
        await sleep(150);
    }
    const readBack = await exec('uia_get_text', { automationId: 'CalculatorResults' });
    if (!/19/.test(String(readBack.text))) {
        throw new Error('expected result to contain "19", got: ' + JSON.stringify(readBack.text));
    }
    return { displayed: readBack.text };
}

// ─── Scenario 3: select + F2 rename a file in File Explorer ────────────────
async function scenario3() {
    const dir = sandboxPath('s3');
    fs.mkdirSync(dir, { recursive: true });
    const oldName = 'orig-' + Date.now() + '.txt';
    const newName = 'renamed-' + Date.now();
    const content = 'do-not-corrupt-me';
    fs.writeFileSync(path.join(dir, oldName), content, 'utf-8');
    const leaf = path.basename(dir);

    await killByName('explorer'); // extra Explorer windows only; the shell process itself relaunches
    await exec('open_app', { name: 'explorer.exe', args: dir, windowTitleContains: leaf, waitMs: 8000 });
    await sleep(700);

    const found = await exec('uia_find', { name: oldName, controlType: 'ListItem', max: 1 });
    if (!found.elements || !found.elements.length) {
        throw new Error('could not find file item "' + oldName + '" in Explorer\'s UIA tree');
    }
    const el = found.elements[0];
    await exec('click_at', { x: el.x + Math.round(el.width / 2), y: el.y + Math.round(el.height / 2) });
    await sleep(200);
    await exec('input_tap', { keys: ['f2'] });
    await sleep(300);
    await exec('text_type', { text: newName });
    await sleep(150);
    await exec('input_tap', { keys: ['enter'] });
    await sleep(500);

    const oldPath = path.join(dir, oldName);
    const newPath = path.join(dir, newName + path.extname(oldName));
    if (fs.existsSync(oldPath)) throw new Error('old filename still exists — rename did not take effect: ' + oldPath);
    if (!fs.existsSync(newPath)) throw new Error('renamed file not found at expected path: ' + newPath);
    const after = fs.readFileSync(newPath, 'utf-8');
    if (after !== content) throw new Error('file content changed/corrupted during rename');
    return { from: oldPath, to: newPath };
}

// ─── Scenario 4: Alt-Tab between two open windows, verify actual focus ─────
async function _foregroundWindowName() {
    const snap = await exec('uia_snapshot', { mode: 'flat', maxNodes: 5 });
    return String(snap.window || '');
}

async function scenario4() {
    await cleanDesktop();
    await exec('open_app', { name: 'notepad.exe', waitMs: 8000 });
    await sleep(400);
    await exec('open_app', { name: 'calc.exe', waitMs: 8000 }); // Calculator now foreground
    await sleep(600);

    const beforeAltTab = await _foregroundWindowName();
    if (!/calc/i.test(beforeAltTab)) {
        throw new Error('expected Calculator to be foreground before Alt-Tab, got: ' + beforeAltTab);
    }

    // input_tap supports simultaneous key combos (all keys down, then all up),
    // which is exactly what an Alt+Tab keypress is.
    await exec('input_tap', { keys: ['alt', 'tab'], holdMs: 150 });
    await sleep(500);
    const afterAltTab = await _foregroundWindowName();
    if (!/notepad/i.test(afterAltTab)) {
        throw new Error('expected Notepad to be foreground after Alt-Tab, got: ' + afterAltTab);
    }
    return { before: beforeAltTab, after: afterAltTab };
}

// ─── Scenario 5: perceive human-typed input (perception-only) ─────────────
// This scenario cannot be fully unattended — it needs a human to actually
// type — so it prints instructions and waits, then validates the captured
// recording matches. Kept in the same suite/report as the rest, but expect
// it to be skipped unless --interactive is passed.
async function scenario5(opts) {
    if (!opts || !opts.interactive) {
        return { skipped: 'requires a human typing at the keyboard — run with --interactive to include this scenario' };
    }
    const recordingsDir = sandboxPath('s5-recordings');
    recorder.configure({ recordingsDir: recordingsDir });
    await cleanDesktop();
    await exec('open_app', { name: 'notepad.exe', waitMs: 8000 });
    const expected = 'thequickbrownfox';
    console.log('');
    console.log('[scenario 5] Recording started. Please type exactly (then stop): the quick brown fox');
    console.log('[scenario 5] You have 15 seconds...');
    await recorder.start({ name: 's5-human-typing' });
    await sleep(15000);
    const stopped = await recorder.stop();
    const readBack = await recorder.read(stopped.sessionId);
    let typed = '';
    for (let i = 0; i < readBack.events.length; i++) {
        const e = readBack.events[i];
        if (e.type === 'key_down' && e.data && e.data.name && e.data.name.length === 1) {
            typed += e.data.name;
        }
    }
    if (typed.toLowerCase().indexOf(expected) === -1) {
        throw new Error('captured keystrokes did not reconstruct the expected text. captured="' + typed + '"');
    }
    return { sessionId: stopped.sessionId, capturedChars: typed.length };
}

// ─── Scenario 6: read a real UI toggle state via perception ───────────────
// Uses Notepad's View > Word wrap checkbox as a deterministic toggle we can
// set ourselves beforehand, then verify perception reports the same state.
// (Modern Windows 11 Notepad moved this out of a "Format" menu -- there
// isn't one anymore -- and into "View"; the item's accessible name is also
// lowercase "Word wrap", not "Word Wrap".)
//
// Sending Alt and the mnemonic letter as two SEPARATE input_tap calls (tap
// Alt, release, then tap the letter) doesn't reliably engage this WinUI
// MenuBar's accelerator handling -- unlike a classic Win32 menu, it seems to
// need the letter delivered while Alt is still down within one input event
// batch, and a synthetic key from a brand-new process a beat later can miss
// that window entirely (observed failure: "v" fell through and was typed
// as a literal character into the document instead of opening the View
// menu). Sending them as one held-Alt-plus-letter combo (same pattern
// scenario4 already uses for Alt+Tab) opens the menu reliably instead.
async function _openViewMenu() {
    await exec('input_tap', { keys: ['alt', 'v'], holdMs: 100 });
    await sleep(400);
}

async function scenario6() {
    await cleanDesktop();
    await exec('open_app', { name: 'notepad.exe', waitMs: 8000 });
    await sleep(400);

    // Open View menu and read Word wrap's checked state via UIA (perception),
    // twice — toggling in between — so we verify perception tracks a real
    // state change rather than just returning a static/cached answer.
    await _openViewMenu();
    const before = await exec('uia_find', { name: 'Word wrap', max: 1 });
    if (!before.elements || !before.elements.length) {
        throw new Error('could not find "Word wrap" menu item via perception');
    }
    // Close the menu without toggling (Escape) to prove the perceive step
    // above didn't itself need to leave anything open, then re-open it and
    // invoke via uia_invoke (the intended perceive-then-act pattern) to flip
    // the state — the menu (and therefore its "Word wrap" item) doesn't
    // exist in the UIA tree while closed, so invoking it has to happen with
    // the menu open again, not against the now-stale reference from above.
    await exec('input_tap', { keys: ['escape'] });
    await sleep(150);
    await _openViewMenu();
    const readyToToggle = await exec('uia_find', { name: 'Word wrap', max: 1 });
    if (!readyToToggle.elements || !readyToToggle.elements.length) {
        throw new Error('could not re-find "Word wrap" menu item before toggling');
    }
    await exec('uia_invoke', { name: 'Word wrap', action: 'invoke' });
    await sleep(200);

    await _openViewMenu();
    const after = await exec('uia_find', { name: 'Word wrap', max: 1 });
    await exec('input_tap', { keys: ['escape'] });
    if (!after.elements || !after.elements.length) {
        throw new Error('could not re-find "Word wrap" menu item after toggling');
    }
    return { foundBeforeToggle: true, foundAfterToggle: true };
}

// ─── Scenario 7: record a short task once, then auto-replay it ────────────
// Types text one real keystroke at a time via input_tap (down, hold, up),
// instead of SendKeys -- SendKeys' per-character keydown/keyup pulse is
// sub-millisecond regardless of any delay *between* characters, which is
// far too brief for the PollingInputSource capturing this recording to
// reliably sample (see _PollingInputSource's own doc comment on this exact
// limitation). A real key held down for `holdMs` is what an actual human
// keystroke looks like at the OS level, and is what this scenario is
// actually meant to be testing the recorder against.
const _CHAR_KEY_MAP = {
    '-': 'minus', '.': 'period', '\\': 'backslash', '/': 'slash',
    '_': { key: 'minus', shift: true }, ':': { key: 'semicolon', shift: true },
};
async function _typeViaHeldKeys(text, { focusWindowTitle, holdMs = 45 } = {}) {
    for (const ch of String(text)) {
        let key, shift = false;
        if (/[a-z0-9]/.test(ch)) { key = ch; }
        else if (/[A-Z]/.test(ch)) { key = ch.toLowerCase(); shift = true; }
        else if (_CHAR_KEY_MAP[ch] !== undefined) {
            const mapped = _CHAR_KEY_MAP[ch];
            if (typeof mapped === 'string') { key = mapped; }
            else { key = mapped.key; shift = mapped.shift; }
        } else {
            throw new Error('_typeViaHeldKeys: unsupported character ' + JSON.stringify(ch));
        }
        await exec('input_tap', {
            keys: shift ? ['shift', key] : [key],
            focusWindowTitle,
            holdMs,
        });
    }
}

async function scenario7() {
    const recordingsDir = sandboxPath('s7-recordings');
    recorder.configure({ recordingsDir: recordingsDir });
    const targetFile = sandboxPath('s7', 'invoice-draft-' + Date.now() + '.txt');
    const text = 'recorded-and-replayed';

    await cleanDesktop();
    await exec('open_app', { name: 'notepad.exe', waitMs: 8000 });
    await sleep(400);
    await _dismissStrayNotepadDialog();
    await recorder.start({ name: 's7-record-once' });
    await sleep(300);
    // Force a guaranteed-blank, guaranteed-untitled tab before typing --
    // see scenario1's comment: modern Notepad can reopen whatever file (or
    // unsaved buffer) was open last session, which would make Ctrl+S below
    // silently save in place instead of opening the Save-As dialog this
    // scenario depends on.
    await exec('input_tap', { keys: ['ctrl', 'n'], focusWindowTitle: 'Notepad' });
    await sleep(300);
    await _typeViaHeldKeys(text, { focusWindowTitle: 'Notepad' });
    await sleep(200);
    await exec('input_tap', { keys: ['ctrl', 's'] });
    await sleep(700);
    // Same dialog-focus fix as scenario1: the Save-As dialog is a separate
    // top-level window that doesn't automatically take OS focus, so the
    // target path needs to be typed directly at it by title.
    await _typeViaHeldKeys(targetFile, { focusWindowTitle: 'Save' });
    await sleep(200);
    await exec('input_tap', { keys: ['enter'] });
    await sleep(500);
    const recording = await recorder.stop();

    if (!fs.existsSync(targetFile)) throw new Error('recording phase did not produce the expected file: ' + targetFile);

    // Reset state: delete the file the recording just created, so replay has
    // to genuinely recreate it, not just find it already there.
    fs.unlinkSync(targetFile);
    await cleanDesktop();

    // Auto-replay via the compiled skill, driven purely by the tool registry
    // (no human input) — this is the actual "perceive once, repeat forever" claim.
    const { compileRecording } = require('../recorder/compiler');
    const full = await recorder.read(recording.sessionId);
    const skill = compileRecording(full, { name: 's7-replay-skill' });

    await exec('open_app', { name: 'notepad.exe', waitMs: 8000 });
    await sleep(400);
    await _dismissStrayNotepadDialog();
    // Passing `cache: skill` lets skill_run register it in its local cache
    // and run it immediately, without needing a workspace round-trip.
    await exec('skill_run', { slug: skill.slug, cache: skill });
    await sleep(500);

    if (!fs.existsSync(targetFile)) throw new Error('auto-replay did not recreate the expected file: ' + targetFile);
    const content = fs.readFileSync(targetFile, 'utf-8');
    if (content.indexOf(text) === -1) throw new Error('replayed file content did not match. got=' + JSON.stringify(content));
    return { sessionId: recording.sessionId, slug: skill.slug, targetFile: targetFile };
}

// ─── Scenario 8: plain-English instruction -> planner decides the steps ───
function _resolveLlmToken() {
    try {
        const wsClient = require('../workspace-client');
        return wsClient.getToken();
    } catch { return null; }
}

async function scenario8() {
    const token = _resolveLlmToken();
    if (!token) {
        return { skipped: 'no auth token resolvable — sign in via the web app once, then re-run (all LLM calls proxy through the backend)' };
    }
    const targetFile = sandboxPath('s8', 'date-note-' + Date.now() + '.txt');
    await cleanDesktop();

    const { createLlmProvider } = require('../llm-provider');
    const llm = createLlmProvider();

    const instruction = 'Open Notepad, type today\'s date in YYYY-MM-DD format, then save the file to exactly this path: ' + targetFile + ' — use the open_app, text_type, and input_tap tools as needed. When done, reply with the text <<GOAL_DONE>>.';
    const toolSchemas = registry.toolSchemasForLlm();
    let messages = [
        { role: 'system', content: 'You are an automation agent with access to tools that control the Windows desktop. Use them to accomplish the user\'s instruction exactly.' },
        { role: 'user', content: instruction },
    ];

    const MAX_STEPS = 8;
    let done = false;
    for (let step = 0; step < MAX_STEPS && !done; step++) {
        const reply = await llm.chatRaw({ messages: messages, tools: toolSchemas });
        if (reply.message) messages.push(reply.message);
        if (reply.toolCalls && reply.toolCalls.length) {
            for (let i = 0; i < reply.toolCalls.length; i++) {
                const call = reply.toolCalls[i];
                let args = {};
                try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { args = {}; }
                const outcome = await registry.executeTool(call.function.name, args, { userInitiated: true, addAction: async function () {} });
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }),
                });
            }
        } else if (reply.text && reply.text.indexOf('<<GOAL_DONE>>') !== -1) {
            done = true;
        } else {
            messages.push({ role: 'user', content: 'Continue — use a tool, or reply <<GOAL_DONE>> once finished.' });
        }
        await sleep(200);
    }

    if (!fs.existsSync(targetFile)) throw new Error('planner-driven run did not produce the expected file: ' + targetFile);
    const content = fs.readFileSync(targetFile, 'utf-8').trim();
    const todayIso = new Date().toISOString().slice(0, 10);
    if (content.indexOf(todayIso) === -1) {
        throw new Error('file content did not contain today\'s date (' + todayIso + '). got=' + JSON.stringify(content));
    }
    return { targetFile: targetFile, content: content, steps: messages.length };
}

// ─── Scenario 9: drag-and-drop with a moving mouse path ────────────────────
async function scenario9() {
    const dir = sandboxPath('s9');
    const srcDir = path.join(dir, 'src');
    const dstDir = path.join(dir, 'dst');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(dstDir, { recursive: true });
    const fileName = 'drag-me-' + Date.now() + '.txt';
    fs.writeFileSync(path.join(srcDir, fileName), 'drag-test', 'utf-8');

    await killByName('explorer');
    await exec('open_app', { name: 'explorer.exe', args: srcDir, windowTitleContains: path.basename(srcDir), waitMs: 8000 });
    await sleep(700);
    // Tile src/dst into non-overlapping halves of the screen *before* reading
    // any coordinates. Both windows previously opened at (or near) the same
    // default position, so the destination point computed below ended up
    // physically underneath the source window — re-focusing src right before
    // the drag (needed so the mouse-down originates on the right window) then
    // brought src on top of that point, turning every "drop" into a no-op
    // click back inside src itself (dropped in place, never arriving at dst).
    await exec('window_set_rect', { titleContains: path.basename(srcDir), x: 0, y: 0, width: 700, height: 700, state: 'normal' });
    await sleep(200);

    await exec('open_app', { name: 'explorer.exe', args: dstDir, windowTitleContains: path.basename(dstDir), waitMs: 8000 });
    await sleep(700);
    await exec('window_set_rect', { titleContains: path.basename(dstDir), x: 900, y: 0, width: 700, height: 700, state: 'normal' });
    await sleep(200);

    // Re-focus src now that the two windows are physically apart, then find
    // the file's on-screen position — reading it only after both windows
    // have their final position/size keeps these coordinates accurate.
    await exec('window_focus', { titleContains: path.basename(srcDir) });
    await sleep(200);
    const found = await exec('uia_find', { name: fileName, controlType: 'ListItem', max: 1 });
    if (!found.elements || !found.elements.length) throw new Error('could not find source file item in Explorer');
    const srcEl = found.elements[0];
    const startX = srcEl.x + Math.round(srcEl.width / 2);
    const startY = srcEl.y + Math.round(srcEl.height / 2);

    // Drop target: center of the dst window's known (just-applied) rect —
    // more reliable than re-deriving it via uia_find, since AutomationElement
    // Name-property matching is an exact-equality condition and a window's
    // title here is a full path ("...\dst - File Explorer"), never just "dst".
    const dstX = 900 + 350;
    const dstY = 350;

    await exec('mouse_drag', {
        path: [
            { x: startX, y: startY, tOffsetMs: 0 },
            { x: startX + 60, y: startY + 10, tOffsetMs: 150 },
            { x: dstX, y: dstY, tOffsetMs: 500 },
        ],
        button: 'left',
        holdMs: 100,
    });
    await sleep(700);

    const movedPath = path.join(dstDir, fileName);
    const stillAtSrc = fs.existsSync(path.join(srcDir, fileName));
    const arrivedAtDst = fs.existsSync(movedPath);
    if (stillAtSrc || !arrivedAtDst) {
        throw new Error('drag did not move the file as expected (stillAtSource=' + stillAtSrc + ', arrivedAtDestination=' + arrivedAtDst + ')');
    }
    return { from: path.join(srcDir, fileName), to: movedPath };
}

// ─── Scenario 10: held input releases safely on focus loss ────────────────
async function scenario10() {
    await cleanDesktop();
    await exec('open_app', { name: 'notepad.exe', waitMs: 8000 });
    await sleep(400);

    // Start holding a harmless letter key with requireForeground=true, then
    // switch focus away mid-hold (Alt-Tab to nothing else open just brings
    // focus back to itself, so open a second window first).
    await exec('open_app', { name: 'calc.exe', waitMs: 8000 });
    await sleep(400);
    await exec('window_focus', { processName: 'notepad' });
    await sleep(300);

    const holdPromise = exec('input_hold', {
        keys: ['w'],
        durationMs: 4000,
        requireForeground: true,
    });
    await sleep(600);
    await exec('window_focus', { processName: 'calculatorapp' });
    const holdResult = await holdPromise;

    if (holdResult.reason !== 'foreground-changed') {
        throw new Error('expected hold to release due to foreground-changed, got reason=' + holdResult.reason + ' (elapsedMs=' + holdResult.elapsedMs + ')');
    }
    if (holdResult.elapsedMs >= 4000) {
        throw new Error('hold ran to full duration instead of releasing early on focus loss');
    }
    return holdResult;
}

// ─── Scenario 11: workspace capture → move → restore ─────────────────────
// Exercises the two primitives the Workspace Profiles feature is built on
// (window_snapshot to capture a layout, window_set_rect to apply one), which
// the ACTION_PLAN explicitly notes lack an automated regression test.
async function scenario11() {
    await cleanDesktop();
    await exec('open_app', { name: 'notepad.exe', waitMs: 8000 });
    await sleep(400);

    const findNotepad = (windows) => (windows || []).find(w =>
        String(w.processName || '').toLowerCase().includes('notepad')
    );

    const before = await exec('window_snapshot', {});
    const winBefore = findNotepad(before.windows);
    if (!winBefore) throw new Error('window_snapshot did not report a Notepad window');

    const orig = { x: winBefore.x, y: winBefore.y, width: winBefore.width, height: winBefore.height };
    const moved = { x: orig.x + 120, y: orig.y + 120, width: Math.max(400, orig.width - 40), height: Math.max(300, orig.height - 40) };
    const match = { processName: winBefore.processName };

    // Move the window somewhere clearly different.
    await exec('window_set_rect', { ...match, ...moved });
    await sleep(700);
    const snapMoved = await exec('window_snapshot', {});
    const winMoved = findNotepad(snapMoved.windows);
    if (!winMoved) throw new Error('window_snapshot did not report the Notepad window after move');
    const movedDelta = Math.abs(winMoved.x - orig.x) + Math.abs(winMoved.y - orig.y);
    if (movedDelta < 80) {
        throw new Error('window did not move as expected: original=' + JSON.stringify(orig) + ' after-move=' + JSON.stringify({ x: winMoved.x, y: winMoved.y }));
    }

    // Restore it to the captured bounds and confirm it came back.
    await exec('window_set_rect', { ...match, ...orig });
    await sleep(700);
    const snapRestored = await exec('window_snapshot', {});
    const winRestored = findNotepad(snapRestored.windows);
    if (!winRestored) throw new Error('window_snapshot did not report the Notepad window after restore');
    const restoreDelta = Math.abs(winRestored.x - orig.x) + Math.abs(winRestored.y - orig.y);
    if (restoreDelta > 12) {
        throw new Error('window did not restore to original position: original=' + JSON.stringify(orig) + ' restored=' + JSON.stringify({ x: winRestored.x, y: winRestored.y }));
    }

    return { original: orig, restored: { x: winRestored.x, y: winRestored.y, width: winRestored.width, height: winRestored.height } };
}

const SCENARIOS = [
    { id: 1, name: 'Type and save a note in Notepad', fn: scenario1 },
    { id: 2, name: 'Do arithmetic in Calculator by clicking', fn: scenario2 },
    { id: 3, name: 'Rename a file in File Explorer', fn: scenario3 },
    { id: 4, name: 'Alt-Tab between two open windows', fn: scenario4 },
    { id: 5, name: 'Detect what the user just typed (perception-only)', fn: function (opts) { return scenario5(opts); }, needsInteractive: true },
    { id: 6, name: 'Read a non-trivial UI state via perception', fn: scenario6 },
    { id: 7, name: 'Record a short task once, then auto-replay it', fn: scenario7 },
    { id: 8, name: 'Plain-English instruction -> planner decides steps', fn: scenario8, needsLlm: true },
    { id: 9, name: 'Drag-and-drop with a moving mouse path', fn: scenario9 },
    { id: 10, name: 'Held input releases safely on focus loss', fn: scenario10 },
    { id: 11, name: 'Workspace capture, move, restore (window_snapshot + window_set_rect)', fn: scenario11 },
];

function parseArgs(argv) {
    const opts = { only: null, runs: 1, interactive: false, list: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--list') opts.list = true;
        else if (a === '--interactive') opts.interactive = true;
        else if (a.indexOf('--only=') === 0) opts.only = a.slice('--only='.length).split(',').map(function (s) { return parseInt(s.trim(), 10); });
        else if (a.indexOf('--runs=') === 0) opts.runs = Math.max(1, parseInt(a.slice('--runs='.length), 10) || 1);
    }
    return opts;
}

async function runOnce(opts) {
    const results = [];
    const targets = SCENARIOS.filter(function (s) { return !opts.only || opts.only.indexOf(s.id) !== -1; });
    for (let i = 0; i < targets.length; i++) {
        const s = targets[i];
        const startedAt = Date.now();
        let record = { id: s.id, name: s.name, status: 'unknown', durationMs: 0 };
        try {
            const out = await s.fn(opts);
            record.durationMs = Date.now() - startedAt;
            if (out && out.skipped) {
                record.status = 'skipped';
                record.reason = out.skipped;
                console.log('[' + s.id + '] SKIP  ' + s.name + ' — ' + out.skipped);
            } else {
                record.status = 'pass';
                record.detail = out;
                console.log('[' + s.id + '] PASS  ' + s.name + ' (' + record.durationMs + 'ms)');
            }
        } catch (e) {
            record.durationMs = Date.now() - startedAt;
            record.status = 'fail';
            record.error = e && e.message ? e.message : String(e);
            console.log('[' + s.id + '] FAIL  ' + s.name + ' — ' + record.error);
        }
        results.push(record);
    }
    return results;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.list) {
        console.log('Available scenarios:');
        for (let i = 0; i < SCENARIOS.length; i++) {
            console.log('  ' + SCENARIOS[i].id + '. ' + SCENARIOS[i].name);
        }
        return;
    }

    console.log('─── Simple core-functionality validation ───');
    console.log('Runs: ' + opts.runs + (opts.only ? (', only=' + opts.only.join(',')) : '') + (opts.interactive ? ', interactive' : ''));
    console.log('This will take over your desktop (open apps, type, click, move the mouse).');
    console.log('');

    const restore = applyPermissiveConfig();
    const allRuns = [];
    try {
        for (let run = 0; run < opts.runs; run++) {
            if (opts.runs > 1) console.log('\n=== Run ' + (run + 1) + ' / ' + opts.runs + ' ===');
            const results = await runOnce(opts);
            allRuns.push({ run: run + 1, at: new Date().toISOString(), results: results });
        }
    } finally {
        restore();
    }

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const outFile = path.join(RESULTS_DIR, Date.now() + '.json');
    fs.writeFileSync(outFile, JSON.stringify(allRuns, null, 2), 'utf-8');

    // Per-scenario pass rate across all runs.
    const tally = {};
    for (let r = 0; r < allRuns.length; r++) {
        const results = allRuns[r].results;
        for (let i = 0; i < results.length; i++) {
            const rec = results[i];
            if (!tally[rec.id]) tally[rec.id] = { name: rec.name, pass: 0, fail: 0, skip: 0 };
            if (rec.status === 'pass') tally[rec.id].pass++;
            else if (rec.status === 'fail') tally[rec.id].fail++;
            else tally[rec.id].skip++;
        }
    }

    console.log('\n─── Summary (' + opts.runs + ' run(s)) ───');
    let anyFail = false;
    const ids = Object.keys(tally).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });
    for (let i = 0; i < ids.length; i++) {
        const t = tally[ids[i]];
        const total = t.pass + t.fail + t.skip;
        const rate = (t.pass + t.fail) > 0 ? Math.round((100 * t.pass) / (t.pass + t.fail)) : null;
        if (t.fail > 0) anyFail = true;
        console.log('  [' + ids[i] + '] ' + t.name + ': ' + t.pass + ' pass / ' + t.fail + ' fail / ' + t.skip + ' skip' + (rate !== null ? ' (' + rate + '% of non-skipped runs)' : ''));
    }
    console.log('\nResults written to: ' + outFile);
    process.exit(anyFail ? 1 : 0);
}

if (require.main === module) {
    main().catch(function (err) {
        console.error('[validate-core-functionality] fatal:', err);
        process.exit(2);
    });
}

module.exports = {
    registry: registry, exec: exec, sleep: sleep, cleanDesktop: cleanDesktop, sandboxPath: sandboxPath,
    applyPermissiveConfig: applyPermissiveConfig, killByName: killByName,
    scenario1: scenario1, scenario2: scenario2, scenario3: scenario3, scenario4: scenario4, scenario5: scenario5,
    scenario6: scenario6, scenario7: scenario7, scenario8: scenario8, scenario9: scenario9, scenario10: scenario10,
    scenario11: scenario11,
    SCENARIOS: SCENARIOS,
};
