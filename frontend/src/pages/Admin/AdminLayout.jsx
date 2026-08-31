import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { toast } from "react-toastify";
import { ADMIN_USER_ID } from "./adminShared";
import "./Admin.css";

// ── Navigation items for the admin sub-pages ──────────────────────────
const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/bugs", label: "Bugs" },
  { to: "/admin/map", label: "Visitor Map" },
  { to: "/admin/reviews", label: "Reviews" },
  { to: "/admin/data", label: "Data Explorer" },
  { to: "/admin/home-title", label: "Home Title" },
  { to: "/admin/funnel-tester", label: "Funnel Tester" },
];

/**
 * Shared admin layout. Every /admin/* route renders inside this component,
 * so the admin check here protects every sub-page at once.
 */
function AdminLayout() {
  const { user } = useSelector((state) => state.data);
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState(false);

  // ═══════════════ Auth gate ═══════════════
  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (String(user._id) !== ADMIN_USER_ID) {
      toast.error("Only admin are allowed to use that URL.");
      navigate("/");
      return;
    }
    setAuthorized(true);
  }, [user, navigate]);

  if (!authorized) return null;

  return (
    <>
      <Header />
      <div className="admin-container">
        <div className="admin-page">
          <nav className="admin-nav" aria-label="Admin navigation">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `admin-nav-link${isActive ? " admin-nav-link--active" : ""}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="admin-content">
            <Outlet />
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default AdminLayout;
