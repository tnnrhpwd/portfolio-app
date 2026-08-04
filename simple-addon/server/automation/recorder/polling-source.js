/**
 * Polling-based input event source.
 *
 * Native global hooks (SetWindowsHookEx, uiohook-napi) would be more
 * efficient, but they require platform-specific native modules. For the MVP
 * recorder we ship a PowerShell polling source that:
 *
 *   - Samples the mouse position + button state every `pollMs` (default 50ms)
 *     via [System.Windows.Forms.Cursor] and Win32 GetAsyncKeyState.
 *   - Polls a curated set of keyboard virtual-key codes each cycle and
 *     emits keydown / keyup events on edge transitions.
 *   - Tracks the foreground window title + process name.
 *   - Emits events ONLY when something changes (no spam of identical samples).
 *
 * Emits events on the registered listener:
 *   { ts, type, data }
 *     type = 'mouse_move'    { x, y }
 *     type = 'mouse_click'   { x, y, button: 'left'|'right'|'middle' }   (down edge)
 *     type = 'mouse_up'      { x, y, button: 'left'|'right'|'middle' }   (release edge)
 *     type = 'key_down'      { vk, name }
 *     type = 'key_up'        { vk, name }
 *     type = 'focus_change'  { windowTitle, processName, hwnd }
 *
 * Notes on keyboard capture:
 *   - Polling at 50 ms means a very fast tap (< ~40 ms) can be missed, and
 *     rapid alternating repeats are collapsed. This is acceptable for macro
 *     recording of deliberate keystrokes; if we need to capture typing at full
 *     speed we should switch to a native hook (SetWindowsHookEx / uiohook).
 *   - Names use the same vocabulary that the `input_tap` tool's resolveKey()
 *     accepts (letters a-z lowercased, digits, plus 'shift', 'ctrl', 'alt',
 *     'space', 'enter', 'tab', 'escape', 'backspace', arrow keys, f1-f12,
 *     punctuation aliases, etc.), so the compiler can hand the names straight
 *     to input_tap at replay time.
 */

const { spawn } = require('child_process');

const DEFAULT_POLL_MS = 50;
const MOVE_THRESHOLD_PX = 3;   // ignore micro-jitter

// Keys we poll each cycle. Values are the names input_tap's resolveKey()
// accepts. Keep in sync with input.js `VK`. Left/right variant modifiers
// collapse to the generic name — macros almost never care which side.
const KEY_MAP = {
    0x08: 'backspace', 0x09: 'tab', 0x0D: 'enter',
    0x10: 'shift',     0x11: 'ctrl',    0x12: 'alt',
    0x13: 'pause',     0x14: 'capslock',0x1B: 'escape', 0x20: 'space',
    0x21: 'pageup',    0x22: 'pagedown',0x23: 'end',    0x24: 'home',
    0x25: 'left',      0x26: 'up',      0x27: 'right',  0x28: 'down',
    0x2D: 'insert',    0x2E: 'delete',
    0x5B: 'lwin',      0x5C: 'rwin',
    // Digits
    0x30: '0', 0x31: '1', 0x32: '2', 0x33: '3', 0x34: '4',
    0x35: '5', 0x36: '6', 0x37: '7', 0x38: '8', 0x39: '9',
    // Letters (VK_A..VK_Z → 'a'..'z')
    0x41: 'a', 0x42: 'b', 0x43: 'c', 0x44: 'd', 0x45: 'e', 0x46: 'f',
    0x47: 'g', 0x48: 'h', 0x49: 'i', 0x4A: 'j', 0x4B: 'k', 0x4C: 'l',
    0x4D: 'm', 0x4E: 'n', 0x4F: 'o', 0x50: 'p', 0x51: 'q', 0x52: 'r',
    0x53: 's', 0x54: 't', 0x55: 'u', 0x56: 'v', 0x57: 'w', 0x58: 'x',
    0x59: 'y', 0x5A: 'z',
    // Function keys
    0x70: 'f1', 0x71: 'f2', 0x72: 'f3', 0x73: 'f4', 0x74: 'f5', 0x75: 'f6',
    0x76: 'f7', 0x77: 'f8', 0x78: 'f9', 0x79: 'f10', 0x7A: 'f11', 0x7B: 'f12',
    // Punctuation (OEM keys) — names match input.js VK map.
    0xBA: 'semicolon', 0xBB: 'equals',  0xBC: 'comma',    0xBD: 'minus',
    0xBE: 'period',    0xBF: 'slash',   0xC0: 'backtick',
    0xDB: 'lbracket',  0xDC: 'backslash',0xDD: 'rbracket',0xDE: 'quote',
};
const KEY_VKS = Object.keys(KEY_MAP).map(k => Number(k));

class PollingInputSource {
    constructor({ pollMs = DEFAULT_POLL_MS, listener } = {}) {
        this.pollMs = pollMs;
        this.listener = listener;
        this._proc = null;
        // _last shape: { x, y, leftDown, rightDown, midDown, hwnd, title, proc, keys: Set<vk> }
        this._last = null;
        this._buffer = '';
    }

    start() {
        if (this._proc) return;
        // Long-running PowerShell child. Transport: -EncodedCommand
        // (UTF-16LE base64). The `-Command -` stdin approach was unreliable —
        // the child would parse the here-string but exit before entering the
        // sampling loop, producing empty recordings.
        const script = this._buildScript();
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        const psExe = process.env.SystemRoot
            ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
            : 'powershell.exe';
        this._proc = spawn(psExe, [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-EncodedCommand', encoded,
        ], { windowsHide: true });
        this._proc.stdout.on('data', d => this._onData(d.toString('utf-8')));
        this._proc.stderr.on('data', d => {
            this._emit({ type: 'error', data: { source: 'ps-stderr', message: d.toString('utf-8').trim() } });
        });
        this._proc.on('exit', code => {
            this._emit({ type: 'source_exit', data: { code } });
            this._proc = null;
        });
    }

    stop() {
        try { if (this._proc) this._proc.kill('SIGKILL'); } catch {}
        this._proc = null;
    }

    _onData(chunk) {
        this._buffer += chunk;
        let nl;
        while ((nl = this._buffer.indexOf('\n')) >= 0) {
            const line = this._buffer.slice(0, nl).trim();
            this._buffer = this._buffer.slice(nl + 1);
            if (!line) continue;
            try {
                const sample = JSON.parse(line);
                this._processSample(sample);
            } catch {
                // Ignore malformed lines — the PS host occasionally injects noise.
            }
        }
    }

    _processSample(s) {
        const ts = Date.now();
        const prev = this._last;

        // PS sends `keys` as an array of ints (empty samples come through as
        // an omitted field or null — coerce to []). Set enables cheap diffing.
        const keysNow = new Set(Array.isArray(s.keys) ? s.keys : []);

        // Click detection: edge from "up" → "down" emits mouse_click (kept
        // for backward compatibility with existing consumers), edge from
        // "down" → "up" emits mouse_up so the compiler can measure the hold
        // duration and detect drags.
        if (prev) {
            if (s.leftDown && !prev.leftDown)   this._emit({ ts, type: 'mouse_click', data: { x: s.x, y: s.y, button: 'left' } });
            if (s.rightDown && !prev.rightDown) this._emit({ ts, type: 'mouse_click', data: { x: s.x, y: s.y, button: 'right' } });
            if (s.midDown && !prev.midDown)     this._emit({ ts, type: 'mouse_click', data: { x: s.x, y: s.y, button: 'middle' } });
            if (!s.leftDown && prev.leftDown)   this._emit({ ts, type: 'mouse_up',    data: { x: s.x, y: s.y, button: 'left' } });
            if (!s.rightDown && prev.rightDown) this._emit({ ts, type: 'mouse_up',    data: { x: s.x, y: s.y, button: 'right' } });
            if (!s.midDown && prev.midDown)     this._emit({ ts, type: 'mouse_up',    data: { x: s.x, y: s.y, button: 'middle' } });

            // Keyboard edge detection.
            for (const vk of keysNow) {
                if (!prev.keys.has(vk)) {
                    const name = KEY_MAP[vk];
                    if (name) this._emit({ ts, type: 'key_down', data: { vk, name } });
                }
            }
            for (const vk of prev.keys) {
                if (!keysNow.has(vk)) {
                    const name = KEY_MAP[vk];
                    if (name) this._emit({ ts, type: 'key_up', data: { vk, name } });
                }
            }
        } else {
            // First sample: currently-held keys are emitted as fresh key_downs
            // so a key held at record-start still appears in the trace.
            for (const vk of keysNow) {
                const name = KEY_MAP[vk];
                if (name) this._emit({ ts, type: 'key_down', data: { vk, name } });
            }
        }

        if (!prev || Math.abs(s.x - prev.x) > MOVE_THRESHOLD_PX || Math.abs(s.y - prev.y) > MOVE_THRESHOLD_PX) {
            this._emit({ ts, type: 'mouse_move', data: { x: s.x, y: s.y } });
        }

        if (!prev || prev.hwnd !== s.hwnd || prev.title !== s.title) {
            this._emit({ ts, type: 'focus_change', data: { windowTitle: s.title || '', processName: s.proc || '', hwnd: s.hwnd || null } });
        }

        this._last = {
            x: s.x, y: s.y,
            leftDown: s.leftDown, rightDown: s.rightDown, midDown: s.midDown,
            hwnd: s.hwnd, title: s.title, proc: s.proc,
            keys: keysNow,
        };
    }

    _emit(ev) {
        try { this.listener && this.listener(ev); } catch {}
    }

    _buildScript() {
        // JS-side KEY_MAP is the single source of truth for which keys to
        // poll; splice its VK codes into the PS loop as a native int array.
        const vkArrayLiteral = '@(' + KEY_VKS.map(v => `0x${v.toString(16).toUpperCase()}`).join(',') + ')';
        return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class _Hook {
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int  GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$pollMs = ${this.pollMs}
$keyVks = ${vkArrayLiteral}
while ($true) {
    $pt = [System.Windows.Forms.Cursor]::Position
    $h = [_Hook]::GetForegroundWindow()
    $titleLen = [_Hook]::GetWindowTextLength($h)
    $sb = New-Object System.Text.StringBuilder ($titleLen + 1)
    [void][_Hook]::GetWindowText($h, $sb, $sb.Capacity)
    $procName = ''
    try {
        # $pid is a read-only automatic in PowerShell — use $procId instead.
        [uint32]$procId = 0
        [void][_Hook]::GetWindowThreadProcessId($h, [ref]$procId)
        $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName
    } catch {}
    $left  = (([_Hook]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0)
    $right = (([_Hook]::GetAsyncKeyState(0x02) -band 0x8000) -ne 0)
    $mid   = (([_Hook]::GetAsyncKeyState(0x04) -band 0x8000) -ne 0)
    # Sweep the curated key set. Emit VK codes for currently-held keys only —
    # JS diffs against the previous poll to derive keydown/keyup edges.
    $pressed = New-Object System.Collections.Generic.List[int]
    foreach ($vk in $keyVks) {
        if (([_Hook]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) {
            [void]$pressed.Add([int]$vk)
        }
    }
    $sample = [pscustomobject]@{
        x = $pt.X; y = $pt.Y
        leftDown = $left; rightDown = $right; midDown = $mid
        hwnd = ([Int64]$h)
        title = $sb.ToString()
        proc = $procName
        keys = @($pressed)
    }
    $sample | ConvertTo-Json -Compress
    Start-Sleep -Milliseconds $pollMs
}
        `.trim();
    }
}

module.exports = { PollingInputSource, KEY_MAP };
