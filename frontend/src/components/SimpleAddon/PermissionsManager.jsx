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
import { ADDON_DOWNLOAD_URL } from '../../hooks/simpleAddon/useAddonDetection';
import { DEFAULT_CLOUD_PROVIDER, providerLabel } from '../../constants/aiModel.js';
import './PermissionsManager.css';

function fmtWhen(ts) {
  if (!ts) return 'Not granted';
  try { return `Granted ${new Date(ts).toLocaleString()}`; } catch { return ''; }
}

/**
 * §6.3 first-use consent copy — plain-language data-egress description shown
 * in a modal BEFORE a sensitive consent is granted for the first time. The
 * backend still enforces the gate (see permissions.js / the recorder 403), so
 * this modal is UX, not the safety mechanism.
 */
const CONSENT_COPY = {
  cloudVision: {
    title: 'Send screenshots to cloud AI?',
    body: `Turning this on lets Simple send screenshots of your screen to a cloud AI service (${providerLabel(DEFAULT_CLOUD_PROVIDER)}) over an encrypted connection — and only when local screen understanding needs help (for example, visually locating a button or window a recorded macro couldn't find). Images are processed to answer a single question and are not stored or sold. You can turn this off at any time, and it takes effect immediately.`,
  },
  keyboardCapture: {
    title: 'Record your keystrokes?',
    body: 'Turning this on lets the macro recorder capture the keys you press while recording, so recorded macros can replay typed text. Keystrokes are stored in your own local recordings, and anything that looks like a password or personal path is removed before you publish a macro. Turn it off at any time.',
  },
};

export default function PermissionsManager({ addonConnected }) {
  const [perms, setPerms] = useState(null);
  const [consents, setConsents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // First-use consent modal: set to { field } when a consent is about to be
  // granted for the first time, so we can show the data-egress copy first.
  const [pendingConsent, setPendingConsent] = useState(null);

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

  const onToggleConsent = useCallback((field, next) => {
    // Revocation is immediate (no confirmation needed). First-time grant opens
    // the consent modal (§6.3) instead of granting blindly.
    if (!next) {
      withBusy(async () => {
        const res = await setAutomationConsents({ [field]: false });
        setConsents({ dataCapture: res.dataCapture, cloudVision: res.cloudVision });
      })();
      return;
    }
    setPendingConsent({ field });
  }, [withBusy]);

  const handleConfirmConsent = useCallback(() => withBusy(async () => {
    const field = pendingConsent?.field;
    if (!field) return;
    const res = await setAutomationConsents({ [field]: true });
    setConsents({ dataCapture: res.dataCapture, cloudVision: res.cloudVision });
    setPendingConsent(null);
  }), [pendingConsent, withBusy]);

  const handleCancelConsent = useCallback(() => setPendingConsent(null), []);

  if (!addonConnected) {
    return (
      <div className="perms-empty">
        <p>Install and connect the Simple addon to manage automation permissions and data consents.</p>
        <a className="perms-link" href={ADDON_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">Download the Simple addon →</a>
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

      {pendingConsent && CONSENT_COPY[pendingConsent.field] && (
        <div className="perms-modal" role="dialog" aria-modal="true" aria-label={CONSENT_COPY[pendingConsent.field].title}>
          <div className="perms-modal__panel">
            <h3 className="perms-modal__title">{CONSENT_COPY[pendingConsent.field].title}</h3>
            <p className="perms-modal__body">{CONSENT_COPY[pendingConsent.field].body}</p>
            <div className="perms-modal__actions">
              <button type="button" className="perms-modal__btn perms-modal__btn--cancel" onClick={handleCancelConsent} disabled={busy}>Not now</button>
              <button type="button" className="perms-modal__btn perms-modal__btn--confirm" onClick={handleConfirmConsent} disabled={busy}>
                {busy ? 'Saving…' : 'Allow'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`perms-card ${killOn ? 'perms-card--on perms-card--danger' : ''}`}>
        <div>
          <label className="adv-group__label">Emergency Kill Switch</label>
          <p className="adv-group__desc">Immediately blocks every tool call and stops the agent. Persists across addon restarts until turned back off.</p>
        </div>
        <label className={`perms-switch ${killOn ? 'perms-switch--danger' : ''}`}>
          <input type="checkbox" checked={killOn} disabled={busy} onChange={(e) => onToggleKillSwitch(e.target.checked)} />
          <span className="perms-switch__track" />
          <span className="perms-switch__label">{killOn ? 'On' : 'Off'}</span>
        </label>
      </div>

      <div className={`perms-card ${autoApprove ? 'perms-card--on' : ''}`}>
        <div>
          <label className="adv-group__label">Auto-approve actions</label>
          <p className="adv-group__desc">Runs tool calls that would normally prompt ("ask" mode) without a popup. The kill switch and hard-blocked commands are unaffected.</p>
        </div>
        <label className="perms-switch">
          <input type="checkbox" checked={autoApprove} disabled={busy} onChange={(e) => onToggleAutoApprove(e.target.checked)} />
          <span className="perms-switch__track" />
          <span className="perms-switch__label">{autoApprove ? 'On' : 'Off'}</span>
        </label>
      </div>

      <h3 className="adv-section__subtitle">🔐 Sensitive data consents</h3>
      <p className="perms-sync-note">
        Synced to your account — granting or revoking here applies on every device and addon install signed in as you.
      </p>

      <div className={`perms-card ${kb.keyboard ? 'perms-card--on' : ''}`}>
        <div>
          <label className="adv-group__label">Keyboard capture while recording</label>
          <p className="adv-group__desc">Lets the macro recorder capture keystrokes so recorded macros can replay typed text. Required to record any macro that involves typing.</p>
          <p className="perms-status">{fmtWhen(kb.keyboardGrantedAt)}</p>
        </div>
        <label className="perms-switch">
          <input type="checkbox" checked={!!kb.keyboard} disabled={busy} onChange={(e) => onToggleConsent('keyboardCapture', e.target.checked)} />
          <span className="perms-switch__track" />
          <span className="perms-switch__label">{kb.keyboard ? 'On' : 'Off'}</span>
        </label>
      </div>

      <div className={`perms-card ${cv.granted ? 'perms-card--on' : ''}`}>
        <div>
          <label className="adv-group__label">Cloud vision (screenshot analysis)</label>
          <p className="adv-group__desc">Allows sending screenshots to a cloud AI model when local screen understanding needs help (e.g. visually locating a UI element).</p>
          <p className="perms-status">{fmtWhen(cv.grantedAt)}</p>
        </div>
        <label className="perms-switch">
          <input type="checkbox" checked={!!cv.granted} disabled={busy} onChange={(e) => onToggleConsent('cloudVision', e.target.checked)} />
          <span className="perms-switch__track" />
          <span className="perms-switch__label">{cv.granted ? 'On' : 'Off'}</span>
        </label>
      </div>

      <p className="perms-hint">
        Need per-tool overrides, shell command allow/deny lists, or filesystem sandbox roots? Open the desktop addon's own <strong>Permissions</strong> tab (tray icon → Open Dashboard) — same underlying settings, more detail.
      </p>
    </div>
  );
}
