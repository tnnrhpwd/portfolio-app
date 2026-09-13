import { createContext, useContext, useEffect } from 'react';

/**
 * Live readout for the admin toolbar.
 *
 * FRONTEND_UI_STANDARD.md §5.7: a service page's hero collapses into a sticky
 * toolbar that carries **name + live state + primary action** — the readout
 * *is* the page's headline, and it stays on screen while the user works.
 *
 * Each admin view publishes a couple of chips of its own headline numbers
 * through `useAdminReadout([...])`; `AdminLayout` renders whatever the mounted
 * view published. Passing `null` clears them, so a view that hasn't loaded yet
 * leaves the bar clean instead of showing stale numbers from the last page.
 *
 * The context value is `setReadout` itself (stable, so the effect never loops);
 * rendering it outside `AdminLayout` is a no-op rather than a crash.
 */
const AdminBarContext = createContext(null);

export const AdminBarProvider = AdminBarContext.Provider;

/**
 * Publish the toolbar readout for as long as this view is mounted.
 *
 * @param {Array<{label: string, value: string|number, tone?: 'ok'|'warn'|'bad'}>|null} items
 */
export function useAdminReadout(items) {
  const setReadout = useContext(AdminBarContext);
  // Serialize so a freshly-built array with the same contents doesn't re-render
  // the toolbar on every render of the view.
  const key = JSON.stringify(items || null);

  useEffect(() => {
    if (!setReadout) return undefined;
    setReadout(key === 'null' ? null : JSON.parse(key));
    return () => setReadout(null);
  }, [setReadout, key]);
}

export default AdminBarContext;
