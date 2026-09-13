import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import dataService from "../../features/data/dataService.js";
import AdminPanel from "../../components/Admin/AdminPanel.jsx";
import { useAdminReadout } from "./adminBarContext";
import { formatTimestamp } from "./adminShared";
import { toast } from "react-toastify";

/**
 * Funnel Tester — the admin-only "rehearse the purchase" view.
 *
 * It also hosts the **Purchase gate**, the instant kill switch for new and
 * upgraded Pro subscriptions. The gate used to sit on the Dashboard, but the
 * Dashboard is one of the four views a Special account may open and the gate's
 * endpoints are admin-only — so it lives here, on a view Special accounts
 * cannot reach at all (see middleware/adminAccess.js).
 */
function FunnelTester() {
  const { user } = useSelector((state) => state.data);

  const [funnel, setFunnel] = useState(null);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [funnelError, setFunnelError] = useState(null);
  const [showTestCreds, setShowTestCreds] = useState(false);

  // ── Purchase gate (admin-only settings) ──
  const [purchaseGate, setPurchaseGate] = useState(null);
  const [purchaseGateLoading, setPurchaseGateLoading] = useState(true);
  const [purchaseGateSaving, setPurchaseGateSaving] = useState(false);
  const [purchaseGateError, setPurchaseGateError] = useState(null);
  const [purchaseGateUpdatedAt, setPurchaseGateUpdatedAt] = useState(null);

  const fetchFunnelStatus = useCallback(async () => {
    if (!user?.token) return;
    setFunnelLoading(true);
    setFunnelError(null);
    try {
      const data = await dataService.getTestFunnelStatus(user.token);
      setFunnel(data);
    } catch (err) {
      setFunnelError(err?.response?.data?.message || err.message || 'Failed');
    } finally {
      setFunnelLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchFunnelStatus(); }, [fetchFunnelStatus]);

  const handleFunnelInit = useCallback(async () => {
    if (!user?.token) return;
    setFunnelLoading(true);
    setFunnelError(null);
    try {
      const data = await dataService.initTestFunnel(user.token);
      toast.success(data.message || 'Test funnel initialised');
      setShowTestCreds(true);
      await fetchFunnelStatus();
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Failed to init';
      setFunnelError(msg);
      toast.error(msg);
    } finally {
      setFunnelLoading(false);
    }
  }, [user, fetchFunnelStatus]);

  const handleFunnelReset = useCallback(async () => {
    if (!user?.token) return;
    setFunnelLoading(true);
    setFunnelError(null);
    try {
      const data = await dataService.resetTestFunnel(user.token);
      toast.success(data.message || 'Test funnel reset');
      await fetchFunnelStatus();
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Failed to reset';
      setFunnelError(msg);
      toast.error(msg);
    } finally {
      setFunnelLoading(false);
    }
  }, [user, fetchFunnelStatus]);

  // ═══════════════ Purchase gate (admin-only) ═══════════════
  const fetchPurchaseGate = useCallback(async () => {
    if (!user?.token) return;
    setPurchaseGateLoading(true);
    setPurchaseGateError(null);
    try {
      const res = await dataService.getAdminPurchaseGateSettings(user.token);
      setPurchaseGate(res.settings || { purchasesEnabled: true, message: "" });
      setPurchaseGateUpdatedAt(res.updatedAt || null);
    } catch (err) {
      setPurchaseGateError(err.message || "Failed to load purchase gate settings");
    } finally {
      setPurchaseGateLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchPurchaseGate(); }, [fetchPurchaseGate]);

  const savePurchaseGate = useCallback(async (nextSettings) => {
    if (!user?.token) return;
    setPurchaseGateSaving(true);
    setPurchaseGateError(null);
    try {
      const res = await dataService.updateAdminPurchaseGateSettings(user.token, nextSettings);
      setPurchaseGate(res.settings || nextSettings);
      setPurchaseGateUpdatedAt(res.updatedAt || null);
      toast.success(nextSettings.purchasesEnabled
        ? "Purchasing re-enabled."
        : "Purchasing paused — upgrade buttons are now hidden/disabled site-wide.");
    } catch (err) {
      const msg = err?.response?.data?.dataMessage || err.message || "Failed to save purchase gate settings";
      setPurchaseGateError(msg);
      toast.error(msg);
    } finally {
      setPurchaseGateSaving(false);
    }
  }, [user]);

  // Toggling applies instantly — this is meant to be a one-click "pause now" switch
  const handleTogglePurchases = useCallback((checked) => {
    const next = { ...(purchaseGate || {}), purchasesEnabled: checked };
    setPurchaseGate(next);
    savePurchaseGate(next);
  }, [purchaseGate, savePurchaseGate]);

  const handleSavePurchaseGateMessage = useCallback(() => {
    if (!purchaseGate) return;
    savePurchaseGate(purchaseGate);
  }, [purchaseGate, savePurchaseGate]);

  const ts = formatTimestamp;

  useAdminReadout(
    [
      ...(purchaseGate
        ? [{
            label: 'Purchasing',
            value: purchaseGate.purchasesEnabled ? 'ON' : 'PAUSED',
            tone: purchaseGate.purchasesEnabled ? 'ok' : 'bad',
          }]
        : []),
      ...(funnel?.initialised
        ? [
            { label: 'Run', value: `#${funnel.run || 0}` },
            { label: 'Steps', value: funnel.funnel?.steps?.length || 0 },
            { label: 'Emails', value: funnel.emails?.length || 0 },
          ]
        : []),
    ]
  );

  return (
    <>
      {/* ─── The one control you act on: the instant kill switch ─── */}
      <AdminPanel
        hue={!purchaseGate ? "blue" : purchaseGate.purchasesEnabled ? "ok" : "bad"}
        title="Purchase gate"
        hint="Instantly pause new and upgraded Pro subscriptions and hide upgrade buttons site-wide. Existing subscribers and anyone switching down to Free are never affected."
        tools={
          <label
            className="purchase-gate-switch"
            title={
              !purchaseGate
                ? "Purchase gate state not loaded"
                : purchaseGate.purchasesEnabled
                  ? "Purchasing is on — click to pause"
                  : "Purchasing is paused — click to re-enable"
            }
          >
            <input
              type="checkbox"
              checked={!!purchaseGate?.purchasesEnabled}
              disabled={purchaseGateLoading || purchaseGateSaving || !purchaseGate}
              onChange={(e) => handleTogglePurchases(e.target.checked)}
            />
            <span className="purchase-gate-slider" />
            <span className="purchase-gate-switch-label">
              {!purchaseGate
                ? "State unknown"
                : purchaseGateSaving
                  ? "Saving…"
                  : purchaseGate.purchasesEnabled
                    ? "Purchasing ON"
                    : "Purchasing PAUSED"}
            </span>
          </label>
        }
      >
        {purchaseGateLoading && <div className="admin-loading">Loading purchase gate settings...</div>}
        {purchaseGateError && (
          <div className="admin-error">
            <span>{purchaseGateError}</span>
            <button className="btn-sm btn-retry" onClick={fetchPurchaseGate}>↻ Retry</button>
          </div>
        )}

        {!purchaseGateLoading && purchaseGate && (
          <div className="purchase-gate-message-row">
            <label htmlFor="purchase-gate-message">Caveat message shown to visitors while paused</label>
            <textarea
              id="purchase-gate-message"
              rows={2}
              value={purchaseGate.message || ""}
              onChange={(e) => setPurchaseGate((prev) => ({ ...prev, message: e.target.value }))}
              placeholder="Upgrading is temporarily paused while we finish getting the core product ready."
            />
            <div className="section-toolbar">
              <button className="btn-sm" onClick={handleSavePurchaseGateMessage} disabled={purchaseGateSaving}>
                {purchaseGateSaving ? "Saving…" : "Save message"}
              </button>
              {purchaseGateUpdatedAt && (
                <span className="admin-chip">Saved <strong>{ts(purchaseGateUpdatedAt)}</strong></span>
              )}
            </div>
          </div>
        )}
      </AdminPanel>

      <AdminPanel
      title="Test user"
      hint="A disposable account you can sign in as elsewhere to walk the whole purchase funnel. Emails are captured instead of sent, and every step is timed. Reset restores all state so you can run it again."
      tools={
        <>
          <button className="btn-sm" onClick={handleFunnelInit} disabled={funnelLoading}>
            {funnelLoading ? '…' : funnel?.initialised ? '⟳ Re-initialise' : '▶ Initialise test user'}
          </button>
          {funnel?.initialised && (
            <button className="btn-sm btn-reset" onClick={handleFunnelReset} disabled={funnelLoading}>
              ↺ Reset &amp; restore
            </button>
          )}
          {funnel?.initialised && (
            <button className="btn-sm btn-outline" onClick={fetchFunnelStatus} disabled={funnelLoading}>
              ↻ Refresh status
            </button>
          )}
          {funnel?.run > 0 && <span className="admin-chip">Run <strong>#{funnel.run}</strong></span>}
        </>
      }
    >
      <div className="funnel-test-panel">
        {funnelError && (
          <div className="admin-error">
            <span>{funnelError}</span>
            <button className="btn-sm btn-retry" onClick={fetchFunnelStatus}>↻ Retry</button>
          </div>
        )}

        {!funnel?.initialised && !funnelLoading && (
          <p className="admin-no-data">No test user yet — initialise one to start.</p>
        )}

        {funnel?.initialised && (
          <>
            {/* Credentials + Stripe state read as one row of two planes. */}
            <div className="admin-grid admin-grid--two">
              <div className="test-creds-box">
                <h4>
                  Test Credentials
                  <button className="btn-inline" onClick={() => setShowTestCreds(v => !v)}>
                    {showTestCreds ? 'Hide' : 'Show'}
                  </button>
                </h4>
                {showTestCreds && (
                  <div className="creds-grid">
                    <span className="creds-label">Email</span>
                    <code>{funnel.testUser?.email}</code>
                    <span className="creds-label">Password</span>
                    <code>{funnel.testUser?.email ? 'TestFunnel2024!' : '—'}</code>
                    <span className="creds-label">Stripe ID</span>
                    <code>{funnel.testUser?.stripeCustomerId || '—'}</code>
                    <span className="creds-label">Current Rank</span>
                    <span className={`plan-badge plan-${(funnel.testUser?.currentRank || 'free').toLowerCase()}`}>
                      {funnel.testUser?.currentRank || 'Free'}
                    </span>
                  </div>
                )}
              </div>

              {funnel.stripeState && (
                <div className="test-stripe-state">
                  <h4>Stripe State</h4>
                  <div className="stat-rows">
                    <div className="stat-row">
                      <span>Active Subscriptions</span>
                      <strong>{funnel.stripeState.subscriptions?.filter(s => s.status === 'active').length || 0}</strong>
                    </div>
                    <div className="stat-row">
                      <span>Payment Methods</span>
                      <strong>{funnel.stripeState.paymentMethods?.length || 0}</strong>
                    </div>
                    {funnel.stripeState.subscriptions?.map(sub => (
                      <div key={sub.id} className="stat-row muted">
                        <span>{sub.id.slice(0, 20)}...</span>
                        <span className={`type-badge type-${sub.status === 'active' ? 'user' : 'other'}`}>
                          {sub.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Funnel steps timeline */}
            {funnel.funnel?.steps?.length > 0 && (
              <div className="funnel-timeline">
                <h4>Funnel Steps ({funnel.funnel.totalFormatted} total)</h4>
                <div className="timeline-list">
                  {funnel.funnel.steps.map((s, i) => (
                    <div key={i} className={`timeline-step ${s.step.endsWith('_response') ? 'response-step' : ''}`}>
                      <span className="timeline-dot" />
                      <span className="timeline-name">{s.step.replace(/_/g, ' ')}</span>
                      <span className="timeline-elapsed">{s.elapsedFormatted}</span>
                      {s.statusCode && <span className={`type-badge type-${s.statusCode < 400 ? 'user' : 'bug'}`}>{s.statusCode}</span>}
                      {s.durationMs != null && <span className="muted">({s.durationMs}ms server)</span>}
                      {s.plan && <span className={`plan-badge plan-${s.plan}`}>{s.plan}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Captured emails */}
            {funnel.emails?.length > 0 && (
              <div className="captured-emails">
                <h4>Captured Emails ({funnel.emails.length})</h4>
                {funnel.emails.map((em, i) => (
                  <div key={i} className="email-card">
                    <div className="email-card-header">
                      <span className="type-badge type-review">{em.template}</span>
                      <span className="muted">{ts(em.timestamp)}</span>
                    </div>
                    <div className="email-card-body">
                      <small>To: {em.to}</small>
                      {em.data?.plan && <span className={`plan-badge plan-${em.data.plan?.toLowerCase()}`}>{em.data.plan}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {funnel.funnel?.steps?.length === 0 && (
              <p className="admin-no-data">No funnel steps recorded yet. Sign in as the test user in another window and start the purchase flow.</p>
            )}
          </>
        )}
      </div>
      </AdminPanel>
    </>
  );
}

export default FunnelTester;
