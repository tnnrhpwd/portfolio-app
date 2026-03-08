import React, { useState, useEffect, useCallback } from 'react';
import './UsageMeter.css';

const TIER_COLORS = {
  Free: '#6b7280',
  Pro: '#3b82f6',
  Simple: '#8b5cf6',
};

const TIER_LABELS = {
  Free: 'Free',
  Pro: 'Pro',
  Flex: 'Pro',
  Simple: 'Simple',
  Premium: 'Simple',
};

function UsageMeter({ user }) {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const fetchUsage = useCallback(async () => {
    if (!user?.token) return;
    setLoading(true);
    try {
      const devMode = process.env.NODE_ENV === 'development';
      let apiBase;
      if (devMode) {
        apiBase = '/api/data/';
      } else if (typeof window !== 'undefined') {
        const h = window.location.hostname;
        apiBase = (h === 'www.sthopwood.com' || h === 'sthopwood.com')
          ? 'https://mern-plan-web-service.onrender.com/api/data/'
          : '/api/data/';
      } else {
        apiBase = 'https://mern-plan-web-service.onrender.com/api/data/';
      }
      const res = await fetch(apiBase + 'usage', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (res.ok) {
        setUsage(await res.json());
      }
    } catch (err) {
      console.warn('[UsageMeter] Failed to fetch usage:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.token]);

  // Fetch on mount and every 60s
  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, 60000);
    return () => clearInterval(interval);
  }, [fetchUsage]);

  if (!user?.token || loading && !usage) return null;

  const isAdmin = usage?.isAdmin === true;
  const tier = isAdmin ? 'Admin' : (TIER_LABELS[usage?.membership] || 'Free');
  const tierColor = isAdmin ? '#f59e0b' : (TIER_COLORS[tier] || TIER_COLORS.Free);
  const limit = usage?.limit || 0;
  const credits = usage?.availableCredits || 0;
  const percentUsed = usage?.percentUsed || 0;
  const clampedPercent = Math.min(100, Math.max(0, percentUsed));

  const barColor = clampedPercent > 90 ? '#ef4444' : clampedPercent > 70 ? '#f59e0b' : '#10b981';

  // Admin gets a simplified unlimited view
  if (isAdmin) {
    return (
      <div className="usage-meter">
        <div className="usage-meter__toggle" title="Admin — unlimited access">
          <span className="usage-meter__tier-badge" style={{ background: tierColor }}>Admin</span>
          <span className="usage-meter__summary">Unlimited</span>
        </div>
      </div>
    );
  }

  return (
    <div className="usage-meter">
      <button
        className="usage-meter__toggle"
        onClick={() => setCollapsed(c => !c)}
        title="Cloud credits — only charged when using portfolio-hosted models"
      >
        <span className="usage-meter__tier-badge" style={{ background: tierColor }}>
          {tier}
        </span>
        <span className="usage-meter__summary">
          {limit > 0
            ? `$${credits.toFixed(2)} / $${limit.toFixed(2)}`
            : 'No credits'}
        </span>
        <span className={`usage-meter__chevron ${collapsed ? '' : 'usage-meter__chevron--open'}`}>›</span>
      </button>

      {!collapsed && (
        <div className="usage-meter__details">
          {limit > 0 && (
            <div className="usage-meter__bar-container">
              <div className="usage-meter__bar">
                <div
                  className="usage-meter__bar-fill"
                  style={{ width: `${clampedPercent}%`, background: barColor }}
                />
              </div>
              <span className="usage-meter__percent">{Math.round(clampedPercent)}% used</span>
            </div>
          )}
          <div className="usage-meter__stats">
            <div className="usage-meter__stat">
              <span className="usage-meter__stat-label">Total spent</span>
              <span className="usage-meter__stat-value">${(usage?.totalUsage || 0).toFixed(4)}</span>
            </div>
            {usage?.lastReset && (
              <div className="usage-meter__stat">
                <span className="usage-meter__stat-label">Last reset</span>
                <span className="usage-meter__stat-value">
                  {new Date(usage.lastReset).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            )}
          </div>
          <div className="usage-meter__hint">Only charges for portfolio-hosted models</div>
          {tier === 'Free' && (
            <a className="usage-meter__upgrade" href="/pay">
              Upgrade for more credits →
            </a>
          )}
          {clampedPercent > 80 && tier !== 'Simple' && tier !== 'Free' && (
            <a className="usage-meter__upgrade" href="/pay">
              Running low — upgrade →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default UsageMeter;
