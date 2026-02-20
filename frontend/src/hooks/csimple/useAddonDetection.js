import { useState, useEffect, useCallback, useRef } from 'react';
import { detectAddon, getAddonStatus, onAddonStatusChange, startAddonPolling } from '../../services/csimpleApi';

/** Minimum addon version required for full ActionBridge support (added 2025-02-18) */
const REQUIRED_ADDON_VERSION = '1.0.1';

/**
 * Compare two semver strings. Returns true if `actual` is >= `required`.
 */
function isVersionAtLeast(actual, required) {
  if (!actual) return false;
  const parse = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(actual);
  const r = parse(required);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (r[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (r[i] ?? 0)) return false;
  }
  return true;
}

/**
 * React hook for detecting and monitoring the CSimple local addon.
 * 
 * Returns:
 *   - addonStatus: { isConnected, baseUrl, version, lastCheck }
 *   - isChecking: boolean - whether an addon check is in progress
 *   - recheckAddon: function - manually trigger a recheck
 *   - dismissed: boolean - whether the user dismissed the install prompt
 *   - dismissPrompt: function - dismiss the install prompt for this session
 *   - isOutdated: boolean - addon is connected but below REQUIRED_ADDON_VERSION
 *   - showInstallPrompt: boolean - addon not found; show install banner
 *   - showUpdatePrompt: boolean - addon found but outdated; show update banner
 */
export function useAddonDetection({ pollInterval = 30000 } = {}) {
  const [addonStatus, setAddonStatus] = useState(getAddonStatus);
  const [isChecking, setIsChecking] = useState(true);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('csimple_addon_dismissed') === 'true';
    } catch {
      return false;
    }
  });
  const initialCheckDone = useRef(false);

  // Subscribe to status changes from the polling service
  useEffect(() => {
    const unsub = onAddonStatusChange((status) => {
      setAddonStatus(status);
      setIsChecking(false);
    });

    // Start polling
    const stopPolling = startAddonPolling(pollInterval);

    return () => {
      unsub();
      stopPolling();
    };
  }, [pollInterval]);

  // Initial check
  useEffect(() => {
    if (!initialCheckDone.current) {
      initialCheckDone.current = true;
      setIsChecking(true);
      detectAddon().then((status) => {
        setAddonStatus(status);
        setIsChecking(false);
      });
    }
  }, []);

  const recheckAddon = useCallback(async () => {
    setIsChecking(true);
    const status = await detectAddon();
    setAddonStatus(status);
    setIsChecking(false);
    return status;
  }, []);

  const dismissPrompt = useCallback(() => {
    setDismissed(true);
    try {
      sessionStorage.setItem('csimple_addon_dismissed', 'true');
    } catch {
      // sessionStorage not available
    }
  }, []);

  const isOutdated =
    addonStatus.isConnected && !isVersionAtLeast(addonStatus.version, REQUIRED_ADDON_VERSION);

  return {
    addonStatus,
    isConnected: addonStatus.isConnected,
    isChecking,
    recheckAddon,
    dismissed,
    dismissPrompt,
    isOutdated,
    requiredVersion: REQUIRED_ADDON_VERSION,
    // Show install banner when addon is not found at all
    showInstallPrompt: !addonStatus.isConnected && !isChecking && !dismissed,
    // Show update banner when addon is connected but running an older version
    showUpdatePrompt: isOutdated && !dismissed,
  };
}
