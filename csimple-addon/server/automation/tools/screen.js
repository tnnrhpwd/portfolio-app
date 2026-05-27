/**
 * screen.capture — take a screenshot of the primary monitor (or a region).
 *
 * Uses .NET System.Drawing via PowerShell Add-Type. Returns the PNG as base64.
 * Optionally uploads to S3 via the portfolio backend (when an upload URL is
 * provided in args) and returns the resulting key — keeps the LLM payload small.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_DIM = 4096;

function runPsBinary(script) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', '-',
        ], { windowsHide: true });
        let stderr = '';
        const chunks = [];
        child.stdout.on('data', d => chunks.push(d));
        child.stderr.on('data', d => stderr += d.toString('utf-8'));
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 15_000);
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(stderr.trim() || `powershell exited with ${code}`));
            resolve(Buffer.concat(chunks));
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.stdin.write(script + '\n');
        child.stdin.end();
    });
}

async function capture({ x = null, y = null, width = null, height = null } = {}) {
    // Capture to a temp file, then read it as bytes (more reliable than streaming
    // raw bytes through a PowerShell pipeline with encoding quirks).
    const tmp = path.join(os.tmpdir(), `csimple-screen-${Date.now()}-${Math.floor(Math.random()*1e6)}.png`);
    const region = (x != null && y != null && width != null && height != null)
        ? `New-Object Drawing.Rectangle(${parseInt(x,10)}, ${parseInt(y,10)}, ${Math.min(MAX_DIM, parseInt(width,10))}, ${Math.min(MAX_DIM, parseInt(height,10))})`
        : `[Windows.Forms.Screen]::PrimaryScreen.Bounds`;

    const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$r = ${region}
$bmp = New-Object Drawing.Bitmap($r.Width, $r.Height)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.X, $r.Y, 0, 0, $bmp.Size)
$bmp.Save('${tmp.replace(/\\/g, '\\\\')}', [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
    `.trim();

    await runPsBinary(script);
    const buf = fs.readFileSync(tmp);
    try { fs.unlinkSync(tmp); } catch {}
    return buf;
}

module.exports = {
    name: 'screen_capture',
    category: 'safe-read',
    description:
        'Capture a screenshot of the primary monitor (or a region). Returns base64 PNG, ' +
        'width, and height. Use sparingly — payloads are large. Prefer narrow regions when targeting a UI element.',
    parameters: {
        type: 'object',
        properties: {
            x: { type: 'integer' }, y: { type: 'integer' },
            width:  { type: 'integer' }, height: { type: 'integer' },
            returnInline: { type: 'boolean', description: 'If true (default), return base64. If false, only return byte length.' },
        },
    },
    async run(args) {
        const buf = await capture(args || {});
        const returnInline = args?.returnInline !== false;
        return {
            mime: 'image/png',
            bytes: buf.length,
            ...(returnInline ? { base64: buf.toString('base64') } : {}),
        };
    },
    async dryRun() {
        return { dryRun: true, would: 'capture primary monitor' };
    },
    // Internal helper exported for vision+UIA fusion
    _captureBuffer: capture,
};
