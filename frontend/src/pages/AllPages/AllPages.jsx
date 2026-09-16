import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import NotFound from '../NotFound/NotFound';
import { canUseAdminConsole } from '../../constants/admin';
import { ACCESS_LABELS, PAGE_GROUPS, flattenPages } from '../../constants/pages';
import './AllPages.css';

/**
 * `/all` — the index of every page in the app, for the owner.
 *
 * It is generated from `constants/pages.js`, which is also what `App.js` builds
 * its routes from, so it cannot go stale: **adding a page is one entry in the
 * manifest** and it shows up here with its path and its badge. Nothing on this
 * page lists routes by hand.
 *
 * A SERVICE PAGE (UI_LAYOUT.md §5.7): one flat room, a row at the
 * top carrying the name and the live count, then a dense panel grid. No bands,
 * no reveals — this is a tool for finding a URL, not a story about one.
 *
 * ACCESS: admin or a "Special" account (`canUseAdminConsole`), and nothing else.
 * Anyone else gets the 404 the route would give a stranger — the page is not
 * advertised anywhere they can see, so a 404 is both honest and quiet.
 * The check is cosmetic, like every client-side gate here: this page reads a
 * static manifest, so there is nothing behind it to protect.
 */

/** One row: the page's name, its path, and who it is for. */
function PageRow({ page }) {
  const badge = ACCESS_LABELS[page.access] || page.access;
  // A parameterised path (`/u/:username`) and a redirect are not addresses you
  // can click — one needs a value, the other is not a page at all.
  const linkable = !page.dynamic && !page.redirect;

  const body = (
    <>
      <span className="all-row-name">{page.label}</span>
      <span className="all-row-meta">
        <code className="all-row-path">{page.path}</code>
        {page.redirect && <span className="all-chip">→ {page.redirect}</span>}
        {page.dynamic && <span className="all-chip">needs a value</span>}
        {(page.aliases || []).map((alias) => (
          <span className="all-chip all-chip--alias" key={alias}>also {alias}</span>
        ))}
      </span>
      <span className={`all-badge all-badge--${page.access}`}>{badge}</span>
    </>
  );

  // The WHOLE row is the target rather than the four-word name alone: an index
  // this long is scanned and clicked fast, and a small link is a small thing to
  // hit. A template or a redirect has nowhere to go, so it stays plain text.
  return (
    <li className="all-row" title={page.note || undefined}>
      {linkable ? (
        <Link className="all-row-hit" to={page.path}>{body}</Link>
      ) : (
        <span className="all-row-hit all-row-hit--static">{body}</span>
      )}
    </li>
  );
}

function AllPages() {
  const { user } = useSelector((state) => state.data);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const isAuthorized = canUseAdminConsole(user);

  // The manifest is static, so this is computed once per page load rather than
  // per keystroke — `useMemo` with an empty dependency list, not state.
  const pages = useMemo(() => flattenPages(), []);

  const groups = useMemo(() => {
    const byGroup = PAGE_GROUPS
      .map((group) => ({ group, pages: pages.filter((page) => page.group === group) }))
      .filter((section) => section.pages.length > 0);
    return byGroup;
  }, [pages]);

  const needle = query.trim().toLowerCase();
  const visibleGroups = needle
    ? groups
      .map((section) => ({
        ...section,
        pages: section.pages.filter((page) =>
          `${page.label} ${page.path} ${page.group}`.toLowerCase().includes(needle)),
      }))
      .filter((section) => section.pages.length > 0)
    : groups;

  const shown = visibleGroups.reduce((total, section) => total + section.pages.length, 0);
  const staffOnly = pages.filter((page) => page.access === 'staff' || page.access === 'muse').length;

  // Every path, newline-separated — the reason this page exists: pasting the
  // full URL list somewhere (a sitemap, an exclusion list, a crawl config)
  // should not mean scrolling and retyping.
  const copyPaths = async () => {
    try {
      await navigator.clipboard.writeText(pages.map((page) => page.path).join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access is granted per-origin and refused in some contexts;
      // the list is on screen either way, so there is nothing to recover from.
    }
  };

  if (!isAuthorized) {
    return <NotFound />;
  }

  return (
    <>
      <SEO
        title="All pages"
        description="Every page in the app, in one list."
        path="/all"
        noindex
      />
      <Header />

      {/* `.service-room` is the shared ambient ground for a service page; the
          root paints no background of its own so the room shows through. */}
      <div className="all-page service-room">
        <div className="all-shell">
          <header className="all-bar">
            <h1 className="all-bar-title">All pages</h1>
            <ul className="all-bar-readout">
              <li>Pages <strong>{pages.length}</strong></li>
              <li>Staff only <strong>{staffOnly}</strong></li>
              <li>Showing <strong>{shown}</strong></li>
            </ul>
            <div className="all-bar-actions">
              <label className="all-search">
                <span className="all-search-label">Filter</span>
                <input
                  type="search"
                  className="all-search-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, path or group…"
                  aria-label="Filter pages"
                />
              </label>
              <button type="button" className="all-btn" onClick={copyPaths}>
                {copied ? 'Copied' : 'Copy paths'}
              </button>
            </div>
          </header>

          {visibleGroups.length === 0 ? (
            <p className="all-empty">
              Nothing matches “{query.trim()}”.{' '}
              <button type="button" className="all-empty-btn" onClick={() => setQuery('')}>
                Clear the filter
              </button>
            </p>
          ) : (
            visibleGroups.map((section) => (
              <section className="all-section" key={section.group} aria-label={section.group}>
                <div className="all-panel">
                  <div className="all-panel-head">
                    <h2 className="all-panel-title">{section.group}</h2>
                    <span className="all-panel-count">{section.pages.length}</span>
                  </div>
                  <ul className="all-rows">
                    {section.pages.map((page) => (
                      <PageRow page={page} key={page.path} />
                    ))}
                  </ul>
                </div>
              </section>
            ))
          )}

          <p className="all-foot">
            Generated from <code>constants/pages.js</code>, the same manifest
            <code> App.js</code> builds its routes from — a new page appears here
            as soon as it is added there.
          </p>
        </div>
        <Footer />
      </div>
    </>
  );
}

export default AllPages;
