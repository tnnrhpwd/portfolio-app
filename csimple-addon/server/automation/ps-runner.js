/**
 * Shared PowerShell runners. Two flavors:
 *
 *   - `runPsJson(script)`     : pipes the script to `powershell.exe -Command -`.
 *                               Best for short, single-pass snippets. Some
 *                               scripts (multi-line functions referencing
 *                               $script: vars, recursive walkers, here-strings
 *                               with embedded C# Add-Type) don't survive the
 *                               stdin pipe — use the file variant for those.
 *
 *   - `runPsJsonFile(script)` : writes the script to a temp .ps1 file and
 *                               executes via `powershell.exe -File <tmp>`.
 *                               More reliable for complex scripts; slightly
 *                               higher overhead due to disk I/O.
 *
 * Both parse stdout as JSON, falling back to a trimmed string if parsing
 * fails. Both reject on non-zero exit code.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_TIMEOUT_MS = 20_000;

function runPsJson(script, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', '-',
        ], { windowsHide: true });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d.toString('utf-8'));
        child.stderr.on('data', d => stderr += d.toString('utf-8'));
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(stderr.trim() || `powershell exited with ${code}`));
            try { resolve(JSON.parse(stdout || 'null')); } catch { resolve(stdout.trim()); }
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.stdin.write(script + '\n');
        child.stdin.end();
    });
}

function runPsJsonFile(script, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
        const tmp = path.join(os.tmpdir(), `csimple-ps-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ps1`);
        try { fs.writeFileSync(tmp, script, 'utf-8'); }
        catch (e) { return reject(e); }
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', tmp,
        ], { windowsHide: true });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d.toString('utf-8'));
        child.stderr.on('data', d => stderr += d.toString('utf-8'));
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
        child.on('close', code => {
            clearTimeout(timer);
            try { fs.unlinkSync(tmp); } catch {}
            if (code !== 0) return reject(new Error(stderr.trim() || `powershell exited with ${code}`));
            try { resolve(JSON.parse(stdout || 'null')); } catch { resolve(stdout.trim()); }
        });
        child.on('error', e => { clearTimeout(timer); try { fs.unlinkSync(tmp); } catch {} reject(e); });
    });
}

module.exports = { runPsJson, runPsJsonFile, DEFAULT_TIMEOUT_MS };
