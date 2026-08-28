import React, { useState, useEffect, useCallback } from 'react';
import usePurchaseGate from '../../hooks/usePurchaseGate.js';
import './StorageMeter.css';

/**
 * StorageMeter — a compact, always-visible line in the chat sidebar showing
 * the one real, cost-based limit: cloud storage ("82 MB / 100 MB used").
 *
 * This is informational, not persuasive: it surfaces storage usage *ahead* of
 * hitting the limit so a full mailbox isn't discovered as a surprise block.
 * When near/over the limit it adds a plain factual notice — no urgency, no
 * hard upsell (the "upgrade" mention only appears while purchasing is enabled).
 */
function StorageMeter({ user }) {
  const [storage, setStorage] = useState(null);
  const { purchasesEnabled } = usePurchaseGate();

  const fetchStorage = useCallback(async () => {
    if (!user?.token) return;
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
      const res = await fetch(apiBase + 'storage', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (res.ok) {
        setStorage(await res.json());
      }
    } catch (err) {
      console.warn('[StorageMeter] Failed to fetch storage:', err);
    }
  }, [user?.token]);

  // Fetch on mount and every 60s (storage changes rarely, so this is enough
  // to stay roughly current without hammering the storage scan endpoint).
  useEffect(() => {
    fetchStorage();
    const interval = setInterval(fetchStorage, 60000);
    return () => clearInterval(interval);
  }, [fetchStorage]);

  if (!user?.token || !storage || typeof storage !== 'object') return null;

  // No finite limit (e.g. unexpected membership rank) — nothing honest to show.
  if (!storage.storageLimit) return null;

  const percent = Math.min(100, Math.max(0, storage.storageUsagePercent || 0));
  const isOver = storage.isOverLimit === true || percent >= 100;
  const isNear = storage.isNearLimit === true || percent >= 80;
  const used = storage.totalStorageFormatted || '0 B';
  const limit = storage.storageLimitFormatted || 'N/A';
  const barColor = isOver ? '#ef4444' : isNear ? '#f59e0b' : '#10b981';

  return (
    <div className="storage-meter">
      <div className="storage-meter__summary" title="Cloud storage — your saved data and files">
        <span className="storage-meter__label">Storage</span>
        <span className="storage-meter__value">{used} / {limit}</span>
      </div>
      <div className="storage-meter__bar">
        <div
          className="storage-meter__bar-fill"
          style={{ width: `${percent}%`, background: barColor }}
        />
      </div>
      {isOver && (
        <p className="storage-meter__notice">
          You&apos;ve used all of your storage — you can free up space
          {purchasesEnabled ? ' or upgrade for more' : ''}.
        </p>
      )}
      {!isOver && isNear && (
        <p className="storage-meter__notice storage-meter__notice--warn">
          You&apos;re using {Math.round(percent)}% of your storage.
        </p>
      )}
    </div>
  );
}

export default StorageMeter;
