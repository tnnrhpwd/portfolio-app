import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import dataService from "../../features/data/dataService.js";
import { closeBugReport } from "../../features/data/dataSlice";
import { enlistAgentForBug, getGoalAgentStatus } from "../../services/goalAgentApi.js";
import { formatTimestamp } from "./adminShared";
import { toast } from "react-toastify";

// Compact inline feed showing the live state of an enlisted agent run.
function AgentRunFeed({ run }) {
  const agent = run?.agent || {};
  const status = agent.status || (run?.running ? "running" : "idle");
  const steps = (agent.steps || []).slice(-5);

  const statusLabel = {
    running: ["🤖 Agent working…", "agent-run-status--running"],
    done: [`✅ Agent finished${agent.summary ? `: ${agent.summary}` : ""}`, "agent-run-status--done"],
    failed: [`❌ Agent failed${agent.error ? `: ${agent.error}` : ""}`, "agent-run-status--failed"],
    stopped: ["⏹ Agent stopped", "agent-run-status--failed"],
    idle: ["🤖 Agent enlisted", "agent-run-status--running"],
  }[status] || ["🤖 Agent working…", "agent-run-status--running"];

  return (
    <div className="agent-run-feed">
      <span className={`agent-run-status ${statusLabel[1]}`}>{statusLabel[0]}</span>
      {steps.map((s, i) => (
        <div key={i} className={`agent-step agent-step--${s.kind || "thought"}`} title={s.ts}>
          {s.text}
        </div>
      ))}
    </div>
  );
}

function Bugs() {
  const { user } = useSelector((state) => state.data);
  const dispatch = useDispatch();

  // ── Autonomous agent fix runs (bugId → run state) ──
  const [agentRuns, setAgentRuns] = useState({});
  const [enlistingBugId, setEnlistingBugId] = useState(null);

  // ── All data for bug reports ──
  const [allData, setAllData] = useState(null);
  const [allDataLoading, setAllDataLoading] = useState(false);

  // ── Bug report modal ──
  const [closingBugId, setClosingBugId] = useState(null);
  const [resolutionText, setResolutionText] = useState("");
  const [showResolutionModal, setShowResolutionModal] = useState(false);

  // ═══════════════ Fetch all data ═══════════════
  const fetchAllData = useCallback(async (force = false) => {
    if (!user?.token || (allData && !force)) return;
    setAllDataLoading(true);
    try {
      const data = await dataService.getAllData(user.token);
      setAllData(data);
    } catch { /* handled by service */ }
    finally { setAllDataLoading(false); }
  }, [user, allData]);

  useEffect(() => {
    fetchAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══════════════ Close modal on Escape ═══════════════
  useEffect(() => {
    if (!showResolutionModal) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowResolutionModal(false);
        setResolutionText("");
        setClosingBugId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showResolutionModal]);

  // ═══════════════ Derived bug reports from allData ═══════════════
  const bugReports = useMemo(() => {
    if (!allData) return [];
    return allData
      .filter(item => item.text?.includes('Bug:') && item.text?.includes('Status:') && item.text?.includes('Creator:'))
      .map(item => {
        const parts = {};
        (item.text || '').split('|').forEach(p => {
          const [k, ...v] = p.split(':');
          if (k && v.length) parts[k.toLowerCase()] = v.join(':');
        });
        return {
          id: item.id || item._id,
          title: parts.bug || 'Untitled',
          status: parts.status || 'Open',
          creator: parts.creator || 'Unknown',
          description: parts.description || '',
          resolution: parts.resolution || '',
          resolvedby: parts.resolvedby || '',
          resolvedat: parts.resolvedat || '',
          createdAt: item.createdAt,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [allData]);

  // ═══════════════ Bug report actions ═══════════════
  const handleCloseBugReport = useCallback(async (reportId) => {
    if (!resolutionText.trim()) {
      toast.error('Enter a resolution description first.');
      return;
    }
    try {
      await dispatch(closeBugReport({ reportId, resolutionText })).unwrap();
      toast.success('Bug report closed.');
      setShowResolutionModal(false);
      setResolutionText('');
      setClosingBugId(null);
      await fetchAllData(true);
    } catch {
      toast.error('Failed to close bug report.');
    }
  }, [dispatch, resolutionText, fetchAllData]);

  // ═══════════════ Enlist agent to fix a bug report ═══════════════
  const handleEnlistAgent = useCallback(async (report) => {
    if (!user?.token || enlistingBugId) return;
    setEnlistingBugId(report.id);
    try {
      const res = await enlistAgentForBug(user.token, report.id);
      setAgentRuns((prev) => ({
        ...prev,
        [report.id]: { goalId: res.goalId, running: true, agent: { status: 'running', steps: [] } },
      }));
      toast.success('Agent enlisted — it will fix the bug and commit the change.');
    } catch (err) {
      toast.error(err.message || 'Failed to enlist agent.');
    } finally {
      setEnlistingBugId(null);
    }
  }, [user, enlistingBugId]);

  // ── Poll live agent runs until they finish ──
  const activeAgentKey = useMemo(() => {
    return Object.entries(agentRuns)
      .filter(([, r]) => r.running && r.goalId)
      .map(([bugId, r]) => `${bugId}:${r.goalId}`)
      .sort()
      .join('|');
  }, [agentRuns]);

  useEffect(() => {
    if (!activeAgentKey || !user?.token) return undefined;
    const entries = activeAgentKey.split('|').map((s) => {
      const idx = s.lastIndexOf(':');
      return { bugId: s.slice(0, idx), goalId: s.slice(idx + 1) };
    });
    let cancelled = false;

    const poll = async () => {
      await Promise.all(entries.map(async ({ bugId, goalId }) => {
        try {
          const res = await getGoalAgentStatus(user.token, goalId);
          if (cancelled) return;
          setAgentRuns((prev) => {
            const cur = prev[bugId];
            if (!cur) return prev;
            return { ...prev, [bugId]: { ...cur, running: !!res.running, agent: res.agent || cur.agent } };
          });
        } catch { /* transient — retry next tick */ }
      }));
    };

    poll();
    const timer = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeAgentKey, user?.token]);

  const ts = formatTimestamp;

  return (
    <section className="admin-section-tile">
      <h2>Bug Reports</h2>

      {allDataLoading && <div className="admin-loading">Loading...</div>}
      {!allDataLoading && bugReports.length > 0 ? (
        <table className="admin-table compact-table">
          <thead><tr>
            <th>Title</th><th>Status</th><th>Reporter</th><th>Description</th><th>Date</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {bugReports.map(report => (
              <tr key={report.id}>
                <td>
                  <strong>{report.title}</strong>
                  {agentRuns[report.id] && <AgentRunFeed run={agentRuns[report.id]} />}
                  {report.resolution && (
                    <div className="report-resolution">
                      <strong>Resolution:</strong> {report.resolution}
                      <br /><small>Resolved by {report.resolvedby}{report.resolvedat && ` on ${new Date(report.resolvedat).toLocaleDateString()}`}</small>
                    </div>
                  )}
                </td>
                <td><span className={`status-badge status-${report.status.toLowerCase()}`}>{report.status === 'Open' ? '🔓 Open' : '🔒 Closed'}</span></td>
                <td>{report.creator}</td>
                <td>{report.description.length > 100 ? report.description.substring(0, 100) + '...' : report.description}</td>
                <td>{ts(report.createdAt)}</td>
                <td>
                  <div className="bug-actions">
                    {report.status === 'Open' && (
                      <button
                        className="btn-agent-fix"
                        onClick={() => handleEnlistAgent(report)}
                        disabled={enlistingBugId === report.id || !!agentRuns[report.id]?.running}
                        title="Enlist an LLM agent to autonomously fix this bug and commit the change"
                      >
                        {agentRuns[report.id]?.running
                          ? '🤖 Fixing…'
                          : enlistingBugId === report.id
                            ? '🤖 Enlisting…'
                            : '🤖 Auto-fix'}
                      </button>
                    )}
                    {report.status === 'Open' ? (
                      <button className="btn-close-report" onClick={() => { setClosingBugId(report.id); setShowResolutionModal(true); setResolutionText(''); }}>
                        ✅ Close
                      </button>
                    ) : (
                      <span className="muted">Resolved</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        !allDataLoading && <p className="admin-no-data">No bug reports found</p>
      )}

      {/* Resolution Modal */}
      {showResolutionModal && (
        <div className="admin-modal-overlay" onClick={() => { setShowResolutionModal(false); setResolutionText(''); setClosingBugId(null); }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>Close Bug Report</h3>
              <button className="admin-modal-close" onClick={() => { setShowResolutionModal(false); setResolutionText(''); setClosingBugId(null); }}>✕</button>
            </div>
            <div className="admin-modal-content">
              <label htmlFor="resolutionText">Resolution Description:</label>
              <textarea
                id="resolutionText"
                value={resolutionText}
                onChange={(e) => setResolutionText(e.target.value)}
                placeholder="Describe how this bug was resolved..."
                rows="4"
                maxLength="500"
              />
              <small className="admin-char-count">{resolutionText.length}/500</small>
            </div>
            <div className="admin-modal-actions">
              <button className="admin-modal-cancel" onClick={() => { setShowResolutionModal(false); setResolutionText(''); setClosingBugId(null); }}>Cancel</button>
              <button className="admin-modal-confirm" onClick={() => handleCloseBugReport(closingBugId)} disabled={!resolutionText.trim()}>Close Report</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default Bugs;
