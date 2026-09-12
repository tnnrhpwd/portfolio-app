import React from 'react';
import useScrollReveal from '../../../hooks/useScrollReveal';

/**
 * A full-bleed color band that fades and rises the first time it scrolls into
 * view.
 *
 * Bands — not cards — are how this page is divided: a change of color and a
 * change of subject, with no boxes around the content. Only compact controls
 * (inputs, pills, buttons) keep a border; everything else sits directly on the
 * band. See docs/guides/FRONTEND_UI_STANDARD.md §5.
 *
 * `tone` picks the band's flat color: 'surface' (the page color), 'tint' (a
 * mint wash) or 'wash' (a blue wash). Alternate them down the page.
 */
function RevealBand({
  tone = 'surface',
  eyebrow,
  title,
  description,
  actions,
  className = '',
  children,
}) {
  const [ref, visible] = useScrollReveal();
  const classes = [
    'annuities-band',
    `annuities-band--${tone}`,
    'annuities-reveal',
    visible ? 'is-visible' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section ref={ref} className={classes}>
      <div className="annuities-wrap">
        {(eyebrow || title || description || actions) && (
          <header className="annuities-band-head">
            {eyebrow && <p className="annuities-band-eyebrow">{eyebrow}</p>}
            {title && <h2 className="annuities-band-title">{title}</h2>}
            {description && <p className="annuities-band-lead">{description}</p>}
            {actions && <div className="annuities-band-actions">{actions}</div>}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

export default RevealBand;
