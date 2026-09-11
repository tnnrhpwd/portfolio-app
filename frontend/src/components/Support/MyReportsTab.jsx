import React, { useEffect, useMemo, useState } from 'react';
import Spinner from '../Spinner/Spinner';
import {
  REPORTS_PAGE_SIZE,
  REPORT_SORT_OPTIONS,
  describeRelatedReports,
  filterReports,
  formatReportTimestamp,
  getReportStatusCounts,
  truncateText,
} from '../../utils/supportUtils';

/**
 * My Reports Tab Component
 *
 * Layout note: rendering every report fully expanded made this tab painfully
 * long once a user had dozens of reports. Reports now render as compact rows
 * (title + status + severity + date) that expand on demand, with a search box,
 * status chips, sorting and a "Show more" pager to bound the page height.
 */
/** True when a report field has something worth rendering. */
const hasText = (value) => String(value ?? '').trim().length > 0;

const MyReportsTab = ({ userBugReports, loadingReports, isSubmitting, closeBugReport, setActiveTab }) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [visibleCount, setVisibleCount] = useState(REPORTS_PAGE_SIZE);
  const [pendingFocusId, setPendingFocusId] = useState(null);

  const reports = useMemo(
    () => (Array.isArray(userBugReports) ? userBugReports : []),
    [userBugReports]
  );

  const counts = useMemo(() => getReportStatusCounts(reports), [reports]);

  const filteredReports = useMemo(
    () => filterReports(reports, { query, status: statusFilter, sort: sortBy }),
    [reports, query, statusFilter, sortBy]
  );

  // Resolve each report's linked ids into { id, title, inList } once per list so
  // the detail view can label the links and know which ones are reachable.
  const relatedByReport = useMemo(() => {
    const map = {};
    for (const report of reports) {
      if (Array.isArray(report?.relatedReports) && report.relatedReports.length > 0) {
        map[report.id] = describeRelatedReports(report.relatedReports, reports);
      }
    }
    return map;
  }, [reports]);

  // Reset paging whenever the result set changes so the user is never stranded
  // past the end of a shorter list.
  useEffect(() => {
    setVisibleCount(REPORTS_PAGE_SIZE);
  }, [query, statusFilter, sortBy, reports.length]);

  const visibleReports = filteredReports.slice(0, visibleCount);
  const remaining = filteredReports.length - visibleReports.length;
  const filtersActive = query.trim() !== '' || statusFilter !== 'all';
  const allVisibleExpanded =
    visibleReports.length > 0 && visibleReports.every((report) => expandedIds.has(report.id));

  const toggleReport = (reportId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
  };

  const setAllExpanded = (expand) => {
    setExpandedIds(expand ? new Set(visibleReports.map((report) => report.id)) : new Set());
  };

  /**
   * Reveal a report that another report links to: expand it, make sure it is
   * actually rendered (it may be paged out or hidden by the active filter) and
   * scroll it into view. This is what keeps linked reports connected in the UI.
   */
  const focusReport = (reportId) => {
    if (!reports.some((report) => report.id === reportId)) return;

    const index = filteredReports.findIndex((report) => report.id === reportId);
    if (index === -1) {
      // Hidden by the current search/status filter — clear them so it is visible.
      setQuery('');
      setStatusFilter('all');
      setVisibleCount(Math.max(REPORTS_PAGE_SIZE, reports.length));
    } else if (index >= visibleCount) {
      setVisibleCount(index + 1);
    }

    setExpandedIds((prev) => new Set(prev).add(reportId));
    setPendingFocusId(reportId);
  };

  // Scroll once the target is in the DOM (after the state updates above render).
  useEffect(() => {
    if (!pendingFocusId) return;
    const element = document.getElementById(`support-report-${pendingFocusId}`);
    if (!element) return;
    element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    setPendingFocusId(null);
  }, [pendingFocusId, visibleCount, filteredReports, expandedIds]);

  const renderReportBody = (report) => (
    <div className="support-report-details" id={`support-report-body-${report.id}`}>
      <div className="support-report-field">
        <strong>Description:</strong>
        <p>{report.description}</p>
      </div>

      {hasText(report.steps) && (
        <div className="support-report-field">
          <strong>Steps to Reproduce:</strong>
          <p>{report.steps}</p>
        </div>
      )}

      {(hasText(report.expected) || hasText(report.actual)) && (
        <div className="support-report-row">
          {hasText(report.expected) && (
            <div className="support-report-field">
              <strong>Expected Result:</strong>
              <p>{report.expected}</p>
            </div>
          )}
          {hasText(report.actual) && (
            <div className="support-report-field">
              <strong>Actual Result:</strong>
              <p>{report.actual}</p>
            </div>
          )}
        </div>
      )}

      {report.status === 'Closed' && report.resolution && (
        <div className="support-resolution-section">
          <strong>🔒 Resolution:</strong>
          <div className="support-resolution-content">
            <p>{report.resolution}</p>
            {report.resolvedBy && (
              <small className="support-resolution-info">
                Resolved by {report.resolvedBy}
                {report.resolvedAt && ` on ${new Date(report.resolvedAt).toLocaleDateString()}`}
              </small>
            )}
          </div>
        </div>
      )}

      {report.idea && (
        <div className="support-report-idea">
          <strong>💡 Improvement idea:</strong>
          <p>{report.idea}</p>
        </div>
      )}

      {relatedByReport[report.id]?.length > 0 && (
        <div className="support-report-related">
          <strong>🔗 Related reports:</strong>
          <ul className="support-report-related-list">
            {relatedByReport[report.id].map((link) => (
              <li key={link.id}>
                {link.inList ? (
                  <button
                    type="button"
                    className="support-report-related-link"
                    aria-label={`Go to related report: ${link.title}`}
                    onClick={() => focusReport(link.id)}
                  >
                    {link.title}
                  </button>
                ) : (
                  <span className="support-report-related-missing">{link.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(hasText(report.browser) || hasText(report.device)) && (
        <div className="support-report-system-info">
          <strong>System Information:</strong>
          {hasText(report.browser) && (
            <p><strong>Browser:</strong> {report.browser}</p>
          )}
          {hasText(report.device) && (
            <p><strong>Device:</strong> {report.device}</p>
          )}
        </div>
      )}

      <div className="support-report-timestamps">
        <p><strong>Submitted:</strong> {formatReportTimestamp(report.createdAt)}</p>
        {report.updatedAt !== report.createdAt && (
          <p><strong>Last Updated:</strong> {formatReportTimestamp(report.updatedAt)}</p>
        )}
      </div>

      {report.status === 'Open' && (
        <div className="support-report-actions">
          <button
            className="support-close-report-btn"
            onClick={() => closeBugReport(report.id)}
            disabled={isSubmitting}
          >
            {isSubmitting ? '🔄 Closing...' : '✅ Mark as Resolved'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="support-form-section">
      <h2>📋 My Bug Reports</h2>
      
      <p className="support-form-description">
        View and manage your submitted bug reports. You can close reports that have been resolved.
      </p>

      {loadingReports ? (
        <div className="support-loading">
          <Spinner />
          <p>Loading your bug reports...</p>
        </div>
      ) : userBugReports.length === 0 ? (
        <div className="support-no-reports">
          <div className="support-no-reports-icon">🐛</div>
          <p>You haven't submitted any bug reports yet.</p>
          <button
            className="support-action-btn"
            onClick={() => setActiveTab('bug')}
          >
            Report Your First Bug
          </button>
        </div>
      ) : (
        <>
          {/* Toolbar: search, status chips, sort */}
          <div className="support-reports-toolbar">
            <div className="support-reports-toolbar-row">
              <input
                type="search"
                className="support-reports-search"
                placeholder="Search your reports..."
                aria-label="Search your bug reports"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <label className="support-reports-sort">
                <span className="sr-only">Sort reports</span>
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                >
                  {REPORT_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="support-reports-filters" role="group" aria-label="Filter reports by status">
              {[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'Open', label: 'Open', count: counts.open },
                { value: 'Closed', label: 'Closed', count: counts.closed },
              ].map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  className={`support-filter-chip ${statusFilter === filter.value ? 'active' : ''}`}
                  aria-pressed={statusFilter === filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                >
                  {filter.label}
                  <span className="support-filter-count">{filter.count}</span>
                </button>
              ))}
            </div>
          </div>

          {filteredReports.length === 0 ? (
            <div className="support-no-reports">
              <div className="support-no-reports-icon">🔍</div>
              <p>No reports match your search.</p>
              <button
                type="button"
                className="support-action-btn"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="support-reports-summary">
                <span>
                  Showing {visibleReports.length} of {filteredReports.length}
                  {filtersActive ? ` (${reports.length} total)` : ''}
                </span>
                <button
                  type="button"
                  className="support-reports-expand-all"
                  onClick={() => setAllExpanded(!allVisibleExpanded)}
                >
                  {allVisibleExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </div>

              <div className="support-reports-list">
                {visibleReports.map((report) => {
                  const isExpanded = expandedIds.has(report.id);
                  return (
                    <div
                      key={report.id}
                      id={`support-report-${report.id}`}
                      className={`support-report-card ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
                    >
                      <button
                        type="button"
                        className="support-report-toggle"
                        aria-expanded={isExpanded}
                        aria-controls={`support-report-body-${report.id}`}
                        onClick={() => toggleReport(report.id)}
                      >
                        <span className="support-report-toggle-text">
                          <span className="support-report-title">{report.title}</span>
                          <span className="support-report-subline">
                            {formatReportTimestamp(report.createdAt)}
                            {report.idea && ' · 💡 idea'}
                            {relatedByReport[report.id]?.length > 0 &&
                              ` · 🔗 ${relatedByReport[report.id].length} related`}
                          </span>
                          {!isExpanded && report.description && (
                            <span className="support-report-preview">
                              {truncateText(report.description, 120)}
                            </span>
                          )}
                        </span>

                        <span className="support-report-meta">
                          <span className={`support-report-status ${report.status.toLowerCase()}`}>
                            {report.status === 'Open' ? '🔓 Open' : '🔒 Closed'}
                          </span>
                          <span className={`support-report-severity severity-${report.severity}`}>
                            {report.severity === 'low' && '🟢 Low'}
                            {report.severity === 'medium' && '🟡 Medium'}
                            {report.severity === 'high' && '🟠 High'}
                            {report.severity === 'critical' && '🔴 Critical'}
                          </span>
                          <span className="support-report-chevron" aria-hidden="true">
                            {isExpanded ? '▴' : '▾'}
                          </span>
                        </span>
                      </button>

                      {isExpanded && renderReportBody(report)}
                    </div>
                  );
                })}
              </div>

              {remaining > 0 && (
                <div className="support-reports-more">
                  <button
                    type="button"
                    className="support-action-btn"
                    onClick={() =>
                      setVisibleCount((count) =>
                        count >= filteredReports.length ? count : count + REPORTS_PAGE_SIZE
                      )
                    }
                  >
                    Show {Math.min(remaining, REPORTS_PAGE_SIZE)} more reports
                  </button>
                  <button
                    type="button"
                    className="support-reports-show-all"
                    onClick={() => setVisibleCount(filteredReports.length)}
                  >
                    Show all {filteredReports.length}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default MyReportsTab;
