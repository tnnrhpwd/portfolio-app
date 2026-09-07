import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import { toast } from 'react-toastify';
import { logout } from '../../../features/data/dataSlice.js';
import { fetchMemoryItem, fetchMemoryItems, createMemoryItem } from '../../../services/memoryApi.js';
import { startGoalAgent, getGoalAgentStatus, stopGoalAgent, recordGoalAgentResult } from '../../../services/goalAgentApi.js';
import { runAgentMessage } from '../../../services/simpleAddonApi';
import './GoalDetail.css';

const STATUS_LABELS = {
  active: 'Active',
  completed: 'Done',
  paused: 'Paused',
};

const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

const RUN_STATUS_LABELS = {
  running: 'Running',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

const STEP_META = {
  plan:       { icon: '📋', label: 'Plan' },
  thought:    { icon: '💭', label: 'Thinking' },
  tool:       { icon: '🔧', label: 'Tool' },
  'tool-result': { icon: '✅', label: 'Result' },
  result:     { icon: '🏁', label: 'Deliverable' },
  error:      { icon: '⚠️', label: 'Note' },
};

function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function GoalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.data);

  const [goal, setGoal] = useState(null);
  const [agent, setAgent] = useState(null);
  const [running, setRunning] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [context, setContext] = useState('');
  const [runResult, setRunResult] = useState(null);
  const [runError, setRunError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Linked plans/actions (goal → plan → action lineage)
  const [linked, setLinked] = useState([]);
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [linkKind, setLinkKind] = useState('plan');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);

  const feedRef = useRef(null);
  const agentRef = useRef(agent);
  agentRef.current = agent;

  const handleAuthError = useCallback((err) => {
    if (err.message?.includes('token') || err.message?.includes('authorized')) {
      dispatch(logout());
      navigate('/login');
      return true;
    }
    return false;
  }, [dispatch, navigate]);

  // Initial load
  const load = useCallback(async () => {
    if (!user?.token) { setLoading(false); return; }
    setLoading(true);
    try {
      const item = await fetchMemoryItem(user.token, id);
      setGoal(item);
      setAgent(item.data?.agent || { status: 'idle', steps: [] });
      setNotFound(false);
      setLoadError(null);
    } catch (err) {
      if (handleAuthError(err)) return;
      if (/not found/i.test(err.message || '')) {
        setNotFound(true);
        setLoadError(null);
      } else {
        setNotFound(false);
        setLoadError(err.message || 'Failed to load this goal.');
      }
    } finally {
      setLoading(false);
    }
  }, [user, id, handleAuthError]);

  useEffect(() => { load(); }, [load]);

  // Poll agent status while a run is live. Re-starts when `running` flips true
  // (e.g. after the user presses "Enlist agent") and stops once the run ends.
  useEffect(() => {
    if (!user?.token || !id || !running) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await getGoalAgentStatus(user.token, id);
        if (cancelled) return;
        setRunning(!!res.running);
        setAgent(res.agent || { status: 'idle', steps: [] });
      } catch (err) {
        if (cancelled) return;
        if (!handleAuthError(err)) { /* transient error — next tick retries */ }
      }
    };

    poll(); // immediate refresh when a run starts
    const timer = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [user, id, running, handleAuthError]);

  // Live step streaming: while an addon run is in progress (`streaming`), poll
  // the memory goal and render steps as the desktop addon pushes them.
  useEffect(() => {
    if (!user?.token || !id || !streaming) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const item = await fetchMemoryItem(user.token, id);
        if (cancelled) return;
        const agentState = item?.data?.agent;
        if (agentState && Array.isArray(agentState.steps)) setAgent(agentState);
      } catch (err) {
        if (cancelled) return;
        if (!handleAuthError(err)) { /* transient — next tick retries */ }
      }
    };

    poll();
    const timer = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [user, id, streaming, handleAuthError]);

  // Auto-scroll the feed to the bottom as new steps arrive
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [agent?.steps?.length]);

  // Load plans/actions linked to this goal via `data.goalId`.
  const loadLinked = useCallback(async () => {
    if (!user?.token || !id) return;
    setLinkedLoading(true);
    try {
      const [plans, actions] = await Promise.all([
        fetchMemoryItems(user.token, 'plan').catch(() => []),
        fetchMemoryItems(user.token, 'action').catch(() => []),
      ]);
      setLinked([...plans, ...actions].filter((it) => it.data?.goalId === id));
    } catch (err) {
      if (!handleAuthError(err)) { /* best-effort */ }
    } finally {
      setLinkedLoading(false);
    }
  }, [user, id, handleAuthError]);

  useEffect(() => { loadLinked(); }, [loadLinked]);

  // Mirror a desktop-addon run result back onto this goal so the /plans page
  // stays the single source of truth for agent progress.
  const mirrorAgentResult = async (res) => {
    const ts = new Date().toISOString();
    const steps = [];
    const plan = [];
    // Rebuild the full step feed from the addon's executed tool sequence so the
    // /plans page shows what the agent did, not just the final answer.
    for (const s of res.stepLog || []) {
      const label = String(s.tool || 'step');
      plan.push(label);
      steps.push({
        kind: s.ok === false ? 'error' : 'tool',
        text: s.ok === false ? `${label} failed` : label,
        ts,
        meta: { tool: s.tool, args: s.args || {}, ok: s.ok },
      });
      if (s.result) {
        steps.push({ kind: 'tool-result', text: String(s.result).slice(0, 1000), ts, meta: { tool: s.tool } });
      }
    }
    if (res.result) steps.push({ kind: 'result', text: String(res.result).slice(0, 1000), ts });
    if (!res.result && res.reason && steps.length === 0) {
      steps.push({ kind: 'error', text: `Stopped: ${res.reason}`, ts });
    }
    const mappedStatus = res.status === 'done' ? 'done'
      : (res.status === 'timeout' || res.status === 'stopped' ? 'stopped' : 'failed');
    const agentState = {
      status: mappedStatus,
      summary: res.result || res.reason || '',
      result: res.result || '',
      steps,
      plan,
      source: 'addon',
    };
    try {
      await recordGoalAgentResult(user.token, id, agentState);
      setAgent((prev) => ({ ...(prev || {}), ...agentState, steps: [...(prev?.steps || []), ...steps] }));
    } catch (e) {
      // Mirroring is best-effort; never block the success toast on it.
      if (!handleAuthError(e)) console.warn('[GoalDetail] mirror failed:', e.message);
    }
  };

  const handleAddLink = async (e) => {
    e.preventDefault();
    const title = linkTitle.trim();
    if (!title || linkSaving) return;
    setLinkSaving(true);
    try {
      await createMemoryItem(user.token, linkKind, { title, goalId: id, status: 'active' });
      setLinkTitle('');
      toast.success(`${linkKind === 'plan' ? 'Plan' : 'Action'} added!`);
      loadLinked();
    } catch (err) {
      if (!handleAuthError(err)) toast.error(err.message);
    } finally {
      setLinkSaving(false);
    }
  };

  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    setRunError(null);
    setRunResult(null);
    setStreaming(true);
    try {
      const gd = goal?.data || {};
      const description = [gd.title, gd.description].filter(Boolean).join('. ');
      // Reset the live feed so a re-enlist starts clean (history is preserved
      // server-side); the addon appends live steps from here on.
      try {
        await recordGoalAgentResult(user.token, id, { status: 'running', steps: [], plan: [], summary: '', result: '' });
      } catch { /* backend may predate the endpoint — non-fatal */ }
      setAgent((prev) => ({ ...(prev || {}), status: 'running', steps: [] }));
      const res = await runAgentMessage(description, { token: user.token, context: context.trim() || undefined, goalId: id });
      if (res?.actionable === false) {
        toast.info('The agent judged this goal as not actionable.');
      } else if (res?.result) {
        setRunResult(res);
        await mirrorAgentResult(res);
        toast.success('Agent finished.');
      } else {
        setRunResult(res);
        await mirrorAgentResult(res);
        toast.info(`Agent stopped${res?.status ? ` (${res.status})` : ''}.`);
      }
    } catch (err) {
      if (handleAuthError(err)) return;
      const msg = String(err?.message || '');
      // Desktop relay unavailable (addon offline, backend predating `agent_run`,
      // or a relay timeout) → fall back to the built-in server agent so the goal
      // still gets worked on.
      const relayUnavailable = /Invalid command type|No addon devices online|did not respond|Failed to queue command/i.test(msg);
      if (relayUnavailable) {
        try {
          await startGoalAgent(user.token, id);
          toast.info('Desktop agent not reachable — using the built-in server agent instead.');
          setRunning(true);
          setAgent((prev) => ({ ...(prev || {}), status: 'running', steps: prev?.steps || [] }));
        } catch (fb) {
          if (!handleAuthError(fb)) setRunError(fb.message);
        }
      } else {
        setRunError(msg);
      }
    } finally {
      setStarting(false);
      setStreaming(false);
    }
  };

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await stopGoalAgent(user.token, id);
      toast.info('Stopping agent…');
    } catch (err) {
      if (!handleAuthError(err)) toast.error(err.message);
    } finally {
      setStopping(false);
    }
  };

  if (!user) {
    return (
      <>
        <Header />
        <div className="goal-detail-page">
          <div className="goal-detail-shell">
            <button className="goal-detail-login" onClick={() => { dispatch(logout()); navigate('/login'); }}>
              Log in to view this goal
            </button>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  const data = goal?.data || {};
  const steps = agent?.steps || [];
  const history = agent?.history || [];
  const status = agent?.status || 'idle';
  const interrupted = !running && status === 'running';

  return (
    <>
      <Header />
      <div className="goal-detail-page">
        <div className="goal-detail-shell">
          <nav className="goal-detail-breadcrumb">
            <Link to="/plans">← Back to Plans</Link>
          </nav>

          {loading ? (
            <div className="goal-detail-loading">Loading goal…</div>
          ) : notFound ? (
            <div className="goal-detail-empty">
              <p>Goal not found.</p>
              <p className="goal-detail-empty-hint">It may have been deleted, or the link is incorrect.</p>
            </div>
          ) : loadError ? (
            <div className="goal-detail-empty">
              <p>Couldn't load this goal.</p>
              <p className="goal-detail-empty-hint">{loadError}</p>
              <button className="goal-detail-login" onClick={load}>Try again</button>
            </div>
          ) : (
            <>
              {/* Header card */}
              <section className="goal-detail-hero">
                <div className="goal-detail-title-row">
                  <h1 className="goal-detail-title">{data.title || 'Untitled goal'}</h1>
                  <span className={`goal-detail-status status-${data.status || 'active'}`}>
                    {STATUS_LABELS[data.status] || data.status}
                  </span>
                </div>
                {data.description && <p className="goal-detail-desc">{data.description}</p>}
                <div className="goal-detail-meta">
                  {data.priority && (
                    <span className={`goal-detail-badge priority-${data.priority}`}>
                      {PRIORITY_LABELS[data.priority] || data.priority} priority
                    </span>
                  )}
                  {data.deadline && <span className="goal-detail-badge">📅 {data.deadline}</span>}
                  <span className="goal-detail-badge">🤖 agent: {status}</span>
                </div>

                <label style={{ display: 'block', marginTop: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>🧭 Scope / instructions for the agent (optional)</span>
                  <textarea
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid var(--border, #ddd)', font: 'inherit', resize: 'vertical' }}
                    placeholder="e.g. Only touch files under ~/projects/foo, don't delete anything, and report a summary when done."
                  />
                </label>

                <div className="goal-detail-actions">
                  {running ? (
                    <button className="goal-detail-btn goal-detail-btn--stop" onClick={handleStop} disabled={stopping}>
                      {stopping ? 'Stopping…' : '⏹ Stop agent'}
                    </button>
                  ) : (
                    <button className="goal-detail-btn goal-detail-btn--start" onClick={handleStart} disabled={starting}>
                      {starting ? '🤖 Working…' : '🤖 Enlist agent'}
                    </button>
                  )}
                </div>
              </section>

              {/* Summary + result */}
              {(agent?.summary || agent?.result || (agent?.plan?.length > 0)) && (
                <section className="goal-detail-summary">
                  {agent.summary && <p className="goal-detail-summary-text">{agent.summary}</p>}
                  {agent.plan?.length > 0 && (
                    <ol className="goal-detail-plan">
                      {agent.plan.map((p, i) => <li key={`${p}-${i}`}>{p}</li>)}
                    </ol>
                  )}
                  {agent.result && (
                    <pre className="goal-detail-result">{agent.result}</pre>
                  )}
                </section>
              )}

              {/* Addon O-O-G-P-A run result */}
              {runError && (
                <section className="goal-detail-summary">
                  <p className="goal-detail-summary-text">⚠️ {runError}</p>
                </section>
              )}
              {runResult && (
                <section className="goal-detail-summary">
                  <p className="goal-detail-summary-text">
                    🤖 Agent result{runResult.steps != null ? ` (${runResult.steps} step${runResult.steps === 1 ? '' : 's'})` : ''}
                  </p>
                  {runResult.result ? (
                    <pre className="goal-detail-result">{runResult.result}</pre>
                  ) : (
                    <p className="goal-detail-summary-text">Stopped{runResult.status ? ` (${runResult.status})` : ''}.</p>
                  )}
                </section>
              )}

              {/* Progress feed */}
              <section className="goal-detail-feed-section">
                <h2 className="goal-detail-feed-title">Agent progress</h2>
                {steps.length === 0 && (
                  <p className="goal-detail-feed-empty">
                    {status === 'idle'
                      ? 'This goal hasn\'t had an agent work on it yet. Press "Enlist agent" to start.'
                      : interrupted
                        ? 'The previous run was interrupted (the server restarted). Press "Enlist agent" to try again.'
                        : 'No progress recorded yet.'}
                  </p>
                )}
                <div className="goal-detail-feed" ref={feedRef}>
                  {steps.map((step, i) => {
                    const meta = STEP_META[step.kind] || STEP_META.tool;
                    const isToolCall = step.kind === 'tool';
                    return (
                      <div key={`${step.ts}-${i}`} className={`goal-detail-step step-${step.kind}`}>
                        <div className="goal-detail-step-head">
                          <span className="goal-detail-step-icon" aria-hidden="true">{meta.icon}</span>
                          <span className="goal-detail-step-label">{meta.label}</span>
                          <span className="goal-detail-step-time">{timeLabel(step.ts)}</span>
                        </div>
                        <div className="goal-detail-step-text">
                          {step.text}
                        </div>
                        {isToolCall && step.meta?.args && Object.keys(step.meta.args).length > 0 && (
                          <pre className="goal-detail-step-args">{JSON.stringify(step.meta.args, null, 2)}</pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Past runs */}
              {history.length > 0 && (
                <section className="goal-detail-feed-section">
                  <h2 className="goal-detail-feed-title">Past runs</h2>
                  <div className="goal-detail-history">
                    {history.map((run, ri) => (
                      <details key={`${run.startedAt}-${ri}`} className="goal-detail-history-run">
                        <summary>
                          <span className={`goal-detail-history-status status-${run.status || 'done'}`}>
                            ● {RUN_STATUS_LABELS[run.status] || run.status}
                          </span>
                          <span className="goal-detail-history-time">
                            {timeLabel(run.startedAt)}{run.updatedAt ? ` → ${timeLabel(run.updatedAt)}` : ''}
                          </span>
                          <span className="goal-detail-history-count">{(run.steps?.length || 0)} steps</span>
                        </summary>
                        {run.summary && <p className="goal-detail-summary-text">{run.summary}</p>}
                        {run.result && <pre className="goal-detail-result">{run.result}</pre>}
                        {(run.steps?.length > 0) && (
                          <div className="goal-detail-feed">
                            {run.steps.map((step, si) => {
                              const meta = STEP_META[step.kind] || STEP_META.tool;
                              return (
                                <div key={`${step.ts}-${si}`} className={`goal-detail-step step-${step.kind}`}>
                                  <div className="goal-detail-step-head">
                                    <span className="goal-detail-step-icon" aria-hidden="true">{meta.icon}</span>
                                    <span className="goal-detail-step-label">{meta.label}</span>
                                    <span className="goal-detail-step-time">{timeLabel(step.ts)}</span>
                                  </div>
                                  <div className="goal-detail-step-text">{step.text}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                </section>
              )}

              {/* Linked plans & actions (goal → plan → action lineage) */}
              <section className="goal-detail-feed-section">
                <h2 className="goal-detail-feed-title">Plan &amp; actions</h2>
                {linkedLoading ? (
                  <p className="goal-detail-feed-empty">Loading linked items…</p>
                ) : linked.length === 0 ? (
                  <p className="goal-detail-feed-empty">No plans or actions linked to this goal yet. Add one below to break the goal into steps.</p>
                ) : (
                  <ul className="goal-detail-linked">
                    {linked.map((it) => (
                      <li key={it._id} className="goal-detail-linked-item">
                        <span className={`goal-detail-linked-kind goal-detail-linked-${it.type}`}>
                          {it.type === 'plan' ? '📋 Plan' : '⚡ Action'}
                        </span>
                        <span className="goal-detail-linked-title">{it.data?.title}</span>
                        {it.data?.status && (
                          <span className="goal-detail-linked-status">{it.data.status}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <form className="goal-detail-link-form" onSubmit={handleAddLink}>
                  <select value={linkKind} onChange={(e) => setLinkKind(e.target.value)} aria-label="Item type">
                    <option value="plan">Plan</option>
                    <option value="action">Action</option>
                  </select>
                  <input
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    placeholder={linkKind === 'plan' ? 'Add a plan step…' : 'Add an action…'}
                    maxLength={200}
                  />
                  <button type="submit" disabled={linkSaving || !linkTitle.trim()}>
                    {linkSaving ? 'Adding…' : 'Add'}
                  </button>
                </form>
              </section>
            </>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}

export default GoalDetail;
