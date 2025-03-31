import React, { useState } from "react";
import "./CollapsibleSection.css"; // Add styles if needed

const CollapsibleSection = ({ title, children, defaultCollapsed = false }) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className="collapsible-section">
      <div
        className="collapsible-header"
        onClick={() => setIsCollapsed((prev) => !prev)}
        aria-expanded={!isCollapsed}
        role="button"
        tabIndex={0}
        onKeyPress={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            setIsCollapsed((prev) => !prev);
          }
        }}
      >
        <h3>{title}</h3>
        <span
          className={`collapse-icon ${isCollapsed ? "collapsed" : ""}`}
          aria-hidden="true"
        >
          {isCollapsed ? "▼" : "▲"}
        </span>
      </div>
      {!isCollapsed && <div className="collapsible-content">{children}</div>}
    </div>
  );
};

export default CollapsibleSection;
