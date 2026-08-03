import { useEffect, useState } from 'react';
import dataService from '../features/data/dataService.js';

// Module-level cache so every component using this hook doesn't each fire
// their own request — the gate rarely changes and a stale value for the
// length of a page visit is fine.
let cachedStatus = null;
let inFlightRequest = null;

async function fetchStatus() {
  if (cachedStatus) return cachedStatus;
  if (!inFlightRequest) {
    inFlightRequest = dataService.getPurchaseGateStatus().then((data) => {
      cachedStatus = data;
      inFlightRequest = null;
      return data;
    });
  }
  return inFlightRequest;
}

/**
 * Reads the admin-controlled purchase gate (docs/guides/ACTION_PLAN.md —
 * "Gate: hide and disable purchasing until a real readiness bar is met").
 *
 * Returns `{ purchasesEnabled, message, loading }`. Use `purchasesEnabled`
 * to hide/disable upgrade CTAs, and `message` for the caveat to show instead.
 * Defaults to `purchasesEnabled: true` while loading so nothing flashes
 * hidden-then-shown for the common case.
 */
function usePurchaseGate() {
  const [state, setState] = useState(() => (
    cachedStatus
      ? { purchasesEnabled: cachedStatus.purchasesEnabled, message: cachedStatus.message, loading: false }
      : { purchasesEnabled: true, message: null, loading: true }
  ));

  useEffect(() => {
    let cancelled = false;
    fetchStatus().then((data) => {
      if (cancelled) return;
      setState({ purchasesEnabled: data.purchasesEnabled !== false, message: data.message || null, loading: false });
    });
    return () => { cancelled = true; };
  }, []);

  return state;
}

export default usePurchaseGate;
