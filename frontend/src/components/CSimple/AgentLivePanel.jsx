/**
 * AgentLivePanel — "the agent's eyes" live view.
 *
 * Subscribes to the local addon's SSE stream (`/api/agent/events`) and renders:
 *   - a live screenshot thumbnail (from `screen.frame` events)
 *   - a rolling activity feed (tool calls, agent steps, recorder + approvals)
 *   - pending approval cards with Approve / Deny buttons
 *   - Start / Stop / Kill-switch controls + a manual "refresh frame" button
 *
 * The addon binds to 127.0.0.1, so the SSE endpoint is reachable directly from
 * the browser when the addon is installed and connected. When it is not, the
 * panel shows a connect hint instead.
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
  relayScreenFrame,
  getAutomationPermissions,
  setAutoApproveAll,
  startWakewordLoop,
  stopWakewordLoop,
  getVoiceStatus,
  getPerceptionFrame,
  getAgentPredictions,
} from '../../services/csimpleApi';
import './AgentLivePanel.css';

const MAX_FEED = 60;

const TYPE_META = {
  'tool.start':         { icon: '▶', cls: 'tool' },
  'tool.end':           { icon: '■', cls: 'tool' },
  'agent.step':         { icon: '↻', cls: 'agent' },
  'agent.message':      { icon: '💬', cls: 'agent' },
  'agent.stopped':      { icon: '⏹', cls: 'agent' },
  'approval.pending':   { icon: '⚠', cls: 'approval' },
  'approval.resolved':  { icon: '✓', cls: 'approval' },
  'recorder.started':   { icon: '●', cls: 'recorder' },
  'recorder.stopped':   { icon: '○', cls: 'recorder' },
  'permissions.changed':{ icon: '🔒', cls: 'perm' },
  'skill.run':          { icon: '🛠', cls: 'skill' },
  'screen.frame':       { icon: '🖼', cls: 'frame' },
  'screen.frame.failed':{ icon: '✗', cls: 'frame' },
  'voice.wakeword':     { icon: '🎙', cls: 'voice' },
  'voice.transcript':   { icon: '🔊', cls: 'voice' },
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
    case 'recorder.started': return `recording "${ev.name || ''}"`;
    case 'recorder.stopped': return `recording stopped · ${ev.eventCount ?? 0} events`;
    case 'permissions.changed': return `permissions: ${(ev.changedKeys || []).join(', ')}`;
    case 'skill.run': return `skill ${ev.slug} · ${ev.stepsRun ?? '?'} steps${ev.failed ? ' · failed' : ''}`;
    case 'screen.frame': return `frame ${ev.w}×${ev.h}${ev.reason ? ` · ${ev.reason}` : ''}`;
    case 'screen.frame.failed': return `frame relay failed: ${ev.reason || ''}`;
    case 'voice.wakeword':  return `Wakeword: "${ev.phrase || ''}"${ev.remainder ? ` → "${ev.remainder}"` : ''}`;
    case 'voice.transcript': return `Heard: "${String(ev.text || '').slice(0, 100)}"`;
    default: return ev.type;
  }
}

export default function AgentLivePanel({ addonConnected, variant = 'full' }) {
  const isSidebar = variant === 'sidebar';
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState([]);
  const [frame, setFrame] = useState(null);          // { url, w, h, reason, ts }
  const [approvals, setApprovals] = useState([]);
  const [status, setStatus] = useState(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Voice
  const [wakewordActive, setWakewordActive] = useState(false);
  const [lastTranscript, setLastTranscript] = useState(null);

  // Perception
  const [perceptionCtx, setPerceptionCtx] = useState(null);

  // Predictions
  const [predictions, setPredictions] = useState([]);

  const esRef = useRef(null);
  const lastSeqRef = useRef(0);

  const pushEvent = useCallback((ev) => {
    lastSeqRef.current = Math.max(lastSeqRef.current, ev.seq || 0);
    if (ev.type === 'screen.frame' && ev.url) {
      setFrame({ url: ev.url, w: ev.w, h: ev.h, reason: ev.reason, ts: ev.ts });
    }
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
    if (ev.type === 'voice.transcript' && ev.text) {
      setLastTranscript({ text: ev.text, wakeword: ev.wakeword, ts: ev.ts || Date.now() });
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
        if (perms) setAutoApprove(!!perms.autoApproveAll);
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [addonConnected]);

  const withBusy = useCallback(async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  }, []);

  // Poll voice + perception + predictions every 5s when connected
  useEffect(() => {
    if (!addonConnected) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const [vStatus, pFrame, preds] = await Promise.all([
          getVoiceStatus().catch(() => null),
          getPerceptionFrame().catch(() => null),
          getAgentPredictions().catch(() => null),
        ]);
        if (cancelled) return;
        if (vStatus) setWakewordActive(!!vStatus.wakewordLoop);
        if (pFrame?.context) setPerceptionCtx(pFrame.context);
        if (preds?.predictions) setPredictions(preds.predictions.slice(0, 4));
      } catch { /* best-effort */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [addonConnected]);

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
  }), [withBusy]);

  const onRefreshFrame = useCallback(() => withBusy(async () => {
    await relayScreenFrame({ maxDim: 720, reason: 'manual refresh' });
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

  const onToggleWakeword = useCallback(() => withBusy(async () => {
    if (wakewordActive) {
      await stopWakewordLoop();
      setWakewordActive(false);
    } else {
      await startWakewordLoop();
      setWakewordActive(true);
    }
  }), [withBusy, wakewordActive]);

  const running = !!status?.running;
  const goalTitle = status?.currentGoal?.name || status?.currentGoal?.slug || null;

  const statusLabel = useMemo(() => {
    if (!addonConnected) return 'Addon not connected';
    if (!connected) return 'Connecting…';
    return running ? 'Agent running' : 'Idle';
  }, [addonConnected, connected, running]);

  if (!addonConnected) {
    return (
      <div className={`agent-live agent-live--disconnected${isSidebar ? ' agent-live--sidebar' : ''}`}>
        {!isSidebar && (
          <div className="agent-live__header">
            <span className="agent-live__title">🖥 Live Agent View</span>
          </div>
        )}
        <div className="agent-live__empty">
          <p>Install and run the CSimple desktop addon to watch the agent operate your PC in real time.</p>
          <a className="agent-live__link" href="/blog/csimple-addon">How to install →</a>
        </div>
      </div>
    );
  }

  return (
    <div className={`agent-live${isSidebar ? ' agent-live--sidebar' : ''}`}>
      <div className="agent-live__header">
        {!isSidebar && <span className="agent-live__title">🖥 Live Agent View</span>}
        <span className={`agent-live__badge ${running ? 'is-running' : connected ? 'is-idle' : 'is-off'}`}>
          {statusLabel}
        </span>
      </div>

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
        <button className="agent-live__btn" onClick={onRefreshFrame} disabled={busy}>Refresh Frame</button>
        <button className="agent-live__btn agent-live__btn--kill" onClick={onKill} disabled={busy}>Kill Switch</button>
        <button
          className={`agent-live__btn agent-live__btn--voice ${wakewordActive ? 'is-active' : ''}`}
          onClick={onToggleWakeword}
          disabled={busy}
          title='Say "Hey CSimple, <instruction>" to create a goal and start the agent'
        >
          {wakewordActive ? '🎙 Listening…' : '🎙 Wakeword'}
        </button>
        <label className={`agent-live__toggle ${autoApprove ? 'is-on' : ''}`} title="Auto-approve tool actions that would normally prompt. Hard stops (deny, kill switch, blocked shell commands) still apply.">
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(e) => onToggleAutoApprove(e.target.checked)}
            disabled={busy}
          />
          <span>Auto-approve</span>
        </label>
      </div>

      {autoApprove && (
        <div className="agent-live__autonote">
          ⚡ Auto-approve is ON — actions run without prompting. Hard stops (deny, kill switch, blocked shell commands) still apply.
        </div>
      )}

      {error && <div className="agent-live__error">{error}</div>}

      {/* Perception strip */}
      {(perceptionCtx || lastTranscript) && (
        <div className="agent-live__perception">
          {lastTranscript && (
            <div className={`agent-live__transcript ${lastTranscript.wakeword ? 'is-wakeword' : ''}`}>
              {lastTranscript.wakeword && <span className="agent-live__wake-badge">wake</span>}
              <span>"{lastTranscript.text?.slice(0, 140)}"</span>
            </div>
          )}
          {perceptionCtx && !isSidebar && (
            <div className="agent-live__percept-ctx" title="Live environment context fed to the agent">
              {perceptionCtx}
            </div>
          )}
        </div>
      )}

      {/* Predictions panel */}
      {!isSidebar && predictions.length > 0 && (
        <div className="agent-live__predictions">
          <span className="agent-live__predictions-label">Predicted next</span>
          {predictions.map((p, i) => (
            <span key={i} className={`agent-live__pred ${p.prefetched ? 'is-prefetched' : ''}`}
              title={`${Math.round(p.probability * 100)}% confident${p.prefetched ? ' · prefetched' : ''}`}>
              {p.tool}
              <span className="agent-live__pred-pct">{Math.round(p.probability * 100)}%</span>
            </span>
          ))}
        </div>
      )}

      <div className="agent-live__body">
        <div className="agent-live__screen">
          {frame ? (
            <figure className="agent-live__frame">
              <img src={frame.url} alt="Live agent screenshot" loading="lazy" />
              <figcaption>
                {frame.w}×{frame.h}{frame.reason ? ` · ${frame.reason}` : ''} · {fmtTime(frame.ts)}
              </figcaption>
            </figure>
          ) : (
            <div className="agent-live__noframe">
              <p>No live frame yet.</p>
              <p className="agent-live__hint">Click “Refresh Frame” or start the agent to see the screen.</p>
            </div>
          )}
        </div>

        <div className="agent-live__side">
          {approvals.length > 0 && (
            <div className="agent-live__approvals">
              <h4>Pending approvals</h4>
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

          <div className="agent-live__feed">
            <h4>Activity</h4>
            {feed.length === 0 ? (
              <p className="agent-live__hint">Waiting for events…</p>
            ) : (
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
