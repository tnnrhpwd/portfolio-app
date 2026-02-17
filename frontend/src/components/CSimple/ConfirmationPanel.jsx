import React, { useEffect, useRef } from 'react';
import './ConfirmationPanel.css';

/**
 * ConfirmationPanel — slides up above the text input when the AI needs
 * user confirmation before executing an action.
 *
 * Props:
 *   confirmation   - { id, question, options, originalAction } or null
 *   onSelectOption  - (confirmationId, optionText) => void
 *   onDismiss       - () => void
 *   isLoading       - boolean (while sending the confirmation)
 */
function ConfirmationPanel({ confirmation, onSelectOption, onDismiss, isLoading }) {
  const panelRef = useRef(null);

  // Auto-focus the panel for accessibility
  useEffect(() => {
    if (confirmation && panelRef.current) {
      panelRef.current.focus();
    }
  }, [confirmation]);

  // Allow Escape key to dismiss
  useEffect(() => {
    if (!confirmation) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onDismiss?.();
      }
      // Allow number keys to select options (1-9)
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= (confirmation.options?.length || 0)) {
        onSelectOption?.(confirmation.id, confirmation.options[num - 1]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [confirmation, onSelectOption, onDismiss]);

  if (!confirmation) return null;

  const { id, question, options, originalAction } = confirmation;

  return (
    <div
      className={`confirmation-panel ${isLoading ? 'confirmation-panel--loading' : ''}`}
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Action confirmation"
    >
      <div className="confirmation-panel__header">
        <div className="confirmation-panel__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="confirmation-panel__question">{question}</p>
        <button
          className="confirmation-panel__close"
          onClick={onDismiss}
          title="Dismiss (Esc)"
          disabled={isLoading}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {originalAction && (
        <div className="confirmation-panel__context">
          <span className="confirmation-panel__context-icon">⚡</span>
          <span className="confirmation-panel__context-text">{originalAction}</span>
        </div>
      )}

      <div className="confirmation-panel__options">
        {options.map((option, index) => (
          <button
            key={index}
            className="confirmation-panel__option"
            onClick={() => onSelectOption?.(id, option)}
            disabled={isLoading}
            title={`Press ${index + 1} or click`}
          >
            <span className="confirmation-panel__option-key">{index + 1}</span>
            <span className="confirmation-panel__option-text">{option}</span>
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="confirmation-panel__loading">
          <div className="confirmation-panel__spinner" />
          <span>Processing...</span>
        </div>
      )}

      <div className="confirmation-panel__hint">
        Press a number key, click an option, or say your choice
      </div>
    </div>
  );
}

export default ConfirmationPanel;
