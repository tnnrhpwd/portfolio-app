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

const NATIVE_PRELUDE = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Native {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
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
        const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, args.waitMs ?? DEFAULT_WAIT_MS));
        const doFocus = args.focus !== false;
        // Best-effort base name for process-name matching when no explicit
        // windowTitleContains is given (handles both "minecraft.exe" and a
        // full path like "C:\\Games\\Minecraft\\minecraft.exe").
        const baseName = name.split(/[\\/]/).pop().replace(/\.[a-zA-Z0-9]+$/, '').replace(/"/g, '');

        const script = `${NATIVE_PRELUDE}
$launched = $true
$launchError = $null
try {
    if ("${cmdArgs}") {
        Start-Process -FilePath "${name}" -ArgumentList "${cmdArgs}" | Out-Null
    } else {
        Start-Process -FilePath "${name}" | Out-Null
    }
} catch {
    $launched = $false
    $launchError = $_.Exception.Message
}

$deadline = (Get-Date).AddMilliseconds(${waitMs})
$found = $null
while ((Get-Date) -lt $deadline) {
    $candidates = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' }
    if ("${titleNeedle}") {
        $found = $candidates | Where-Object { $_.MainWindowTitle -like "*${titleNeedle}*" } | Select-Object -First 1
    } else {
        $found = $candidates | Where-Object { $_.ProcessName -like "*${baseName}*" } | Select-Object -First 1
    }
    if ($found) { break }
    Start-Sleep -Milliseconds ${POLL_INTERVAL_MS}
}

if ($found -and ${doFocus ? '$true' : '$false'}) {
    [Native]::ShowWindowAsync($found.MainWindowHandle, 9) | Out-Null
    Start-Sleep -Milliseconds 80
    [Native]::SetForegroundWindow($found.MainWindowHandle) | Out-Null
}

$out = @{
    launched = $launched
    launchError = $launchError
    windowFound = [bool]$found
    pid = $(if ($found) { $found.Id } else { $null })
    title = $(if ($found) { $found.MainWindowTitle } else { $null })
    focused = $(if ($found -and ${doFocus ? '$true' : '$false'}) { $true } else { $false })
}
$out | ConvertTo-Json -Compress
`;
        const out = await runPsScript(script, { timeoutMs: waitMs + 10_000 });
        let parsed;
        try { parsed = JSON.parse(out); } catch { parsed = { raw: out }; }
        if (parsed && parsed.launched === false) {
            throw new Error(`failed to launch "${name}": ${parsed.launchError || 'unknown error'}`);
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

module.exports = { openApp };
