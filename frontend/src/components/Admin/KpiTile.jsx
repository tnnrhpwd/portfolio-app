import React from 'react';

/**
 * Writes the pointer's position inside the element onto that element as `--mx`
 * / `--my`, which is what drives the radial spotlight on a tile (Admin.css §7).
 *
 * Two deliberate choices:
 *
 * - It writes to the element's own `style` object, so a pointermove never
 *   touches React state and never re-renders the view. A dashboard that
 *   re-rendered six tiles on every mousemove would be a worse dashboard.
 * - It ignores anything that is not a mouse. A touch drag fires `pointermove`
 *   too, and without this guard a tile would keep a highlight stuck wherever the
 *   finger last landed.
 *
 * It lives here, with the tile, because the spotlight is the tile's own business.
 */
export const trackPointer = (event) => {
  if (event.pointerType !== 'mouse') return;
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  el.style.setProperty('--my', `${event.clientY - rect.top}px`);
};

/**
 * KpiTile — one figure in the console's readout strip.
 *
 * A tile is a small pane of the same glass as a panel, wearing the console's
 * accent, so the strip reads as one instrument rather than as six unrelated
 * boxes. The console's palette is neutral plus exactly TWO hues (see "The
 * palette" in `pages/Admin/Admin.css`) — one for the console itself, one for
 * anything that wants a human — so a tile has no subject colour to choose.
 *
 * `tone` therefore only ever means STATE, and leaving it off is the normal case:
 *
 * - Off: the tile sits in the accent like everything else on the page.
 * - `warn` / `bad`: the figure has crossed something, so the tile flips to the
 *   alert hue and gains its accent rule. Pass it ONLY when that is true — a tone
 *   applied unconditionally is how a colour stops meaning anything.
 * - `ok`: nominal, worth a rule when the same strip carries a warn elsewhere.
 *
 * @param {string} label  Small uppercase caption. A label, never a sentence.
 * @param {React.ReactNode} value  The figure. This is the tile's whole subject.
 * @param {React.ReactNode} [sub]  One short line under it — a delta, a total.
 * @param {string} [tone]  ok | warn | bad | accent. State only.
 */
export default function KpiTile({ label, value, sub, tone, className = '' }) {
  const toneClass = tone ? ` admin-tone--${tone}` : '';

  return (
    <div className={`kpi-card${toneClass}${className ? ` ${className}` : ''}`} onPointerMove={trackPointer}>
      <div className="kpi-inner">
        <span className="kpi-label">{label}</span>
        <span className="kpi-value">{value}</span>
        {sub && <span className="kpi-sub">{sub}</span>}
      </div>
    </div>
  );
}
