import React, { Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import { loadFontSizeScale } from './utils/theme';
import { trackPageView } from './utils/pageViews';
// The page manifest is the routing table (constants/pages.js). Every <Route>
// below is built from it, and `/all` renders the same list as its index — so a
// page that is reachable is a page that is listed, and the two cannot drift.
import { PAGES, NOT_FOUND } from './constants/pages';

// Every page — and its chunk — is declared in the manifest, so there is no
// second list here to keep in step when a route is added or renamed.

import 'react-toastify/dist/ReactToastify.css';
import './App.css';

// Apply saved font size scale on app load
loadFontSizeScale();

// ── Route loading spinner ──────────────────────────────────────────
function RouteSpinner() {
  return (
    <div className="route-spinner" role="status" aria-label="Loading page">
      <div className="route-spinner__dot" />
    </div>
  );
}

// Keys the error boundary by the current location so navigating to a new
// route clears a transient error instead of leaving the app bricked.
function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname + location.search}>
      {children}
    </ErrorBoundary>
  );
}

// Fires a page-view beacon on initial load and every subsequent route change
// so the backend can rank pages by visit count.
function PageViewTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);
  return null;
}

// ── Routes, built from the manifest ────────────────────────────────
//
// One entry in `constants/pages.js` produces every route it needs here: the
// route itself, one per alias, a nested block when the page has children (the
// admin console), or a `<Navigate>` when it is a redirect.
//
// Building them rather than listing them is what keeps the router and the `/all`
// index honest — there is no second list to forget, and no way for the index to
// advertise a page the router does not serve.
function routesForPage(page) {
  const Element = page.element;

  if (page.redirect) {
    return [
      <Route key={page.path} path={page.path} element={<Navigate to={page.redirect} replace />} />,
    ];
  }

  const routes = page.children?.length
    ? [
      <Route key={page.path} path={page.path} element={<Element />}>
        {page.children.map((child) => {
          const Child = child.element;
          // `''` is the parent's own index (`/admin` → the dashboard).
          return child.segment
            ? <Route key={child.segment} path={child.segment} element={<Child />} />
            : <Route key="index" index element={<Child />} />;
        })}
      </Route>,
    ]
    : [<Route key={page.path} path={page.path} element={<Element />} />];

  // An alias renders the same page at its own URL (`/home`, `/Coliseum`) rather
  // than redirecting, so the address a visitor typed is the one they keep.
  for (const alias of page.aliases || []) {
    routes.push(<Route key={alias} path={alias} element={<Element />} />);
  }

  return routes;
}

const NotFound = NOT_FOUND.element;

function App() {
  return (
    <Router>
      <PageViewTracker />
      <RouteErrorBoundary>
        <div className="App">
          <Suspense fallback={<RouteSpinner />}>
            <Routes>
              {/* Every route, its aliases and the admin console's nesting come
                  from the manifest. Arrays are fine as children here — Routes
                  flattens them when it builds the tree. */}
              {PAGES.flatMap(routesForPage)}
              {/* The catch-all is deliberately NOT in the manifest: nobody has a
                  link to it, so it has no place in the index on `/all`. */}
              <Route path={NOT_FOUND.path} element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </RouteErrorBoundary>
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </Router>
  );
}

export default App;