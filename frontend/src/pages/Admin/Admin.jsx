import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useNavigate } from "react-router-dom";
import { closeBugReport } from "../../features/data/dataSlice";
import dataService from "../../features/data/dataService.js";
import CollapsibleSection from "../../components/Admin/CollapsibleSection.jsx";
import ScrollableTable from "../../components/Admin/ScrollableTable.jsx";
import VisitorMap from "../../components/Admin/VisitorMap.jsx";
import "./Admin.css";
import { toast } from "react-toastify";
import parseVisitorData from "../../utils/parseVisitorData.js";

// ───────────────────── helpers ─────────────────────
const fmt = (n) => Number(n).toLocaleString();
const pct = (n) => `${n}%`;

function Admin() {
  const { user } = useSelector((state) => state.data);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // ── Dashboard state (aggregated from server) ──
  const [dashboard, setDashboard] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState(null);

  // ── Paginated users ──
  const [users, setUsers] = useState([]);
  const [usersPagination, setUsersPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [usersSearch, setUsersSearch] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);

  // ── Paginated raw data ──
  const [rawData, setRawData] = useState([]);
  const [rawPagination, setRawPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [rawType, setRawType] = useState("");
  const [rawLoading, setRawLoading] = useState(false);

  // ── All data for visitor map & bug reports (loaded on-demand) ──
  const [allData, setAllData] = useState(null);
  const [allDataLoading, setAllDataLoading] = useState(false);

  // ── Bug report modal ──
  const [closingBugId, setClosingBugId] = useState(null);
  const [resolutionText, setResolutionText] = useState("");
  const [showResolutionModal, setShowResolutionModal] = useState(false);

  // ── Visitor map date filter ──
  const today = new Date().toISOString().split("T")[0];
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  const [fromDate, setFromDate] = useState(lastWeek.toISOString().split("T")[0]);
  const [toDate, setToDate] = useState(today);

  // ── Active section tracking (for lazy loading) ──
  const [activeSection, setActiveSection] = useState(null);

  // ── Test Funnel state ──
  const [funnel, setFunnel] = useState(null);       // full status from /test-funnel/status
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [funnelError, setFunnelError] = useState(null);
  const [showTestCreds, setShowTestCreds] = useState(false);

  // ═══════════════ Auth gate ═══════════════
  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    if (user._id.toString() !== "6770a067c725cbceab958619") {
      toast.error("Only admin are allowed to use that URL.");
      navigate("/");
    }
  }, [user, navigate]);

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

  // ═══════════════ Fetch paginated users ═══════════════
  const fetchUsers = useCallback(async (page = 1) => {
    if (!user?.token) return;
    setUsersLoading(true);
    try {
      const res = await dataService.getAdminUsers(user.token, { page, limit: 30, search: usersSearch });
      setUsers(res.data);
      setUsersPagination(res.pagination);
    } catch { /* handled by service */ }
    finally { setUsersLoading(false); }
  }, [user, usersSearch]);

  // ═══════════════ Fetch paginated raw data ═══════════════
  const fetchRawData = useCallback(async (page = 1) => {
    if (!user?.token) return;
    setRawLoading(true);
    try {
      const res = await dataService.getAdminPaginatedData(user.token, {
        page, limit: 50, type: rawType || undefined,
      });
      setRawData(res.data);
      setRawPagination(res.pagination);
    } catch { /* handled by service */ }
    finally { setRawLoading(false); }
  }, [user, rawType]);

  // ═══════════════ Fetch all data for map/bugs (on demand) ═══════════════
  const fetchAllData = useCallback(async () => {
    if (!user?.token || allData) return;
    setAllDataLoading(true);
    try {
      const data = await dataService.getAllData(user.token);
      setAllData(data);
    } catch { /* handled by service */ }
    finally { setAllDataLoading(false); }
  }, [user, allData]);

  // ── Trigger fetches when sections expand ──
  const handleSectionToggle = useCallback((sectionName, isOpen) => {
    if (!isOpen) return;
    setActiveSection(sectionName);
    if (sectionName === "users" && users.length === 0) fetchUsers();
    if (sectionName === "data" && rawData.length === 0) fetchRawData();
    if ((sectionName === "map" || sectionName === "bugs" || sectionName === "reviews") && !allData) fetchAllData();
  }, [users, rawData, allData, fetchUsers, fetchRawData, fetchAllData]);

  // ═══════════════ Derived data from allData ═══════════════
  const visitorLocations = useMemo(() => {
    if (!allData) return [];
    const visitorMap = new Map();
    allData.forEach(item => {
      const visitor = parseVisitorData(item.text);
      if (visitor?.country && visitor?.ip) {
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
  }, [allData]);

  const filteredVisitorLocations = useMemo(() => {
    if (!fromDate && !toDate) return visitorLocations;
    return visitorLocations.filter(v => {
      const d = new Date(v.timestamp).toISOString().split("T")[0];
      return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    });
  }, [visitorLocations, fromDate, toDate]);

  const bugReports = useMemo(() => {
    if (!allData) return [];
    return allData
      .filter(item => item.text?.includes('Bug:') && item.text?.includes('Status:') && item.text?.includes('Creator:'))
      .map(item => {
        const parts = {};
        (item.text || '').split('|').forEach(p => {
          const [k, ...v] = p.split(':');
          if (k && v.length) parts[k.toLowerCase()] = v.join(':');
        });
        return {
          id: item.id || item._id,
          title: parts.bug || 'Untitled',
          status: parts.status || 'Open',
          creator: parts.creator || 'Unknown',
          description: parts.description || '',
          resolution: parts.resolution || '',
          resolvedby: parts.resolvedby || '',
          resolvedat: parts.resolvedat || '',
          createdAt: item.createdAt,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [allData]);

  const ratingsAndReviews = useMemo(() => {
    if (!allData) return [];
    return allData
      .filter(item => item.text && (item.text.includes('Review:') || item.text.includes('Rating:')) && item.text.includes('User:'))
      .map(item => {
        const parts = {};
        (item.text || '').split('|').forEach(p => {
          const [k, ...v] = p.split(':');
          if (k && v.length) parts[k.toLowerCase()] = v.join(':');
        });
        return {
          id: item.id || item._id,
          title: parts.review || 'Untitled',
          category: parts.category || 'General',
          rating: parts.rating || 'N/A',
          content: parts.content || '',
          user: parts.user || 'Anonymous',
          createdAt: item.createdAt,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [allData]);

  // ═══════════════ Bug report actions ═══════════════
  const handleCloseBugReport = useCallback(async (reportId) => {
    if (!resolutionText.trim()) {
      toast.error('Enter a resolution description first.');
      return;
    }
    try {
      await dispatch(closeBugReport({ reportId, resolutionText })).unwrap();
      toast.success('Bug report closed.');
      setShowResolutionModal(false);
      setResolutionText('');
      setClosingBugId(null);
      setAllData(null); // force re-fetch
    } catch {
      toast.error('Failed to close bug report.');
    }
  }, [dispatch, resolutionText]);

  // ═══════════════ Test Funnel helpers ═══════════════
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

  // ═══════════════ Format helper ═══════════════
  const ts = useCallback((v) => {
    try { return new Date(v).toLocaleString(); } catch { return v || ''; }
  }, []);

  // ═══════════════ Render ═══════════════
  const d = dashboard; // shorthand

  return (
    <>
      <Header />
      <div className="admin-container">
        <section className="admin-section-tile">
          <h2>Administrator Panel</h2>

          {dashLoading && <div className="admin-loading">Loading dashboard...</div>}
          {dashError && <div className="admin-error">{dashError}</div>}

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
                      {d.visitors.topReferers.map((r, i) => (
                        <div key={i} className="stat-row">
                          <span>{r.source}</span><strong>{fmt(r.count)}</strong>
                        </div>
                      ))}
                      {d.visitors.topReferers.length === 0 && <div className="stat-row muted">No data</div>}
                    </div>
                  </div>
                </div>
              </CollapsibleSection>

              {/* ─── User Management ─── */}
              <CollapsibleSection
                title={`User Management (${d.users.total})`}
                defaultCollapsed={true}
                onToggle={(isOpen) => handleSectionToggle("users", isOpen)}
              >
                <div className="section-toolbar">
                  <input
                    type="text"
                    className="admin-search"
                    placeholder="Search users by email, name, or plan..."
                    value={usersSearch}
                    onChange={(e) => setUsersSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchUsers(1)}
                  />
                  <button className="btn-sm" onClick={() => fetchUsers(1)}>Search</button>
                </div>
                {usersLoading && <div className="admin-loading">Loading users...</div>}
                {!usersLoading && users.length > 0 && (
                  <>
                    <table className="admin-table compact-table">
                      <thead><tr>
                        <th>Nickname</th><th>Email</th><th>Plan</th><th>Stripe ID</th><th>Joined</th>
                      </tr></thead>
                      <tbody>
                        {users.map((u, i) => (
                          <tr key={u.id || i}>
                            <td>{u.nickname || '—'}</td>
                            <td>{u.email}</td>
                            <td><span className={`plan-badge plan-${u.rank?.toLowerCase()}`}>{u.rank}</span></td>
                            <td className="mono">{u.stripeid ? u.stripeid.substring(0, 18) + '...' : '—'}</td>
                            <td>{ts(u.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="pagination">
                      <button disabled={usersPagination.page <= 1} onClick={() => fetchUsers(usersPagination.page - 1)}>← Prev</button>
                      <span>Page {usersPagination.page} of {usersPagination.totalPages} ({usersPagination.total} users)</span>
                      <button disabled={usersPagination.page >= usersPagination.totalPages} onClick={() => fetchUsers(usersPagination.page + 1)}>Next →</button>
                    </div>
                  </>
                )}
                {!usersLoading && users.length === 0 && <p className="admin-no-data">No users found</p>}
              </CollapsibleSection>

              {/* ─── Visitor Map ─── */}
              <CollapsibleSection
                title="Visitor Map"
                defaultCollapsed={true}
                onToggle={(isOpen) => handleSectionToggle("map", isOpen)}
              >
                {allDataLoading && <div className="admin-loading">Loading visitor data...</div>}
                {!allDataLoading && (
                  <>
                    <div className="date-filter">
                      <label htmlFor="from-date">From:</label>
                      <input type="date" id="from-date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                      <label htmlFor="to-date">To:</label>
                      <input type="date" id="to-date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                      <span className="visit-counter">{filteredVisitorLocations.length} visit{filteredVisitorLocations.length !== 1 ? 's' : ''}</span>
                    </div>
                    {filteredVisitorLocations.length > 0
                      ? <VisitorMap locations={filteredVisitorLocations} />
                      : <p className="admin-no-data">No visitor location data available</p>
                    }
                  </>
                )}
              </CollapsibleSection>

              {/* ─── Bug Reports ─── */}
              <CollapsibleSection
                title={`Bug Reports (${d.bugs.open} open)`}
                defaultCollapsed={true}
                onToggle={(isOpen) => handleSectionToggle("bugs", isOpen)}
              >
                {allDataLoading && <div className="admin-loading">Loading...</div>}
                {!allDataLoading && bugReports.length > 0 ? (
                  <table className="admin-table compact-table">
                    <thead><tr>
                      <th>Title</th><th>Status</th><th>Reporter</th><th>Description</th><th>Date</th><th>Actions</th>
                    </tr></thead>
                    <tbody>
                      {bugReports.map(report => (
                        <tr key={report.id}>
                          <td>
                            <strong>{report.title}</strong>
                            {report.resolution && (
                              <div className="report-resolution">
                                <strong>Resolution:</strong> {report.resolution}
                                <br /><small>Resolved by {report.resolvedby}{report.resolvedat && ` on ${new Date(report.resolvedat).toLocaleDateString()}`}</small>
                              </div>
                            )}
                          </td>
                          <td><span className={`status-badge status-${report.status.toLowerCase()}`}>{report.status === 'Open' ? '🔓 Open' : '🔒 Closed'}</span></td>
                          <td>{report.creator}</td>
                          <td>{report.description.length > 100 ? report.description.substring(0, 100) + '...' : report.description}</td>
                          <td>{ts(report.createdAt)}</td>
                          <td>
                            {report.status === 'Open' ? (
                              <button className="btn-close-report" onClick={() => { setClosingBugId(report.id); setShowResolutionModal(true); setResolutionText(''); }}>
                                ✅ Close
                              </button>
                            ) : (
                              <span className="muted">Resolved</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  !allDataLoading && <p className="admin-no-data">No bug reports found</p>
                )}
              </CollapsibleSection>

              {/* ─── Ratings & Reviews ─── */}
              <CollapsibleSection
                title={`Ratings & Reviews (${d.reviews.total})`}
                defaultCollapsed={true}
                onToggle={(isOpen) => handleSectionToggle("reviews", isOpen)}
              >
                {allDataLoading && <div className="admin-loading">Loading...</div>}
                {!allDataLoading && ratingsAndReviews.length > 0 ? (
                  <table className="admin-table compact-table">
                    <thead><tr>
                      <th>Title</th><th>Rating</th><th>Category</th><th>User</th><th>Content</th><th>Date</th>
                    </tr></thead>
                    <tbody>
                      {ratingsAndReviews.map(review => (
                        <tr key={review.id}>
                          <td><strong>{review.title}</strong></td>
                          <td><span className="rating-badge">{'⭐'.repeat(parseInt(review.rating) || 0)} {review.rating}</span></td>
                          <td><span className="category-badge">{review.category}</span></td>
                          <td>{review.user}</td>
                          <td>{review.content.length > 120 ? review.content.substring(0, 120) + '...' : review.content}</td>
                          <td>{ts(review.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  !allDataLoading && <p className="admin-no-data">No ratings or reviews found</p>
                )}
              </CollapsibleSection>

              {/* ─── Data Explorer (paginated) ─── */}
              <CollapsibleSection
                title="Data Explorer"
                defaultCollapsed={true}
                onToggle={(isOpen) => handleSectionToggle("data", isOpen)}
              >
                <div className="section-toolbar">
                  <select className="type-select" value={rawType} onChange={(e) => { setRawType(e.target.value); }}>
                    <option value="">All Types</option>
                    <option value="user">Users</option>
                    <option value="visitor">Visitors</option>
                    <option value="bug">Bug Reports</option>
                    <option value="review">Reviews</option>
                    <option value="other">Other</option>
                  </select>
                  <button className="btn-sm" onClick={() => fetchRawData(1)}>Load</button>
                </div>
                {rawLoading && <div className="admin-loading">Loading data...</div>}
                {!rawLoading && rawData.length > 0 && (
                  <>
                    <div className="table-scroll-container">
                      <table className="admin-table compact-table">
                        <thead><tr>
                          <th>ID</th><th>Type</th><th>Text</th><th>Files</th><th>Created</th>
                        </tr></thead>
                        <tbody>
                          {rawData.map((item, i) => (
                            <tr key={item.id || i}>
                              <td className="mono">{(item.id || '').substring(0, 12)}...</td>
                              <td><span className={`type-badge type-${item.type}`}>{item.type}</span></td>
                              <td>{item.text ? (item.text.length > 150 ? item.text.substring(0, 150) + '...' : item.text) : ''}</td>
                              <td>{item.files || ''}</td>
                              <td>{ts(item.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="pagination">
                      <button disabled={rawPagination.page <= 1} onClick={() => fetchRawData(rawPagination.page - 1)}>← Prev</button>
                      <span>Page {rawPagination.page} of {rawPagination.totalPages} ({fmt(rawPagination.total)} records)</span>
                      <button disabled={rawPagination.page >= rawPagination.totalPages} onClick={() => fetchRawData(rawPagination.page + 1)}>Next →</button>
                    </div>
                  </>
                )}
                {!rawLoading && rawData.length === 0 && rawPagination.total === 0 && (
                  <p className="admin-no-data">Click "Load" to browse data</p>
                )}
              </CollapsibleSection>

              {/* ─── Sales Funnel Tester ─── */}
              <CollapsibleSection
                title="Sales Funnel Tester"
                defaultCollapsed={true}
                onToggle={(isOpen) => { if (isOpen) fetchFunnelStatus(); }}
              >
                <div className="funnel-test-panel">
                  {/* Toolbar */}
                  <div className="section-toolbar">
                    <button className="btn-sm" onClick={handleFunnelInit} disabled={funnelLoading}>
                      {funnelLoading ? '...' : funnel?.initialised ? '⟳ Re-Init' : '▶ Initialise Test User'}
                    </button>
                    {funnel?.initialised && (
                      <button className="btn-sm btn-reset" onClick={handleFunnelReset} disabled={funnelLoading}>
                        ↺ Reset &amp; Restore
                      </button>
                    )}
                    {funnel?.initialised && (
                      <button className="btn-sm btn-outline" onClick={fetchFunnelStatus} disabled={funnelLoading}>
                        ↻ Refresh Status
                      </button>
                    )}
                    {funnel?.run > 0 && <span className="muted">Run #{funnel.run}</span>}
                  </div>

                  {funnelError && <div className="admin-error">{funnelError}</div>}

                  {!funnel?.initialised && !funnelLoading && (
                    <p className="admin-no-data">
                      Click <strong>Initialise</strong> to create a disposable test user.
                      You can then log in as that user in another browser/incognito window
                      and walk through the entire purchase funnel. Emails are captured (not sent),
                      and every step is timed. Click <strong>Reset</strong> when done to restore
                      all state and run again.
                    </p>
                  )}

                  {funnel?.initialised && (
                    <>
                      {/* Credentials */}
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

                      {/* Stripe live state */}
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
                        <p className="admin-no-data">No funnel steps recorded yet. Log in as the test user in another window and start the purchase flow.</p>
                      )}
                    </>
                  )}
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

        {/* Resolution Modal */}
        {showResolutionModal && (
          <div className="admin-modal-overlay" onClick={() => { setShowResolutionModal(false); setResolutionText(''); setClosingBugId(null); }}>
            <div className="admin-modal" onClick={e => e.stopPropagation()}>
              <div className="admin-modal-header">
                <h3>Close Bug Report</h3>
                <button className="admin-modal-close" onClick={() => { setShowResolutionModal(false); setResolutionText(''); setClosingBugId(null); }}>✕</button>
              </div>
              <div className="admin-modal-content">
                <label htmlFor="resolutionText">Resolution Description:</label>
                <textarea
                  id="resolutionText"
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  placeholder="Describe how this bug was resolved..."
                  rows="4"
                  maxLength="500"
                />
                <small className="admin-char-count">{resolutionText.length}/500</small>
              </div>
              <div className="admin-modal-actions">
                <button className="admin-modal-cancel" onClick={() => { setShowResolutionModal(false); setResolutionText(''); setClosingBugId(null); }}>Cancel</button>
                <button className="admin-modal-confirm" onClick={() => handleCloseBugReport(closingBugId)} disabled={!resolutionText.trim()}>Close Report</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}

export default Admin;
