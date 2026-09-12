import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import SEO from '../../../components/SEO/SEO.jsx';
import LoginGate from '../../../components/Simple/LoginGate/LoginGate.jsx';
import SimpleNav from '../../../components/Simple/SimpleNav/SimpleNav.jsx';
import { useAddonDetection } from '../../../hooks/simpleAddon/useAddonDetection.js';
import { importSkillToAddon, previewSkillCompatibility, listWorkspace } from '../../../services/simpleAddonApi.js';
import {
  searchMarketSkills,
  getMarketSkill,
  installMarketSkill,
  rateMarketSkill,
  flagMarketSkill,
  searchMarketGoals,
  publishMarketGoal,
  installMarketGoal,
} from '../../../services/marketplaceApi.js';
import { slugifyGoalTitle } from '../Plans/plansUtils.js';
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

  // What the browser is showing. Skills and goals share this page (and the
  // backend's ranking) — the switch is the only difference between them.
  const [kind, setKind] = useState('skill');

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('trust');
  const [skills, setSkills] = useState([]);
  const [goals, setGoals] = useState([]);
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

  // Goals: the open goal, the save-in-progress flag, the share dialog and the
  // user's own goals (the pool a share can be picked from).
  const [goalDetail, setGoalDetail] = useState(null);
  const [savingGoal, setSavingGoal] = useState(false);
  const [showShareGoal, setShowShareGoal] = useState(false);
  const [myGoals, setMyGoals] = useState([]);
  const [myGoalsLoading, setMyGoalsLoading] = useState(false);
  const [shareBusy, setShareBusy] = useState(null);

  const loadFirstPage = useCallback(async (opts = {}) => {
    if (!token) return;
    setLoading(true);
    setError('');
    const q = opts.q !== undefined ? opts.q : query;
    const sortBy = opts.sort !== undefined ? opts.sort : sort;
    try {
      if (kind === 'goal') {
        const res = await searchMarketGoals(token, { q, sort: sortBy, page: 1, perPage: PER_PAGE });
        setGoals(res.goals || []);
        setTotal(res.total || 0);
      } else {
        const res = await searchMarketSkills(token, { q, sort: sortBy, page: 1, perPage: PER_PAGE });
        setSkills(res.skills || []);
        setTotal(res.total || 0);
      }
      setPage(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, query, sort, kind]);

  const loadMore = useCallback(async () => {
    if (!token || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      if (kind === 'goal') {
        const res = await searchMarketGoals(token, { q: query, sort, page: next, perPage: PER_PAGE });
        setGoals((prev) => [...prev, ...(res.goals || [])]);
      } else {
        const res = await searchMarketSkills(token, { q: query, sort, page: next, perPage: PER_PAGE });
        setSkills((prev) => [...prev, ...(res.skills || [])]);
      }
      setPage(next);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingMore(false);
    }
  }, [token, loadingMore, page, query, sort, kind]);

  useEffect(() => {
    if (token) loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sort, kind]);

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

  const onFlag = async (item) => {
    const isGoal = item.kind === 'goal';
    const reason = window.prompt(`Why are you reporting this ${isGoal ? 'goal' : 'skill'}? (optional)`);
    if (reason === null) return; // cancelled
    setFlagBusy(true);
    try {
      const res = await flagMarketSkill(token, item.marketId, reason || '');
      toast.success(`Thanks — this ${isGoal ? 'goal' : 'skill'} has been flagged (${res.flagCount} total).`);
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

  // ── Goals ──────────────────────────────────────────────────────────────

  /** Save a shared goal into the signed-in user's own workspace. */
  const onSaveGoal = async (goal) => {
    setSavingGoal(true);
    try {
      const res = await installMarketGoal(token, goal.marketId);
      toast.success(`Saved “${res.name}” to your goals — open it on /plans.`);
      setGoalDetail(null);
      setGoals((prev) => prev.map((g) => (g.marketId === goal.marketId
        ? { ...g, installs: res.installs, downloads: res.downloads }
        : g)));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingGoal(false);
    }
  };

  /** Open the share dialog with the caller's own goals loaded. */
  const openShareGoal = async () => {
    setShowShareGoal(true);
    setMyGoalsLoading(true);
    try {
      const res = await listWorkspace(token, { kind: 'goal' });
      setMyGoals(res?.entries || []);
    } catch (err) {
      toast.error(err.message);
      setMyGoals([]);
    } finally {
      setMyGoalsLoading(false);
    }
  };

  /** Publish one of my goals to the shared marketplace. */
  const onShareGoal = async (goal, description) => {
    if (!goal) return;
    setShareBusy(goal.slug);
    try {
      const res = await publishMarketGoal(token, {
        name: goal.name || goal.slug,
        slug: slugifyGoalTitle(goal.name || goal.slug),
        content: goal.content || goal.name || '',
        successCriteria: goal.successCriteria || undefined,
        constraints: goal.constraints || undefined,
        priority: typeof goal.priority === 'number' ? goal.priority : undefined,
        naturalLanguageDescription: description || goal.description || '',
        declaredCategories: [],
      });
      toast.success(res.isNewGoal
        ? 'Shared — anyone can save this goal now.'
        : 'Updated the shared goal to a new version.');
      setShowShareGoal(false);
      setKind('goal');
      if (res.goal) setGoals((prev) => [res.goal, ...prev.filter((g) => g.marketId !== res.goal.marketId)]);
      loadFirstPage();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setShareBusy(null);
    }
  };

  const isGoals = kind === 'goal';
  const items = isGoals ? goals : skills;

  if (!token) {
    return (
      <>
        <SEO title="Marketplace" description="Discover and save community-built automations and goals for Simple." path="/market" />
        <Header center={<SimpleNav compact />} />
        <div className="mkt-surface">
          <LoginGate
            redirectTo="/market"
            eyebrow="Simple Marketplace"
            title="Sign in to browse the marketplace"
            subtitle="Skills to install into the Simple addon, and goals to save into your own workspace."
          />
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <SEO title="Marketplace" description="Discover and save community-built automations and goals for Simple." path="/market" />
      <Header center={<SimpleNav compact />} />

      <div className="mkt-surface">
        <div className="mkt">
          {/* Toolbar — the page's "hero", collapsed onto one sticky row (§5.7). */}
          <header className="mkt-bar">
            <h1 className="mkt-bar-title">Market</h1>

            <div className="mkt-switch" role="tablist" aria-label="What to browse">
              <button
                type="button"
                role="tab"
                aria-selected={!isGoals}
                className={`mkt-switch-btn ${!isGoals ? 'is-active' : ''}`}
                onClick={() => setKind('skill')}
              >
                🧩 Skills
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isGoals}
                className={`mkt-switch-btn ${isGoals ? 'is-active' : ''}`}
                onClick={() => setKind('goal')}
              >
                🎯 Goals
              </button>
            </div>

            <form className="mkt-bar-search" onSubmit={onSearch} role="search">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isGoals ? 'Search shared goals…' : 'Search skills — e.g. organize downloads'}
                aria-label={isGoals ? 'Search shared goals' : 'Search skills'}
              />
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                <option value="trust">Top rated</option>
                <option value="downloads">Most saved</option>
                <option value="recent">Newest</option>
              </select>
            </form>

            <div className="mkt-bar-actions">
              {isGoals ? (
                <button type="button" className="mkt-btn mkt-btn--primary" onClick={openShareGoal}>
                  Share a goal
                </button>
              ) : (
                <button type="button" className="mkt-btn mkt-btn--primary" onClick={() => setShowPublish(true)}>
                  Publish a skill
                </button>
              )}
            </div>
          </header>

          {/* The one panel: whatever the switch is showing. */}
          <section className="mkt-panel" aria-live="polite">
            <header className="mkt-panel-head">
              <h2 className="mkt-panel-title">{isGoals ? '🎯 Shared goals' : '🧩 Community skills'}</h2>
              {!loading && !error && (
                <span className="mkt-count">
                  {total} {isGoals ? `goal${total === 1 ? '' : 's'}` : `skill${total === 1 ? '' : 's'}`}
                </span>
              )}
            </header>

            <div className="mkt-panel-body">
              {loading && <p className="mkt-status">Loading marketplace…</p>}
              {error && <p className="mkt-status mkt-status--error">{error}</p>}
              {!loading && !error && items.length === 0 && (
                <p className="mkt-status">
                  {isGoals
                    ? `No shared goals${query ? ` for "${query}"` : ''} yet — share one of yours and it shows up here.`
                    : `No skills found${query ? ` for "${query}"` : ''}. Be the first to publish one.`}
                </p>
              )}

              {!loading && items.length > 0 && (
                <div className="mkt-grid">
                  {isGoals
                    ? goals.map((g) => <GoalCard key={g.marketId} goal={g} onOpen={setGoalDetail} />)
                    : skills.map((s) => <SkillCard key={s.marketId} skill={s} onOpen={openSkill} />)}
                </div>
              )}

              {!loading && items.length > 0 && items.length < total && (
                <div className="mkt-more">
                  <button type="button" className="mkt-btn mkt-btn--ghost" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </div>
          </section>

          <p className="mkt-note">
            {isGoals
              ? 'Saving a goal copies it into your workspace — edit it, or hand it to your agent, and it becomes yours.'
              : 'Every skill is scrubbed before publishing, and installed skills still ask for permission on your PC.'}
          </p>
        </div>
      </div>

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

      {goalDetail && (
        <GoalModal
          goal={goalDetail}
          onClose={() => setGoalDetail(null)}
          onSave={onSaveGoal}
          saving={savingGoal}
          onFlag={onFlag}
          flagBusy={flagBusy}
        />
      )}

      {showShareGoal && (
        <ShareGoalModal
          myGoals={myGoals}
          loading={myGoalsLoading}
          onClose={() => setShowShareGoal(false)}
          onShare={onShareGoal}
          busySlug={shareBusy}
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

// ── Goal card (grid item) ──────────────────────────────────────────────────

function GoalCard({ goal, onOpen }) {
  return (
    <button
      type="button"
      className={`mkt-card mkt-card--goal${goal.lowTrust ? ' mkt-card--lowtrust' : ''}`}
      onClick={() => onOpen(goal)}
    >
      <div className="mkt-card-head">
        <h3 className="mkt-card-name">{goal.name}</h3>
        {goal.lowTrust && <span className="mkt-badge mkt-badge--low">New</span>}
      </div>
      <p className="mkt-card-slug">@{goal.slug}</p>
      {/* Only when the sharer said something the title doesn't already say —
          the goal's own text is long, so it stays in the detail modal. */}
      {goal.naturalLanguageDescription && goal.naturalLanguageDescription !== goal.name && (
        <p className="mkt-card-desc">{goal.naturalLanguageDescription}</p>
      )}
      <div className="mkt-card-cats">
        {(goal.declaredCategories || []).slice(0, 3).map((c) => (
          <span key={c} className={categoryClass(c)}>{c}</span>
        ))}
      </div>
      <div className="mkt-card-stats">
        <Stars value={goal.avgRating} count={goal.ratingCount} />
        <span className="mkt-card-dl">＋ {goal.installs || 0} saved</span>
        <span className="mkt-card-time">{timeAgo(goal.updatedAt || goal.createdAt)}</span>
      </div>
    </button>
  );
}

// ── Goal detail modal ──────────────────────────────────────────────────────

function GoalModal({ goal, onClose, onSave, saving, onFlag, flagBusy }) {
  return (
    <div className="mkt-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mkt-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mkt-modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="mkt-modal-head">
          <h2>{goal.name}</h2>
          <p className="mkt-modal-slug">@{goal.slug} · v{goal.latestVersion}</p>
        </div>

        <p className="mkt-modal-desc">{goal.naturalLanguageDescription || 'No description provided.'}</p>

        <div className="mkt-goal-text">
          <h4 className="mkt-goal-label">The goal</h4>
          <p>{goal.content}</p>
          {goal.successCriteria && (
            <>
              <h4 className="mkt-goal-label">Done when</h4>
              <p>{goal.successCriteria}</p>
            </>
          )}
        </div>

        <div className="mkt-modal-stats">
          <Stars value={goal.avgRating} count={goal.ratingCount} size="md" />
          <span>＋ {goal.installs || 0} saved</span>
          <span>Updated {timeAgo(goal.updatedAt || goal.createdAt)}</span>
        </div>

        <div className="mkt-modal-actions">
          <button type="button" className="mkt-btn mkt-btn--primary" onClick={() => onSave(goal)} disabled={saving}>
            {saving ? 'Saving…' : '＋ Save to my goals'}
          </button>
          <button type="button" className="mkt-btn mkt-btn--ghost" onClick={() => onFlag(goal)} disabled={flagBusy}>
            Report
          </button>
        </div>
        <p className="mkt-hint">
          Saving copies the goal into your own workspace, where you can edit it or hand it to your agent.
        </p>
      </div>
    </div>
  );
}

// ── Share-a-goal modal ─────────────────────────────────────────────────────

function ShareGoalModal({ myGoals, loading, onClose, onShare, busySlug }) {
  const [desc, setDesc] = useState('');

  return (
    <div className="mkt-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mkt-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mkt-modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="mkt-modal-head">
          <h2>Share a goal</h2>
          <p className="mkt-modal-slug">Pick one of your goals — anyone can then save a copy of it.</p>
        </div>

        <label className="mkt-field">
          <span className="mkt-field-label">Why it&apos;s worth having (optional)</span>
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={2000}
            placeholder="e.g. Keeps my Downloads folder sorted by file type every morning."
          />
        </label>

        {loading && <p className="mkt-status">Loading your goals…</p>}

        {!loading && myGoals.length === 0 && (
          <p className="mkt-hint">
            You have no goals yet. Create one on <Link to="/plans">/plans</Link>, then share it here.
          </p>
        )}

        {!loading && myGoals.length > 0 && (
          <ul className="mkt-share-list">
            {myGoals.map((g) => (
              <li key={g.slug} className="mkt-share-item">
                <span className="mkt-share-name">{g.name || g.slug}</span>
                <button
                  type="button"
                  className="mkt-btn mkt-btn--primary mkt-btn--sm"
                  onClick={() => onShare(g, desc)}
                  disabled={busySlug === g.slug}
                >
                  {busySlug === g.slug ? 'Sharing…' : 'Share'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

