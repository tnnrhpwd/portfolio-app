import React from 'react';

/**
 * AdminPanel — one plane of color in an admin view.
 *
 * The admin console is a service page (FRONTEND_UI_STANDARD.md §5.7), so its
 * panels are **planes of color, not cards**: a fill, a stronger wash of the same
 * hue for the head, no border, no outline, no shadow. Neighboring panels pick
 * different hues (`.admin-panel:nth-child(3n+…)` in `pages/Admin/Admin.css`), and
 * that difference in tone *is* the grouping.
 *
 * `<h2>` is the right level here: each view's `<h1>` lives in the sticky toolbar
 * (`AdminLayout`), so the panel titles are the next step in the outline.
 *
 * @param {string}   [title]  Panel heading — the view's only heading.
 * @param {string}   [hint]   One short line under the title. A label, not prose.
 * @param {React.ReactNode} [tools] Controls for the panel head (search, filter, save).
 * @param {'blue'|'mint'|'pink'|'orange'|'ok'|'bad'} [hue] Pin the hue instead of
 *   taking the automatic nth-child rotation — use it when a panel's meaning
 *   deserves a fixed color (a kill switch, a destructive action).
 */
export default function AdminPanel({ title, hint, tools, hue, className = '', children }) {
  const hueClass = hue ? ` admin-panel--${hue}` : '';
  const hasHead = Boolean(title || hint || tools);

  return (
    <section className={`admin-panel${hueClass}${className ? ` ${className}` : ''}`}>
      {hasHead && (
        <header className="admin-panel-head">
          <div className="admin-panel-heading">
            {title && <h2 className="admin-panel-title">{title}</h2>}
            {hint && <p className="admin-panel-hint">{hint}</p>}
          </div>
          {tools && <div className="admin-panel-tools">{tools}</div>}
        </header>
      )}
      <div className="admin-panel-body">{children}</div>
    </section>
  );
}
