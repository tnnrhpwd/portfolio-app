/**
 * AgentTerminal.jsx — the live console on /simple.
 *
 * What an LLM harness shows while it works: one scrolling log of every step —
 * stages, steps, tool calls with their arguments and durations, approvals,
 * messages, and how the goal ended. Two sources feed it, and it shows ONE at a
 * time (the header names which):
 *
 *   • **Local** — the desktop addon's SSE stream (`/api/agent/events`). Instant,
 *     and the only source with tool-level detail. Available while connected.
 *   • **Cloud** — the run's steps read out of the goal item. Always available
 *     when signed in, but the server flushes once per LLM round, so it is a
 *     slower, coarser view of the same run.
 *
 * Deliberately not merged: the addon mirrors its steps to the cloud when it has a
 * goal to attach them to, so showing both would print every tool twice in two
 * different shapes. The console picks the better source for the current run.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAgentEventsUrl } from '../../../services/simpleAddonApi.js';
import { getGoalAgentStatus } from '../../../services/goalAgentApi.js';
import {
  TERMINAL_MAX_LINES,
  formatClock,
  eventToLine,
  cloudStepToLine,
  mergeLines,
} from './agentTerminalUtils.js';
import './AgentTerminal.css';

/** Every event type the console maps. Named SSE events bypass `onmessage`, so a
 *  type missing from this list would never arrive — keep it in step with
 *  `eventToLine` and with the addon's `events.js` vocabulary. */
const SSE_TYPES = [
  'tool.start', 'tool.end',
  'agent.stage', 'agent.step', 'agent.message', 'agent.reply', 'agent.meta',
  'agent.skill-draft', 'agent.stopped',
  'goal.done', 'goal.failed', 'goal.blocked', 'goal.stalled',
  'approval.pending', 'approval.resolved',
  'permissions.changed', 'skill.run',
];

/** How often the cloud run is re-read. Matches GoalDetail's cadence. */
const CLOUD_POLL_MS = 2000;

export default function AgentTerminal({ token, addonConnected, currentGoalSlug, running }) {
  const [localLines, setLocalLines] = useState([]);
  const [cloudLines, setCloudLines] = useState([]);
  const [streamOpen, setStreamOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef(null);
  const lastSeqRef = useRef(0);

  const pushLocal = useCallback((raw) => {
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    if (payload?.seq) lastSeqRef.current = Math.max(lastSeqRef.current, payload.seq);
    const line = eventToLine(payload);
    if (!line) return;
    setLocalLines((prev) => mergeLines(prev, [line]));
  }, []);

  // ── Local: the addon's event stream ───────────────────────────────────────
  useEffect(() => {
    if (!addonConnected) { setStreamOpen(false); return undefined; }
    const url = getAgentEventsUrl({ sinceSeq: lastSeqRef.current });
    if (!url) return undefined;

    const es = new EventSource(url);
    es.onopen = () => setStreamOpen(true);
    es.onerror = () => setStreamOpen(false);   // EventSource retries on its own
    es.onmessage = (e) => pushLocal(e.data);
    for (const type of SSE_TYPES) {
      es.addEventListener(type, (e) => pushLocal(e.data));
    }
    return () => { es.close(); setStreamOpen(false); };
  }, [addonConnected, pushLocal]);

  // ── Cloud: the run's steps, when a cloud run is the live one ──────────────
  const cloudIsTheLiveSource = !(addonConnected && running);
  useEffect(() => {
    if (!token || !currentGoalSlug || !cloudIsTheLiveSource) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await getGoalAgentStatus(token, currentGoalSlug);
        if (cancelled) return;
        const steps = Array.isArray(res?.agent?.steps) ? res.agent.steps : [];
        if (!steps.length) return;
        const lines = steps.map((s) => cloudStepToLine(s, currentGoalSlug));
        setCloudLines((prev) => mergeLines(prev, lines));
      } catch { /* transient — the next tick tries again */ }
    };
    tick();
    const timer = setInterval(tick, CLOUD_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [token, currentGoalSlug, cloudIsTheLiveSource]);

  // ── Which console is on screen ────────────────────────────────────────────
  const localIsLive = addonConnected && running;
  const source = localIsLive && localLines.length ? 'local'
    : cloudLines.length && cloudIsTheLiveSource ? 'cloud'
      : localLines.length ? 'local'
        : cloudLines.length ? 'cloud'
          : null;
  const lines = source === 'cloud' ? cloudLines : source === 'local' ? localLines : [];
  const clear = () => { setLocalLines([]); setCloudLines([]); };

  // A terminal is read from the bottom; only a user who scrolled up should be
  // left where they are.
  useEffect(() => {
    if (!follow) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, follow]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    // Re-engage following when the user scrolls back to the end, so the toggle
    // isn't a mode they have to remember to turn off.
    if (atBottom && !follow) setFollow(true);
    if (!atBottom && follow) setFollow(false);
  };

  const sourceLabel = {
    local: 'Local agent',
    cloud: 'Cloud run',
  }[source] || (addonConnected ? 'Idle' : 'No agent');

  return (
    <section className="sd-panel sd-panel--term" aria-label="Live agent console">
      <header className="sd-panel-head">
        <h2 className="sd-panel-title">
          <span className="sd-term-dot" aria-hidden="true" data-live={localIsLive || (source === 'cloud') || undefined} />
          Live
        </h2>
        <span className="sd-badge sd-badge--term" title={
          source === 'cloud'
            ? 'Read from the run\'s own steps — the server flushes once per model round, so this updates in jumps'
            : 'Streamed from the desktop agent as it happens'
        }>
          {sourceLabel}
        </span>
        <div className="sd-term-tools">
          <button
            type="button"
            className="sd-btn sd-btn--ghost sd-btn--sm"
            onClick={() => setFollow((v) => !v)}
            aria-pressed={follow}
            title={follow ? 'Following the newest line — click to hold position' : 'Holding position — click to follow again'}
          >
            {follow ? '↓ Following' : '⏸ Held'}
          </button>
          <button
            type="button"
            className="sd-btn sd-btn--ghost sd-btn--sm"
            onClick={clear}
            disabled={!lines.length}
          >
            Clear
          </button>
        </div>
      </header>

      <div className="sd-term-body" ref={bodyRef} onScroll={onScroll} tabIndex={0} role="log" aria-live="polite">
        {!lines.length && (
          <p className="sd-term-line sd-term-line--idle">
            {addonConnected
              ? (running ? 'Waiting for the first step…' : 'Nothing yet — press ▶ Start loop, and every step lands here.')
              : 'The desktop agent is offline — install or start the addon to watch it work. A goal run started from /plans is still shown here once it reports steps.'}
          </p>
        )}
        {lines.map((line) => (
          <div key={line.key} className={`sd-term-line sd-term-line--${line.status}`}>
            <span className="sd-term-time">{formatClock(line.ts)}</span>
            <span className="sd-term-glyph" aria-hidden="true">{line.glyph}</span>
            <span className="sd-term-text" title={line.detail ? `${line.text} — ${line.detail}` : line.text}>
              {line.text}
            </span>
            {line.detail && <span className="sd-term-detail">{line.detail}</span>}
          </div>
        ))}
      </div>

      <p className="sd-term-foot">
        {streamOpen && source === 'local' ? 'Streaming live from the desktop agent.'
          : source === 'cloud' ? `Reading the run's steps (updated every ${CLOUD_POLL_MS / 1000}s).`
            : `Last ${Math.min(lines.length, TERMINAL_MAX_LINES)} lines kept.`}
      </p>
    </section>
  );
}
