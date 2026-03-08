import { useState, useEffect, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import { detectAddon, getAddonStatus, onAddonStatusChange, startAddonPolling, checkRemoteAddon, onRemoteAddonStatusChange, getRemoteAddonStatus, registerCloudRelay } from '../../services/csimpleApi';

/** Hard-coded floor — only used when GitHub API is unreachable */
const FALLBACK_REQUIRED_VERSION = '1.0.6';

/** GitHub tags API — addon versions are tagged as "addon-v1.0.X" */
const GITHUB_TAGS_API = 'https://api.github.com/repos/tnnrhpwd/portfolio-app/tags';

/** Fetch the latest addon version from GitHub tags (cached in sessionStorage for 10 min). */
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
    const res = await fetch(GITHUB_TAGS_API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return FALLBACK_REQUIRED_VERSION;
    const tags = await res.json();
    // Tags are named "addon-v1.0.6" etc — find the first addon tag (already sorted newest-first)
    const addonTag = tags.find(t => /^addon-v/i.test(t.name));
    if (addonTag) {
      const version = addonTag.name.replace(/^addon-v/i, '');
      try {
        sessionStorage.setItem(CACHE_KEY, version);
        sessionStorage.setItem(CACHE_TS_KEY, String(Date.now()));
      } catch { /* ignore */ }
      return version;
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
  const [remoteAddonStatus, setRemoteAddonStatus] = useState(getRemoteAddonStatus);
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
  const relayRegistered = useRef(false);

  // Get user from Redux for token-based operations
  const user = useSelector((state) => state.data?.user);

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

    const unsubRemote = onRemoteAddonStatusChange((status) => {
      setRemoteAddonStatus(status);
    });

    // Start polling
    const stopPolling = startAddonPolling(pollInterval);

    return () => {
      unsub();
      unsubRemote();
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

  // When local addon is detected + user is logged in → register cloud relay JWT
  useEffect(() => {
    if (addonStatus.isConnected && user?.token && !relayRegistered.current) {
      relayRegistered.current = true;
      registerCloudRelay(user.token);
    }
    if (!addonStatus.isConnected) {
      relayRegistered.current = false;
    }
  }, [addonStatus.isConnected, user?.token]);

  // When local addon is NOT connected + user is logged in → check remote addon
  useEffect(() => {
    if (!addonStatus.isConnected && user?.token) {
      checkRemoteAddon(user.token);
      // Also poll remote status periodically
      const id = setInterval(() => checkRemoteAddon(user.token), pollInterval);
      return () => clearInterval(id);
    }
  }, [addonStatus.isConnected, user?.token, pollInterval]);

  const recheckAddon = useCallback(async () => {
    setIsChecking(true);
    const status = await detectAddon();
    setAddonStatus(status);
    // If local not found, also recheck remote
    if (!status.isConnected && user?.token) {
      await checkRemoteAddon(user.token);
    }
    setIsChecking(false);
    return status;
  }, [user?.token]);

  const dismissPrompt = useCallback(() => {
    setDismissed(true);
    try {
      sessionStorage.setItem('csimple_addon_dismissed', 'true');
    } catch {
      // sessionStorage not available
    }
  }, []);

  const isOutdated =
    addonStatus.isConnected &&
    !!addonStatus.version &&
    !isVersionAtLeast(addonStatus.version, latestVersion);

  return {
    addonStatus,
    remoteAddonStatus,
    isConnected: addonStatus.isConnected,
    isRemoteConnected: remoteAddonStatus.online,
    isChecking,
    recheckAddon,
    dismissed,
    dismissPrompt,
    isOutdated,
    requiredVersion: latestVersion,
    // Show install banner when addon is not found at all (local or remote)
    showInstallPrompt: !addonStatus.isConnected && !remoteAddonStatus.online && !isChecking && !dismissed,
    // Show update banner when addon is connected but running an older version
    showUpdatePrompt: isOutdated && !dismissed,
  };
}
