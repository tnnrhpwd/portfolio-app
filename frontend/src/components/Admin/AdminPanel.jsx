import React from 'react';

/**
 * AdminPanel — one pane of glass in an admin view.
 *
 * The admin console is a service page (FRONTEND_UI_STANDARD.md §5.7) built on an
 * **ambient glass** material (see the header of `pages/Admin/Admin.css`): panels
 * are translucent surfaces over a still brand gradient, with a gradient hairline
 * edge, a specular top highlight and a soft layered shadow. No `backdrop-filter`
 * anywhere.
 *
 * A panel's tone arrives three ways, all from the one `--admin-accent` its class
 * sets: a 3px accent rule along its top edge, a glow in its head, and a wash
 * through its glass. Its proportion bars inherit the same accent, so a panel's
 * data and its chrome read as one block.
 *
 * The console's palette is neutral plus exactly TWO hues (see "The palette" in
 * `Admin.css`), so there is no per-subject colour to hand a panel — every panel
 * simply wears the console's accent, and the only thing worth saying in colour
 * is that something needs a human.
 *
 * `<h2>` is the right level here: each view's `<h1>` lives in the sticky toolbar
 * (`AdminLayout`), so the panel titles are the next step in the outline.
 *
 * @param {string}   [title]  Panel heading — the view's only heading.
 * @param {string}   [hint]   One short line under the title. A label, not prose.
 * @param {React.ReactNode} [tools] Controls for the panel head (search, filter, save).
 * @param {string}   [tone]   Optional, and only ever for STATE: `ok`, `warn`,
 *   `bad` (or `accent` to be explicit about the default). Leaving it off is the
 *   normal case; passing `warn`/`bad` flips the block to the alert hue and shows
 *   its accent rule, which is what makes the exceptional panel exceptional.
 */
export default function AdminPanel({ title, hint, tools, tone, className = '', children }) {
  const toneClass = tone ? ` admin-tone--${tone}` : '';
  const hasHead = Boolean(title || hint || tools);

  return (
    <section className={`admin-panel${toneClass}${className ? ` ${className}` : ''}`}>
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
