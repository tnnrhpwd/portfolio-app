import React from 'react';

/**
 * Skeletons for the admin console.
 *
 * A service page's first paint is the moment it is most likely to look broken:
 * the sticky head already names the view, and the panels have not arrived yet. A
 * bare "Loading…" line in that gap makes a slow fetch look like a dead page.
 *
 * These placeholders are shaped like the content they stand in for — a KPI tile
 * is a label, a figure and a sub-line; a panel is a head and some rows — so the
 * layout does not jump when the data lands. They reuse the real `.kpi-card` and
 * `.admin-panel` classes, which means the glass, the radii and the responsive
 * grid are the genuine article rather than a lookalike that can drift.
 *
 * Everything here is `aria-hidden`; callers announce the wait themselves (a
 * `.sr-only` `role="status"` line, or the visible `.admin-loading` row), so a
 * screen reader hears "loading" instead of a wall of empty boxes.
 */

/** One shimmering block. Size it with an `admin-skeleton--*` modifier. */
export function Skeleton({ className = '' }) {
  return <span className={`admin-skeleton${className ? ` ${className}` : ''}`} />;
}

/** A row of KPI tiles, shaped exactly like the real ones. */
export function KpiSkeleton({ count = 6 }) {
  return (
    <div className="kpi-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="kpi-card" key={i}>
          <div className="kpi-inner">
            <Skeleton className="admin-skeleton--kpi-label" />
            <Skeleton className="admin-skeleton--kpi-value" />
            <Skeleton className="admin-skeleton--kpi-sub" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A glass panel holding `rows` placeholder lines. */
export function PanelSkeleton({ rows = 5 }) {
  return (
    <section className="admin-panel" aria-hidden="true">
      <header className="admin-panel-head">
        <Skeleton className="admin-skeleton--panel-title" />
      </header>
      <div className="admin-panel-body">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton
            key={i}
            className={i % 3 === 2 ? 'admin-skeleton--row-short' : 'admin-skeleton--row'}
          />
        ))}
      </div>
    </section>
  );
}
