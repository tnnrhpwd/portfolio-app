import React from 'react';

/**
 * Bug Report Tab Component
 */
const BugReportTab = ({ formData, handleInputChange, handleBugReportSubmit, isSubmitting }) => {
  return (
    <div className="support-form-section">
      <h2>🐛 Report a Bug</h2>
      <p className="support-form-description">
        Help us improve by reporting bugs or technical issues. The more details you provide, the faster we can fix it!
      </p>

      <form onSubmit={handleBugReportSubmit} className="support-form">
        <div className="support-form-row">
          <div className="support-form-group">
            <label htmlFor="bugTitle">Bug Title *</label>
            <input
              type="text"
              id="bugTitle"
              name="bugTitle"
              value={formData.bugTitle}
              onChange={handleInputChange}
              placeholder="Brief description of the bug"
              required
              maxLength={100}
            />
          </div>
          <div className="support-form-group">
            <label htmlFor="bugSeverity">Severity</label>
            <select
              id="bugSeverity"
              name="bugSeverity"
              value={formData.bugSeverity}
              onChange={handleInputChange}
            >
              <option value="low">Low - Minor issue</option>
              <option value="medium">Medium - Affects functionality</option>
              <option value="high">High - Blocks important features</option>
              <option value="critical">Critical - App unusable</option>
            </select>
          </div>
        </div>

        <div className="support-form-group">
          <label htmlFor="bugDescription">Bug Description *</label>
          <textarea
            id="bugDescription"
            name="bugDescription"
            value={formData.bugDescription}
            onChange={handleInputChange}
            placeholder="Detailed description of what went wrong..."
            required
            rows="4"
            maxLength={1000}
          />
        </div>

        <div className="support-form-group">
          <label htmlFor="bugSteps">Steps to Reproduce *</label>
          <textarea
            id="bugSteps"
            name="bugSteps"
            value={formData.bugSteps}
            onChange={handleInputChange}
            placeholder="1. Go to...&#10;2. Click on...&#10;3. See error..."
            required
            rows="4"
            maxLength={1000}
          />
        </div>

        <div className="support-form-row">
          <div className="support-form-group">
            <label htmlFor="bugExpected">Expected Result *</label>
            <textarea
              id="bugExpected"
              name="bugExpected"
              value={formData.bugExpected}
              onChange={handleInputChange}
              placeholder="What should have happened..."
              required
              rows="3"
              maxLength={500}
            />
          </div>
          <div className="support-form-group">
            <label htmlFor="bugActual">Actual Result *</label>
            <textarea
              id="bugActual"
              name="bugActual"
              value={formData.bugActual}
              onChange={handleInputChange}
              placeholder="What actually happened..."
              required
              rows="3"
              maxLength={500}
            />
          </div>
        </div>

        <div className="support-system-info">
          <h4>System Information (Auto-detected):</h4>
          <div className="support-system-details">
            <p><strong>Browser:</strong> {formData.bugBrowser}</p>
            <p><strong>Device:</strong> {formData.bugDevice}</p>
          </div>
        </div>

        <button
          type="submit"
          className="support-submit-btn"
          disabled={isSubmitting || !formData.bugTitle.trim() || !formData.bugDescription.trim() || !formData.bugSteps.trim() || !formData.bugExpected.trim() || !formData.bugActual.trim()}
        >
          {isSubmitting ? '📤 Submitting...' : '🐛 Submit Bug Report'}
        </button>
      </form>
    </div>
  );
};

export default BugReportTab;
