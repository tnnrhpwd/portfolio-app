import React from 'react';
import { ADDON_DOWNLOAD_URL } from '../../hooks/simpleAddon/useAddonDetection';
import './AddonInstallPrompt.css';

/**
 * Banner shown when the Simple local addon is not detected OR is outdated.
 *
 * Props:
 *   isChecking    – a recheck is in flight
 *   onDismiss     – hide this banner for the session
 *   onRecheck     – manually trigger a status recheck
 *   isOutdated    – addon IS running but below the required version
 *   currentVersion – version string reported by the running addon (may be null)
 *   requiredVersion – minimum version that supports all current features
 */
function AddonInstallPrompt({ isChecking, onDismiss, onRecheck, isOutdated, currentVersion, requiredVersion }) {
  if (isOutdated) {
    return (
      <div className="addon-prompt addon-prompt--update">
        <div className="addon-prompt__icon">⬆️</div>
        <div className="addon-prompt__body">
          <div className="addon-prompt__title">
            Addon Update Available — v{requiredVersion}
          </div>
          <div className="addon-prompt__text">
            Your installed addon{currentVersion ? ` (v${currentVersion})` : ''} is an older version and does not include the new{' '}
            <strong>ActionBridge</strong> feature added in v{requiredVersion}.
            This is not a bug — update the addon to unlock Windows automation, local AI models, and voice control.
          </div>
        </div>
        <div className="addon-prompt__actions">
          <a
            className="addon-prompt__install-btn"
            href={ADDON_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Update
          </a>
          <button
            className="addon-prompt__recheck-btn"
            onClick={onRecheck}
            disabled={isChecking}
          >
            {isChecking ? 'Checking…' : 'Recheck'}
          </button>
          <button className="addon-prompt__dismiss-btn" onClick={onDismiss}>
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="addon-prompt">
      <div className="addon-prompt__icon">🧩</div>
      <div className="addon-prompt__body">
        <div className="addon-prompt__title">Simple Addon (optional)</div>
        <div className="addon-prompt__text">
          This adds local AI models, voice control, and system automation, running
          on your PC. It's free and optional — the rest of the site works without it.
        </div>
      </div>
      <div className="addon-prompt__actions">
        <a
          className="addon-prompt__install-btn"
          href={ADDON_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Download
        </a>
        <button
          className="addon-prompt__recheck-btn"
          onClick={onRecheck}
          disabled={isChecking}
        >
          {isChecking ? 'Checking…' : 'Recheck'}
        </button>
        <button className="addon-prompt__dismiss-btn" onClick={onDismiss}>
          ✕
        </button>
      </div>
    </div>
  );
}

export default AddonInstallPrompt;
