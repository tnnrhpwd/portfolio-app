import React from 'react';
import './AddonInstallPrompt.css';

/**
 * Banner shown when the CSimple local addon is not detected.
 * Prompts user to install the Electron addon for local AI features.
 */
function AddonInstallPrompt({ isChecking, onDismiss, onRecheck }) {
  return (
    <div className="addon-prompt">
      <div className="addon-prompt__icon">🧩</div>
      <div className="addon-prompt__body">
        <div className="addon-prompt__title">Enhance with C-Simple Addon</div>
        <div className="addon-prompt__text">
          Install the free desktop addon to unlock local AI models, voice control, 
          and system automation — all running privately on your PC.
        </div>
      </div>
      <div className="addon-prompt__actions">
        <a
          className="addon-prompt__install-btn"
          href="https://github.com/tnnrhpwd/C-Simple/releases"
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
