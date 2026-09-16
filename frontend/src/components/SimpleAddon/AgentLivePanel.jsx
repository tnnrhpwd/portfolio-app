/**
 * AgentLivePanel — the rail's "⚡ Macros & Loop" section.
 *
 * Two simple things live here:
 *   1. Quick Macros — your saved macros (recorded in Advanced Settings →
 *      Shortcuts) with a one-click "Run" button, so you don't have to open
 *      a modal just to fire off a macro.
 *   2. The loop — Start/Stop for the addon's autonomous agent, which works the
 *      NEXT ACTIVE GOAL, plus any pending approval prompts it needs from you.
 *      The wording is /simple's on purpose: that page owns the mode ladder, the
 *      kill switch and the live console, and this is the same loop seen from the
 *      rail. Everything that is not the loop or a macro (the two raw permission
 *      switches, eye tracking) is folded into one "Advanced" group, exactly the
 *      split /simple makes.
 *
 * Both the loop and macros require the local Simple desktop addon to be installed
 * and running; when it isn't, the panel says so instead of offering dead buttons.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAgentEventsUrl,
  getAgentStatus,
  startAgent,
  stopAgent,
  getPendingApprovals,
  resolveApproval,
  activateKillSwitch,
  deactivateKillSwitch,
  getAutomationPermissions,
  setAutoApproveAll,
  setAgentListener,
  listWorkspace,
  getWorkspaceItem,
  runSkill,
  getEyeTrackingStatus,
  startEyeTracking,
  stopEyeTracking,
  calibrateEyeTracking,
} from '../../services/simpleAddonApi';
import { modelDisplayName } from '../../constants/aiModel.js';
import './AgentLivePanel.css';

const MAX_FEED = 20;

const TYPE_META = {
  'tool.start':         { icon: '▶', cls: 'tool' },
  'tool.end':           { icon: '■', cls: 'tool' },
  'agent.step':         { icon: '↻', cls: 'agent' },
  'agent.message':      { icon: '💬', cls: 'agent' },
  'agent.stopped':      { icon: '⏹', cls: 'agent' },
  'approval.pending':   { icon: '⚠', cls: 'approval' },
  'approval.resolved':  { icon: '✓', cls: 'approval' },
  'skill.run':          { icon: '🛠', cls: 'skill' },
};

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString(); } catch { return ''; }
}

function describe(ev) {
  switch (ev.type) {
    case 'tool.start': return `${ev.tool} started`;
    case 'tool.end':   return `${ev.tool} ${ev.ok ? 'ok' : 'failed'}${ev.durationMs != null ? ` · ${ev.durationMs}ms` : ''}${ev.error ? ` · ${ev.error}` : ''}`;
    // Friendly model name — the addon reports the raw id when the step ran on
    // the cloud (e.g. us.anthropic.claude-haiku-4-5-20251001-v1:0).
    case 'agent.step': return `step ${ev.step}${ev.modelId ? ` · ${modelDisplayName(ev.modelId)}` : ''}`;
    case 'agent.message': return `${ev.role}: ${String(ev.content || '').slice(0, 140)}`;
    case 'agent.stopped': return `stopped: ${ev.reason || ''}`;
    case 'approval.pending': return `needs approval: ${ev.toolName}`;
    case 'approval.resolved': return `${ev.approved ? 'approved' : 'denied'} ${ev.id}`;
    case 'skill.run': return `macro ${ev.slug} · ${ev.stepsRun ?? '?'} steps${ev.failed ? ' · failed' : ''}`;
    default: return ev.type;
  }
}

/** Pull the compiled skill object out of a workspace item's content blob. */
function parseSkillContent(item) {
  if (!item) return null;
  try {
    return typeof item.content === 'string' ? JSON.parse(item.content) : (item.content || null);
  } catch {
    return null;
  }
}

export default function AgentLivePanel({ addonConnected, user, onManageMacros, variant = 'sidebar' }) {
  const navigate = useNavigate();
  const isSidebar = variant === 'sidebar';
  const token = user?.token;

  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [status, setStatus] = useState(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [listenerEnabled, setListenerEnabled] = useState(false);
  const [killSwitchOn, setKillSwitchOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Quick macros
  const [macros, setMacros] = useState([]);
  const [macrosLoading, setMacrosLoading] = useState(false);
  const [macrosError, setMacrosError] = useState(null);
  const [runningSlug, setRunningSlug] = useState(null);
  const [runResult, setRunResult] = useState(null); // { slug, ok }

  // Eye tracking
  const [eyeStatus, setEyeStatus] = useState(null);
  const [eyeBusy, setEyeBusy] = useState(false);

  const esRef = useRef(null);
  const lastSeqRef = useRef(0);

  const pushEvent = useCallback((ev) => {
    lastSeqRef.current = Math.max(lastSeqRef.current, ev.seq || 0);
    if (ev.type === 'approval.pending' && ev.id) {
      setApprovals((prev) => (prev.some((a) => a.id === ev.id) ? prev : [...prev, {
        id: ev.id, toolName: ev.toolName, args: ev.args, createdAt: ev.createdAt || ev.ts,
      }]));
    }
    if (ev.type === 'approval.resolved' && ev.id) {
      setApprovals((prev) => prev.filter((a) => a.id !== ev.id));
    }
    if (ev.type === 'agent.stopped') {
      setStatus((s) => (s ? { ...s, running: false } : s));
    }
    setFeed((prev) => {
      const next = [{ ...ev, _k: `${ev.seq}-${ev.ts}` }, ...prev];
      return next.slice(0, MAX_FEED);
    });
  }, []);

  // ── SSE subscription ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!addonConnected) {
      setConnected(false);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      return;
    }
    const url = getAgentEventsUrl({ sinceSeq: lastSeqRef.current });
    if (!url) return;

    const es = new EventSource(url);
    esRef.current = es;
    es.onopen = () => { setConnected(true); setError(null); };
    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects; surface a soft hint only.
    };
    es.onmessage = (e) => {
      try { pushEvent(JSON.parse(e.data)); } catch { /* ignore malformed */ }
    };
    // Named events (the server sets `event: <type>`) bypass onmessage.
    for (const type of Object.keys(TYPE_META)) {
      es.addEventListener(type, (e) => {
        try { pushEvent(JSON.parse(e.data)); } catch { /* ignore */ }
      });
    }
    // Kill switch can be flipped from elsewhere (tray icon, another window,
    // an addon restart with a stale on-disk flag) — listen directly so the
    // banner below stays in sync without a page refresh.
    es.addEventListener('permissions.changed', (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.changedKeys?.includes('globalKillSwitch')) {
          setKillSwitchOn(!!ev.killSwitch);
        }
      } catch { /* ignore */ }
    });

    return () => { es.close(); esRef.current = null; };
  }, [addonConnected, pushEvent]);

  // ── Initial status + approvals snapshot ───────────────────────────────────
  useEffect(() => {
    if (!addonConnected) return;
    let cancelled = false;
    (async () => {
      try {
        const [st, ap, perms] = await Promise.all([
          getAgentStatus().catch(() => null),
          getPendingApprovals().catch(() => ({ approvals: [] })),
          getAutomationPermissions().catch(() => null),
        ]);
        if (cancelled) return;
        if (st) setStatus(st);
        if (ap?.approvals) setApprovals(ap.approvals);
        if (perms) {
          setAutoApprove(!!perms.autoApproveAll);
          setKillSwitchOn(!!perms.globalKillSwitch);
          setListenerEnabled(!!perms.continuousMode);
        }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [addonConnected]);

  // ── Kill-switch safety poll ───────────────────────────────────────────────
  // The SSE 'permissions.changed' listener above is the primary way the
  // banner stays in sync, but it can miss updates around reconnects/restarts.
  // Poll straight from the source periodically so "kill switch is on but no
  // UI says so" can't persist for long even if an event was dropped.
  useEffect(() => {
    if (!addonConnected) return;
    let cancelled = false;
    const id = setInterval(() => {
      getAutomationPermissions().then((perms) => {
        if (cancelled || !perms) return;
        setAutoApprove(!!perms.autoApproveAll);
        setKillSwitchOn(!!perms.globalKillSwitch);
        setListenerEnabled(!!perms.continuousMode);
      }).catch(() => {});
    }, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [addonConnected]);

  // ── Eye tracking status + controls ──────────────────────────────────────
  // The addon exposes /api/eye-tracking/* so the webapp can drive it wherever
  // the user actually is. Poll status on a light cadence and keep a local
  // busy flag so Start/Stop/Calibrate don't fight each other.
  useEffect(() => {
    if (!addonConnected) { setEyeStatus(null); return; }
    let cancelled = false;
    const refresh = () => {
      getEyeTrackingStatus()
        .then((s) => { if (!cancelled) setEyeStatus(s); })
        .catch(() => { if (!cancelled) setEyeStatus(null); });
    };
    refresh();
    const id = setInterval(refresh, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [addonConnected]);

  const onEyeStart = useCallback(async () => {
    if (eyeBusy) return;
    setEyeBusy(true);
    try {
      const r = await startEyeTracking({});
      if (r?.error) throw new Error(r.error);
      setEyeStatus((s) => ({ ...(s || {}), active: true, state: 'running', lastError: null }));
    } catch (e) {
      setEyeStatus((s) => ({ ...(s || {}), lastError: e.message || String(e) }));
    } finally {
      setEyeBusy(false);
    }
  }, [eyeBusy]);

  const onEyeStop = useCallback(async () => {
    if (eyeBusy) return;
    setEyeBusy(true);
    try {
      const r = await stopEyeTracking();
      if (r?.error) throw new Error(r.error);
      setEyeStatus((s) => ({ ...(s || {}), active: false, state: 'idle', lastError: null }));
    } catch (e) {
      setEyeStatus((s) => ({ ...(s || {}), lastError: e.message || String(e) }));
    } finally {
      setEyeBusy(false);
    }
  }, [eyeBusy]);

  const onEyeCalibrate = useCallback(async () => {
    if (eyeBusy) return;
    setEyeBusy(true);
    try {
      const r = await calibrateEyeTracking();
      if (r?.error) throw new Error(r.error);
      // Calibration happens in a desktop window; the next poll will pick up
      // the state change, but nudge an immediate refresh so the UI is snappy.
      getEyeTrackingStatus().then((s) => setEyeStatus(s)).catch(() => {});
    } catch (e) {
      setEyeStatus((s) => ({ ...(s || {}), lastError: e.message || String(e) }));
    } finally {
      setEyeBusy(false);
    }
  }, [eyeBusy]);

  const eyeLabel = useMemo(() => {
    if (!addonConnected) return '';
    if (!eyeStatus) return 'Checking…';
    if (eyeStatus.calibrating) return 'Calibrating…';
    if (eyeStatus.active) return 'Active — moving your cursor';
    if (eyeStatus.lastError) return `Error: ${eyeStatus.lastError}`;
    return eyeStatus.hasCalibration ? 'Calibrated — ready' : 'Not calibrated yet';
  }, [addonConnected, eyeStatus]);

  // ── Quick macros list (cloud workspace, independent of the addon) ────────
  const loadMacros = useCallback(async () => {
    if (!token) return;
    setMacrosLoading(true);
    setMacrosError(null);
    try {
      const list = await listWorkspace(token, { kind: 'skill' });
      const items = list.entries || [];
      const full = await Promise.all(items.map(async (it) => {
        try {
          const one = await getWorkspaceItem(token, 'skill', it.slug);
          return { item: one || it, skill: parseSkillContent(one) };
        } catch {
          return { item: it, skill: null };
        }
      }));
      setMacros(full);
    } catch (e) {
      setMacrosError(e.message || 'Failed to load macros');
    } finally {
      setMacrosLoading(false);
    }
  }, [token]);

  useEffect(() => { loadMacros(); }, [loadMacros]);

  const withBusy = useCallback(async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  }, []);

  const onStart = useCallback(() => withBusy(async () => {
    const r = await startAgent({});
    setStatus((s) => ({ ...(s || {}), ...r, running: true }));
  }), [withBusy]);

  const onStop = useCallback(() => withBusy(async () => {
    await stopAgent();
    setStatus((s) => (s ? { ...s, running: false } : s));
  }), [withBusy]);

  const onKill = useCallback(() => withBusy(async () => {
    await activateKillSwitch();
    setStatus((s) => (s ? { ...s, running: false } : s));
    setKillSwitchOn(true);
  }), [withBusy]);

  const onResumeFromKillSwitch = useCallback(() => withBusy(async () => {
    await deactivateKillSwitch();
    setKillSwitchOn(false);
  }), [withBusy]);

  const onApprove = useCallback((id, approved) => withBusy(async () => {
    await resolveApproval(id, approved);
    setApprovals((prev) => prev.filter((a) => a.id !== id));
  }), [withBusy]);

  const onToggleAutoApprove = useCallback((next) => withBusy(async () => {
    const cfg = await setAutoApproveAll(next);
    setAutoApprove(!!cfg.autoApproveAll);
    if (next) setApprovals([]);
  }), [withBusy]);

  const onToggleListener = useCallback((next) => withBusy(async () => {
    const s = await setAgentListener(next);
    setListenerEnabled(!!s?.enabled);
  }), [withBusy]);

  const onRunMacro = useCallback(async (slug) => {
    if (!addonConnected || runningSlug) return;
    setRunningSlug(slug);
    setRunResult(null);
    try {
      const macro = macros.find(m => m.item.slug === slug);
      const out = await runSkill(slug, {}, macro?.skill || null);
      if (out?.error) throw new Error(out.error);
      const failed = !!out?.result?.failed;
      setRunResult({ slug, ok: !failed });
    } catch {
      setRunResult({ slug, ok: false });
    } finally {
      setRunningSlug(null);
      setTimeout(() => setRunResult((r) => (r?.slug === slug ? null : r)), 2500);
      // A macro can fail because the kill switch got engaged elsewhere (tray
      // menu, eye-tracking e-stop, another window) between our last snapshot
      // and now. The SSE 'permissions.changed' listener *should* catch that,
      // but if the stream dropped/reconnected around the same moment the
      // banner can silently miss it — leaving tool calls denied with no UI
      // explanation. Re-sync directly off every run attempt as a fallback so
      // the banner never lies about why a macro just failed.
      getAutomationPermissions().then((perms) => {
        if (perms) {
          setAutoApprove(!!perms.autoApproveAll);
          setKillSwitchOn(!!perms.globalKillSwitch);
        }
      }).catch(() => {});
    }
  }, [addonConnected, runningSlug, macros]);

  const running = !!status?.running;
  const goalTitle = status?.currentGoal?.name || status?.currentGoal?.slug || null;

  return (
    <div className={`agent-live${isSidebar ? ' agent-live--sidebar' : ''}`}>
      {/* ── Kill-switch banner ───────────────────────────────────────────
          The kill switch persists to disk across addon restarts, so once
          triggered (e.g. force-stopping a runaway macro) it silently blocks
          EVERY tool call with "Denied by permission policy" until someone
          notices and clears it. Surface it loudly and make clearing it a
          single click instead of a support mystery. */}
      {addonConnected && killSwitchOn && (
        <button
          type="button"
          className="agent-live__kill-banner"
          onClick={onResumeFromKillSwitch}
          disabled={busy}
          title="Click to turn the kill switch back off and let macros/agent actions run again."
        >
          <span className="agent-live__kill-banner-icon">🛑</span>
          <span className="agent-live__kill-banner-text">
            Kill switch is ON — all macros and agent actions are blocked. Tap to turn it back off.
          </span>
        </button>
      )}

      {/* ── The loop ───────────────────────────────────────────────────────
          The panel's one job, and the words are /simple's: the button says what
          it starts, because that is what it does — the loop works the NEXT
          ACTIVE GOAL. The readout is that page's toolbar chips (loop · stage ·
          step) plus its loop panel's two facts (stalls, last lesson), on one
          wrapping line instead of a goal block over a stats block. `Δ` is gone:
          /simple stopped showing the outcome delta, so a stale number nobody
          reads is not worth a line in a rail this narrow. */}
      <div className="agent-live__section">
        <div className="agent-live__bar">
          <h4>🤖 The loop</h4>
          {/* Three states, not two: the event stream can take a moment to open,
              and reporting "idle" while it is still connecting is a claim we
              cannot make yet. */}
          <span className={`agent-live__badge ${!addonConnected ? 'is-off' : running ? 'is-running' : 'is-idle'}`}>
            {!addonConnected ? 'off' : running ? 'running' : connected ? 'idle' : '…'}
          </span>
          <button
            type="button"
            className={`agent-live__btn agent-live__btn--${running ? 'stop' : 'start'}`}
            onClick={running ? onStop : onStart}
            disabled={busy || !addonConnected}
            title={running ? 'Stop the loop' : 'Work the next active goal'}
          >
            {running ? '■ Stop' : '▶ Start loop'}
          </button>
        </div>

        {addonConnected && running && (
          <p className="agent-live__readout">
            {goalTitle && <span className="agent-live__goal-name">{goalTitle}</span>}
            <span className="agent-live__stats">
              loop {status?.loop || '?'} · stage {status?.stage || '?'} · step {status?.step ?? '—'}/{status?.maxSteps ?? '—'} · stalls {status?.stallCount ?? 0}
              {status?.lastLesson ? ` · ${status.lastLesson}` : ''}
            </span>
          </p>
        )}

        {addonConnected && !running && approvals.length === 0 && (
          <p className="agent-live__hint">Idle — Start works the next active goal.</p>
        )}

        {approvals.length > 0 && (
          <div className="agent-live__approvals">
            <h4>Needs your approval</h4>
            {approvals.map((a) => (
              <div key={a.id} className="agent-live__approval">
                <div className="agent-live__approval-tool">{a.toolName}</div>
                <div className="agent-live__approval-args">{(a.args ? JSON.stringify(a.args) : '').slice(0, 200)}</div>
                <div className="agent-live__approval-actions">
                  <button className="agent-live__btn agent-live__btn--start" onClick={() => onApprove(a.id, true)} disabled={busy}>Approve</button>
                  <button className="agent-live__btn agent-live__btn--stop" onClick={() => onApprove(a.id, false)} disabled={busy}>Deny</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="agent-live__error">{error}</div>}
      </div>

      {/* ── Macros ─────────────────────────────────────────────────────────
          One line per macro and the LIST SCROLLS (CSS): a rail panel that grows
          with the macro count pushes the conversation off the bottom of a
          column this narrow. "Manage" rides in the head — a full-width button
          for a navigation link cost a whole row for nothing. */}
      <div className="agent-live__section">
        <div className="agent-live__bar">
          <h4>⚡ Macros</h4>
          {token && macros.length > 0 && <span className="agent-live__count">{macros.length}</span>}
          {token && (
            <button type="button" className="agent-live__link-btn" onClick={onManageMacros}>
              Manage →
            </button>
          )}
        </div>

        {!token ? (
          <p className="agent-live__hint">Log in to see your saved macros.</p>
        ) : macrosLoading ? (
          <p className="agent-live__hint">Loading macros…</p>
        ) : macrosError ? (
          <p className="agent-live__hint">{macrosError}</p>
        ) : macros.length === 0 ? (
          <p className="agent-live__hint">
            No macros yet. Record one to replay clicks, keystrokes and app steps with one click.
          </p>
        ) : (
          <ul className="agent-live__macros">
            {macros.map(({ item, skill }) => {
              const isRunning = runningSlug === item.slug;
              const result = runResult?.slug === item.slug ? runResult : null;
              return (
                <li key={item.slug} className="agent-live__macro">
                  <span className="agent-live__macro-name" title={item.name || item.slug}>
                    {item.name || item.slug}
                  </span>
                  {skill?.hotkey && <span className="agent-live__macro-hotkey">{skill.hotkey}</span>}
                  <button
                    className="agent-live__btn agent-live__macro-run"
                    onClick={() => onRunMacro(item.slug)}
                    disabled={!addonConnected || isRunning}
                    title={!addonConnected ? 'Connect the addon to run macros' : `Run "${item.name || item.slug}"`}
                  >
                    {isRunning ? 'Running…' : result ? (result.ok ? '✓ Done' : '✗ Failed') : 'Run'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

      </div>

      {/* ── Advanced — the raw switches and the sensors, FOLDED ──────────────
          Exactly the split /simple makes: the mode ladder there IS
          auto-approve + listener, so on that page these two checkboxes live
          under its own "Advanced — raw switches, sensors … eye tracking" fold.
          Same here — folded, the panel opens on the loop and the macros and
          nothing else, and both switches stay one click away rather than
          deleted. */}
      <details className="agent-live__adv">
        <summary>⚙️ Advanced — permissions &amp; eye tracking</summary>

        <div className="agent-live__chips">
          <label
            className={`agent-live__toggle${autoApprove ? ' is-on' : ''}`}
            title="Approve every tool call without asking. The kill switch and any per-tool deny still win."
          >
            <input type="checkbox" checked={autoApprove} onChange={(e) => onToggleAutoApprove(e.target.checked)} />
            Auto-approve
          </label>
          <label
            className={`agent-live__toggle${listenerEnabled ? ' is-on' : ''}`}
            title="Continuously watch for work: start the loop on waiting goals and auto-run safe, high-confidence suggestions."
          >
            <input type="checkbox" checked={listenerEnabled} onChange={(e) => onToggleListener(e.target.checked)} />
            Listener
          </label>
        </div>

        {!addonConnected ? (
          <p className="agent-live__hint">Connect the addon to control eye tracking.</p>
        ) : (
          <div className="agent-live__eye-actions">
            <span className="agent-live__eye-label">👁 {eyeLabel}</span>
            {eyeStatus?.active ? (
              <button
                type="button"
                className="agent-live__btn agent-live__btn--stop"
                onClick={onEyeStop}
                disabled={eyeBusy}
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="agent-live__btn agent-live__btn--start"
                onClick={onEyeStart}
                disabled={eyeBusy || eyeStatus?.calibrating}
                title={!eyeStatus?.hasCalibration ? 'Calibrate first' : 'Move the cursor with your eyes'}
              >
                {eyeStatus?.calibrating ? 'Calibrating…' : 'Start'}
              </button>
            )}
            <button
              type="button"
              className="agent-live__btn"
              onClick={onEyeCalibrate}
              disabled={eyeBusy || eyeStatus?.calibrating}
              title="Open the calibration window on your PC"
            >
              Calibrate
            </button>
          </div>
        )}

        <button
          type="button"
          className="agent-live__link-btn agent-live__adv-link"
          onClick={() => navigate('/simple')}
          title="The mode ladder and the kill switch live on the Control page"
        >
          Modes &amp; kill switch — /simple →
        </button>
      </details>

      {/* ── Hand-off ─────────────────────────────────────────────────────
          One line. The sub-line ("Goals, plans, notes & actions") was the
          panel explaining a page whose panels explain themselves (§5.7). */}
      <div className="agent-live__section agent-live__section--plans">
        <button
          type="button"
          className="agent-live__plans-btn"
          onClick={() => navigate('/plans')}
          title="Open your Plans dashboard — goals, plans, notes & actions"
        >
          <span className="agent-live__plans-btn-icon" aria-hidden="true">📋</span>
          <span className="agent-live__plans-btn-text">
            <span className="agent-live__plans-btn-title">Plans</span>
          </span>
          <span className="agent-live__plans-btn-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
