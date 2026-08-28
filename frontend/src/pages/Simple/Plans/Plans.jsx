import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import { toast } from 'react-toastify';
import { logout } from '../../../features/data/dataSlice.js';
import {
  fetchMemoryItems,
  createMemoryItem,
  updateMemoryItem,
  deleteMemoryItem,
} from '../../../services/memoryApi.js';
import './Plans.css';

// -- Configuration ------------------------------------------------------------

const TABS = [
  { key: 'goal',   label: 'Goals',   icon: '🎯', empty: 'No goals yet — what are you working toward?' },
  { key: 'plan',   label: 'Plans',   icon: '📋', empty: 'No plans yet — break a goal into steps!' },
  { key: 'action', label: 'Actions', icon: '⚡', empty: 'No actions logged yet — start chatting on /net!' },
];

const PRIORITY_OPTIONS = ['low', 'medium', 'high'];
const STATUS_OPTIONS = ['active', 'completed', 'paused'];
const STATUS_FILTERS = ['all', 'active', 'completed', 'paused'];

const STATUS_LABELS = {
  active: 'Active',
  completed: 'Done',
  paused: 'Paused',
};

const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

// -- Helpers ------------------------------------------------------------------

function timeSince(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isOverdue(deadline, status) {
  if (!deadline || status === 'completed') return false;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  // Treat a bare date as end-of-day
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(deadline))) d.setHours(23, 59, 59, 999);
  return d.getTime() < Date.now();
}

// -- Main component -----------------------------------------------------------

function Plans() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.data);

  const [activeTab, setActiveTab] = useState('goal');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newDeadline, setNewDeadline] = useState('');
  const [newStatus, setNewStatus] = useState('active');
  const [saving, setSaving] = useState(false);

  // -- Data fetching ----------------------------------------------------------

  const load = useCallback(async () => {
    if (!user?.token) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await fetchMemoryItems(user.token, activeTab);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err.message?.includes('token') || err.message?.includes('authorized')) {
        dispatch(logout());
        navigate('/login');
        return;
      }
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, activeTab, dispatch, navigate]);

  useEffect(() => { load(); }, [load]);

  // Reset transient UI when switching tabs
  useEffect(() => {
    setShowForm(false);
    setEditingId(null);
    setSearch('');
    setStatusFilter('all');
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  function resetForm() {
    setNewTitle('');
    setNewDescription('');
    setNewPriority('medium');
    setNewDeadline('');
    setNewStatus('active');
  }

  // -- Derived data -----------------------------------------------------------

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const d = item.data || {};
      if (statusFilter !== 'all' && (d.status || 'active') !== statusFilter) return false;
      if (!q) return true;
      return (
        (d.title || '').toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q)
      );
    });
  }, [items, search, statusFilter]);

  const activeItems = filtered.filter((i) => (i.data?.status || 'active') !== 'completed');
  const doneItems = filtered.filter((i) => i.data?.status === 'completed');

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((i) => (i.data?.status || 'active') !== 'completed').length;
    const done = total - active;
    return { total, active, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [items]);

  const currentTab = TABS.find((t) => t.key === activeTab);

  // -- CRUD handlers ----------------------------------------------------------

  const openCreate = () => {
    resetForm();
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (item) => {
    const d = item.data || {};
    setNewTitle(d.title || '');
    setNewDescription(d.description || '');
    setNewPriority(d.priority || 'medium');
    setNewDeadline(d.deadline || '');
    setNewStatus(d.status || 'active');
    setEditingId(item._id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const payload = { title: newTitle.trim() };
      if (newDescription.trim()) payload.description = newDescription.trim();
      if (activeTab !== 'action') {
        payload.priority = newPriority;
        if (newDeadline) payload.deadline = newDeadline;
        payload.status = editingId ? newStatus : 'active';
      }

      if (editingId) {
        await updateMemoryItem(user.token, editingId, payload);
        toast.success(`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} updated!`);
      } else {
        await createMemoryItem(user.token, activeTab, payload);
        toast.success(`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} created!`);
      }
      resetForm();
      setShowForm(false);
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (item, newStatus) => {
    try {
      await updateMemoryItem(user.token, item._id, { status: newStatus });
      setItems((prev) => prev.map((i) =>
        i._id === item._id ? { ...i, data: { ...i.data, status: newStatus } } : i
      ));
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete this ${item.type}?`)) return;
    try {
      await deleteMemoryItem(user.token, item._id);
      setItems((prev) => prev.filter((i) => i._id !== item._id));
      toast.success('Deleted');
    } catch (err) { toast.error(err.message); }
  };

  // -- Render -----------------------------------------------------------------

  return (
    <>
      <Header />
      <div className="plans-page">
        <div className="floating-shapes" aria-hidden="true">
          <div className="floating-circle floating-circle-1"></div>
          <div className="floating-circle floating-circle-2"></div>
          <div className="floating-circle floating-circle-3"></div>
        </div>

        <div className="plans-shell">
          {/* Hero */}
          <section className="plans-hero">
            <div className="plans-hero-copy">
              <h1 className="plans-page-title">Your Plans</h1>
              <p className="plans-page-subtitle">
                Goals, plans, and actions — shared as context with your AI on <strong>/net</strong>.
              </p>
            </div>
            {!loading && user && (
              <div className="plans-stats" aria-label="Summary">
                <div className="plans-stat">
                  <span className="plans-stat-value">{stats.total}</span>
                  <span className="plans-stat-label">Total</span>
                </div>
                <div className="plans-stat">
                  <span className="plans-stat-value">{stats.active}</span>
                  <span className="plans-stat-label">Active</span>
                </div>
                <div className="plans-stat">
                  <span className="plans-stat-value">{stats.done}</span>
                  <span className="plans-stat-label">Done</span>
                </div>
              </div>
            )}
          </section>

          {!user ? (
            <div
              className="plans-login-prompt"
              onClick={() => { dispatch(logout()); navigate('/login'); }}
            >
              Log in to manage your memory
            </div>
          ) : (
            <>
              {/* Controls */}
              <section className="plans-controls">
                <div className="plans-tabs" role="tablist" aria-label="Memory types">
                  {TABS.map((tab) => (
                    <button
                      key={tab.key}
                      role="tab"
                      aria-selected={activeTab === tab.key}
                      className={`plans-tab ${activeTab === tab.key ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      <span className="plans-tab-icon">{tab.icon}</span>
                      <span>{tab.label}</span>
                      {!loading && activeTab === tab.key && (
                        <span className="plans-tab-count">{items.length}</span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="plans-controls-row">
                  <div className="plans-search">
                    <span className="plans-search-icon" aria-hidden="true">🔍</span>
                    <input
                      className="plans-search-input"
                      type="text"
                      placeholder={`Search ${activeTab}s…`}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button className="plans-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                        ✕
                      </button>
                    )}
                  </div>

                  {activeTab !== 'action' && (
                    <select
                      className="plans-filter-select"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      aria-label="Filter by status"
                    >
                      {STATUS_FILTERS.map((s) => (
                        <option key={s} value={s}>
                          {s === 'all' ? 'All statuses' : STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  )}

                  <button className="plans-create-btn" onClick={openCreate}>
                    + New {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                  </button>
                </div>
              </section>

              {/* Create / Edit form */}
              {showForm && (
                <form className="plans-create-form" onSubmit={handleSubmit}>
                  <div className="plans-form-head">
                    <h2 className="plans-form-title">
                      {editingId ? `Edit ${activeTab}` : `New ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
                    </h2>
                    <button
                      type="button"
                      className="plans-form-close"
                      onClick={() => { setShowForm(false); setEditingId(null); resetForm(); }}
                      aria-label="Close form"
                    >
                      ✕
                    </button>
                  </div>

                  <input
                    className="plans-input"
                    type="text"
                    placeholder={activeTab === 'goal' ? 'What do you want to achieve?' : activeTab === 'plan' ? 'What is your plan?' : 'Describe the action…'}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    autoFocus
                    maxLength={200}
                  />
                  <textarea
                    className="plans-textarea"
                    placeholder="Description (optional)"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    rows={2}
                    maxLength={1000}
                  />
                  {activeTab !== 'action' && (
                    <div className="plans-form-row">
                      <select
                        className="plans-select"
                        value={newPriority}
                        onChange={(e) => setNewPriority(e.target.value)}
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>{PRIORITY_LABELS[p]} priority</option>
                        ))}
                      </select>
                      <input
                        className="plans-input plans-date-input"
                        type="date"
                        value={newDeadline}
                        onChange={(e) => setNewDeadline(e.target.value)}
                        aria-label="Deadline"
                      />
                      {editingId && (
                        <select
                          className="plans-select"
                          value={newStatus}
                          onChange={(e) => setNewStatus(e.target.value)}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  <div className="plans-form-actions">
                    <button
                      type="button"
                      className="plans-btn plans-btn--ghost"
                      onClick={() => { setShowForm(false); setEditingId(null); resetForm(); }}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="plans-btn plans-btn--primary" disabled={saving || !newTitle.trim()}>
                      {saving ? 'Saving…' : editingId ? 'Save changes' : `Create ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
                    </button>
                  </div>
                </form>
              )}

              {/* Loading skeleton */}
              {loading && (
                <div className="plans-skeleton-list" aria-label="Loading">
                  {[0, 1, 2].map((i) => (
                    <div className="plans-skeleton-card" key={i}>
                      <div className="plans-skeleton plans-skeleton--title" />
                      <div className="plans-skeleton plans-skeleton--line" />
                      <div className="plans-skeleton plans-skeleton--line plans-skeleton--short" />
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {!loading && filtered.length === 0 && (
                <div className="plans-empty">
                  <div className="plans-empty-icon" aria-hidden="true">{currentTab?.icon}</div>
                  <p className="plans-empty-title">
                    {search || statusFilter !== 'all'
                      ? 'No matches found'
                      : currentTab?.empty}
                  </p>
                  {search || statusFilter !== 'all' ? (
                    <button
                      className="plans-btn plans-btn--ghost"
                      onClick={() => { setSearch(''); setStatusFilter('all'); }}
                    >
                      Clear filters
                    </button>
                  ) : (
                    <button className="plans-btn plans-btn--primary" onClick={openCreate}>
                      + Create your first {activeTab}
                    </button>
                  )}
                </div>
              )}

              {/* Active section */}
              {!loading && activeItems.length > 0 && (
                <section className="plans-section">
                  {activeTab !== 'action' && doneItems.length > 0 && (
                    <h3 className="plans-section-title">Active</h3>
                  )}
                  <div className="plans-items">
                    {activeItems.map((item) => (
                      <MemoryCard
                        key={item._id}
                        item={item}
                        onStatusChange={handleStatusChange}
                        onDelete={handleDelete}
                        onEdit={openEdit}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Completed section */}
              {!loading && doneItems.length > 0 && (
                <section className="plans-section plans-section-done">
                  <h3 className="plans-section-title">Completed</h3>
                  <div className="plans-items">
                    {doneItems.map((item) => (
                      <MemoryCard
                        key={item._id}
                        item={item}
                        onStatusChange={handleStatusChange}
                        onDelete={handleDelete}
                        onEdit={openEdit}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Info note */}
              <div className="plans-info-note">
                💡 Your active goals are automatically shared as context with your AI on <strong>/net</strong>.
                Actions are logged automatically from conversations.
              </div>
            </>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}

// -- Memory Card --------------------------------------------------------------

function MemoryCard({ item, onStatusChange, onDelete, onEdit }) {
  const { data, type, createdAt } = item;
  const isCompleted = data?.status === 'completed';
  const overdue = isOverdue(data?.deadline, data?.status);

  return (
    <div className={`memory-card ${type} ${isCompleted ? 'completed' : ''}`}>
      <div className="memory-card-header">
        <div className="memory-card-title-row">
          {type !== 'action' && (
            <button
              className={`memory-card-check ${isCompleted ? 'checked' : ''}`}
              onClick={() => onStatusChange(item, isCompleted ? 'active' : 'completed')}
              title={isCompleted ? 'Mark active' : 'Mark completed'}
              aria-label={isCompleted ? 'Mark active' : 'Mark completed'}
            >
              {isCompleted ? '✓' : ''}
            </button>
          )}
          <span className={`memory-card-title ${isCompleted ? 'strike' : ''}`}>
            {data?.title || 'Untitled'}
          </span>
        </div>
        <div className="memory-card-actions">
          <button className="memory-card-icon-btn" onClick={() => onEdit(item)} title="Edit" aria-label="Edit">
            ✎
          </button>
          <button className="memory-card-icon-btn memory-card-delete" onClick={() => onDelete(item)} title="Delete" aria-label="Delete">
            ×
          </button>
        </div>
      </div>

      {data?.description && (
        <p className="memory-card-desc">{data.description}</p>
      )}

      <div className="memory-card-meta">
        {type !== 'action' && data?.status && (
          <span className={`memory-card-status status-${data.status}`}>
            <span className="memory-card-status-dot" aria-hidden="true" />
            {STATUS_LABELS[data.status] || data.status}
          </span>
        )}
        {data?.priority && type !== 'action' && (
          <span className={`memory-card-badge priority-${data.priority}`}>
            {PRIORITY_LABELS[data.priority] || data.priority}
          </span>
        )}
        {data?.deadline && (
          <span className={`memory-card-badge deadline ${overdue ? 'overdue' : ''}`}>
            📅 {data.deadline}{overdue ? ' · Overdue' : ''}
          </span>
        )}
        {data?.source && (
          <span className="memory-card-badge source">from /{data.source}</span>
        )}
        <span className="memory-card-time">{timeSince(createdAt)}</span>
      </div>
    </div>
  );
}

export default Plans;
