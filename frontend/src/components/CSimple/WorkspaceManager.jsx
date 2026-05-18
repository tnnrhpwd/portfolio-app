/**
 * WorkspaceManager
 *
 * UI for the cloud-stored OpenClaw-style AI workspace.
 * Lets a signed-in user create/edit/delete files across the 8 supported
 * kinds (core, agent, knowledge, notebook, skill, log, decision, project)
 * that get auto-loaded into the server-side LLM context on every /net chat.
 *
 * Requires `user.token` for all API calls.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listWorkspace,
  getWorkspaceItem,
  upsertWorkspaceItem,
  deleteWorkspaceItem,
  getWorkspaceTemplates,
  getWorkspaceContextPreview,
} from '../../services/csimpleApi';
import './WorkspaceManager.css';

const KIND_LABEL = {
  core:      '🧬 Core',
  agent:     '🤖 Agent',
  knowledge: '📚 Knowledge',
  notebook:  '📓 Notebook',
  skill:     '🛠 Skill',
  log:       '📅 Log',
  decision:  '⚖ Decision',
  project:   '🗂 Project',
};

const KIND_ORDER = ['core', 'agent', 'project', 'knowledge', 'skill', 'decision', 'notebook', 'log'];
const KNOWLEDGE_STAGES = ['inbox', 'ideas', 'active', 'proveout', 'completed', 'library'];

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const AGENT_RE = /^[a-z0-9][a-z0-9_-]{0,49}$/;

function emptyDraft() {
  return {
    kind: 'notebook',
    slug: '',
    name: '',
    content: '',
    agent: '',
    stage: 'inbox',
    tags: '',
    expectedUpdatedAt: null,
    isNew: true,
  };
}

export default function WorkspaceManager({ user }) {
  const token = user?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState({ kind: '', q: '' });
  const [templates, setTemplates] = useState(null);
  const [draft, setDraft] = useState(null);          // editor open if !== null
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);

  // Initial load
  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [list, tpls] = await Promise.all([
        listWorkspace(token, {}),
        getWorkspaceTemplates(token).catch(() => null),
      ]);
      setEntries(list.entries || []);
      if (tpls) setTemplates(tpls);
    } catch (e) {
      setError(e.message || 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  // Group entries by kind for the tree view
  const grouped = useMemo(() => {
    const q = (filter.q || '').toLowerCase();
    const filtered = entries.filter(e => {
      if (filter.kind && e.kind !== filter.kind) return false;
      if (q && !(`${e.name} ${e.slug}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const map = {};
    for (const k of KIND_ORDER) map[k] = [];
    for (const e of filtered) (map[e.kind] = map[e.kind] || []).push(e);
    return map;
  }, [entries, filter]);

  // ── Editor helpers ──────────────────────────────────────────────────────
  const openNew = useCallback((kind, presetSlug, presetContent) => {
    setDraft({
      ...emptyDraft(),
      kind,
      slug: presetSlug || '',
      content: presetContent || '',
      isNew: true,
    });
  }, []);

  const openEdit = useCallback(async (kind, slug) => {
    if (!token) return;
    try {
      const item = await getWorkspaceItem(token, kind, slug);
      if (!item) return;
      setDraft({
        kind: item.kind,
        slug: item.slug,
        name: item.name || '',
        content: item.content || '',
        agent: item.agent || '',
        stage: item.stage || 'inbox',
        tags: (item.tags || []).join(', '),
        expectedUpdatedAt: item.updatedAt || null,
        isNew: false,
      });
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  const saveDraft = useCallback(async () => {
    if (!draft || !token) return;
    if (!SLUG_RE.test(draft.slug)) {
      setError('Invalid slug. Lowercase letters/digits/underscore/hyphen, 1-100 chars, must start with letter/digit.');
      return;
    }
    if (draft.agent && !AGENT_RE.test(draft.agent)) {
      setError('Invalid agent name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const tags = (draft.tags || '')
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
      await upsertWorkspaceItem(token, draft.kind, draft.slug, {
        name: draft.name || draft.slug,
        content: draft.content || '',
        agent: draft.agent || undefined,
        stage: draft.kind === 'knowledge' ? draft.stage : undefined,
        tags,
        expectedUpdatedAt: draft.isNew ? undefined : draft.expectedUpdatedAt,
      });
      setDraft(null);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [draft, token, reload]);

  const removeItem = useCallback(async (kind, slug) => {
    if (!token) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete ${kind}/${slug}? (soft delete — can be restored within 30d)`)) return;
    try {
      await deleteWorkspaceItem(token, kind, slug);
      await reload();
    } catch (e) {
      setError(e.message);
    }
  }, [token, reload]);

  const createCoreFromTemplate = useCallback(async (slug) => {
    if (!templates?.core?.[slug]) return;
    openNew('core', slug, templates.core[slug]);
  }, [templates, openNew]);

  const showContextPreview = useCallback(async () => {
    if (!token) return;
    setPreview({ loading: true });
    try {
      const data = await getWorkspaceContextPreview(token, { message: 'preview' });
      setPreview({ loading: false, data });
    } catch (e) {
      setPreview({ loading: false, error: e.message });
    }
  }, [token]);

  if (!token) {
    return <div className="ws-empty">Sign in to manage your AI workspace.</div>;
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="ws">
      <div className="ws__header">
        <div className="ws__title">
          <strong>AI Workspace</strong>
          <span className="ws__subtitle">Files that follow your account, loaded into every /net chat.</span>
        </div>
        <div className="ws__actions">
          <button type="button" className="ws__btn" onClick={() => openNew('notebook')}>+ New</button>
          <button type="button" className="ws__btn ws__btn--ghost" onClick={showContextPreview}>Preview LLM context</button>
          <button type="button" className="ws__btn ws__btn--ghost" onClick={reload}>↻</button>
        </div>
      </div>

      <div className="ws__filters">
        <select
          value={filter.kind}
          onChange={e => setFilter(f => ({ ...f, kind: e.target.value }))}
          className="ws__select"
        >
          <option value="">All kinds</option>
          {KIND_ORDER.map(k => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search…"
          value={filter.q}
          onChange={e => setFilter(f => ({ ...f, q: e.target.value }))}
          className="ws__input"
        />
      </div>

      {/* Core file quick-create row */}
      {templates?.core && (
        <div className="ws__quick">
          <span className="ws__quick-label">Quick-create core:</span>
          {Object.keys(templates.core).map(slug => {
            const exists = entries.some(e => e.kind === 'core' && e.slug === slug);
            return (
              <button
                key={slug}
                type="button"
                className={`ws__chip ${exists ? 'ws__chip--exists' : ''}`}
                onClick={() => exists ? openEdit('core', slug) : createCoreFromTemplate(slug)}
                title={exists ? 'Edit' : 'Create from template'}
              >
                {slug.toUpperCase()}{exists ? ' ✓' : ''}
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="ws__error">{error}</div>}

      {loading ? (
        <div className="ws__loading">Loading…</div>
      ) : (
        <div className="ws__tree">
          {KIND_ORDER.map(kind => {
            const items = grouped[kind] || [];
            if (filter.kind && filter.kind !== kind) return null;
            if (items.length === 0 && filter.kind !== kind) return null;
            return (
              <div key={kind} className="ws__group">
                <div className="ws__group-header">
                  <span>{KIND_LABEL[kind]}</span>
                  <span className="ws__group-count">{items.length}</span>
                  <button
                    type="button"
                    className="ws__btn ws__btn--small"
                    onClick={() => openNew(kind)}
                  >+ {kind}</button>
                </div>
                {items.length === 0 && <div className="ws__empty-row">No items yet.</div>}
                {items.map(it => (
                  <div key={`${it.kind}/${it.slug}`} className="ws__row">
                    <div className="ws__row-main" onClick={() => openEdit(it.kind, it.slug)}>
                      <div className="ws__row-name">{it.name || it.slug}</div>
                      <div className="ws__row-meta">
                        <code>{it.slug}</code>
                        {it.agent && <span className="ws__tag">@{it.agent}</span>}
                        {it.stage && <span className="ws__tag">{it.stage}</span>}
                        {(it.tags || []).map(t => <span key={t} className="ws__tag">#{t}</span>)}
                        <span className="ws__bytes">{it.sizeBytes}B · v{it.version}</span>
                      </div>
                    </div>
                    <div className="ws__row-actions">
                      <button type="button" className="ws__btn ws__btn--small" onClick={() => openEdit(it.kind, it.slug)}>Edit</button>
                      <button type="button" className="ws__btn ws__btn--small ws__btn--danger" onClick={() => removeItem(it.kind, it.slug)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Editor modal */}
      {draft && (
        <div className="ws-modal" role="dialog" aria-modal="true">
          <div className="ws-modal__panel">
            <div className="ws-modal__header">
              <strong>{draft.isNew ? 'New' : 'Edit'} {KIND_LABEL[draft.kind]}</strong>
              <button type="button" className="ws__btn ws__btn--ghost" onClick={() => setDraft(null)}>×</button>
            </div>

            <div className="ws-modal__grid">
              <label className="ws-field">
                <span>Kind</span>
                <select
                  value={draft.kind}
                  disabled={!draft.isNew}
                  onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))}
                >
                  {KIND_ORDER.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </label>

              <label className="ws-field">
                <span>Slug</span>
                <input
                  type="text"
                  value={draft.slug}
                  disabled={!draft.isNew}
                  onChange={e => setDraft(d => ({ ...d, slug: e.target.value.toLowerCase() }))}
                  placeholder="lowercase-with-hyphens"
                />
              </label>

              <label className="ws-field ws-field--wide">
                <span>Display name</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="Friendly title"
                />
              </label>

              {draft.kind === 'agent' && (
                <label className="ws-field">
                  <span>Agent id</span>
                  <input
                    type="text"
                    value={draft.agent}
                    onChange={e => setDraft(d => ({ ...d, agent: e.target.value.toLowerCase() }))}
                    placeholder="e.g. openclaw"
                  />
                </label>
              )}

              {draft.kind === 'knowledge' && (
                <label className="ws-field">
                  <span>Stage</span>
                  <select
                    value={draft.stage}
                    onChange={e => setDraft(d => ({ ...d, stage: e.target.value }))}
                  >
                    {KNOWLEDGE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}

              <label className="ws-field ws-field--wide">
                <span>Tags (comma-separated)</span>
                <input
                  type="text"
                  value={draft.tags}
                  onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))}
                  placeholder="tag1, tag2"
                />
              </label>
            </div>

            <textarea
              className="ws-modal__editor"
              value={draft.content}
              onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
              placeholder="# Content (Markdown)"
              spellCheck={false}
            />

            <div className="ws-modal__footer">
              <span className="ws-modal__hint">{(draft.content || '').length} chars</span>
              <button type="button" className="ws__btn ws__btn--ghost" onClick={() => setDraft(null)}>Cancel</button>
              <button type="button" className="ws__btn ws__btn--primary" onClick={saveDraft} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context preview */}
      {preview && (
        <div className="ws-modal" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className="ws-modal__panel" onClick={e => e.stopPropagation()}>
            <div className="ws-modal__header">
              <strong>LLM workspace context preview</strong>
              <button type="button" className="ws__btn ws__btn--ghost" onClick={() => setPreview(null)}>×</button>
            </div>
            {preview.loading && <div className="ws__loading">Loading…</div>}
            {preview.error && <div className="ws__error">{preview.error}</div>}
            {preview.data && (
              <>
                <div className="ws-modal__hint">
                  {preview.data.bytes} bytes · sections: {(preview.data.sections || []).join(', ') || 'none'}
                  {preview.data.truncated ? ' · TRUNCATED' : ''}
                </div>
                <pre className="ws-modal__preview">{preview.data.workspaceContext || '(empty)'}</pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
