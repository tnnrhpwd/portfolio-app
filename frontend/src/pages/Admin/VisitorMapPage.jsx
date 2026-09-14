import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import dataService from "../../features/data/dataService.js";
import VisitorMap from "../../components/Admin/VisitorMap.jsx";
import AdminPanel from "../../components/Admin/AdminPanel.jsx";
import parseVisitorData from "../../utils/parseVisitorData.js";
import countryName from "../../utils/countryName.js";
import { useAdminReadout } from "./adminBarContext";
import { formatTimestamp } from "./adminShared";
import { ADMIN_USER_ID } from "../../constants/admin";

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
  // Noise filters. Both default to the useful setting: the admin's own browsing
  // is almost always the loudest thing in the list (and 127.0.0.1/one VPN IP
  // hosts every hit), while Special accounts are usually real testers whose
  // visits are worth seeing.
  const [hideAdminVisits, setHideAdminVisits] = useState(true);
  const [hideSpecialVisits, setHideSpecialVisits] = useState(false);

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

  // ═══════════════ Who is who ═══════════════
  // Built from the payload the map already reads (`getAllData` returns every
  // row, user records included), so there is no second request — the previous
  // `getAdminUsers({ limit: 200 })` lookup silently missed anyone past the first
  // 200 accounts, and it also needs an endpoint a Special account can't reach.
  const { nicknameById, specialIds } = useMemo(() => {
    const nicknames = new Map();
    const specials = new Set();
    (allData || []).forEach((item) => {
      const text = item.text || "";
      // Same user-record test the admin data browser uses: a password field is
      // what distinguishes a user row from a visitor/review/bug row.
      if (!item.id || !(text.includes("Email:") && text.includes("Password:"))) return;
      const id = String(item.id);
      const nickname = text.match(/(?:^|\|)Nickname:([^|]*)/)?.[1]?.trim();
      if (nickname) nicknames.set(id, nickname);
      if (/(?:^|\|)Special:true/i.test(text)) specials.add(id);
    });
    return { nicknameById: nicknames, specialIds: specials };
  }, [allData]);

  // ═══════════════ Derived data from allData ═══════════════
  const visitorLocations = useMemo(() => {
    if (!allData) return [];
    const visitorMap = new Map();
    allData.forEach(item => {
      const visitor = parseVisitorData(item.text);
      if (visitor?.country && visitor?.ip) {
        const visitorId = String(visitor.userId || "");
        // The admin account's own visits (VPN IPs, localhost, every page load
        // while building the site) — hidden by default.
        if (hideAdminVisits && visitorId && visitorId === ADMIN_USER_ID) return;
        // Accounts carrying the Special tag, hidden on request.
        if (hideSpecialVisits && visitorId && specialIds.has(visitorId)) return;
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
  }, [allData, hideAdminVisits, hideSpecialVisits, specialIds]);

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

  useAdminReadout(
    visitorLocations.length > 0
      ? [
          { label: 'Visits', value: filteredVisitorLocations.length },
          { label: 'Pinned', value: mapLocations.length },
          ...(refererFilter ? [{ label: 'Filter', value: refererFilter.replace('category:', '') }] : []),
        ]
      : null
  );

  return (
    <>
      {allDataLoading && <div className="admin-loading">Loading visitor data...</div>}

      {!allDataLoading && (
        <AdminPanel
          title="Visits"
          tools={
            <div className="date-filter">
              <label htmlFor="from-date">From</label>
              <input type="date" id="from-date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              <label htmlFor="to-date">To</label>
              <input type="date" id="to-date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              <label htmlFor="referer-filter">Referer</label>
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
              <label
                className="hide-own-visits"
                title="Hide visits from the admin account — your own browsing, every build preview and any VPN IP it shares"
              >
                <input
                  type="checkbox"
                  checked={hideAdminVisits}
                  onChange={(e) => setHideAdminVisits(e.target.checked)}
                />
                Hide admin visits
              </label>
              <label
                className="hide-own-visits"
                title="Hide visits from accounts an admin flagged Special"
              >
                <input
                  type="checkbox"
                  checked={hideSpecialVisits}
                  onChange={(e) => setHideSpecialVisits(e.target.checked)}
                />
                Hide special visits
              </label>
            </div>
          }
        >
          {filteredVisitorLocations.length === 0 && (
            <p className="admin-no-data">No visits in this window — widen the dates or clear the referer filter.</p>
          )}
          {filteredVisitorLocations.length > 0 && (
            mapLocations.length > 0
              ? <VisitorMap locations={mapLocations} />
              : <p className="admin-no-data">No geo-coordinate data for these visits yet. New visits will appear here once coordinates are recorded.</p>
          )}
        </AdminPanel>
      )}

      {!allDataLoading && filteredVisitorLocations.length > 0 && (
        <AdminPanel title={refererFilter ? "Visitor details (filtered)" : "Visitor details"}>
          <div className="table-scroll-container">
          {/* `admin-table--visits` drives the stacked phone layout, whose field
              labels live in the matching `nth-child` rules in Admin.css §18 —
              keep the two column lists in step. */}
          <table className="admin-table compact-table admin-table--stacked admin-table--visits">
            <thead><tr>
              <th>When</th><th>User</th><th>IP</th><th>Location</th><th>Browser / OS</th><th>Referer</th><th>Category</th>
            </tr></thead>
            <tbody>
              {filteredVisitorLocations
                .slice()
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 200)
                .map((v, i) => (
                  <tr key={`${v.ip}-${i}`}>
                    <td>{ts(v.timestamp)}</td>
                    <td>
                      {v.userId
                        ? <>
                            <span className="user-badge user-badge--in" title={`User ID: ${v.userId}`}>
                              ✓ {nicknameById.get(String(v.userId)) || "Logged in"}
                            </span>
                            {/* Just the star: in a table the label is noise, and the
                                `title` carries the meaning on hover. */}
                            {specialIds.has(String(v.userId)) && (
                              <span className="plan-badge plan-special" title="Flagged Special by an admin">⭐</span>
                            )}
                          </>
                        : <span className="user-badge user-badge--out" title="No user logged in">Guest</span>}
                    </td>
                    <td className="mono">{v.ip}</td>
                    <td>
                      {/* Country codes are spelled out, same as Top countries. */}
                      {[v.city, v.region, countryName(v.country)].filter(Boolean).join(", ")}
                    </td>
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
            <p className="muted">Showing the 200 most recent of {filteredVisitorLocations.length} visits</p>
          )}
        </AdminPanel>
      )}
    </>
  );
}

export default VisitorMapPage;
