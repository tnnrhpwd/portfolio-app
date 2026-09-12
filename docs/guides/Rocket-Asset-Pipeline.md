# Rocket asset pipeline

Turns the eight AI-generated asset "posters" in `frontend/src/assets/rocket/*.jpg`
into **282 named, tightly-cropped, transparent PNGs** in `frontend/public/rocket/`.

The sheets are not tidy sprite sheets — each one is a labelled poster with rounded
panel frames, baked-in captions ("Play", "HEAVY LIFTER"), progress bars, and items
of wildly different sizes. So the extraction is spec-driven: a deterministic
detector finds the sprites, and `sheets.json` supplies the names (and pins the few
regions the detector cannot judge).

## Run it

```bash
node scripts/rocket/extract-sprites.js                  # every sheet
node scripts/rocket/extract-sprites.js --sheet effects  # one sheet
node scripts/rocket/extract-sprites.js --numbers        # overlay labels are #index
node scripts/rocket/extract-sprites.js --dump-detected  # -> scripts/rocket/detected.json
node scripts/rocket/extract-sprites.js --debug-mask     # write the foreground mask

node scripts/rocket/qa-composite.js                     # magenta QA contact sheets
```

`sharp` is required and is loaded from `backend/node_modules/sharp` (it is not
hoisted to the repo root).

Need more source sheets? `backend/scripts/generate-sprite-sheet.js` generates a
white-background sheet through Bedrock and prints the `sheets.json` entry to add
(see `docs/guides/STATIC_ASSETS_AND_IMAGE_GENERATION.md`, Part 3). Use `--dry-run`
first — it shows the prompt and whether credentials resolve, and costs nothing.

## Outputs

| Path | What | Shipped? |
| --- | --- | --- |
| `frontend/public/rocket/*.png` | the 282 sprites | yes (loaded at runtime) |
| `frontend/public/rocket/manifest.json` | name → file, size, source rect | yes |
| `docs/images/rocket/preview/index.html` | labelled proof sheet | no |
| `docs/images/rocket/preview/<sheet>-regions.png` | source sheet with every detected box | no |
| `docs/images/rocket/preview/qa-<sheet>.png` | every sprite on magenta (halo/hole check) | no |

Preview artefacts deliberately live under `docs/`, not `public/`, so the review
images never ship to production.

Stale PNGs are pruned on every run: renaming an asset in `sheets.json` cannot leave
an orphan behind. Names are also enforced unique **across all sheets**, because every
sheet exports into one flat folder.

## How detection works

1. **Classify pixels.** Page white *and* the light-grey panel fill are background
   (`bgLuma` / `bgSat`). Anything darker or more saturated is foreground.
2. **De-speckle.** JPEG ringing pushes a few percent of the panel fill under the
   threshold; left alone those stray pixels bridge every gutter and the whole sheet
   collapses into one blob.
3. **Connected components → erase the furniture.** A component is furniture when it is
   - `tiny` — a speck or an anti-aliasing sliver,
   - `frame` — large and nearly empty inside its own box (a panel outline, a blank panel),
   - `bar` — solid and extremely elongated (a progress bar),
   - `text` — short, desaturated and sparse (a caption or panel title).
   Erasing text *before* segmenting is what lets a caption row collapse and the icon
   rows above and below it merge into a clean gutter.
   Order matters: outlines must be judged as *whole* outlines. Strip their long
   straight edges first and a blank panel is reduced to four corner arcs that look
   exactly like four small sprites.
4. **XY-cut.** Recursively split the remaining mask on the empty gutters — rows first,
   then columns. A leaf is one sprite, and the DFS order is reading order
   (top→bottom, left→right), which is the order `names` is applied in.
   Row-first also means "one row band per panel row", so a sheet whose left and right
   panels are not vertically aligned still segments correctly.
   Proximity-chaining was tried first and rejected: it cascades, swallowing whole panels.
5. **Export.** Per crop: a soft alpha ramp from the RGB distance to the *local*
   background colour, un-matting (de-fringe) so anti-aliased edges keep no white halo,
   then a flood fill from the crop border so **enclosed** light pixels — white rocket
   bodies, visor highlights — stay opaque instead of being punched into holes.
   Finally trim to content and cap the longest side.

## sheets.json

```jsonc
{
  "defaults": { "pad": 12, "minSize": 30, "maxDim": 160, "png": { "palette": true } },
  "sheets": [
    {
      "id": "effects",                 // used for output file names and CLI --sheet
      "title": "Explosions, ...",      // shown in the proof sheet
      "file": "Gemini_...jpg",         // source sheet in frontend/src/assets/rocket
      "options": { "minGutterRow": 14 },// any detector/export knob, per sheet
      "exclude": [ { "x": 0.58, "y": 0.02, "w": 0.41, "h": 0.58 } ],
      "regions": [ { "name": "ui-star-gold", "x": 0.04, "y": 0.7, "w": 0.042, "h": 0.076 } ],
      "names": ["explosion-small-red", "explosion-small-red-2", "..."],
      "gridNames": { "rows": 5, "cols": 9, "names": ["planet-saturn-tan", "..."] }
    }
  ]
}
```

- **`names`** — auto-detected sprites, in reading order. A count mismatch prints a
  warning naming how many were found versus how many names were supplied.
- **`gridNames`** — for the two regular r×c sheets. Names are matched to sprites by
  **cell position**, not detection order, so a merged pair or a missed item can never
  shift every name by one. Unmatched/short cells are reported. `expectGaps` downgrades
  that report to a note when the gaps are deliberate.
- **`exclude`** — rectangles whose contents must never become assets (the ratings
  demo grid, the "Scale and Layering Examples" mock-ups, progress-bar chrome).
- **`regions`** — hand-placed crops. Two real uses:
  - the grey (empty) rating stars look *exactly* like caption glyphs, so they are
    erased by the text filter and re-taken as regions;
  - four ringed planets on `planets-b` are drawn with the ring **over** the
    neighbouring planet. They are physically connected in the pixels, so no gutter
    can separate them; `exclude` drops the fusion and eight regions re-take the pairs.
  Regions use `regionPad` (2px) rather than `pad` (12px): they are authored precisely,
  so a wide pad would only pull in whatever sits on the other side of the gutter.
- **Corners and rectangles are fractions of the sheet** unless `"unit": "px"` is set.

## Sizing and weight

Cartoon art with soft glows is expensive as 32-bit PNG — roughly 80 KB for a 256px
sprite, which put the first full export at **22 MB**. Three changes brought the set to
**~4 MB**:

- `maxDim: 160` by default (sprites are drawn small on a 1280×720 canvas), raised
  per sheet where it matters: **320** for the two grids, **384** for the rockets,
  **512** for the backdrops;
- PNG palette quantization (`png.palette` with `quality: 92`) — the single biggest win,
  visually lossless on this art;
- pruning stale exports.

If a smaller payload is ever needed, switching `png` to WebP is a one-line change.

## Review workflow

1. Run the extractor.
2. Open `docs/images/rocket/preview/index.html` — every sprite with its name, plus the
   source sheet with all detected boxes drawn on it.
3. `qa-<sheet>.png` is the strict check: sprites on magenta, so a leftover white fringe
   or a hole punched through a white area is immediately obvious.
4. Fix `sheets.json` (rename, move an `exclude`, adjust a `regions` box) and re-run.
   Nothing else needs touching.

## Known limitations

- The faintest spark-burst frames in the `effects` sheet are near-white and get erased
  by the text/de-saturation filter; their brighter siblings in the same panel are all
  present, so the animation is covered.
- `planets-a` row 3 has a rocket plus several loose debris fragments in the space of
  three cells, so that row yields more sprites than cells; the extras take a `-2`/`-3`
  suffix.
- Panels, progress bars, the `LEVEL UP!` wordmark and the digit font are intentionally
  **not** exported — they are UI chrome that is drawn in code.
