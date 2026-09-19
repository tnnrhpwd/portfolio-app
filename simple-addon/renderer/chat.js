/**
 * chat.js — the addon chat window, driven by the addon's own agent loop.
 *
 * **What this is a mirror OF.** `/net`'s chat (`SimpleChat.jsx` + `ChatWindow.jsx`)
 * has one shape per turn, and it is the shape worth copying:
 *
 *   1. the user's message goes in;
 *   2. an assistant bubble appears IMMEDIATELY, empty, with a typing bubble that
 *      holds BOTH the dots and a one-line note naming what the agent is doing —
 *      because the desktop agent streams no tokens, so otherwise a minute of work
 *      is an empty bubble;
 *   3. a step list grows under it, one row per tool call, so what ran SURVIVES the
 *      turn instead of being overwritten by the next progress line;
 *   4. when the turn ends the same bubble is filled in, and when there is no answer
 *      it says WHY and WHAT IT TRIED rather than printing a raw stop token.
 *
 * The difference is the engine, not the presentation: `/net` reaches for Bedrock and
 * the cloud harness, and this window reaches for the addon's own O-O-G-P-A loop on
 * this machine (`POST /api/agent/run` + the `/api/agent/events` SSE stream).
 * Everything else — the wording, the step rows, the failure taxonomy — comes from
 * `chat/chat-format.js`, which is the addon's half of the same voice as
 * `frontend/src/utils/simpleAddon/agent{Progress,StopMessage}.js`.
 *
 * ⚠️ THREE THINGS THAT ARE EASY TO GET WRONG, and are handled here on purpose:
 *
 *   1. **The SSE stream REPLAYS its ring on subscribe** (`events.recent(20)`). Without
 *      filtering, the previous run's last tool flashes up as if it were happening now.
 *      Two filters: `sinceSeq` on the URL (so the replay is not even sent) and `since`
 *      on the event time (for the FIRST subscribe, where there is no seq to start from).
 *   2. **Named SSE events never reach `onmessage`.** Every type this window understands
 *      must be in the URL's `types` filter AND have an explicit listener. A type in one
 *      place and not the other fails silently, which is why the filter is built from
 *      `SimpleChatFormat.AGENT_PROGRESS_TYPES` and a test pins that it stays that way.
 *   3. **The status poll is a FALLBACK, not the source.** `/api/agent/status` reports a
 *      LOOP INSTANCE's own state, and a chat run lives on a POOLED loop
 *      (`_getOrCreateLoop(slug)`), so it can be describing a different run entirely.
 *      It is only consulted while no live event has arrived for this turn.
 */

(function () {
  'use strict';

  const fmt = window.SimpleChatFormat;
  const store = window.SimpleChatStore;
  const sync = window.SimpleChatSync;

  if (!fmt || !store || !sync) {
    document.body.textContent = 'Simple Chat failed to load its own scripts.';
    return;
  }

  // main.js puts the live server port on the URL — the same contract the dashboard
  // uses, because the addon server auto-increments on EADDRINUSE (3001 → 3002 …).
  const PORT = new URLSearchParams(location.search).get('port') || '3001';
  const BASE = `http://127.0.0.1:${PORT}`;

  /**
   * Event types beyond the live-note set.
   *
   * `approval.*` is not decoration: the permission gate BLOCKS the agent until a
   * pending approval is answered, so without these the window would sit on "Running
   * …" forever with no way to answer the question that is holding it up.
   */
  const EXTRA_TYPES = ['approval.pending', 'approval.resolved', 'agent.stopped', 'goal.blocked'];

  /** Ask-the-PC prompts. Only addon-required ones: this window IS the PC agent. */
  const SUGGESTIONS = [
    'Open Notepad and write a shopping list',
    'What is on my screen right now?',
    'Open Edge and go to my inbox',
    'Take a screenshot and tell me what it says',
  ];

  // ── DOM ──────────────────────────────────────────────────────────────────
  const el = (id) => document.getElementById(id);
  const messagesEl = el('messages');
  const railEl = el('rail');
  const railListEl = el('rail-list');
  const scrimEl = el('scrim');
  const railToggleEl = el('rail-toggle');
  const titleEl = el('chat-title');
  const stateEl = el('chat-state');
  const inputEl = el('input');
  const sendEl = el('send');
  const stopEl = el('stop-btn');
  const approvalsEl = el('approvals');

  // ── State ────────────────────────────────────────────────────────────────
  let stored = store.loadState(safeStorage());
  let conversations = stored.conversations;
  let deletedIds = stored.deletedIds;
  let activeId = conversations.length ? conversations[0].id : null;
  let running = false;
  let runningGoalSlug = null;
  let liveSteps = [];
  let turnStartedAt = 0;
  let lastLiveEventAt = 0;
  let lastSeq = 0;
  let stream = null;
  let pollTimer = null;
  let capabilities = null;
  /** Approval id → {toolName, args, stale}. Cards stay until answered or the run ends. */
  const approvals = new Map();

  /** localStorage can throw (disabled, or a full profile). A chat must still open. */
  function safeStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function persist() {
    store.saveState(safeStorage(), { conversations, deletedIds });
  }

  function activeConversation() {
    return conversations.find((c) => c.id === activeId) || null;
  }

  /**
   * Put a conversation into the list, replacing the one with the same id.
   *
   * ⚠️ It MUTATES `conversations` and returns the CONVERSATION, not the list. So the
   * call is `putConversation(next)` — never `conversations = putConversation(next)`,
   * which would replace the array with a single chat and make every later
   * `conversations.find(...)` a TypeError. (It did, on the first real turn.)
   */
  function putConversation(next) {
    if (!next) return null;
    const index = conversations.findIndex((c) => c.id === next.id);
    if (index === -1) conversations = [next].concat(conversations);
    else conversations = conversations.slice(0, index).concat([next], conversations.slice(index + 1));
    return next;
  }

  // ── Server helpers ───────────────────────────────────────────────────────

  async function api(path, options) {
    const res = await fetch(`${BASE}${path}`, options);
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const message = (body && (body.error || body.dataMessage)) || `${res.status} ${res.statusText}`;
      const error = new Error(message);
      // ⚠️ The STATUS has to survive: the sync's size policy retries without the agent
      // detail only on a 413, and a bare message would make that a guess at wording.
      error.status = res.status;
      throw error;
    }
    return body;
  }

  function jsonBody(payload) {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    };
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /** Escape FIRST, then add the markup back. Never the other way round. */
  function escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * A deliberate MARKDOWN SUBSET, not a parser.
   *
   * The addon renderer has no bundler, so there is no markdown library to reach for
   * and a hand-rolled full parser would be a liability. The agent's answers use
   * bold, inline code, bullets, headings and links — that is what this handles, and
   * anything else stays as written.
   */
  function renderMarkdown(text) {
    const lines = escapeHtml(text).split('\n');
    const out = [];
    let inList = false;

    const closeList = () => {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
    };

    for (const raw of lines) {
      const line = raw.trimEnd();
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      const heading = /^#{1,4}\s+(.*)$/.exec(line);

      if (bullet) {
        if (!inList) {
          out.push('<ul>');
          inList = true;
        }
        out.push(`<li>${inline(bullet[1])}</li>`);
        continue;
      }
      closeList();

      if (heading) {
        out.push(`<h3>${inline(heading[1])}</h3>`);
        continue;
      }
      if (!line.trim()) continue;
      out.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    return out.join('');
  }

  /**
   * Bold, inline code, and links — on already-escaped text.
   *
   * A link may be an http(s) URL or a local Windows path (the agent reports both).
   * `javascript:` cannot get through: the scheme is part of the match, so anything
   * else stays as literal text.
   */
  function inline(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|[a-zA-Z]:[\\/])[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  /**
   * Hand a click on a link in a reply to the main process.
   *
   * ⚠️ WITHOUT THIS a link opens a bare Electron window: this is a `file://` page, so
   * a plain anchor (or `target="_blank"`) gets a new BrowserWindow with no address bar,
   * no back button and none of the user's session — a dead end that looks like the
   * addon is broken. `/net` intercepts local paths the same way for the same reason.
   * The main process re-checks the scheme (`chat:open-external` is https-only).
   */
  function wireLinkClicks(container) {
    container.addEventListener('click', (event) => {
      const anchor = event.target && event.target.closest ? event.target.closest('a') : null;
      if (!anchor || !container.contains(anchor)) return;
      const href = anchor.getAttribute('href') || '';
      event.preventDefault();
      if (/^https?:\/\//i.test(href)) void window.simpleChat?.openExternal?.(href);
      else if (/^[a-zA-Z]:[\\/]/.test(href)) void window.simpleChat?.openPath?.(href);
    });
  }

  function formatMs(ms) {
    if (ms === null || ms === undefined) return '';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  /**
   * A bubble's/rail-row's time.
   *
   * ⚠️ Accepts BOTH an ISO string and epoch ms, and that leniency is the point: the
   * store moved to the website's ISO strings (`timestamp` / `updatedAt`) and this was
   * left reading a number, so `Number('2026-09-19T…')` was NaN and EVERY timestamp on
   * the page silently rendered as nothing. A lenient reader cannot rot the same way.
   */
  function formatWhen(value) {
    const ms = typeof value === 'number' ? value : Date.parse(String(value || ''));
    const d = new Date(Number.isFinite(ms) ? ms : NaN);
    if (!Number.isFinite(d.getTime()) || d.getTime() <= 0) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** The step list: same rows whether they are live (events) or finished (stepLog). */
  function stepListEl(steps) {
    if (!Array.isArray(steps) || !steps.length) return null;

    const wrap = document.createElement('div');
    wrap.className = 'steps';

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'steps__summary';
    summary.setAttribute('aria-expanded', 'true');
    summary.innerHTML = `<span aria-hidden="true">▾</span>${escapeHtml(fmt.summariseSteps(steps))}`;
    wrap.appendChild(summary);

    const list = document.createElement('ol');
    list.className = 'steps__list';
    summary.addEventListener('click', () => {
      const open = list.hidden;
      list.hidden = !open;
      summary.setAttribute('aria-expanded', open ? 'true' : 'false');
      summary.firstElementChild.textContent = open ? '▾' : '▸';
    });

    for (const step of steps) {
      const item = document.createElement('li');
      item.className = `steps__item steps__item--${step.status}`;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'steps__row';
      const glyph = step.status === 'ok' ? '✓' : step.status === 'error' ? '✕' : '•';
      row.innerHTML = `<span class="steps__glyph" aria-hidden="true">${glyph}</span>`
        + `<span class="steps__label">${escapeHtml(step.label || step.tool)}</span>`
        + (step.ms != null ? `<span class="steps__ms">${escapeHtml(formatMs(step.ms))}</span>` : '');
      item.appendChild(row);

      // The detail is a SIBLING of the row, never a child: the row is itself a
      // <button>, and a nested button is invalid HTML that browsers re-parent.
      let detail = null;
      row.addEventListener('click', () => {
        if (detail) {
          detail.remove();
          detail = null;
          return;
        }
        detail = document.createElement('div');
        detail.className = 'steps__detail';
        detail.innerHTML = `<div class="steps__detail-tool">${escapeHtml(step.tool)}</div>`
          + (step.detail ? `<div>${escapeHtml(step.detail)}</div>` : '')
          + (step.status === 'error' && !step.detail ? '<div class="steps__detail-error">failed</div>' : '');
        item.appendChild(detail);
      });

      list.appendChild(item);
    }

    wrap.appendChild(list);
    return wrap;
  }

  function userBubble(message) {
    const row = document.createElement('div');
    row.className = 'msg msg--user';
    const bubble = document.createElement('div');
    bubble.className = 'msg__bubble';
    const text = document.createElement('p');
    text.className = 'msg__text';
    text.textContent = message.content;
    bubble.appendChild(text);
    row.appendChild(bubble);

    const meta = document.createElement('div');
    meta.className = 'msg__meta';
    meta.textContent = formatWhen(message.timestamp);
    row.appendChild(meta);
    return row;
  }

  function assistantBubble(message, onForceAction) {
    const row = document.createElement('div');
    const isError = message.kind === 'error';
    row.className = `msg msg--assistant${isError ? ' msg--error' : ''}`;

    const bubble = document.createElement('div');
    bubble.className = `msg__bubble${message.kind === 'question' ? ' msg__bubble--question' : ''}`;

    const body = document.createElement('div');
    body.className = 'msg__body';
    body.innerHTML = renderMarkdown(message.content || '');
    wireLinkClicks(body);
    bubble.appendChild(body);

    const steps = stepListEl(message.steps);
    if (steps) bubble.appendChild(steps);

    // A low-confidence action: the addon asked rather than guessed, and the answer
    // is a RE-SEND with `forceAction` — the same contract /net uses.
    if (message.kind === 'question' && typeof onForceAction === 'function') {
      const actions = document.createElement('div');
      actions.className = 'approval__actions';
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'approval__btn approval__btn--allow';
      yes.textContent = 'Yes, do it on my PC';
      yes.addEventListener('click', () => {
        yes.disabled = true;
        // ⚠️ The bubble's own text is the QUESTION the agent asked back, so sending
        // `message.content` here asked the agent to action its own question. The
        // original request rides on `pendingAction` (see `send`).
        onForceAction(message.pendingAction || message.content);
      });
      actions.appendChild(yes);
      bubble.appendChild(actions);
    }

    row.appendChild(bubble);

    const meta = document.createElement('div');
    meta.className = 'msg__meta';
    const bits = [formatWhen(message.timestamp)];
    if (message.goalSlug) bits.push(`goal: ${message.goalSlug}`);
    meta.textContent = bits.filter(Boolean).join(' · ');
    row.appendChild(meta);

    return row;
  }

  function emptyStateEl() {
    const wrap = document.createElement('div');
    wrap.className = 'chat-empty';
    // An EMOJI, not the brand mark. The addon's UI language is emoji (the drawer's
    // views, the tray menu), and it deliberately has no logo anywhere in its
    // interface — the mark's only two surfaces are the tray and installer icons. A
    // raster logo here would be the first, and it would fight the accent tile.
    const mark = document.createElement('div');
    mark.className = 'chat-empty__mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '🤖';
    wrap.appendChild(mark);

    const h2 = document.createElement('h2');
    h2.textContent = 'Ask for something to be done on this PC';
    wrap.appendChild(h2);

    const p = document.createElement('p');
    p.textContent = capabilities && capabilities.tools
      ? `${capabilities.tools} tools are available on this machine. Every action still asks for your permission when your settings say so.`
      : 'Your message runs on the addon’s own agent loop, on this machine.';
    wrap.appendChild(p);

    const chips = document.createElement('div');
    chips.className = 'chat-empty__suggestions';
    for (const text of SUGGESTIONS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chat-empty__suggestion';
      chip.textContent = text;
      chip.addEventListener('click', () => void send(text));
      chips.appendChild(chip);
    }
    wrap.appendChild(chips);
    return wrap;
  }

  /** The typing bubble: dots AND the live note, in ONE bubble. */
  function typingEl(note, steps) {
    const wrap = document.createElement('div');
    wrap.className = 'typing';
    const bubble = document.createElement('div');
    bubble.className = 'typing__bubble';

    const dots = document.createElement('div');
    dots.className = 'typing__dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<i></i><i></i><i></i>';
    bubble.appendChild(dots);

    if (note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'typing__note';
      noteEl.setAttribute('role', 'status');
      noteEl.setAttribute('aria-live', 'polite');
      noteEl.textContent = note;
      bubble.appendChild(noteEl);
    }

    const list = stepListEl(steps);
    if (list) bubble.appendChild(list);

    wrap.appendChild(bubble);
    return wrap;
  }

  function approvalCardEl(id, entry) {
    const card = document.createElement('div');
    card.className = 'approval';

    const title = document.createElement('div');
    title.className = 'approval__title';
    title.innerHTML = '<span aria-hidden="true">🔒</span>';
    const label = document.createElement('span');
    label.textContent = entry.stale
      ? `${fmt.toolLabel(entry.toolName)} — the run has ended`
      : `May I use ${fmt.toolLabel(entry.toolName)}?`;
    title.appendChild(label);
    card.appendChild(title);

    const what = document.createElement('p');
    what.className = 'approval__what';
    what.textContent = entry.stale
      ? 'Answering now has no effect on what already ran.'
      : 'Your permission settings say this one has to be asked about.';
    card.appendChild(what);

    const args = entry.args && Object.keys(entry.args).length ? JSON.stringify(entry.args, null, 2) : '';
    if (args) {
      const pre = document.createElement('pre');
      pre.className = 'approval__args';
      pre.textContent = args;
      card.appendChild(pre);
    }

    const actions = document.createElement('div');
    actions.className = 'approval__actions';

    const answer = async (approved) => {
      allowEl.disabled = true;
      denyEl.disabled = true;
      try {
        await api('/api/automation/approve', jsonBody({ id, approved }));
      } catch (err) {
        // A 404 means it already expired or was answered elsewhere — the card is
        // simply no longer true, so drop it rather than leave a dead button.
        console.error('[chat] approve failed:', err.message);
      }
      approvals.delete(id);
      renderApprovals();
    };

    const allowEl = document.createElement('button');
    allowEl.type = 'button';
    allowEl.className = 'approval__btn approval__btn--allow';
    allowEl.textContent = entry.stale ? 'OK' : 'Allow once';
    allowEl.addEventListener('click', () => void answer(true));
    actions.appendChild(allowEl);

    const denyEl = document.createElement('button');
    denyEl.type = 'button';
    denyEl.className = 'approval__btn approval__btn--deny';
    denyEl.textContent = entry.stale ? 'Dismiss' : 'Deny';
    denyEl.addEventListener('click', () => void answer(false));
    actions.appendChild(denyEl);

    card.appendChild(actions);
    return card;
  }

  function renderApprovals() {
    approvalsEl.textContent = '';
    for (const [id, entry] of approvals) approvalsEl.appendChild(approvalCardEl(id, entry));
  }

  function renderRail() {
    railListEl.textContent = '';
    const list = store.pruneConversations(conversations, store.MAX_CONVERSATIONS);
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-rail__empty';
      empty.textContent = 'No chats yet — ask for something below.';
      railListEl.appendChild(empty);
      return;
    }

    for (const convo of list) {
      const item = document.createElement('div');
      item.className = `rail-item${convo.id === activeId ? ' rail-item--active' : ''}`;

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'rail-item__open';
      open.innerHTML = `<span class="rail-item__title">${escapeHtml(convo.title)}</span>`
        + `<span class="rail-item__when">${escapeHtml(formatWhen(convo.updatedAt))}</span>`;
      open.addEventListener('click', () => {
        activeId = convo.id;
        closeRail();
        render();
      });
      item.appendChild(open);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rail-item__del';
      del.title = 'Delete this chat';
      del.setAttribute('aria-label', `Delete ${convo.title}`);
      del.textContent = '✕';
      del.addEventListener('click', () => {
        conversations = store.deleteConversation(conversations, convo.id);
        // A delete is a TOMBSTONE, not just a removal: without it the next sync pulls
        // the conversation straight back from the cloud (or from another device that
        // never saw the delete).
        deletedIds = store.addTombstone(deletedIds, convo.id);
        if (activeId === convo.id) activeId = conversations.length ? store.mostRecent(conversations).id : null;
        persist();
        render();
        // Push NOW rather than on the next poll: the user just deleted it, and the
        // other surface is very likely open on another screen.
        void syncNow({ force: true });
      });
      item.appendChild(del);

      railListEl.appendChild(item);
    }
  }

  function renderMessages(note) {
    const convo = activeConversation();
    messagesEl.textContent = '';

    if (!convo || !convo.messages.length) {
      messagesEl.appendChild(emptyStateEl());
    } else {
      for (const message of convo.messages) {
        // ⚠️ A conversation can come from /net, and the renderer only has a shape for
        // user/assistant turns. Skipping the rest HERE (rather than filtering on the way
        // in) keeps the local copy whole — dropping a field on adopt would make the next
        // push look like a change and churn the row.
        if (message.role !== 'user' && message.role !== 'assistant') continue;
        messagesEl.appendChild(
          message.role === 'user'
            ? userBubble(message)
            : assistantBubble(message, (originalText) => void send(originalText, { forceAction: true, fromMessageId: message.id })),
        );
      }
    }

    // The live bubble is NOT a stored message: it exists only while a turn runs, and
    // the finished turn replaces it. Storing it would leave a second bubble behind.
    if (running) messagesEl.appendChild(typingEl(note, liveSteps));

    // Only follow the conversation if the user is already at the end of it. A
    // re-render is not always caused by the user — the 30 s sync poll re-renders too —
    // and yanking the view to the bottom while they read an older turn is the kind of
    // thing that makes a window feel broken.
    const distanceFromEnd = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    if (distanceFromEnd < 120) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function render(note) {
    const convo = activeConversation();
    titleEl.textContent = convo ? convo.title : 'New chat';
    renderRail();
    renderMessages(note === undefined ? lastNote() : note);
    renderApprovals();
    setComposerState();
    syncRail();
  }

  /** The last note shown, so a re-render does not blank the live line. */
  let currentNote = '';
  function lastNote() {
    return running ? currentNote : '';
  }

  function setComposerState() {
    sendEl.disabled = running || !inputEl.value.trim();
    stopEl.hidden = !running;
    inputEl.disabled = running;
  }

  // ── Cloud sync ──────────────────────────────────────────────────────────
  //
  // The addon writes to the SAME cloud row /net does (`csimple_convos_<userId>`), so a
  // thread started here shows up there and vice versa. The rules that make that safe,
  // each one here because getting it wrong loses something:
  //
  //   1. **Read first, write only for a reason.** The row can be hundreds of KB, so a
  //      poll — or a window OPEN — must not re-write it to say "nothing new". The
  //      reason is `chat-sync.pendingUpload`: a conversation the cloud lacks, turns it
  //      has not got, or a tombstone it has not recorded. (The first draft merged on
  //      every open, which pushed this device's empty placeholder at the cloud BEFORE
  //      pulling — a write on the strength of nothing.)
  //   2. **The server merges; we adopt.** It holds every other device's copy, so its
  //      answer is authoritative. `chat-store.adoptSynced` then keeps anything
  //      local-only that carries messages — an in-flight turn is absent from the answer
  //      and must not be dropped — while honouring tombstones.
  //   3. **Never mid-turn.** A merge replaces the conversation objects a running turn
  //      is holding. /net skips its poll while generating for the same reason.
  //   4. **A failure never costs local data.** Every error path leaves `conversations`
  //      alone; only the sync badge changes.

  const SYNC_POLL_MS = 30_000;
  let syncing = null;
  let syncState = { signedIn: null, status: 'idle', trimmed: false, error: null };
  const syncEl = el('chat-sync');

  function paintSync() {
    if (!syncEl) return;
    const { signedIn, status, trimmed, error } = syncState;
    let text = '';
    let tone = '';
    if (status === 'syncing') {
      text = 'Syncing…';
    } else if (status === 'unsupported') {
      // The addon build in front of this window predates the conversation routes, so
      // the 404 means "not implemented here", not "broken". A red failure for a missing
      // endpoint reads as a bug in the feature rather than a version gap.
      text = 'On this PC only — this addon build has no cloud sync yet';
      syncEl.title = 'Update the addon to sync these conversations with the web app.';
    } else if (status === 'local' || signedIn === false) {
      text = 'On this PC only — sign in on the web app to sync';
    } else if (status === 'error') {
      text = 'Sync failed — this device still has your chats';
      tone = 'bad';
      syncEl.title = error || '';
    } else if (status === 'synced') {
      // ⚠️ A trimmed sync is NOT a clean sync. Saying just "Synced" after dropping the
      // agent detail would hide the one consequence the user can act on.
      text = trimmed ? '✓ Synced (steps trimmed)' : '✓ Synced';
      tone = trimmed ? 'warn' : 'good';
      syncEl.title = trimmed
        ? 'Your history is large, so the tool steps were left out of the cloud copy. The steps are still on this PC.'
        : 'Conversations are shared with the web app.';
    }
    syncEl.textContent = text;
    syncEl.className = `chat-head__sync${tone ? ` chat-head__sync--${tone}` : ''}`;
    if (status !== 'error' && status !== 'unsupported') syncEl.removeAttribute('title');
  }

  /** Move the open thread off a conversation that another device deleted. */
  function keepActiveValid() {
    if (!activeId || !conversations.some((c) => c.id === activeId)) {
      activeId = conversations.length ? store.mostRecent(conversations).id : null;
    }
  }

  /**
   * Pull the cloud copy, and push only when this device has something it does not.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.force]  push regardless — the caller KNOWS there is
   *   something to send (the end of a turn, a delete)
   */
  async function syncNow(opts) {
    if (running) return null;             // rule 3
    if (syncing) return syncing;          // one at a time; a second caller joins it
    const force = !!(opts && opts.force);

    syncing = (async () => {
      try {
        const remote = await api('/api/conversations');

        if (remote && remote.signedIn === false) {
          syncState = { signedIn: false, status: 'local', trimmed: false, error: null };
          paintSync();
          return null;
        }

        const remoteConversations = (remote && remote.conversations) || [];
        const remoteDeletedIds = (remote && remote.deletedIds) || [];
        const shouldPush = force
          || sync.pendingUpload(conversations, remoteConversations, deletedIds, remoteDeletedIds);

        let merged;
        if (shouldPush) {
          syncState = { signedIn: true, status: 'syncing', trimmed: false, error: null };
          paintSync();
          merged = await sync.syncWithFallback({
            conversations,
            deletedIds,
            // The transport. A size refusal arrives here WITH its 413 status (see
            // `api`), which is the only signal `syncWithFallback` retries on.
            merge: (list, dead) => api('/api/conversations/merge', jsonBody({ conversations: list, deletedIds: dead })),
          });
        } else {
          // Nothing of ours to send, so the pull IS the sync. No write at all.
          merged = { conversations: remoteConversations, deletedIds: remoteDeletedIds, trimmed: false };
        }

        // The server merges and `adoptSynced` MERGES again on this side (same-id messages
        // are unioned), which is what keeps a field only this device holds — above all the
        // `steps` the cloud copy never received — from being dropped by a pull.
        conversations = store.adoptSynced(conversations, merged.conversations, merged.deletedIds);
        deletedIds = store.unionTombstones(deletedIds, merged.deletedIds);
        keepActiveValid();

        syncState = { signedIn: true, status: 'synced', trimmed: !!merged.trimmed, error: null };
        persist();
        render();
        paintSync();
        return merged;
      } catch (err) {
        // A stale token reads as "signed out" to the user, not as a failure to fix.
        const signedOut = err.status === 401 || err.status === 403;
        // ⚠️ A 404 is a VERSION GAP, not a fault: the installed addon can predate these
        // routes entirely, and it then answers 404 to every sync. Rendering that as a red
        // failure makes a working chat look broken — and it is the state a user sees
        // right after this feature ships, until their addon updates.
        const noRoute = err.status === 404;
        syncState = {
          signedIn: signedOut ? false : syncState.signedIn,
          status: noRoute ? 'unsupported' : (signedOut ? 'local' : 'error'),
          trimmed: false,
          error: err.message,
        };
        // ⚠️ `conversations` is NOT touched on any failure path — a sync problem must
        // never cost the user the turn they can see on screen.
        persist();
        paintSync();
        return null;
      } finally {
        syncing = null;
      }
    })();

    return syncing;
  }

  /** Poll for changes made on the website or another PC. */
  function startSyncPoll() {
    setInterval(() => {
      if (running) return;              // never mid-turn (rule 3)
      if (document.hidden) return;      // nothing to show, so nothing to fetch
      void syncNow();
    }, SYNC_POLL_MS);
  }

  // ── The rail (a column on wide windows, a drawer on narrow ones) ─────────

  function isNarrow() {
    try {
      return window.matchMedia('(max-width: 720px)').matches;
    } catch {
      return false;
    }
  }

  function syncRail() {
    const narrow = isNarrow();
    const open = railEl.classList.contains('chat-rail--open');
    // `inert` keeps a hidden drawer out of the tab order. The `hidden` attribute
    // alone is not enough — it does not stop a keyboard focus.
    railEl.inert = narrow ? !open : !!railEl.hidden;
    scrimEl.hidden = !(narrow && open);
    railToggleEl.setAttribute('aria-expanded', String(narrow ? open : !railEl.hidden));
  }

  function closeRail() {
    railEl.classList.remove('chat-rail--open');
    syncRail();
  }

  railToggleEl.addEventListener('click', () => {
    if (isNarrow()) railEl.classList.toggle('chat-rail--open');
    else railEl.hidden = !railEl.hidden;
    syncRail();
  });
  scrimEl.addEventListener('click', closeRail);
  window.addEventListener('resize', syncRail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRail();
  });

  // ── Head state: what this machine will actually do ───────────────────────

  function paintState(text, tone) {
    stateEl.textContent = text;
    stateEl.className = `chat-head__state${tone ? ` chat-head__state--${tone}` : ''}`;
  }

  /**
   * Say what the machine's policy is BEFORE the user asks.
   *
   * The kill switch and dry-run mode are the two settings that make every request
   * behave against expectation, and both are invisible from a chat window. A user
   * whose emergency stop is still on would otherwise watch the agent refuse
   * everything and read it as a broken feature.
   */
  async function refreshCapabilities() {
    try {
      const [perms, tools] = await Promise.all([
        api('/api/automation/permissions'),
        api('/api/automation/tools'),
      ]);
      capabilities = {
        tools: Array.isArray(tools && tools.tools) ? tools.tools.length : null,
        killSwitch: !!(perms && perms.globalKillSwitch),
        dryRun: !!(perms && perms.dryRunMode),
      };
      if (capabilities.killSwitch) paintState('Emergency stop is ON — every action will be refused', 'bad');
      else if (capabilities.dryRun) paintState('Dry run — actions are simulated, nothing is really done', 'busy');
      else paintState(`Ready${capabilities.tools ? ` · ${capabilities.tools} tools on this PC` : ''}`);
    } catch (err) {
      capabilities = null;
      paintState(`Addon server unreachable on port ${PORT} — is the tray app running?`, 'bad');
    }
  }

  // ── The live stream ─────────────────────────────────────────────────────

  function openStream() {
    closeStream();
    const types = fmt.AGENT_PROGRESS_TYPES.concat(EXTRA_TYPES).join(',');
    // `sinceSeq` so the ring's replay is not even sent. On the FIRST turn there is no
    // seq to start from, which is what the per-turn `since` time filter is for.
    const url = `${BASE}/api/agent/events?types=${encodeURIComponent(types)}&sinceSeq=${lastSeq}`;

    try {
      stream = new EventSource(url);
    } catch (err) {
      stream = null;
      return;
    }

    // ⚠️ `lastSeq` is what stops the ring's REPLAY arriving at all (`events.recent(20)`
    // re-sends the last events on every subscribe). But the addon server restarts its
    // counter, so a remembered seq from before a restart would sit ABOVE every new
    // event and silently suppress the live note for the whole turn. An error on the
    // stream is the signal that the other end may be a different process — or simply
    // that the link dropped — so the seq is forgotten and the replay is taken again.
    // That costs at most 20 replayed events, each dropped by the per-turn `since` time
    // filter; being wrong the other way costs a turn with no progress at all.
    stream.onerror = () => { lastSeq = 0; };

    const handle = (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (Number.isFinite(Number(payload.seq)) && Number(payload.seq) > lastSeq) lastSeq = Number(payload.seq);
      onEvent(payload);
    };

    // Named SSE events do NOT reach `onmessage`, so every type gets its own listener.
    for (const type of fmt.AGENT_PROGRESS_TYPES.concat(EXTRA_TYPES)) stream.addEventListener(type, handle);
  }

  function closeStream() {
    if (stream) {
      stream.close();
      stream = null;
    }
  }

  function onEvent(event) {
    if (!event || typeof event !== 'object') return;

    if (event.type === 'approval.pending') {
      approvals.set(event.id, { toolName: event.toolName, args: event.args, stale: false });
      renderApprovals();
      return;
    }
    if (event.type === 'approval.resolved') {
      approvals.delete(event.id);
      renderApprovals();
      return;
    }
    // A tool call can start before the run's own goal slug is known to us; this is
    // where the slug for Stop comes from.
    if (event.goalSlug && !runningGoalSlug) runningGoalSlug = event.goalSlug;

    if (!running) return;

    liveSteps = fmt.applyStepEvent(liveSteps, event);
    const note = fmt.progressFromEvent(event, { since: turnStartedAt });
    if (note) {
      lastLiveEventAt = Date.now();
      currentNote = note;
      renderMessages(note);
      renderApprovals();
    } else {
      // Not a note, but it may still have changed the step list (e.g. tool.end with
      // no matching start). Re-render rather than lose the row.
      renderMessages(currentNote);
    }
  }

  /**
   * The status poll — a FALLBACK only.
   *
   * It reads a loop instance's own state, and a chat run lives on a pooled loop, so
   * it can describe a different run entirely. It is skipped for the rest of the turn
   * as soon as a live event has moved the note, which is /net's rule too.
   */
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(async () => {
      if (!running || lastLiveEventAt >= turnStartedAt) return;
      try {
        const status = await api('/api/agent/status');
        const note = fmt.progressFromStatus(status);
        if (note) {
          currentNote = note;
          renderMessages(note);
        }
      } catch {
        /* the stream is the source of truth; a failed poll says nothing new */
      }
    }, 2000);
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ── A turn ──────────────────────────────────────────────────────────────

  /**
   * Send one message through the addon's agent loop.
   *
   * @param {string} text
   * @param {object} [opts]
   * @param {boolean} [opts.forceAction]  re-send a low-confidence request, run it
   * @param {string} [opts.fromMessageId] the question bubble being answered by a retry
   */
  async function send(text, opts) {
    const message = String(text || '').trim();
    if (!message || running) return;

    const options = opts || {};
    let convo = activeConversation();
    if (!convo) convo = putConversation(store.newConversation({}));
    activeId = convo.id;

    // Replace the question bubble when this is a "yes, do it" — leaving it in place
    // would show the same request twice and the second one would look unanswered.
    if (options.fromMessageId) {
      putConversation(store.updateMessage(convo, options.fromMessageId, { kind: 'answer' }));
    } else {
      putConversation(store.appendMessage(activeConversation(), { role: 'user', content: message }));
    }

    running = true;
    runningGoalSlug = null;
    liveSteps = [];
    turnStartedAt = Date.now();
    lastLiveEventAt = 0;
    currentNote = 'Starting…';

    inputEl.value = '';
    autosize();
    render('Starting…');
    openStream();
    startPoll();
    paintState('Working on it…', 'busy');

    let result = null;
    try {
      result = await api('/api/agent/run', jsonBody({ description: message, forceAction: options.forceAction === true }));
    } catch (err) {
      // A transport failure announces itself, because `runOutcome` keys the error
      // rendering off `error` — an unprefixed string counts as a success.
      result = { actionable: true, error: err.message };
    }

    closeStream();
    stopPoll();
    running = false;

    const outcome = fmt.runOutcome(result || {});
    const finishedSteps = liveSteps.length ? liveSteps : fmt.stepsFromStepLog(result && result.stepLog);

    // The finished turn is a NEW message, and it carries the step rows the live bubble
    // was showing — so the list the user watched is the list that stays.
    //
    // ⚠️ A 'question' turn remembers what the USER asked, not the question the agent
    // asked back: the "Yes, do it on my PC" button re-sends that, and re-sending the
    // bubble's own text would ask the agent to action its own question.
    const target = activeConversation() || convo;
    putConversation(store.appendMessage(target, {
      role: 'assistant',
      content: outcome.text,
      kind: outcome.kind,
      goalSlug: outcome.goalSlug,
      steps: finishedSteps,
      ...(outcome.kind === 'question' ? { pendingAction: message } : {}),
    }));

    // An approval still on screen belongs to a run that has now ended. Say so
    // instead of leaving two buttons that claim they will change something.
    let stale = false;
    for (const entry of approvals.values()) {
      if (!entry.stale) {
        entry.stale = true;
        stale = true;
      }
    }

    runningGoalSlug = null;
    currentNote = '';
    persist();
    render();
    void refreshCapabilities();
    if (stale) renderApprovals();
    // The turn is the thing worth syncing: it is what the other surface should see.
    // Forced, because this window KNOWS there is something to push — the gate that
    // would otherwise ask (`pendingUpload`) compares against a cloud copy fetched
    // before the turn existed.
    void syncNow({ force: true });
  }

  /** Stop the run. The loop cannot be interrupted mid-tool, so this is cooperative. */
  async function stop() {
    if (!running) return;
    stopEl.disabled = true;
    try {
      // With a slug this stops just this run's worker — important, because the pool
      // may have other runs going. Without one (no event carried a slug yet) there is
      // no way to name it, so the request stops everything and says so.
      await api('/api/agent/stop', jsonBody({
        ...(runningGoalSlug ? { goalSlug: runningGoalSlug } : {}),
        reason: 'stopped from the addon chat',
      }));
      currentNote = 'Stopping…';
      renderMessages(currentNote);
    } catch (err) {
      paintState(`Could not stop the run: ${err.message}`, 'bad');
    } finally {
      stopEl.disabled = false;
    }
  }

  // ── Composer ────────────────────────────────────────────────────────────

  function autosize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 200)}px`;
  }

  inputEl.addEventListener('input', () => {
    autosize();
    setComposerState();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendEl.disabled) void send(inputEl.value);
    }
  });

  el('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!sendEl.disabled) void send(inputEl.value);
  });

  stopEl.addEventListener('click', () => void stop());

  el('new-chat').addEventListener('click', () => {
    if (running) return;
    const convo = putConversation(store.newConversation({}));
    activeId = convo.id;
    persist();
    render();
    inputEl.focus();
  });

  // ── Boot ────────────────────────────────────────────────────────────────

  async function boot() {
    if (!activeConversation()) {
      const convo = putConversation(store.newConversation({}));
      activeId = convo.id;
    }
    render();
    autosize();
    inputEl.focus();
    startSyncPoll();
    // Pull first, and do NOT force: on an open there is nothing known to send, so the
    // read is the whole sync. Forcing here pushed this device's empty "New chat"
    // placeholder at the cloud BEFORE anything was pulled, which is a write bought with
    // nothing — and on a fresh install it is the very first thing that happens.
    await syncNow();
    await refreshCapabilities();

    // The capability probe answers after the first paint, and the empty state QUOTES
    // it (how many tools this machine has). Redraw the empty state so the page does
    // not sit on the vaguer sentence it could only write before the answer arrived.
    const convo = activeConversation();
    if (convo && !convo.messages.length) renderMessages();

    // An approval raised before this window opened (or before the stream existed)
    // is still holding the agent up, so ask for the queue once.
    try {
      const pending = await api('/api/automation/pending-approvals');
      for (const entry of (pending && pending.approvals) || []) {
        approvals.set(entry.id, { toolName: entry.toolName, args: entry.args, stale: false });
      }
      renderApprovals();
    } catch {
      /* no queue to read is not a problem worth showing */
    }
  }

  void boot();
})();
