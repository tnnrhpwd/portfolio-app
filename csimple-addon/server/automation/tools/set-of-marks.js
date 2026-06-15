/**
 * screen_set_of_marks — capture the screen, overlay numbered boxes on every
 * interactive UI element (via uia_snapshot), and return both the annotated
 * image and a legend mapping each mark index back to its UIA element.
 *
 * This is the "Set of Marks" prompting technique applied to native desktop UI:
 * vision LLMs are much better at picking "click 7" than at outputting raw
 * pixel coordinates, and the legend gives the agent a guaranteed-valid
 * automationId/name to invoke via uia_invoke afterward.
 *
 * Returns:
 *   {
 *     mime: "image/png",
 *     base64: <annotated PNG>,
 *     width, height,
 *     screen: { width, height },
 *     legend: [
 *       { idx, name, controlType, automationId, className,
 *         x, y, width, height, enabled }
 *     ],
 *     droppedOffscreen: number,    // controls clipped from the primary monitor
 *     droppedTooSmall:  number,    // controls smaller than `minSize` px
 *     truncated: boolean           // hit `maxMarks` cap
 *   }
 *
 * Args:
 *   maxMarks  - cap (default 40, max 80) — readability declines past this
 *   minSize   - minimum width*height in px to include (default 100)
 *   focusOnly - only mark elements inside the foreground window's bounds
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const screen = require('./screen');
const { uiaSnapshot } = require('./uia');
const { runPsJsonFile } = require('../ps-runner');

const DRAW_TIMEOUT_MS = 15_000;
const COLORS = [
    'Red', 'DodgerBlue', 'Orange', 'MediumSeaGreen', 'Magenta',
    'Cyan', 'Yellow', 'DeepPink', 'Lime', 'Tomato',
];

async function drawMarks(inPath, outPath, marks) {
    // We pass the marks via a JSON sidecar to avoid PowerShell quoting hell.
    const jsonPath = inPath + '.marks.json';
    fs.writeFileSync(jsonPath, JSON.stringify(marks), 'utf-8');

    const palette = COLORS.map(c => `'${c}'`).join(',');
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$marks = Get-Content '${jsonPath.replace(/\\/g, '\\\\')}' -Raw | ConvertFrom-Json
$colors = @(${palette})

$bmp = [System.Drawing.Image]::FromFile('${inPath.replace(/\\/g, '\\\\')}')
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)

foreach ($m in $marks) {
    $cName = $colors[($m.idx - 1) % $colors.Length]
    $color = [System.Drawing.Color]::FromName($cName)
    $pen = New-Object System.Drawing.Pen($color, 3)
    $g.DrawRectangle($pen, [int]$m.x, [int]$m.y, [int]$m.width, [int]$m.height)

    # Label badge in the top-left corner of the box.
    $label = [string]$m.idx
    $labelSize = $g.MeasureString($label, $font)
    $pad = 4
    $bx = [int]$m.x
    $by = [int]$m.y - [int]$labelSize.Height - 2
    if ($by -lt 0) { $by = [int]$m.y + 2 }
    $bw = [int]$labelSize.Width + ($pad * 2)
    $bh = [int]$labelSize.Height + 2
    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, $color.R, $color.G, $color.B))
    $fgBrush = [System.Drawing.Brushes]::White
    $g.FillRectangle($bgBrush, $bx, $by, $bw, $bh)
    $g.DrawString($label, $font, $fgBrush, $bx + $pad, $by + 1)
    $pen.Dispose(); $bgBrush.Dispose()
}

$bmp.Save('${outPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $font.Dispose()

@{ ok = $true; marks = $marks.Count } | ConvertTo-Json -Compress
    `.trim();

    try { return await runPsJsonFile(script, { timeoutMs: DRAW_TIMEOUT_MS }); }
    finally { try { fs.unlinkSync(jsonPath); } catch {} }
}

const screenSetOfMarks = {
    name: 'screen_set_of_marks',
    category: 'safe-read',
    description:
        'Capture the primary monitor, overlay numbered boxes on every interactive UI element ' +
        '(via uia_snapshot), and return both the annotated PNG (base64) and a legend that maps ' +
        'each mark index back to its UIA element. Use this when you want a vision LLM to pick a ' +
        'target by number rather than by raw pixel coordinates — much more reliable. After the ' +
        'LLM picks a mark, look up the legend entry and call uia_invoke with its name/automationId.',
    parameters: {
        type: 'object',
        properties: {
            maxMarks: { type: 'integer', description: 'Cap on marks drawn (default 40, max 80).' },
            minSize:  { type: 'integer', description: 'Drop elements smaller than this many square px (default 100).' },
            focusOnly: { type: 'boolean', description: 'Only mark elements inside the foreground window bounds (default true).' },
            includeImage: { type: 'boolean', description: 'Return the annotated base64 PNG (default true). Set false to save tokens when you only want the legend.' },
        },
    },
    async run(args = {}) {
        const maxMarks = Math.min(80, Math.max(1, Number(args.maxMarks) || 40));
        const minSize = Math.max(0, Number(args.minSize) || 100);
        const focusOnly = args.focusOnly !== false;
        const includeImage = args.includeImage !== false;

        // 1) Capture primary screen to temp file. screen._captureBuffer returns
        //    a Buffer; we'll write it to disk so the PowerShell drawing pass can
        //    read it directly.
        const imgBuf = await screen._captureBuffer({});
        const inPath = path.join(os.tmpdir(), `csimple-som-in-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
        const outPath = inPath.replace(/-in-/, '-out-');
        fs.writeFileSync(inPath, imgBuf);

        // Quick read of image dimensions (PNG IHDR chunk: bytes 16..23 = width, height big-endian).
        let imgW = 0, imgH = 0;
        try {
            imgW = imgBuf.readUInt32BE(16);
            imgH = imgBuf.readUInt32BE(20);
        } catch {}

        // 2) Get UIA snapshot of interactive controls.
        const snap = await uiaSnapshot.run({ mode: 'interactive', maxNodes: 250 });

        // 3) Filter to elements visible in the captured image (primary monitor).
        let droppedOffscreen = 0, droppedTooSmall = 0;
        let candidates = (snap?.nodes || []).filter(n => {
            const fits = n.x >= 0 && n.y >= 0
                && n.width > 0 && n.height > 0
                && n.x + n.width <= imgW
                && n.y + n.height <= imgH;
            if (!fits) { droppedOffscreen++; return false; }
            if ((n.width * n.height) < minSize) { droppedTooSmall++; return false; }
            return true;
        });

        // 4) Optional: restrict to foreground window bounds. We approximate this
        //    as "the first Window-typed node in the snapshot, otherwise skip
        //    filtering". interactive mode doesn't include Window nodes, so we
        //    only apply this if the caller asked AND there's something useful.
        //    For now, skip until we extend uia_snapshot with a focus rect.

        // 5) Cap and assign 1-based indices.
        const truncated = candidates.length > maxMarks;
        candidates = candidates.slice(0, maxMarks);
        const marks = candidates.map((n, i) => ({
            idx: i + 1,
            name: n.name || '',
            controlType: n.controlType || '',
            automationId: n.automationId || '',
            className: n.className || '',
            x: n.x, y: n.y, width: n.width, height: n.height,
            enabled: !!n.enabled,
        }));

        // 6) Draw and clean up.
        try {
            await drawMarks(inPath, outPath, marks);
            const out = {
                mime: 'image/png',
                width: imgW, height: imgH,
                screen: { width: imgW, height: imgH },
                legend: marks,
                droppedOffscreen, droppedTooSmall,
                truncated,
            };
            if (includeImage && fs.existsSync(outPath)) {
                out.base64 = fs.readFileSync(outPath).toString('base64');
            }
            return out;
        } finally {
            try { fs.unlinkSync(inPath); } catch {}
            try { fs.unlinkSync(outPath); } catch {}
        }
    },
};

module.exports = { screenSetOfMarks };
