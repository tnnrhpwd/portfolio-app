import React from 'react';
import { Link } from 'react-router-dom';
import useScrollReveal from '../../../hooks/useScrollReveal';
import { ADDON_DOWNLOAD_URL } from '../../../hooks/simpleAddon/useAddonDetection.js';
import { SIMPLE_SURFACES } from '../../../constants/simpleSurfaces';
import './SimpleCtaBand.css';

/**
 * SimpleCtaBand — the closing band every Discovery page ends on.
 *
 * **Service first, price second.** The band leads with the three things a
 * visitor can actually *do* (Chat / Control / Goals) and the addon download,
 * and leaves "what does it cost?" as one quiet line underneath them. Asking for
 * money before the product has been used is the wrong order — people pay once
 * they like the thing, so the CTA's job is to get them using it, not to get
 * them to /pricing. See docs/implementation/agent.md §16.5 (rule 1).
 *
 * It is shared by `/home` and `/projects` rather than copy-pasted so the
 * vocabulary cannot drift: the cards read from `SIMPLE_SURFACES`, the same list
 * the header's `SimpleNav` switcher renders — so the three words a visitor meets
 * in the nav are the three words the band shows.
 */
export default function SimpleCtaBand({ className = '' }) {
  const [ref, visible] = useScrollReveal();

  return (
    <section
      ref={ref}
      className={`simple-cta ${visible ? 'is-visible' : ''} ${className}`.trim()}
    >
      <div className="simple-cta-wrap">
        <p className="simple-cta-eyebrow">Simple</p>
        <h2 className="simple-cta-title">Say it, watch it, keep it</h2>
        <p className="simple-cta-sub">
          Three rooms, one agent. Ask for work in chat, watch it run on your own Windows PC,
          and keep what it learns so the next run costs you less.
        </p>

        {/* The two ways in: talk to it now, or put it on your PC. */}
        <div className="simple-cta-actions">
          <Link className="simple-cta-btn simple-cta-btn--inv" to="/net">
            Start chatting <span aria-hidden="true">→</span>
          </Link>
          <a
            className="simple-cta-btn simple-cta-btn--ghost"
            href={ADDON_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Download the addon
          </a>
        </div>

        <ul className="simple-cta-surfaces">
          {SIMPLE_SURFACES.map((surface) => (
            <li className="simple-cta-surface" key={surface.to}>
              <Link className="simple-cta-surface-link" to={surface.to}>
                <h3 className="simple-cta-surface-title">
                  <span className="simple-cta-surface-icon" aria-hidden="true">{surface.icon}</span>
                  {surface.label}
                  <span className="simple-cta-surface-arrow" aria-hidden="true">→</span>
                </h3>
                <p className="simple-cta-surface-desc">{surface.desc}</p>
              </Link>
            </li>
          ))}
        </ul>

        {/* Price is the afterthought — one quiet line, after the product. */}
        <p className="simple-cta-note">
          Free to start. Wondering what it costs?{' '}
          <Link to="/pricing">See pricing <span aria-hidden="true">→</span></Link>
        </p>
      </div>
    </section>
  );
}
