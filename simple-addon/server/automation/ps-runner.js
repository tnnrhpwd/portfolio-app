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

/**
 * ⚠️ Windows PowerShell 5.1 writes stdout in the CONSOLE's OEM code page (437/850),
 * not UTF-8, while this module decodes stdout as 'utf-8'. Every non-ASCII character
 * in a tool result was therefore corrupted on the way out.
 *
 * Measured, not assumed (tmp-probe-enc.cjs): Edge's window title contains a
 * **U+200B ZERO WIDTH SPACE** — `... - Personal - Microsoft<U+200B> Edge`. Unfixed it
 * arrived as `... - Personal - Microsoft? Edge` (U+003F, what an unrepresentable
 * character becomes in a legacy code page). The agent copied that title verbatim into
 * `window_focus({ titleContains })`, the match found nothing, and it burned three
 * identical calls before stalling — a tool whose own error message could not be acted
 * on, because the string it suggested was not a string that could ever match.
 *
 * Setting the output encoding fixes it for every tool at once, not just titles:
 * OCR text, file and folder names, and clipboard content all cross this boundary.
 *
 * ⚠️ `tools/system.js` has its OWN PowerShell runner (`-EncodedCommand` for
 * command-line length reasons) and does NOT go through this module. Both need the
 * prelude; that is why this constant is exported rather than copied.
 */
const ENCODING_PRELUDE = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n';

function _killTree(child) {
    // Kill the whole process tree, not just this immediate child -- a
    // lingering grandchild (e.g. csc.exe compiling an Add-Type block) can
    // keep this child's stdout/stderr pipes open even after SIGKILL, so
    // 'close' wouldn't fire until that grandchild finished on its own,
    // turning an intended short timeout into a much longer real-world hang.
    try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* best-effort */ }
    try { child.kill('SIGKILL'); } catch {}
}

function runPsJson(script, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', '-',
        ], { windowsHide: true });
        let stdout = '', stderr = '';
        let timedOut = false;
        child.stdout.on('data', d => stdout += d.toString('utf-8'));
        child.stderr.on('data', d => stderr += d.toString('utf-8'));
        const timer = setTimeout(() => { timedOut = true; _killTree(child); }, timeoutMs);
        child.on('close', code => {
            clearTimeout(timer);
            if (timedOut) return reject(new Error(`timed out after ${timeoutMs}ms (process killed)`));
            if (code !== 0) return reject(new Error(stderr.trim() || `powershell exited with ${code}`));
            try { resolve(JSON.parse(stdout || 'null')); } catch { resolve(stdout.trim()); }
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.stdin.write(ENCODING_PRELUDE + script + '\n');
        child.stdin.end();
    });
}

function runPsJsonFile(script, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
        const tmp = path.join(os.tmpdir(), `simple-ps-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ps1`);
        // ⚠️ UTF-8 **with a BOM**. Windows PowerShell 5.1 decodes a BOM-less .ps1 as
        // ANSI, so any non-ASCII character in the script — including a name or a piece
        // of text injected from a tool argument — was mangled before it ever ran. Same
        // class of bug as the stdout prelude above, on the INPUT side of the same pipe.
        try { fs.writeFileSync(tmp, '\uFEFF' + ENCODING_PRELUDE + script, 'utf-8'); }
        catch (e) { return reject(e); }
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', tmp,
        ], { windowsHide: true });
        let stdout = '', stderr = '';
        let timedOut = false;
        child.stdout.on('data', d => stdout += d.toString('utf-8'));
        child.stderr.on('data', d => stderr += d.toString('utf-8'));
        const timer = setTimeout(() => { timedOut = true; _killTree(child); }, timeoutMs);
        child.on('close', code => {
            clearTimeout(timer);
            try { fs.unlinkSync(tmp); } catch {}
            if (timedOut) return reject(new Error(`timed out after ${timeoutMs}ms (process killed)`));
            if (code !== 0) return reject(new Error(stderr.trim() || `powershell exited with ${code}`));
            try { resolve(JSON.parse(stdout || 'null')); } catch { resolve(stdout.trim()); }
        });
        child.on('error', e => { clearTimeout(timer); try { fs.unlinkSync(tmp); } catch {} reject(e); });
    });
}

module.exports = { runPsJson, runPsJsonFile, ENCODING_PRELUDE, DEFAULT_TIMEOUT_MS };
