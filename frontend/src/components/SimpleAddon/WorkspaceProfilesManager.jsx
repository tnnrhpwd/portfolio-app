/**
 * WorkspaceProfilesManager — save/restore window-layout ("workspace") profiles.
 *
 * Mirrors the desktop addon's own dashboard "Workspace Profiles" tab
 * (simple-addon/renderer/dashboard.html) so the same feature is reachable
 * from the webapp's Advanced Settings instead of only the tray dashboard.
 * A profile captures every visible window's position, size, and state on
 * this PC so the whole arrangement (e.g. "Coding setup") can be restored
 * with one click later.
 *
 * This is local OS window management — it only works talking to the
 * connected local addon (never the cloud backend), so the whole panel is
 * gated on `addonConnected`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  listWorkspaceProfiles,
  saveWorkspaceProfile,
  restoreWorkspaceProfile,
  updateWorkspaceProfile,
  deleteWorkspaceProfile,
} from '../../services/simpleAddonApi';
import { ADDON_DOWNLOAD_URL } from '../../hooks/simpleAddon/useAddonDetection';
import './WorkspaceProfilesManager.css';

function fmtSavedAt(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch { return ''; }
}

export default function WorkspaceProfilesManager({ addonConnected }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busySlug, setBusySlug] = useState(null);
  const [newName, setNewName] = useState('');
  const [includeDashboard, setIncludeDashboard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  const refresh = useCallback(async () => {
    if (!addonConnected) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const { profiles: list } = await listWorkspaceProfiles();
      setProfiles(list || []);
    } catch (e) {
      setError(e.message || 'Failed to load workspace profiles');
    } finally {
      setLoading(false);
    }
  }, [addonConnected]);

  useEffect(() => { refresh(); }, [refresh]);

  const withBusy = useCallback(async (slug, fn) => {
    setBusySlug(slug);
    setError(null);
    try { await fn(); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusySlug(null); }
  }, []);

  const onSaveNew = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      await saveWorkspaceProfile(name, { includeDashboard });
      setNewName('');
      setStatusMsg(`Saved "${name}".`);
      await refresh();
    } catch (e) {
      setError(e.message || 'Failed to save workspace profile');
    } finally {
      setSaving(false);
      setTimeout(() => setStatusMsg(null), 4000);
    }
  }, [newName, includeDashboard, refresh]);

  const onRestore = useCallback((slug, name) => withBusy(slug, async () => {
    const result = await restoreWorkspaceProfile(name);
    const count = result?.restored?.length ?? result?.windows?.length ?? 0;
    setStatusMsg(`Restored "${name}" (${count} window${count === 1 ? '' : 's'}).`);
    setTimeout(() => setStatusMsg(null), 4000);
  }), [withBusy]);

  const onUpdate = useCallback((slug, name) => withBusy(slug, async () => {
    await updateWorkspaceProfile(name, { includeDashboard: undefined });
    setStatusMsg(`Updated "${name}" from the current window arrangement.`);
    setTimeout(() => setStatusMsg(null), 4000);
    await refresh();
  }), [withBusy, refresh]);

  const onDelete = useCallback((slug, name) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete workspace profile "${name}"? This cannot be undone.`)) return;
    return withBusy(slug, async () => {
      await deleteWorkspaceProfile(name);
      await refresh();
    });
  }, [withBusy, refresh]);

  if (!addonConnected) {
    return (
      <div className="perms-empty">
        <p>Install and connect the Simple addon to save and restore window arrangements on this PC.</p>
        <a className="perms-link" href={ADDON_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">Download the Simple addon →</a>
      </div>
    );
  }

  return (
    <div className="wsp-root">
      {error && <div className="perms-error">{error}</div>}
      {statusMsg && <div className="wsp-status-banner">{statusMsg}</div>}

      <div className="perms-card wsp-save-card">
        <div>
          <label className="adv-group__label">Save current window arrangement</label>
          <p className="adv-group__desc">Captures every visible window's position, size, and state so it can be restored later.</p>
          <label className="wsp-checkbox-row">
            <input
              type="checkbox"
              checked={includeDashboard}
              onChange={e => setIncludeDashboard(e.target.checked)}
            />
            <span>Also remember whether this settings window was open</span>
          </label>
        </div>
        <div className="wsp-save-actions">
          <input
            type="text"
            className="adv-input"
            placeholder="e.g. Coding setup"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveNew(); }}
          />
          <button
            type="button"
            className="adv-btn adv-btn--sm adv-btn--active"
            disabled={saving || !newName.trim()}
            onClick={onSaveNew}
          >
            {saving ? 'Saving…' : '+ Save New'}
          </button>
        </div>
      </div>

      <h3 className="adv-section__subtitle">🗂 Saved profiles</h3>

      {loading ? (
        <p className="perms-hint">Loading…</p>
      ) : profiles.length === 0 ? (
        <p className="perms-hint">No workspace profiles saved yet. Arrange your windows the way you like, then save a profile above.</p>
      ) : (
        <div className="wsp-list">
          {profiles.map(p => (
            <div key={p.slug} className="wsp-row">
              <div className="wsp-row__main">
                <div className="wsp-row__name">{p.name}</div>
                <div className="wsp-row__meta">
                  <span>{p.windowCount} window{p.windowCount === 1 ? '' : 's'}</span>
                  {p.savedAt && <span>· saved {fmtSavedAt(p.savedAt)}</span>}
                  {p.dashboardTracked && <span className="wsp-tag">{p.dashboardOpen ? 'includes settings window' : 'settings window excluded'}</span>}
                </div>
              </div>
              <div className="wsp-row__actions">
                <button
                  type="button"
                  className="adv-btn adv-btn--sm adv-btn--active"
                  disabled={busySlug === p.slug}
                  onClick={() => onRestore(p.slug, p.name)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="adv-btn adv-btn--sm"
                  disabled={busySlug === p.slug}
                  onClick={() => onUpdate(p.slug, p.name)}
                >
                  Update
                </button>
                <button
                  type="button"
                  className="adv-btn adv-btn--sm adv-btn--danger"
                  disabled={busySlug === p.slug}
                  onClick={() => onDelete(p.slug, p.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="perms-hint">
        Windows are matched back up by app + title when restoring, so closing an app between saving and restoring may skip that window.
      </p>
    </div>
  );
}
