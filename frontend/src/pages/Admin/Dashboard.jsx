import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import dataService from "../../features/data/dataService.js";
import CollapsibleSection from "../../components/Admin/CollapsibleSection.jsx";
import AdminPanel from "../../components/Admin/AdminPanel.jsx";
import KpiTile from "../../components/Admin/KpiTile.jsx";
import { KpiSkeleton, PanelSkeleton } from "../../components/Admin/AdminSkeleton.jsx";
import { useAdminReadout } from "./adminBarContext";
import countryName from "../../utils/countryName.js";
import { fmt, pct, formatTimestamp, sharePct } from "./adminShared";

/**
 * Dashboard — what you look at, in the order you look at it.
 *
 * The purchase gate (the one control that used to sit at the top of this view)
 * now lives on /admin/funnel-tester: this view is the one a **Special** account
 * can open, and the gate is an admin-only write surface. Keeping a control here
 * that a Special account can't use meant either a 403 panel or a permission
 * check inside the layout — moving it is the honest fix.
 */
function Dashboard() {
  const { user } = useSelector((state) => state.data);
  const navigate = useNavigate();

  // ── Aggregated dashboard state ──
  const [dashboard, setDashboard] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState(null);

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

  const ts = formatTimestamp;
  const d = dashboard; // shorthand

  // Ranked lists get proportion bars, so each needs the largest value in its own
  // list as the 100% reference. The API returns these sorted, but deriving the
  // max means a change in that ordering can't silently squash every bar.
  const maxCountry = Math.max(1, ...(d?.visitors.topCountries ?? []).map((c) => Number(c.count) || 0));
  const maxReferer = Math.max(1, ...(d?.visitors.topReferers ?? []).map((r) => Number(r.count) || 0));
  const maxStoreCost = Math.max(
    1,
    Number(d?.storage?.estimatedMonthlyS3Cost) || 0,
    Number(d?.storage?.estimatedMonthlyDynamoCost) || 0
  );

  // The headline numbers live in the sticky toolbar, so they survive a scroll
  // through the long secondary panels below (§5.7).
  useAdminReadout(
    d
      ? [
          { label: 'Users', value: fmt(d.overview.totalUsers) },
          { label: 'MRR', value: `$${d.overview.estimatedMRR}` },
          { label: 'Visitors 7d', value: fmt(d.visitors.uniqueWeek) },
          {
            label: 'Open bugs',
            value: d.bugs.open,
            tone: d.bugs.open > 0 ? 'warn' : 'ok',
          },
        ]
      : null
  );

  return (
    <>
      {/* ─── What you come here for: the numbers, above the fold ───
          Neutral glass by default, and a tile only takes a hue when its number
          has a state to report. Six differently-colored cards told you nothing
          about which of the six to look at (Admin.css §7). */}
      {d && (
        <div className="kpi-grid">
          {/* The strip normalises: every tile wears the console's accent, so the one
              that changes colour is the one with something to report. Open Bugs is
              that tile — its alert tone appears only when the count is not zero. */}
          <KpiTile
            label="Total Users"
            value={fmt(d.overview.totalUsers)}
            sub={`+${d.users.newThisMonth} this month`}
          />
          <KpiTile
            label="Est. MRR"
            value={`$${d.overview.estimatedMRR}`}
            sub={`${d.overview.paidUsers} paid users`}
          />
          <KpiTile
            label="Visitors (7d)"
            value={fmt(d.visitors.uniqueWeek)}
            sub={`${fmt(d.visitors.thisWeek)} hits`}
          />
          <KpiTile
            label="Open Bugs"
            value={d.bugs.open}
            sub={`${d.bugs.total} total`}
            tone={d.bugs.open > 0 ? 'warn' : undefined}
          />
          <KpiTile
            label="Avg Rating"
            value={`${d.reviews.avgRating} ★`}
            sub={`${d.reviews.total} reviews`}
          />
          <KpiTile
            label="Est. Storage Cost"
            value={`$${d.storage?.estimatedMonthlyCost ?? '0.00'}`}
            sub={`${d.storage?.meteredFormatted ?? '—'} stored`}
          />
        </div>
      )}

      {/* First paint: placeholders shaped like the real thing, so the page does
          not reflow when the numbers land. A REFRESH keeps the data on screen —
          swapping figures a user is mid-read for grey boxes is worse than a beat
          of staleness — so the skeletons only ever stand in for a first load. */}
      {!d && dashLoading && (
        <>
          <KpiSkeleton />
          <PanelSkeleton rows={5} />
          <span className="sr-only" role="status">Loading dashboard…</span>
        </>
      )}

      {d && dashLoading && <div className="admin-loading">Refreshing dashboard…</div>}
      {dashError && (
        <div className="admin-error">
          <span>{dashError}</span>
          <button className="btn-sm btn-retry" onClick={() => fetchDashboard()}>↻ Retry</button>
        </div>
      )}

      {d && (
        <>
          {/* ─── Conversion story ───
              Deliberately NEUTRAL: this is the one panel whose data is already a
              colour ramp (blue → pink → green down the stages), and a fifth hue
              on its accent rule would only compete with it. */}
          <AdminPanel
            title="Sales funnel"
            hint="Visitor → registered → paid, from the visitor log and the user records."
            tools={<span className="admin-chip">Visitor → paid <strong>{pct(d.funnel.overallConversion)}</strong></span>}
          >
            <div className="funnel-container">
              <div className="funnel-stage">
                <span className="funnel-label">Visitors</span>
                <div className="funnel-track">
                  <div className="funnel-bar" style={{ width: '100%' }} />
                </div>
                <span className="funnel-count">{fmt(d.funnel.totalVisitors)}</span>
                <span className="funnel-arrow">↓ {pct(d.funnel.visitorToUserRate)} convert</span>
              </div>

              <div className="funnel-stage">
                <span className="funnel-label">Registered</span>
                <div className="funnel-track">
                  {/* True proportions with a 1.5% floor, so a small step still
                      shows a visible sliver instead of vanishing. */}
                  <div
                    className="funnel-bar funnel-bar-mid"
                    style={{ width: `${Math.max(1.5, (d.funnel.registeredUsers / Math.max(d.funnel.totalVisitors, 1)) * 100)}%` }}
                  />
                </div>
                <span className="funnel-count">{fmt(d.funnel.registeredUsers)}</span>
                <span className="funnel-arrow">↓ {pct(d.funnel.userToPaidRate)} convert</span>
              </div>

              <div className="funnel-stage">
                <span className="funnel-label">Paid</span>
                <div className="funnel-track">
                  <div
                    className="funnel-bar funnel-bar-end"
                    style={{ width: `${Math.max(1.5, (d.funnel.paidUsers / Math.max(d.funnel.totalVisitors, 1)) * 100)}%` }}
                  />
                </div>
                <span className="funnel-count">{fmt(d.funnel.paidUsers)}</span>
              </div>
            </div>
          </AdminPanel>

          {/* ─── Who pays, and who just arrived ─── */}
          <div className="admin-grid admin-grid--two">
            <AdminPanel title="Membership breakdown">
              <table className="mini-table">
                <thead>
                  <tr><th>Plan</th><th>Users</th><th>Revenue/mo</th></tr>
                </thead>
                <tbody>
                  {Object.entries(d.revenue.byPlan).map(([plan, info]) => (
                    <tr
                      key={plan}
                      className="admin-share"
                      style={{ '--share': sharePct(info.count, d.overview.totalUsers) }}
                    >
                      <td>
                        {/* Two different questions, two different colours: the
                            chip answers "which plan?" with the plan's own hue
                            (the `.plan-badge` convention from /admin/users),
                            the bar answers "how much of the user base?" with the
                            panel's money hue. */}
                        <span className={`plan-badge plan-${plan.toLowerCase()}`}>{plan}</span>
                      </td>
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
            </AdminPanel>

            <AdminPanel title="Recent signups">
              <div className="recent-signups-list">
                {d.users.recentSignups.slice(0, 8).map((u, i) => (
                  <div key={i} className="signup-row">
                    <span className="signup-name">{u.nickname || u.email}</span>
                    <span className={`plan-badge plan-${u.rank?.toLowerCase()}`}>{u.rank}</span>
                    <span className="signup-date">{ts(u.createdAt)}</span>
                  </div>
                ))}
              </div>
            </AdminPanel>
          </div>

          {/* ─── Secondary: folded away, the way plumbing should be ─── */}
          {d.storage && (
            <CollapsibleSection title="Storage & costs" defaultCollapsed={true}>
              <div className="admin-grid admin-grid--two">
                <AdminPanel title="Stored data">
                  <table className="mini-table">
                    <thead>
                      <tr><th>Source</th><th>Size</th><th>Est. cost/mo</th></tr>
                    </thead>
                    <tbody>
                      {/* Bars are by COST, not by bytes: the panel's question is
                          "what is this costing me", and a byte split answers a
                          different one. */}
                      <tr
                        className="admin-share"
                        style={{ '--share': sharePct(d.storage.estimatedMonthlyS3Cost, maxStoreCost) }}
                      >
                        <td className="plan-name">S3 attachments</td>
                        <td>{d.storage.s3Formatted}</td>
                        <td>${d.storage.estimatedMonthlyS3Cost}</td>
                      </tr>
                      <tr
                        className="admin-share"
                        style={{ '--share': sharePct(d.storage.estimatedMonthlyDynamoCost, maxStoreCost) }}
                      >
                        <td className="plan-name">DynamoDB records</td>
                        <td>{d.storage.dynamoFormatted}</td>
                        <td>${d.storage.estimatedMonthlyDynamoCost}</td>
                      </tr>
                      <tr className="mini-table-total">
                        <td><strong>Total</strong></td>
                        <td><strong>{d.storage.meteredFormatted}</strong></td>
                        <td><strong>${d.storage.estimatedMonthlyCost}</strong></td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="admin-panel-hint">
                    List-price estimate (us-east-1). Excludes requests, egress and CloudFront;
                    the lifecycle rules move older S3 objects to cheaper classes, so actual S3
                    cost is usually lower.
                  </p>
                </AdminPanel>

                <AdminPanel title="Attachments">
                  <div className="stat-rows">
                    <div className="stat-row">
                      <span>Files stored</span>
                      <strong>{d.storage.fileCount}</strong>
                    </div>
                    <div className="stat-row">
                      <span>Legacy inline (base64)</span>
                      <strong>{d.storage.inlineFormatted}</strong>
                    </div>
                  </div>
                  <p className="admin-panel-hint">
                    Inline attachments live in DynamoDB at ~10x S3 cost. New uploads use the
                    S3 upload path.
                  </p>
                </AdminPanel>
              </div>
            </CollapsibleSection>
          )}

          <CollapsibleSection title="Traffic analytics" defaultCollapsed={true}>
            <div className="admin-grid">
              <AdminPanel title="Visitor summary">
                <div className="stat-rows">
                  <div className="stat-row"><span>Today</span><span><strong>{fmt(d.visitors.uniqueToday)}</strong> <small className="muted">{fmt(d.visitors.today)} hits</small></span></div>
                  <div className="stat-row"><span>This Week</span><span><strong>{fmt(d.visitors.uniqueWeek)}</strong> <small className="muted">{fmt(d.visitors.thisWeek)} hits</small></span></div>
                  <div className="stat-row"><span>This Month</span><span><strong>{fmt(d.visitors.uniqueMonth)}</strong> <small className="muted">{fmt(d.visitors.thisMonth)} hits</small></span></div>
                  <div className="stat-row"><span>All Time</span><span><strong>{fmt(d.visitors.uniqueTotal)}</strong> <small className="muted">{fmt(d.visitors.total)} hits</small></span></div>
                </div>
              </AdminPanel>

              <AdminPanel title="Top countries">
                <div className="stat-rows">
                  {d.visitors.topCountries.map((c, i) => (
                    <div
                      key={i}
                      className="stat-row admin-share"
                      style={{ '--share': sharePct(c.count, maxCountry) }}
                    >
                      {/* The API returns ipinfo's two-letter country code; a
                          report should spell it out. */}
                      <span>{countryName(c.country)}</span>
                      <strong>{fmt(c.count)}</strong>
                    </div>
                  ))}
                  {d.visitors.topCountries.length === 0 && <div className="stat-row muted">No data</div>}
                </div>
              </AdminPanel>

              <AdminPanel title="Top referrers">
                <div className="stat-rows">
                  {d.visitors.topReferers.map((r, i) => {
                    const host = (r.source || "").replace(/^www\./, "");
                    return (
                      <div
                        key={i}
                        className="stat-row stat-row--clickable admin-share"
                        style={{ '--share': sharePct(r.count, maxReferer) }}
                        onClick={() => navigate("/admin/map", { state: { refererFilter: host } })}
                        title={`Show visitors from ${host}`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate("/admin/map", { state: { refererFilter: host } }); }}
                      >
                        <span>{r.source}</span><strong>{fmt(r.count)}</strong>
                      </div>
                    );
                  })}
                  {d.visitors.topReferers.length === 0 && <div className="stat-row muted">No data</div>}
                </div>
              </AdminPanel>
            </div>
          </CollapsibleSection>

          {/* ─── Refresh ─── */}
          <div className="admin-footer-actions">
            <button className="btn-refresh" onClick={() => fetchDashboard(true)}>
              ↻ Refresh dashboard
            </button>
            {d.cachedAt && <small className="muted">Last updated {ts(d.cachedAt)}</small>}
          </div>
        </>
      )}
    </>
  );
}

export default Dashboard;
