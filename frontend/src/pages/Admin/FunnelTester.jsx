import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import dataService from "../../features/data/dataService.js";
import { formatTimestamp } from "./adminShared";
import { toast } from "react-toastify";

function FunnelTester() {
  const { user } = useSelector((state) => state.data);

  const [funnel, setFunnel] = useState(null);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [funnelError, setFunnelError] = useState(null);
  const [showTestCreds, setShowTestCreds] = useState(false);

  const fetchFunnelStatus = useCallback(async () => {
    if (!user?.token) return;
    setFunnelLoading(true);
    setFunnelError(null);
    try {
      const data = await dataService.getTestFunnelStatus(user.token);
      setFunnel(data);
    } catch (err) {
      setFunnelError(err?.response?.data?.message || err.message || 'Failed');
    } finally {
      setFunnelLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchFunnelStatus(); }, [fetchFunnelStatus]);

  const handleFunnelInit = useCallback(async () => {
    if (!user?.token) return;
    setFunnelLoading(true);
    setFunnelError(null);
    try {
      const data = await dataService.initTestFunnel(user.token);
      toast.success(data.message || 'Test funnel initialised');
      setShowTestCreds(true);
      await fetchFunnelStatus();
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Failed to init';
      setFunnelError(msg);
      toast.error(msg);
    } finally {
      setFunnelLoading(false);
    }
  }, [user, fetchFunnelStatus]);

  const handleFunnelReset = useCallback(async () => {
    if (!user?.token) return;
    setFunnelLoading(true);
    setFunnelError(null);
    try {
      const data = await dataService.resetTestFunnel(user.token);
      toast.success(data.message || 'Test funnel reset');
      await fetchFunnelStatus();
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Failed to reset';
      setFunnelError(msg);
      toast.error(msg);
    } finally {
      setFunnelLoading(false);
    }
  }, [user, fetchFunnelStatus]);

  const ts = formatTimestamp;

  return (
    <section className="admin-section-tile">
      <h2>Sales Funnel Tester</h2>

      <div className="funnel-test-panel">
        {/* Toolbar */}
        <div className="section-toolbar">
          <button className="btn-sm" onClick={handleFunnelInit} disabled={funnelLoading}>
            {funnelLoading ? '...' : funnel?.initialised ? '⟳ Re-Init' : '▶ Initialise Test User'}
          </button>
          {funnel?.initialised && (
            <button className="btn-sm btn-reset" onClick={handleFunnelReset} disabled={funnelLoading}>
              ↺ Reset &amp; Restore
            </button>
          )}
          {funnel?.initialised && (
            <button className="btn-sm btn-outline" onClick={fetchFunnelStatus} disabled={funnelLoading}>
              ↻ Refresh Status
            </button>
          )}
          {funnel?.run > 0 && <span className="muted">Run #{funnel.run}</span>}
        </div>

        {funnelError && (
          <div className="admin-error">
            <span>{funnelError}</span>
            <button className="btn-sm btn-retry" onClick={fetchFunnelStatus}>↻ Retry</button>
          </div>
        )}

        {!funnel?.initialised && !funnelLoading && (
          <p className="admin-no-data">
            Click <strong>Initialise</strong> to create a disposable test user.
            You can then log in as that user in another browser/incognito window
            and walk through the entire purchase funnel. Emails are captured (not sent),
            and every step is timed. Click <strong>Reset</strong> when done to restore
            all state and run again.
          </p>
        )}

        {funnel?.initialised && (
          <>
            {/* Credentials */}
            <div className="test-creds-box">
              <h4>
                Test Credentials
                <button className="btn-inline" onClick={() => setShowTestCreds(v => !v)}>
                  {showTestCreds ? 'Hide' : 'Show'}
                </button>
              </h4>
              {showTestCreds && (
                <div className="creds-grid">
                  <span className="creds-label">Email</span>
                  <code>{funnel.testUser?.email}</code>
                  <span className="creds-label">Password</span>
                  <code>{funnel.testUser?.email ? 'TestFunnel2024!' : '—'}</code>
                  <span className="creds-label">Stripe ID</span>
                  <code>{funnel.testUser?.stripeCustomerId || '—'}</code>
                  <span className="creds-label">Current Rank</span>
                  <span className={`plan-badge plan-${(funnel.testUser?.currentRank || 'free').toLowerCase()}`}>
                    {funnel.testUser?.currentRank || 'Free'}
                  </span>
                </div>
              )}
            </div>

            {/* Stripe live state */}
            {funnel.stripeState && (
              <div className="test-stripe-state">
                <h4>Stripe State</h4>
                <div className="stat-rows">
                  <div className="stat-row">
                    <span>Active Subscriptions</span>
                    <strong>{funnel.stripeState.subscriptions?.filter(s => s.status === 'active').length || 0}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Payment Methods</span>
                    <strong>{funnel.stripeState.paymentMethods?.length || 0}</strong>
                  </div>
                  {funnel.stripeState.subscriptions?.map(sub => (
                    <div key={sub.id} className="stat-row muted">
                      <span>{sub.id.slice(0, 20)}...</span>
                      <span className={`type-badge type-${sub.status === 'active' ? 'user' : 'other'}`}>
                        {sub.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Funnel steps timeline */}
            {funnel.funnel?.steps?.length > 0 && (
              <div className="funnel-timeline">
                <h4>Funnel Steps ({funnel.funnel.totalFormatted} total)</h4>
                <div className="timeline-list">
                  {funnel.funnel.steps.map((s, i) => (
                    <div key={i} className={`timeline-step ${s.step.endsWith('_response') ? 'response-step' : ''}`}>
                      <span className="timeline-dot" />
                      <span className="timeline-name">{s.step.replace(/_/g, ' ')}</span>
                      <span className="timeline-elapsed">{s.elapsedFormatted}</span>
                      {s.statusCode && <span className={`type-badge type-${s.statusCode < 400 ? 'user' : 'bug'}`}>{s.statusCode}</span>}
                      {s.durationMs != null && <span className="muted">({s.durationMs}ms server)</span>}
                      {s.plan && <span className={`plan-badge plan-${s.plan}`}>{s.plan}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Captured emails */}
            {funnel.emails?.length > 0 && (
              <div className="captured-emails">
                <h4>Captured Emails ({funnel.emails.length})</h4>
                {funnel.emails.map((em, i) => (
                  <div key={i} className="email-card">
                    <div className="email-card-header">
                      <span className="type-badge type-review">{em.template}</span>
                      <span className="muted">{ts(em.timestamp)}</span>
                    </div>
                    <div className="email-card-body">
                      <small>To: {em.to}</small>
                      {em.data?.plan && <span className={`plan-badge plan-${em.data.plan?.toLowerCase()}`}>{em.data.plan}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {funnel.funnel?.steps?.length === 0 && (
              <p className="admin-no-data">No funnel steps recorded yet. Log in as the test user in another window and start the purchase flow.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default FunnelTester;
