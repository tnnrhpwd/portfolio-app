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
        //
        // Strip full-line PowerShell comments (and the blank lines around
        // them) before encoding — spawn on Windows has a hard command-line
        // length ceiling (~32K chars), and these scripts share a large,
        // heavily-documented prelude (WIN_PLACEMENT_PRELUDE) that easily
        // pushes the base64-encoded command over that limit once enough
        // explanatory comments accumulate. That's not hypothetical: it's
        // exactly how window_set_rect started silently failing with
        // "spawn ENAMETOOLONG" for every call after a comment-heavy prelude
        // addition — no error surfaced in the UI, it just looked like
        // windows stopped moving at all. Comments only document the *source*
        // — stripping them here doesn't change what actually executes.
        const stripped = stripPsComments(String(script));
        const encoded = Buffer.from(stripped, 'utf16le').toString('base64');
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
            if (code !== 0) return reject(new Error(parseCliXmlError(stderr.trim()) || `powershell exited with ${code}`));
            resolve(stdout);
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
    });
}

// Windows PowerShell (powershell.exe, unlike pwsh) serializes the *error*
// stream as CLIXML whenever stderr isn't an interactive console — which is
// always true here since it's redirected to a pipe for spawn() to capture.
// That means every `Write-Error` (used throughout these scripts for
// "not found"-style failures, e.g. window_focus when no window matches)
// surfaces as a multi-KB "#< CLIXML ..." blob instead of the actual message
// — this is exactly what turned "window not found" into an unreadable dump
// in the skill-run failure UI. Unwrap it back to plain text so callers (and
// the skill-run failedStep.error shown to users) get the real message.
function parseCliXmlError(stderr) {
    if (typeof stderr !== 'string' || !stderr.startsWith('#< CLIXML')) return stderr;
    // CLIXML line-wraps each error record across many `<S S="Error">` chunks
    // purely for XML readability — concatenate them back into one string
    // before decoding, then decode the `_xHHHH_` char escapes it uses in
    // place of literal control characters (notably `_x000D__x000A_` = \r\n).
    const raw = [...stderr.matchAll(/<S S="Error">([^<]*)<\/S>/g)].map(m => m[1]).join('');
    if (!raw) return stderr;
    const decoded = raw.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const lines = decoded.split(/\r\n/);
    // The actual error message is the line immediately before the
    // "+ CategoryInfo" boilerplate; everything before it may be the entire
    // source script (PowerShell reports the whole invocation as "the line"
    // when there's no separate script file to attribute a line number to).
    const catIdx = lines.findIndex(l => l.trim().startsWith('+ CategoryInfo'));
    let message = catIdx > 0 ? lines[catIdx - 1] : lines[0];
    const sepIdx = message.lastIndexOf(' : ');
    if (sepIdx !== -1) message = message.slice(sepIdx + 3);
    message = message.trim();
    return message || decoded.trim().slice(0, 500);
}

// Removes full-line `#`-comments (and the resulting blank lines) from a
// PowerShell script before it's shipped to the child process. Only strips
// lines whose FIRST non-whitespace character is `#` — never trailing/inline
// comments — so nothing inside a string, here-string, or the embedded C#
// Add-Type block (which uses `//`, never a line-leading `#`) can ever be
// mistaken for a comment and stripped.
function stripPsComments(script) {
    return script
        .split('\n')
        .filter(line => !/^\s*#/.test(line))
        .join('\n');
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
using System.Text;
public static class WinPlacement {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT {
        public int length; public int flags; public int showCmd;
        public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition;
    }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
    [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
# Per-Monitor-V2 DPI awareness (-4) keeps captured/applied coordinates
# consistent across monitors with different scaling. Best-effort: older
# Windows builds may not support this context value.
try { [WinPlacement]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}

# Full virtual-desktop bounds (spans every monitor), used by
# Test-CoversVirtualScreen below. SM_XVIRTUALSCREEN=76, SM_YVIRTUALSCREEN=77,
# SM_CXVIRTUALSCREEN=78, SM_CYVIRTUALSCREEN=79.
$script:VScreenLeft = [WinPlacement]::GetSystemMetrics(76)
$script:VScreenTop = [WinPlacement]::GetSystemMetrics(77)
$script:VScreenWidth = [WinPlacement]::GetSystemMetrics(78)
$script:VScreenHeight = [WinPlacement]::GetSystemMetrics(79)

# DWMWA_CLOAKED (14): true for windows Windows itself keeps invisible even
# though they still report a non-zero MainWindowHandle and a non-empty
# title — e.g. the UWP "ApplicationFrameHost" proxy frame / its hosted app
# pane (SystemSettings, etc.), ShellExperienceHost (Action Center / Start /
# widgets host), and TextInputHost (touch keyboard / IME host). These are
# NOT real user windows: forcing SetWindowPlacement on them (show/move/
# resize a window the shell intentionally hides) desyncs the UWP frame from
# its hosted pane and can destabilize the shell itself, taking down
# everything on screen — this was the actual cause of "restore crashed all
# open programs" even though the saved layout hadn't changed. Skip them.
function Test-WindowCloaked([IntPtr]$hwnd) {
    $cloaked = 0
    [void][WinPlacement]::DwmGetWindowAttribute($hwnd, 14, [ref]$cloaked, 4)
    return $cloaked -ne 0
}
# A window reporting show state "normal" (i.e. NOT maximized) whose restored
# rect (rcNormalPosition) nonetheless covers the entire multi-monitor
# virtual desktop is not a real user window — a genuinely maximized app
# reports state "maximized" and its rcNormalPosition is the pre-maximize
# size, not the full screen. This pattern instead matches desktop-level
# background hosts (live-wallpaper engines like Bing Wallpaper/Wallpaper
# Engine/Lively, parented behind the desktop icons via WorkerW). Forcing
# SetWindowPlacement on one of these was observed to hang/destabilize the
# app performing the restore (Simple Addon itself went unresponsive and
# vanished from Alt-Tab) even though Explorer itself stayed up. Skip them.
function Test-CoversVirtualScreen([int]$left, [int]$top, [int]$width, [int]$height, [string]$state) {
    if ($state -eq 'maximized') { return $false }
    return ($width -ge $script:VScreenWidth -and $height -ge $script:VScreenHeight)
}
# Repositioning the CURRENTLY FOCUSED window via SetWindowPlacement has been
# the common thread across every observed hang so far: Electron/Chromium
# apps with a custom frameless titlebar (VS Code, Simple Addon itself)
# going unresponsive and vanishing from Alt-Tab specifically when they were
# the active/foreground window at the moment a placement change landed —
# even in a run where every OTHER window was a same-position no-op. An
# app's own window procedure re-synchronizing its custom non-client area /
# GPU-compositor frame after a programmatic (not user-drag) resize appears
# far more prone to wedging while it also owns keyboard/input focus. Shift
# focus to the desktop shell window first — a plain, always-responsive
# native Win32 window with no custom message handling — so the resize
# arrives while the target is no longer the focused/foreground window.
#
# A single unverified SetForegroundWindow(shell) call is not reliable
# enough: Windows silently no-ops SetForegroundWindow calls from a
# background process (this script) due to its foreground-lock-timeout
# heuristic — the same limitation documented and worked around in
# open-app.js's Set-ForegroundWindowForce. When that silent no-op happens
# here, the target window never actually loses focus, so the placement
# request that follows can be ignored/dropped by the target instead of
# applied — this was traced to be the actual cause of a focused VS Code
# window not moving at all on restore (no crash, no repositioning, and no
# error — SetWindowPlacement's return value doesn't reflect whether the
# target's message loop honored it). Use the same AttachThreadInput +
# retry technique proven there, adapted to move focus AWAY from $hwnd
# rather than TO a specific window, and verify it actually left foreground
# before proceeding.
function Move-FocusAwayIfForeground([IntPtr]$hwnd) {
    if ([WinPlacement]::GetForegroundWindow() -ne $hwnd) { return }
    $shell = [WinPlacement]::GetShellWindow()
    if ($shell -eq [IntPtr]::Zero) { return }
    $curThread = [WinPlacement]::GetCurrentThreadId()
    $targetProcId = 0
    $targetThread = [WinPlacement]::GetWindowThreadProcessId($hwnd, [ref]$targetProcId)
    $attached = $false
    if ($targetThread -ne 0 -and $targetThread -ne $curThread) {
        $attached = [WinPlacement]::AttachThreadInput($curThread, $targetThread, $true)
    }
    try {
        for ($i = 0; $i -lt 8; $i++) {
            if ([WinPlacement]::GetForegroundWindow() -ne $hwnd) { break }
            [WinPlacement]::keybd_event(0x12, 0, 0x0000, [UIntPtr]::Zero)  # Alt down
            [WinPlacement]::keybd_event(0x12, 0, 0x0002, [UIntPtr]::Zero)  # Alt up
            [WinPlacement]::BringWindowToTop($shell) | Out-Null
            [void][WinPlacement]::SetForegroundWindow($shell)
            Start-Sleep -Milliseconds 60
        }
    } finally {
        if ($attached) { [WinPlacement]::AttachThreadInput($curThread, $targetThread, $false) | Out-Null }
    }
    # Give the target's message loop a moment to actually process the
    # focus-loss notification before the caller posts a placement change.
    if ([WinPlacement]::GetForegroundWindow() -ne $hwnd) { Start-Sleep -Milliseconds 60 }
}
# Polls the read-only GetWindowPlacement (answered by the window manager,
# never sent into the target's own queue, so safe regardless of what that
# thread is doing) until showCmd matches what ShowWindowAsync was just
# asked to apply, or maxMs elapses.
function Wait-ForShowState([IntPtr]$hwnd, [int]$wantShowCmd, [int]$maxMs) {
    $deadline = (Get-Date).AddMilliseconds($maxMs)
    while ((Get-Date) -lt $deadline) {
        $chk = New-Object WinPlacement+WINDOWPLACEMENT
        $chk.length = [System.Runtime.InteropServices.Marshal]::SizeOf($chk)
        [void][WinPlacement]::GetWindowPlacement($hwnd, [ref]$chk)
        if ($chk.showCmd -eq $wantShowCmd) { return $true }
        Start-Sleep -Milliseconds 30
    }
    return $false
}
# True when two rects share any area at all (touching edges with zero
# overlap width/height still count as NOT overlapping).
function Test-RectsOverlap([int]$aL, [int]$aT, [int]$aR, [int]$aB, [int]$bL, [int]$bT, [int]$bR, [int]$bB) {
    return ($aL -lt $bR -and $aR -gt $bL -and $aT -lt $bB -and $aB -gt $bT)
}
# SetWindowPlacement's rcNormalPosition is documented as "workspace
# coordinates" -- in practice this means Windows resolves/clamps the target
# rect relative to whichever monitor the window CURRENTLY overlaps, not
# whichever monitor the target rect falls on. Asking to move a window
# straight to a rect on a monitor it doesn't currently touch at all is the
# exact case that gets silently reinterpreted/clamped back onto the
# window's current monitor instead of actually moving it -- this is what
# was reported as "restore puts every window on one monitor" on a 3-monitor
# setup. SetWindowPos doesn't have this quirk (it always uses real,
# absolute virtual-desktop screen coordinates), so priming the move with a
# same-size SetWindowPos call that gets at least part of the window
# touching the destination monitor first "teaches" Windows which monitor
# the window belongs to -- only then does a following SetWindowPlacement
# resize resolve its workspace coordinates against the correct monitor.
# Skipped entirely for moves that already overlap their current position
# (same-monitor moves, which SetWindowPlacement has always handled fine) to
# avoid an unnecessary extra step/flicker in the common case.
# SWP_NOZORDER=0x0004, SWP_NOACTIVATE=0x0010, SWP_ASYNCWINDOWPOS=0x4000.
function Move-ToMonitorIfNeeded([IntPtr]$hwnd, [int]$targetX, [int]$targetY, [int]$targetW, [int]$targetH) {
    $cur = New-Object WinPlacement+WINDOWPLACEMENT
    $cur.length = [System.Runtime.InteropServices.Marshal]::SizeOf($cur)
    [void][WinPlacement]::GetWindowPlacement($hwnd, [ref]$cur)
    $r = $cur.rcNormalPosition
    if (Test-RectsOverlap $r.Left $r.Top $r.Right $r.Bottom $targetX $targetY ($targetX + $targetW) ($targetY + $targetH)) { return }
    [void][WinPlacement]::SetWindowPos($hwnd, [IntPtr]::Zero, $targetX, $targetY, ($r.Right - $r.Left), ($r.Bottom - $r.Top), 0x4014)
    Start-Sleep -Milliseconds 120
}
# Belt-and-suspenders denylist for well-known shell/system host processes
# and desktop/wallpaper hosts that shouldn't ever be treated as restorable
# app windows, even in the rare case DWM briefly reports them as not
# cloaked (e.g. mid-animation).
$script:ShellHostDenylist = @(
    'ShellExperienceHost', 'ApplicationFrameHost', 'TextInputHost',
    'SearchHost', 'StartMenuExperienceHost', 'ShellHost', 'BingWallpaper',
    'msedgewebview2'
)
# Never touch Simple Addon's own windows (e.g. the "Save New Workspace"
# prompt) with SetWindowPlacement. This code runs inside the Electron main
# process, which owns the native HWND for every BrowserWindow it creates —
# so $script:OwnPid below is exactly the pid to exclude. Applying an
# out-of-band win32 placement change to our own window desyncs Electron's
# internal visible/focused state from the OS's, which can leave the window
# permanently invisible (not in Alt-Tab, un-recoverable via tray/show())
# until the whole app is killed and relaunched — this was the second crash
# reproduction (Explorer survived; Simple Addon's own window vanished).
$script:OwnPid = ${process.pid}
# Get-Process's MainWindowHandle/MainWindowTitle exposes only ONE window per
# process. That's harmless for the common case of one top-level window per
# process, but silently wrong for a process that owns several — most
# notably explorer.exe, which every File Explorer folder window normally
# shares (a new Start-Process explorer.exe reuses the existing process
# instead of spawning a new one). Which single window Get-Process surfaces
# for a multi-window process is an internal OS heuristic, not necessarily
# the one a titleContains match means — this is exactly why window_focus
# reported "window not found" for an Explorer window that was plainly open
# on screen: the needle matched that window's title, but Get-Process's
# MainWindowTitle for the shared explorer.exe pid was some OTHER Explorer
# window's title (or none of them). EnumWindows walks every top-level
# window regardless of how many share an owning process, in Z-order
# (topmost first), so matching against this list finds the right window
# even when several live under one pid, and ties resolve to whichever is
# nearest the front.
function Get-CandidateWindows {
    $procNames = @{}
    Get-Process | ForEach-Object { $procNames[[int]$_.Id] = $_.ProcessName }
    $list = New-Object System.Collections.Generic.List[object]
    $callback = [WinPlacement+EnumWindowsProc]{
        param([IntPtr]$hwnd, [IntPtr]$lparam)
        if (-not [WinPlacement]::IsWindowVisible($hwnd)) { return $true }
        $len = [WinPlacement]::GetWindowTextLength($hwnd)
        if ($len -le 0) { return $true }
        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [void][WinPlacement]::GetWindowText($hwnd, $sb, $sb.Capacity)
        $title = $sb.ToString()
        if (-not $title) { return $true }
        # GetWindowThreadProcessId's [ref] out-param forces $rawProcId to be
        # declared [uint32] — and PowerShell's [type]$var = value syntax
        # doesn't just set an initial type, it PINS that variable to the
        # type for the rest of its scope, silently re-coercing every later
        # assignment back to it. Reassigning $rawProcId itself to an int
        # (instead of assigning into a separate variable) would get
        # silently re-coerced right back to UInt32 by that pin — then a
        # UInt32 key looked up against $procNames' Int32 keys never
        # matches (different boxed type, so Equals/GetHashCode disagree),
        # so EVERY window in the list would get skipped as "no matching
        # process name" even though the pid is right there. Cast into a
        # separate, plain (untyped) variable instead so it's a genuine
        # Int32 usable as a hashtable key.
        [uint32]$rawProcId = 0
        [void][WinPlacement]::GetWindowThreadProcessId($hwnd, [ref]$rawProcId)
        $procId = [int]$rawProcId
        if ($procId -eq $script:OwnPid) { return $true }
        $name = $procNames[$procId]
        if (-not $name -or $name -in $script:ShellHostDenylist) { return $true }
        if (Test-WindowCloaked $hwnd) { return $true }
        $list.Add([pscustomobject]@{ Hwnd = $hwnd; Pid = $procId; ProcessName = $name; Title = $title })
        return $true
    }
    [void][WinPlacement]::EnumWindows($callback, [IntPtr]::Zero)
    return $list
}
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
${WIN_PLACEMENT_PRELUDE}
$wins = Get-CandidateWindows
${filter ? `$wins = $wins | Where-Object { $_.Title -like '*${filter}*' }` : ''}
$wins | ForEach-Object { [pscustomobject]@{ pid = $_.Pid; name = $_.ProcessName; title = $_.Title } } | ConvertTo-Json -Compress -Depth 3
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
        let filterExpr;
        if (args.pid) {
            const pid = parseInt(args.pid, 10);
            filterExpr = `$wins | Where-Object { $_.Pid -eq ${pid} } | Select-Object -First 1`;
        } else if (args.titleContains) {
            const needle = String(args.titleContains).replace(/'/g, "''");
            filterExpr = `$wins | Where-Object { $_.Title -like '*${needle}*' } | Select-Object -First 1`;
        } else if (args.processName) {
            const name = String(args.processName).replace(/'/g, "''");
            filterExpr = `$wins | Where-Object { $_.ProcessName -eq '${name}' } | Select-Object -First 1`;
        } else {
            throw new Error('window_focus: provide pid, processName, or titleContains');
        }
        const script = `
${WIN_PLACEMENT_PRELUDE}
$wins = Get-CandidateWindows
$p = ${filterExpr}
if (-not $p) { Write-Error 'window not found'; exit 1 }
[WinPlacement]::ShowWindowAsync($p.Hwnd, 9) | Out-Null  # 9 = SW_RESTORE
[WinPlacement]::SetForegroundWindow($p.Hwnd) | Out-Null
[pscustomobject]@{ pid = $p.Pid; name = $p.ProcessName; title = $p.Title } | ConvertTo-Json -Compress
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
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' -and $_.ProcessName -notin $script:ShellHostDenylist -and $_.Id -ne $script:OwnPid }
# Command lines distinguish two windows of the SAME exe launched with
# different arguments -- e.g. two "Code.exe" windows each opened against a
# different folder (a normal VS Code project vs. an unrelated one that just
# happens to also be a VS Code window). exePath/processName alone can't tell
# those apart, so save()/restore() use this to relaunch the right target
# instead of a bare, argument-less relaunch that reopens whatever VS Code
# feels like (usually just the last-used window). One bulk CIM query instead
# of one-per-window keeps this cheap regardless of window count.
$cmdLineMap = @{}
try {
    Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { $cmdLineMap[[int]$_.ProcessId] = $_.CommandLine }
} catch {}
$out = @()
foreach ($p in $procs) {
    # Skip windows the shell itself keeps invisible (see Test-WindowCloaked
    # above) — these are never real, restorable app windows.
    if (Test-WindowCloaked $p.MainWindowHandle) { continue }
    $wp = New-Object WinPlacement+WINDOWPLACEMENT
    $wp.length = [System.Runtime.InteropServices.Marshal]::SizeOf($wp)
    $ok = [WinPlacement]::GetWindowPlacement($p.MainWindowHandle, [ref]$wp)
    if (-not $ok) { continue }
    $exePath = $null
    try { $exePath = $p.Path } catch {}
    $commandLine = $null
    if ($cmdLineMap.ContainsKey([int]$p.Id)) { $commandLine = $cmdLineMap[[int]$p.Id] }
    $state = switch ($wp.showCmd) { 2 { 'minimized' } 3 { 'maximized' } default { 'normal' } }
    # rcNormalPosition is the window's RESTORED bounds — the position/size it
    # returns to when un-minimized/un-maximized. Capturing this (instead of
    # GetWindowRect's CURRENT bounds, which for a maximized window are just
    # the whole monitor) is what lets a later restore put a maximized window
    # back correctly sized on the correct monitor once un-maximized.
    $rect = $wp.rcNormalPosition
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    # Skip desktop-level background hosts (live-wallpaper engines, widget
    # boards) masquerading as a "normal" window the size of the whole
    # multi-monitor desktop — see Test-CoversVirtualScreen above.
    if (Test-CoversVirtualScreen $rect.Left $rect.Top $w $h $state) { continue }
    $out += [pscustomobject]@{
        pid = $p.Id
        processName = $p.ProcessName
        exePath = $exePath
        commandLine = $commandLine
        title = $p.MainWindowTitle
        x = $rect.Left
        y = $rect.Top
        width = $w
        height = $h
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
        let filterExpr;
        if (args.pid) {
            const pid = parseInt(args.pid, 10);
            filterExpr = `$wins | Where-Object { $_.Pid -eq ${pid} } | Select-Object -First 1`;
        } else if (args.titleContains) {
            const needle = String(args.titleContains).replace(/'/g, "''");
            filterExpr = `$wins | Where-Object { $_.Title -like '*${needle}*' } | Select-Object -First 1`;
        } else if (args.processName) {
            const name = String(args.processName).replace(/'/g, "''");
            filterExpr = `$wins | Where-Object { $_.ProcessName -eq '${name}' } | Select-Object -First 1`;
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
$wins = Get-CandidateWindows
$p = ${filterExpr}
if (-not $p) { Write-Error 'window not found'; exit 1 }
$h = $p.Hwnd
$wp = New-Object WinPlacement+WINDOWPLACEMENT
$wp.length = [System.Runtime.InteropServices.Marshal]::SizeOf($wp)
[WinPlacement]::GetWindowPlacement($h, [ref]$wp) | Out-Null
# Defensive backstop: never apply a placement to (or targeting) a
# desktop-level background host (live-wallpaper/widget engines — see
# Test-CoversVirtualScreen above), whether that's the window's current
# state or the requested target from an older saved profile.
$curW = $wp.rcNormalPosition.Right - $wp.rcNormalPosition.Left
$curH = $wp.rcNormalPosition.Bottom - $wp.rcNormalPosition.Top
$curState = switch ($wp.showCmd) { 2 { 'minimized' } 3 { 'maximized' } default { 'normal' } }
if ((Test-CoversVirtualScreen $wp.rcNormalPosition.Left $wp.rcNormalPosition.Top $curW $curH $curState) -or (Test-CoversVirtualScreen ${x} ${y} ${width} ${height} '${state}')) {
    Write-Error 'window not found'; exit 1
}
# SetWindowPlacement normally sends a SYNCHRONOUS message to the target
# window's own thread, blocking the caller until that thread's message loop
# handles it. If that thread is briefly busy (mid-resize, lazy DLL load),
# this can wedge or corrupt the target — the best explanation found for
# every restore-crash reproduction so far (see git log). Its documented
# async flag (WPF_ASYNCWINDOWPLACEMENT) avoids the block, but testing shows
# it silently drops the new rcNormalPosition whenever the show-state also
# changes (e.g. maximized -> normal) — only a same-state reposition (normal
# -> normal) reliably applies the new rect with that flag. So: use
# ShowWindowAsync (always fully async, never blocks) to first bring the
# window to "normal" if it isn't already, wait for that using the
# read-only poll above, prime the move onto the destination monitor if
# needed (see Move-ToMonitorIfNeeded — this is what makes the FINAL
# SetWindowPlacement below resolve its workspace coordinates against the
# correct monitor on multi-monitor setups instead of clamping the window
# back onto whichever monitor it started on), THEN reposition via
# SetWindowPlacement+async-flag while staying in "normal" (the one case
# proven to apply correctly), and finally apply the real target show-state
# via ShowWindowAsync again if it isn't "normal" — maximize/minimize then
# uses the restore bounds just set.
Move-FocusAwayIfForeground $h
if ($wp.showCmd -ne 1) {
    [void][WinPlacement]::ShowWindowAsync($h, 9)  # SW_RESTORE
    [void](Wait-ForShowState $h 1 500)
}
Move-ToMonitorIfNeeded $h ${x} ${y} ${width} ${height}
$wp2 = New-Object WinPlacement+WINDOWPLACEMENT
$wp2.length = [System.Runtime.InteropServices.Marshal]::SizeOf($wp2)
[void][WinPlacement]::GetWindowPlacement($h, [ref]$wp2)
$wp2.showCmd = 1
$wp2.flags = $wp2.flags -bor 0x0004  # WPF_ASYNCWINDOWPLACEMENT
$rect = New-Object WinPlacement+RECT
$rect.Left = ${x}
$rect.Top = ${y}
$rect.Right = ${x} + ${width}
$rect.Bottom = ${y} + ${height}
$wp2.rcNormalPosition = $rect
[void][WinPlacement]::SetWindowPlacement($h, [ref]$wp2)
if (${showCmd} -ne 1) {
    [void](Wait-ForShowState $h 1 500)
    [void][WinPlacement]::ShowWindowAsync($h, ${showCmd})
}
# Read back whatever actually stuck instead of trusting the fire-and-forget
# async call above blindly — SetWindowPlacement's async flag means this
# function can return before the target thread has actually processed the
# request, and some apps (Electron/Chromium windows especially) reassert
# their OWN remembered bounds shortly after being shown, silently
# overwriting what we just set. Poll rcNormalPosition briefly for it to
# settle (stop changing between reads) before reporting the final values,
# so the caller can detect a mismatch and retry instead of assuming success.
[void](Wait-ForShowState $h ${showCmd} 500)
$prevRect = $null
$settled = $false
for ($i = 0; $i -lt 10; $i++) {
    $chk = New-Object WinPlacement+WINDOWPLACEMENT
    $chk.length = [System.Runtime.InteropServices.Marshal]::SizeOf($chk)
    [void][WinPlacement]::GetWindowPlacement($h, [ref]$chk)
    $cur = "$($chk.rcNormalPosition.Left),$($chk.rcNormalPosition.Top),$($chk.rcNormalPosition.Right),$($chk.rcNormalPosition.Bottom),$($chk.showCmd)"
    if ($cur -eq $prevRect) { $settled = $true; break }
    $prevRect = $cur
    Start-Sleep -Milliseconds 60
}
$finalState = switch ($chk.showCmd) { 2 { 'minimized' } 3 { 'maximized' } default { 'normal' } }
[pscustomobject]@{
    pid = $p.Pid
    name = $p.ProcessName
    title = $p.Title
    settled = $settled
    actualX = $chk.rcNormalPosition.Left
    actualY = $chk.rcNormalPosition.Top
    actualWidth = ($chk.rcNormalPosition.Right - $chk.rcNormalPosition.Left)
    actualHeight = ($chk.rcNormalPosition.Bottom - $chk.rcNormalPosition.Top)
    actualState = $finalState
} | ConvertTo-Json -Compress
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

module.exports = { windowList, windowFocus, windowSnapshot, windowSetRect, processList, processKill, clipboardRead, clipboardWrite, parseCliXmlError };
