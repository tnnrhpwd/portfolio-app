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
 *   - window?: string           - capture ONLY the window whose title contains this
 *                                 (preferred; matched like `window_focus`)
 *   - region?: { x, y, width, height }  - OCR a screen region (capture first)
 *   - language?: string         - BCP-47 tag, default "en" / system default
 *   - includeWords?: boolean    - include per-word boxes (default true; small data)
 *
 * Precedence: `path` > `window` > `region` > the whole primary monitor.
 *
 * Coordinate note: the `window` path resolves and captures in a DPI-AWARE process, so a
 * window's rect and the pixels taken from it are both in PHYSICAL screen pixels — which
 * is the space `click_at`/SetCursorPos uses. Line coordinates come back shifted into
 * that same screen space, so `lines[].x/y` can be clicked directly.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const { runPsJsonFile } = require('../ps-runner');
const { WIN_PLACEMENT_PRELUDE, normaliseTitle } = require('./system');

/**
 * DPI awareness for a CAPTURE process, mirroring the one `system.js` sets in its window
 * prelude (Per-Monitor-V2 = -4). Without it, `GetWindowRect` (from a DPI-aware process)
 * and `CopyFromScreen` (from a non-aware one) disagree on a scaled display, so a
 * window-scoped capture lands on the wrong pixels and every derived click is off.
 * Best-effort: older Windows builds may not support this context value.
 */
const PS_DPI_PRELUDE = `Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OcrDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@
try { [OcrDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}

# Live screen rect of a top-level window. GetWindowPlacement is NOT usable here:
# its rcNormalPosition is the RESTORED rect, which is the wrong place for a
# maximized or minimized window — the exact opposite of what window_snapshot wants.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OcrRect {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
"@
`;

/**
 * Message for a `window` needle that matched nothing. Names the needle AND what IS open,
 * and forbids repeating the call — the same shape as `window_focus`'s miss, for the same
 * reason: a capture of the wrong window reads as success, so the failure has to be
 * actionable in one read. Pure + exported so `ocr.test.js` can pin the wording.
 */
function buildWindowMissMessage(needle, openList) {
    return `screen_ocr: no window matching "${needle}" — nothing was captured. `
        + `Open windows right now: ${openList}. Pick a name from that list, pass an explicit `
        + '`region` instead, or call window_list for the full set. Do not repeat this exact call.';
}

const CAPTURE_TIMEOUT_MS = 15_000;
const OCR_TIMEOUT_MS = 25_000;

/**
 * ⚠️ `ConvertTo-Json` (Windows PowerShell 5.1) escapes \b \f \n \r and the quote
 * and backslash, but emits every OTHER C0 control character RAW inside the string
 * literal — which is invalid JSON. ONE BEL (0x07) is enough: `JSON.parse` throws,
 * `ps-runner`'s documented fallback silently resolves the raw stdout STRING
 * instead of an object, and `{ ...out }` in `run()` below then spreads that string
 * into one object key per character. Measured on 2026-09-19: a full-screen capture
 * produced a result with 136 926 keys and a 1.7 MB response — reported as `ok:true`.
 * The agent's only way to read a Chromium page was therefore returning nothing, and
 * saying it had worked. A silent failure is the one thing this repo's conventions
 * forbid (see "a failure must announce itself" in the agent docs).
 *
 * Where the control characters come from: OCR reads them off the SCREEN. A terminal
 * that rings the bell, or an ESC sequence in a pane, lands in the recognised text.
 *
 * So sanitise before serialising. \t \n \r are kept — `ConvertTo-Json` escapes
 * those correctly — and everything else in C0 (plus DEL) becomes a space. Exported
 * so `ocr.test.js` can prove the behaviour without needing a screen.
 */
const PS_CLEAN_TEXT = `function Clean-Text($s) {
    if ($null -eq $s) { return '' }
    return ([string]$s) -replace '[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', ' '
}`;

/**
 * Capture ONE top-level window (matched by title substring, exactly like `window_focus`)
 * to a temp PNG, and report the window's live screen rect.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A full-monitor capture includes every OTHER app on that monitor, and the agent is
 * usually talking to one of them. Measured 2026-09-19, on a Google Messages task:
 * searching a full-screen OCR for "Dakota" produced four matches — three of them the
 * user's own prompt text echoed back in the VS Code chat window and the open document,
 * **none of them the contact row in the browser**. "Match the text, click its centre"
 * would therefore click the chat. The words an agent is looking for are exactly the
 * words its own conversation is displaying, so an unscoped capture is a false-positive
 * generator, not a small inefficiency.
 *
 * Window resolution uses `Get-CandidateWindows` from `system.js`'s prelude, so the same
 * window `window_focus` would pick is the one that gets captured (same filtering: hidden
 * windows, "PopupHost" decoys, shell hosts, DPI normalisation).
 *
 * `GetWindowRect` is used rather than the prelude's `GetWindowPlacement`, because the
 * latter reports `rcNormalPosition` — the RESTORED rect, which is the wrong place for a
 * maximized or minimized window. That is the right answer for `window_snapshot` (it
 * restores layouts) and the wrong one here.
 *
 * Resolve AND capture in one PowerShell process so both see the same DPI context.
 */
async function captureWindowToTemp(needle) {
    const tmp = path.join(os.tmpdir(), `simple-ocr-win-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
    const wanted = normaliseTitle(needle).replace(/'/g, "''");

    const script = `
$ErrorActionPreference = 'Stop'
${PS_DPI_PRELUDE}
${WIN_PLACEMENT_PRELUDE}
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$wins = Get-CandidateWindows
$target = $wins | Where-Object { $_.Title -like '*${wanted}*' } | Select-Object -First 1
if (-not $target) {
    $open = ($wins | Select-Object -First 12 | ForEach-Object { '"' + $_.Title + '" (' + $_.ProcessName + ')' }) -join ', '
    if (-not $open) { $open = 'none could be listed' }
    [pscustomobject]@{ found = $false; open = $open } | ConvertTo-Json -Compress
    exit 0
}
$r = New-Object OcrRect+RECT
if (-not [OcrRect]::GetWindowRect($target.Hwnd, [ref]$r)) {
    [pscustomobject]@{ found = $false; open = 'the matched window refused to report its rectangle' } | ConvertTo-Json -Compress
    exit 0
}
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
$bmp = New-Object Drawing.Bitmap($w, $h)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save('${tmp.replace(/\\/g, '\\\\')}', [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
[pscustomobject]@{ found = $true; pid = $target.Pid; processName = $target.ProcessName; title = $target.Title; x = $r.Left; y = $r.Top; width = $w; height = $h } | ConvertTo-Json -Compress
    `.trim();

    const out = await runPsJsonFile(script, { timeoutMs: CAPTURE_TIMEOUT_MS + 10_000 });
    if (!out || typeof out !== 'object' || out.found !== true) {
        const open = (out && typeof out === 'object' && out.open) ? out.open : 'none could be listed';
        throw new Error(buildWindowMissMessage(needle, open));
    }
    return {
        path: tmp,
        region: { x: out.x, y: out.y, width: out.width, height: out.height },
        window: { pid: out.pid, processName: out.processName, title: out.title },
    };
}

/**
 * Capture the primary screen (or a region) to a temp PNG and return its path.
 * Re-implemented locally to avoid a circular dep with tools/screen.js.
 */
async function captureToTemp(region) {
    const tmp = path.join(os.tmpdir(), `simple-ocr-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
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
${PS_CLEAN_TEXT}

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
            $words += [pscustomobject]@{ text = (Clean-Text $w.Text); x = [int]$b.X; y = [int]$b.Y; width = [int]$b.Width; height = [int]$b.Height }
        }
    }
    if ([double]::IsInfinity($minX)) { $minX = 0; $minY = 0; $maxR = 0; $maxB = 0 }
    $lines += [pscustomobject]@{
        text = (Clean-Text $ln.Text)
        x = [int]$minX; y = [int]$minY
        width = [int]($maxR - $minX); height = [int]($maxB - $minY)
        words = $words
    }
}

# Release native handles before we exit.
try { $fileStream.Dispose() } catch {}

$payload = [pscustomobject]@{
    text = (($result.Lines | ForEach-Object { Clean-Text $_.Text }) -join "\`n")
    languageTag = $result.Language.LanguageTag
    lines = $lines
}
$payload | ConvertTo-Json -Depth 10 -Compress
    `.trim();

    return await runPsJsonFile(script, { timeoutMs: OCR_TIMEOUT_MS });
}

/**
 * ⚠️ AN UNPARSEABLE PAYLOAD MUST NOT BE SPREAD.
 *
 * `ps-runner` resolves the raw stdout STRING when its `JSON.parse` fails (a documented
 * fallback). `{ ...out, source }` on that string produces `{0:'{', 1:'"', 2:'t', ...}` —
 * an object that LOOKS like data, is reported as `ok:true`, and is useless. Measured
 * 2026-09-19 on a full-screen capture: 136 926 keys, 1.7 MB, "success". The agent had
 * no way to tell that its only tool for reading a Chromium page had returned nothing,
 * so it re-read and stalled.
 *
 * Throwing instead means `executeTool` reports `ok:false` with this text, and the agent
 * learns the read FAILED. Pure and exported so `ocr.test.js` can pin it.
 */
function assertOcrPayload(out) {
    if (!out || typeof out !== 'object' || Array.isArray(out)) {
        const len = out === null || out === undefined ? 0 : String(out).length;
        throw new Error(
            `OCR backend returned unparseable output (${len} chars of raw text, not JSON) — `
            + 'nothing was read. This is a bug in screen_ocr, not an empty screen; the usual '
            + 'cause is a control character in the recognised text.',
        );
    }
    return out;
}

const screenOcr = {
    name: 'screen_ocr',
    category: 'safe-read',
    description:
        'Read text from the screen using Windows.Media.Ocr. ' +
        '⚠️ PASS `window` WHENEVER YOU KNOW WHICH APP YOU MEAN. A plain call captures the whole ' +
        'primary monitor, which includes every OTHER app too — so searching the result for a word ' +
        'can match the user\'s own chat window instead of the app you are driving, and then you click ' +
        'the wrong thing. `window: "Edge"` captures just that window. ' +
        'Pass `region` for a sub-rectangle or `path` for an existing PNG/JPG. ' +
        'Returned line/word boxes are already in SCREEN coordinates, whichever source was used.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to a PNG/JPG to OCR; skips capture.' },
            window: { type: 'string', description: 'Title substring of the window to capture (matches like window_focus). Strongly preferred over a full-screen capture.' },
            region: {
                type: 'object',
                description: 'Screen region to OCR. Ignored when `window` is given.',
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
        let shift = args.region;
        let windowInfo = null;

        if (!imagePath && args.window && String(args.window).trim()) {
            const shot = await captureWindowToTemp(String(args.window));
            imagePath = shot.path;
            cleanup = true;
            source = 'window';
            shift = shot.region;
            windowInfo = shot.window;
        } else if (!imagePath) {
            source = args.region ? 'region' : 'screen';
            imagePath = await captureToTemp(args.region);
            cleanup = true;
        }
        if (!fs.existsSync(imagePath)) {
            throw new Error(`OCR source not found: ${imagePath}`);
        }
        try {
            const out = assertOcrPayload(await ocrFile(imagePath, args.language, includeWords));
            // If we captured a sub-rectangle (or a window), shift coordinates back to
            // screen space so callers can click without doing the math themselves.
            if (shift && out && Array.isArray(out.lines)) {
                const dx = parseInt(shift.x, 10) || 0;
                const dy = parseInt(shift.y, 10) || 0;
                for (const ln of out.lines) {
                    ln.x += dx; ln.y += dy;
                    if (Array.isArray(ln.words)) {
                        for (const w of ln.words) { w.x += dx; w.y += dy; }
                    }
                }
            }
            return { ...out, source, ...(windowInfo ? { window: windowInfo, region: shift } : {}) };
        } finally {
            if (cleanup) { try { fs.unlinkSync(imagePath); } catch {} }
        }
    },
};

module.exports = { screenOcr, PS_CLEAN_TEXT, assertOcrPayload, buildWindowMissMessage, captureWindowToTemp };
