import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import SEO from '../../../components/SEO/SEO.jsx';
import LoginGate from '../../../components/Simple/LoginGate/LoginGate.jsx';
import { useAddonDetection } from '../../../hooks/simpleAddon/useAddonDetection.js';
import useScrollReveal from '../../../hooks/useScrollReveal';
import { importSkillToAddon, previewSkillCompatibility } from '../../../services/simpleAddonApi.js';
import {
  searchMarketSkills,
  getMarketSkill,
  installMarketSkill,
  rateMarketSkill,
  flagMarketSkill,
} from '../../../services/marketplaceApi.js';
import PublishModal from './PublishModal.jsx';
import './Market.css';

const PER_PAGE = 12;

// Category severity ordering mirrors the backend's CATEGORY_SEVERITY so we
// can color-code the capability badges the same way the permission gate does.
const CATEGORY_SEVERITY = ['safe-read', 'sandboxed-write', 'shell', 'destructive', 'system'];

function severityOf(category) {
  const i = CATEGORY_SEVERITY.indexOf(category);
  return i === -1 ? CATEGORY_SEVERITY.length : i;
}

function categoryClass(category) {
  const sev = severityOf(category);
  if (sev >= 4) return 'mkt-cat mkt-cat--system';
  if (sev === 3) return 'mkt-cat mkt-cat--destructive';
  if (sev === 2) return 'mkt-cat mkt-cat--shell';
  if (sev === 1) return 'mkt-cat mkt-cat--write';
  return 'mkt-cat mkt-cat--read';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Stars({ value = 0, count = 0, size = 'sm' }) {
  const rounded = Math.round(value);
  return (
    <span className={`mkt-stars mkt-stars--${size}`} title={count ? `${count} rating${count === 1 ? '' : 's'}` : 'No ratings yet'}>
      <span className="mkt-stars-row" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= rounded ? 'mkt-star mkt-star--on' : 'mkt-star'}>★</span>
        ))}
      </span>
      {count > 0 && <span className="mkt-stars-count">({count})</span>}
    </span>
  );
}

// ── Skill card (grid item) ─────────────────────────────────────────────────

function SkillCard({ skill, onOpen }) {
  const lowTrust = skill.lowTrust;
  return (
    <button
      type="button"
      className={`mkt-card${lowTrust ? ' mkt-card--lowtrust' : ''}`}
      onClick={() => onOpen(skill)}
    >
      <div className="mkt-card-head">
        <h3 className="mkt-card-name">{skill.name}</h3>
        {lowTrust && <span className="mkt-badge mkt-badge--low">New</span>}
      </div>
      <p className="mkt-card-slug">@{skill.slug}</p>
      <p className="mkt-card-desc">{skill.naturalLanguageDescription || 'No description provided.'}</p>
      <div className="mkt-card-cats">
        {(skill.declaredCategories || []).slice(0, 3).map((c) => (
          <span key={c} className={categoryClass(c)}>{c}</span>
        ))}
        {lowTrust && <span className="mkt-badge mkt-badge--dryrun">Dry-run first</span>}
      </div>
      <div className="mkt-card-stats">
        <Stars value={skill.avgRating} count={skill.ratingCount} />
        <span className="mkt-card-dl">⬇ {skill.downloads || 0}</span>
        <span className="mkt-card-time">{timeAgo(skill.updatedAt || skill.createdAt)}</span>
      </div>
    </button>
  );
}

// ── Detail modal ───────────────────────────────────────────────────────────

function SkillModal({ detail, installed, onClose, onInstall, onRate, onFlag, installing, rateBusy, flagBusy, addonConnected, saveBusy, onSaveToAddon }) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [compat, setCompat] = useState(null);

  // §5.4: when the addon is connected and we have the installed skill, run the
  // local tool-version compatibility analysis so the user sees degraded/
  // unsupported steps before saving the skill to the addon.
  useEffect(() => {
    let cancelled = false;
    if (!addonConnected || !installed?.skill) { setCompat(null); return; }
    previewSkillCompatibility(installed.skill)
      .then((res) => { if (!cancelled) setCompat(res); })
      .catch(() => { if (!cancelled) setCompat(null); });
    return () => { cancelled = true; };
  }, [addonConnected, installed?.skill]);

  if (!detail) {
    return (
      <div className="mkt-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="mkt-modal" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="mkt-modal-close" onClick={onClose} aria-label="Close">×</button>
          <p className="mkt-status">Loading skill…</p>
        </div>
      </div>
    );
  }

  const capability = installed?.capabilitySummary || null;
  const toolCounts = capability?.toolCounts || {};
  const toolEntries = Object.entries(toolCounts);

  const downloadJson = () => {
    if (!installed?.skill) return;
    const s = installed.skill;
    const bundle = {
      slug: s.slug,
      name: s.name,
      steps: s.steps || [],
      params: s.params || [],
      declaredCategories: s.declaredCategories || [],
      toolSchemaVersion: s.toolSchemaVersion,
      metadata: { source: 'marketplace', marketId: installed.marketId, version: installed.version },
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.slug}-v${installed.version}.simple-skill.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mkt-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mkt-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mkt-modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="mkt-modal-head">
          <h2>{detail.name}</h2>
          <p className="mkt-modal-slug">@{detail.slug} · v{detail.version}</p>
        </div>

        <p className="mkt-modal-desc">{detail.naturalLanguageDescription || 'No description provided.'}</p>

        <div className="mkt-modal-cats">
          {(detail.declaredCategories || []).map((c) => (
            <span key={c} className={categoryClass(c)}>{c}</span>
          ))}
        </div>

        <div className="mkt-modal-stats">
          <Stars value={detail.avgRating} count={detail.ratingCount} size="md" />
          <span>⬇ {detail.downloads || 0} downloads</span>
          <span>🔧 {detail.installs || 0} installs</span>
          <span>Updated {timeAgo(detail.updatedAt || detail.createdAt)}</span>
        </div>

        {!installed ? (
          <div className="mkt-modal-actions">
            <button
              type="button"
              className="mkt-btn mkt-btn--primary"
              disabled={installing}
              onClick={() => onInstall(detail)}
            >
              {installing ? 'Installing…' : 'Install'}
            </button>
            <button type="button" className="mkt-btn mkt-btn--ghost" onClick={() => onFlag(detail)} disabled={flagBusy}>
              ⚑ Report
            </button>
          </div>
        ) : (
          <div className="mkt-installed">
            <p className="mkt-installed-ok">✓ Installed (v{installed.version})</p>

            {installed.lowTrust && (
              <div className="mkt-warning mkt-warning--low">
                <strong>New / low-trust skill.</strong> Run it in dry-run mode first — the addon will
                show what each step does before anything actually executes.
              </div>
            )}

            {capability && (
              <div className="mkt-capability">
                <h4>What this skill will do</h4>
                {toolEntries.length === 0 ? (
                  <p className="mkt-capability-empty">No resolvable tool actions.</p>
                ) : (
                  <ul className="mkt-capability-list">
                    {toolEntries.map(([tool, count]) => (
                      <li key={tool}>
                        <code>{tool}</code>
                        <span className="mkt-capability-count">×{count}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {capability.actualCategories && capability.actualCategories.length > 0 && (
                  <div className="mkt-capability-cats">
                    {capability.actualCategories.map((c) => (
                      <span key={c} className={categoryClass(c)}>{c}</span>
                    ))}
                  </div>
                )}
                {capability.mismatches && capability.mismatches.length > 0 && (
                  <div className="mkt-warning mkt-warning--mismatch">
                    <strong>Declared/actual mismatch:</strong>{' '}
                    {capability.mismatches.map((m) => `${m.tool} → ${m.category}`).join(', ')}
                  </div>
                )}
              </div>
            )}

            {compat && addonConnected && (
              <div className="mkt-capability">
                <h4>Compatibility with your addon</h4>
                <div className="mkt-compat-counts">
                  <span className="mkt-cat mkt-cat--read">{compat.compatibleCount} compatible</span>
                  {compat.degradedCount > 0 && <span className="mkt-cat mkt-cat--write">{compat.degradedCount} adjusted</span>}
                  {compat.unsupportedCount > 0 && <span className="mkt-cat mkt-cat--system">{compat.unsupportedCount} unsupported</span>}
                </div>
                {(compat.degradedCount > 0 || compat.unsupportedCount > 0) && (
                  <ul className="mkt-capability-list">
                    {compat.findings.filter((f) => f.status !== 'compatible').slice(0, 6).map((f) => (
                      <li key={`${f.path}-${f.originalTool}`}>
                        <code>{f.originalTool}</code>
                        <span>{f.status === 'degraded' ? `→ ${f.resolvedTool}` : '— not available on this addon'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {compat.hasUnsupported && (
                  <div className="mkt-warning mkt-warning--mismatch">
                    <strong>Unsupported tools:</strong> some steps use tools this addon version doesn't have and will be skipped or blocked at run time.
                  </div>
                )}
              </div>
            )}

            {addonConnected ? (
              <>
                <button
                  type="button"
                  className="mkt-btn mkt-btn--secondary"
                  disabled={saveBusy}
                  onClick={() => onSaveToAddon(installed)}
                >
                  {saveBusy ? 'Saving to addon…' : '💻 Save to Simple addon'}
                </button>
                <p className="mkt-hint">
                  Then run it from the addon's Recorder &amp; Skills tab. It will be marked as a
                  marketplace install so the capability review applies on first run.
                </p>
              </>
            ) : (
              <>
                <button type="button" className="mkt-btn mkt-btn--secondary" onClick={downloadJson}>
                  ⬇ Download for the Simple addon (.json)
                </button>
                <p className="mkt-hint">
                  Import it in the addon's Recorder &amp; Skills tab (Import button) to run it locally.
                </p>
              </>
            )}

            <div className="mkt-rate">
              <h4>Rate this skill</h4>
              <p className="mkt-hint">Ratings are gated on actually running the skill in the addon.</p>
              <div className="mkt-rate-stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`mkt-rate-star${n <= (hover || stars) ? ' mkt-rate-star--on' : ''}`}
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(0)}
                    onClick={() => {
                      setStars(n);
                      onRate(detail, n);
                    }}
                    disabled={rateBusy}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  >
                    ★
                  </button>
                ))}
                {rateBusy && <span className="mkt-rate-busy">Submitting…</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Market() {
  const { user } = useSelector((state) => state.data);
  const { addonStatus } = useAddonDetection();
  const token = user?.token;
  const addonConnected = !!addonStatus?.isConnected;

  const [gridRef, gridVisible] = useScrollReveal();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('trust');
  const [skills, setSkills] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [installed, setInstalled] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [flagBusy, setFlagBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [showPublish, setShowPublish] = useState(false);

  const loadFirstPage = useCallback(async (opts = {}) => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await searchMarketSkills(token, {
        q: opts.q !== undefined ? opts.q : query,
        sort: opts.sort !== undefined ? opts.sort : sort,
        page: 1,
        perPage: PER_PAGE,
      });
      setSkills(res.skills || []);
      setTotal(res.total || 0);
      setPage(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, query, sort]);

  const loadMore = useCallback(async () => {
    if (!token || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await searchMarketSkills(token, { q: query, sort, page: next, perPage: PER_PAGE });
      setSkills((prev) => [...prev, ...(res.skills || [])]);
      setPage(next);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingMore(false);
    }
  }, [token, loadingMore, page, query, sort]);

  useEffect(() => {
    if (token) loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sort]);

  const onSearch = (e) => {
    e.preventDefault();
    loadFirstPage({ q: query });
  };

  const openSkill = async (skill) => {
    setDetail(null);
    setInstalled(null);
    setDetailLoading(true);
    try {
      const full = await getMarketSkill(token, skill.marketId);
      setDetail(full);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => {
    setDetail(null);
    setInstalled(null);
  };

  const onInstall = async (skill) => {
    setInstalling(true);
    try {
      const res = await installMarketSkill(token, skill.marketId);
      setInstalled(res);
      toast.success('Installed — review the capability summary before running it.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setInstalling(false);
    }
  };

  const onRate = async (skill, stars) => {
    setRateBusy(true);
    try {
      const res = await rateMarketSkill(token, skill.marketId, {
        stars,
        ranAt: new Date().toISOString(),
      });
      toast.success(`Rated ${stars}★ — avg ${Number(res.avgRating || 0).toFixed(1)} (${res.ratingCount} total)`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRateBusy(false);
    }
  };

  const onFlag = async (skill) => {
    const reason = window.prompt('Why are you reporting this skill? (optional)');
    if (reason === null) return; // cancelled
    setFlagBusy(true);
    try {
      const res = await flagMarketSkill(token, skill.marketId, reason || '');
      toast.success(`Thanks — this skill has been flagged (${res.flagCount} total).`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setFlagBusy(false);
    }
  };

  const onSaveToAddon = async (installResult) => {
    if (!installResult?.skill) return;
    setSaveBusy(true);
    try {
      const res = await importSkillToAddon({
        ...installResult.skill,
        metadata: {
          ...(installResult.skill.metadata || {}),
          source: 'marketplace',
          marketId: installResult.marketId,
          version: installResult.version,
          lowTrust: !!installResult.lowTrust,
        },
      });
      const imported = res.imported || [];
      const skipped = res.skipped || [];
      if (imported.length > 0) {
        toast.success(`Saved to your addon: ${imported.join(', ')}`);
      } else {
        toast.error(skipped[0]?.reason || 'The addon could not import this skill.');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaveBusy(false);
    }
  };

  const onPublished = (res) => {
    // Optimistically show the just-published skill immediately. The browse
    // listing is a DynamoDB Scan (eventually consistent), so a plain refetch
    // can momentarily return stale/empty results right after a publish.
    if (res?.skill) {
      setSkills((prev) => [res.skill, ...prev.filter((s) => s.marketId !== res.skill.marketId)]);
    }
    loadFirstPage();
  };

  if (!token) {
    return (
      <>
        <SEO title="Marketplace" description="Discover and install community-built automations for the Simple desktop addon." path="/market" />
        <Header />
        <LoginGate
          redirectTo="/market"
          eyebrow="Simple Marketplace"
          title="Sign in to browse the marketplace"
          subtitle="Discover community-built PC automations you can install into the Simple addon."
        />
        <Footer />
      </>
    );
  }

  return (
    <>
      <SEO title="Marketplace" description="Discover and install community-built automations for the Simple desktop addon." path="/market" />
      <Header />
      <main className="mkt">
        <div className="mkt-floating" aria-hidden="true">
          <div className="mkt-circle mkt-circle-1" />
          <div className="mkt-circle mkt-circle-2" />
          <div className="mkt-circle mkt-circle-3" />
        </div>

        <section className="mkt-section mkt-hero">
          <div className="mkt-title-wrap">
            <p className="mkt-eyebrow">Marketplace</p>
            <h1 className="mkt-title">Show it once. Share it with everyone.</h1>
            <p className="mkt-subtitle">
              Community-built automations for the Simple addon — browse, inspect what each skill
              does, then install it into the desktop app.{' '}
              <Link to="/net" className="mkt-hero-link">Open Net AI Chat →</Link>
            </p>
          </div>

          <form className="mkt-search" onSubmit={onSearch} role="search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills — e.g. organize downloads"
              aria-label="Search skills"
            />
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort skills">
              <option value="trust">Top rated</option>
              <option value="downloads">Most downloaded</option>
              <option value="recent">Newest</option>
            </select>
            <button type="submit" className="mkt-btn mkt-btn--primary">Search</button>
            <button
              type="button"
              className="mkt-btn mkt-btn--outline"
              onClick={() => setShowPublish(true)}
            >
              Publish a skill
            </button>
          </form>
        </section>

        <section
          ref={gridRef}
          className={`mkt-section mkt-results mkt-reveal ${gridVisible ? 'is-visible' : ''}`}
          aria-live="polite"
        >
          {loading && <p className="mkt-status">Loading marketplace…</p>}
          {error && <p className="mkt-status mkt-status--error">{error}</p>}
          {!loading && !error && skills.length === 0 && (
            <p className="mkt-status">No skills found{query ? ` for "${query}"` : ''}. Be the first to publish one.</p>
          )}

          {!loading && skills.length > 0 && (
            <>
              <p className="mkt-total">{total} skill{total === 1 ? '' : 's'}</p>
              <div className="mkt-grid">
                {skills.map((s) => (
                  <SkillCard key={s.marketId} skill={s} onOpen={openSkill} />
                ))}
              </div>
              {skills.length < total && (
                <div className="mkt-more">
                  <button type="button" className="mkt-btn mkt-btn--ghost" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {(detail || detailLoading) && (
        <SkillModal
          detail={detail}
          installed={installed}
          onClose={closeModal}
          onInstall={onInstall}
          onRate={onRate}
          onFlag={onFlag}
          installing={installing}
          rateBusy={rateBusy}
          flagBusy={flagBusy}
          addonConnected={addonConnected}
          saveBusy={saveBusy}
          onSaveToAddon={onSaveToAddon}
        />
      )}

      {showPublish && (
        <PublishModal
          token={token}
          addonConnected={addonConnected}
          onClose={() => setShowPublish(false)}
          onPublished={onPublished}
        />
      )}
      <Footer />
    </>
  );
}
