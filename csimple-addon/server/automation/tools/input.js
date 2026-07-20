/**
 * Generic synthetic input tools — hold or tap any combination of keyboard
 * keys and mouse buttons, optionally targeting a specific window first.
 *
 * Built for arbitrary Windows automation (productivity macros, accessibility,
 * repetitive UI workflows, long-running interaction loops, etc.).
 *
 * Safety model:
 *   - All inputs are released in a `finally` block in the PowerShell script,
 *     so a crash or kill mid-hold cannot leave a button stuck down.
 *   - The hold loop polls VK_ESCAPE every poll interval. When the user
 *     presses Escape, inputs are released and the tool returns.
 *   - A hard cap on duration prevents runaway holds. Default 5 minutes,
 *     absolute max 60 minutes.
 *   - Category 'system' — first invocation prompts the user via the
 *     Permission Center.
 */

const { spawn } = require('child_process');

const DEFAULT_HOLD_MS = 5 * 60_000;
const MAX_HOLD_MS = 60 * 60_000;
const POLL_INTERVAL_MS = 50;

// ─── Virtual-key map (Win32 VK_*) ─────────────────────────────────────────────
const VK = {
    backspace: 0x08, tab: 0x09, enter: 0x0D, shift: 0x10, ctrl: 0x11, alt: 0x12,
    pause: 0x13, capslock: 0x14, escape: 0x1B, space: 0x20,
    pageup: 0x21, pagedown: 0x22, end: 0x23, home: 0x24,
    left: 0x25, up: 0x26, right: 0x27, down: 0x28,
    insert: 0x2D, delete: 0x2E,
    lwin: 0x5B, rwin: 0x5C,
    f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
    f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B,
    semicolon: 0xBA, equals: 0xBB, comma: 0xBC, minus: 0xBD,
    period: 0xBE, slash: 0xBF, backtick: 0xC0,
    lbracket: 0xDB, backslash: 0xDC, rbracket: 0xDD, quote: 0xDE,
};
function resolveKey(name) {
    if (typeof name !== 'string' || !name) throw new Error('key must be a non-empty string');
    const k = name.trim().toLowerCase();
    if (VK[k] !== undefined) return VK[k];
    if (k.length === 1) {
        const c = k.charCodeAt(0);
        if (c >= 97 && c <= 122) return c - 32;           // a-z → 0x41-0x5A
        if (c >= 48 && c <= 57)  return c;                // 0-9 → 0x30-0x39
    }
    throw new Error(`unknown key: ${name}`);
}

const MOUSE_FLAGS = {
    left:   { down: 0x0002, up: 0x0004 },
    right:  { down: 0x0008, up: 0x0010 },
    middle: { down: 0x0020, up: 0x0040 },
};
function resolveButton(name) {
    const b = String(name || '').toLowerCase();
    if (!MOUSE_FLAGS[b]) throw new Error(`unknown mouse button: ${name}`);
    return MOUSE_FLAGS[b];
}

// Defense-in-depth: some callers (older compiled skills, or steps normalised
// upstream in tools/skill.js before that fix existed) pass a mouse-button
// phrase like "left mouse button" / "left click" inside `keys` instead of the
// dedicated `mouseButtons` array. resolveKey() has no way to represent that as
// a keyboard virtual-key, so it throws — the macro appears to instantly fail
// doing nothing. Split those phrases out here too, right before resolution,
// so input_hold/input_tap work regardless of which layer produced the args.
const _MOUSE_PHRASE_RE = /^(?:((?:left|right|middle))(?:[\s_-]+(?:mouse(?:[\s_-]*(?:button|click))?|button|click))(?:[\s_-]+(?:down|up|hold|held|press|pressed))?|((?:lmb|rmb|mmb)))$/i;
function splitMousePhrasesFromKeys(keys, existingButtons) {
    const buttons = new Set((existingButtons || []).map(b => String(b).toLowerCase()));
    const realKeys = [];
    for (const k of (keys || [])) {
        const raw = typeof k === 'string' ? k.trim().replace(/^["']|["']$/g, '') : '';
        const m = raw ? _MOUSE_PHRASE_RE.exec(raw) : null;
        if (m) {
            const matched = (m[1] || m[2] || '').toLowerCase();
            const btn = matched === 'lmb' ? 'left' : matched === 'rmb' ? 'right' : matched === 'mmb' ? 'middle' : matched;
            if (btn) buttons.add(btn);
        }
        else realKeys.push(k);
    }
    return { keys: realKeys, mouseButtons: Array.from(buttons) };
}

// ─── PowerShell prelude: Win32 P/Invoke + window focus helper ─────────────────
const NATIVE_PRELUDE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Native {
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
function Set-ForegroundWindowForce($hwnd) {
    # SetForegroundWindow silently no-ops when called from a background
    # process (this script) due to Windows' foreground-lock-timeout
    # heuristic -- the classic cause of automation input landing on
    # whatever window actually still has focus (e.g. the terminal/editor
    # that launched the macro) instead of the intended target. That makes
    # key taps look like they "did nothing" and makes a held mouse button
    # look like a stray click somewhere else. A synthetic Alt press/release
    # resets that lock; verify with GetForegroundWindow and retry briefly.
    for ($i = 0; $i -lt 3; $i++) {
        if ([Native]::GetForegroundWindow() -eq $hwnd) { return $true }
        [Native]::keybd_event(0x12, 0, 0x0000, [UIntPtr]::Zero)
        [Native]::keybd_event(0x12, 0, 0x0002, [UIntPtr]::Zero)
        [Native]::ShowWindowAsync($hwnd, 9) | Out-Null  # 9 = SW_RESTORE
        [Native]::SetForegroundWindow($hwnd) | Out-Null
        Start-Sleep -Milliseconds 100
    }
    return [Native]::GetForegroundWindow() -eq $hwnd
}
function Focus-WindowByTitle($needle) {
    if (-not $needle) { return $null }
    $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$needle*" } | Select-Object -First 1
    if (-not $p) { return $null }
    $confirmed = Set-ForegroundWindowForce $p.MainWindowHandle
    return @{ pid = $p.Id; title = $p.MainWindowTitle; focusConfirmed = $confirmed }
}
`;

function runPsScript(script, { timeoutMs = 65 * 60_000 } = {}) {
    return new Promise((resolve, reject) => {
        // Transport: -EncodedCommand (UTF-16LE base64). The `-Command -` stdin
        // approach used previously was unreliable — the child would parse the
        // here-string but exit before executing, so click_at / input_hold /
        // input_tap all silently no-op'd.
        const encoded = Buffer.from(String(script), 'utf16le').toString('base64');
        const psExe = process.env.SystemRoot
            ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
            : 'powershell.exe';
        const child = spawn(psExe, [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-EncodedCommand', encoded,
        ], { windowsHide: true });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => { stdout += d.toString('utf-8'); });
        child.stderr.on('data', d => { stderr += d.toString('utf-8'); });
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(stderr.trim() || `powershell exited with ${code}`));
            resolve(stdout.trim());
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
    });
}

// ─── input_hold ───────────────────────────────────────────────────────────────
const inputHold = {
    name: 'input_hold',
    category: 'system',
    description:
        'Hold any combination of keyboard keys and mouse buttons for a duration, ' +
        'optionally focusing a target window first. The hold ALWAYS releases ' +
        'when the user presses Escape, when the duration elapses, or if the ' +
        'process is killed. Use for long-running repetitive interactions where ' +
        'the user wants the foreground app to receive sustained input.',
    parameters: {
        type: 'object',
        properties: {
            keys: {
                type: 'array', items: { type: 'string' },
                description: 'Keyboard keys to hold (e.g. ["w","shift"]). Letters a-z, digits 0-9, plus named keys: space, enter, tab, escape, shift, ctrl, alt, f1-f12, arrow keys (up/down/left/right), etc.',
            },
            mouseButtons: {
                type: 'array', items: { type: 'string', enum: ['left', 'right', 'middle'] },
                description: 'Mouse buttons to hold down for the duration.',
            },
            durationMs: {
                type: 'integer',
                description: `Maximum hold duration in ms. Default ${DEFAULT_HOLD_MS}. Hard cap ${MAX_HOLD_MS}.`,
            },
            focusWindowTitle: {
                type: 'string',
                description: 'Substring matched against window titles. If supplied, the first matching window is focused before holding begins.',
            },
            requireForeground: {
                type: 'boolean',
                description: 'If true and the foreground window changes during the hold, inputs are released immediately. Default false.',
            },
        },
    },
    async run(args, ctx) {
        const { keys, mouseButtons } = splitMousePhrasesFromKeys(
            Array.isArray(args.keys) ? args.keys : [],
            Array.isArray(args.mouseButtons) ? args.mouseButtons : [],
        );
        const buttons = mouseButtons;
        if (keys.length === 0 && buttons.length === 0) {
            throw new Error('at least one key or mouseButton is required');
        }
        const vks = keys.map(resolveKey);
        const btns = buttons.map(resolveButton);
        const duration = Math.min(MAX_HOLD_MS, Math.max(50, args.durationMs || DEFAULT_HOLD_MS));
        const needle = (args.focusWindowTitle || '').replace(/"/g, '');
        const reqFg = !!args.requireForeground;

        const downKeys = vks.map(v => `[Native]::keybd_event(${v}, 0, 0x0000, [UIntPtr]::Zero)`).join('; ');
        const upKeys   = vks.map(v => `[Native]::keybd_event(${v}, 0, 0x0002, [UIntPtr]::Zero)`).join('; ');
        const downBtns = btns.map(f => `[Native]::mouse_event(${f.down}, 0, 0, 0, [UIntPtr]::Zero)`).join('; ');
        const upBtns   = btns.map(f => `[Native]::mouse_event(${f.up}, 0, 0, 0, [UIntPtr]::Zero)`).join('; ');

        const script = `${NATIVE_PRELUDE}
$focused = $null
if ("${needle}") { $focused = Focus-WindowByTitle "${needle}" }
$startFg = [Native]::GetForegroundWindow()
$started = [System.Diagnostics.Stopwatch]::StartNew()
$reason = "duration-elapsed"

try {
    ${downKeys ? downKeys : '# no keys'}
    ${downBtns ? downBtns : '# no mouse buttons'}

    while ($started.ElapsedMilliseconds -lt ${duration}) {
        if (([Native]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0) { $reason = "escape-pressed"; break }
        ${reqFg ? `if ([Native]::GetForegroundWindow() -ne $startFg) { $reason = "foreground-changed"; break }` : ''}
        Start-Sleep -Milliseconds ${POLL_INTERVAL_MS}
    }
}
finally {
    ${upBtns ? upBtns : '# no mouse buttons'}
    ${upKeys ? upKeys : '# no keys'}
}

$out = @{
    reason = $reason
    elapsedMs = [int]$started.ElapsedMilliseconds
    focused = $focused
    keys = @(${keys.map(k => `"${k.replace(/"/g, '')}"`).join(',')})
    mouseButtons = @(${buttons.map(b => `"${b.replace(/"/g, '')}"`).join(',')})
}
$out | ConvertTo-Json -Compress
`;
        const timeoutMs = duration + 5_000;
        const out = await runPsScript(script, { timeoutMs });
        let parsed = null;
        try { parsed = JSON.parse(out); } catch { parsed = { raw: out }; }
        try { ctx?.addAction?.({ tool: 'input_hold', args, result: parsed }); } catch {}
        return parsed;
    },
    async dryRun(args) {
        return {
            dryRun: true,
            wouldHold: {
                keys: args.keys || [],
                mouseButtons: args.mouseButtons || [],
                durationMs: Math.min(MAX_HOLD_MS, args.durationMs || DEFAULT_HOLD_MS),
                focusWindowTitle: args.focusWindowTitle || null,
                releaseOn: ['escape', 'duration', args.requireForeground ? 'foreground-change' : null].filter(Boolean),
            },
        };
    },
};

// ─── input_tap ────────────────────────────────────────────────────────────────
const inputTap = {
    name: 'input_tap',
    category: 'system',
    description:
        'Press and release a sequence of keys and/or mouse buttons once. ' +
        'For sustained input use input_hold instead.',
    parameters: {
        type: 'object',
        properties: {
            keys: { type: 'array', items: { type: 'string' } },
            mouseButtons: { type: 'array', items: { type: 'string', enum: ['left', 'right', 'middle'] } },
            focusWindowTitle: { type: 'string' },
            holdMs: { type: 'integer', description: 'Milliseconds between down and up. Default 30, max 2000.' },
            repeat: { type: 'integer', description: 'How many times to repeat (default 1, max 50).' },
            intervalMs: { type: 'integer', description: 'Pause between repeats. Default 80.' },
        },
    },
    async run(args, ctx) {
        const { keys, mouseButtons } = splitMousePhrasesFromKeys(
            Array.isArray(args.keys) ? args.keys : [],
            Array.isArray(args.mouseButtons) ? args.mouseButtons : [],
        );
        const buttons = mouseButtons;
        if (keys.length === 0 && buttons.length === 0) {
            throw new Error('at least one key or mouseButton is required');
        }
        const vks = keys.map(resolveKey);
        const btns = buttons.map(resolveButton);
        const holdMs = Math.min(2000, Math.max(1, args.holdMs || 30));
        const repeat = Math.min(50, Math.max(1, args.repeat || 1));
        const interval = Math.max(0, args.intervalMs || 80);
        const needle = (args.focusWindowTitle || '').replace(/"/g, '');

        const downKeys = vks.map(v => `[Native]::keybd_event(${v}, 0, 0x0000, [UIntPtr]::Zero)`).join('; ');
        const upKeys   = vks.map(v => `[Native]::keybd_event(${v}, 0, 0x0002, [UIntPtr]::Zero)`).join('; ');
        const downBtns = btns.map(f => `[Native]::mouse_event(${f.down}, 0, 0, 0, [UIntPtr]::Zero)`).join('; ');
        const upBtns   = btns.map(f => `[Native]::mouse_event(${f.up}, 0, 0, 0, [UIntPtr]::Zero)`).join('; ');

        const script = `${NATIVE_PRELUDE}
$focused = $null
if ("${needle}") { $focused = Focus-WindowByTitle "${needle}" }
for ($i = 0; $i -lt ${repeat}; $i++) {
    try {
        ${downKeys}
        ${downBtns}
        Start-Sleep -Milliseconds ${holdMs}
    } finally {
        ${upBtns}
        ${upKeys}
    }
    if ($i -lt ${repeat - 1}) { Start-Sleep -Milliseconds ${interval} }
}
@{ ok = $true; repeated = ${repeat}; focused = $focused } | ConvertTo-Json -Compress
`;
        const out = await runPsScript(script, { timeoutMs: (holdMs + interval) * repeat + 5000 });
        let parsed = null;
        try { parsed = JSON.parse(out); } catch { parsed = { raw: out }; }
        try { ctx?.addAction?.({ tool: 'input_tap', args, result: parsed }); } catch {}
        return parsed;
    },
};

// ─── click_at ─────────────────────────────────────────────────────────────────
// Move cursor to a screen-absolute (x, y) and issue a single click. Used by
// the skill-runner replay path. Wraps SetCursorPos + mouse_event so the click
// lands on whatever pixel the skill recorded.
const clickAt = {
    name: 'click_at',
    category: 'system',
    description:
        'Move the mouse cursor to absolute screen coordinates (x, y) and click. ' +
        'Used to replay recorded skills. Prefer uia_invoke for UI elements you can locate ' +
        'by name — click_at is brittle to layout changes.',
    parameters: {
        type: 'object',
        required: ['x', 'y'],
        properties: {
            x: { type: 'integer' },
            y: { type: 'integer' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
            doubleClick: { type: 'boolean', default: false },
            focusWindowTitle: { type: 'string' },
            settleMs: { type: 'integer', description: 'Pause after focusing window. Default 80.' },
        },
    },
    async run(args, ctx) {
        if (typeof args.x !== 'number' || typeof args.y !== 'number') {
            throw new Error('x and y are required integers');
        }
        const btn = resolveButton(args.button || 'left');
        const settle = Math.max(0, args.settleMs ?? 80);
        const needle = (args.focusWindowTitle || '').replace(/"/g, '');
        const dbl = !!args.doubleClick;
        const x = Math.round(args.x);
        const y = Math.round(args.y);

        const script = `${NATIVE_PRELUDE}
Add-Type @"
using System.Runtime.InteropServices;
public static class Cursor {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@
$focused = $null
if ("${needle}") { $focused = Focus-WindowByTitle "${needle}"; Start-Sleep -Milliseconds ${settle} }
[Cursor]::SetCursorPos(${x}, ${y}) | Out-Null
Start-Sleep -Milliseconds 30
[Native]::mouse_event(${btn.down}, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 25
[Native]::mouse_event(${btn.up}, 0, 0, 0, [UIntPtr]::Zero)
if (${dbl ? '$true' : '$false'}) {
    Start-Sleep -Milliseconds 80
    [Native]::mouse_event(${btn.down}, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 25
    [Native]::mouse_event(${btn.up}, 0, 0, 0, [UIntPtr]::Zero)
}
@{ ok = $true; x = ${x}; y = ${y}; button = "${args.button || 'left'}"; doubleClick = ${dbl ? '$true' : '$false'}; focused = $focused } | ConvertTo-Json -Compress
`;
        const out = await runPsScript(script, { timeoutMs: 5000 });
        let parsed = null;
        try { parsed = JSON.parse(out); } catch { parsed = { raw: out }; }
        try { ctx?.addAction?.({ tool: 'click_at', args, result: parsed }); } catch {}
        return parsed;
    },
};

// ─── mouse_path ───────────────────────────────────────────────────────────────
// Move the cursor along a recorded path of screen-absolute points, replaying
// the timing between them. Used for camera-look / drawing / drag replay when
// the button state is handled elsewhere (or not at all).
const MAX_PATH_MS = 5 * 60_000;
const CURSOR_PRELUDE = `
Add-Type @"
using System.Runtime.InteropServices;
public static class Cursor {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@
`;
function _buildWalkScript(path) {
    // Emit "sleep(delta), SetCursorPos(x,y)" for each point. Sleep between
    // adjacent points uses the delta of tOffsetMs, so the whole walk takes
    // approximately the recorded duration.
    let prevT = 0;
    const lines = [];
    for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        const t = Math.max(0, Math.round(p.tOffsetMs || 0));
        const wait = i === 0 ? 0 : Math.max(0, t - prevT);
        // Cap per-step wait at 5s so a broken recording can't hang the tool.
        const capped = Math.min(5000, wait);
        if (capped > 0) lines.push(`Start-Sleep -Milliseconds ${capped}`);
        // Poll Escape between hops so the user can always abort a long path.
        lines.push(`if (([Native]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0) { $reason = "escape-pressed"; break }`);
        lines.push(`[Cursor]::SetCursorPos(${x}, ${y}) | Out-Null`);
        prevT = t;
    }
    // The Escape checks are inside a `while ($true)` wrapper so `break` works;
    // wrap the whole thing and break at the end to exit the loop cleanly.
    return `$reason = "completed"\nwhile ($true) {\n${lines.join('\n')}\nbreak\n}`;
}

const mousePath = {
    name: 'mouse_path',
    category: 'system',
    description:
        'Move the mouse cursor along a recorded sequence of screen-absolute points, ' +
        'replaying the original timing (each point has a tOffsetMs from the first). ' +
        'Use for camera-look / drawing / cursor-visible drag replay. Press Escape to abort.',
    parameters: {
        type: 'object',
        required: ['path'],
        properties: {
            path: {
                type: 'array',
                description: 'Array of { x, y, tOffsetMs } points. tOffsetMs is milliseconds since the first point (0 for first).',
                items: {
                    type: 'object',
                    required: ['x', 'y'],
                    properties: {
                        x: { type: 'integer' },
                        y: { type: 'integer' },
                        tOffsetMs: { type: 'integer' },
                    },
                },
            },
            focusWindowTitle: { type: 'string' },
            settleMs: { type: 'integer', description: 'Pause after focusing window. Default 80.' },
        },
    },
    async run(args, ctx) {
        const path = Array.isArray(args.path) ? args.path : [];
        if (path.length === 0) throw new Error('path must contain at least one point');
        const settle = Math.max(0, args.settleMs ?? 80);
        const needle = (args.focusWindowTitle || '').replace(/"/g, '');
        const totalMs = Math.min(MAX_PATH_MS, Math.max(0, path[path.length - 1].tOffsetMs || 0));

        const script = `${NATIVE_PRELUDE}
${CURSOR_PRELUDE}
$focused = $null
if ("${needle}") { $focused = Focus-WindowByTitle "${needle}"; Start-Sleep -Milliseconds ${settle} }
${_buildWalkScript(path)}
@{ ok = $true; points = ${path.length}; totalMs = ${totalMs}; reason = $reason; focused = $focused } | ConvertTo-Json -Compress
`;
        const out = await runPsScript(script, { timeoutMs: totalMs + 15_000 });
        let parsed = null;
        try { parsed = JSON.parse(out); } catch { parsed = { raw: out }; }
        try { ctx?.addAction?.({ tool: 'mouse_path', args, result: parsed }); } catch {}
        return parsed;
    },
};

// ─── mouse_drag ───────────────────────────────────────────────────────────────
// Press a mouse button, walk a path of screen-absolute points, release. Used
// for click-and-drag replay (drag files, drag window titles, camera-look in
// games with right-button-hold, drawing while a tool is active, etc.). An
// optional `holdMs` adds a dwell at the final position before release, which
// is how the compiler represents a long stationary press with no movement.
const mouseDrag = {
    name: 'mouse_drag',
    category: 'system',
    description:
        'Press a mouse button, move the cursor along a path of screen-absolute points, then release. ' +
        'Use for click-and-drag, drag-and-drop, or held-button camera control. ' +
        'The button ALWAYS releases in a finally block. Press Escape to abort.',
    parameters: {
        type: 'object',
        required: ['button', 'path'],
        properties: {
            button: { type: 'string', enum: ['left', 'right', 'middle'] },
            path: {
                type: 'array',
                description: 'Array of { x, y, tOffsetMs } points. First point is the press position. tOffsetMs is milliseconds since the first point.',
                items: {
                    type: 'object',
                    required: ['x', 'y'],
                    properties: {
                        x: { type: 'integer' },
                        y: { type: 'integer' },
                        tOffsetMs: { type: 'integer' },
                    },
                },
            },
            holdMs: { type: 'integer', description: 'Extra dwell at final position before release. Default 0.' },
            focusWindowTitle: { type: 'string' },
            settleMs: { type: 'integer', description: 'Pause after focusing window. Default 80.' },
        },
    },
    async run(args, ctx) {
        const path = Array.isArray(args.path) ? args.path : [];
        if (path.length === 0) throw new Error('path must contain at least one point');
        const btn = resolveButton(args.button);
        const holdMs = Math.min(MAX_PATH_MS, Math.max(0, args.holdMs || 0));
        const settle = Math.max(0, args.settleMs ?? 80);
        const needle = (args.focusWindowTitle || '').replace(/"/g, '');
        const startX = Math.round(path[0].x);
        const startY = Math.round(path[0].y);
        const totalMs = Math.min(MAX_PATH_MS, Math.max(0, path[path.length - 1].tOffsetMs || 0));

        const script = `${NATIVE_PRELUDE}
${CURSOR_PRELUDE}
$focused = $null
if ("${needle}") { $focused = Focus-WindowByTitle "${needle}"; Start-Sleep -Milliseconds ${settle} }
[Cursor]::SetCursorPos(${startX}, ${startY}) | Out-Null
Start-Sleep -Milliseconds 30
try {
    [Native]::mouse_event(${btn.down}, 0, 0, 0, [UIntPtr]::Zero)
    ${_buildWalkScript(path)}
    if (${holdMs} -gt 0 -and $reason -eq "completed") {
        $held = [System.Diagnostics.Stopwatch]::StartNew()
        while ($held.ElapsedMilliseconds -lt ${holdMs}) {
            if (([Native]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0) { $reason = "escape-pressed"; break }
            Start-Sleep -Milliseconds 50
        }
    }
} finally {
    [Native]::mouse_event(${btn.up}, 0, 0, 0, [UIntPtr]::Zero)
}
@{ ok = $true; points = ${path.length}; totalMs = ${totalMs}; holdMs = ${holdMs}; reason = $reason; button = "${args.button}"; focused = $focused } | ConvertTo-Json -Compress
`;
        const out = await runPsScript(script, { timeoutMs: totalMs + holdMs + 15_000 });
        let parsed = null;
        try { parsed = JSON.parse(out); } catch { parsed = { raw: out }; }
        try { ctx?.addAction?.({ tool: 'mouse_drag', args, result: parsed }); } catch {}
        return parsed;
    },
};

module.exports = { inputHold, inputTap, clickAt, mousePath, mouseDrag, splitMousePhrasesFromKeys };
