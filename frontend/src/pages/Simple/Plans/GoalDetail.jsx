import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import { toast } from 'react-toastify';
import { logout } from '../../../features/data/dataSlice.js';
import { fetchMemoryItem } from '../../../services/memoryApi.js';
import { startGoalAgent, getGoalAgentStatus, stopGoalAgent } from '../../../services/goalAgentApi.js';
import './GoalDetail.css';

const STATUS_LABELS = {
  active: 'Active',
  completed: 'Done',
  paused: 'Paused',
};

const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

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
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notFound, setNotFound] = useState(false);

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
    } catch (err) {
      if (handleAuthError(err)) return;
      setNotFound(true);
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

  // Auto-scroll the feed to the bottom as new steps arrive
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [agent?.steps?.length]);

  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await startGoalAgent(user.token, id);
      toast.success('Agent enlisted — working on it now!');
      setRunning(true);
      setAgent((prev) => ({ ...(prev || {}), status: 'running', steps: prev?.steps || [] }));
    } catch (err) {
      if (!handleAuthError(err)) toast.error(err.message);
    } finally {
      setStarting(false);
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

                <div className="goal-detail-actions">
                  {running ? (
                    <button className="goal-detail-btn goal-detail-btn--stop" onClick={handleStop} disabled={stopping}>
                      {stopping ? 'Stopping…' : '⏹ Stop agent'}
                    </button>
                  ) : (
                    <button className="goal-detail-btn goal-detail-btn--start" onClick={handleStart} disabled={starting}>
                      {starting ? 'Enlisting…' : '🤖 Enlist agent'}
                    </button>
                  )}
                </div>
              </section>

              {/* Summary + result */}
              {(agent?.summary || agent?.result) && (
                <section className="goal-detail-summary">
                  {agent.summary && <p className="goal-detail-summary-text">{agent.summary}</p>}
                  {agent.result && (
                    <pre className="goal-detail-result">{agent.result}</pre>
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
            </>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}

export default GoalDetail;
