import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import dataService from "../../features/data/dataService.js";
import VisitorMap from "../../components/Admin/VisitorMap.jsx";
import parseVisitorData from "../../utils/parseVisitorData.js";
import { formatTimestamp } from "./adminShared";

function VisitorMapPage() {
  const { user } = useSelector((state) => state.data);
  const location = useLocation();

  // ── All data for visitor map ──
  const [allData, setAllData] = useState(null);
  const [allDataLoading, setAllDataLoading] = useState(false);

  // ── Date + referer filter ──
  const today = new Date().toISOString().split("T")[0];
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  const [fromDate, setFromDate] = useState(lastWeek.toISOString().split("T")[0]);
  const [toDate, setToDate] = useState(today);
  const [refererFilter, setRefererFilter] = useState(location.state?.refererFilter || "");
  const [hideOwnVisits, setHideOwnVisits] = useState(true);

  // ═══════════════ Fetch all data ═══════════════
  const fetchAllData = useCallback(async (force = false) => {
    if (!user?.token || (allData && !force)) return;
    setAllDataLoading(true);
    try {
      const data = await dataService.getAllData(user.token);
      setAllData(data);
    } catch { /* handled by service */ }
    finally { setAllDataLoading(false); }
  }, [user, allData]);

  useEffect(() => {
    fetchAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══════════════ Derived data from allData ═══════════════
  const visitorLocations = useMemo(() => {
    if (!allData) return [];
    const ownId = user?._id ? String(user._id) : null;
    const visitorMap = new Map();
    allData.forEach(item => {
      const visitor = parseVisitorData(item.text);
      if (visitor?.country && visitor?.ip) {
        // Skip visits from the account we're logged in with (e.g. own VPN IPs)
        if (hideOwnVisits && ownId && String(visitor.userId) === ownId) return;
        const existing = visitorMap.get(visitor.ip);
        if (!existing || new Date(item.createdAt) > new Date(existing.timestamp)) {
          visitor.timestamp = item.createdAt || visitor.timestamp;
          visitorMap.set(visitor.ip, visitor);
        }
      }
    });
    return Array.from(visitorMap.values()).filter(
      v => v.ip && v.country && v.city && v.region &&
           v.country !== "undefined" && v.city !== "undefined" && v.region !== "undefined"
    );
  }, [allData, user, hideOwnVisits]);

  const filteredVisitorLocations = useMemo(() => {
    return visitorLocations.filter(v => {
      const d = new Date(v.timestamp).toISOString().split("T")[0];
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      if (refererFilter) {
        if (refererFilter.startsWith("category:")) {
          const cat = refererFilter.slice("category:".length);
          if ((v.refererCategory || "") !== cat) return false;
        } else if (refererFilter === "__direct__") {
          const host = v.refererHost || "";
          if (host && host !== "none" && host !== "invalid") return false;
        } else {
          if ((v.refererHost || "") !== refererFilter) return false;
        }
      }
      return true;
    });
  }, [visitorLocations, fromDate, toDate, refererFilter]);

  // Only locations with real coordinates can be plotted on the map
  const mapLocations = useMemo(() => {
    return filteredVisitorLocations.filter(
      (v) => Number.isFinite(v.lat) && Number.isFinite(v.lon)
    );
  }, [filteredVisitorLocations]);

  // Build dropdown options: hosts + categories with counts, sorted by frequency
  const refererOptions = useMemo(() => {
    const hostCounts = new Map();
    const catCounts = new Map();
    let directCount = 0;
    visitorLocations.forEach(v => {
      const host = v.refererHost || "";
      const cat = v.refererCategory || "";
      if (!host || host === "none" || host === "invalid") {
        directCount++;
      } else {
        hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
      }
      if (cat) catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
    });
    const hosts = Array.from(hostCounts.entries()).sort(([, a], [, b]) => b - a);
    const cats = Array.from(catCounts.entries()).sort(([, a], [, b]) => b - a);
    return { hosts, cats, directCount };
  }, [visitorLocations]);

  const ts = formatTimestamp;

  return (
    <section className="admin-section-tile">
      <h2>Visitor Map</h2>

      {allDataLoading && <div className="admin-loading">Loading visitor data...</div>}
      {!allDataLoading && (
        <>
          <div className="date-filter">
            <label htmlFor="from-date">From:</label>
            <input type="date" id="from-date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <label htmlFor="to-date">To:</label>
            <input type="date" id="to-date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            <label htmlFor="referer-filter">Referer:</label>
            <select
              id="referer-filter"
              value={refererFilter}
              onChange={(e) => setRefererFilter(e.target.value)}
            >
              <option value="">All ({visitorLocations.length})</option>
              {refererOptions.directCount > 0 && (
                <option value="__direct__">Direct / none ({refererOptions.directCount})</option>
              )}
              {refererOptions.cats.length > 0 && (
                <optgroup label="By category">
                  {refererOptions.cats.map(([cat, count]) => (
                    <option key={`cat-${cat}`} value={`category:${cat}`}>{cat} ({count})</option>
                  ))}
                </optgroup>
              )}
              {refererOptions.hosts.length > 0 && (
                <optgroup label="By host">
                  {refererOptions.hosts.map(([host, count]) => (
                    <option key={`host-${host}`} value={host}>{host} ({count})</option>
                  ))}
                </optgroup>
              )}
            </select>
            {refererFilter && (
              <button className="btn-sm" onClick={() => setRefererFilter("")}>Clear</button>
            )}
            <label className="hide-own-visits" title="Hide visits from the account you're logged in with">
              <input
                type="checkbox"
                checked={hideOwnVisits}
                onChange={(e) => setHideOwnVisits(e.target.checked)}
              />
              Hide my visits
            </label>
            <span className="visit-counter">{filteredVisitorLocations.length} visit{filteredVisitorLocations.length !== 1 ? 's' : ''}</span>
          </div>
          {filteredVisitorLocations.length > 0 && (
            mapLocations.length > 0
              ? <VisitorMap locations={mapLocations} />
              : <p className="admin-no-data">No geo-coordinate data for these visits yet. New visits will appear here once coordinates are recorded.</p>
          )}
          {filteredVisitorLocations.length > 0 && (
            <div className="visitor-list">
              <h4>Visitor details {refererFilter && <span className="muted">(filtered)</span>}</h4>
              <div className="table-scroll-container">
              <table className="admin-table compact-table">
                <thead><tr>
                  <th>When</th><th>IP</th><th>Location</th><th>Browser / OS</th><th>Referer</th><th>Category</th>
                </tr></thead>
                <tbody>
                  {filteredVisitorLocations
                    .slice()
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                    .slice(0, 200)
                    .map((v, i) => (
                      <tr key={`${v.ip}-${i}`}>
                        <td>{ts(v.timestamp)}</td>
                        <td className="mono">{v.ip}</td>
                        <td>{[v.city, v.region, v.country].filter(Boolean).join(", ")}</td>
                        <td>{v.browser} / {v.os}</td>
                        <td title={v.referer}>
                          {v.refererHost && v.refererHost !== "none" && v.refererHost !== "invalid"
                            ? v.refererHost
                            : <span className="muted">direct</span>}
                        </td>
                        <td>{v.refererCategory || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
              {filteredVisitorLocations.length > 200 && (
                <p className="muted">Showing 200 most recent of {filteredVisitorLocations.length}</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default VisitorMapPage;
