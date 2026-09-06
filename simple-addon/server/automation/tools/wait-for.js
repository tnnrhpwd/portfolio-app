/**
 * wait_for — poll for a condition (a window title, or a running process)
 * before proceeding, instead of guessing a fixed wait_ms.
 *
 * Why this exists: the single most common macro failure mode is a step firing
 * before whatever it targets actually exists — typing into a "Save As" dialog
 * that hasn't opened yet, clicking a window that's still launching, etc.
 * `wait_ms` guesses a duration; `wait_for` polls for the real condition and
 * proceeds the moment it becomes true (or fails the step if it never does).
 *
 * Design notes:
 *   - Self-contained: one PowerShell process polls internally (via
 *     EnumWindows for window-title matching — which sees dialogs and
 *     multi-window processes that Get-Process's MainWindowTitle misses —
 *     and Get-Process for process-name matching), so Node isn't spawning a
 *     fresh PowerShell every poll interval.
 *   - Deterministic helpers are exported (normalizeWaitArgs /
 *     buildWaitForScript / parseWaitForOutput) so the pure logic is
 *     testable offline without spawning PowerShell.
 */

const { runPsJsonFile } = require('../ps-runner');

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 250;
const MIN_POLL_MS = 50;
const MAX_POLL_MS = 2_000;

// ASCII-only on purpose: ps-runner writes the script as UTF-8 without a BOM,
// and Windows PowerShell 5.1 may otherwise mis-read non-ASCII characters.
const PS_PRELUDE = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WaitNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
function Get-WaitWindow([string]$Needle) {
    $script:_waitTitle = $null
    $callback = [WaitNative+EnumWindowsProc]{
        param([IntPtr]$hwnd, [IntPtr]$lparam)
        if (-not [WaitNative]::IsWindowVisible($hwnd)) { return $true }
        $len = [WaitNative]::GetWindowTextLength($hwnd)
        if ($len -le 0) { return $true }
        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [void][WaitNative]::GetWindowText($hwnd, $sb, $sb.Capacity)
        $title = $sb.ToString()
        if (-not $title) { return $true }
        # WinUI3 apps spawn tiny decoy windows literally titled "PopupHost";
        # skip them so a match lands on the real app/dialog window instead.
        if ($title -eq 'PopupHost') { return $true }
        if ($title.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $script:_waitTitle = $title
            return $false
        }
        return $true
    }
    [void][WaitNative]::EnumWindows($callback, [IntPtr]::Zero)
    return $script:_waitTitle
}
`;

/** Validate + normalize args. Throws on invalid input; never on missing. */
function normalizeWaitArgs(args) {
    const a = args || {};
    const windowTitle = (typeof a.windowTitle === 'string' && a.windowTitle.trim()) ? a.windowTitle.trim() : null;
    const processName = (typeof a.processName === 'string' && a.processName.trim()) ? a.processName.trim() : null;
    if (!windowTitle && !processName) {
        throw new Error('wait_for requires either windowTitle or processName');
    }
    if (windowTitle && processName) {
        throw new Error('wait_for accepts only one of windowTitle or processName');
    }
    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(0, a.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    const pollMs = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, a.pollMs ?? DEFAULT_POLL_MS));
    const optional = a.optional === true;
    return { windowTitle, processName, timeoutMs, pollMs, optional };
}

/** Build the PowerShell script that polls until the condition is met. */
function buildWaitForScript({ windowTitle, processName, timeoutMs, pollMs }) {
    const config = {
        windowTitle: windowTitle || '',
        processName: processName || '',
        timeoutMs,
        pollMs,
    };
    // Embed as a single-quoted PS string (no interpolation inside it), with
    // the only special character that matters — a single quote — doubled.
    const configJson = JSON.stringify(config).replace(/'/g, "''");
    return `${PS_PRELUDE}
$cfg = ConvertFrom-Json '${configJson}'
$started = Get-Date
$deadline = $started.AddMilliseconds([int]$cfg.timeoutMs)
$found = $null
while ((Get-Date) -lt $deadline) {
    if ([string]$cfg.windowTitle) {
        $m = Get-WaitWindow -Needle ([string]$cfg.windowTitle)
        if ($m) { $found = $m; break }
    } else {
        $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -ieq ([string]$cfg.processName) } | Select-Object -First 1
        if ($p) { $found = $p.ProcessName; break }
    }
    Start-Sleep -Milliseconds ([int]$cfg.pollMs)
}
$elapsed = [int]((Get-Date) - $started).TotalMilliseconds
[pscustomobject]@{ found = ($null -ne $found); matched = [string]$found; elapsedMs = $elapsed; timeoutMs = [int]$cfg.timeoutMs } | ConvertTo-Json -Compress
`;
}

/** Parse the tool's stdout (JSON object, JSON string, or raw text) into a result. */
function parseWaitForOutput(stdout) {
    let obj = stdout;
    if (typeof obj === 'string') {
        const text = obj.trim();
        if (!text) return { found: false, matched: '', elapsedMs: 0, timeoutMs: 0 };
        try { obj = JSON.parse(text); } catch { return { found: false, matched: '', elapsedMs: 0, timeoutMs: 0, raw: text.slice(0, 200) }; }
    }
    if (!obj || typeof obj !== 'object') {
        return { found: false, matched: '', elapsedMs: 0, timeoutMs: 0 };
    }
    return {
        found: obj.found === true,
        matched: String(obj.matched || ''),
        elapsedMs: Number(obj.elapsedMs) || 0,
        timeoutMs: Number(obj.timeoutMs) || 0,
    };
}

const waitFor = {
    name: 'wait_for',
    category: 'system',
    description:
        'Poll for a condition before proceeding: either a visible window whose title ' +
        'contains windowTitle (case-insensitive substring), or a running process named ' +
        'processName. Returns as soon as the condition is true; throws if it never becomes ' +
        'true within timeoutMs (unless optional is true, in which case it just reports found:false). ' +
        'Use this instead of a fixed wait_ms before typing into a dialog or clicking a window ' +
        'that may not exist yet.',
    parameters: {
        type: 'object',
        properties: {
            windowTitle: {
                type: 'string',
                description: 'Substring matched against visible top-level window titles (case-insensitive). Matches dialogs and multi-window processes too, not just Get-Process main windows.',
            },
            processName: {
                type: 'string',
                description: 'Process name to wait for (e.g. "minecraft", "notepad"). Case-insensitive, exact match.',
            },
            timeoutMs: {
                type: 'integer',
                description: `Max time to wait, ms. Default ${DEFAULT_TIMEOUT_MS}, hard cap ${MAX_TIMEOUT_MS}.`,
            },
            pollMs: {
                type: 'integer',
                description: `How often to re-check the condition, ms. Default ${DEFAULT_POLL_MS}, range ${MIN_POLL_MS}-${MAX_POLL_MS}.`,
            },
            optional: {
                type: 'boolean',
                description: 'If true, a timeout is NOT treated as a failure — the step completes with found:false. Default false.',
            },
        },
    },
    async run(args, ctx) {
        const opts = normalizeWaitArgs(args);
        const script = buildWaitForScript(opts);
        const stdout = await runPsJsonFile(script, { timeoutMs: opts.timeoutMs + 15_000 });
        const result = parseWaitForOutput(stdout);
        if (!result.found && !opts.optional) {
            const target = opts.windowTitle
                ? `window title "${opts.windowTitle}"`
                : `process "${opts.processName}"`;
            throw new Error(`wait_for timed out after ${result.elapsedMs}ms: ${target} never appeared`);
        }
        return result;
    },
    async dryRun(args, ctx) {
        const opts = normalizeWaitArgs(args);
        return { dryRun: true, would: { tool: 'wait_for', args: opts } };
    },
};

module.exports = { waitFor, normalizeWaitArgs, buildWaitForScript, parseWaitForOutput };
