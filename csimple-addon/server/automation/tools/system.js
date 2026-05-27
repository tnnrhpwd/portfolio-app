/**
 * Windows + process + clipboard tools.
 *
 * Implemented via tiny inline PowerShell snippets. Each snippet emits JSON to
 * stdout (ConvertTo-Json) so we can parse without screen-scraping.
 */

const { spawn } = require('child_process');

const PS_TIMEOUT = 15_000;

function runPs(script) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', '-',
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
        child.stdin.write(script + '\n');
        child.stdin.end();
    });
}

async function runPsJson(script) {
    const out = await runPs(script);
    try { return JSON.parse(out); }
    catch { return out.trim(); }
}

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
    description: 'Bring a window to the foreground by process name or PID.',
    parameters: {
        type: 'object',
        properties: {
            pid: { type: 'integer' },
            processName: { type: 'string' },
        },
    },
    async run(args) {
        const sel = args.pid
            ? `Get-Process -Id ${parseInt(args.pid, 10)}`
            : `Get-Process -Name '${String(args.processName || '').replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Select-Object -First 1`;
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
[W]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null  # restore
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
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

module.exports = { windowList, windowFocus, processList, processKill, clipboardRead, clipboardWrite };
