/**
 * Colour schemes — WHICH hue plays which role.
 *
 * This is a separate axis from the light/dark MODE, and deliberately so: the
 * scheme decides what the accent and primary hues ARE, the mode decides how
 * light the surface under them is. Every scheme therefore has both a light and a
 * dark version WITHOUT carrying two palettes: `index.css` keeps only the hue and
 * derives everything else per mode — see the note there.
 *
 * `accent` / `primary` below are the IDENTITY HUES, not the colours that get
 * painted. `index.css` derives the per-mode accents and the backdrops from them,
 * so these only have to be the right HUE — their lightness is replaced. Hex
 * rather than a token reference because that is what a swatch wants to read.
 *
 * ⚠️ These hexes are MIRRORED in the `body[data-scheme='x']` rules in `index.css`
 * — CSS cannot read JS, so each hue is written twice. Nothing consumes the copies
 * down here today (the picker needs only `id` and `label`); they are kept so a
 * swatch can paint the true colour without a DOM round-trip. Change a hue in one
 * place and change it in the other.
 */

/** `accent` is the console-ish hue (links, focus, interaction, the room).
 *  `primary` is the emphasis hue (the one action per view, the headline figure).
 *  Roles, not positions. The names are shared with the desktop addon, whose own
 *  appearance list (`simple-addon/renderer/appearance/appearance.js`) is a mirror
 *  of this one — so `/net`, `/profile` and the addon's window offer the same
 *  choices under the same names. (The web chat used to keep a second, rival list
 *  of full palettes under these names; it is gone — see `SimpleTheme.css`.)
 *  `ocean` leads the list because it is the DEFAULT — the first thing the picker
 *  offers is the one a new visitor is already looking at. */
export const SCHEMES = [
  { id: 'ocean', label: '🌊 Ocean', accent: '#06b6d4', primary: '#3b82f6' },
  { id: 'aurora', label: 'Aurora', accent: '#00c1c1', primary: '#ff379b' },
  { id: 'crimson', label: '❤️ Crimson', accent: '#dc2626', primary: '#f472b6' },
  { id: 'emerald', label: '💎 Emerald', accent: '#10b981', primary: '#06b6d4' },
  { id: 'sakura', label: '🌸 Sakura', accent: '#ec4899', primary: '#a78bfa' },
  { id: 'midnight', label: '🌃 Midnight Blue', accent: '#3b82f6', primary: '#8b5cf6' },
  { id: 'sunset', label: '🌅 Sunset', accent: '#f97316', primary: '#ec4899' },
  { id: 'cyberpunk', label: '🔮 Cyberpunk', accent: '#f0e030', primary: '#e040fb' },
  { id: 'monokai', label: '🖥️ Monokai', accent: '#a6e22e', primary: '#66d9ef' },
  { id: 'usa', label: '🇺🇸 USA', accent: '#b22234', primary: '#3c3b6e' },
  { id: 'forest', label: '🌲 Forest', accent: '#4d8c57', primary: '#65a30d' },
  // The one scheme with no hue at all: its two roles are told apart by LIGHTNESS
  // instead, and `index.css` turns the shared chroma off for it — a grey handed
  // chroma is not a grey.
  { id: 'neutral', label: '⚫ Neutral', accent: '#808080', primary: '#808080' },
];

/** What a NEW visitor gets, and the fallback for anything unrecognised in
 *  storage — so a stale value can never leave the site colourless.
 *  ⚠️ Keep this in step with the two things outside JS that assume the default:
 *  the `SCHEMES` order above, and the custom scheme's seed in `index.css`. */
export const DEFAULT_SCHEME = 'ocean';

/** The one scheme a visitor BUILDS. It is not in `SCHEMES` because it has no
 *  fixed hues to list — its two arrive at runtime — but it is a scheme in every
 *  other respect: `index.css` derives its tokens with the same rule and only
 *  changes where the two hues come FROM. */
export const CUSTOM_SCHEME = 'custom';

const STORAGE_KEY = 'scheme';
const CUSTOM_KEY = 'schemeCustom';
const HEX = /^#[0-9a-f]{6}$/i;

/** Is `id` one of ours? Guards every read, because the stored value is a string
 *  a user can edit and an unknown id would leave `data-scheme` pointing at a
 *  selector that does not exist — i.e. no scheme at all, silently. */
export function isScheme(id) {
  return id === CUSTOM_SCHEME || SCHEMES.some((s) => s.id === id);
}

/* ══ Custom colours ══════════════════════════════════════════════════════════
 *
 * ⚠️ `primary` / `secondary` here are the VISITOR'S words, not the tokens'. The
 * picker labels them that way, so the stored pair does too — and the mapping onto
 * the CSS is made in this file and NOWHERE else:
 *
 *     primary   -> `--scheme-hue-accent`  -> `--scheme-accent`
 *     secondary -> `--scheme-hue-primary` -> `--scheme-primary`
 *
 * i.e. "Primary" is the DOMINANT hue (links, focus rings, interaction, the room)
 * and "Secondary" is the partner hue — which is the one the codebase calls
 * `primary`. The tokens are named for a role in the design system, the labels for
 * what a visitor means by the word; the two spellings must not meet again.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The stored pair, or null. Never throws: storage is user-editable, and a
 *  half-written pair should fall back rather than take the page down. */
function readCustom() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null');
    return raw && HEX.test(raw.primary) && HEX.test(raw.secondary) ? raw : null;
  } catch {
    return null;
  }
}

/** The pair behind the Custom scheme. With nothing stored it is SEEDED from
 *  `fallbackId`, so choosing Custom while looking at Sakura opens the pickers on
 *  Sakura's own two hues instead of on an arbitrary default — which makes Custom a
 *  starting point rather than a blank page. */
export function getCustomColors(fallbackId) {
  const stored = readCustom();
  if (stored) return stored;
  // `schemeById` falls back to the default record, so this cannot come back
  // half-formed however it is called.
  const seed = schemeById(fallbackId);
  return { primary: seed.accent, secondary: seed.primary };
}

/** Set one or both custom colours. Anything that is not a six-digit hex is
 *  ignored rather than stored: `input[type=color]` is the only caller, and a bad
 *  value would go straight into a CSS custom property. Returns the pair in force. */
export function setCustomColors(primary, secondary) {
  const current = getCustomColors();
  const next = {
    primary: HEX.test(primary) ? primary.toLowerCase() : current.primary,
    secondary: HEX.test(secondary) ? secondary.toLowerCase() : current.secondary,
  };
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
  if (document.body.dataset.scheme === CUSTOM_SCHEME) paint(CUSTOM_SCHEME);
  return next;
}

/** Put a scheme on the body. The ONE place that writes `data-scheme`.
 *
 *  Custom carries its hues as INLINE custom properties, a stylesheet having no
 * way to hold a value the visitor has just chosen. Inline is also the only place
 * they can live without out-ranking the named schemes — so they are removed the
 * moment a named scheme is applied, and that is not tidiness: an inline property
 * beats every stylesheet rule, so a stale pair would silently override whatever
 * scheme was picked next. */
function paint(scheme) {
  document.body.dataset.scheme = scheme;
  if (scheme === CUSTOM_SCHEME) {
    const { primary, secondary } = getCustomColors();
    document.body.style.setProperty('--scheme-hue-accent', primary);
    document.body.style.setProperty('--scheme-hue-primary', secondary);
  } else {
    document.body.style.removeProperty('--scheme-hue-accent');
    document.body.style.removeProperty('--scheme-hue-primary');
  }
}

/** Paint a scheme and remember it. Returns the id actually applied. */
export function setScheme(id) {
  const scheme = isScheme(id) ? id : DEFAULT_SCHEME;
  // First visit to Custom: seed the pair from the scheme being replaced, so the
  // pickers open on the colours already on screen. Written straight to storage
  // rather than through `setCustomColors`, which would repaint on the way past.
  if (scheme === CUSTOM_SCHEME && !readCustom()) {
    const seed = schemeById(document.body.dataset.scheme);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify({ primary: seed.accent, secondary: seed.primary }));
  }
  paint(scheme);
  localStorage.setItem(STORAGE_KEY, scheme);
  return scheme;
}

/** Paint whatever was chosen last, or the default. Called on mount by the
 *  header, which is on every page — the same place, and for the same reason, as
 *  the theme. Does not re-persist: reading is not choosing.
 *
 *  ⚠️ This is no longer the FIRST thing to paint the scheme. `index.html` paints
 *  the stored one before React boots, because a mount effect lands a frame after
 *  the first paint — and later still on a lazy route, whose chunk is fetched while
 *  the default palette is already on screen. This stays the authority (it validates
 *  the id, and it owns the repaint); the two must agree on the storage shape. */
export function initScheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  paint(isScheme(stored) ? stored : DEFAULT_SCHEME);
  return document.body.dataset.scheme;
}

/** The full record for an id, for a picker that needs the labels and swatches. */
export function schemeById(id) {
  return SCHEMES.find((s) => s.id === id) || SCHEMES.find((s) => s.id === DEFAULT_SCHEME);
}
