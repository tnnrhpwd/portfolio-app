/**
 * AgentLivePanel — sidebar "Macros & Agent" panel.
 *
 * Two simple things live here:
 *   1. Quick Macros — your saved macros (recorded in Advanced Settings →
 *      Shortcuts) with a one-click "Run" button, so you don't have to open
 *      a modal just to fire off a macro.
 *   2. Autonomous Agent — Start/Stop/Kill-switch for the addon's autonomous
 *      agent, plus any pending approval prompts it needs from you.
 *
 * Both require the local CSimple desktop addon to be installed and running;
 * when it isn't, the panel shows a short connect hint instead.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  listWorkspace,
  getWorkspaceItem,
  runSkill,
} from '../../services/csimpleApi';
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
    case 'agent.step': return `step ${ev.step}${ev.modelId ? ` · ${ev.modelId}` : ''}`;
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
  const isSidebar = variant === 'sidebar';
  const token = user?.token;

  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [status, setStatus] = useState(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [killSwitchOn, setKillSwitchOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Quick macros
  const [macros, setMacros] = useState([]);
  const [macrosLoading, setMacrosLoading] = useState(false);
  const [macrosError, setMacrosError] = useState(null);
  const [runningSlug, setRunningSlug] = useState(null);
  const [runResult, setRunResult] = useState(null); // { slug, ok }

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
      }).catch(() => {});
    }, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [addonConnected]);

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

  const statusLabel = useMemo(() => {
    if (!addonConnected) return 'Addon not connected';
    if (!connected) return 'Connecting…';
    return running ? 'Agent running' : 'Idle';
  }, [addonConnected, connected, running]);

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

      {/* ── Quick Macros ──────────────────────────────────────────────── */}
      <div className="agent-live__section">
        <div className="agent-live__section-head">
          <h4>⚡ Macros</h4>
          <span className="agent-live__section-hint">Run a saved macro on your PC</span>
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

        {token && (
          <button className="agent-live__link-btn" onClick={onManageMacros}>
            Manage macros →
          </button>
        )}
      </div>

      {/* ── Autonomous Agent ──────────────────────────────────────────── */}
      <div className="agent-live__section">
        <div className="agent-live__section-head">
          <h4>🤖 Autonomous Agent</h4>
          <span className={`agent-live__badge ${running ? 'is-running' : connected ? 'is-idle' : 'is-off'}`}>
            {statusLabel}
          </span>
        </div>

        {!addonConnected ? (
          <div className="agent-live__empty">
            <p className="agent-live__hint">
              Lets the desktop addon carry out multi-step goals on its own (with your approval on risky actions). Install the addon to use it.
            </p>
            <a className="agent-live__link" href="/blog/csimple-addon">How to install →</a>
          </div>
        ) : (
          <>
            <p className="agent-live__section-hint agent-live__section-hint--block">
              Give it a goal in chat, then Start it here. It works through the goal step by step and asks you to approve anything risky.
            </p>

            {goalTitle && (
              <div className="agent-live__goal">
                <span className="agent-live__goal-label">Goal</span>
                <span className="agent-live__goal-name">{goalTitle}</span>
                {status?.step != null && <span className="agent-live__goal-step">step {status.step}</span>}
              </div>
            )}

            <div className="agent-live__controls">
              {running ? (
                <button className="agent-live__btn agent-live__btn--stop" onClick={onStop} disabled={busy}>Stop</button>
              ) : (
                <button className="agent-live__btn agent-live__btn--start" onClick={onStart} disabled={busy}>Start Agent</button>
              )}
              <button className="agent-live__btn agent-live__btn--kill" onClick={onKill} disabled={busy} title="Immediately stop the agent and block further actions">
                Kill Switch
              </button>
              <label className={`agent-live__toggle ${autoApprove ? 'is-on' : ''}`} title="Auto-approve tool actions that would normally prompt. Kill switch and blocked commands still apply.">
                <input
                  type="checkbox"
                  checked={autoApprove}
                  onChange={(e) => onToggleAutoApprove(e.target.checked)}
                  disabled={busy}
                />
                <span>Auto-approve actions</span>
              </label>
            </div>

            {error && <div className="agent-live__error">{error}</div>}

            {approvals.length > 0 && (
              <div className="agent-live__approvals">
                <h4>Needs your approval</h4>
                {approvals.map((a) => (
                  <div key={a.id} className="agent-live__approval">
                    <div className="agent-live__approval-tool">{a.toolName}</div>
                    {a.args && (
                      <pre className="agent-live__approval-args">{JSON.stringify(a.args, null, 0).slice(0, 200)}</pre>
                    )}
                    <div className="agent-live__approval-actions">
                      <button className="agent-live__btn agent-live__btn--start" onClick={() => onApprove(a.id, true)} disabled={busy}>Approve</button>
                      <button className="agent-live__btn agent-live__btn--stop" onClick={() => onApprove(a.id, false)} disabled={busy}>Deny</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {feed.length > 0 && (
              <div className="agent-live__feed">
                <h4>Recent activity</h4>
                <ul>
                  {feed.map((ev) => {
                    const meta = TYPE_META[ev.type] || { icon: '·', cls: 'other' };
                    return (
                      <li key={ev._k} className={`agent-live__event agent-live__event--${meta.cls}`}>
                        <span className="agent-live__event-icon">{meta.icon}</span>
                        <span className="agent-live__event-text">{describe(ev)}</span>
                        <span className="agent-live__event-time">{fmtTime(ev.ts)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
