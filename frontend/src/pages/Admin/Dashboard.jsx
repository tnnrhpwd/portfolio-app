import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import dataService from "../../features/data/dataService.js";
import CollapsibleSection from "../../components/Admin/CollapsibleSection.jsx";
import { fmt, pct, formatTimestamp } from "./adminShared";
import { toast } from "react-toastify";

function Dashboard() {
  const { user } = useSelector((state) => state.data);
  const navigate = useNavigate();

  // ── Aggregated dashboard state ──
  const [dashboard, setDashboard] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState(null);

  // ── Purchase Gate state ──
  const [purchaseGate, setPurchaseGate] = useState(null);
  const [purchaseGateLoading, setPurchaseGateLoading] = useState(true);
  const [purchaseGateSaving, setPurchaseGateSaving] = useState(false);
  const [purchaseGateError, setPurchaseGateError] = useState(null);
  const [purchaseGateUpdatedAt, setPurchaseGateUpdatedAt] = useState(null);

  // ═══════════════ Fetch aggregated dashboard ═══════════════
  const fetchDashboard = useCallback(async (refresh = false) => {
    if (!user?.token) return;
    setDashLoading(true);
    setDashError(null);
    try {
      const data = await dataService.getAdminDashboard(user.token, refresh);
      setDashboard(data);
    } catch (err) {
      setDashError(err.message || "Failed to load dashboard");
    } finally {
      setDashLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // ═══════════════ Fetch + save Purchase Gate settings ═══════════════
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
  const d = dashboard; // shorthand

  return (
    <section className="admin-section-tile">
      <h2>Dashboard</h2>

      {/* ─── Purchase Gate: instant kill switch for new/upgraded subscriptions ─── */}
      <div className={`purchase-gate-card ${purchaseGate && !purchaseGate.purchasesEnabled ? "purchase-gate-card--paused" : ""}`}>
        <div className="purchase-gate-header">
          <div>
            <h3>Purchase Gate</h3>
            <p className="admin-help-text">
              Instantly pause new/upgraded Pro subscriptions and hide upgrade buttons across the site.
              Existing subscribers and switching down to Free are never affected.
            </p>
          </div>
          <label className="purchase-gate-switch" title={purchaseGate?.purchasesEnabled ? "Purchasing is on — click to pause" : "Purchasing is paused — click to re-enable"}>
            <input
              type="checkbox"
              checked={!!purchaseGate?.purchasesEnabled}
              disabled={purchaseGateLoading || purchaseGateSaving || !purchaseGate}
              onChange={(e) => handleTogglePurchases(e.target.checked)}
            />
            <span className="purchase-gate-slider" />
            <span className="purchase-gate-switch-label">
              {purchaseGateSaving ? "Saving…" : purchaseGate?.purchasesEnabled ? "Purchasing ON" : "Purchasing PAUSED"}
            </span>
          </label>
        </div>

        {purchaseGateLoading && <div className="admin-loading">Loading purchase gate settings...</div>}
        {purchaseGateError && (
          <div className="admin-error">
            <span>{purchaseGateError}</span>
            <button className="btn-sm btn-retry" onClick={fetchPurchaseGate}>↻ Retry</button>
          </div>
        )}

        {!purchaseGateLoading && purchaseGate && (
          <div className="purchase-gate-message-row">
            <label htmlFor="purchase-gate-message">Caveat message shown to visitors while paused:</label>
            <textarea
              id="purchase-gate-message"
              rows={2}
              value={purchaseGate.message || ""}
              onChange={(e) => setPurchaseGate((prev) => ({ ...prev, message: e.target.value }))}
              placeholder="Upgrading is temporarily paused while we finish getting the core product ready."
            />
            <div className="section-toolbar">
              <button className="btn-sm btn-retry" onClick={handleSavePurchaseGateMessage} disabled={purchaseGateSaving}>
                {purchaseGateSaving ? "Saving…" : "Save message"}
              </button>
              {purchaseGateUpdatedAt && (
                <span className="admin-no-data">Last saved: {ts(purchaseGateUpdatedAt)}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {dashLoading && <div className="admin-loading">Loading dashboard...</div>}
      {dashError && (
        <div className="admin-error">
          <span>{dashError}</span>
          <button className="btn-sm btn-retry" onClick={() => fetchDashboard()}>↻ Retry</button>
        </div>
      )}

      {d && (
        <>
          {/* ─── KPI Cards ─── */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Total Users</span>
              <span className="kpi-value">{fmt(d.overview.totalUsers)}</span>
              <span className="kpi-sub">+{d.users.newThisMonth} this month</span>
            </div>
            <div className="kpi-card kpi-revenue">
              <span className="kpi-label">Est. MRR</span>
              <span className="kpi-value">${d.overview.estimatedMRR}</span>
              <span className="kpi-sub">{d.overview.paidUsers} paid users</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Visitors (7d)</span>
              <span className="kpi-value">{fmt(d.visitors.thisWeek)}</span>
              <span className="kpi-sub">{fmt(d.visitors.uniqueWeek)} unique IPs</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Open Bugs</span>
              <span className="kpi-value">{d.bugs.open}</span>
              <span className="kpi-sub">{d.bugs.total} total</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Avg Rating</span>
              <span className="kpi-value">{d.reviews.avgRating} ★</span>
              <span className="kpi-sub">{d.reviews.total} reviews</span>
            </div>
          </div>

          {/* ─── Sales Funnel ─── */}
          <CollapsibleSection title="Sales Funnel & Conversions" defaultCollapsed={false}>
            <div className="funnel-container">
              <div className="funnel-stage">
                <div className="funnel-bar" style={{ width: '100%' }}>
                  <span className="funnel-bar-label">Visitors</span>
                </div>
                <span className="funnel-count">{fmt(d.funnel.totalVisitors)}</span>
              </div>
              <div className="funnel-arrow">↓ {pct(d.funnel.visitorToUserRate)} convert</div>
              <div className="funnel-stage">
                <div className="funnel-bar funnel-bar-mid" style={{ width: `${Math.max(5, (d.funnel.registeredUsers / Math.max(d.funnel.totalVisitors, 1)) * 100)}%` }}>
                  <span className="funnel-bar-label">Registered</span>
                </div>
                <span className="funnel-count">{fmt(d.funnel.registeredUsers)}</span>
              </div>
              <div className="funnel-arrow">↓ {pct(d.funnel.userToPaidRate)} convert</div>
              <div className="funnel-stage">
                <div className="funnel-bar funnel-bar-end" style={{ width: `${Math.max(3, (d.funnel.paidUsers / Math.max(d.funnel.totalVisitors, 1)) * 100)}%` }}>
                  <span className="funnel-bar-label">Paid</span>
                </div>
                <span className="funnel-count">{fmt(d.funnel.paidUsers)}</span>
              </div>
              <div className="funnel-summary">
                Overall visitor → paid conversion: <strong>{pct(d.funnel.overallConversion)}</strong>
              </div>
            </div>
          </CollapsibleSection>

          {/* ─── Revenue & Memberships ─── */}
          <CollapsibleSection title="Revenue & Memberships" defaultCollapsed={false}>
            <div className="revenue-grid">
              <div className="revenue-card">
                <h4>Membership Breakdown</h4>
                <table className="mini-table">
                  <thead>
                    <tr><th>Plan</th><th>Users</th><th>Revenue/mo</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(d.revenue.byPlan).map(([plan, info]) => (
                      <tr key={plan}>
                        <td className="plan-name">{plan.charAt(0).toUpperCase() + plan.slice(1)}</td>
                        <td>{info.count}</td>
                        <td>${info.revenue}</td>
                      </tr>
                    ))}
                    <tr className="mini-table-total">
                      <td><strong>Total MRR</strong></td>
                      <td><strong>{d.overview.totalUsers}</strong></td>
                      <td><strong>${d.revenue.estimatedMRR}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="revenue-card">
                <h4>Recent Signups</h4>
                <div className="recent-signups-list">
                  {d.users.recentSignups.slice(0, 8).map((u, i) => (
                    <div key={i} className="signup-row">
                      <span className="signup-name">{u.nickname || u.email}</span>
                      <span className={`plan-badge plan-${u.rank?.toLowerCase()}`}>{u.rank}</span>
                      <span className="signup-date">{ts(u.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* ─── Traffic Analytics ─── */}
          <CollapsibleSection title="Traffic Analytics" defaultCollapsed={true}>
            <div className="traffic-grid">
              <div className="traffic-card">
                <h4>Visitor Summary</h4>
                <div className="stat-rows">
                  <div className="stat-row"><span>Today</span><strong>{fmt(d.visitors.today)}</strong></div>
                  <div className="stat-row"><span>This Week</span><strong>{fmt(d.visitors.thisWeek)}</strong></div>
                  <div className="stat-row"><span>This Month</span><strong>{fmt(d.visitors.thisMonth)}</strong></div>
                  <div className="stat-row"><span>All Time</span><strong>{fmt(d.visitors.total)}</strong></div>
                </div>
              </div>
              <div className="traffic-card">
                <h4>Top Countries</h4>
                <div className="stat-rows">
                  {d.visitors.topCountries.map((c, i) => (
                    <div key={i} className="stat-row">
                      <span>{c.country}</span><strong>{fmt(c.count)}</strong>
                    </div>
                  ))}
                  {d.visitors.topCountries.length === 0 && <div className="stat-row muted">No data</div>}
                </div>
              </div>
              <div className="traffic-card">
                <h4>Top Referrers</h4>
                <div className="stat-rows">
                  {d.visitors.topReferers.map((r, i) => {
                    const host = (r.source || "").replace(/^www\./, "");
                    return (
                      <div
                        key={i}
                        className="stat-row stat-row--clickable"
                        onClick={() => navigate("/admin/map", { state: { refererFilter: host } })}
                        title={`Show visitors from ${host}`}
                        role="button"
                        tabIndex={0}
                      >
                        <span>{r.source}</span><strong>{fmt(r.count)}</strong>
                      </div>
                    );
                  })}
                  {d.visitors.topReferers.length === 0 && <div className="stat-row muted">No data</div>}
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* ─── Refresh ─── */}
          <div className="admin-footer-actions">
            <button className="btn-refresh" onClick={() => fetchDashboard(true)}>
              ↻ Refresh Dashboard
            </button>
            {d.cachedAt && <small className="muted">Last updated: {ts(d.cachedAt)}</small>}
          </div>
        </>
      )}
    </section>
  );
}

export default Dashboard;
