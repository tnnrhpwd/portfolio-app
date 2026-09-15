/**
 * Brand-mark geometry — the shape of the logo, and ONLY the shape.
 *
 * ⚠️ COLOUR IS NOT HERE. Every fill and stroke lives in `BrandMark.css`, bound to a
 * scheme token. That split is the whole point: geometry is a constant that a test can
 * check against the master artwork, colour is a token that has to vary at runtime.
 * Putting a fill in this file would quietly take the mark off the scheme.
 *
 * ⚠️ THESE NUMBERS ARE MIRRORED in `frontend/src/assets/brand-mark.svg`, because a
 * raster surface (favicon, tray icon, installer icon) cannot be an inline React
 * element — it needs a real file, and `scripts/generate-logo-assets.js` generates
 * those from that file. Two copies, one test: `BrandMark.test.jsx` parses the SVG and
 * fails if the two drift. Change a number here and change it there.
 *
 * The values were derived from the source render (2816x1536) and normalised into a
 * 64-unit box — see the comment in `brand-mark.svg` for the two places the redraw
 * deliberately simplifies the AI-generated original (a true circle for a ~3% ellipse,
 * a uniform stroke for a ~15% taper).
 */

/** A 64-unit box. The ring's outer edge reaches 29.59 from a centre at 30.87, so the
 *  mark fills the box edge to edge with a hair of margin for anti-aliasing. */
export const VIEW_BOX = '0 0 64 64';

/** The ring's centre. NOT (32,32): the mark is centred on its own bounding box, and
 *  the check overshoots the ring to the upper right, which pulls the ring left and
 *  down. Centring the ring instead would make the check look like it had escaped. */
export const CENTRE = { x: 30.87, y: 32.49 };

/** The inner field: the ring's inner edge, plus a half-unit of overlap so no
 *  anti-aliasing seam shows between the disc's edge and the ring's inner edge. */
export const DISC_RADIUS = 25.5;

/** The ring, as a centreline radius plus a stroke — which is what makes it a ring
 *  rather than a donut path, and lets `stroke-width` be one number to tune. */
export const RING_RADIUS = 27.46;
export const RING_STROKE = 4.25;

/** The check: three points, stroked. The elbows come free — a butt cap gives the
 *  angled cut at each tip, and `stroke-linejoin: miter` gives the pointed bottom,
 *  both of which is what the source has. */
export const CHECK_PATH = 'M14.8 29.28 L27.67 44.14 L59.44 5.96';
export const CHECK_STROKE = 8.51;

/** The keyline: a hair of the surface colour painted UNDER the check, so the glyph
 *  separates from the ring where it crosses it.
 *
 *  ⚠️ READ THE NUMBERS BEFORE REMOVING THIS. A scheme pins BOTH of its identity hues
 *  to the same lightness (0.52 light / 0.76 dark) and differs only in hue, so where the
 *  ring and the check overlap they are very nearly the same tone. Measured across all
 *  twelve schemes by painting each one and reading the pixel back: ring-vs-check
 *  contrast is 1.01-1.20 in light and 1.01-1.11 in dark. Only `neutral` clears it
 *  (1.98 / 1.40) because that is the one scheme whose two roles are separated by
 *  LIGHTNESS on purpose.
 *
 *  A 1.1:1 edge is carried by hue alone, and in the schemes whose two hues are close
 *  the glyph genuinely fuses into the ring — Forest's green against lime is 16 degrees
 *  of hue apart at 1.02:1, Emerald's teal against green 50 degrees at 1.02:1. The
 *  artwork solves this with a black keyline; a themed mark has to solve it with a TONE,
 *  and the tone that is always right is the field's own colour: invisible against the
 *  discord, and a clean gap across the ring band.
 *
 *  What it costs: where the glyph's tip leaves the mark there is no field behind it, so
 *  the keyline shows as a hairline fringe. At 0.6 units a side that is 0.36px at the
 *  header's 38px, which is why it is accepted rather than clipped away.
 *
 *  ⚠️ Written as a literal rather than computed, and that matters: `CHECK_STROKE + 1.2`
 *  evaluates to 9.709999999999999, which would both render as a 17-digit SVG attribute
 *  and stop matching the master artwork. The two numbers are kept in step by the test.
 *  It is CHECK_STROKE plus 1.2, i.e. 0.6 units of gap on each side of the glyph. */
export const CHECK_KEYLINE_STROKE = 9.71;
