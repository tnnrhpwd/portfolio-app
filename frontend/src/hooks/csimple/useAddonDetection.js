import { useState, useEffect, useCallback, useRef } from 'react';
import { detectAddon, getAddonStatus, onAddonStatusChange, startAddonPolling } from '../../services/csimpleApi';

/** Hard-coded floor — only used when GitHub API is unreachable */
const FALLBACK_REQUIRED_VERSION = '1.0.100';

/** GitHub repo to check for latest release */
const GITHUB_RELEASES_API = 'https://api.github.com/repos/tnnrhpwd/portfolio-app/releases/latest';

/** Fetch the latest release tag from GitHub (cached in sessionStorage for 10 min). */
async function fetchLatestRelease() {
  const CACHE_KEY = 'csimple_latest_version';
  const CACHE_TS_KEY = 'csimple_latest_version_ts';
  const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    const cachedTs = Number(sessionStorage.getItem(CACHE_TS_KEY) || 0);
    if (cached && Date.now() - cachedTs < CACHE_TTL) return cached;
  } catch { /* ignore */ }

  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return FALLBACK_REQUIRED_VERSION;
    const data = await res.json();
    // tag_name is typically "v1.0.100" or "1.0.100"
    const tag = (data.tag_name || '').replace(/^v/i, '');
    if (tag) {
      try {
        sessionStorage.setItem(CACHE_KEY, tag);
        sessionStorage.setItem(CACHE_TS_KEY, String(Date.now()));
      } catch { /* ignore */ }
      return tag;
    }
  } catch { /* network error */ }

  return FALLBACK_REQUIRED_VERSION;
}

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
  const [latestVersion, setLatestVersion] = useState(FALLBACK_REQUIRED_VERSION);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('csimple_addon_dismissed') === 'true';
    } catch {
      return false;
    }
  });
  const initialCheckDone = useRef(false);

  // Fetch latest release version from GitHub on mount
  useEffect(() => {
    fetchLatestRelease().then(setLatestVersion);
  }, []);

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
    addonStatus.isConnected && !isVersionAtLeast(addonStatus.version, latestVersion);

  return {
    addonStatus,
    isConnected: addonStatus.isConnected,
    isChecking,
    recheckAddon,
    dismissed,
    dismissPrompt,
    isOutdated,
    requiredVersion: latestVersion,
    // Show install banner when addon is not found at all
    showInstallPrompt: !addonStatus.isConnected && !isChecking && !dismissed,
    // Show update banner when addon is connected but running an older version
    showUpdatePrompt: isOutdated && !dismissed,
  };
}
