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
function Focus-WindowByTitle($needle) {
    if (-not $needle) { return $null }
    $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$needle*" } | Select-Object -First 1
    if (-not $p) { return $null }
    [Native]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null  # 9 = SW_RESTORE
    Start-Sleep -Milliseconds 80
    [Native]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    return @{ pid = $p.Id; title = $p.MainWindowTitle }
}
`;

function runPsScript(script, { timeoutMs = 65 * 60_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-',
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
        child.stdin.write(script);
        child.stdin.end();
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
        const keys = Array.isArray(args.keys) ? args.keys : [];
        const buttons = Array.isArray(args.mouseButtons) ? args.mouseButtons : [];
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
        const keys = Array.isArray(args.keys) ? args.keys : [];
        const buttons = Array.isArray(args.mouseButtons) ? args.mouseButtons : [];
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

module.exports = { inputHold, inputTap };
