import React, { useId, useState } from "react";
import "./CollapsibleSection.css";

/**
 * CollapsibleSection — a folded-away group of panels.
 *
 * FRONTEND_UI_STANDARD.md §5.7: "fold the rest away — power-user plumbing goes in
 * a `<details>`, so the first screen is the job and not the config."
 *
 * Visually this is **a heading and a caret, nothing else**: no card, no fill, no
 * border. The panels it contains are already planes of color, and a plane wrapped
 * around planes reads as an accident (§5, "don't mix idioms"). The summary is a
 * real `<button>` with `aria-expanded` / `aria-controls`, so it is keyboard- and
 * screen-reader-operable rather than a div pretending to be a button.
 *
 * @param {string} title - Group label (rendered as a small uppercase eyebrow).
 * @param {boolean} [defaultCollapsed]
 * @param {(isOpen: boolean) => void} [onToggle]
 */
const CollapsibleSection = ({ title, children, defaultCollapsed = false, onToggle }) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const contentId = useId();

  const toggle = () => {
    const nextCollapsed = !isCollapsed;
    setIsCollapsed(nextCollapsed);
    if (onToggle) onToggle(!nextCollapsed); // true = section is now open
  };

  return (
    <section className="collapsible-section">
      <h2 className="collapsible-heading">
        <button
          type="button"
          className="collapsible-toggle"
          onClick={toggle}
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
        >
          <span className="collapsible-title">{title}</span>
          <span className={`collapsible-caret${isCollapsed ? " is-collapsed" : ""}`} aria-hidden="true">▾</span>
        </button>
      </h2>
      {!isCollapsed && (
        <div className="collapsible-content" id={contentId}>
          {children}
        </div>
      )}
    </section>
  );
};

export default CollapsibleSection;
