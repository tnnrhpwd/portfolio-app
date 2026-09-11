import React, { useMemo, useState } from 'react';
import { MAX_RELATED_REPORTS } from '../../utils/supportUtils';

/**
 * Bug Report Tab Component
 *
 * The "Related improvement ideas" block is optional and does two related
 * things: attach a free-text improvement idea to this report, and/or link it to
 * reports you have already submitted so the two stay connected.
 */
const BugReportTab = ({
  formData,
  handleInputChange,
  handleBugReportSubmit,
  handleRelatedReportToggle,
  isSubmitting,
  userReports = [],
}) => {
  const [linkFilter, setLinkFilter] = useState('');

  const linkedIds = Array.isArray(formData.bugRelatedReports) ? formData.bugRelatedReports : [];
  const isLinked = (reportId) => linkedIds.includes(reportId);

  // Linked reports sort to the top so a selection is always visible (and can
  // always be undone), and stay visible even when they don't match the filter.
  const linkableReports = useMemo(() => {
    const needle = linkFilter.trim().toLowerCase();
    return userReports
      .filter((report) => !needle || (report.title || '').toLowerCase().includes(needle))
      .sort((a, b) => Number(isLinked(b.id)) - Number(isLinked(a.id)));
  }, [userReports, linkFilter, linkedIds]);

  const atLinkLimit = linkedIds.length >= MAX_RELATED_REPORTS;

  return (
    <div className="support-form-section">
      <h2>🐛 Report a Bug</h2>
      <p className="support-form-description">
        Help us improve by reporting bugs or technical issues. Only a title and description are required — everything else is optional, but more detail helps us fix it faster.
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
          <label htmlFor="bugSteps">Steps to Reproduce (optional)</label>
          <textarea
            id="bugSteps"
            name="bugSteps"
            value={formData.bugSteps}
            onChange={handleInputChange}
            placeholder="1. Go to...&#10;2. Click on...&#10;3. See error..."
            rows="4"
            maxLength={1000}
          />
        </div>

        <div className="support-form-row">
          <div className="support-form-group">
            <label htmlFor="bugExpected">Expected Result (optional)</label>
            <textarea
              id="bugExpected"
              name="bugExpected"
              value={formData.bugExpected}
              onChange={handleInputChange}
              placeholder="What should have happened..."
              rows="3"
              maxLength={500}
            />
          </div>
          <div className="support-form-group">
            <label htmlFor="bugActual">Actual Result (optional)</label>
            <textarea
              id="bugActual"
              name="bugActual"
              value={formData.bugActual}
              onChange={handleInputChange}
              placeholder="What actually happened..."
              rows="3"
              maxLength={500}
            />
          </div>
        </div>

        <fieldset className="support-related-fieldset">
          <legend>Related improvement ideas (optional)</legend>
          <p className="support-form-hint">
            Got an idea for how this should work instead? Attach it here, and link any
            reports you have already filed about the same area so they stay connected.
          </p>

          <div className="support-form-group">
            <label htmlFor="bugIdea">Improvement idea</label>
            <textarea
              id="bugIdea"
              name="bugIdea"
              value={formData.bugIdea}
              onChange={handleInputChange}
              placeholder="e.g. Show a progress bar while the export runs so it is clear something is happening."
              rows="3"
              maxLength={500}
            />
          </div>

          <div className="support-form-group">
            <label id="bugRelatedReportsLabel" htmlFor="bugRelatedReportsFilter">
              Link related reports {linkedIds.length > 0 && `(${linkedIds.length}/${MAX_RELATED_REPORTS})`}
            </label>

            {userReports.length === 0 ? (
              <p className="support-form-hint">
                You have no other reports to link to yet.
              </p>
            ) : (
              <>
                {userReports.length > 5 && (
                  <input
                    type="search"
                    id="bugRelatedReportsFilter"
                    className="support-related-filter"
                    placeholder="Filter your reports..."
                    value={linkFilter}
                    onChange={(event) => setLinkFilter(event.target.value)}
                  />
                )}
                <div
                  className="support-related-list"
                  role="group"
                  aria-labelledby="bugRelatedReportsLabel"
                >
                  {linkableReports.map((report) => (
                    <label key={report.id} className="support-related-item">
                      <input
                        type="checkbox"
                        checked={isLinked(report.id)}
                        onChange={() => handleRelatedReportToggle(report.id)}
                        disabled={!isLinked(report.id) && atLinkLimit}
                      />
                      <span className="support-related-item-text">
                        <span className="support-related-item-title">{report.title}</span>
                        <span className="support-related-item-meta">
                          {report.status === 'Open' ? '🔓 Open' : '🔒 Closed'}
                        </span>
                      </span>
                    </label>
                  ))}
                  {linkableReports.length === 0 && (
                    <p className="support-form-hint">No reports match that filter.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </fieldset>

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
          disabled={isSubmitting || !formData.bugTitle.trim() || !formData.bugDescription.trim()}
        >
          {isSubmitting ? '📤 Submitting...' : '🐛 Submit Bug Report'}
        </button>
      </form>
    </div>
  );
};

export default BugReportTab;
