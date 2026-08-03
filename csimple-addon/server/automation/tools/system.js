/**
 * Windows + process + clipboard tools.
 *
 * Implemented via tiny inline PowerShell snippets. Each snippet emits JSON to
 * stdout (ConvertTo-Json) so we can parse without screen-scraping.
 */

const { spawn } = require('child_process');

const PS_TIMEOUT = 15_000;

// Absolute path to powershell.exe so we don't depend on the spawned process's
// PATH inheritance (Electron subprocesses sometimes trim PATH on Windows).
const PS_EXE = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe';

function runPs(script) {
    return new Promise((resolve, reject) => {
        // Transport: -EncodedCommand (UTF-16LE base64). The `-Command -` stdin
        // approach used previously was unreliable — the child would parse the
        // script but exit before executing, producing empty output.
        const encoded = Buffer.from(String(script), 'utf16le').toString('base64');
        const child = spawn(PS_EXE, [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-EncodedCommand', encoded,
        ], { windowsHide: true });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d.toString('utf-8'));
        child.stderr.on('data', d => stderr += d.toString('utf-8'));
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, PS_TIMEOUT);
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(stderr.trim() || `powershell exited with ${code}`));
            resolve(stdout);
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
    });
}

async function runPsJson(script) {
    const out = await runPs(script);
    try { return JSON.parse(out); }
    catch { return out.trim(); }
}

// Shared P-Invoke prelude for reading/writing a window's WINDOWPLACEMENT
// (position + size + minimized/maximized/normal state). Used by both
// windowSnapshot (capture) and windowSetRect (restore) so the two always
// agree on what "the window's position" means — see windowSetRect for why
// this replaced a plain GetWindowRect/SetWindowPos pair.
const WIN_PLACEMENT_PRELUDE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinPlacement {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT {
        public int length; public int flags; public int showCmd;
        public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition;
    }
    [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
    [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@
# Per-Monitor-V2 DPI awareness (-4) keeps captured/applied coordinates
# consistent across monitors with different scaling. Best-effort: older
# Windows builds may not support this context value.
try { [WinPlacement]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
`;

// ──────────────────────────────────────────────────────────────────────────────

const windowList = {
    name: 'window_list',
    category: 'safe-read',
    description: 'List visible top-level windows with their owning process and title.',
    parameters: { type: 'object', properties: { titleContains: { type: 'string' } } },
    async run(args) {
        const filter = (args.titleContains || '').replace(/'/g, "''");
        const script = `
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' }
${filter ? `$procs = $procs | Where-Object { $_.MainWindowTitle -like '*${filter}*' }` : ''}
$procs | ForEach-Object { [pscustomobject]@{ pid = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle } } | ConvertTo-Json -Compress -Depth 3
        `.trim();
        const result = await runPsJson(script);
        const arr = Array.isArray(result) ? result : (result ? [result] : []);
        return { count: arr.length, windows: arr };
    },
};

const windowFocus = {
    name: 'window_focus',
    category: 'system',
    description: 'Bring a window to the foreground. Match by pid, processName, or titleContains (case-insensitive substring). titleContains is what the skill compiler emits.',
    parameters: {
        type: 'object',
        properties: {
            pid: { type: 'integer' },
            processName: { type: 'string' },
            titleContains: { type: 'string', description: 'Case-insensitive substring matched against MainWindowTitle.' },
        },
    },
    async run(args) {
        // Selector precedence: pid > titleContains > processName. titleContains
        // is the field the skill-recorder compiler emits (window titles are
        // more identifying than process names for browsers/editors that share
        // one host process across many docs).
        let sel;
        if (args.pid) {
            sel = `Get-Process -Id ${parseInt(args.pid, 10)}`;
        } else if (args.titleContains) {
            const needle = String(args.titleContains).replace(/'/g, "''");
            sel = `Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*${needle}*' } | Select-Object -First 1`;
        } else if (args.processName) {
            sel = `Get-Process -Name '${String(args.processName).replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`;
        } else {
            throw new Error('window_focus: provide pid, processName, or titleContains');
        }
        const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
}
"@
$p = ${sel}
if (-not $p) { Write-Error 'window not found'; exit 1 }
[W]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null  # 9 = SW_RESTORE
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
[pscustomobject]@{ pid = $p.Id; name = $p.ProcessName; title = $p.MainWindowTitle } | ConvertTo-Json -Compress
        `.trim();
        return await runPsJson(script);
    },
};

const windowSnapshot = {
    name: 'window_snapshot',
    category: 'safe-read',
    description: 'Capture every visible top-level window\'s position, size, and show state (normal/minimized/maximized) — used to save a "workspace" layout that can be restored later.',
    parameters: { type: 'object', properties: {} },
    async run() {
        const script = `
${WIN_PLACEMENT_PRELUDE}
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' }
$out = @()
foreach ($p in $procs) {
    $wp = New-Object WinPlacement+WINDOWPLACEMENT
    $wp.length = [System.Runtime.InteropServices.Marshal]::SizeOf($wp)
    $ok = [WinPlacement]::GetWindowPlacement($p.MainWindowHandle, [ref]$wp)
    if (-not $ok) { continue }
    $exePath = $null
    try { $exePath = $p.Path } catch {}
    $state = switch ($wp.showCmd) { 2 { 'minimized' } 3 { 'maximized' } default { 'normal' } }
    # rcNormalPosition is the window's RESTORED bounds — the position/size it
    # returns to when un-minimized/un-maximized. Capturing this (instead of
    # GetWindowRect's CURRENT bounds, which for a maximized window are just
    # the whole monitor) is what lets a later restore put a maximized window
    # back correctly sized on the correct monitor once un-maximized.
    $rect = $wp.rcNormalPosition
    $out += [pscustomobject]@{
        pid = $p.Id
        processName = $p.ProcessName
        exePath = $exePath
        title = $p.MainWindowTitle
        x = $rect.Left
        y = $rect.Top
        width = ($rect.Right - $rect.Left)
        height = ($rect.Bottom - $rect.Top)
        state = $state
    }
}
$out | ConvertTo-Json -Compress -Depth 4
        `.trim();
        const result = await runPsJson(script);
        const arr = Array.isArray(result) ? result : (result ? [result] : []);
        return { count: arr.length, windows: arr };
    },
};

const windowSetRect = {
    name: 'window_set_rect',
    category: 'system',
    description: 'Move/resize a window and set its show state (normal/minimized/maximized). Match the window by pid, titleContains, or processName (same precedence as window_focus).',
    parameters: {
        type: 'object',
        properties: {
            pid: { type: 'integer' },
            processName: { type: 'string' },
            titleContains: { type: 'string' },
            x: { type: 'integer' },
            y: { type: 'integer' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            state: { type: 'string', description: '"normal" | "minimized" | "maximized"' },
        },
    },
    async run(args) {
        let sel;
        if (args.pid) {
            sel = `Get-Process -Id ${parseInt(args.pid, 10)} -ErrorAction SilentlyContinue`;
        } else if (args.titleContains) {
            const needle = String(args.titleContains).replace(/'/g, "''");
            sel = `Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*${needle}*' } | Select-Object -First 1`;
        } else if (args.processName) {
            sel = `Get-Process -Name '${String(args.processName).replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`;
        } else {
            throw new Error('window_set_rect: provide pid, processName, or titleContains');
        }
        const x = Number.isFinite(args.x) ? Math.round(args.x) : 0;
        const y = Number.isFinite(args.y) ? Math.round(args.y) : 0;
        const width = Number.isFinite(args.width) ? Math.round(args.width) : 800;
        const height = Number.isFinite(args.height) ? Math.round(args.height) : 600;
        const state = String(args.state || 'normal').toLowerCase();
        // SW_SHOWMINIMIZED=2, SW_SHOWMAXIMIZED=3, SW_SHOWNORMAL=1
        const showCmd = state === 'minimized' ? 2 : state === 'maximized' ? 3 : 1;
        const script = `
${WIN_PLACEMENT_PRELUDE}
$p = ${sel}
if (-not $p) { Write-Error 'window not found'; exit 1 }
$h = $p.MainWindowHandle
$wp = New-Object WinPlacement+WINDOWPLACEMENT
$wp.length = [System.Runtime.InteropServices.Marshal]::SizeOf($wp)
[WinPlacement]::GetWindowPlacement($h, [ref]$wp) | Out-Null
# SetWindowPos alone does not reliably move a minimized/maximized window, and
# moving a maximized window's rect has no visible effect until it's
# un-maximized — this was the root cause of restored windows landing in the
# wrong place. SetWindowPlacement instead applies the target "restored" rect
# (rcNormalPosition) AND the show command atomically in one call, so a
# window that was maximized on a given monitor comes back maximized there,
# not stuck wherever SetWindowPos happened to leave it.
$wp.showCmd = ${showCmd}
$rect = New-Object WinPlacement+RECT
$rect.Left = ${x}
$rect.Top = ${y}
$rect.Right = ${x} + ${width}
$rect.Bottom = ${y} + ${height}
$wp.rcNormalPosition = $rect
[WinPlacement]::SetWindowPlacement($h, [ref]$wp) | Out-Null
[pscustomobject]@{ pid = $p.Id; name = $p.ProcessName; title = $p.MainWindowTitle } | ConvertTo-Json -Compress
        `.trim();
        return await runPsJson(script);
    },
};

const processList = {
    name: 'process_list',
    category: 'safe-read',
    description: 'List running processes (pid, name, cpu, memory).',
    parameters: { type: 'object', properties: { nameContains: { type: 'string' }, top: { type: 'integer', description: 'limit results' } } },
    async run(args) {
        const filter = (args.nameContains || '').replace(/'/g, "''");
        const top = Math.min(500, Math.max(1, Number(args.top) || 100));
        const script = `
$ps = Get-Process ${filter ? `| Where-Object { $_.ProcessName -like '*${filter}*' }` : ''} | Sort-Object -Property WS -Descending | Select-Object -First ${top}
$ps | ForEach-Object { [pscustomobject]@{ pid=$_.Id; name=$_.ProcessName; ws=$_.WS; cpu=$_.CPU } } | ConvertTo-Json -Compress -Depth 3
        `.trim();
        const result = await runPsJson(script);
        const arr = Array.isArray(result) ? result : (result ? [result] : []);
        return { count: arr.length, processes: arr };
    },
};

const processKill = {
    name: 'process_kill',
    category: 'destructive',
    description: 'Terminate a process by PID. Use with caution.',
    parameters: { type: 'object', properties: { pid: { type: 'integer' }, force: { type: 'boolean' } }, required: ['pid'] },
    async run(args) {
        const pid = parseInt(args.pid, 10);
        if (!pid || pid < 4) throw new Error('refusing to kill pid < 4');
        const script = `Stop-Process -Id ${pid} ${args.force ? '-Force' : ''} -ErrorAction Stop; '{ "ok": true }'`;
        const out = await runPs(script);
        return { pid, killed: true, out: out.trim() };
    },
    async dryRun(args) { return { wouldKill: parseInt(args.pid, 10) }; },
};

const clipboardRead = {
    name: 'clipboard_read',
    category: 'safe-read',
    description: 'Read the current Windows clipboard text contents.',
    parameters: { type: 'object', properties: {} },
    async run() {
        const out = await runPs('Get-Clipboard -Raw');
        return { text: out.replace(/\r?\n$/, ''), length: out.length };
    },
};

const clipboardWrite = {
    name: 'clipboard_write',
    category: 'sandboxed-write',
    description: 'Write text to the Windows clipboard.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async run(args) {
        const text = String(args.text || '');
        if (text.length > 1024 * 1024) throw new Error('text too large');
        // Use here-string with delimiter unlikely to appear in user content.
        const b64 = Buffer.from(text, 'utf-8').toString('base64');
        const script = `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | Set-Clipboard`;
        await runPs(script);
        return { bytes: Buffer.byteLength(text, 'utf-8') };
    },
};

module.exports = { windowList, windowFocus, windowSnapshot, windowSetRect, processList, processKill, clipboardRead, clipboardWrite };
