/**
 * Cloud Relay Service
 * 
 * Enables the desktop addon to communicate with the portfolio backend,
 * allowing remote command execution from any device (phone, tablet, etc.).
 * 
 * Architecture:
 *   1. Frontend (on desktop) passes user JWT to addon via POST /api/cloud/auth
 *   2. Addon sends heartbeat every 30s to backend (POST /api/data/addon/heartbeat)
 *   3. Addon polls for pending commands every 2s (GET /api/data/addon/pending)
 *   4. When a command arrives, addon executes it locally (chat + tool execution)
 *   5. Addon posts result back (POST /api/data/addon/result/:commandId)
 *   6. Frontend (on phone) polls for the result
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

// Backend API URL
const BACKEND_URL = process.env.BACKEND_URL || 'https://mern-plan-web-service.onrender.com';
const API_BASE = `${BACKEND_URL}/api/data`;

// Intervals
const HEARTBEAT_INTERVAL = 30000;  // 30s
// Poll intervals. The relay used a fixed 3s interval, which was fine when the
// only remote work was "send a chat message" — one round trip and done. The
// cloud harness dispatches TOOL CALLS, and those arrive in a burst: a 6-step PC
// task paid 6 x 3s of pure polling before anything happened. The interval is now
// adaptive — see _nextPollDelay.
const POLL_INTERVAL_IDLE = 3000;   // nothing happening
const POLL_INTERVAL_ACTIVE = 500;  // work just arrived or just ran
/** How long a burst stays "hot" after the last command we saw. */
const HOT_WINDOW_MS = 15000;
/** Bounds on the server's own hint, so a bad value cannot make the addon hammer. */
const SERVER_POLL_MS_MIN = 250;
const SERVER_POLL_MS_MAX = POLL_INTERVAL_IDLE;

class CloudRelayService {
  constructor(chatHandler, options = {}) {
    this._token = null;  // User JWT for backend auth
    this._chatHandler = chatHandler; // Function to process chat locally
    this._confirmHandler = options.confirmHandler || null; // Resolve confirmations locally
    this._agentHandler = options.agentHandler || null;      // Run the agent loop locally
    // One tool call dispatched by the cloud harness. It must go through the SAME
    // registry.executeTool a local call uses, so permissions.js decides.
    this._toolHandler = options.toolHandler || null;
    // What this PC can do, for the cloud to publish back to the model. A getter
    // rather than a snapshot: tools register on boot and permissions change at
    // runtime, and a stale catalog is worse than none.
    this._toolCatalog = options.toolCatalog || null;
    this._inFlight = new Set();  // command ids currently executing (dedupe)
    // Adaptive-poll state: when work last arrived, and any cadence the server
    // asked for on the last poll (it knows a cloud turn is dispatching).
    this._lastWorkAt = 0;
    this._serverPollMs = null;
    this._heartbeatTimer = null;
    this._pollTimer = null;
    this._running = false;
    this._version = null;
    // Stable per-install identifier + platform info, supplied by the server
    // entrypoint so multiple PCs on one account can be told apart.
    this._getDeviceId = options.getDeviceId || (() => null);
    this._hostname = os.hostname();
    this._platform = os.platform();
    this._arch = os.arch();

    try {
      const pkg = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'package.json'), 'utf-8'
      ));
      this._version = pkg.version;
    } catch {}
  }

  /**
   * Set the user auth token (called when frontend connects).
   * Starts relay if not already running.
   */
  setToken(token) {
    if (!token) return;
    const hadToken = !!this._token;
    this._token = token;
    console.log('[CloudRelay] Auth token set');
    if (!hadToken) {
      this.start();
    }
  }

  /**
   * Clear auth and stop relay.
   */
  clearToken() {
    this._token = null;
    this.stop();
    console.log('[CloudRelay] Auth cleared, relay stopped');
  }

  /**
   * Register the agent-run handler (wired by mountAutomation after the
   * automation layer boots). Accepts { description } and returns the loop's
   * final result.
   */
  setAgentHandler(fn) {
    this._agentHandler = fn;
  }

  /**
   * Register the single-tool handler (wired by mountAutomation, same place as
   * the agent handler). Accepts `{ tool, args }` and returns the tool's result.
   *
   * The handler must route through the tool REGISTRY, not call a tool directly:
   * the registry is where permissions.js is enforced (category modes, dry-run,
   * the kill switch, the shell allow/deny list). A cloud turn that reached past
   * it would be a hole in a gate this machine's user set.
   */
  setToolHandler(fn) {
    this._toolHandler = fn;
  }

  /**
   * Register the capability getter: `() => { tools, policy }`.
   *
   * The cloud harness has to know two things it cannot discover on its own —
   * which tools exist on this machine, and what this machine's permission policy
   * will do with them — or it can only guess tool names and promise the user
   * outcomes it has no right to promise. Both are read live from the registry and
   * from permissions.js, so the ONLY source of truth stays here.
   */
  setToolCatalog(fn) {
    this._toolCatalog = fn;
  }

  /**
   * The catalog as it should go on the wire: bounded, because the backend stores
   * it on a heartbeat row and a malformed getter must not bloat every request.
   */
  _catalogForHeartbeat() {
    if (typeof this._toolCatalog !== 'function') return undefined;
    try {
      const { tools, policy } = this._toolCatalog() || {};
      const safeTools = (Array.isArray(tools) ? tools : [])
        .slice(0, 60)
        .map(t => ({ name: String(t?.name || '').slice(0, 40), category: String(t?.category || 'unknown').slice(0, 24) }))
        .filter(t => t.name);
      return {
        tools: safeTools,
        policy: policy && typeof policy === 'object'
          ? {
            categories: policy.categories && typeof policy.categories === 'object' ? policy.categories : {},
            dryRunMode: !!policy.dryRunMode,
            autoApproveAll: !!policy.autoApproveAll,
            globalKillSwitch: !!policy.globalKillSwitch,
          }
          : null,
      };
    } catch (err) {
      console.warn('[CloudRelay] tool catalog unavailable:', err.message);
      return undefined;
    }
  }

  /**
   * Start the heartbeat and polling loops.
   */
  start() {
    if (this._running || !this._token) return;
    this._running = true;
    console.log('[CloudRelay] Starting cloud relay...');

    // Send initial heartbeat
    this._sendHeartbeat();
    this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL);

    // Start polling for commands. A self-scheduling timeout rather than a fixed
    // interval, because the cadence depends on whether work is in flight.
    this._pollForCommands();
    this._schedulePoll();
  }

  /**
   * How long to wait before polling again.
   *
   * Two inputs, in order of authority:
   *   1. the server's hint from the last poll — «I have a turn dispatching» —
   *      which is the only way to make the FIRST command of a burst quick;
   *   2. a local hot window — anything delivered or run in the last 15s means
   *      more is probably coming, so come back fast until it goes quiet.
   *
   * The hint is clamped: a relay that polls as fast as a bad value says would
   * turn one user's turn into a queue-hammering loop.
   */
  _nextPollDelay() {
    const hinted = Number(this._serverPollMs);
    if (Number.isFinite(hinted) && hinted > 0) {
      return Math.min(Math.max(hinted, SERVER_POLL_MS_MIN), SERVER_POLL_MS_MAX);
    }
    return (Date.now() - this._lastWorkAt) < HOT_WINDOW_MS
      ? POLL_INTERVAL_ACTIVE
      : POLL_INTERVAL_IDLE;
  }

  /** Schedule the next poll at the current cadence. */
  _schedulePoll() {
    if (!this._running) return;
    clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(async () => {
      await this._pollForCommands();
      this._schedulePoll();
    }, this._nextPollDelay());
    if (this._pollTimer.unref) this._pollTimer.unref();
  }

  /**
   * Stop all relay loops.
   */
  stop() {
    this._running = false;
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    console.log('[CloudRelay] Stopped');
  }

  /**
   * Send heartbeat to backend.
   */
  async _sendHeartbeat() {
    if (!this._token) return;

    try {
      const res = await fetch(`${API_BASE}/addon/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._token}`,
        },
        body: JSON.stringify({
          deviceId: this._getDeviceId(),
          version: this._version,
          hostname: this._hostname,
          platform: `${this._platform}/${this._arch}`,
          // What the cloud may ask this machine to do, and how it will answer.
          ...(this._catalogForHeartbeat() || {}),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // If token is invalid (401), stop relay
        if (res.status === 401) {
          console.warn('[CloudRelay] Token expired or invalid, stopping relay');
          this.stop();
          this._token = null;
          return;
        }
        console.warn(`[CloudRelay] Heartbeat failed: ${res.status} ${text}`);
      }
    } catch (err) {
      // Network error — backend might be down, just log and continue
      console.warn('[CloudRelay] Heartbeat error:', err.message);
    }
  }

  /**
   * Poll backend for pending commands.
   */
  async _pollForCommands() {
    if (!this._token || !this._running) return;

    // Identify this install so the backend only hands us commands addressed
    // to THIS device (multi-device support).
    const deviceId = this._getDeviceId();
    const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';

    try {
      const res = await fetch(`${API_BASE}/addon/pending${qs}`, {
        headers: {
          'Authorization': `Bearer ${this._token}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          console.warn('[CloudRelay] Token expired during poll, stopping');
          this.stop();
          this._token = null;
        }
        return;
      }

      const data = await res.json();

      // Adopt (or drop) the server's requested cadence for the NEXT poll. Absent
      // means "I have nothing in flight" — fall back to the local hot window.
      this._serverPollMs = data.pollMs ?? null;

      if (data.commands && data.commands.length > 0) {
        // Work arrived: stay hot so the next step of the same burst is picked up
        // in half a second rather than three.
        this._lastWorkAt = Date.now();
        console.log(`[CloudRelay] Received ${data.commands.length} pending command(s)`);
        for (const cmd of data.commands) {
          // Process each command (don't await — process in background)
          this._executeCommand(cmd).catch(err => {
            console.error(`[CloudRelay] Error executing command ${cmd.id}:`, err);
          });
        }
      }
    } catch (err) {
      // Network error — silently retry next interval
    }
  }

  /**
   * Execute a command locally and post result to backend.
   */
  async _executeCommand(command) {
    const { id, type, payload } = command;

    // Guard against re-delivery: the backend only removes a command once its
    // result is posted, and our poll interval is far shorter than a long-running
    // agent command. Track in-flight ids so a command is never executed twice.
    if (this._inFlight.has(id)) return;
    this._inFlight.add(id);

    console.log(`[CloudRelay] Executing command ${id}: type=${type}`);

    try {
      let result;

      if (type === 'chat' || type === 'chat_stream') {
        // Use the addon's chat handler to process the message
        result = await this._chatHandler(payload);
      } else if (type === 'confirm') {
        // Resolve a pending action confirmation (e.g. "Yes, sleep") locally
        // and post the resulting action response back to the backend.
        if (!this._confirmHandler) throw new Error('Confirm handler not configured');
        result = await this._confirmHandler(payload);
      } else if (type === 'agent_run') {
        // Run one message through the O-O-G-P-A loop to completion and return
        // the final answer (see automation/index.js runGoalToCompletion).
        if (!this._agentHandler) throw new Error('Agent handler not configured');
        result = await this._agentHandler(payload);
      } else if (type === 'tool') {
        // ⚠️ A tool call dispatched by the CLOUD HARNESS (`/net`). It runs
        // through the same `registry.executeTool` a local agent step uses, so
        // every control this machine already has applies unchanged: category
        // modes (allow/ask/deny/dry-run), per-tool overrides, the shell
        // allow/deny list, protected paths, audit logging, and the emergency
        // kill switch. The cloud decides whether to ASK; this machine decides
        // whether it HAPPENS — one policy per machine (plan ADR-4).
        if (!this._toolHandler) throw new Error('Tool handler not configured');
        result = await this._toolHandler(payload);
      } else {
        throw new Error(`Unknown command type: ${type}`);
      }

      // Post result back to backend
      await this._postResult(id, { result });
      console.log(`[CloudRelay] Command ${id} completed successfully`);
    } catch (err) {
      console.error(`[CloudRelay] Command ${id} failed:`, err.message);
      await this._postResult(id, { error: err.message });
    } finally {
      this._inFlight.delete(id);
    }
  }

  /**
   * Post command execution result to backend.
   */
  async _postResult(commandId, data) {
    if (!this._token) return;

    try {
      const res = await fetch(`${API_BASE}/addon/result/${encodeURIComponent(commandId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._token}`,
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        console.warn(`[CloudRelay] Failed to post result for ${commandId}: ${res.status}`);
      }
    } catch (err) {
      console.warn(`[CloudRelay] Error posting result for ${commandId}:`, err.message);
    }
  }
}

module.exports = { CloudRelayService };
