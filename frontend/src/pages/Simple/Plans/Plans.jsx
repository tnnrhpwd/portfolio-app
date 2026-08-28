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
import { startGoalAgent } from '../../../services/goalAgentApi.js';
import './Plans.css';

// -- Configuration ------------------------------------------------------------

const TABS = [
  { key: 'goal',   label: 'Goals',   icon: '🎯', empty: 'No goals yet — what are you working toward?', quick: 'Add a goal…',       titlePlaceholder: 'What do you want to achieve?' },
  { key: 'plan',   label: 'Plans',   icon: '📋', empty: 'No plans yet — break a goal into steps!',   quick: 'Add a plan…',       titlePlaceholder: 'What is your plan?' },
  { key: 'action', label: 'Actions', icon: '⚡', empty: 'No actions logged yet — start chatting on /net!', quick: 'Log an action…', titlePlaceholder: 'Describe the action…' },
  { key: 'note',   label: 'Notes',   icon: '📝', empty: 'No notes yet — ask your AI to save one on /net!', quick: 'Add a note…',  titlePlaceholder: 'Note title…' },
];

// Types that carry a completion status, priority, and optional deadline.
const TASK_TYPES = ['goal', 'plan'];

const PRIORITY_OPTIONS = ['low', 'medium', 'high'];
const STATUS_OPTIONS = ['active', 'completed', 'paused'];
const STATUS_FILTERS = ['all', 'active', 'completed', 'paused'];
const PRIORITY_FILTERS = ['all', 'low', 'medium', 'high'];

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

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

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

/** Human-friendly deadline copy for the card badge. */
function deadlineLabel(deadline) {
  if (!deadline) return '';
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return String(deadline);
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 30) return `${days} days left`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  // Quick-add bar state
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState('medium');

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newDeadline, setNewDeadline] = useState('');
  const [newStatus, setNewStatus] = useState('active');
  const [saving, setSaving] = useState(false);

  // Goal-agent enlistment state (which goal is currently being enlisted)
  const [enlisting, setEnlisting] = useState(null);

  // -- Data fetching ----------------------------------------------------------

  const load = useCallback(async () => {
    if (!user?.token) { setLoading(false); return; }
    setLoading(true);
    try {
      // Fetch all memory types once and filter client-side so tab switches
      // are instant and every tab can show its own live count badge.
      const data = await fetchMemoryItems(user.token);
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
  }, [user, dispatch, navigate]);

  useEffect(() => { load(); }, [load]);

  // Reset transient UI when switching tabs
  useEffect(() => {
    setShowForm(false);
    setEditingId(null);
    setSearch('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setQuickTitle('');
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

  const tabItems = useMemo(
    () => items.filter((i) => i.type === activeTab),
    [items, activeTab]
  );

  const tabCount = useCallback(
    (key) => items.filter((i) => i.type === key).length,
    [items]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tabItems.filter((item) => {
      const d = item.data || {};
      if (statusFilter !== 'all' && (d.status || 'active') !== statusFilter) return false;
      if (priorityFilter !== 'all' && (d.priority || 'medium') !== priorityFilter) return false;
      if (!q) return true;
      return (
        (d.title || '').toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q)
      );
    });

    const sorted = [...list];
    if (sortBy === 'priority') {
      sorted.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.data?.priority] ?? 3;
        const pb = PRIORITY_ORDER[b.data?.priority] ?? 3;
        return pa - pb;
      });
    } else if (sortBy === 'deadline') {
      sorted.sort((a, b) => {
        const ad = a.data?.deadline ? new Date(a.data.deadline).getTime() : NaN;
        const bd = b.data?.deadline ? new Date(b.data.deadline).getTime() : NaN;
        if (Number.isNaN(ad) && Number.isNaN(bd)) return 0;
        if (Number.isNaN(ad)) return 1;
        if (Number.isNaN(bd)) return -1;
        return ad - bd;
      });
    }
    return sorted;
  }, [tabItems, search, statusFilter, priorityFilter, sortBy]);

  const activeItems = filtered.filter((i) => (i.data?.status || 'active') !== 'completed');
  const doneItems = filtered.filter((i) => i.data?.status === 'completed');

  const stats = useMemo(() => {
    const total = tabItems.length;
    const active = tabItems.filter((i) => (i.data?.status || 'active') !== 'completed').length;
    const done = total - active;
    return { total, active, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [tabItems]);

  const currentTab = TABS.find((t) => t.key === activeTab) || TABS[0];
  const isTaskTab = TASK_TYPES.includes(activeTab);

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
      if (isTaskTab) {
        payload.priority = newPriority;
        if (newDeadline) payload.deadline = newDeadline;
        payload.status = editingId ? newStatus : 'active';
      }

      const noun = currentTab.label.slice(0, -1);
      if (editingId) {
        await updateMemoryItem(user.token, editingId, payload);
        toast.success(`${noun} updated!`);
      } else {
        await createMemoryItem(user.token, activeTab, payload);
        toast.success(`${noun} created!`);
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

  const handleQuickAdd = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    const title = quickTitle.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      const payload = { title };
      if (isTaskTab) {
        payload.priority = quickPriority;
        payload.status = 'active';
      }
      await createMemoryItem(user.token, activeTab, payload);
      setQuickTitle('');
      toast.success(`${currentTab.label.slice(0, -1)} added!`);
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

  // -- Goal agent -------------------------------------------------------------

  const openGoal = (item) => {
    if (item.type === 'goal') navigate(`/plans/goal/${item._id}`);
  };

  const handleEnlistAgent = async (item) => {
    if (enlisting === item._id) return;
    setEnlisting(item._id);
    try {
      await startGoalAgent(user.token, item._id);
      toast.success('Agent enlisted — working on it now!');
      navigate(`/plans/goal/${item._id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setEnlisting(null);
    }
  };

  // -- Render -----------------------------------------------------------------

  return (
    <>
      <Header />
      <div className="plans-page">
        <div className="plans-shell">
          {/* Hero */}
          <section className="plans-hero">
            <div className="plans-hero-copy">
              <p className="plans-eyebrow">Simple · Workspace</p>
              <h1 className="plans-page-title">Your Plans</h1>
              <p className="plans-page-subtitle">
                Goals, plans, notes, and actions — kept in sync with your account and shared as context with your AI on <strong>/net</strong>.
              </p>
              {!loading && user && (
                <div className="plans-hero-stats" aria-label="Summary">
                  <span><strong>{stats.total}</strong> total</span>
                  {isTaskTab && (
                    <>
                      <span className="plans-hero-stat-dot" aria-hidden="true">·</span>
                      <span><strong>{stats.active}</strong> active</span>
                      <span className="plans-hero-stat-dot" aria-hidden="true">·</span>
                      <span><strong>{stats.done}</strong> done</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {user && (
              <button className="plans-hero-cta" onClick={openCreate}>
                + New {currentTab.label.slice(0, -1)}
              </button>
            )}
          </section>

          {!user ? (
            <div
              className="plans-login-prompt"
              onClick={() => { dispatch(logout()); navigate('/login'); }}
            >
              Log in to manage your plans
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
                      <span className="plans-tab-icon" aria-hidden="true">{tab.icon}</span>
                      <span className="plans-tab-label">{tab.label}</span>
                      {!loading && (
                        <span className="plans-tab-count">{tabCount(tab.key)}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Quick add */}
                <form className="plans-quickadd" onSubmit={handleQuickAdd}>
                  <span className="plans-quickadd-icon" aria-hidden="true">{currentTab.icon}</span>
                  <input
                    className="plans-quickadd-input"
                    type="text"
                    placeholder={currentTab.quick}
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                    maxLength={200}
                  />
                  {isTaskTab && (
                    <select
                      className="plans-quickadd-select"
                      value={quickPriority}
                      onChange={(e) => setQuickPriority(e.target.value)}
                      aria-label="Priority"
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    className="plans-quickadd-btn"
                    disabled={saving || !quickTitle.trim()}
                  >
                    {saving ? '…' : 'Add'}
                  </button>
                </form>

                <div className="plans-controls-row">
                  <div className="plans-search">
                    <span className="plans-search-icon" aria-hidden="true">🔍</span>
                    <input
                      className="plans-search-input"
                      type="text"
                      placeholder={`Search ${currentTab.label.toLowerCase()}…`}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button className="plans-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                        ✕
                      </button>
                    )}
                  </div>

                  <select
                    className="plans-filter-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    aria-label="Sort by"
                  >
                    <option value="newest">Newest first</option>
                    <option value="priority">Priority</option>
                    <option value="deadline">Deadline</option>
                  </select>
                </div>

                {/* Status + priority filter chips */}
                {(isTaskTab || search) && (
                  <div className="plans-chips">
                    {isTaskTab && STATUS_FILTERS.map((s) => (
                      <button
                        key={s}
                        className={`plans-chip ${statusFilter === s ? 'active' : ''}`}
                        onClick={() => setStatusFilter(s)}
                        aria-pressed={statusFilter === s}
                      >
                        {s === 'all' ? 'All' : STATUS_LABELS[s]}
                      </button>
                    ))}
                    {isTaskTab && PRIORITY_FILTERS.map((p) => (
                      <button
                        key={p}
                        className={`plans-chip plans-chip--priority ${priorityFilter === p ? 'active' : ''}`}
                        onClick={() => setPriorityFilter(p)}
                        aria-pressed={priorityFilter === p}
                      >
                        {p === 'all' ? 'All priorities' : PRIORITY_LABELS[p]}
                      </button>
                    ))}
                    {(search || statusFilter !== 'all' || priorityFilter !== 'all') && (
                      <button
                        className="plans-chip plans-chip--clear"
                        onClick={() => { setSearch(''); setStatusFilter('all'); setPriorityFilter('all'); }}
                      >
                        ✕ Clear filters
                      </button>
                    )}
                  </div>
                )}
              </section>

              {/* Create / Edit form */}
              {showForm && (
                <form className="plans-create-form" onSubmit={handleSubmit}>
                  <div className="plans-form-head">
                    <h2 className="plans-form-title">
                      {editingId ? `Edit ${currentTab.label.slice(0, -1)}` : `New ${currentTab.label.slice(0, -1)}`}
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
                    placeholder={currentTab.titlePlaceholder}
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
                  {isTaskTab && (
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
                      {saving ? 'Saving…' : editingId ? 'Save changes' : `Create ${currentTab.label.slice(0, -1)}`}
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
                  <div className="plans-empty-icon" aria-hidden="true">{currentTab.icon}</div>
                  <p className="plans-empty-title">
                    {search || statusFilter !== 'all' || priorityFilter !== 'all'
                      ? 'No matches found'
                      : currentTab.empty}
                  </p>
                  {search || statusFilter !== 'all' || priorityFilter !== 'all' ? (
                    <button
                      className="plans-btn plans-btn--ghost"
                      onClick={() => { setSearch(''); setStatusFilter('all'); setPriorityFilter('all'); }}
                    >
                      Clear filters
                    </button>
                  ) : (
                    <button className="plans-btn plans-btn--primary" onClick={openCreate}>
                      + Create your first {currentTab.label.slice(0, -1).toLowerCase()}
                    </button>
                  )}
                </div>
              )}

              {/* Active section */}
              {!loading && activeItems.length > 0 && (
                <section className="plans-section">
                  {isTaskTab && doneItems.length > 0 && (
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
                        onOpen={openGoal}
                        onEnlist={handleEnlistAgent}
                        enlisting={enlisting}
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
                        onOpen={openGoal}
                        onEnlist={handleEnlistAgent}
                        enlisting={enlisting}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Info note */}
              <div className="plans-info-note">
                💡 Your active goals are automatically shared as context with your AI on <strong>/net</strong>. Actions and notes are logged automatically from conversations.
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

function MemoryCard({ item, onStatusChange, onDelete, onEdit, onOpen, onEnlist, enlisting }) {
  const { data, type, createdAt } = item;
  const isTask = TASK_TYPES.includes(type);
  const isGoal = type === 'goal';
  const isCompleted = data?.status === 'completed';
  const overdue = isOverdue(data?.deadline, data?.status);
  const priority = PRIORITY_LABELS[data?.priority] || data?.priority;
  const agentStatus = data?.agent?.status;

  return (
    <div className={`memory-card type-${type} ${isCompleted ? 'completed' : ''} ${overdue ? 'is-overdue' : ''}`}>
      <div className="memory-card-header">
        <div className="memory-card-title-row">
          {isTask && (
            <button
              className={`memory-card-check ${isCompleted ? 'checked' : ''}`}
              onClick={() => onStatusChange(item, isCompleted ? 'active' : 'completed')}
              title={isCompleted ? 'Mark active' : 'Mark completed'}
              aria-label={isCompleted ? 'Mark active' : 'Mark completed'}
            >
              {isCompleted ? '✓' : ''}
            </button>
          )}
          {isGoal ? (
            <button className="memory-card-title memory-card-title--link" onClick={() => onOpen(item)} title="Open goal">
              {data?.title || 'Untitled'}
            </button>
          ) : (
            <span className={`memory-card-title ${isCompleted ? 'strike' : ''}`}>
              {data?.title || (type === 'note' ? 'Untitled note' : 'Untitled')}
            </span>
          )}
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
        {isTask && data?.status && (
          <span className={`memory-card-status status-${data.status}`}>
            <span className="memory-card-status-dot" aria-hidden="true" />
            {STATUS_LABELS[data.status] || data.status}
          </span>
        )}
        {isTask && priority && (
          <span className={`memory-card-badge priority-${data.priority}`}>
            {priority}
          </span>
        )}
        {data?.deadline && (
          <span className={`memory-card-badge deadline ${overdue ? 'overdue' : ''}`} title={data.deadline}>
            📅 {deadlineLabel(data.deadline)}
          </span>
        )}
        {data?.source && (
          <span className="memory-card-badge source">from /{data.source}</span>
        )}
        {agentStatus && agentStatus !== 'idle' && (
          <span className={`memory-card-badge agent agent-${agentStatus}`}>🤖 {agentStatus}</span>
        )}
        <span className="memory-card-time">{timeSince(createdAt)}</span>
      </div>

      {isGoal && (
        <div className="memory-card-footer">
          <button
            className="memory-card-agent-btn"
            onClick={() => onEnlist(item)}
            disabled={enlisting === item._id}
          >
            {enlisting === item._id ? '🤖 Enlisting…' : '🤖 Enlist agent'}
          </button>
          <button className="memory-card-agent-link" onClick={() => onOpen(item)}>
            View progress →
          </button>
        </div>
      )}
    </div>
  );
}

export default Plans;
