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
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch {}
            reject(new Error('text_type timed out'));
        }, timeoutMs);
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) {
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
using System; using System.Runtime.InteropServices;
public static class WinFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
}
"@
function Focus-Title($needle) {
    if (-not $needle) { return }
    $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$needle*" } | Select-Object -First 1
    if (-not $p) { return }
    [WinFocus]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null
    Start-Sleep -Milliseconds 80
    [WinFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
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
            // Encode text as JSON to avoid quoting issues; PowerShell parses it back.
            const jsonText = JSON.stringify(text);
            script = [
                FOCUS_SNIPPET,
                focusWindow ? `Focus-Title ${JSON.stringify(focusWindow)}` : '',
                `Add-Type -AssemblyName System.Windows.Forms`,
                `$t = ${jsonText}`,
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
                focusWindow ? `Focus-Title ${JSON.stringify(focusWindow)}` : '',
                `Add-Type -AssemblyName System.Windows.Forms`,
                delay > 0
                    ? `foreach ($c in @(${escaped.split('').map(c => JSON.stringify(c)).join(',')})) { [System.Windows.Forms.SendKeys]::SendWait($c)${delayPart} }`
                    : `[System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(escaped)})`,
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
