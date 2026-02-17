import { useState, useEffect, useCallback, useRef } from 'react';
import { detectAddon, getAddonStatus, onAddonStatusChange, startAddonPolling } from '../../services/csimpleApi';

/**
 * React hook for detecting and monitoring the CSimple local addon.
 * 
 * Returns:
 *   - addonStatus: { isConnected, baseUrl, version, lastCheck }
 *   - isChecking: boolean - whether an addon check is in progress
 *   - recheckAddon: function - manually trigger a recheck
 *   - dismissed: boolean - whether the user dismissed the install prompt
 *   - dismissPrompt: function - dismiss the install prompt for this session
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

  return {
    addonStatus,
    isConnected: addonStatus.isConnected,
    isChecking,
    recheckAddon,
    dismissed,
    dismissPrompt,
    // Convenience: should we show the install prompt?
    showInstallPrompt: !addonStatus.isConnected && !isChecking && !dismissed,
  };
}
