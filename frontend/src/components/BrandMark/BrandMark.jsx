import React from 'react';
import {
  VIEW_BOX,
  CENTRE,
  DISC_RADIUS,
  RING_RADIUS,
  RING_STROKE,
  CHECK_PATH,
  CHECK_STROKE,
  CHECK_KEYLINE_STROKE,
} from './geometry';
import PlateSource from '../../assets/brand-mark.png';
import './BrandMark.css';

/** The header renders the mark at 0.8 of the header band, which is what the old
 *  512px PNG was being drawn at — so this default leaves every existing layout
 *  where it was. Callers that want a different size pass one. */
const DEFAULT_SIZE = 'calc(var(--nav-size) * 0.8)';

/**
 * The Simple brand mark.
 *
 * An INLINE svg, not an `<img>`, and that is the entire point: an image is a sealed
 * box, so CSS cannot reach inside it and the mark could never take the visitor's
 * colour scheme. Inline, the ring and the check are two ordinary elements whose
 * `stroke` is a token — which is why the mark follows the scheme on the default
 * (Ocean) pair and every other one.
 *
 * ⚠️ Geometry comes from `./geometry.js`; COLOUR lives entirely in `BrandMark.css`.
 * Don't add a `fill` or `stroke` attribute here — it would out-rank the stylesheet's
 * token and silently pin the mark to one scheme.
 *
 * @param {object}  [props]
 * @param {'full'|'plate'} [props.variant] `full` = the live, scheme-aware mark.
 *   `plate` = the static raster, and it exists for exactly one caller:
 *   `ProfileAvatar`'s default face, which must NOT follow the scheme (a user's own
 *   face should not be a different colour on their phone than on their laptop).
 * @param {string}  [props.size]  Any CSS length. Defaults to the header's size.
 * @param {string}  [props.title] Accessible name. Omit it wherever the adjacent text
 *   already names the product, and the mark is announced as decorative.
 * @param {string}  [props.className] Extra classes for the caller.
 */
function BrandMark({ variant = 'full', size = DEFAULT_SIZE, title, className = '' }) {
  const kind = variant === 'plate' ? 'plate' : 'full';
  const classes = `brand-mark brand-mark--${kind} ${className}`.trim();
  const style = { width: size, height: size };

  if (kind === 'plate') {
    return (
      <img className={classes} src={PlateSource} alt={title || ''} style={style} draggable={false} />
    );
  }

  return (
    <svg
      className={classes}
      viewBox={VIEW_BOX}
      style={style}
      {...(title
        ? { role: 'img', 'aria-label': title }
        : { 'aria-hidden': 'true', focusable: 'false' })}
    >
      {/* Drawn back to front: field, then frame, then glyph. The check is LAST so it
          crosses in front of the ring, as it does in the artwork. */}
      <circle className="brand-mark__disc" cx={CENTRE.x} cy={CENTRE.y} r={DISC_RADIUS} />
      <circle
        className="brand-mark__ring"
        cx={CENTRE.x}
        cy={CENTRE.y}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
      />
      <path
        className="brand-mark__check-keyline"
        d={CHECK_PATH}
        fill="none"
        strokeWidth={CHECK_KEYLINE_STROKE}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <path
        className="brand-mark__check"
        d={CHECK_PATH}
        fill="none"
        strokeWidth={CHECK_STROKE}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export default BrandMark;
