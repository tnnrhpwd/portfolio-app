/**
 * PermissionsManager — the webapp half of the addon's permission/consent
 * source of truth.
 *
 * The addon itself is the enforcement point (simple-addon/server/automation/
 * permissions.js), and its own dashboard "Permissions" tab exposes the full
 * set of controls (category defaults, per-tool overrides, shell allow/deny
 * lists, filesystem sandbox roots). This component intentionally does NOT
 * duplicate all of that — it surfaces the subset that:
 *   1. Every user actually needs quick access to from the webapp (kill
 *      switch, auto-approve), and
 *   2. Previously had NO way to grant/revoke from ANY UI at all (sensitive
 *      data consents — keyboard capture during recording, cloud vision) —
 *      the recorder would 403 forever with no path to resolve it.
 *
 * Consent state is synced to the signed-in user's backend account (kind=
 * 'settings', slug='automation-consents'), so granting/revoking here, in the
 * addon dashboard, or on another device/addon install all converge on the
 * same state — see permissions.js's pullAndMergeConsentsFromCloud.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  getAutomationPermissions,
  getAutomationConsents,
  setAutomationConsents,
  activateKillSwitch,
  deactivateKillSwitch,
  setAutoApproveAll,
} from '../../services/simpleAddonApi';
import './PermissionsManager.css';

function fmtWhen(ts) {
  if (!ts) return 'Not granted';
  try { return `Granted ${new Date(ts).toLocaleString()}`; } catch { return ''; }
}

export default function PermissionsManager({ addonConnected }) {
  const [perms, setPerms] = useState(null);
  const [consents, setConsents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!addonConnected) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([
        getAutomationPermissions(),
        getAutomationConsents(),
      ]);
      setPerms(p);
      setConsents(c);
    } catch (e) {
      setError(e.message || 'Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, [addonConnected]);

  useEffect(() => { refresh(); }, [refresh]);

  const withBusy = useCallback(async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  }, []);

  const onToggleKillSwitch = useCallback((next) => withBusy(async () => {
    const cfg = next ? await activateKillSwitch() : await deactivateKillSwitch();
    setPerms((p) => ({ ...(p || {}), globalKillSwitch: !!cfg.globalKillSwitch }));
  }), [withBusy]);

  const onToggleAutoApprove = useCallback((next) => withBusy(async () => {
    const cfg = await setAutoApproveAll(next);
    setPerms((p) => ({ ...(p || {}), autoApproveAll: !!cfg.autoApproveAll }));
  }), [withBusy]);

  const onToggleConsent = useCallback((field, next) => withBusy(async () => {
    const res = await setAutomationConsents({ [field]: next });
    setConsents({ dataCapture: res.dataCapture, cloudVision: res.cloudVision });
  }), [withBusy]);

  if (!addonConnected) {
    return (
      <div className="perms-empty">
        <p>Install and connect the Simple addon to manage automation permissions and data consents.</p>
        <a className="perms-link" href="/blog/simple-addon">How to install →</a>
      </div>
    );
  }

  if (loading) return <p className="perms-hint">Loading permissions…</p>;

  const killOn = !!perms?.globalKillSwitch;
  const autoApprove = !!perms?.autoApproveAll;
  const kb = consents?.dataCapture || { keyboard: false, keyboardGrantedAt: null };
  const cv = consents?.cloudVision || { granted: false, grantedAt: null };

  return (
    <div className="perms-root">
      {error && <div className="perms-error">{error}</div>}

      <div className="adv-group">
        <div className="adv-group__row">
          <div>
            <label className="adv-group__label">Emergency Kill Switch</label>
            <p className="adv-group__desc">Immediately blocks every tool call and stops the agent. Persists across addon restarts until turned back off.</p>
          </div>
          <label className={`perms-toggle ${killOn ? 'is-on is-danger' : ''}`}>
            <input type="checkbox" checked={killOn} disabled={busy} onChange={(e) => onToggleKillSwitch(e.target.checked)} />
            <span>{killOn ? 'Active' : 'Off'}</span>
          </label>
        </div>
      </div>

      <div className="adv-group">
        <div className="adv-group__row">
          <div>
            <label className="adv-group__label">Auto-approve actions</label>
            <p className="adv-group__desc">Runs tool calls that would normally prompt ("ask" mode) without a popup. The kill switch and hard-blocked commands are unaffected.</p>
          </div>
          <label className={`perms-toggle ${autoApprove ? 'is-on' : ''}`}>
            <input type="checkbox" checked={autoApprove} disabled={busy} onChange={(e) => onToggleAutoApprove(e.target.checked)} />
            <span>{autoApprove ? 'On' : 'Off'}</span>
          </label>
        </div>
      </div>

      <h3 className="adv-section__subtitle">🔐 Sensitive data consents</h3>
      <p className="perms-sync-note">
        Synced to your account — granting or revoking here applies on every device and addon install signed in as you.
      </p>

      <div className="adv-group">
        <div className="adv-group__row">
          <div>
            <label className="adv-group__label">Keyboard capture while recording</label>
            <p className="adv-group__desc">Lets the macro recorder capture keystrokes so recorded macros can replay typed text. Required to record any macro that involves typing.</p>
            <p className="perms-status">{fmtWhen(kb.keyboardGrantedAt)}</p>
          </div>
          <label className={`perms-toggle ${kb.keyboard ? 'is-on' : ''}`}>
            <input type="checkbox" checked={!!kb.keyboard} disabled={busy} onChange={(e) => onToggleConsent('keyboardCapture', e.target.checked)} />
            <span>{kb.keyboard ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
      </div>

      <div className="adv-group">
        <div className="adv-group__row">
          <div>
            <label className="adv-group__label">Cloud vision (screenshot analysis)</label>
            <p className="adv-group__desc">Allows sending screenshots to a cloud AI model when local screen understanding needs help (e.g. visually locating a UI element).</p>
            <p className="perms-status">{fmtWhen(cv.grantedAt)}</p>
          </div>
          <label className={`perms-toggle ${cv.granted ? 'is-on' : ''}`}>
            <input type="checkbox" checked={!!cv.granted} disabled={busy} onChange={(e) => onToggleConsent('cloudVision', e.target.checked)} />
            <span>{cv.granted ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
      </div>

      <p className="perms-hint">
        Need per-tool overrides, shell command allow/deny lists, or filesystem sandbox roots? Open the desktop addon's own <strong>Permissions</strong> tab (tray icon → Open Dashboard) — same underlying settings, more detail.
      </p>
    </div>
  );
}
