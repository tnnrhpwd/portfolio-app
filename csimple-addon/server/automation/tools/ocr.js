/**
 * screen_ocr — read text from the screen (or a region/file) using
 * Windows.Media.Ocr (the same engine Windows Search/Photos uses).
 *
 * Works on any Windows 10/11 box; no extra installs required as long as the
 * Windows OCR language pack for the chosen language is present (English is
 * always available).
 *
 * Returns:
 *   {
 *     text: string,             // all lines joined with \n
 *     lines: [
 *       { text, x, y, width, height,
 *         words: [{ text, x, y, width, height }] }
 *     ],
 *     languageTag: "en",
 *     source: "screen" | "region" | "file"
 *   }
 *
 * Args:
 *   - path?: string             - OCR an existing PNG/JPG file (skips capture)
 *   - region?: { x, y, width, height }  - OCR a screen region (capture first)
 *   - language?: string         - BCP-47 tag, default "en" / system default
 *   - includeWords?: boolean    - include per-word boxes (default true; small data)
 *
 * If neither `path` nor `region` is provided, the primary monitor is captured.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const { runPsJsonFile } = require('../ps-runner');

const CAPTURE_TIMEOUT_MS = 15_000;
const OCR_TIMEOUT_MS = 25_000;

/**
 * Capture the primary screen (or a region) to a temp PNG and return its path.
 * Re-implemented locally to avoid a circular dep with tools/screen.js.
 */
async function captureToTemp(region) {
    const tmp = path.join(os.tmpdir(), `csimple-ocr-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
    const regionExpr = (region && region.width && region.height)
        ? `New-Object Drawing.Rectangle(${parseInt(region.x, 10)}, ${parseInt(region.y, 10)}, ${parseInt(region.width, 10)}, ${parseInt(region.height, 10)})`
        : `[Windows.Forms.Screen]::PrimaryScreen.Bounds`;

    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$r = ${regionExpr}
$bmp = New-Object Drawing.Bitmap($r.Width, $r.Height)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.X, $r.Y, 0, 0, $bmp.Size)
$bmp.Save('${tmp.replace(/\\/g, '\\\\')}', [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
'ok' | Out-Null
    `.trim();

    await new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-',
        ], { windowsHide: true });
        let stderr = '';
        child.stderr.on('data', d => stderr += d.toString());
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, CAPTURE_TIMEOUT_MS);
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(`capture failed: ${stderr.trim() || code}`));
            resolve();
        });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.stdin.write(script); child.stdin.end();
    });
    return tmp;
}

/**
 * Run WinRT OCR on the file at `imagePath`. Returns lines + words with bounding
 * boxes in the image's own coordinate system (caller adds region.x/y if it
 * needs screen coords).
 */
async function ocrFile(imagePath, languageTag, includeWords) {
    const lang = String(languageTag || 'en').replace(/[^\w\-]/g, '');
    const script = `
$ErrorActionPreference = 'Stop'

# Load the WinRT projections.
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
[void][Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.RandomAccessStreamReference,Windows.Storage.Streams,ContentType=WindowsRuntime]

# Helper to await an IAsyncOperation<T> from PowerShell.
$asTaskGenericMethod = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })

function Await($winRtTask, $resultType) {
    $asTask = $asTaskGenericMethod.MakeGenericMethod($resultType)
    $netTask = $asTask.Invoke($null, @($winRtTask))
    try { $netTask.Wait(-1) | Out-Null }
    catch [System.AggregateException] { throw $_.Exception.InnerException }
    $netTask.Result
}

# Open the image via a .NET FileStream and bridge it to a WinRT IRandomAccessStream.
# (StorageFile.GetFileFromPathAsync is unreliable from non-packaged PowerShell hosts.)
$fileStream = [System.IO.File]::OpenRead('${imagePath.replace(/\\/g, '\\\\')}')
$randomAccessStream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($fileStream)

$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($randomAccessStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

# Pick an OCR engine. Try requested language first, then user profile default.
$engine = $null
try {
    $langObj = New-Object Windows.Globalization.Language '${lang}'
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langObj)
} catch {}
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { Write-Error 'No OCR engine available for any installed language.' -ErrorAction Stop }

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$includeWords = $${includeWords ? 'true' : 'false'}
$lines = @()
foreach ($ln in $result.Lines) {
    # Aggregate per-word bounding boxes into a single line box.
    $minX = [double]::PositiveInfinity; $minY = [double]::PositiveInfinity
    $maxR = [double]::NegativeInfinity; $maxB = [double]::NegativeInfinity
    $words = @()
    foreach ($w in $ln.Words) {
        $b = $w.BoundingRect
        $r = $b.X + $b.Width;  $bm = $b.Y + $b.Height
        if ($b.X -lt $minX) { $minX = $b.X }
        if ($b.Y -lt $minY) { $minY = $b.Y }
        if ($r -gt $maxR)   { $maxR = $r }
        if ($bm -gt $maxB)  { $maxB = $bm }
        if ($includeWords) {
            $words += [pscustomobject]@{ text = $w.Text; x = [int]$b.X; y = [int]$b.Y; width = [int]$b.Width; height = [int]$b.Height }
        }
    }
    if ([double]::IsInfinity($minX)) { $minX = 0; $minY = 0; $maxR = 0; $maxB = 0 }
    $lines += [pscustomobject]@{
        text = $ln.Text
        x = [int]$minX; y = [int]$minY
        width = [int]($maxR - $minX); height = [int]($maxB - $minY)
        words = $words
    }
}

# Release native handles before we exit.
try { $fileStream.Dispose() } catch {}

$payload = [pscustomobject]@{
    text = ($result.Lines | ForEach-Object { $_.Text }) -join "\`n"
    languageTag = $result.Language.LanguageTag
    lines = $lines
}
$payload | ConvertTo-Json -Depth 10 -Compress
    `.trim();

    return await runPsJsonFile(script, { timeoutMs: OCR_TIMEOUT_MS });
}

const screenOcr = {
    name: 'screen_ocr',
    category: 'safe-read',
    description:
        'Read text from the screen using Windows.Media.Ocr. Defaults to the primary monitor. ' +
        'Pass `region` for a sub-rectangle or `path` for an existing PNG/JPG. ' +
        'Returns per-line bounding boxes (and per-word boxes by default) in image coordinates. ' +
        'When `region` was provided, screen-space coordinates can be reconstructed as { x: line.x + region.x, y: line.y + region.y }.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to a PNG/JPG to OCR; skips capture.' },
            region: {
                type: 'object',
                description: 'Screen region to OCR.',
                properties: {
                    x: { type: 'integer' }, y: { type: 'integer' },
                    width: { type: 'integer' }, height: { type: 'integer' },
                },
            },
            language: { type: 'string', description: 'BCP-47 language tag (e.g. "en", "es", "ja"). Defaults to user profile.' },
            includeWords: { type: 'boolean', description: 'Include per-word bounding boxes (default true).' },
        },
    },
    async run(args = {}) {
        const includeWords = args.includeWords !== false;
        let source = 'file';
        let imagePath = args.path;
        let cleanup = false;

        if (!imagePath) {
            source = args.region ? 'region' : 'screen';
            imagePath = await captureToTemp(args.region);
            cleanup = true;
        }
        if (!fs.existsSync(imagePath)) {
            throw new Error(`OCR source not found: ${imagePath}`);
        }
        try {
            const out = await ocrFile(imagePath, args.language, includeWords);
            // If we captured a sub-region, shift coordinates back to screen space
            // so callers can click without doing the math themselves.
            if (args.region && out && Array.isArray(out.lines)) {
                const dx = parseInt(args.region.x, 10) || 0;
                const dy = parseInt(args.region.y, 10) || 0;
                for (const ln of out.lines) {
                    ln.x += dx; ln.y += dy;
                    if (Array.isArray(ln.words)) {
                        for (const w of ln.words) { w.x += dx; w.y += dy; }
                    }
                }
            }
            return { ...out, source };
        } finally {
            if (cleanup) { try { fs.unlinkSync(imagePath); } catch {} }
        }
    },
};

module.exports = { screenOcr };
