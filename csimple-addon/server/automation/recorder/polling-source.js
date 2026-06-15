/**
 * Polling-based input event source.
 *
 * Native global hooks (SetWindowsHookEx, uiohook-napi) would be more
 * efficient and catch keyboard events, but they require platform-specific
 * native modules. For the MVP recorder we ship a polling source that:
 *
 *   - Samples the mouse position + button state every `pollMs` (default 25ms)
 *     via PowerShell's [System.Windows.Forms.Cursor] and Win32 GetAsyncKeyState.
 *   - Tracks the foreground window title + process name via UIA's
 *     FocusedElement.
 *   - Emits events ONLY when something changes (no spam of identical samples).
 *
 * Emits events on the registered listener:
 *   { ts, type, data }
 *     type = 'mouse_move'    { x, y }
 *     type = 'mouse_click'   { x, y, button: 'left'|'right'|'middle' }
 *     type = 'focus_change'  { windowTitle, processName, hwnd }
 *
 * Keyboard capture is intentionally out of scope for this source. A later
 * native-hook source can be slotted in alongside it via the same emit
 * interface.
 */

const { spawn } = require('child_process');

const DEFAULT_POLL_MS = 50;
const MOVE_THRESHOLD_PX = 3;   // ignore micro-jitter

class PollingInputSource {
    constructor({ pollMs = DEFAULT_POLL_MS, listener } = {}) {
        this.pollMs = pollMs;
        this.listener = listener;
        this._timer = null;
        this._proc = null;
        this._last = null;       // { x, y, leftDown, rightDown, midDown, hwnd, title, proc }
        this._buffer = '';
    }

    start() {
        if (this._proc) return;
        // We delegate sampling to a long-running PowerShell process: cheaper than
        // spawning PS every 50ms.
        const script = this._buildScript();
        this._proc = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', '-',
        ], { windowsHide: true });
        this._proc.stdout.on('data', d => this._onData(d.toString('utf-8')));
        this._proc.stderr.on('data', d => {
            // Surface stderr lines as 'error' events but don't crash the source.
            this._emit({ type: 'error', data: { source: 'ps-stderr', message: d.toString('utf-8').trim() } });
        });
        this._proc.on('exit', code => {
            this._emit({ type: 'source_exit', data: { code } });
            this._proc = null;
        });
        this._proc.stdin.write(script + '\n');
        this._proc.stdin.end();
    }

    stop() {
        try { if (this._proc) this._proc.kill('SIGKILL'); } catch {}
        this._proc = null;
    }

    _onData(chunk) {
        this._buffer += chunk;
        // Process complete JSON lines.
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

        // Click detection: edge from "up" → "down".
        if (prev) {
            if (s.leftDown && !prev.leftDown)   this._emit({ ts, type: 'mouse_click', data: { x: s.x, y: s.y, button: 'left' } });
            if (s.rightDown && !prev.rightDown) this._emit({ ts, type: 'mouse_click', data: { x: s.x, y: s.y, button: 'right' } });
            if (s.midDown && !prev.midDown)     this._emit({ ts, type: 'mouse_click', data: { x: s.x, y: s.y, button: 'middle' } });
        }

        // Move detection (with threshold).
        if (!prev || Math.abs(s.x - prev.x) > MOVE_THRESHOLD_PX || Math.abs(s.y - prev.y) > MOVE_THRESHOLD_PX) {
            this._emit({ ts, type: 'mouse_move', data: { x: s.x, y: s.y } });
        }

        // Focus changes.
        if (!prev || prev.hwnd !== s.hwnd || prev.title !== s.title) {
            this._emit({ ts, type: 'focus_change', data: { windowTitle: s.title || '', processName: s.proc || '', hwnd: s.hwnd || null } });
        }

        this._last = s;
    }

    _emit(ev) {
        try { this.listener && this.listener(ev); } catch {}
    }

    _buildScript() {
        return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms

# Win32 helpers for async key state and foreground window.
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
while ($true) {
    $pt = [System.Windows.Forms.Cursor]::Position
    $h = [_Hook]::GetForegroundWindow()
    $titleLen = [_Hook]::GetWindowTextLength($h)
    $sb = New-Object System.Text.StringBuilder ($titleLen + 1)
    [void][_Hook]::GetWindowText($h, $sb, $sb.Capacity)
    $procName = ''
    try {
        [uint32]$pid = 0
        [void][_Hook]::GetWindowThreadProcessId($h, [ref]$pid)
        $procName = (Get-Process -Id $pid -ErrorAction Stop).ProcessName
    } catch {}
    $left  = (([_Hook]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0)
    $right = (([_Hook]::GetAsyncKeyState(0x02) -band 0x8000) -ne 0)
    $mid   = (([_Hook]::GetAsyncKeyState(0x04) -band 0x8000) -ne 0)
    $sample = [pscustomobject]@{
        x = $pt.X; y = $pt.Y
        leftDown = $left; rightDown = $right; midDown = $mid
        hwnd = ([Int64]$h)
        title = $sb.ToString()
        proc = $procName
    }
    $sample | ConvertTo-Json -Compress
    Start-Sleep -Milliseconds $pollMs
}
        `.trim();
    }
}

module.exports = { PollingInputSource };
