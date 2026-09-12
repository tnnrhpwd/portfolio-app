import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import SEO from '../../../components/SEO/SEO.jsx';
import { toast } from 'react-toastify';
import { logout } from '../../../features/data/dataSlice.js';
import {
  fetchMemoryItems,
  createMemoryItem,
  updateMemoryItem,
  deleteMemoryItem,
} from '../../../services/memoryApi.js';
import {
  listWorkspace,
  upsertWorkspaceItem,
  deleteWorkspaceItem,
  getAgentStatus,
  getAutomationSuggestions,
  getAutomationPermissions,
} from '../../../services/simpleAddonApi.js';
import { useAddonDetection } from '../../../hooks/simpleAddon/useAddonDetection';
import SimpleNav from '../../../components/Simple/SimpleNav/SimpleNav.jsx';
import {
  OOGPA_STAGES,
  LOOP_LABELS,
  AGENT_PHASE_LABELS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  stageIndex,
  agentPhase,
  agentStepCount,
  goalProgress,
  priorityToNumber,
  slugifyGoalTitle,
  workspaceGoalToItem,
  suggestionToGoalPayload,
  timeSince,
  isOverdue,
  deadlineLabel,
  groupGoals,
  goalStats,
  isAgentReady,
  hasBeenEnlisted,
} from './plansUtils';
import './Plans.css';

/**
 * Plans — the user's agent mission control.
 *
 * The page is goals-first: every goal is a unit of intent the desktop agent can
 * be enlisted to work on, so the goals view leads with live O-O-G-P-A state
 * (stage, step budget, stalls, last lesson). Plans / Actions / Notes — the
 * agent's supporting memory — move into a secondary "Library" view.
 *
 * Data sources:
 *   • Goals  → cloud workspace store (canonical, needs login).
 *   • Plans/actions/notes → memory store (still canonical there).
 *   • Live loop state + proactive suggestions → local desktop addon
 *     (best-effort; the page degrades to a clear hint when it's offline).
 */

const LIBRARY_TABS = [
  { key: 'plan',   label: 'Plans',   icon: '📋', empty: 'No plans yet — break a goal into steps.', quick: 'Add a plan…',  titlePlaceholder: 'What is your plan?' },
  { key: 'action', label: 'Actions', icon: '⚡', empty: 'No actions logged yet — start chatting on /net.', quick: 'Log an action…', titlePlaceholder: 'Describe the action…' },
  { key: 'note',   label: 'Notes',   icon: '📝', empty: 'No notes yet — ask your agent to save one on /net.', quick: 'Add a note…', titlePlaceholder: 'Note title…' },
];

const PRIORITY_OPTIONS = ['low', 'medium', 'high'];

const GOAL_FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'active',  label: 'In flight' },
  { key: 'blocked', label: 'Needs you' },
  { key: 'paused',  label: 'Paused' },
  { key: 'done',    label: 'Done' },
];

const LIBRARY_FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'active',    label: 'Active' },
  { key: 'completed', label: 'Done' },
];

// The workspace goal vocabulary (the canonical store's richer lifecycle).
const GOAL_STATUS_OPTIONS = ['active', 'paused', 'blocked', 'done', 'failed'];

/** A goal/plan is finished when it can stop asking for attention. */
function isTerminal(item) {
  const status = item?.data?.status;
  return status === 'done' || status === 'completed' || status === 'failed';
}

function emptyForm() {
  return {
    title: '',
    description: '',
    priority: 'medium',
    status: 'active',
    deadline: '',
    successCriteria: '',
    maxSteps: '',
    autoAbandon: false,
  };
}

// -- Main component -----------------------------------------------------------

function Plans() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.data);
  const { isConnected, addonStatus } = useAddonDetection();

  // ── View state ───────────────────────────────────────────────────────────
  const [view, setView] = useState('goals');       // 'goals' | 'library'
  const [libraryTab, setLibraryTab] = useState('plan');

  // ── Data ─────────────────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Live addon state (best-effort) ───────────────────────────────────────
  const [agentLive, setAgentLive] = useState(null);
  const [perms, setPerms] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [acceptingSuggestion, setAcceptingSuggestion] = useState(null);

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('smart');

  // ── Quick add ────────────────────────────────────────────────────────────
  const [quickTitle, setQuickTitle] = useState('');

  // ── Create / edit form ───────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [enlisting, setEnlisting] = useState(null);

  // ── Destructive-action confirmation ──────────────────────────────────────
  // An in-page dialog instead of `window.confirm` so the confirm button can be
  // labelled with the real verb ("Delete goal") and styled as destructive.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // -- Data loading ----------------------------------------------------------

  const load = useCallback(async () => {
    if (!user?.token) { setLoading(false); return; }
    setLoading(true);
    try {
      // Goals live in the cloud workspace store (canonical); plans, actions and
      // notes still live in the memory store. Fetch both once and merge.
      const [memData, wsData] = await Promise.all([
        fetchMemoryItems(user.token).catch(() => []),
        listWorkspace(user.token, { kind: 'goal' }).catch(() => ({ entries: [] })),
      ]);
      const memItems = (Array.isArray(memData) ? memData : []).filter((i) => i.type !== 'goal');
      const goalItems = (wsData?.entries || []).map(workspaceGoalToItem).filter(Boolean);
      setItems([...goalItems, ...memItems]);
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

  // Live loop state — only when the desktop addon is reachable.
  useEffect(() => {
    if (!isConnected) { setAgentLive(null); setPerms(null); return undefined; }
    let cancelled = false;

    const poll = async () => {
      try {
        const [status, permissions] = await Promise.all([
          getAgentStatus().catch(() => null),
          getAutomationPermissions().catch(() => null),
        ]);
        if (cancelled) return;
        if (status) setAgentLive(status);
        if (permissions) setPerms(permissions);
      } catch { /* transient — retry on the next tick */ }
    };

    poll();
    const timer = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isConnected]);

  // Proactive suggestions (the watch-and-learn path).
  const loadSuggestions = useCallback(async () => {
    if (!isConnected) { setSuggestions([]); return; }
    try {
      const data = await getAutomationSuggestions();
      setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch { setSuggestions([]); }
  }, [isConnected]);

  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  // Reset transient UI when the view or library tab changes.
  useEffect(() => {
    setShowForm(false);
    setEditingId(null);
    setSearch('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setQuickTitle('');
    setForm(emptyForm());
    setShowAdvanced(false);
    setPendingDelete(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, libraryTab]);

  // Escape closes the delete confirmation.
  useEffect(() => {
    if (!pendingDelete) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !deleting) setPendingDelete(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDelete, deleting]);

  // -- Derived ---------------------------------------------------------------

  const goals = useMemo(() => items.filter((i) => i.type === 'goal'), [items]);
  const libraryItems = useMemo(() => items.filter((i) => i.type !== 'goal'), [items]);

  const stats = useMemo(() => goalStats(goals), [goals]);

  const libraryTabItems = useMemo(
    () => libraryItems.filter((i) => i.type === libraryTab),
    [libraryItems, libraryTab],
  );

  const libraryTabCount = useCallback(
    (key) => libraryItems.filter((i) => i.type === key).length,
    [libraryItems],
  );

  const currentTab = LIBRARY_TABS.find((t) => t.key === libraryTab) || LIBRARY_TABS[0];

  const filteredGoals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return goals.filter((item) => {
      const d = item.data || {};
      const status = d.status || 'active';
      if (statusFilter !== 'all') {
        if (statusFilter === 'done' ? !isTerminal(item) : status !== statusFilter) return false;
      }
      if (priorityFilter !== 'all' && (d.priority || 'medium') !== priorityFilter) return false;
      if (!q) return true;
      return (d.title || '').toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q);
    });
  }, [goals, search, statusFilter, priorityFilter]);

  const goalGroups = useMemo(() => {
    if (sortBy === 'smart') return groupGoals(filteredGoals);
    const sorted = [...filteredGoals];
    if (sortBy === 'priority') {
      sorted.sort((a, b) => (PRIORITY_ORDER[a.data?.priority] ?? 3) - (PRIORITY_ORDER[b.data?.priority] ?? 3));
    } else if (sortBy === 'newest') {
      sorted.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    }
    return [{ status: 'all', label: 'Goals', items: sorted }];
  }, [filteredGoals, sortBy]);

  const filteredLibrary = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = libraryTabItems.filter((item) => {
      const d = item.data || {};
      if (statusFilter !== 'all' && (d.status || 'active') !== statusFilter) return false;
      if (!q) return true;
      return (d.title || '').toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q);
    });
    if (sortBy === 'priority') {
      list.sort((a, b) => (PRIORITY_ORDER[a.data?.priority] ?? 3) - (PRIORITY_ORDER[b.data?.priority] ?? 3));
    } else if (sortBy === 'newest') {
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    return list;
  }, [libraryTabItems, search, statusFilter, sortBy]);

  const libraryActive = filteredLibrary.filter((i) => !isTerminal(i));
  const libraryDone = filteredLibrary.filter((i) => isTerminal(i));

  const activeStage = stageIndex(agentLive?.stage);
  const runningWorkers = agentLive?.workerCount || 0;
  const hasFilters = Boolean(search) || statusFilter !== 'all' || priorityFilter !== 'all';
  const isGoalsView = view === 'goals';

  // -- Form helpers ----------------------------------------------------------

  function resetForm() {
    setForm(emptyForm());
    setShowAdvanced(false);
  }

  const openCreate = () => {
    resetForm();
    setEditingId(null);
    setShowForm(true);
  };

  const openEditGoal = (item) => {
    const d = item.data || {};
    setForm({
      ...emptyForm(),
      title: d.title || '',
      description: d.description || '',
      priority: d.priority || 'medium',
      status: d.status || 'active',
      successCriteria: d.successCriteria || '',
      maxSteps: d.maxSteps != null ? String(d.maxSteps) : '',
      autoAbandon: !!d.autoAbandon,
    });
    setEditingId(item._id);
    setShowForm(true);
    setShowAdvanced(Boolean(d.successCriteria || d.maxSteps != null || d.autoAbandon));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openEditLibrary = (item) => {
    const d = item.data || {};
    setForm({
      ...emptyForm(),
      title: d.title || '',
      description: d.description || '',
      priority: d.priority || 'medium',
      status: d.status || 'active',
      deadline: d.deadline || '',
    });
    setEditingId(item._id);
    setShowForm(true);
  };

  // -- CRUD ------------------------------------------------------------------

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Give it a title first'); return; }
    setSaving(true);
    try {
      if (isGoalsView) {
        const slug = editingId || slugifyGoalTitle(form.title.trim());
        const payload = {
          name: form.title.trim(),
          content: form.description.trim() || form.title.trim(),
          status: editingId ? form.status : 'active',
          priority: priorityToNumber(form.priority),
        };
        if (form.successCriteria.trim()) payload.successCriteria = form.successCriteria.trim();
        if (form.maxSteps.trim()) payload.maxSteps = Number(form.maxSteps);
        if (form.autoAbandon) payload.autoAbandon = true;
        await upsertWorkspaceItem(user.token, 'goal', slug, payload);
        toast.success(editingId ? 'Goal updated!' : 'Goal created!');
      } else {
        const payload = { title: form.title.trim() };
        if (form.description.trim()) payload.description = form.description.trim();
        if (libraryTab === 'plan') {
          payload.priority = form.priority;
          if (form.deadline) payload.deadline = form.deadline;
          payload.status = editingId ? form.status : 'active';
        }
        if (editingId) await updateMemoryItem(user.token, editingId, payload);
        else await createMemoryItem(user.token, libraryTab, payload);
        toast.success(`${currentTab.label.slice(0, -1)} ${editingId ? 'updated' : 'created'}!`);
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
      if (isGoalsView) {
        await upsertWorkspaceItem(user.token, 'goal', slugifyGoalTitle(title), {
          name: title,
          content: title,
          status: 'active',
          priority: 50,
        });
        toast.success('Goal added!');
      } else {
        const payload = { title };
        if (libraryTab === 'plan') { payload.priority = 'medium'; payload.status = 'active'; }
        await createMemoryItem(user.token, libraryTab, payload);
        toast.success(`${currentTab.label.slice(0, -1)} added!`);
      }
      setQuickTitle('');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (item, newStatus) => {
    try {
      if (item.workspace) {
        await upsertWorkspaceItem(user.token, 'goal', item._id, {
          name: item.data?.title || 'Untitled goal',
          content: item.data?.description || item.data?.title || '',
          status: newStatus,
          priority: priorityToNumber(item.data?.priority),
        });
      } else {
        await updateMemoryItem(user.token, item._id, { status: newStatus });
      }
      setItems((prev) => prev.map((i) => (
        i._id === item._id ? { ...i, data: { ...i.data, status: newStatus } } : i
      )));
    } catch (err) { toast.error(err.message); }
  };

  /** Open the confirmation dialog (never delete straight from a card click). */
  const requestDelete = (item) => setPendingDelete(item);

  const confirmDelete = async () => {
    const item = pendingDelete;
    if (!item || deleting) return;
    setDeleting(true);
    try {
      if (item.workspace) await deleteWorkspaceItem(user.token, 'goal', item._id, { hard: true });
      else await deleteMemoryItem(user.token, item._id);
      setItems((prev) => prev.filter((i) => i._id !== item._id));
      toast.success('Deleted');
      setPendingDelete(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleAcceptSuggestion = async (suggestion) => {
    if (acceptingSuggestion) return;
    const key = suggestion.id || suggestion.sequenceKey;
    setAcceptingSuggestion(key);
    try {
      const payload = suggestionToGoalPayload(suggestion);
      await upsertWorkspaceItem(user.token, 'goal', payload.slug, {
        name: payload.title,
        content: payload.content,
        status: 'active',
        priority: 70,
        successCriteria: 'The task described has been completed.',
      });
      toast.success('Goal created — enlist the agent when you\'re ready.');
      setSuggestions((prev) => prev.filter((s) => (s.id || s.sequenceKey) !== key));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAcceptingSuggestion(null);
    }
  };

  const openGoal = (item) => { if (item.type === 'goal') navigate(`/plans/goal/${item._id}`); };

  /**
   * Hand a goal to the agent *through its conversation* on /net.
   *
   * Enlisting is deliberately not a page: the run happens in the goal's own
   * chat thread, so the output is visible as it lands, and the thread's history
   * is what a follow-up instruction is read against — which is what lets the
   * user keep iterating on the same goal without re-describing it.
   */
  const openAgentChat = (item, enlist = false) => {
    if (!item || item.type !== 'goal') return;
    const params = new URLSearchParams({ goal: item._id });
    if (enlist) params.set('enlist', '1');
    navigate(`/net?${params.toString()}`);
  };

  const handleEnlist = (item) => {
    if (enlisting === item._id) return;
    setEnlisting(item._id);
    openAgentChat(item, true);
    // /net takes over from here; this only clears the transient label if the
    // navigation is blocked (e.g. a gated route bouncing back).
    setTimeout(() => setEnlisting(null), 2000);
  };

  const handleViewAgent = (item) => openAgentChat(item, false);

  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setPriorityFilter('all'); };

  // -- Render ----------------------------------------------------------------

  return (
    <>
      <SEO
        title="Plans"
        description="Mission control for your Simple agent — the goals it can work on, live progress, and the plans, actions, and notes behind them."
        path="/plans"
        noindex
      />
      <Header center={<SimpleNav compact running={Boolean(agentLive?.running)} goalName={agentLive?.currentGoal?.name || ''} />} />

      <div className="plans-page">
        <div className="plans-shell">
          {/* Toolbar — the page's "hero", collapsed onto one sticky row. Name,
              live state, primary action: a service page leads with the tool, not
              with a description of itself (FRONTEND_UI_STANDARD.md §5.7). */}
          <header className="plans-bar">
            <h1 className="plans-bar-title">Goals</h1>

            {isConnected ? (
              <span className="plans-bar-readout">
                <span className="plans-chip">Loop <strong>{LOOP_LABELS[agentLive?.loop] || agentLive?.loop || 'idle'}</strong></span>
                <span className="plans-chip">Stage <strong>{agentLive?.stage || '—'}</strong></span>
                {runningWorkers > 0 && (
                  <span className="plans-chip plans-chip--accent">{runningWorkers} running</span>
                )}
                {perms?.globalKillSwitch && (
                  <span className="plans-chip plans-chip--danger">⛔ Stopped</span>
                )}
              </span>
            ) : (
              <span className="plans-bar-status">Desktop agent offline</span>
            )}

            {user && !loading && (
              <span className="plans-bar-stats" aria-label="Goal summary">
                <span className="plans-chip">In flight <strong>{stats.active}</strong></span>
                <span className={`plans-chip ${stats.blocked > 0 ? 'plans-chip--danger' : ''}`}>
                  Needs you <strong>{stats.blocked}</strong>
                </span>
                <span className="plans-chip">Done <strong>{stats.done}</strong></span>
                <span className="plans-chip">{stats.pct}% complete</span>
              </span>
            )}

            {user && (
              <div className="plans-bar-actions">
                <button type="button" className="plans-btn plans-btn--primary" onClick={openCreate}>
                  + New goal
                </button>
              </div>
            )}
          </header>

          {!user ? (
            <button
              type="button"
              className="plans-login"
              onClick={() => { dispatch(logout()); navigate('/login'); }}
            >
              Log in to see your goals and let the agent work on them
            </button>
          ) : (
            <>
              {/* The live loop. A panel, not a band: what the agent is doing
                  right now, on the same plane as everything else. */}
              <section
                className={`plans-agent ${isConnected ? 'is-live' : 'is-offline'}`}
                aria-label="Agent status"
              >
                <div className="plans-agent-head">
                  <span className="plans-agent-dot" aria-hidden="true" />
                  <div className="plans-agent-heading">
                    <h2 className="plans-agent-title">
                      {isConnected
                        ? (agentLive?.running ? 'Agent is working' : 'Agent is ready')
                        : 'Desktop agent is offline'}
                    </h2>
                    <p className="plans-agent-sub">
                      {isConnected ? (
                        agentLive?.running && agentLive.currentGoal
                          ? <>Working on <strong>{agentLive.currentGoal.name || agentLive.currentGoal.slug}</strong>{agentLive.step ? ` · step ${agentLive.step}` : ''}</>
                          : <>Idle — enlist a goal below, or talk to it on <Link to="/net">/net</Link>.</>
                      ) : (
                        <>Install or launch the Simple desktop app to let your agent act on this PC. Your goals still sync without it.</>
                      )}
                    </p>
                  </div>
                  {perms?.globalKillSwitch && (
                    <span className="plans-agent-kill" title="The global kill switch is on — no tool can run.">
                      ⛔ Kill switch on
                    </span>
                  )}
                </div>

                {/* Stage rail */}
                <ol className="plans-stage-rail" aria-label="Agent loop stage">
                  {OOGPA_STAGES.map((s, i) => {
                    const state = activeStage < 0 ? '' : i === activeStage ? 'is-current' : i < activeStage ? 'is-done' : '';
                    return (
                      <li key={s.key} className={`plans-stage ${state}`} aria-current={i === activeStage ? 'step' : undefined}>
                        <span className="plans-stage-key" aria-hidden="true">{s.short}</span>
                        <span className="plans-stage-label">{s.label}</span>
                      </li>
                    );
                  })}
                </ol>

                <div className="plans-agent-meta">
                  <span className="plans-agent-chip">
                    {isConnected
                      ? `Loop: ${LOOP_LABELS[agentLive?.loop] || agentLive?.loop || 'idle'}`
                      : 'Not connected'}
                  </span>
                  {isConnected && typeof agentLive?.stallCount === 'number' && agentLive.stallCount > 0 && (
                    <span className="plans-agent-chip plans-agent-chip--warn">Stalled ×{agentLive.stallCount}</span>
                  )}
                  {isConnected && runningWorkers > 0 && (
                    <span className="plans-agent-chip plans-agent-chip--accent">
                      {runningWorkers} goal{runningWorkers === 1 ? '' : 's'} running
                    </span>
                  )}
                  {isConnected && addonStatus?.version && (
                    <span className="plans-agent-chip plans-agent-chip--muted">v{addonStatus.version}</span>
                  )}
                  <Link className="plans-agent-link" to="/simple">Open live controls →</Link>
                </div>

                {isConnected && agentLive?.lastLesson && (
                  <p className="plans-agent-lesson">
                    <span aria-hidden="true">📚</span> Last lesson: <em>{String(agentLive.lastLesson).slice(0, 180)}</em>
                  </p>
                )}
              </section>

              {/* Proactive suggestions — the watch-and-learn path */}
              {isConnected && suggestions.length > 0 && (
                <section className="plans-suggestions" aria-label="Suggested automations">
                  <h2 className="plans-section-title">Noticed on your PC</h2>
                  <div className="plans-suggestion-list">
                    {suggestions.slice(0, 3).map((s) => {
                      const key = s.id || s.sequenceKey;
                      return (
                        <article key={key} className="plans-suggestion">
                          <div className="plans-suggestion-body">
                            <p className="plans-suggestion-title">{s.title}</p>
                            {s.description && <p className="plans-suggestion-desc">{s.description}</p>}
                            <div className="plans-suggestion-tags">
                              {s.value && <span className={`plans-tag plans-tag--${s.value}`}>{s.value} value</span>}
                              {typeof s.repeatCount === 'number' && <span className="plans-tag">×{s.repeatCount}</span>}
                              {typeof s.confidence === 'number' && (
                                <span className="plans-tag">{Math.round(s.confidence * 100)}% sure</span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="plans-btn plans-btn--outline plans-btn--sm"
                            onClick={() => handleAcceptSuggestion(s)}
                            disabled={acceptingSuggestion === key}
                          >
                            {acceptingSuggestion === key ? 'Creating…' : 'Automate this'}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* View switch: Goals | Library */}
              <div className="plans-switch" role="tablist" aria-label="Workspace view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isGoalsView}
                  className={`plans-switch-btn ${isGoalsView ? 'is-active' : ''}`}
                  onClick={() => setView('goals')}
                >
                  🎯 Goals <span className="plans-switch-count">{goals.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isGoalsView}
                  className={`plans-switch-btn ${!isGoalsView ? 'is-active' : ''}`}
                  onClick={() => setView('library')}
                >
                  📚 Library <span className="plans-switch-count">{libraryItems.length}</span>
                </button>
              </div>

              {/* Library sub-tabs */}
              {!isGoalsView && (
                <div className="plans-tabs" role="tablist" aria-label="Library type">
                  {LIBRARY_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={libraryTab === tab.key}
                      className={`plans-tab ${libraryTab === tab.key ? 'is-active' : ''}`}
                      onClick={() => setLibraryTab(tab.key)}
                    >
                      <span aria-hidden="true">{tab.icon}</span> {tab.label}
                      {!loading && <span className="plans-tab-count">{libraryTabCount(tab.key)}</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* Controls */}
              <section className="plans-controls">
                <form className="plans-quickadd" onSubmit={handleQuickAdd}>
                  <span className="plans-quickadd-icon" aria-hidden="true">{isGoalsView ? '🎯' : currentTab.icon}</span>
                  <input
                    className="plans-quickadd-input"
                    type="text"
                    placeholder={isGoalsView ? 'Add a goal — what should your agent get done?' : currentTab.quick}
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                    maxLength={200}
                    aria-label={isGoalsView ? 'New goal title' : `New ${currentTab.label.slice(0, -1)} title`}
                  />
                  <button type="submit" className="plans-quickadd-btn" disabled={saving || !quickTitle.trim()}>
                    {saving ? '…' : 'Add'}
                  </button>
                </form>

                <div className="plans-controls-row">
                  <div className="plans-search">
                    <span className="plans-search-icon" aria-hidden="true">🔍</span>
                    <input
                      className="plans-search-input"
                      type="text"
                      placeholder={isGoalsView ? 'Search goals…' : `Search ${currentTab.label.toLowerCase()}…`}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="Search"
                    />
                    {search && (
                      <button type="button" className="plans-search-clear" onClick={() => setSearch('')} aria-label="Clear search">✕</button>
                    )}
                  </div>

                  <select
                    className="plans-filter-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    aria-label="Sort by"
                  >
                    <option value="smart">{isGoalsView ? 'Smart order' : 'Default'}</option>
                    <option value="priority">Priority</option>
                    <option value="newest">Newest first</option>
                  </select>
                </div>

                <div className="plans-chips">
                  {(isGoalsView ? GOAL_FILTERS : LIBRARY_FILTERS).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className={`plans-chip ${statusFilter === f.key ? 'is-active' : ''}`}
                      onClick={() => setStatusFilter(f.key)}
                      aria-pressed={statusFilter === f.key}
                    >
                      {f.label}
                    </button>
                  ))}
                  {isGoalsView && PRIORITY_OPTIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`plans-chip plans-chip--priority ${priorityFilter === p ? 'is-active' : ''}`}
                      onClick={() => setPriorityFilter(priorityFilter === p ? 'all' : p)}
                      aria-pressed={priorityFilter === p}
                    >
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                  {hasFilters && (
                    <button type="button" className="plans-chip plans-chip--clear" onClick={clearFilters}>
                      ✕ Clear
                    </button>
                  )}
                </div>
              </section>

              {/* Create / edit form */}
              {showForm && (
                <form className="plans-form" onSubmit={handleSubmit}>
                  <div className="plans-form-head">
                    <h2 className="plans-form-title">
                      {editingId ? 'Edit' : 'New'} {isGoalsView ? 'goal' : currentTab.label.slice(0, -1)}
                    </h2>
                    <button
                      type="button"
                      className="plans-form-close"
                      onClick={() => { setShowForm(false); setEditingId(null); resetForm(); }}
                      aria-label="Close form"
                    >✕</button>
                  </div>

                  <label className="plans-field">
                    <span className="plans-field-label">Title</span>
                    <input
                      className="plans-input"
                      type="text"
                      placeholder={isGoalsView ? 'What should the agent get done?' : currentTab.titlePlaceholder}
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      autoFocus
                      maxLength={200}
                    />
                  </label>

                  <label className="plans-field">
                    <span className="plans-field-label">Description <span className="plans-field-hint">optional</span></span>
                    <textarea
                      className="plans-textarea"
                      placeholder={isGoalsView
                        ? 'Detail that helps the agent plan — where it lives, what "done" looks like.'
                        : 'Description (optional)'}
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      rows={2}
                      maxLength={1000}
                    />
                  </label>

                  <div className="plans-form-row">
                    <label className="plans-field">
                      <span className="plans-field-label">Priority</span>
                      <select
                        className="plans-select"
                        value={form.priority}
                        onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                      >
                        {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                      </select>
                    </label>

                    {!isGoalsView && libraryTab === 'plan' && (
                      <label className="plans-field">
                        <span className="plans-field-label">Deadline <span className="plans-field-hint">optional</span></span>
                        <input
                          className="plans-input"
                          type="date"
                          value={form.deadline || ''}
                          onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
                        />
                      </label>
                    )}

                    {editingId && (
                      <label className="plans-field">
                        <span className="plans-field-label">Status</span>
                        <select
                          className="plans-select"
                          value={form.status}
                          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                        >
                          {(isGoalsView ? GOAL_STATUS_OPTIONS : ['active', 'completed', 'paused']).map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>

                  {/* Advanced agent fields (goals only) */}
                  {isGoalsView && (
                    <div className="plans-advanced">
                      <button
                        type="button"
                        className="plans-advanced-toggle"
                        onClick={() => setShowAdvanced((v) => !v)}
                        aria-expanded={showAdvanced}
                      >
                        {showAdvanced ? '▾' : '▸'} Agent settings <span className="plans-field-hint">optional</span>
                      </button>
                      {showAdvanced && (
                        <div className="plans-advanced-body">
                          <label className="plans-field">
                            <span className="plans-field-label">
                              Success criteria
                              <span className="plans-field-hint"> — how the agent knows it&apos;s finished</span>
                            </span>
                            <input
                              className="plans-input"
                              type="text"
                              placeholder="e.g. A window titled 'Report' is focused and the file exists"
                              value={form.successCriteria}
                              onChange={(e) => setForm((f) => ({ ...f, successCriteria: e.target.value }))}
                              maxLength={300}
                            />
                          </label>
                          <div className="plans-form-row">
                            <label className="plans-field">
                              <span className="plans-field-label">Step budget</span>
                              <input
                                className="plans-input"
                                type="number"
                                min={1}
                                max={1000}
                                placeholder="60"
                                value={form.maxSteps}
                                onChange={(e) => setForm((f) => ({ ...f, maxSteps: e.target.value }))}
                              />
                            </label>
                            <label className="plans-field plans-field--check">
                              <input
                                type="checkbox"
                                checked={form.autoAbandon}
                                onChange={(e) => setForm((f) => ({ ...f, autoAbandon: e.target.checked }))}
                              />
                              <span>Let the agent abandon this goal if it keeps stalling</span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="plans-form-actions">
                    <button
                      type="button"
                      className="plans-btn plans-btn--ghost"
                      onClick={() => { setShowForm(false); setEditingId(null); resetForm(); }}
                      disabled={saving}
                    >Cancel</button>
                    <button type="submit" className="plans-btn plans-btn--primary" disabled={saving || !form.title.trim()}>
                      {saving ? 'Saving…' : editingId ? 'Save changes' : `Create ${isGoalsView ? 'goal' : currentTab.label.slice(0, -1)}`}
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

              {/* Goals view */}
              {!loading && isGoalsView && (
                <section className="plans-goals">
                  {goalGroups.length === 0 ? (
                    <EmptyState
                      icon="🎯"
                      title={hasFilters ? 'No goals match those filters' : 'No goals yet — what should your agent get done?'}
                      action={hasFilters
                        ? <button type="button" className="plans-btn plans-btn--ghost" onClick={clearFilters}>Clear filters</button>
                        : <button type="button" className="plans-btn plans-btn--primary" onClick={openCreate}>+ Create your first goal</button>}
                    />
                  ) : goalGroups.map((group) => (
                    <div className="plans-group" key={group.status}>
                      {goalGroups.length > 1 && (
                        <h3 className={`plans-group-title plans-group-title--${group.status}`}>
                          {group.label} <span className="plans-group-count">{group.items.length}</span>
                        </h3>
                      )}
                      <div className="plans-goal-grid">
                        {group.items.map((item) => (
                          <GoalCard
                            key={item._id}
                            item={item}
                            onStatusChange={handleStatusChange}
                            onDelete={requestDelete}
                            onEdit={openEditGoal}
                            onOpen={openGoal}
                            onEnlist={handleEnlist}
                            onViewAgent={handleViewAgent}
                            enlisting={enlisting}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* Library view */}
              {!loading && !isGoalsView && (
                <section className="plans-goals">
                  {filteredLibrary.length === 0 ? (
                    <EmptyState
                      icon={currentTab.icon}
                      title={hasFilters ? 'No matches found' : currentTab.empty}
                      action={hasFilters
                        ? <button type="button" className="plans-btn plans-btn--ghost" onClick={clearFilters}>Clear filters</button>
                        : <button type="button" className="plans-btn plans-btn--primary" onClick={openCreate}>+ Create your first {currentTab.label.slice(0, -1).toLowerCase()}</button>}
                    />
                  ) : (
                    <>
                      {libraryActive.length > 0 && (
                        <div className="plans-group">
                          {libraryDone.length > 0 && <h3 className="plans-group-title">Active</h3>}
                          <div className="plans-item-list">
                            {libraryActive.map((item) => (
                              <LibraryCard
                                key={item._id}
                                item={item}
                                onStatusChange={handleStatusChange}
                                onDelete={requestDelete}
                                onEdit={openEditLibrary}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {libraryDone.length > 0 && (
                        <div className="plans-group plans-group--done">
                          <h3 className="plans-group-title">Completed</h3>
                          <div className="plans-item-list">
                            {libraryDone.map((item) => (
                              <LibraryCard
                                key={item._id}
                                item={item}
                                onStatusChange={handleStatusChange}
                                onDelete={requestDelete}
                                onEdit={openEditLibrary}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}

              <p className="plans-info-note">
                💡 Active goals are shared as context with your AI on <strong>/net</strong>, and the agent
                writes lessons back here whenever a step fails — so it gets better at your tasks over time.
              </p>
            </>
          )}
        </div>
      </div>

      {pendingDelete && (
        <DeleteConfirm
          item={pendingDelete}
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}

      <Footer />
    </>
  );
}

// -- Delete confirmation ------------------------------------------------------

/**
 * In-page destructive confirmation.
 *
 * Replaces `window.confirm`, whose button is an unstylable native "OK". Here the
 * confirm button carries the real verb ("Delete goal") and reads as destructive,
 * the least-destructive action holds focus, and Escape / the scrim cancel.
 */
function DeleteConfirm({ item, busy, onCancel, onConfirm }) {
  const noun = item.type === 'goal' ? 'goal' : item.type;
  const title = item.data?.title || 'this item';

  return (
    <div
      className="plans-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        className="plans-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="plans-delete-title"
        aria-describedby="plans-delete-desc"
      >
        <span className="plans-modal-icon" aria-hidden="true">🗑️</span>
        <h2 id="plans-delete-title" className="plans-modal-title">Delete this {noun}?</h2>
        <p id="plans-delete-desc" className="plans-modal-desc">
          <strong className="plans-modal-subject">{title}</strong> will be permanently
          removed from your workspace. <span className="plans-modal-warn">This can&apos;t be undone.</span>
        </p>
        <div className="plans-modal-actions">
          {/* Focus lands on the safe choice so a stray Enter never deletes. */}
          <button type="button" className="plans-btn plans-btn--ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button type="button" className="plans-btn plans-btn--danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : `Delete ${noun}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// -- Empty state --------------------------------------------------------------

function EmptyState({ icon, title, action }) {
  return (
    <div className="plans-empty">
      <div className="plans-empty-icon" aria-hidden="true">{icon}</div>
      <p className="plans-empty-title">{title}</p>
      {action}
    </div>
  );
}

// -- Goal card ----------------------------------------------------------------

function GoalCard({ item, onStatusChange, onDelete, onEdit, onOpen, onEnlist, onViewAgent, enlisting }) {
  const { data, updatedAt } = item;
  const status = data?.status || 'active';
  const done = status === 'done';
  const failed = status === 'failed';
  const phase = agentPhase(data?.agent);
  const progress = goalProgress(data?.agent, data?.maxSteps);
  const steps = agentStepCount(data?.agent);
  const ready = isAgentReady(item);
  const enlisted = hasBeenEnlisted(item);
  const overdue = isOverdue(data?.deadline, status);

  return (
    <article className={`plans-goal-card status-${status} ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}`}>
      <header className="plans-goal-head">
        <button
          type="button"
          className={`plans-goal-check ${done ? 'is-checked' : ''}`}
          onClick={() => onStatusChange(item, done ? 'active' : 'done')}
          title={done ? 'Mark active' : 'Mark done'}
          aria-label={done ? 'Mark active' : 'Mark done'}
        >
          {done ? '✓' : ''}
        </button>

        <button type="button" className="plans-goal-title" onClick={() => onOpen(item)} title="Open goal">
          {data?.title || 'Untitled goal'}
        </button>

        <span className={`plans-goal-status status-${status}`}>
          <span className="plans-goal-status-dot" aria-hidden="true" />
          {STATUS_LABELS[status] || status}
        </span>

        <div className="plans-goal-actions">
          <button type="button" className="plans-icon-btn" onClick={() => onEdit(item)} title="Edit" aria-label="Edit goal">✎</button>
          <button type="button" className="plans-icon-btn plans-icon-btn--danger" onClick={() => onDelete(item)} title="Delete" aria-label="Delete goal">×</button>
        </div>
      </header>

      {data?.description && <p className="plans-goal-desc">{data.description}</p>}

      {/* Agent run state */}
      <div className="plans-goal-agent">
        <div className="plans-goal-agent-row">
          <span className={`plans-phase phase-${phase}`}>
            <span className="plans-phase-dot" aria-hidden="true" />
            {AGENT_PHASE_LABELS[phase] || phase}
          </span>
          {steps > 0 && <span className="plans-goal-steps">{steps} step{steps === 1 ? '' : 's'}</span>}
          <span className="plans-goal-time">{timeSince(updatedAt || item.createdAt)}</span>
        </div>
        <div className="plans-track">
          <div className={`plans-track-fill phase-${phase}`} style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="plans-goal-tags">
        {data?.priority && <span className={`plans-tag plans-tag--${data.priority}`}>{PRIORITY_LABELS[data.priority] || data.priority}</span>}
        {data?.successCriteria && <span className="plans-tag plans-tag--outline" title={data.successCriteria}>✓ Success criteria</span>}
        {data?.maxSteps != null && <span className="plans-tag">≤{data.maxSteps} steps</span>}
        {data?.autoAbandon && <span className="plans-tag plans-tag--outline">auto-abandon</span>}
        {data?.createdBy === 'agent' && <span className="plans-tag plans-tag--outline">agent-created</span>}
        {data?.deadline && (
          <span className={`plans-tag ${overdue ? 'plans-tag--danger' : ''}`}>📅 {deadlineLabel(data.deadline)}</span>
        )}
      </div>

      <footer className="plans-goal-foot">
        {enlisted ? (
          // Once a run exists there is a conversation to read, so the card's job
          // flips from "start this" to "go look at it" — and the chat is where
          // the user keeps iterating on the goal.
          <button
            type="button"
            className="plans-btn plans-btn--primary plans-btn--sm"
            onClick={() => onViewAgent(item)}
            title="Open this goal's conversation on /net"
          >
            👁 View agent
          </button>
        ) : ready ? (
          <button
            type="button"
            className="plans-btn plans-btn--primary plans-btn--sm"
            onClick={() => onEnlist(item)}
            disabled={enlisting === item._id}
            title="Hand this goal to the agent in its own conversation on /net"
          >
            {enlisting === item._id ? '🤖 Enlisting…' : '🤖 Enlist agent'}
          </button>
        ) : (
          <button type="button" className="plans-btn plans-btn--ghost plans-btn--sm" onClick={() => onOpen(item)}>
            {failed ? 'Review what happened' : 'View summary'}
          </button>
        )}
        <button type="button" className="plans-goal-link" onClick={() => onOpen(item)}>
          Progress &amp; timeline <span aria-hidden="true">→</span>
        </button>
      </footer>
    </article>
  );
}

// -- Library card (plans / actions / notes) -----------------------------------

function LibraryCard({ item, onStatusChange, onDelete, onEdit }) {
  const { data, type, createdAt } = item;
  const isPlan = type === 'plan';
  const done = data?.status === 'completed' || data?.status === 'done';
  const overdue = isOverdue(data?.deadline, data?.status);

  return (
    <article className={`plans-lib-card type-${type} ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}`}>
      <div className="plans-lib-head">
        <div className="plans-lib-title-row">
          {isPlan && (
            <button
              type="button"
              className={`plans-goal-check ${done ? 'is-checked' : ''}`}
              onClick={() => onStatusChange(item, done ? 'active' : 'completed')}
              aria-label={done ? 'Mark active' : 'Mark completed'}
            >{done ? '✓' : ''}</button>
          )}
          <span className={`plans-lib-title ${done ? 'is-struck' : ''}`}>
            {data?.title || (type === 'note' ? 'Untitled note' : 'Untitled')}
          </span>
        </div>
        <div className="plans-goal-actions">
          <button type="button" className="plans-icon-btn" onClick={() => onEdit(item)} title="Edit" aria-label="Edit">✎</button>
          <button type="button" className="plans-icon-btn plans-icon-btn--danger" onClick={() => onDelete(item)} title="Delete" aria-label="Delete">×</button>
        </div>
      </div>

      {data?.description && <p className="plans-goal-desc">{data.description}</p>}

      <div className="plans-goal-tags">
        {isPlan && data?.priority && <span className={`plans-tag plans-tag--${data.priority}`}>{PRIORITY_LABELS[data.priority] || data.priority}</span>}
        {data?.deadline && <span className={`plans-tag ${overdue ? 'plans-tag--danger' : ''}`}>📅 {deadlineLabel(data.deadline)}</span>}
        {data?.source && <span className="plans-tag plans-tag--outline">from /{data.source}</span>}
        <span className="plans-goal-time">{timeSince(createdAt)}</span>
      </div>
    </article>
  );
}

export default Plans;
