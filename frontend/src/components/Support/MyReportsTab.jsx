import React from 'react';
import Spinner from '../Spinner/Spinner';

/**
 * My Reports Tab Component
 */
const MyReportsTab = ({ user, userBugReports, loadingReports, isSubmitting, closeBugReport, setActiveTab }) => {
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
        <div className="support-reports-list">
          {userBugReports.map((report) => (
            <div key={report.id} className="support-report-card">
              <div className="support-report-header">
                <h3 className="support-report-title">{report.title}</h3>
                <div className="support-report-meta">
                  <span className={`support-report-status ${report.status.toLowerCase()}`}>
                    {report.status === 'Open' ? '🔓 Open' : '🔒 Closed'}
                  </span>
                  <span className={`support-report-severity severity-${report.severity}`}>
                    {report.severity === 'low' && '🟢 Low'}
                    {report.severity === 'medium' && '🟡 Medium'}
                    {report.severity === 'high' && '🟠 High'}
                    {report.severity === 'critical' && '🔴 Critical'}
                  </span>
                </div>
              </div>
              
              <div className="support-report-details">
                <div className="support-report-field">
                  <strong>Description:</strong>
                  <p>{report.description}</p>
                </div>
                
                <div className="support-report-field">
                  <strong>Steps to Reproduce:</strong>
                  <p>{report.steps}</p>
                </div>
                
                <div className="support-report-row">
                  <div className="support-report-field">
                    <strong>Expected Result:</strong>
                    <p>{report.expected}</p>
                  </div>
                  <div className="support-report-field">
                    <strong>Actual Result:</strong>
                    <p>{report.actual}</p>
                  </div>
                </div>
                
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
                
                <div className="support-report-system-info">
                  <strong>System Information:</strong>
                  <p><strong>Browser:</strong> {report.browser}</p>
                  <p><strong>Device:</strong> {report.device}</p>
                </div>
                
                <div className="support-report-timestamps">
                  <p><strong>Submitted:</strong> {new Date(report.createdAt).toLocaleDateString()} at {new Date(report.createdAt).toLocaleTimeString()}</p>
                  {report.updatedAt !== report.createdAt && (
                    <p><strong>Last Updated:</strong> {new Date(report.updatedAt).toLocaleDateString()} at {new Date(report.updatedAt).toLocaleTimeString()}</p>
                  )}
                </div>
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
          ))}
        </div>
      )}
    </div>
  );
};

export default MyReportsTab;
