import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import dataService from "../../features/data/dataService.js";
import { fmt } from "./adminShared";
import { toast } from "react-toastify";

// Lookback windows for the ranking report.
const DAY_OPTIONS = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

/**
 * Page Rankings — shows the most-visited and least-visited pages on the site
 * based on the page-view tracking added to the frontend.
 */
function PageRankings() {
  const { user } = useSelector((state) => state.data);

  const [rankings, setRankings] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchRankings = useCallback(
    async (nextDays, refresh = false) => {
      if (!user?.token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await dataService.getPageRankings(user.token, {
          days: nextDays,
          refresh,
        });
        setRankings(data);
      } catch (err) {
        const msg =
          err?.response?.data?.error ||
          err?.response?.data?.dataMessage ||
          err.message ||
          "Failed to load page rankings";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  // Refetch whenever the lookback window changes.
  useEffect(() => {
    fetchRankings(days);
  }, [days, fetchRankings]);

  const pages = rankings?.pages || [];
  const top = pages.slice(0, 10);
  const worst = pages.slice(-10).reverse(); // least-visited first

  return (
    <section className="admin-section-tile">
      <h2>Page Rankings</h2>
      <p className="admin-help-text">
        Most and least visited pages, ranked by the page-view beacon fired on every
        route change. Only pages with at least one recorded visit appear here.
      </p>

      <div className="section-toolbar">
        <select
          className="type-select"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Lookback window"
        >
          {DAY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          className="btn-sm btn-retry"
          onClick={() => fetchRankings(days, true)}
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>

      {loading && <div className="admin-loading">Loading page rankings…</div>}

      {error && (
        <div className="admin-error">
          <span>{error}</span>
          <button className="btn-sm btn-retry" onClick={() => fetchRankings(days)}>
            ↻ Retry
          </button>
        </div>
      )}

      {!loading && !error && rankings && (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Total Page Views</span>
              <span className="kpi-value">{fmt(rankings.totalViews)}</span>
              <span className="kpi-sub">last {rankings.days} days</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Pages With Visits</span>
              <span className="kpi-value">{fmt(pages.length)}</span>
              <span className="kpi-sub">distinct paths</span>
            </div>
          </div>

          <div className="traffic-grid">
            <div className="traffic-card">
              <h4>🔝 Most visited</h4>
              <div className="stat-rows">
                {top.map((p, i) => (
                  <div key={p.path} className="stat-row">
                    <span>
                      <span className="muted">{i + 1}. </span>
                      {p.path}
                    </span>
                    <strong>{fmt(p.visits)}</strong>
                  </div>
                ))}
                {top.length === 0 && <div className="stat-row muted">No visits recorded yet</div>}
              </div>
            </div>

            <div className="traffic-card">
              <h4>📉 Least visited</h4>
              <div className="stat-rows">
                {worst.map((p) => (
                  <div key={p.path} className="stat-row">
                    <span>{p.path}</span>
                    <strong>{fmt(p.visits)}</strong>
                  </div>
                ))}
                {worst.length === 0 && <div className="stat-row muted">No visits recorded yet</div>}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default PageRankings;
