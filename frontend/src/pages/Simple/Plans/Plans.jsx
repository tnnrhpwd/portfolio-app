import { useEffect, useState, useCallback } from 'react';
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

// -- Tiny helpers -------------------------------------------------------------

const TABS = [
  { key: 'goal',   label: '🎯 Goals',   empty: 'No goals yet — what are you working toward?' },
  { key: 'plan',   label: '📋 Plans',   empty: 'No plans yet — break a goal into steps!' },
  { key: 'action', label: '⚡ Actions', empty: 'No actions logged yet — start chatting on /net!' },
];

const PRIORITY_OPTIONS = ['low', 'medium', 'high'];
const STATUS_OPTIONS   = ['active', 'completed', 'paused'];

function timeSince(dateStr) {
  const s = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// -- Main component -----------------------------------------------------------

function Plans() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.data);

  const [activeTab, setActiveTab] = useState('goal');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Create-form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newDeadline, setNewDeadline] = useState('');

  // -- Data fetching ----------------------------------------------------------

  const load = useCallback(async () => {
    if (!user?.token) return;
    setLoading(true);
    try {
      const data = await fetchMemoryItems(user.token, activeTab);
      setItems(data);
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

  // -- CRUD handlers ----------------------------------------------------------

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return toast.error('Title is required');
    try {
      const payload = { title: newTitle.trim() };
      if (newDescription.trim()) payload.description = newDescription.trim();
      if (activeTab !== 'action') {
        payload.priority = newPriority;
        if (newDeadline) payload.deadline = newDeadline;
        payload.status = 'active';
      }
      await createMemoryItem(user.token, activeTab, payload);
      toast.success(`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} created!`);
      setNewTitle(''); setNewDescription(''); setNewPriority('medium'); setNewDeadline('');
      setShowCreate(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const handleStatusChange = async (item, newStatus) => {
    try {
      await updateMemoryItem(user.token, item._id, { status: newStatus });
      setItems(prev => prev.map(i =>
        i._id === item._id ? { ...i, data: { ...i.data, status: newStatus } } : i
      ));
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete this ${item.type}?`)) return;
    try {
      await deleteMemoryItem(user.token, item._id);
      setItems(prev => prev.filter(i => i._id !== item._id));
      toast.success('Deleted');
    } catch (err) { toast.error(err.message); }
  };

  // -- Derived data -----------------------------------------------------------

  const activeItems  = items.filter(i => i.data?.status !== 'completed');
  const doneItems    = items.filter(i => i.data?.status === 'completed');
  const currentTab   = TABS.find(t => t.key === activeTab);

  // -- Render -----------------------------------------------------------------

  return (
    <>
      <Header />
      <div className="plans-page">
        {/* Title */}
        <h1 className="plans-page-title">Memory</h1>
        <p className="plans-page-subtitle">Your goals, plans, and actions — powering your AI on /net</p>

        {!user ? (
          <div className="plans-login-prompt" onClick={() => { dispatch(logout()); navigate('/login'); }}>
            Log in to manage your memory
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="plans-tabs">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  className={`plans-tab ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => { setActiveTab(tab.key); setShowCreate(false); }}
                >
                  {tab.label}
                  {!loading && <span className="plans-tab-count">{items.length > 0 && activeTab === tab.key ? items.length : ''}</span>}
                </button>
              ))}
            </div>

            {/* Create button */}
            <button
              className="plans-create-btn"
              onClick={() => setShowCreate(!showCreate)}
            >
              {showCreate ? '✕ Cancel' : `+ New ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
            </button>

            {/* Create form */}
            {showCreate && (
              <form className="plans-create-form" onSubmit={handleCreate}>
                <input
                  className="plans-input"
                  type="text"
                  placeholder={`${activeTab === 'goal' ? 'What do you want to achieve?' : activeTab === 'plan' ? 'What is your plan?' : 'Describe the action...'}`}
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  autoFocus
                  maxLength={200}
                />
                <textarea
                  className="plans-textarea"
                  placeholder="Description (optional)"
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  rows={2}
                  maxLength={1000}
                />
                {activeTab !== 'action' && (
                  <div className="plans-form-row">
                    <select
                      className="plans-select"
                      value={newPriority}
                      onChange={e => setNewPriority(e.target.value)}
                    >
                      {PRIORITY_OPTIONS.map(p => (
                        <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)} priority</option>
                      ))}
                    </select>
                    <input
                      className="plans-input plans-date-input"
                      type="date"
                      value={newDeadline}
                      onChange={e => setNewDeadline(e.target.value)}
                      placeholder="Deadline"
                    />
                  </div>
                )}
                <button type="submit" className="plans-submit-btn">
                  Create {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                </button>
              </form>
            )}

            {/* Loading state */}
            {loading && <div className="plans-loading">Loading...</div>}

            {/* Items list */}
            {!loading && items.length === 0 && (
              <div className="plans-empty">{currentTab?.empty}</div>
            )}

            {!loading && activeItems.length > 0 && (
              <div className="plans-section">
                {activeTab !== 'action' && activeItems.length > 0 && doneItems.length > 0 && (
                  <h3 className="plans-section-title">Active</h3>
                )}
                <div className="plans-items">
                  {activeItems.map(item => (
                    <MemoryCard
                      key={item._id}
                      item={item}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )}

            {!loading && doneItems.length > 0 && (
              <div className="plans-section plans-section-done">
                <h3 className="plans-section-title">Completed</h3>
                <div className="plans-items">
                  {doneItems.map(item => (
                    <MemoryCard
                      key={item._id}
                      item={item}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Info note */}
            <div className="plans-info-note">
              💡 Your active goals are automatically shared as context with your AI on <strong>/net</strong>.
              Actions are logged automatically from conversations.
            </div>
          </>
        )}
      </div>
      <Footer />
    </>
  );
}

// -- Memory Card --------------------------------------------------------------

function MemoryCard({ item, onStatusChange, onDelete }) {
  const { data, type, createdAt } = item;
  const isCompleted = data?.status === 'completed';

  return (
    <div className={`memory-card ${type} ${isCompleted ? 'completed' : ''}`}>
      <div className="memory-card-header">
        <div className="memory-card-title-row">
          {type !== 'action' && (
            <button
              className={`memory-card-check ${isCompleted ? 'checked' : ''}`}
              onClick={() => onStatusChange(item, isCompleted ? 'active' : 'completed')}
              title={isCompleted ? 'Mark active' : 'Mark completed'}
            >
              {isCompleted ? '✓' : ''}
            </button>
          )}
          <span className={`memory-card-title ${isCompleted ? 'strike' : ''}`}>
            {data?.title || 'Untitled'}
          </span>
        </div>
        <button className="memory-card-delete" onClick={() => onDelete(item)} title="Delete">×</button>
      </div>

      {data?.description && (
        <p className="memory-card-desc">{data.description}</p>
      )}

      <div className="memory-card-meta">
        {data?.priority && (
          <span className={`memory-card-badge priority-${data.priority}`}>
            {data.priority}
          </span>
        )}
        {data?.deadline && (
          <span className="memory-card-badge deadline">
            📅 {data.deadline}
          </span>
        )}
        {data?.source && (
          <span className="memory-card-badge source">
            from /{data.source}
          </span>
        )}
        {type !== 'action' && data?.status && data.status !== 'active' && data.status !== 'completed' && (
          <select
            className="memory-card-status-select"
            value={data.status}
            onChange={e => onStatusChange(item, e.target.value)}
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <span className="memory-card-time">{timeSince(createdAt)}</span>
      </div>
    </div>
  );
}

export default Plans;
