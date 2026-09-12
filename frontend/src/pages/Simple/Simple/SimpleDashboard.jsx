import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  getAgentStatus,
  startAgent,
  stopAgent,
  getAgentListener,
  setAgentListener,
  getAgentProposals,
  acceptAgentProposal,
  getPendingApprovals,
  resolveApproval,
  getAutomationPermissions,
  setAutoApproveAll,
  activateKillSwitch,
  deactivateKillSwitch,
  getAutomationSuggestions,
  getPerceptionFrame,
  runAgentMessage,
  runSkill,
  compileNaturalMacro,
  saveSkill,
  listWorkspace,
  upsertWorkspaceItem,
  getRecorderStatus,
  startRecording,
  stopRecording,
  listRecordings,
  deleteRecording,
  listWorkspaceProfiles,
  saveWorkspaceProfile,
  restoreWorkspaceProfile,
  deleteWorkspaceProfile,
  getVoiceStatus,
  voiceListen,
  voiceSpeak,
  startWakewordLoop,
  stopWakewordLoop,
  getEyeTrackingStatus,
  startEyeTracking,
  stopEyeTracking,
  calibrateEyeTracking,
} from '../../../services/simpleAddonApi';
import { useAddonDetection } from '../../../hooks/simpleAddon/useAddonDetection';
import AgentModes from '../../../components/Simple/AgentModes/AgentModes.jsx';
import './SimpleDashboard.css';

/**
 * SimpleDashboard — the live half of /simple.
 *
 * This is a **service page**, and service pages are workspaces, not stories
 * (FRONTEND_UI_STANDARD.md §5.7): one flat surface, a sticky toolbar carrying
 * the room's name + live state + the primary action, then a dense grid of
 * panels ordered by how often you touch them. No bands, no gradient behind the
 * data, no scroll reveals — scrolling is the cost we're minimising.
 *
 *   row 1  how far it may go (the mode ladder + kill switch) · the live loop
 *   row 2  run an instruction · record a task
 *   row 3  goals · macros
 *   row 4  proposed goals · lessons · suggestions
 *   then   advanced plumbing (folded away) and a two-link hand-off
 *
 * Permissions are not duplicated: the mode ladder sets listener/auto-approve
 * (it *is* those two), so they only reappear as raw switches under Advanced.
 * The kill switch stays its own control because it overrides every mode.
 *
 * Goals/macros live in the cloud workspace (need login). Agent status and macro
 * runs need the local Simple addon. Everything degrades to a clear hint.
 */

const GOAL_STATUS_META = {
  active:    { label: 'Active',    cls: 'active' },
  paused:    { label: 'Paused',    cls: 'paused' },
  completed: { label: 'Done',      cls: 'done' },
  blocked:   { label: 'Blocked',   cls: 'blocked' },
  done:      { label: 'Done',      cls: 'done' },
  failed:    { label: 'Failed',    cls: 'failed' },
};

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'nl-macro';
}

function lessonText(item) {
  let c = item?.content;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { c = null; } }
  if (c && typeof c === 'object') return c.pattern || c.do || c.context || item.name || item.slug;
  return item?.name || item?.slug || 'lesson';
}

function Toggle({ label, checked, onChange, disabled, danger }) {
  return (
    <button
      type="button"
      className={`sd-toggle${checked ? ' is-on' : ''}${danger ? ' sd-toggle--danger' : ''}`}
      onClick={onChange}
      disabled={disabled}
      aria-pressed={checked}
    >
      <span className="sd-toggle-dot" aria-hidden="true" />
      <span className="sd-toggle-label">{label}</span>
    </button>
  );
}

export default function SimpleDashboard() {
  const user = useSelector((state) => state.data?.user);
  const token = user?.token;
  const { isConnected, showInstallPrompt, recheckAddon, addonStatus } = useAddonDetection();

  // ── Agent + permissions ──────────────────────────────────────────────────
  const [agent, setAgent] = useState(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [perms, setPerms] = useState({ autoApproveAll: false, globalKillSwitch: false, continuousMode: false });
  const [approvals, setApprovals] = useState([]);

  // ── Goals ────────────────────────────────────────────────────────────────
  const [goals, setGoals] = useState([]);
  const [goalsLoading, setGoalsLoading] = useState(false);

  // ── Macros ───────────────────────────────────────────────────────────────
  const [macros, setMacros] = useState([]);
  const [macrosLoading, setMacrosLoading] = useState(false);
  const [runningSlug, setRunningSlug] = useState(null);
  const [runResult, setRunResult] = useState(null);

  // ── Proposals / lessons / suggestions ────────────────────────────────────
  const [proposals, setProposals] = useState([]);
  const [acceptingId, setAcceptingId] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [suggestions, setSuggestions] = useState([]);

  // ── Perception ───────────────────────────────────────────────────────────
  const [perception, setPerception] = useState(null);

  // ── Mini chat control ────────────────────────────────────────────────────
  const [instruction, setInstruction] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatResult, setChatResult] = useState(null);
  const [chatError, setChatError] = useState(null);

  // ── NL macro compiler ────────────────────────────────────────────────────
  const [nlText, setNlText] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [nlStatus, setNlStatus] = useState(null);
  const [nlError, setNlError] = useState(null);

  // ── Recorder ─────────────────────────────────────────────────────────────
  const [recorder, setRecorder] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [recName, setRecName] = useState('');
  const [recBusy, setRecBusy] = useState(false);

  // ── Workspace profiles ───────────────────────────────────────────────────
  const [profiles, setProfiles] = useState([]);
  const [profileName, setProfileName] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);

  // ── Voice ────────────────────────────────────────────────────────────────
  const [voice, setVoice] = useState(null);
  const [speakText, setSpeakText] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceResult, setVoiceResult] = useState(null);

  // ── Eye tracking ─────────────────────────────────────────────────────────
  const [eye, setEye] = useState(null);
  const [eyeBusy, setEyeBusy] = useState(false);

  const [panelError, setPanelError] = useState(null);
  const [modesBusy, setModesBusy] = useState(false);

  /**
   * Apply one of the four trust modes by driving the two permissions that
   * actually back it (listener + auto-approve). Deliberately sequential so a
   * partial failure can't leave the agent in a state the UI doesn't describe.
   */
  const applyMode = useCallback(async ({ continuousMode, autoApproveAll }) => {
    setModesBusy(true);
    setPanelError(null);
    try {
      if (!!autoApproveAll !== !!perms.autoApproveAll) {
        const cfg = await setAutoApproveAll(!!autoApproveAll);
        setPerms((p) => ({ ...p, autoApproveAll: !!cfg?.autoApproveAll }));
      }
      if (!!continuousMode !== !!perms.continuousMode) {
        const s = await setAgentListener(!!continuousMode);
        setPerms((p) => ({ ...p, continuousMode: !!s?.enabled }));
      }
    } catch (e) {
      setPanelError(e.message || 'Could not change the agent mode');
    } finally {
      setModesBusy(false);
    }
  }, [perms.autoApproveAll, perms.continuousMode]);

  // ── Loaders ──────────────────────────────────────────────────────────────
  const loadAgent = useCallback(async () => {
    if (!isConnected) { setAgent(null); return; }
    try { setAgent(await getAgentStatus()); } catch { /* keep last known */ }
  }, [isConnected]);

  const loadPerms = useCallback(async () => {
    if (!isConnected) { setPerms({ autoApproveAll: false, globalKillSwitch: false, continuousMode: false }); setApprovals([]); return; }
    try {
      const [p, ap] = await Promise.all([
        getAutomationPermissions().catch(() => null),
        getPendingApprovals().catch(() => ({ approvals: [] })),
      ]);
      if (p) setPerms({
        autoApproveAll: !!p.autoApproveAll,
        globalKillSwitch: !!p.globalKillSwitch,
        continuousMode: !!p.continuousMode,
      });
      if (ap?.approvals) setApprovals(ap.approvals);
    } catch { /* best-effort */ }
  }, [isConnected]);

  const loadProposals = useCallback(async () => {
    if (!isConnected) { setProposals([]); return; }
    try {
      const d = await getAgentProposals();
      setProposals(d?.proposals || (Array.isArray(d) ? d : []));
    } catch { setProposals([]); }
  }, [isConnected]);

  const loadSuggestions = useCallback(async () => {
    if (!isConnected) { setSuggestions([]); return; }
    try {
      const d = await getAutomationSuggestions();
      setSuggestions(d?.suggestions || []);
    } catch { setSuggestions([]); }
  }, [isConnected]);

  const loadPerception = useCallback(async () => {
    if (!isConnected) { setPerception(null); return; }
    try {
      const d = await getPerceptionFrame();
      if (d?.context) setPerception(d);
      else if (d?.frame) setPerception({ context: String(d.frame.window || 'No window data').slice(0, 200) });
    } catch { /* keep last known */ }
  }, [isConnected]);

  const loadGoals = useCallback(async () => {
    if (!token) { setGoals([]); return; }
    setGoalsLoading(true);
    try {
      const list = await listWorkspace(token, { kind: 'goal' });
      const items = Array.isArray(list?.entries) ? list.entries : (Array.isArray(list) ? list : []);
      const order = { active: 0, paused: 1, blocked: 2, failed: 3, done: 4 };
      items.sort((a, b) => {
        const ra = order[a.status] ?? 2;
        const rb = order[b.status] ?? 2;
        if (ra !== rb) return ra - rb;
        return (b.priority ?? 50) - (a.priority ?? 50);
      });
      setGoals(items);
    } catch (e) {
      setPanelError(e.message || 'Failed to load goals');
    } finally {
      setGoalsLoading(false);
    }
  }, [token]);

  const loadMacros = useCallback(async () => {
    if (!token) { setMacros([]); return; }
    setMacrosLoading(true);
    try {
      const list = await listWorkspace(token, { kind: 'skill' });
      setMacros(list?.entries || list?.items || []);
    } catch (e) {
      setPanelError(e.message || 'Failed to load macros');
    } finally {
      setMacrosLoading(false);
    }
  }, [token]);

  const loadLessons = useCallback(async () => {
    if (!token) { setLessons([]); return; }
    try {
      const list = await listWorkspace(token, { kind: 'lesson' });
      setLessons(list?.entries || list?.items || []);
    } catch { setLessons([]); }
  }, [token]);

  const loadRecorder = useCallback(async () => {
    if (!isConnected) { setRecorder(null); setRecordings([]); return; }
    try {
      const [s, l] = await Promise.all([
        getRecorderStatus().catch(() => null),
        listRecordings().catch(() => []),
      ]);
      setRecorder(s);
      setRecordings(Array.isArray(l) ? l : (l?.recordings || []));
    } catch { /* best-effort */ }
  }, [isConnected]);

  const loadProfiles = useCallback(async () => {
    if (!isConnected) { setProfiles([]); return; }
    try {
      const d = await listWorkspaceProfiles();
      setProfiles(Array.isArray(d) ? d : (d?.profiles || []));
    } catch { setProfiles([]); }
  }, [isConnected]);

  const loadVoice = useCallback(async () => {
    if (!isConnected) { setVoice(null); return; }
    try { setVoice(await getVoiceStatus()); } catch { setVoice(null); }
  }, [isConnected]);

  const loadEye = useCallback(async () => {
    if (!isConnected) { setEye(null); return; }
    try { setEye(await getEyeTrackingStatus()); } catch { setEye(null); }
  }, [isConnected]);

  const refreshAll = useCallback(() => {
    setPanelError(null);
    loadAgent();
    loadPerms();
    loadProposals();
    loadSuggestions();
    loadPerception();
    loadGoals();
    loadMacros();
    loadLessons();
    loadRecorder();
    loadProfiles();
    loadVoice();
    loadEye();
  }, [loadAgent, loadPerms, loadProposals, loadSuggestions, loadPerception, loadGoals, loadMacros, loadLessons, loadRecorder, loadProfiles, loadVoice, loadEye]);

  useEffect(() => { loadAgent(); loadPerms(); loadProposals(); loadSuggestions(); loadPerception(); }, [loadAgent, loadPerms, loadProposals, loadSuggestions, loadPerception]);
  useEffect(() => { loadGoals(); }, [loadGoals]);
  useEffect(() => { loadMacros(); }, [loadMacros]);
  useEffect(() => { loadLessons(); }, [loadLessons]);
  useEffect(() => { loadRecorder(); loadProfiles(); loadVoice(); loadEye(); }, [loadRecorder, loadProfiles, loadVoice, loadEye]);

  // Poll agent + approvals + perception while connected (the loop moves fast).
  useEffect(() => {
    if (!isConnected) return;
    const id = setInterval(() => { loadAgent(); loadPerms(); loadPerception(); }, 4000);
    return () => clearInterval(id);
  }, [isConnected, loadAgent, loadPerms, loadPerception]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const onStart = async () => {
    setAgentBusy(true); setPanelError(null);
    try {
      const r = await startAgent({});
      setAgent((s) => ({ ...(s || {}), ...r, running: true }));
    } catch (e) { setPanelError(e.message || 'Failed to start agent'); }
    finally { setAgentBusy(false); }
  };

  const onStop = async () => {
    setAgentBusy(true); setPanelError(null);
    try {
      await stopAgent();
      setAgent((s) => (s ? { ...s, running: false } : s));
    } catch (e) { setPanelError(e.message || 'Failed to stop agent'); }
    finally { setAgentBusy(false); }
  };

  const onRunMacro = async (slug) => {
    if (!isConnected || runningSlug) return;
    setRunningSlug(slug);
    setRunResult(null);
    try {
      const out = await runSkill(slug);
      if (out?.error) throw new Error(out.error);
      setRunResult({ slug, ok: !out?.result?.failed });
    } catch {
      setRunResult({ slug, ok: false });
    } finally {
      setRunningSlug(null);
      setTimeout(() => setRunResult((r) => (r?.slug === slug ? null : r)), 2500);
    }
  };

  const onSendInstruction = async () => {
    const text = instruction.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    setChatError(null);
    setChatResult(null);
    try {
      const r = await runAgentMessage(text, { token });
      if (r?.actionable === false) {
        setChatResult({ text: r.reason || 'That reads more like a chat question — try the full chat on /net.', nonActionable: true });
      } else {
        setChatResult({ text: r?.result || `Done (${r?.steps ?? 0} steps).`, nonActionable: false });
      }
      setInstruction('');
    } catch (e) {
      setChatError(e.message || 'Could not run that instruction');
    } finally {
      setChatBusy(false);
    }
  };

  const onToggleKill = async () => {
    setPanelError(null);
    try {
      if (perms.globalKillSwitch) { await deactivateKillSwitch(); setPerms((p) => ({ ...p, globalKillSwitch: false })); }
      else { await activateKillSwitch(); setPerms((p) => ({ ...p, globalKillSwitch: true })); setAgent((s) => (s ? { ...s, running: false } : s)); }
    } catch (e) { setPanelError(e.message || 'Kill switch failed'); }
  };

  const onToggleAutoApprove = async (next) => {
    setPanelError(null);
    try {
      const cfg = await setAutoApproveAll(next);
      setPerms((p) => ({ ...p, autoApproveAll: !!cfg?.autoApproveAll }));
    } catch (e) { setPanelError(e.message || 'Auto-approve failed'); }
  };

  const onToggleListener = async (next) => {
    setPanelError(null);
    try {
      const s = await setAgentListener(next);
      setPerms((p) => ({ ...p, continuousMode: !!s?.enabled }));
    } catch (e) { setPanelError(e.message || 'Listener failed'); }
  };

  const onApprove = async (id, approved) => {
    setPanelError(null);
    try {
      await resolveApproval(id, approved);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (e) { setPanelError(e.message || 'Approval failed'); }
  };

  const onAcceptProposal = async (id) => {
    setAcceptingId(id); setPanelError(null);
    try {
      await acceptAgentProposal(id);
      setProposals((prev) => prev.filter((p) => p.id !== id));
      loadGoals();
    } catch (e) { setPanelError(e.message || 'Accept failed'); }
    finally { setAcceptingId(null); }
  };

  const onCompileNl = async () => {
    const text = nlText.trim();
    if (!text || nlBusy) return;
    setNlBusy(true); setNlError(null); setNlStatus(null);
    try {
      const result = await compileNaturalMacro(text);
      const steps = result?.steps || [];
      const name = text.slice(0, 40).replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'nl-macro';
      const slug = slugify(name);
      const skill = { slug, name, description: text.slice(0, 200), steps, metadata: { source: 'nl-compiler' } };
      if (token) {
        await upsertWorkspaceItem(token, 'skill', slug, { name, content: JSON.stringify(skill), tags: ['nl-compiled'] });
      }
      try { await saveSkill(skill); } catch { /* local cache best-effort */ }
      setNlStatus(`Saved "${name}" (${steps.length} steps)`);
      setNlText('');
      loadMacros();
    } catch (e) {
      setNlError(e.message || 'Compile failed');
    } finally {
      setNlBusy(false);
    }
  };

  // ── Recorder actions ─────────────────────────────────────────────────────
  const onStartRecording = async () => {
    setRecBusy(true); setPanelError(null);
    try {
      await startRecording(recName.trim() || 'macro');
      setRecName('');
      loadRecorder();
    } catch (e) { setPanelError(e.message || 'Failed to start recording'); }
    finally { setRecBusy(false); }
  };

  const onStopRecording = async () => {
    setRecBusy(true); setPanelError(null);
    try {
      await stopRecording();
      loadRecorder();
      loadMacros();
    } catch (e) { setPanelError(e.message || 'Failed to stop recording'); }
    finally { setRecBusy(false); }
  };

  const onDeleteRecording = async (sessionId) => {
    setPanelError(null);
    try {
      await deleteRecording(sessionId);
      loadRecorder();
    } catch (e) { setPanelError(e.message || 'Delete failed'); }
  };

  // ── Workspace profile actions ────────────────────────────────────────────
  const onSaveProfile = async () => {
    if (!profileName.trim()) return;
    setProfileBusy(true); setPanelError(null);
    try {
      await saveWorkspaceProfile(profileName.trim());
      setProfileName('');
      loadProfiles();
    } catch (e) { setPanelError(e.message || 'Save profile failed'); }
    finally { setProfileBusy(false); }
  };

  const onRestoreProfile = async (name) => {
    setPanelError(null);
    try { await restoreWorkspaceProfile(name); } catch (e) { setPanelError(e.message || 'Restore failed'); }
  };

  const onDeleteProfile = async (name) => {
    setPanelError(null);
    try { await deleteWorkspaceProfile(name); loadProfiles(); } catch (e) { setPanelError(e.message || 'Delete failed'); }
  };

  // ── Voice actions ────────────────────────────────────────────────────────
  const onToggleWakeword = async () => {
    setVoiceBusy(true); setPanelError(null);
    try {
      if (voice?.wakewordLoop) { await stopWakewordLoop(); }
      else { await startWakewordLoop(); }
      loadVoice();
    } catch (e) { setPanelError(e.message || 'Wakeword failed'); }
    finally { setVoiceBusy(false); }
  };

  const onListen = async () => {
    setVoiceBusy(true); setPanelError(null); setVoiceResult(null);
    try {
      const r = await voiceListen();
      setVoiceResult(r?.text || '(no speech heard)');
    } catch (e) { setPanelError(e.message || 'Listen failed'); }
    finally { setVoiceBusy(false); }
  };

  const onSpeak = async () => {
    const text = speakText.trim();
    if (!text) return;
    setVoiceBusy(true); setPanelError(null);
    try { await voiceSpeak(text); setSpeakText(''); } catch (e) { setPanelError(e.message || 'Speak failed'); }
    finally { setVoiceBusy(false); }
  };

  // ── Eye tracking actions ─────────────────────────────────────────────────
  const onEyeToggle = async () => {
    setEyeBusy(true); setPanelError(null);
    try {
      if (eye?.active) { await stopEyeTracking(); }
      else { await startEyeTracking({}); }
      loadEye();
    } catch (e) { setPanelError(e.message || 'Eye tracking failed'); }
    finally { setEyeBusy(false); }
  };

  const onEyeCalibrate = async () => {
    setEyeBusy(true); setPanelError(null);
    try { await calibrateEyeTracking(); } catch (e) { setPanelError(e.message || 'Calibrate failed'); }
    finally { setEyeBusy(false); }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const activeGoals = goals.filter((g) => (g.status || 'active') === 'active');
  const followUpGoals = goals.filter((g) => g.status === 'paused');
  const completedGoals = goals.filter((g) => g.status === 'done' || g.status === 'completed').length;
  const isRunning = !!agent?.running;

  return (
    <div className="sd">
      {/* ── The toolbar — this page's "hero", collapsed onto one sticky row ──
          Name, live state, primary actions. §5.7 */}
      <header className="sd-bar">
        <h1 className="sd-bar-title">Control</h1>

        <span className="sd-status">
          <span className={`sd-status-dot ${isConnected ? 'is-on' : ''}`} aria-hidden="true" />
          {isConnected
            ? `Addon online${addonStatus?.version ? ` · v${addonStatus.version}` : ''}`
            : 'Addon not connected'}
        </span>

        {isConnected && (
          <span className="sd-readout">
            <span className="sd-chip">Loop <strong>{agent?.loop || 'idle'}</strong></span>
            <span className="sd-chip">Stage <strong>{agent?.stage || '—'}</strong></span>
            <span className="sd-chip">Step <strong>{agent?.step ?? '—'}</strong></span>
            {isRunning && <span className="sd-chip sd-chip--run">Running</span>}
            {perms.globalKillSwitch && <span className="sd-chip sd-chip--danger">⛔ Stopped</span>}
          </span>
        )}

        <div className="sd-bar-actions">
          <button className="sd-btn sd-btn--muted" onClick={refreshAll}>↻ Refresh</button>
          {!isConnected && (
            <button className="sd-btn sd-btn--muted" onClick={recheckAddon}>Re-check addon</button>
          )}
          {isConnected && (
            isRunning
              ? <button className="sd-btn sd-btn--danger" onClick={onStop} disabled={agentBusy}>■ Stop</button>
              : <button className="sd-btn" onClick={onStart} disabled={agentBusy}>▶ Start loop</button>
          )}
        </div>
      </header>

      {panelError && (
        <div className="sd-banner sd-banner--err" onClick={() => setPanelError(null)}>
          {panelError} <span>✕</span>
        </div>
      )}

      {showInstallPrompt && (
        <div className="sd-banner sd-banner--cta">
          <span>
            The live controls need the <strong>Simple addon</strong> running on this PC.
          </span>
          <a className="sd-btn" href="https://github.com/tnnrhpwd/portfolio-app/releases/latest/download/Simple-Addon-portable.exe" target="_blank" rel="noopener noreferrer">
            Download the addon
          </a>
        </div>
      )}

      {/* ── Row 1: how far it may go · the live loop ───────────────────────── */}
      <div className="sd-grid">
        {/* Permissions — the one trust control. The ladder sets exactly the
            state the raw switches do, so this is the only place it's offered. */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">🛡️ How much may it do on its own?</h2>
          </header>
          <div className="sd-panel-body">
            <AgentModes
              perms={perms}
              connected={isConnected}
              busy={modesBusy}
              onChange={applyMode}
            />
          </div>
          <footer className="sd-panel-actions">
            {/* Not a mode — it overrides every mode, so it stays its own switch. */}
            <Toggle
              label="Kill switch — stop everything now"
              checked={perms.globalKillSwitch}
              onChange={onToggleKill}
              disabled={!isConnected || modesBusy}
              danger
            />
          </footer>
        </section>

        {/* ── The loop ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">🤖 The loop</h2>
              <span className={`sd-badge ${isRunning ? 'sd-badge--run' : ''}`}>
                {isRunning ? 'Running' : 'Idle'}
              </span>
            </header>
            <div className="sd-panel-body">
              {!isConnected ? (
                <p className="sd-hint">Connect the addon to run and watch the loop live.</p>
              ) : (
                <>
                  <dl className="sd-stats">
                    <div><dt>Stalls</dt><dd>{agent?.stallCount ?? 0}</dd></div>
                    <div><dt>Step budget</dt><dd>{agent?.maxSteps ?? '—'}</dd></div>
                    {agent?.lastLesson && (
                      <div className="sd-stat-wide"><dt>Last lesson</dt><dd>{agent.lastLesson}</dd></div>
                    )}
                  </dl>
                  {!isRunning && (
                    <p className="sd-hint">
                      Idle. Start it to work the next active goal, or hand it a single
                      instruction on the right.
                    </p>
                  )}
                </>
              )}

              {isConnected && approvals.length > 0 && (
              <div className="sd-approvals">
                {approvals.map((a) => (
                  <div key={a.id} className="sd-approval">
                    <span className="sd-approval-name">{a.toolName || a.id}</span>
                    <div className="sd-approval-actions">
                      <button className="sd-btn sd-btn--primary sd-btn--sm" onClick={() => onApprove(a.id, true)}>Allow</button>
                      <button className="sd-btn sd-btn--muted sd-btn--sm" onClick={() => onApprove(a.id, false)}>Deny</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <footer className="sd-panel-actions">
            {isConnected && (
              isRunning ? (
                <button className="sd-btn sd-btn--danger" onClick={onStop} disabled={agentBusy}>■ Stop</button>
              ) : (
                <button className="sd-btn sd-btn--primary" onClick={onStart} disabled={agentBusy}>▶ Start loop</button>
              )
            )}
            <Link className="sd-btn sd-btn--muted" to="/net">Full chat →</Link>
          </footer>
        </section>

        {/* ── One-off instruction ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">🎛️ One-off instruction</h2>
          </header>
          <div className="sd-panel-body sd-panel-body--chat">
            {!isConnected ? (
              <p className="sd-hint">
                Ask the loop to do something from here once the addon is connected — e.g. “List the files in
                <code> Documents</code> and count them”.
              </p>
            ) : (
              <>
                <label className="sd-label" htmlFor="sd-instruction">What should it do?</label>
                <div className="sd-chat-row">
                  <input
                    id="sd-instruction"
                    className="sd-input"
                    type="text"
                    placeholder="e.g. organize my Downloads into folders"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSendInstruction(); }}
                  />
                  <button className="sd-btn sd-btn--primary" onClick={onSendInstruction} disabled={chatBusy || !instruction.trim()}>
                    {chatBusy ? '…' : 'Run'}
                  </button>
                </div>
                {chatResult && (
                  <p className={`sd-chat-result ${chatResult.nonActionable ? 'sd-chat-result--muted' : ''}`}>
                    {chatResult.text}
                  </p>
                )}
                {chatError && <p className="sd-chat-error">{chatError}</p>}

                <div className="sd-nl">
                  <label className="sd-label" htmlFor="sd-nl">Create a macro from English</label>
                  <div className="sd-chat-row">
                    <input
                      id="sd-nl"
                      className="sd-input"
                      type="text"
                      placeholder="e.g. rename files in a folder to lowercase"
                      value={nlText}
                      onChange={(e) => setNlText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') onCompileNl(); }}
                    />
                    <button className="sd-btn sd-btn--muted" onClick={onCompileNl} disabled={nlBusy || !nlText.trim()}>
                      {nlBusy ? '…' : 'Compile'}
                    </button>
                  </div>
                  {nlStatus && <p className="sd-chat-result">{nlStatus}</p>}
                  {nlError && <p className="sd-chat-error">{nlError}</p>}
                </div>
              </>
            )}
          </div>
          <footer className="sd-panel-actions">
            <span className="sd-hint">Runs Observe → Orient → Goal → Plan → Action.</span>
          </footer>
        </section>
      </div>

      {/* ── Row 2: what you're working on ─────────────────────────────────── */}
      <div className="sd-grid">
        {/* ── Goals ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">🎯 Goals</h2>
            <span className="sd-badge">{activeGoals.length} active</span>
          </header>
          <div className="sd-panel-body sd-panel-body--list">
            {!token ? (
              <p className="sd-hint"><Link to="/login">Log in</Link> to see your goals.</p>
            ) : goalsLoading ? (
              <p className="sd-hint">Loading goals…</p>
            ) : goals.length === 0 ? (
              <p className="sd-hint">No goals yet. Create one to give the loop something to work.</p>
            ) : (
              <ul className="sd-list">
                {[...activeGoals, ...followUpGoals].slice(0, 5).map((g) => {
                  const status = g.status || 'active';
                  const meta = GOAL_STATUS_META[status] || { label: status, cls: '' };
                  return (
                    <li key={g.slug || g.name} className="sd-list-item">
                      <Link className="sd-list-main sd-list-main--link" to={`/plans/goal/${g.slug}`}>
                        <span className="sd-list-name">{g.name || 'Untitled goal'}</span>
                        {g.content && g.content !== g.name && <span className="sd-list-sub">{g.content}</span>}
                      </Link>
                      <span className={`sd-status-pill sd-status-pill--${meta.cls}`}>{meta.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <footer className="sd-panel-actions">
            <Link className="sd-btn sd-btn--muted" to="/plans">Open Goals →</Link>
          </footer>
        </section>

        {/* ── Macros ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">⚡ Macros</h2>
            <span className="sd-badge">{macros.length}</span>
          </header>
          <div className="sd-panel-body sd-panel-body--list">
            {!token ? (
              <p className="sd-hint"><Link to="/login">Log in</Link> to see your saved macros.</p>
            ) : macrosLoading ? (
              <p className="sd-hint">Loading macros…</p>
            ) : macros.length === 0 ? (
              <p className="sd-hint">No macros yet. Record a task once and it becomes a runnable skill.</p>
            ) : (
              <ul className="sd-list">
                {macros.slice(0, 6).map((m) => (
                  <li key={m.slug} className="sd-list-item">
                    <span className="sd-list-name">{m.name || m.slug}</span>
                    <button
                      className="sd-btn sd-btn--muted sd-btn--sm"
                      onClick={() => onRunMacro(m.slug)}
                      disabled={!isConnected || runningSlug === m.slug}
                    >
                      {runningSlug === m.slug ? '…' : runResult?.slug === m.slug ? (runResult.ok ? '✓' : '✕') : 'Run'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <footer className="sd-panel-actions">
            <Link className="sd-btn sd-btn--muted" to="/settings">Manage macros →</Link>
          </footer>
        </section>
      </div>

      {/* ── Row 3: what it noticed — the watch-and-learn half ─────────────── */}
      <div className="sd-grid sd-grid--three">
        {/* ── Proposed goals ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">💡 Proposed goals</h2>
            <span className="sd-badge">{proposals.length}</span>
          </header>
          <div className="sd-panel-body sd-panel-body--list">
            {!isConnected ? (
              <p className="sd-hint">Connect the addon to see self-formed goal proposals.</p>
            ) : proposals.length === 0 ? (
              <p className="sd-hint">Nothing proposed yet. The continuous listener proposes goals as it spots repeatable work.</p>
            ) : (
              <ul className="sd-list">
                {proposals.slice(0, 5).map((p) => (
                  <li key={p.id} className="sd-list-item">
                    <span className="sd-list-main">
                      <span className="sd-list-name">{p.title || p.id}</span>
                      {p.description && <span className="sd-list-sub">{p.description}</span>}
                    </span>
                    <button
                      className="sd-btn sd-btn--primary sd-btn--sm"
                      onClick={() => onAcceptProposal(p.id)}
                      disabled={!isConnected || acceptingId === p.id}
                    >
                      {acceptingId === p.id ? '…' : 'Accept'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── Lessons ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">📚 Lessons</h2>
            <span className="sd-badge">{lessons.length}</span>
          </header>
          <div className="sd-panel-body sd-panel-body--list">
            {!token ? (
              <p className="sd-hint"><Link to="/login">Log in</Link> to see learned lessons.</p>
            ) : lessons.length === 0 ? (
              <p className="sd-hint">No lessons yet — the critic writes one whenever a step fails or mis-predicts.</p>
            ) : (
              <ul className="sd-list">
                {lessons.slice(0, 5).map((l) => (
                  <li key={l.slug} className="sd-list-item">
                    <span className="sd-list-name">{lessonText(l)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── Suggestions ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">🧠 Suggestions</h2>
            <span className="sd-badge">{suggestions.length}</span>
          </header>
          <div className="sd-panel-body sd-panel-body--list">
            {!isConnected ? (
              <p className="sd-hint">Connect the addon to see automation suggestions.</p>
            ) : suggestions.length === 0 ? (
              <p className="sd-hint">No suggestions yet — they appear as it spots repeated sequences.</p>
            ) : (
              <ul className="sd-list">
                {suggestions.slice(0, 5).map((s, i) => (
                  <li key={s.sequenceKey || i} className="sd-list-item">
                    <span className="sd-list-main">
                      <span className="sd-list-name">{s.name || s.sequenceKey || 'suggestion'}</span>
                      {Array.isArray(s.tools) && <span className="sd-list-sub">{s.tools.slice(0, 3).join(', ')}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ── Row 4: record a task, and the raw plumbing, folded away ────────── */}
      <div className="sd-grid">
        {/* ── Recorder ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">⏺ Record a task</h2>
            <span className={`sd-badge ${recorder?.active ? 'sd-badge--run' : ''}`}>
              {recorder?.active ? 'Recording' : 'Idle'}
            </span>
          </header>
          <div className="sd-panel-body sd-panel-body--chat">
            {!isConnected ? (
              <p className="sd-hint">Connect the addon to record a demonstration.</p>
            ) : (
              <>
                <div className="sd-chat-row">
                  <input
                    className="sd-input"
                    type="text"
                    placeholder="Name (e.g. invoice filing)"
                    value={recName}
                    onChange={(e) => setRecName(e.target.value)}
                  />
                  {recorder?.active ? (
                    <button className="sd-btn sd-btn--danger" onClick={onStopRecording} disabled={recBusy}>■ Stop</button>
                  ) : (
                    <button className="sd-btn sd-btn--primary" onClick={onStartRecording} disabled={recBusy}>● Record</button>
                  )}
                </div>
                {recorder?.active && <p className="sd-hint">{recorder.eventCount ?? 0} events captured</p>}
                {recordings.length > 0 && (
                  <ul className="sd-list">
                    {recordings.slice(0, 4).map((r) => (
                      <li key={r.sessionId} className="sd-list-item">
                        <span className="sd-list-name">{r.name || r.sessionId}</span>
                        <button className="sd-btn sd-btn--muted sd-btn--sm" onClick={() => onDeleteRecording(r.sessionId)}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>

        {/* Everything below is raw plumbing for power users — kept out of the
            consumer path but not removed, so nothing lost a control it had. */}
      </div>

      {/* ── Advanced — raw plumbing, folded so the first screen is the job ───
          The raw permission switches live here rather than beside the mode
          ladder: the ladder already sets exactly those two, and two controls
          for one state is how a UI starts disagreeing with itself. */}
      <details className="sd-advanced">
        <summary className="sd-advanced-summary">
          <span aria-hidden="true">⚙️</span> Advanced — raw switches, sensors, layouts, voice, eye tracking
        </summary>

        <div className="sd-panel sd-panel--raw">
          <header className="sd-panel-head">
            <h2 className="sd-panel-title">🔧 Raw permission switches</h2>
          </header>
          <div className="sd-panel-body">
            <div className="sd-toggles">
              <Toggle
                label="Listener"
                checked={perms.continuousMode}
                onChange={() => onToggleListener(!perms.continuousMode)}
                disabled={!isConnected}
              />
              <Toggle
                label="Auto-approve"
                checked={perms.autoApproveAll}
                onChange={() => onToggleAutoApprove(!perms.autoApproveAll)}
                disabled={!isConnected}
              />
            </div>
            <p className="sd-hint">
              The same state the mode ladder sets — Suggest is Listener on its own,
              Autopilot is Listener + Auto-approve.
            </p>
          </div>
        </div>

        <div className="sd-grid sd-grid--advanced">
          {/* ── Perception ── */}
            <section className="sd-panel">
              <header className="sd-panel-head">
                <h3 className="sd-panel-title">👁️ Perception</h3>
              </header>
              <div className="sd-panel-body">
                {!isConnected ? (
                  <p className="sd-hint">Connect the addon to see what it currently perceives.</p>
                ) : perception?.context ? (
                  <p className="sd-perception">{perception.context}</p>
                ) : (
                  <p className="sd-hint">No perception data yet — the loop records it while running.</p>
                )}
              </div>
            </section>

        {/* ── Workspace Profiles ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h3 className="sd-panel-title">🪟 Workspace Profiles</h3>
            <span className="sd-badge">{profiles.length}</span>
          </header>
          <div className="sd-panel-body sd-panel-body--chat">
            {!isConnected ? (
              <p className="sd-hint">Connect the addon to save and restore window layouts.</p>
            ) : (
              <>
                <div className="sd-chat-row">
                  <input
                    className="sd-input"
                    type="text"
                    placeholder="Profile name"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSaveProfile(); }}
                  />
                  <button className="sd-btn sd-btn--primary" onClick={onSaveProfile} disabled={profileBusy || !profileName.trim()}>Save</button>
                </div>
                {profiles.length > 0 ? (
                  <ul className="sd-list">
                    {profiles.slice(0, 5).map((p) => (
                      <li key={p.name} className="sd-list-item">
                        <span className="sd-list-name">{p.name}</span>
                        <span className="sd-list-actions">
                          <button className="sd-btn sd-btn--muted sd-btn--sm" onClick={() => onRestoreProfile(p.name)}>Restore</button>
                          <button className="sd-btn sd-btn--muted sd-btn--sm" onClick={() => onDeleteProfile(p.name)}>✕</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sd-hint">No profiles yet — save the current window layout as a profile.</p>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── Voice ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h3 className="sd-panel-title">🎤 Voice</h3>
            <span className={`sd-badge ${voice?.wakewordLoop ? 'sd-badge--run' : ''}`}>
              {voice?.wakewordLoop ? 'Wakeword on' : 'Idle'}
            </span>
          </header>
          <div className="sd-panel-body sd-panel-body--chat">
            {!isConnected ? (
              <p className="sd-hint">Connect the addon for voice control.</p>
            ) : (
              <>
                <div className="sd-chat-row">
                  <button className="sd-btn sd-btn--muted" onClick={onToggleWakeword} disabled={voiceBusy}>
                    {voice?.wakewordLoop ? 'Stop wakeword' : 'Start wakeword'}
                  </button>
                  <button className="sd-btn sd-btn--primary" onClick={onListen} disabled={voiceBusy}>{voiceBusy ? '…' : '🎙 Listen'}</button>
                </div>
                {voiceResult && <p className="sd-chat-result">{voiceResult}</p>}
                <div className="sd-chat-row">
                  <input
                    className="sd-input"
                    type="text"
                    placeholder="Text to speak"
                    value={speakText}
                    onChange={(e) => setSpeakText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSpeak(); }}
                  />
                  <button className="sd-btn sd-btn--muted" onClick={onSpeak} disabled={voiceBusy || !speakText.trim()}>Speak</button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Eye Tracking ── */}
        <section className="sd-panel">
          <header className="sd-panel-head">
            <h3 className="sd-panel-title">👀 Eye Tracking</h3>
            <span className={`sd-badge ${eye?.active ? 'sd-badge--run' : ''}`}>
              {eye?.active ? 'Active' : eye?.calibrating ? 'Calibrating' : 'Idle'}
            </span>
          </header>
          <div className="sd-panel-body">
            {!isConnected ? (
              <p className="sd-hint">Connect the addon for eye-tracking cursor control.</p>
            ) : (
              <>
                <p className="sd-hint">
                  {eye?.hasCalibration
                    ? `Calibrated${eye?.onlineSamples ? ` · ${eye.onlineSamples} samples` : ''}`
                    : 'Not calibrated yet — calibrate first.'}
                </p>
                <div className="sd-panel-actions">
                  <button className="sd-btn sd-btn--primary sd-btn--sm" onClick={onEyeToggle} disabled={eyeBusy}>
                    {eye?.active ? 'Stop' : 'Start'}
                  </button>
                  <button className="sd-btn sd-btn--muted sd-btn--sm" onClick={onEyeCalibrate} disabled={eyeBusy}>Calibrate</button>
                </div>
              </>
            )}
          </div>
        </section>
          </div>
      </details>

      {/* ── Where next — a two-link hand-off, not a pitch (§5.7) ──────────── */}
      <div className="sd-next">
        <p className="sd-next-copy">
          {isConnected
            ? 'The agent is on this PC and ready.'
            : 'Your goals and macros still sync without the desktop app — install it to let the agent act on this PC.'}
          {completedGoals > 0 && ` ${completedGoals} goal${completedGoals === 1 ? '' : 's'} completed so far.`}
        </p>
        <div className="sd-next-actions">
          <Link className="sd-btn sd-btn--muted" to="/net">💬 Chat with it</Link>
          <Link className="sd-btn sd-btn--muted" to="/plans">🎯 Review goals</Link>
        </div>
      </div>
    </div>
  );
}
