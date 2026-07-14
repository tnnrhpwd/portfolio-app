/**
 * GoalManager — Create, view, and manage automation goals.
 *
 * Goals are stored in the portfolio backend (DynamoDB, kind='goal') and pulled
 * by the agent loop at startup. Each goal has:
 *   - name / content: what to do
 *   - successCriteria: objectively checkable done condition
 *   - status: active | paused | blocked | done | failed
 *   - priority: 0-100 (higher = runs first)
 *   - createdBy: 'user' | 'voice' | 'nl-compiler'
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  listWorkspace,
  upsertWorkspaceItem,
  deleteWorkspaceItem,
  startAgent,
} from '../../services/csimpleApi';
import './GoalManager.css';

// Fetch pattern suggestions from the addon
async function fetchSuggestions() {
  try {
    const { addonFetch } = await import('../../services/csimpleApi');
    // addonFetch is not exported directly — use the public helper instead
    const res = await fetch(`${window._csimpleAddonBase || 'http://localhost:3001'}/api/agent/suggestions`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.suggestions || [];
  } catch { return []; }
}

const STATUS_OPTIONS = ['active', 'paused', 'done', 'failed', 'blocked'];
const STATUS_COLORS = {
  active: '#22c55e',
  paused: '#f59e0b',
  done: '#6b7280',
  failed: '#ef4444',
  blocked: '#f97316',
};

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'goal';
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

const BLANK_FORM = {
  name: '',
  content: '',
  successCriteria: '',
  constraints: '',
  priority: 50,
  status: 'active',
};

export default function GoalManager({ user, addonConnected, addonBaseUrl }) {
  const token = user?.token;
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [editSlug, setEditSlug] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [suggestions, setSuggestions] = useState([]);
  const [expanded, setExpanded] = useState(new Set()); // expanded parent slugs

  const loadGoals = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await listWorkspace(token, { kind: 'goal' });
      const items = data?.items || data?.entries || [];
      // Sort: active first by priority desc, then others by updatedAt desc
      items.sort((a, b) => {
        const aActive = a.status === 'active';
        const bActive = b.status === 'active';
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        if (aActive && bActive) return (b.priority || 0) - (a.priority || 0);
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      });
      setGoals(items);
    } catch (e) {
      setError(e.message || 'Failed to load goals');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  // Load pattern suggestions when addon connected
  useEffect(() => {
    if (!addonConnected || !addonBaseUrl) return;
    fetch(`${addonBaseUrl}/api/agent/suggestions`)
      .then(r => r.ok ? r.json() : { suggestions: [] })
      .then(d => setSuggestions(d.suggestions || []))
      .catch(() => {});
  }, [addonConnected, addonBaseUrl]);

  const flash = useCallback((msg, ms = 2500) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), ms);
  }, []);

  const openCreate = useCallback(() => {
    setForm(BLANK_FORM);
    setEditSlug(null);
    setShowForm(true);
  }, []);

  const openEdit = useCallback((item) => {
    setForm({
      name: item.name || '',
      content: item.content || '',
      successCriteria: item.successCriteria || '',
      constraints: item.constraints || '',
      priority: item.priority ?? 50,
      status: item.status || 'active',
    });
    setEditSlug(item.slug);
    setShowForm(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!token || !form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const slug = editSlug || slugify(form.name);
      await upsertWorkspaceItem(token, 'goal', slug, {
        name: form.name.trim().slice(0, 80),
        content: form.content.trim().slice(0, 2000),
        successCriteria: form.successCriteria.trim().slice(0, 300),
        constraints: form.constraints.trim().slice(0, 300),
        priority: Math.min(100, Math.max(0, Number(form.priority) || 50)),
        status: form.status,
        createdBy: editSlug ? undefined : 'user',
      });
      flash(editSlug ? `Updated "${form.name}"` : `Created goal "${form.name}"`);
      setShowForm(false);
      await loadGoals();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }, [token, form, editSlug, flash, loadGoals]);

  const handleDelete = useCallback(async (slug, name) => {
    if (!token) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete goal "${name}"?`)) return;
    setBusy(true);
    try {
      await deleteWorkspaceItem(token, 'goal', slug);
      flash(`Deleted "${name}"`);
      await loadGoals();
    } catch (e) {
      setError(e.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }, [token, flash, loadGoals]);

  const handleSetStatus = useCallback(async (item, newStatus) => {
    if (!token) return;
    setBusy(true);
    try {
      await upsertWorkspaceItem(token, 'goal', item.slug, {
        name: item.name,
        status: newStatus,
        priority: item.priority,
        expectedUpdatedAt: item.updatedAt || undefined,
      });
      flash(`"${item.name}" → ${newStatus}`);
      await loadGoals();
    } catch (e) {
      setError(e.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }, [token, flash, loadGoals]);

  const handleRunAgent = useCallback(async () => {
    if (!addonConnected) return;
    setBusy(true);
    try {
      const r = await startAgent({});
      flash(r.running ? `Agent started on "${r.currentGoal?.name || 'next goal'}"` : (r.reason || 'No active goal'));
    } catch (e) {
      setError(e.message || 'Failed to start agent');
    } finally {
      setBusy(false);
    }
  }, [addonConnected, flash]);

  const filtered = filter === 'all' ? goals
    : filter === 'active' ? goals.filter(g => g.status === 'active')
    : goals.filter(g => g.status === 'done' || g.status === 'failed');

  return (
    <div className="gm">
      <div className="gm__toolbar">
        <div className="gm__filters">
          {['all', 'active', 'done'].map(f => (
            <button
              key={f}
              className={`gm__filter-btn ${filter === f ? 'is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? `All (${goals.length})` : f === 'active' ? `Active (${goals.filter(g => g.status === 'active').length})` : 'Completed'}
            </button>
          ))}
        </div>
        <div className="gm__actions">
          <button className="gm__btn gm__btn--muted" onClick={loadGoals} disabled={loading}>↻ Refresh</button>
          {addonConnected && (
            <button className="gm__btn gm__btn--run" onClick={handleRunAgent} disabled={busy}>
              ▶ Run Agent
            </button>
          )}
          <button className="gm__btn gm__btn--primary" onClick={openCreate}>
            + New Goal
          </button>
        </div>
      </div>

      {error && (
        <div className="gm__banner gm__banner--err" onClick={() => setError(null)}>
          {error} <span>✕</span>
        </div>
      )}
      {status && <div className="gm__banner gm__banner--ok">{status}</div>}

      {showForm && (
        <div className="gm__form-wrap">
          <div className="gm__form">
            <div className="gm__form-header">
              <span>{editSlug ? 'Edit Goal' : 'New Goal'}</span>
              <button className="gm__form-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <label className="gm__label">Goal name *
              <input className="gm__input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Reply to all unread emails before noon" maxLength={80} />
            </label>
            <label className="gm__label">Description / steps
              <textarea className="gm__textarea" rows={3} value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Detailed steps or context for the agent…" />
            </label>
            <label className="gm__label">Success criteria
              <input className="gm__input" value={form.successCriteria}
                onChange={e => setForm(f => ({ ...f, successCriteria: e.target.value }))}
                placeholder="e.g. Inbox shows 0 unread emails" maxLength={300} />
            </label>
            <label className="gm__label">Constraints (optional)
              <input className="gm__input" value={form.constraints}
                onChange={e => setForm(f => ({ ...f, constraints: e.target.value }))}
                placeholder="e.g. Do not delete any emails" maxLength={300} />
            </label>
            <div className="gm__form-row">
              <label className="gm__label gm__label--inline">Priority
                <input className="gm__input gm__input--num" type="number" min={0} max={100}
                  value={form.priority} onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))} />
                <span className="gm__hint-text">0–100 (higher runs first)</span>
              </label>
              <label className="gm__label gm__label--inline">Status
                <select className="gm__input" value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <div className="gm__form-footer">
              <button className="gm__btn gm__btn--muted" onClick={() => setShowForm(false)} disabled={busy}>Cancel</button>
              <button className="gm__btn gm__btn--primary" onClick={handleSave} disabled={busy || !form.name.trim()}>
                {busy ? 'Saving…' : editSlug ? 'Update' : 'Create Goal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="gm__empty">Loading goals…</div>
      ) : filtered.length === 0 ? (
        <div className="gm__empty">
          {filter === 'all'
            ? <>No goals yet. Click <strong>+ New Goal</strong>, say <em>"hey csimple, &lt;instruction&gt;"</em>, or press <kbd>Ctrl+Win+G</kbd> after copying text.</>
            : `No ${filter} goals.`}
        </div>
      ) : (
        <ul className="gm__list">
          {(() => {
            // Build parent → children map for sub-goal hierarchy
            const bySlug = new Map(filtered.map(g => [g.slug, g]));
            const children = new Map(); // parentSlug → [child]
            const roots = [];
            for (const item of filtered) {
              const parentSlug = item.parentGoalId || item.parentGoalSlug;
              if (parentSlug && bySlug.has(parentSlug)) {
                if (!children.has(parentSlug)) children.set(parentSlug, []);
                children.get(parentSlug).push(item);
              } else {
                roots.push(item);
              }
            }

            const renderItem = (item, depth = 0) => {
              const kids = children.get(item.slug) || [];
              const isExpanded = expanded.has(item.slug);
              return (
                <li key={item.slug} className={`gm__item gm__item--${item.status || 'active'} ${depth > 0 ? 'gm__item--child' : ''}`}
                    style={depth > 0 ? { marginLeft: `${depth * 16}px` } : undefined}>
                  <div className="gm__item-header">
                    {kids.length > 0 && (
                      <button className="gm__expand-btn" onClick={() => setExpanded(prev => {
                        const next = new Set(prev);
                        next.has(item.slug) ? next.delete(item.slug) : next.add(item.slug);
                        return next;
                      })}>
                        {isExpanded ? '▼' : '▶'}
                      </button>
                    )}
                    <span className="gm__item-status" style={{ color: STATUS_COLORS[item.status] || '#6b7280' }}>
                      ● {item.status || 'active'}
                    </span>
                    <span className="gm__item-priority" title="Priority">P{item.priority ?? '?'}</span>
                    {item.createdBy && <span className="gm__item-source">{item.createdBy}</span>}
                    {kids.length > 0 && <span className="gm__item-kids">{kids.length} sub-goal{kids.length > 1 ? 's' : ''}</span>}
                  </div>
                  <div className="gm__item-name">{item.name}</div>
                  {item.successCriteria && (
                    <div className="gm__item-criteria">✓ {item.successCriteria}</div>
                  )}
                  {item.content && item.content !== item.name && (
                    <div className="gm__item-content">{String(item.content).slice(0, 200)}</div>
                  )}
                  <div className="gm__item-meta">
                    {item.updatedAt && <span>{fmtDate(item.updatedAt)}</span>}
                  </div>
                  <div className="gm__item-actions">
                    {item.status !== 'active' && (
                      <button className="gm__link gm__link--green" onClick={() => handleSetStatus(item, 'active')} disabled={busy}>Activate</button>
                    )}
                    {item.status === 'active' && (
                      <button className="gm__link" onClick={() => handleSetStatus(item, 'paused')} disabled={busy}>Pause</button>
                    )}
                    <button className="gm__link" onClick={() => openEdit(item)} disabled={busy}>Edit</button>
                    <button className="gm__link gm__link--danger" onClick={() => handleDelete(item.slug, item.name)} disabled={busy}>Delete</button>
                  </div>
                  {isExpanded && kids.length > 0 && (
                    <ul className="gm__sublist">
                      {kids.map(k => renderItem(k, depth + 1))}
                    </ul>
                  )}
                </li>
              );
            };
            return roots.map(r => renderItem(r));
          })()}
        </ul>
      )}

      {/* Pattern suggestions panel */}
      {suggestions.length > 0 && (
        <div className="gm__suggestions">
          <div className="gm__suggestions-header">
            ✨ <strong>Suggested automations</strong>
            <span className="gm__suggestions-hint">Based on your usage patterns</span>
          </div>
          {suggestions.map(s => (
            <div key={s.id} className={`gm__suggestion gm__suggestion--${s.value || 'medium'}`}>
              <div className="gm__suggestion-title">{s.title}</div>
              <div className="gm__suggestion-desc">{s.description}</div>
              <div className="gm__suggestion-meta">
                <span>{s.tools?.slice(0, 4).join(' → ')}</span>
                <span>×{s.repeatCount}</span>
              </div>
              <button
                className="gm__btn gm__btn--primary"
                style={{ fontSize: '11px', padding: '3px 8px' }}
                onClick={async () => {
                  if (!token) return;
                  const slug = slugify(s.title);
                  await upsertWorkspaceItem(token, 'goal', slug, {
                    name: s.title,
                    content: s.description,
                    status: 'active',
                    priority: 60,
                    createdBy: 'pattern-learner',
                  });
                  setSuggestions(prev => prev.filter(x => x.id !== s.id));
                  flash(`Created goal from suggestion: "${s.title}"`);
                  await loadGoals();
                }}
                disabled={busy || !token}
              >
                Automate this
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
