/**
 * text_type — Type a string of text into the foreground window using
 * Windows SendKeys, optionally targeting a specific window first.
 *
 * Strategy:
 *   1. If text is ASCII and ≤120 chars: use [System.Windows.Forms.SendKeys]::SendWait
 *      for maximum compatibility (no clipboard involvement, works in UAC dialogs).
 *   2. Longer or Unicode text: write to clipboard via Set-Clipboard, then
 *      send Ctrl+V (fast, reliable, handles all Unicode).
 *
 * Special SendKeys characters ({ } + ^ % ~ ( )) are escaped automatically
 * in strategy 1. Unicode or length forces strategy 2 regardless.
 *
 * Security: the text is passed via -EncodedCommand (base64 UTF-16LE) so no
 * shell interpolation of the content is possible.
 */

const { spawn } = require('child_process');

const SENDKEYS_MAX_ASCII_LEN = 120;
// These chars have special meaning in SendKeys and must be escaped.
const SENDKEYS_SPECIAL_RE = /[+^%~(){}[\]]/g;

function _escapeSendKeys(text) {
    return text.replace(SENDKEYS_SPECIAL_RE, c => `{${c}}`);
}

// Builds a PowerShell single-quoted string literal for embedding arbitrary
// text (file paths, focus-window titles, etc.) directly into a script.
// JSON.stringify() was used here previously, which produces a DOUBLE-quoted
// literal ("...") from JS's point of view -- but PowerShell double-quoted
// strings don't treat backslash as an escape character the way JSON does
// (PowerShell's escape char is the backtick), so every JSON-escaped `\\`
// survived as a literal double backslash once PowerShell parsed it. That
// silently corrupted any Windows file path typed this way (e.g. a Save-As
// dialog's filename field), and double-quoted strings also risk `$name`
// variable interpolation if the typed text happens to contain a dollar
// sign. A single-quoted PowerShell literal has neither problem -- the only
// thing that needs escaping is a literal single quote, by doubling it.
function _psQuote(s) {
    return "'" + String(s).replace(/'/g, "''") + "'";
}

function _isAsciiPrintable(text) {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 0x20 || c > 0x7E) return false;
    }
    return true;
}

function runPsEncoded(script, { timeoutMs = 10_000 } = {}) {
    return new Promise((resolve, reject) => {
        const encoded = Buffer.from(String(script), 'utf16le').toString('base64');
        const psExe = process.env.SystemRoot
            ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
            : 'powershell.exe';
        const child = spawn(psExe, [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-EncodedCommand', encoded,
        ], { windowsHide: true });
        let out = '';
        let err = '';
        child.stdout.on('data', d => { out += d.toString('utf-8'); });
        child.stderr.on('data', d => { err += d.toString('utf-8'); });
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            // Kill the whole tree, not just this immediate child -- see
            // input.js's runPsScript for why (a lingering grandchild, e.g.
            // csc.exe compiling Add-Type, can keep stdout/stderr pipes open
            // past a plain SIGKILL and silently turn this timeout into a
            // much longer real hang).
            try {
                spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            } catch { /* best-effort */ }
            try { child.kill('SIGKILL'); } catch {}
        }, timeoutMs);
        child.on('close', code => {
            clearTimeout(timer);
            if (timedOut) {
                reject(new Error(`text_type timed out after ${timeoutMs}ms (process killed)`));
            } else if (code !== 0) {
                reject(new Error((err.trim() || `exit ${code}`).slice(0, 400)));
            } else {
                resolve(out.trim());
            }
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
    });
}

const FOCUS_SNIPPET = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
public static class WinFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
function Focus-Title($needle) {
    if (-not $needle) { return }
    # Get-Process's MainWindowHandle can never resolve to a dialog opened
    # BY the target process (e.g. Notepad's Ctrl+S "Save As" dialog is its
    # own top-level HWND, not a new process) -- so a focusWindowTitle aimed
    # at that dialog's title silently focused nothing, and the filename that
    # was supposed to go into the dialog's edit box got typed into whatever
    # window (often the app's own main document) actually still had focus
    # instead. Walk every real top-level window via EnumWindows so dialogs
    # are found too, same as input.js's Focus-WindowByTitle.
    $script:_focusHwnd = [IntPtr]::Zero
    $callback = [EnumWindowsProc]{
        param([IntPtr]$hwnd, [IntPtr]$lparam)
        if (-not [WinFocus]::IsWindowVisible($hwnd)) { return $true }
        $len = [WinFocus]::GetWindowTextLength($hwnd)
        if ($len -le 0) { return $true }
        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [void][WinFocus]::GetWindowText($hwnd, $sb, $sb.Capacity)
        if ($sb.ToString() -like "*$needle*") {
            $script:_focusHwnd = $hwnd
            return $false
        }
        return $true
    }
    [void][WinFocus]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:_focusHwnd -eq [IntPtr]::Zero) { return }
    [WinFocus]::ShowWindowAsync($script:_focusHwnd, 9) | Out-Null
    Start-Sleep -Milliseconds 80
    [WinFocus]::SetForegroundWindow($script:_focusHwnd) | Out-Null
}
`.trim();

const textType = {
    name: 'text_type',
    category: 'system',
    description:
        'Type a string of text into the currently-focused window (or a named window). ' +
        'Handles Unicode via clipboard paste. Escapes SendKeys special characters automatically. ' +
        'Use for filling in text fields, writing to documents, entering search queries, etc.',
    parameters: {
        type: 'object',
        required: ['text'],
        properties: {
            text: {
                type: 'string',
                description: 'The text to type. Max 50 000 characters.',
            },
            focusWindowTitle: {
                type: 'string',
                description: 'Optional window title substring to focus before typing.',
            },
            delayMsBetweenChars: {
                type: 'number',
                description: 'Milliseconds between keystrokes (SendKeys strategy only, 0–200). Default 0.',
            },
            pressEnterAfter: {
                type: 'boolean',
                description: 'If true, press Enter after typing the text.',
            },
        },
    },
    async run(args, _ctx) {
        const text = String(args?.text ?? '').slice(0, 50_000);
        if (!text) throw new Error('text_type: text is required');

        const focusWindow = args?.focusWindowTitle ? String(args.focusWindowTitle).slice(0, 200) : '';
        const pressEnter = !!args?.pressEnterAfter;
        const delay = Math.min(200, Math.max(0, Number(args?.delayMsBetweenChars) || 0));

        // Strategy decision
        const useClipboard = !_isAsciiPrintable(text) || text.length > SENDKEYS_MAX_ASCII_LEN;

        let script;
        if (useClipboard) {
            // Unicode / long text → clipboard + Ctrl+V
            script = [
                FOCUS_SNIPPET,
                focusWindow ? `Focus-Title ${_psQuote(focusWindow)}` : '',
                `Add-Type -AssemblyName System.Windows.Forms`,
                `$t = ${_psQuote(text)}`,
                `[System.Windows.Forms.Clipboard]::SetText($t)`,
                `Start-Sleep -Milliseconds 80`,
                `[System.Windows.Forms.SendKeys]::SendWait('^v')`,
                pressEnter ? `Start-Sleep -Milliseconds 50\n[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')` : '',
                `Write-Output "typed:clipboard:$($t.Length)chars"`,
            ].filter(Boolean).join('\n');
        } else {
            // Short ASCII → SendKeys character by character
            const escaped = _escapeSendKeys(text);
            const delayPart = delay > 0 ? `; Start-Sleep -Milliseconds ${delay}` : '';
            script = [
                FOCUS_SNIPPET,
                focusWindow ? `Focus-Title ${_psQuote(focusWindow)}` : '',
                `Add-Type -AssemblyName System.Windows.Forms`,
                delay > 0
                    ? `foreach ($c in @(${escaped.split('').map(c => _psQuote(c)).join(',')})) { [System.Windows.Forms.SendKeys]::SendWait($c)${delayPart} }`
                    : `[System.Windows.Forms.SendKeys]::SendWait(${_psQuote(escaped)})`,
                pressEnter ? `Start-Sleep -Milliseconds 50\n[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')` : '',
                `Write-Output "typed:sendkeys:${text.length}chars"`,
            ].filter(Boolean).join('\n');
        }

        const out = await runPsEncoded(script, { timeoutMs: 15_000 });
        return { ok: true, strategy: useClipboard ? 'clipboard' : 'sendkeys', chars: text.length, out };
    },
    async dryRun(args) {
        const text = String(args?.text ?? '').slice(0, 60);
        return { ok: true, strategy: 'dry-run', chars: text.length, preview: text };
    },
};

module.exports = { textType };
