import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import SEO from "../../components/SEO/SEO.jsx";
import { getUserUsage } from "../../features/data/dataSlice.js";
import { isAdminUser, isSpecialUser, canOpenAdminPath, SPECIAL_ADMIN_PATHS } from "../../constants/admin";
import { AdminBarProvider } from "./adminBarContext";
import "./Admin.css";

/**
 * Admin console shell.
 *
 * Every `/admin/*` route renders inside this component, so the access gate here
 * covers every view at once.
 *
 * Two access levels:
 *
 * - **Admin** (`ADMIN_USER_ID`) gets every view.
 * - **Special** — the credits flag an admin can toggle — gets four read-only
 *   views (Dashboard, Visitor map, Reviews, Page rankings) and nothing else. The
 *   tabs, the toolbar `<h1>` and a guard that bounces it off any other view all
 *   come from `SPECIAL_ADMIN_PATHS`, and `backend/middleware/adminAccess.js`
 *   enforces the same split server-side.
 *
 * **This is a service page, not a landing page** — FRONTEND_UI_STANDARD.md §5.7.
 * Service pages are workspaces, not stories: one flat surface (no bands, no
 * animated gradient behind the data, no floating circles, no scroll reveals), a
 * sticky head carrying the room's name + live state + actions, then a dense panel
 * grid for the work itself. The tab row is the view switcher, and each view
 * publishes its own live readout into the bar (`useAdminReadout`), so the
 * numbers stay on screen while the admin scrolls.
 */
const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", short: "Dashboard", icon: "📊", end: true },
  { to: "/admin/users", label: "Users", short: "Users", icon: "👥" },
  { to: "/admin/bugs", label: "Bugs", short: "Bugs", icon: "🐞" },
  { to: "/admin/map", label: "Visitor Map", short: "Visitors", icon: "🗺️" },
  { to: "/admin/reviews", label: "Reviews", short: "Reviews", icon: "⭐" },
  { to: "/admin/data", label: "Data Explorer", short: "Data", icon: "🗄️" },
  { to: "/admin/home-title", label: "Home Title", short: "Home title", icon: "🏷️" },
  { to: "/admin/funnel-tester", label: "Funnel Tester", short: "Funnel", icon: "🧪" },
  { to: "/admin/rankings", label: "Page Rankings", short: "Rankings", icon: "📈" },
];

function AdminLayout() {
  const { user, userUsage, userUsageIsLoading, userUsageIsError } = useSelector((state) => state.data);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [authorized, setAuthorized] = useState(false);
  const [readout, setReadout] = useState(null);

  const admin = isAdminUser(user);
  const special = !admin && isSpecialUser(user);

  // A tag an admin applied *after* this account signed in is not in the stored
  // user object — the flag normally rides on the login response, and this session
  // predates it. `/usage` reports the live flag, so a signed-in non-admin gets one
  // cheap question before the gate answers "not Special" and bounces them home,
  // and nothing renders until that answer lands (so the bounce can't fire early).
  //
  // `userUsageIsError` is part of the condition: a failed call must settle the
  // wait too, or a network error would leave the console blank instead of
  // redirecting.
  const usageSettled = userUsage !== null || userUsageIsError;

  // Still waiting on the server's answer for an account whose stored flag says
  // "no". The gate below must wait this out.
  const awaitingSpecialCheck = !!user && !admin && !special && !usageSettled;

  // …and the question itself is asked once, not on every render while it is in
  // flight. Keeping the two apart matters: folding the loading flag into the wait
  // let the gate decide during the request, which bounced the account home before
  // the answer that would have let it in had even arrived.
  const shouldAskForSpecial = awaitingSpecialCheck && !userUsageIsLoading;

  useEffect(() => {
    if (shouldAskForSpecial) dispatch(getUserUsage());
  }, [shouldAskForSpecial, dispatch]);

  // ═══════════════ Access gate ═══════════════
  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (awaitingSpecialCheck) return;   // still finding out — decide below, once
    if (!admin && !special) {
      toast.error("Only admin are allowed to use that URL.");
      navigate("/");
      return;
    }
    setAuthorized(true);
  }, [user, admin, special, awaitingSpecialCheck, navigate]);

  // The views this account may actually open — the toolbar's <h1>, the tab row
  // and the guard below all read from it, so they can't disagree.
  const allowedViews = useMemo(
    () => (admin ? NAV_ITEMS : NAV_ITEMS.filter((item) => SPECIAL_ADMIN_PATHS.includes(item.to))),
    [admin]
  );

  // The toolbar's <h1> is the room's name, derived from the route.
  const view = useMemo(() => {
    const path = location.pathname.replace(/\/+$/, "");
    return (
      allowedViews.find((item) => (item.end ? path === item.to : path.startsWith(item.to))) ||
      allowedViews[0]
    );
  }, [location.pathname, allowedViews]);

  // A Special account that lands on a view it doesn't have is sent to the
  // dashboard rather than shown panels that would only 403. An unknown
  // `/admin/...` path is left to the router, so a real 404 still reads as one.
  useEffect(() => {
    if (!authorized || admin) return;
    const path = location.pathname.replace(/\/+$/, "");
    const isKnownView = NAV_ITEMS.some((item) => (item.end ? path === item.to : path.startsWith(item.to)));
    if (isKnownView && !canOpenAdminPath(user, path)) {
      toast.error("Your account can only open the Dashboard, Visitor map, Reviews and Page rankings.");
      navigate("/admin", { replace: true });
    }
  }, [authorized, admin, user, location.pathname, navigate]);

  // Stable identity: a view publishing its readout must not hand the bar a new
  // function and re-subscribe on every render.
  const adminBarValue = useMemo(() => setReadout, []);

  if (!authorized) return null;

  const nickname = user?.nickname || user?.email || "admin";

  return (
    <>
      <SEO
        title={view.label}
        description="Admin console for ST Hopwood — users, bugs, visitors, reviews and site settings."
        path={location.pathname}
        noindex
      />
      <Header />

      <div className="admin-surface">
        <div className="admin-shell">
          {/* Sticky head: name + live state + actions, then the view switcher.
              One sticky block, so it never has to measure the other. */}
          <div className="admin-head">
            <header className="admin-bar">
              <h1 className="admin-bar-title">{view.label}</h1>
              <span className="admin-bar-status">
                <span className="admin-bar-status__dot" aria-hidden="true" />
                Signed in as {nickname}
                {special && <> &middot; Special access</>}
              </span>
              {readout && readout.length > 0 && (
                <ul className="admin-bar-readout">
                  {readout.map((chip, i) => (
                    <li
                      key={`${chip.label}-${i}`}
                      className={`admin-chip${chip.tone ? ` admin-chip--${chip.tone}` : ""}`}
                    >
                      {chip.label} <strong>{chip.value}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <div className="admin-bar-actions">
                <Link className="admin-btn" to="/">↗ View site</Link>
              </div>
            </header>

            <nav className="admin-tabs" aria-label="Admin views">
              {allowedViews.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `admin-tab${isActive ? " is-active" : ""}`}
                  aria-current={view.to === item.to ? "page" : undefined}
                  title={item.label}
                >
                  <span className="admin-tab__icon" aria-hidden="true">{item.icon}</span>
                  <span className="admin-tab__label">{item.short}</span>
                </NavLink>
              ))}
            </nav>
          </div>

          <main className="admin-main">
            <AdminBarProvider value={adminBarValue}>
              <Outlet />
            </AdminBarProvider>
          </main>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default AdminLayout;
