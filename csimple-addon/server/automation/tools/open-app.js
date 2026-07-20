/**
 * open_app — launch an application and WAIT for its main window to appear
 * before returning, then bring it to the foreground.
 *
 * Why this exists: `open_app` used to be a thin alias for
 * `shell_run { command: 'Start-Process "<name>"' }` (see tools/skill.js
 * _normaliseStep history). That returns as soon as the process is spawned,
 * with no guarantee the app has created a window yet. Macros that immediately
 * follow with key_tap/key_hold/click steps would send input to whatever
 * window currently had focus (often nothing useful), making the macro look
 * like it "did nothing" even though every step reported success. This tool
 * polls for the window instead of guessing a fixed wait_ms.
 */

const { spawn } = require('child_process');

const DEFAULT_WAIT_MS = 10_000;
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

function buildLaunchHintCandidates(name) {
    const raw = String(name || '').trim();
    if (!raw) return [];
    const out = [];
    const seen = new Set();
    const add = (v) => {
        const s = String(v || '').trim();
        if (!s || seen.has(s)) return;
        seen.add(s);
        out.push(s);
    };
    add(raw);
    const leaf = raw.split(/[\\/]/).pop();
    if (leaf && leaf !== raw) add(leaf);
    const noExt = (leaf || raw).replace(/\.exe$/i, '');
    const lowerNoExt = noExt.toLowerCase();
    if (lowerNoExt === 'minecraft' || lowerNoExt === 'minecraftlauncher') {
        add('Minecraft.exe');
        add('MinecraftLauncher.exe');
        add('minecraft://');
    }
    return out;
}

const NATIVE_PRELUDE = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Native {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
function Set-ForegroundWindowForce($hwnd) {
    # SetForegroundWindow silently no-ops when called from a background
    # process (this script) due to Windows' foreground-lock-timeout
    # heuristic -- the classic cause of the launched app's window never
    # actually receiving the input a macro sends right after open_app
    # (key taps look like they "did nothing", a held mouse button looks
    # like a stray click landing on whatever WAS focused instead). A
    # synthetic Alt press/release resets that lock; verify and retry.
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
`;

function runPsScript(script, { timeoutMs = 65_000 } = {}) {
    return new Promise((resolve, reject) => {
        // Same transport as tools/input.js: -EncodedCommand (UTF-16LE base64)
        // avoids the stdin-here-string quoting issues that used to silently
        // no-op these scripts.
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

const openApp = {
    name: 'open_app',
    category: 'system',
    description:
        'Launch an application by name/path and POLL for its main window to appear ' +
        '(instead of returning immediately like a raw Start-Process), then bring it to ' +
        'the foreground. Use this before any key/mouse steps that must target the app ' +
        '— it removes the need to guess a fixed wait_ms after launching.',
    parameters: {
        type: 'object',
        required: ['name'],
        properties: {
            name: {
                type: 'string',
                description: 'Executable name or path to launch (e.g. "notepad.exe", "C:\\\\Games\\\\Minecraft\\\\minecraft.exe"). ' +
                    'For Microsoft Store / UWP apps use the "shell:appsFolder\\<AppUserModelId>" form.',
            },
            args: { type: 'string', description: 'Optional command-line arguments passed to the launched process.' },
            windowTitleContains: {
                type: 'string',
                description: 'Substring to match against the launched window\'s title. If omitted, matches by process name derived from `name`.',
            },
            waitMs: {
                type: 'integer',
                description: `Max time to wait for the window to appear, ms. Default ${DEFAULT_WAIT_MS}, hard cap ${MAX_WAIT_MS}.`,
            },
            focus: { type: 'boolean', description: 'Bring the found window to the foreground once located. Default true.' },
        },
    },
    async run(args, ctx) {
        if (typeof args.name !== 'string' || !args.name.trim()) throw new Error('name is required');
        const name = args.name.replace(/"/g, '');
        const cmdArgs = String(args.args || '').replace(/"/g, '');
        const titleNeedle = String(args.windowTitleContains || '').replace(/"/g, '');
        const launchHints = buildLaunchHintCandidates(name);
        const launchHintsJson = JSON.stringify(launchHints).replace(/'/g, "''");
        const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, args.waitMs ?? DEFAULT_WAIT_MS));
        const doFocus = args.focus !== false;
        // Best-effort base name for process-name matching when no explicit
        // windowTitleContains is given (handles both "minecraft.exe" and a
        // full path like "C:\\Games\\Minecraft\\minecraft.exe").
        const baseName = name.split(/[\\/]/).pop().replace(/\.[a-zA-Z0-9]+$/, '').replace(/"/g, '');

        const script = `${NATIVE_PRELUDE}
$hints = @()
try {
    $hints = ConvertFrom-Json '${launchHintsJson}'
} catch { $hints = @("${name}") }
$launchCandidates = New-Object System.Collections.Generic.List[string]
function Add-Candidate([string]$v) {
    if ([string]::IsNullOrWhiteSpace($v)) { return }
    if (-not $launchCandidates.Contains($v)) { [void]$launchCandidates.Add($v) }
}
foreach ($h in $hints) { Add-Candidate "$h" }
$leaf = Split-Path "${name}" -Leaf
$isBareName = -not ("${name}" -match '[\\\\/]')
$windowsApps = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Microsoft\\WindowsApps' } else { $null }
if ($isBareName -and $leaf) {
    Add-Candidate $leaf
    if ($windowsApps) { Add-Candidate (Join-Path $windowsApps $leaf) }
    if ($leaf -notmatch '\\.exe$') {
        Add-Candidate "$leaf.exe"
        if ($windowsApps) { Add-Candidate (Join-Path $windowsApps "$leaf.exe") }
    }
    $appPathNames = New-Object System.Collections.Generic.List[string]
    [void]$appPathNames.Add($leaf)
    if ($leaf -notmatch '\\.exe$') { [void]$appPathNames.Add("$leaf.exe") }
    foreach ($root in @(
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths'
    )) {
        foreach ($n in $appPathNames) {
            $k = Join-Path $root $n
            if (Test-Path $k) {
                try {
                    $p = (Get-ItemProperty -Path $k -ErrorAction Stop).'(default)'
                    if ($p) { Add-Candidate $p }
                } catch {}
            }
        }
    }
}
$findWindow = {
    $wins = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' }
    $matches = $null
    if ("${titleNeedle}") {
        $matches = @($wins | Where-Object { $_.MainWindowTitle -like "*${titleNeedle}*" })
        if ("${baseName}".ToLower() -eq 'minecraft' -and $matches.Count -gt 1) {
            $nonLauncher = @($matches | Where-Object { $_.MainWindowTitle -notmatch 'Launcher' })
            if ($nonLauncher.Count -gt 0) { $matches = $nonLauncher }
        }
    } else {
        $matches = @($wins | Where-Object { $_.ProcessName -like "*${baseName}*" })
    }
    if ($matches.Count -eq 0) { return $null }
    $fg = [Native]::GetForegroundWindow()
    $fgMatch = $matches | Where-Object { $_.MainWindowHandle -eq $fg } | Select-Object -First 1
    if ($fgMatch) { return $fgMatch }
    return $matches | Sort-Object Id -Descending | Select-Object -First 1
}

$found = & $findWindow
$reusedExistingWindow = [bool]$found
$launched = $false
$launchError = $null
$launchedAs = $null
if (-not $found) {
    foreach ($candidate in $launchCandidates) {
        try {
            if ("${cmdArgs}") {
                Start-Process -FilePath $candidate -ArgumentList "${cmdArgs}" | Out-Null
            } else {
                Start-Process -FilePath $candidate | Out-Null
            }
            $launched = $true
            $launchedAs = $candidate
            break
        } catch {
            $launchError = $_.Exception.Message
        }
    }

    $deadline = (Get-Date).AddMilliseconds(${waitMs})
    while ((Get-Date) -lt $deadline) {
        $found = & $findWindow
        if ($found) { break }
        Start-Sleep -Milliseconds ${POLL_INTERVAL_MS}
    }
}

$focusConfirmed = $false
if ($found -and ${doFocus ? '$true' : '$false'}) {
    $focusConfirmed = Set-ForegroundWindowForce $found.MainWindowHandle
}

$out = @{
    launched = $launched
    reusedExistingWindow = $reusedExistingWindow
    launchedAs = $launchedAs
    launchError = $launchError
    triedCandidates = @($launchCandidates)
    windowFound = [bool]$found
    pid = $(if ($found) { $found.Id } else { $null })
    title = $(if ($found) { $found.MainWindowTitle } else { $null })
    focused = $(if ($found -and ${doFocus ? '$true' : '$false'}) { $true } else { $false })
    focusConfirmed = $focusConfirmed
}
$out | ConvertTo-Json -Compress
`;
        const out = await runPsScript(script, { timeoutMs: waitMs + 10_000 });
        let parsed;
        try { parsed = JSON.parse(out); } catch { parsed = { raw: out }; }
        if (parsed && parsed.launched === false && parsed.reusedExistingWindow !== true) {
            const tried = Array.isArray(parsed.triedCandidates) && parsed.triedCandidates.length
                ? ` (tried: ${parsed.triedCandidates.join(', ')})`
                : '';
            throw new Error(`failed to launch "${name}": ${parsed.launchError || 'unknown error'}${tried}`);
        }
        try { ctx?.addAction?.({ tool: 'open_app', args, result: parsed }); } catch {}
        return parsed;
    },
    async dryRun(args) {
        return {
            dryRun: true,
            would: {
                launch: args.name,
                args: args.args || null,
                waitForWindow: args.windowTitleContains || '(process-name match)',
                waitMs: Math.min(MAX_WAIT_MS, args.waitMs ?? DEFAULT_WAIT_MS),
                focus: args.focus !== false,
            },
        };
    },
};

module.exports = { openApp, buildLaunchHintCandidates };
