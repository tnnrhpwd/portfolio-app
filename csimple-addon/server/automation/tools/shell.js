/**
 * shell.run — sandboxed PowerShell tool
 *
 * Safety layers (in order):
 *   1. Hard length cap on command (16 KB)
 *   2. Permissions.shellDenyPatterns: regex deny-list, always blocked
 *   3. Permissions.shellAllowPatterns: regex allow-list, auto-approves
 *      (registry's permission gate decides ask vs allow vs dry-run)
 *   4. cwd locked to a workspace dir (defaults to user home if unset)
 *   5. -NoProfile -NonInteractive
 *   6. Output capped (1 MB stdout + 256 KB stderr)
 *   7. Hard timeout (default 60s, max 600s)
 *   8. Environment scrubbed of secret-shaped vars unless explicitly preserved
 *
 * Returns: { stdout, stderr, exitCode, timedOut, command, cwd }
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const permissions = require('../permissions');

const MAX_CMD_BYTES   = 16 * 1024;
const MAX_STDOUT      = 1024 * 1024;
const MAX_STDERR      = 256 * 1024;
const DEFAULT_TIMEOUT = 60_000;
const MAX_TIMEOUT     = 600_000;

const SECRET_RE = /(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)/i;

function scrubEnv() {
    const out = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (SECRET_RE.test(k)) continue; // drop
        out[k] = v;
    }
    out.NO_COLOR = '1';
    return out;
}

function resolveCwd(requested) {
    const cfg = permissions.load();
    const roots = (cfg.fsRoots && cfg.fsRoots.length) ? cfg.fsRoots : [os.homedir()];
    if (!requested) return roots[0];
    const abs = path.resolve(requested);
    if (!roots.some(r => abs === r || abs.startsWith(r + path.sep))) {
        throw new Error(`cwd outside allowed roots: ${abs}. Allowed: ${roots.join(', ')}`);
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        throw new Error(`cwd does not exist or is not a directory: ${abs}`);
    }
    return abs;
}

function matchesAny(patterns, text) {
    for (const pat of patterns || []) {
        try { if (new RegExp(pat, 'i').test(text)) return pat; } catch {}
    }
    return null;
}

function preflight(command) {
    const cfg = permissions.load();
    if (Buffer.byteLength(command, 'utf-8') > MAX_CMD_BYTES) {
        return { error: `command too long (>${MAX_CMD_BYTES} bytes)` };
    }
    const denied = matchesAny(cfg.shellDenyPatterns, command);
    if (denied) return { error: `command matches deny pattern: ${denied}` };
    return { error: null };
}

async function runPowershell({ command, cwd, timeoutMs }) {
    return new Promise((resolve) => {
        // Use stdin to avoid command-line length / quoting issues.
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', '-',
        ], {
            cwd,
            env: scrubEnv(),
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let killed = false;
        let timedOut = false;

        const stdoutTrunc = () => stdout.length >= MAX_STDOUT;
        const stderrTrunc = () => stderr.length >= MAX_STDERR;

        child.stdout.on('data', d => {
            if (stdoutTrunc()) return;
            stdout += d.toString('utf-8');
            if (stdoutTrunc()) {
                stdout = stdout.slice(0, MAX_STDOUT) + '\n[…stdout truncated]';
            }
        });
        child.stderr.on('data', d => {
            if (stderrTrunc()) return;
            stderr += d.toString('utf-8');
            if (stderrTrunc()) {
                stderr = stderr.slice(0, MAX_STDERR) + '\n[…stderr truncated]';
            }
        });

        const timer = setTimeout(() => {
            timedOut = true;
            killed = true;
            try { child.kill('SIGKILL'); } catch {}
        }, timeoutMs);

        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({ stdout, stderr: stderr + '\n[spawn error] ' + err.message, exitCode: -1, timedOut, killed });
        });

        child.on('close', (code, signal) => {
            clearTimeout(timer);
            resolve({
                stdout, stderr,
                exitCode: typeof code === 'number' ? code : (signal ? -1 : 0),
                timedOut, killed,
            });
        });

        // Feed the command and close stdin.
        try {
            child.stdin.write(command + '\n');
            child.stdin.end();
        } catch (e) {
            clearTimeout(timer);
            resolve({ stdout, stderr: 'stdin write failed: ' + e.message, exitCode: -1, timedOut, killed });
        }
    });
}

module.exports = {
    name: 'shell_run',
    category: 'shell',
    description:
        'Execute a PowerShell command on the user\'s Windows PC. Returns stdout, stderr, and exit code. ' +
        'Use for read-only inspection (Get-*, Test-Path), file operations within the user\'s workspace, ' +
        'and running CLI tools. Destructive commands (Remove-Item -Recurse, Format-*, shutdown, reg delete) are blocked. ' +
        'Always prefer the most narrowly-scoped command possible.',
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'PowerShell command(s) to run. Multiple statements may be separated by `;` or newlines.' },
            cwd:     { type: 'string', description: 'Optional absolute working directory; must be inside one of the user\'s allowed roots.' },
            timeoutMs: { type: 'integer', description: `Soft timeout in ms (default ${DEFAULT_TIMEOUT}, max ${MAX_TIMEOUT}).` },
        },
        required: ['command'],
    },
    async dryRun(args) {
        const pre = preflight(args.command || '');
        return {
            dryRun: true,
            wouldRun: args.command,
            cwd: args.cwd || os.homedir(),
            preflight: pre.error ? { blocked: pre.error } : { ok: true },
        };
    },
    async run(args, ctx) {
        const command = String(args.command || '').trim();
        if (!command) throw new Error('command is required');
        const pre = preflight(command);
        if (pre.error) {
            return { stdout: '', stderr: pre.error, exitCode: -2, timedOut: false, command, cwd: null, blocked: true };
        }
        const cwd = resolveCwd(args.cwd);
        const timeoutMs = Math.min(MAX_TIMEOUT, Math.max(1000, Number(args.timeoutMs) || DEFAULT_TIMEOUT));
        ctx.log?.(`[shell_run] cwd=${cwd} timeout=${timeoutMs}ms cmd=${command.slice(0, 200)}`);
        const r = await runPowershell({ command, cwd, timeoutMs });
        return { ...r, command, cwd };
    },
};
