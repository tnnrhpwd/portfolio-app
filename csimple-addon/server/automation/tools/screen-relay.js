/**
 * screen.relay — capture a screenshot, downscale to a thumbnail, upload via
 * the portfolio backend, then publish the resulting CDN URL through the SSE
 * event bus so the web UI can render a live preview.
 *
 * Workflow:
 *   1. Capture PNG via screen.capture (full-frame or region).
 *   2. Downscale to <= maxDim pixels on the longest edge (default 640).
 *   3. JPEG-encode at quality 70 (smaller payload than PNG for natural screens).
 *   4. Request a presigned PUT URL from POST `/upload-url` on the backend.
 *   5. PUT the bytes to S3 directly (presigned URL bypasses backend).
 *   6. Publish `screen.frame` SSE event with { url, w, h, ts }.
 *
 * This is wired as a TOOL so the agent loop (or a periodic relay timer) can
 * invoke it. It is NOT a "safe-read" — uploading a screenshot off-device is
 * a sensitive operation, so the default category is "sandboxed-write" which
 * means the user must approve once per session (or once-always via the
 * Permission Center).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_MAX_DIM = 640;
const DEFAULT_JPEG_QUALITY = 70;

function _backendBaseUrl() {
    // Same convention as workspace-client.js — addon settings file.
    try {
        const cfgPath = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources', 'settings.json');
        if (fs.existsSync(cfgPath)) {
            const s = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
            return s.backendBaseUrl || process.env.CSIMPLE_BACKEND_URL || 'https://portfolio-app-d20bnyaitq-uc.a.run.app';
        }
    } catch {}
    return process.env.CSIMPLE_BACKEND_URL || 'https://portfolio-app-d20bnyaitq-uc.a.run.app';
}

function _bearerToken() {
    try {
        const cfgPath = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources', 'settings.json');
        if (fs.existsSync(cfgPath)) {
            const s = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
            return s.token || s.jwt || null;
        }
    } catch {}
    return null;
}

/**
 * Downscale + JPEG-encode using .NET System.Drawing in PowerShell.
 * Returns a JPEG buffer.
 */
function _downscaleToJpeg(pngBuffer, maxDim, quality) {
    return new Promise((resolve, reject) => {
        const inFile  = path.join(os.tmpdir(), `csimple-relay-in-${Date.now()}-${Math.floor(Math.random()*1e6)}.png`);
        const outFile = path.join(os.tmpdir(), `csimple-relay-out-${Date.now()}-${Math.floor(Math.random()*1e6)}.jpg`);
        fs.writeFileSync(inFile, pngBuffer);
        const script = `
Add-Type -AssemblyName System.Drawing
$src = [Drawing.Image]::FromFile('${inFile.replace(/\\/g, '\\\\')}')
$w = $src.Width; $h = $src.Height
$maxDim = ${parseInt(maxDim, 10)}
$scale = [Math]::Min(1.0, $maxDim / [Math]::Max($w, $h))
$nw = [int]([Math]::Max(1, $w * $scale))
$nh = [int]([Math]::Max(1, $h * $scale))
$dst = New-Object Drawing.Bitmap($nw, $nh)
$g = [Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $nw, $nh)
$encoder = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$params = New-Object Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]${parseInt(quality, 10)})
$dst.Save('${outFile.replace(/\\/g, '\\\\')}', $encoder, $params)
Write-Output ("DIM=" + $nw + "x" + $nh)
$g.Dispose(); $dst.Dispose(); $src.Dispose()
        `.trim();
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d.toString('utf-8'));
        child.stderr.on('data', d => stderr += d.toString('utf-8'));
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 10_000);
        child.on('close', code => {
            clearTimeout(timer);
            try { fs.unlinkSync(inFile); } catch {}
            if (code !== 0) {
                try { fs.unlinkSync(outFile); } catch {}
                return reject(new Error(stderr.trim() || `downscale exited ${code}`));
            }
            const m = /DIM=(\d+)x(\d+)/.exec(stdout);
            const w = m ? parseInt(m[1], 10) : 0;
            const h = m ? parseInt(m[2], 10) : 0;
            const buf = fs.readFileSync(outFile);
            try { fs.unlinkSync(outFile); } catch {}
            resolve({ buf, w, h });
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.stdin.write(script + '\n');
        child.stdin.end();
    });
}

/**
 * Request a presigned upload URL from the backend, PUT the bytes, then
 * return the CloudFront/S3 URL where the file is readable.
 */
async function _uploadToBackend(buf, contentType, filename) {
    const base = _backendBaseUrl().replace(/\/+$/, '');
    const token = _bearerToken();
    if (!token) throw new Error('no auth token in settings.json — cannot relay frames');

    // Step 1: request presigned URL.
    const r1 = await fetch(`${base}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
            filename,
            fileSize: buf.length,
            contentType,
            fileType: 'attachment',
        }),
    });
    if (!r1.ok) throw new Error(`presign failed: ${r1.status} ${await r1.text().catch(() => '')}`);
    const j1 = await r1.json();
    if (!j1?.uploadUrl) throw new Error('presign response missing uploadUrl');

    // Step 2: PUT to S3 directly (bypasses backend bandwidth).
    const r2 = await fetch(j1.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'Content-Length': String(buf.length) },
        body: buf,
    });
    if (!r2.ok) throw new Error(`S3 PUT failed: ${r2.status} ${await r2.text().catch(() => '')}`);

    // Backend hands us a CloudFront/S3 URL we can give to the UI.
    return j1.publicUrl || j1.cloudFrontUrl || j1.url || null;
}

async function relay(args = {}) {
    const maxDim   = Math.max(120, Math.min(1920, parseInt(args.maxDim || DEFAULT_MAX_DIM, 10)));
    const quality  = Math.max(30, Math.min(95, parseInt(args.quality || DEFAULT_JPEG_QUALITY, 10)));
    const reason   = String(args.reason || '').slice(0, 120);

    // 1. Capture (delegate to screen.js — it already handles full-frame + region).
    const screen = require('./screen');
    const png = await screen._captureBuffer(args.region || {});

    // 2. Downscale + JPEG.
    const { buf: jpg, w, h } = await _downscaleToJpeg(png, maxDim, quality);

    // 3. Upload.
    let url = null;
    try {
        url = await _uploadToBackend(jpg, 'image/jpeg', `screen-${Date.now()}.jpg`);
    } catch (e) {
        // Network/auth issues are non-fatal — we still return local data so callers
        // can fall back to inline base64.
        const events = (() => { try { return require('../events'); } catch { return null; } })();
        events?.publish('screen.frame.failed', { reason: e.message });
        return { ok: false, error: e.message, w, h, bytes: jpg.length };
    }

    // 4. Publish SSE event.
    try {
        const events = require('../events');
        events.publish('screen.frame', { url, w, h, bytes: jpg.length, reason });
    } catch {}

    return { ok: true, url, w, h, bytes: jpg.length };
}

module.exports = {
    name: 'screen_relay',
    category: 'sandboxed-write',     // uploads off-device → user approval gate
    description:
        'Capture a thumbnail screenshot, upload it via the backend, and publish the URL through the agent SSE feed. ' +
        'Use this when you want the user (or a remote watcher) to see what you see RIGHT NOW. ' +
        'Defaults: 640px longest edge, JPEG quality 70. Far smaller than screen_capture base64.',
    parameters: {
        type: 'object',
        properties: {
            maxDim:  { type: 'integer', description: 'Longest edge in pixels (default 640, min 120, max 1920)' },
            quality: { type: 'integer', description: 'JPEG quality (default 70, range 30-95)' },
            reason:  { type: 'string',  description: 'Short label visible to the watcher, e.g. "after clicking Save"' },
            region:  {
                type: 'object',
                description: 'Optional region to capture: { x, y, width, height }. Omit for full frame.',
                properties: {
                    x: { type: 'integer' }, y: { type: 'integer' },
                    width: { type: 'integer' }, height: { type: 'integer' },
                },
            },
        },
    },
    run: relay,
    async dryRun() { return { dryRun: true, would: 'capture + downscale + upload thumbnail to backend' }; },
    // Exported for direct invocation (e.g. periodic relay timer).
    _relay: relay,
    _downscaleToJpeg,
};
