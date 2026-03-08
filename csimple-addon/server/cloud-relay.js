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
const POLL_INTERVAL_IDLE = 3000;   // 3s when no active commands
const POLL_INTERVAL_ACTIVE = 1000; // 1s during active execution (unused for now)

class CloudRelayService {
  constructor(chatHandler) {
    this._token = null;  // User JWT for backend auth
    this._chatHandler = chatHandler; // Function to process chat locally
    this._heartbeatTimer = null;
    this._pollTimer = null;
    this._running = false;
    this._version = null;

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
   * Start the heartbeat and polling loops.
   */
  start() {
    if (this._running || !this._token) return;
    this._running = true;
    console.log('[CloudRelay] Starting cloud relay...');

    // Send initial heartbeat
    this._sendHeartbeat();
    this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL);

    // Start polling for commands
    this._pollForCommands();
    this._pollTimer = setInterval(() => this._pollForCommands(), POLL_INTERVAL_IDLE);
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
      clearInterval(this._pollTimer);
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
          version: this._version,
          hostname: os.hostname(),
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

    try {
      const res = await fetch(`${API_BASE}/addon/pending`, {
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
      if (data.commands && data.commands.length > 0) {
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
    console.log(`[CloudRelay] Executing command ${id}: type=${type}`);

    try {
      let result;

      if (type === 'chat' || type === 'chat_stream') {
        // Use the addon's chat handler to process the message
        result = await this._chatHandler(payload);
      } else {
        throw new Error(`Unknown command type: ${type}`);
      }

      // Post result back to backend
      await this._postResult(id, { result });
      console.log(`[CloudRelay] Command ${id} completed successfully`);
    } catch (err) {
      console.error(`[CloudRelay] Command ${id} failed:`, err.message);
      await this._postResult(id, { error: err.message });
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
