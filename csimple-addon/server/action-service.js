/**
 * Action Service - Parses natural language commands into executable action plans.
 * 
 * Generates structured action steps that the MAUI app's ActionExecutionService
 * can execute via LowLevelInputSimulator (Win32 SendInput).
 * 
 * Action step types:
 *   keyPress        - Press and release a key (e.g., Enter, Tab, Escape)
 *   keyDown         - Hold a key down (used for modifier combos)
 *   keyUp           - Release a held key
 *   typeText        - Type a string character by character
 *   hotkey          - Press a key combination (e.g., Ctrl+C)
 *   delay           - Wait for a specified duration
 *   focusWindow     - Find a window by title and bring it to foreground
 *   holdKey         - Hold a key down until a stop key is pressed by the user
 *   holdClick       - Hold a mouse button (left/right) for a duration
 *   mouseMove       - Move mouse by relative dx,dy pixels (game camera)
 *   repeatSequence  - Repeat sub-steps in a loop with stop conditions (key/visual)
 */

// Windows Virtual Key Codes (matches CSimple KeyCodes.cs VirtualKey enum)
const VK = {
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0D,
  SHIFT: 0x10,
  CONTROL: 0x11,
  ALT: 0x12,     // VK_MENU
  PAUSE: 0x13,
  CAPSLOCK: 0x14,
  ESCAPE: 0x1B,
  SPACE: 0x20,
  PAGEUP: 0x21,
  PAGEDOWN: 0x22,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  PRINTSCREEN: 0x2C,
  INSERT: 0x2D,
  DELETE: 0x2E,
  LWIN: 0x5B,
  RWIN: 0x5C,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73,
  F5: 0x74, F6: 0x75, F7: 0x76, F8: 0x77,
  F9: 0x78, F10: 0x79, F11: 0x7A, F12: 0x7B,
  // Media / browser keys
  VOLUME_MUTE: 0xAD,
  VOLUME_DOWN: 0xAE,
  VOLUME_UP: 0xAF,
  MEDIA_NEXT_TRACK: 0xB0,
  MEDIA_PREV_TRACK: 0xB1,
  MEDIA_STOP: 0xB2,
  MEDIA_PLAY_PAUSE: 0xB3,
  BROWSER_BACK: 0xA6,
  BROWSER_FORWARD: 0xA7,
  BROWSER_REFRESH: 0xA8,
};

// Map key names to virtual key codes
const KEY_MAP = {
  'enter': VK.RETURN, 'return': VK.RETURN,
  'tab': VK.TAB,
  'escape': VK.ESCAPE, 'esc': VK.ESCAPE,
  'backspace': VK.BACK,
  'delete': VK.DELETE, 'del': VK.DELETE,
  'space': VK.SPACE,
  'shift': VK.SHIFT,
  'ctrl': VK.CONTROL, 'control': VK.CONTROL,
  'alt': VK.ALT,
  'win': VK.LWIN, 'windows': VK.LWIN, 'lwin': VK.LWIN, 'super': VK.LWIN,
  'up': VK.UP, 'down': VK.DOWN, 'left': VK.LEFT, 'right': VK.RIGHT,
  'home': VK.HOME, 'end': VK.END,
  'pageup': VK.PAGEUP, 'pagedown': VK.PAGEDOWN,
  'insert': VK.INSERT,
  'capslock': VK.CAPSLOCK,
  'printscreen': VK.PRINTSCREEN,
  'pause': VK.PAUSE,
  'f1': VK.F1, 'f2': VK.F2, 'f3': VK.F3, 'f4': VK.F4,
  'f5': VK.F5, 'f6': VK.F6, 'f7': VK.F7, 'f8': VK.F8,
  'f9': VK.F9, 'f10': VK.F10, 'f11': VK.F11, 'f12': VK.F12,
  'volumemute': VK.VOLUME_MUTE, 'volumedown': VK.VOLUME_DOWN, 'volumeup': VK.VOLUME_UP,
  'medianext': VK.MEDIA_NEXT_TRACK, 'mediaprev': VK.MEDIA_PREV_TRACK,
  'mediastop': VK.MEDIA_STOP, 'mediaplaypause': VK.MEDIA_PLAY_PAUSE,
};

// Character to VK code (A-Z = 0x41-0x5A, 0-9 = 0x30-0x39)
function charToVK(ch) {
  const c = ch.toUpperCase();
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0); // 0x41-0x5A
  if (c >= '0' && c <= '9') return c.charCodeAt(0); // 0x30-0x39
  // Special characters that map to VK codes
  const specials = {
    ' ': VK.SPACE, '.': 0xBE, ',': 0xBC, ';': 0xBA, '/': 0xBF,
    '\\': 0xDC, '[': 0xDB, ']': 0xDD, '-': 0xBD, '=': 0xBB,
    "'": 0xDE, '`': 0xC0,
  };
  return specials[ch] || null;
}

// Game movement verb → key mapping (common WASD games)
const GAME_MOVEMENT = {
  'forward': { key: 'W', keyCode: 0x57, desc: 'move forward (W)' },
  'forwards': { key: 'W', keyCode: 0x57, desc: 'move forward (W)' },
  'ahead': { key: 'W', keyCode: 0x57, desc: 'move forward (W)' },
  'backward': { key: 'S', keyCode: 0x53, desc: 'move backward (S)' },
  'backwards': { key: 'S', keyCode: 0x53, desc: 'move backward (S)' },
  'back': { key: 'S', keyCode: 0x53, desc: 'move backward (S)' },
  'left': { key: 'A', keyCode: 0x41, desc: 'strafe left (A)' },
  'right': { key: 'D', keyCode: 0x44, desc: 'strafe right (D)' },
};

// Common app window title substrings for focusWindow matching
const APP_WINDOW_TITLES = {
  'minecraft': 'Minecraft',
  'chrome': 'Google Chrome',
  'edge': 'Edge',
  'firefox': 'Firefox',
  'notepad': 'Notepad',
  'vscode': 'Visual Studio Code',
  'vs code': 'Visual Studio Code',
  'code': 'Visual Studio Code',
  'discord': 'Discord',
  'spotify': 'Spotify',
  'steam': 'Steam',
  'word': 'Word',
  'excel': 'Excel',
  'powershell': 'PowerShell',
  'terminal': 'Terminal',
  'explorer': 'Explorer',
  'teams': 'Teams',
  'obs': 'OBS',
  'vlc': 'VLC',
};

// ─── Game Element Color Profiles ──────────────────────────────────────────────
// Known game elements with distinctive RGB ranges for cheap visual detection.
// Each entry has an array of color targets (multiple shades) and a match threshold.
// The LLM can reference these by name to avoid expensive OCR/vision calls.
const GAME_COLOR_PROFILES = {
  'lava': {
    description: 'Lava (Minecraft)',
    colors: [
      { r: 207, g: 92, b: 15, tolerance: 40 },   // Flowing lava orange
      { r: 230, g: 127, b: 19, tolerance: 35 },   // Bright lava surface
      { r: 252, g: 172, b: 28, tolerance: 30 },   // Lava highlight/glow
      { r: 180, g: 60, b: 10, tolerance: 35 },    // Dark lava edge
    ],
    matchThreshold: 0.02, // 2% of sampled pixels
  },
  'water': {
    description: 'Water (Minecraft)',
    colors: [
      { r: 44, g: 66, b: 201, tolerance: 40 },    // Deep water
      { r: 63, g: 118, b: 228, tolerance: 35 },   // Surface water
      { r: 36, g: 57, b: 163, tolerance: 30 },    // Dark water
    ],
    matchThreshold: 0.03,
  },
  'fire': {
    description: 'Fire (generic)',
    colors: [
      { r: 226, g: 88, b: 34, tolerance: 40 },    // Fire orange
      { r: 252, g: 186, b: 3, tolerance: 35 },    // Fire yellow
      { r: 200, g: 50, b: 20, tolerance: 35 },    // Fire red
    ],
    matchThreshold: 0.015,
  },
  'creeper': {
    description: 'Creeper (Minecraft)',
    colors: [
      { r: 76, g: 153, b: 76, tolerance: 30 },    // Creeper green body
      { r: 55, g: 125, b: 55, tolerance: 25 },    // Creeper dark green
    ],
    matchThreshold: 0.01,
  },
  'diamond': {
    description: 'Diamond ore (Minecraft)',
    colors: [
      { r: 93, g: 236, b: 218, tolerance: 35 },   // Diamond teal
      { r: 60, g: 200, b: 190, tolerance: 30 },   // Diamond dark teal
    ],
    matchThreshold: 0.005,
  },
};

class ActionService {
  constructor() {
    // Pending action queue — MAUI app polls this
    this.pendingActions = [];
    this.actionHistory = [];
    // Pending confirmations — awaiting user choice
    this.pendingConfirmations = new Map();
    // File operations sandbox — agents can only create/read/run files within this directory
    const os = require('os');
    const path = require('path');
    this.WORKSPACE_PATH = path.join(os.homedir(), 'Documents', 'CSimple', 'Workspace');
    this.SCRIPTS_PATH = path.join(this.WORKSPACE_PATH, 'scripts');
    this.FILES_PATH = path.join(this.WORKSPACE_PATH, 'files');
    // Action history persistence path
    this.HISTORY_PATH = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources', 'action-history.json');
    // Ensure dirs exist
    const fs = require('fs');
    for (const dir of [this.WORKSPACE_PATH, this.SCRIPTS_PATH, this.FILES_PATH]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    // Load persisted history
    this._loadHistory();
  }

  /**
   * Load action history from disk on startup.
   */
  _loadHistory() {
    const fs = require('fs');
    try {
      if (fs.existsSync(this.HISTORY_PATH)) {
        const data = JSON.parse(fs.readFileSync(this.HISTORY_PATH, 'utf-8'));
        this.actionHistory = Array.isArray(data) ? data.slice(-500) : []; // Keep last 500
      }
    } catch (err) {
      console.log(`[ActionService] Failed to load history: ${err.message}`);
      this.actionHistory = [];
    }
  }

  /**
   * Persist action history to disk (debounced internally).
   */
  _persistHistory() {
    const fs = require('fs');
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      try {
        const recent = this.actionHistory.slice(-500); // Keep last 500
        fs.writeFileSync(this.HISTORY_PATH, JSON.stringify(recent, null, 2), 'utf-8');
      } catch (err) {
        console.error(`[ActionService] Failed to persist history: ${err.message}`);
      }
    }, 2000); // Debounce 2s
  }

  /**
   * Validate a filename is safe (no path traversal).
   */
  _safePath(filename, baseDir) {
    const path = require('path');
    if (!filename || typeof filename !== 'string') return null;
    const cleaned = filename.replace(/\0/g, '').replace(/\.\./g, '').replace(/[/\\]/g, '').trim();
    if (!cleaned || cleaned.length > 255) return null;
    const resolved = path.resolve(baseDir, cleaned);
    if (!resolved.startsWith(path.resolve(baseDir))) return null;
    return resolved;
  }

  /**
   * Use the LLM to decide if an action needs user confirmation before executing.
   * Returns { needsConfirmation, question, options } or null on error.
   * @param {Object} actionPlan - The detected action plan
   * @param {string} originalMessage - The user's original message
   * @param {Function} callLLM - async (message, systemPrompt) => string
   */
  async checkConfirmation(actionPlan, originalMessage, callLLM) {
    const systemPrompt = `You are a safety-aware assistant controlling a real Windows PC.
Given a user command and the action that will be executed, decide if the user should confirm before it runs.

Rules for when confirmation IS needed:
- Destructive/irreversible actions: shut down, restart, hibernate, sleep, log off, delete, format
- Actions that could cause data loss: closing all windows, force-closing apps
- System-altering actions: changing system settings, installing/uninstalling
- Ambiguous commands where the user might mean something different

Rules for when confirmation is NOT needed:
- Simple, easily reversible actions: volume changes, mute/unmute, opening apps, media controls
- Typing text, pressing keys, copy/paste, undo
- Opening a browser, searching, taking screenshots
- Navigation actions: minimize, maximize, show desktop

Respond ONLY with a JSON object — NO markdown, NO code fences:
If confirmation needed:
{"needsConfirmation":true,"question":"Short question to the user","options":["Option 1","Option 2","Option 3","Option 4"]}
If no confirmation needed:
{"needsConfirmation":false}

Guidelines for options:
- Always include a "Cancel" or "No" option
- Provide 2-5 relevant alternatives the user might actually want
- Options should be concise (1-4 words each)
- Include the original intent as one option (e.g., "Yes, shut down")
- Include related alternatives (e.g., for shutdown: restart, sleep, hibernate)`;

    // Deterministic check: always confirm power commands without LLM
    const powerStep = actionPlan.steps && actionPlan.steps.find(s =>
      s.type === 'powerCommand' ||
      (s.type === 'systemCommand' && ['shutdown', 'restart', 'sleep', 'hibernate'].includes(s.command))
    );
    if (powerStep) {
      const optionsMap = {
        shutdown: ['Yes, shut down', 'Restart instead', 'Sleep instead', 'Cancel'],
        restart:  ['Yes, restart', 'Shut down instead', 'Sleep instead', 'Cancel'],
        sleep:    ['Yes, sleep', 'Hibernate instead', 'Shut down instead', 'Cancel'],
        hibernate:['Yes, hibernate', 'Sleep instead', 'Shut down instead', 'Cancel'],
      };
      const label = powerStep.command || 'perform this action';
      console.log(`[Confirmation Check] Power command detected (${label}), forcing confirmation. Step: ${JSON.stringify(powerStep)}`);
      return {
        needsConfirmation: true,
        question: `Are you sure you want to ${label} your PC?`,
        options: optionsMap[powerStep.command] || ['Yes, proceed', 'Cancel'],
      };
    }

    // Log what we're evaluating for debugging
    console.log(`[Confirmation Check] No power step found in ${(actionPlan.steps || []).length} steps: ${JSON.stringify((actionPlan.steps || []).map(s => ({ type: s.type, command: s.command })))}`);

    try {
      const prompt = `User said: "${originalMessage}"\nDetected action: ${actionPlan.description}\nAction type: ${actionPlan.intent}\nSteps: ${actionPlan.steps.map(s => s.description || s.type).join(', ')}`;

      console.log(`[Confirmation Check] Evaluating: "${originalMessage}" → ${actionPlan.intent}`);
      const response = await callLLM(prompt, systemPrompt);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('[Confirmation Check] No JSON in response, defaulting to no confirmation');
        return { needsConfirmation: false };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[Confirmation Check] Result: ${parsed.needsConfirmation ? 'NEEDS CONFIRMATION' : 'OK to proceed'}`);
      return parsed;
    } catch (err) {
      console.error('[Confirmation Check] Error:', err.message);
      return { needsConfirmation: false };
    }
  }

  /**
   * Store a pending confirmation and return its ID.
   */
  storeConfirmation(actionPlan, question, options, originalMessage) {
    const id = `confirm_${Date.now()}`;
    this.pendingConfirmations.set(id, {
      id,
      actionPlan,
      question,
      options,
      originalMessage,
      createdAt: Date.now(),
    });

    // Clean up old confirmations (older than 5 minutes)
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [key, val] of this.pendingConfirmations) {
      if (val.createdAt < cutoff) this.pendingConfirmations.delete(key);
    }

    return id;
  }

  /**
   * Retrieve and remove a pending confirmation.
   */
  getConfirmation(confirmationId) {
    const confirmation = this.pendingConfirmations.get(confirmationId);
    if (confirmation) {
      this.pendingConfirmations.delete(confirmationId);
    }
    return confirmation;
  }

  /**
   * Use the LLM to interpret which option the user selected and what action to take.
   * @param {Object} confirmation - The stored confirmation object
   * @param {string} selectedOption - The option text the user chose
   * @param {Function} callLLM - async (message, systemPrompt) => string
   * @returns {{ action: 'execute' | 'modify' | 'cancel', modifiedCommand?: string }}
   */
  async resolveConfirmation(confirmation, selectedOption, callLLM) {
    const systemPrompt = `You interpret a user's choice from a confirmation dialog for a PC action.

Original command: "${confirmation.originalMessage}"
Original action: ${confirmation.actionPlan.description}
Question asked: "${confirmation.question}"
Options presented: ${JSON.stringify(confirmation.options)}
User selected: "${selectedOption}"

Respond ONLY with JSON — NO markdown, NO code fences:
If user confirmed the original action:
{"action":"execute"}
If user wants a different action (e.g., chose "Just restart" instead of "Shut down"):
{"action":"modify","modifiedCommand":"restart"}
If user cancelled:
{"action":"cancel"}`;

    try {
      const response = await callLLM(selectedOption, systemPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { action: 'cancel' }; // Fail-safe: cancel if parse fails

      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('[Confirmation Resolve] Error:', err.message);
      return { action: 'cancel' }; // Fail-safe: cancel on error rather than executing
    }
  }

  /**
   * Detect if a message is an action command (vs. a regular chat message).
   * Returns the parsed action plan or null if it's just a chat message.
   * Supports compound commands separated by "and" or "then".
   */
  detectAction(message) {
    // Strip wake word prefixes: "Stephen, play spotify" → "play spotify"
    // Handles: "Hey Stephen, ...", "Stephen play ...", "Hey computer, ...", etc.
    let cleaned = message.replace(
      /^(?:hey\s+|ok\s+|yo\s+)?[a-z]+[,!.;:\s]+\s*/i,
      (match) => {
        // Only strip if the remainder starts with a known action verb
        const remainder = message.slice(match.length).trim();
        const actionVerbs = /^(?:play|pause|stop|next|skip|previous|open|launch|start|run|close|press|click|type|search|mute|unmute|set|lock|sleep|shut|hold|go|move|walk|mine|dig|focus|switch|wait|listen|volume|turn|restart|hibernate)/i;
        return actionVerbs.test(remainder) ? '' : match;
      }
    ).trim();

    // Strip trailing punctuation: "play spotify." → "play spotify"
    cleaned = (cleaned || message).replace(/[.,!?;:]+$/, '').trim();

    const lower = cleaned.toLowerCase();
    const original = cleaned;

    // Try compound command detection first: "unmute and set volume to 75"
    const compoundResult = this._matchCompoundCommand(lower, original);
    if (compoundResult) return compoundResult;

    // Try each single pattern matcher in priority order
    return this._detectSingleAction(lower, original);
  }

  /**
   * Detect a single action from a message.
   */
  _detectSingleAction(lower, original) {
    const matchers = [
      this._matchVisualClick,
      this._matchWait,
      this._matchPowerCommand,
      this._matchFocusWindow,
      this._matchGameActionWithConditions,
      this._matchHoldKey,
      this._matchGameAction,
      this._matchPlayService,
      this._matchOpenApp,
      this._matchCloseWindow,
      this._matchMediaControl,
      this._matchVolumeSet,
      this._matchHotkey,
      this._matchTypeText,
      this._matchPressKey,
      this._matchSearchWeb,
      this._matchSystemCommand,
    ];

    for (const matcher of matchers) {
      const result = matcher.call(this, lower, original || lower);
      if (result) return result;
    }

    return null;
  }

  /**
   * Handle compound commands: "unmute my pc and set volume to 75"
   * Splits on " and " or " then " and combines the steps.
   */
  _matchCompoundCommand(lower, original) {
    // Known action verbs for comma-delimited splitting
    const actionVerbs = 'wait|open|launch|start|run|click|tap|press|close|type|search|mute|unmute|set|lock|sleep|shut|play|pause|stop|next|skip|focus|switch|hold|go|move|walk|unpause|resume|mine|dig|attack|break|harvest|chop|punch';
    // Must contain " and "/" then " or ", <verb>" to be compound
    const splitPattern = new RegExp(`(?:\\s+(?:and|then|also|&)\\s+|,\\s+(?=(?:${actionVerbs})\\b))`);
    if (!splitPattern.test(lower)) return null;

    const parts = lower.split(splitPattern).map(p => p.trim().replace(/,+$/, '').trim()).filter(Boolean);
    if (parts.length < 2) return null;

    const actions = [];
    for (const part of parts) {
      const action = this._detectSingleAction(part, part);
      if (action) {
        actions.push(action);
      }
    }

    // Only form a compound if at least one part matched
    if (actions.length === 0) return null;

    // Merge all steps with delays between actions
    const allSteps = [];
    const descriptions = [];
    for (let i = 0; i < actions.length; i++) {
      if (i > 0) {
        allSteps.push({ type: 'delay', duration: 500, description: 'Wait between actions' });
      }
      allSteps.push(...actions[i].steps);
      descriptions.push(actions[i].description);
    }

    return {
      command: original,
      intent: 'compound',
      description: descriptions.join(', then '),
      steps: allSteps,
    };
  }

  /**
   * "set volume to 75", "volume 50", "set the volume to 100",
   * "turn the volume to 100", "change volume to 50", "put volume at 80",
   * "make the volume 60", "adjust volume to 30"
   * Uses a single setVolume step — ActionBridge sets volume via Windows Core Audio API.
   */
  _matchVolumeSet(lower) {
    const match = lower.match(/^(?:(?:set|turn|change|put|make|adjust) (?:the )?volume (?:to|at)|volume (?:to|at|=)?)\s*(\d+)(?:\s*%?)?$/);
    if (!match) return null;

    const target = Math.min(100, Math.max(0, parseInt(match[1], 10)));

    return {
      command: lower,
      intent: 'volume_set',
      description: `Setting volume to ${target}%`,
      steps: [
        { type: 'setVolume', volumeLevel: target, description: `Set volume to ${target}%` },
      ],
    };
  }

  /**
   * Queue an action for execution by the MAUI app.
   * Returns the action plan with an ID for tracking.
   */
  queueAction(actionPlan) {
    const action = {
      id: Date.now().toString(),
      ...actionPlan,
      status: 'pending',
      queuedAt: new Date().toISOString(),
    };
    this.pendingActions.push(action);
    this.actionHistory.push(action);
    this._persistHistory();

    // Signal to MAUI app via stdout (WebAppHostService intercepts this)
    const payload = JSON.stringify(action);
    console.log(`[ACTION_EXECUTE]${payload}`);

    return action;
  }

  /**
   * Get and clear pending actions (called by MAUI app polling endpoint)
   */
  getPendingActions() {
    const actions = [...this.pendingActions];
    this.pendingActions = [];
    return actions;
  }

  /**
   * Mark an action as completed (called by MAUI app after execution)
   */
  completeAction(actionId, success, error = null) {
    const action = this.actionHistory.find(a => a.id === actionId);
    if (action) {
      action.status = success ? 'completed' : 'failed';
      action.completedAt = new Date().toISOString();
      if (error) action.error = error;
      this._persistHistory();
    }
    // Also remove from pending if still there
    this.pendingActions = this.pendingActions.filter(a => a.id !== actionId);
    return action;
  }

  /**
   * Get recent action history
   */
  getHistory(limit = 20) {
    return this.actionHistory.slice(-limit);
  }

  // ─── File Operations (Sandboxed) ──────────────────────────────────────────

  /**
   * Create a file in the sandboxed workspace.
   * @param {string} filename - File to create (in Workspace/files/)
   * @param {string} content - File content
   * @param {string} [subdir='files'] - Subdirectory ('files' or 'scripts')
   * @returns {{ success: boolean, path?: string, error?: string }}
   */
  createFile(filename, content, subdir = 'files') {
    const fs = require('fs');
    const baseDir = subdir === 'scripts' ? this.SCRIPTS_PATH : this.FILES_PATH;
    const filePath = this._safePath(filename, baseDir);
    if (!filePath) return { success: false, error: 'Invalid filename' };
    if (Buffer.byteLength(content || '', 'utf-8') > 1024 * 1024) {
      return { success: false, error: 'Content exceeds 1MB limit' };
    }
    try {
      const isUpdate = fs.existsSync(filePath);
      fs.writeFileSync(filePath, content || '', 'utf-8');
      return { success: true, path: filePath, action: isUpdate ? 'updated' : 'created' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Read a file from the sandboxed workspace.
   * @param {string} filename
   * @param {string} [subdir='files']
   * @returns {{ success: boolean, content?: string, error?: string }}
   */
  readFile(filename, subdir = 'files') {
    const fs = require('fs');
    const baseDir = subdir === 'scripts' ? this.SCRIPTS_PATH : this.FILES_PATH;
    const filePath = this._safePath(filename, baseDir);
    if (!filePath) return { success: false, error: 'Invalid filename' };
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * List files in the sandboxed workspace.
   * @param {string} [subdir='files']
   * @returns {{ success: boolean, files?: string[], error?: string }}
   */
  listFiles(subdir = 'files') {
    const fs = require('fs');
    const baseDir = subdir === 'scripts' ? this.SCRIPTS_PATH : this.FILES_PATH;
    try {
      if (!fs.existsSync(baseDir)) return { success: true, files: [] };
      const files = fs.readdirSync(baseDir)
        .filter(f => !fs.statSync(require('path').join(baseDir, f)).isDirectory())
        .map(f => {
          const stat = fs.statSync(require('path').join(baseDir, f));
          return { filename: f, size: stat.size, modified: stat.mtime.toISOString() };
        });
      return { success: true, files };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete a file from the sandboxed workspace.
   * @param {string} filename
   * @param {string} [subdir='files']
   * @returns {{ success: boolean, error?: string }}
   */
  deleteFile(filename, subdir = 'files') {
    const fs = require('fs');
    const baseDir = subdir === 'scripts' ? this.SCRIPTS_PATH : this.FILES_PATH;
    const filePath = this._safePath(filename, baseDir);
    if (!filePath) return { success: false, error: 'Invalid filename' };
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Execute a script from the sandboxed scripts directory.
   * Supports .py (Python), .js (Node.js), .ps1 (PowerShell), .bat/.cmd (batch).
   * Runs with a 30-second timeout and captures stdout/stderr.
   * @param {string} filename - Script filename in Workspace/scripts/
   * @param {string[]} [args=[]] - Command-line arguments
   * @returns {Promise<{ success: boolean, stdout?: string, stderr?: string, exitCode?: number, error?: string }>}
   */
  async executeScript(filename, args = []) {
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');

    const filePath = this._safePath(filename, this.SCRIPTS_PATH);
    if (!filePath) return { success: false, error: 'Invalid script filename' };
    if (!fs.existsSync(filePath)) return { success: false, error: 'Script not found' };

    const ext = path.extname(filename).toLowerCase();
    const ALLOWED_EXTENSIONS = ['.py', '.js', '.ps1', '.bat', '.cmd'];
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return { success: false, error: `Unsupported script type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
    }

    // Sanitize args — no shell injection
    const safeArgs = args.map(a => String(a).slice(0, 1000));

    let command, commandArgs;
    switch (ext) {
      case '.py':
        command = process.platform === 'win32' ? 'python' : 'python3';
        commandArgs = [filePath, ...safeArgs];
        break;
      case '.js':
        command = 'node';
        commandArgs = [filePath, ...safeArgs];
        break;
      case '.ps1':
        command = 'powershell';
        commandArgs = ['-ExecutionPolicy', 'Bypass', '-File', filePath, ...safeArgs];
        break;
      case '.bat':
      case '.cmd':
        command = 'cmd';
        commandArgs = ['/c', filePath, ...safeArgs];
        break;
    }

    const TIMEOUT_MS = 30000; // 30 seconds

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const child = spawn(command, commandArgs, {
        cwd: this.WORKSPACE_PATH,
        timeout: TIMEOUT_MS,
        env: { ...process.env, CSIMPLE_WORKSPACE: this.WORKSPACE_PATH },
        windowsHide: true,
      });

      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > 100000) { // 100KB output cap
          child.kill();
          killed = true;
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 50000) { // 50KB error cap
          child.kill();
          killed = true;
        }
      });

      child.on('close', (code) => {
        const result = {
          success: code === 0 && !killed,
          stdout: stdout.slice(0, 100000),
          stderr: stderr.slice(0, 50000),
          exitCode: code,
        };
        if (killed) result.error = 'Output exceeded size limit or timed out';
        resolve(result);
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message, stdout, stderr });
      });

      // Fallback timeout (in case child_process timeout doesn't fire)
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
          killed = true;
        }
      }, TIMEOUT_MS + 1000);
    });
  }

  // ─── Pattern Matchers ──────────────────────────────────────────────────────

  /**
   * "click play", "click on submit", "click the X button", "right click save",
   * "tap ok", "click close", "double click my file"
   */
  _matchVisualClick(lower, original) {
    // Match: [right|double] click [on|the] <target>
    const match = lower.match(
      /^(?:(right|double)\s+)?(?:click|tap|press)\s+(?:on\s+)?(?:the\s+)?(.+)$/
    );
    if (!match) return null;

    const modifier = match[1] || null;  // 'right', 'double', or null
    const target = match[2].trim().replace(/\s+button$/i, '').replace(/[.!?,;:]+$/, '');

    if (!target) return null;

    const button = modifier === 'right' ? 'right' : 'left';
    const isDouble = modifier === 'double';

    const steps = [
      { type: 'visualClick', target, button, description: `Find and click "${target}"` },
    ];

    // For double-click, add a second click with a short delay
    if (isDouble) {
      steps.push({ type: 'delay', duration: 80, description: 'Double-click interval' });
      steps.push({ type: 'visualClick', target, button, description: `Second click for double-click` });
    }

    return {
      command: original,
      intent: 'visual_click',
      description: `${isDouble ? 'Double-clicking' : modifier === 'right' ? 'Right-clicking' : 'Clicking'} "${target}" on screen`,
      steps,
    };
  }

  /**
   * "open edge", "open notepad", "launch chrome", "start calculator", "run cmd"
   */

  /**
   * "wait 5 seconds", "wait for 10 seconds", "pause for 2 minutes", "delay 500 ms"
   */
  _matchWait(lower) {
    const match = lower.match(/^(?:wait|pause|delay)\s+(?:for\s+)?(\d+)\s*(seconds?|secs?|minutes?|mins?|ms|milliseconds?)?$/i);
    if (!match) return null;

    let duration = parseInt(match[1], 10);
    const unit = (match[2] || 'seconds').toLowerCase();

    if (unit.startsWith('min')) {
      duration *= 60000;
    } else if (unit === 'ms' || unit.startsWith('milli')) {
      // already ms
    } else {
      duration *= 1000; // seconds
    }

    const label = match[2] ? `${match[1]} ${match[2]}` : `${match[1]} seconds`;

    return {
      command: lower,
      intent: 'wait',
      description: `Waiting ${label}`,
      steps: [
        { type: 'delay', duration, description: `Wait ${label}` },
      ],
    };
  }

  /**
   * "focus minecraft", "switch to minecraft", "bring up chrome", "go to discord",
   * "bring minecraft to focus", "activate notepad"
   */
  _matchFocusWindow(lower, original) {
    const match = lower.match(
      /^(?:focus|switch to|bring up|go to|activate|bring\s+.+\s+to\s+(?:focus|front|foreground)|alt[- ]?tab to)\s+(.+)$/
    );
    if (!match) return null;

    let appName = match[1].trim()
      .replace(/\s+(?:window|app|application)$/i, '')
      .replace(/\bto\s+(?:focus|front|foreground)$/i, '')
      .trim();

    if (!appName) return null;

    // Resolve common aliases to window title substrings
    const windowTitle = APP_WINDOW_TITLES[appName] || appName;

    return {
      command: original || lower,
      intent: 'focus_window',
      description: `Bringing ${windowTitle} to focus`,
      steps: [
        { type: 'focusWindow', windowTitle, description: `Focus ${windowTitle} window` },
      ],
    };
  }

  /**
   * "hold w", "hold w until I press escape", "hold space until escape",
   * "hold shift until I press space", "hold a until I stop"
   */
  _matchHoldKey(lower, original) {
    const match = lower.match(
      /^hold\s+(\w+)(?:\s+(?:until|till|untill)\s+(?:i\s+)?(?:press\s+)?(.+?))?$/
    );
    if (!match) return null;

    const holdKeyName = match[1].toLowerCase();
    const holdVK = KEY_MAP[holdKeyName] || charToVK(holdKeyName);
    if (!holdVK) return null;

    // Default stop key is Escape if not specified
    let untilKeyName = 'escape';
    let untilVK = VK.ESCAPE;

    if (match[2]) {
      const stopStr = match[2].trim()
        .replace(/^(?:i\s+)?(?:press\s+)?/, '')
        .replace(/\s*(?:key|button|again|stop|is pressed)$/i, '')
        .replace(/[.,!?;:]+$/, '')
        .trim()
        .toLowerCase();
      if (stopStr && stopStr !== 'stop' && stopStr !== 'done') {
        const resolvedVK = KEY_MAP[stopStr] || charToVK(stopStr);
        if (resolvedVK) {
          untilKeyName = stopStr;
          untilVK = resolvedVK;
        }
      }
    }

    return {
      command: original || lower,
      intent: 'hold_key',
      description: `Holding ${holdKeyName.toUpperCase()} until ${untilKeyName} is pressed`,
      steps: [
        {
          type: 'holdKey',
          key: holdKeyName.toUpperCase(),
          keyCode: holdVK,
          untilKey: untilKeyName,
          untilKeyCode: untilVK,
          description: `Hold ${holdKeyName.toUpperCase()} (press ${untilKeyName} to stop)`,
        },
      ],
    };
  }

  /**
   * Game movement: "go forward", "move backward", "walk left", "run right",
   * "go forward until escape", "move forward until I press escape",
   * "unpause" (press escape in a game context)
   */
  _matchGameAction(lower, original) {
    // "unpause" / "unpause [game]" / "resume [game]"
    const unpauseMatch = lower.match(/^(?:unpause|resume|resume game|unpause game)(?:\s+(.+))?$/);
    if (unpauseMatch) {
      const steps = [];
      const appName = unpauseMatch[1]?.trim();

      if (appName) {
        const windowTitle = APP_WINDOW_TITLES[appName] || appName;
        steps.push({ type: 'focusWindow', windowTitle, description: `Focus ${windowTitle}` });
        steps.push({ type: 'delay', duration: 300, description: 'Wait for window focus' });
      }

      steps.push({
        type: 'keyPress',
        key: 'Escape',
        keyCode: VK.ESCAPE,
        description: 'Press Escape to unpause',
      });

      return {
        command: original || lower,
        intent: 'game_action',
        description: appName ? `Unpausing ${appName}` : 'Pressing Escape to unpause',
        steps,
      };
    }

    // "go forward [until ...]", "move backward [until ...]", "walk left [until ...]"
    const moveMatch = lower.match(
      /^(?:go|move|walk|run|strafe|head)\s+(forward|forwards|ahead|backward|backwards|back|left|right)(?:\s+(?:until|till)\s+(?:(?:i\s+)?(?:press\s+)?(.+?)))?$/
    );
    if (moveMatch) {
      const direction = moveMatch[1].toLowerCase();
      const movement = GAME_MOVEMENT[direction];
      if (!movement) return null;

      // Default stop key is Escape
      let untilKeyName = 'escape';
      let untilVK = VK.ESCAPE;

      if (moveMatch[2]) {
        const stopStr = moveMatch[2].trim()
          .replace(/^(?:i\s+)?(?:press\s+)?/, '')
          .replace(/\s*(?:key|button|again|stop|is pressed)$/i, '')
          .replace(/[.,!?;:]+$/, '')
          .trim()
          .toLowerCase();
        if (stopStr && stopStr !== 'stop' && stopStr !== 'done') {
          const resolvedVK = KEY_MAP[stopStr] || charToVK(stopStr);
          if (resolvedVK) {
            untilKeyName = stopStr;
            untilVK = resolvedVK;
          }
        }
      }

      return {
        command: original || lower,
        intent: 'game_movement',
        description: `${movement.desc} until ${untilKeyName} is pressed`,
        steps: [
          {
            type: 'holdKey',
            key: movement.key,
            keyCode: movement.keyCode,
            untilKey: untilKeyName,
            untilKeyCode: untilVK,
            description: `Hold ${movement.key} to ${movement.desc} (press ${untilKeyName} to stop)`,
          },
        ],
      };
    }

    return null;
  }

  /**
   * Complex game actions with visual stop conditions and repeating sequences:
   * "mine forward unless you see lava or I press escape"
   * "mine forward until you see water or I press escape"
   * "dig down unless you see lava"
   * "mine blocks until I press escape"
   * "attack forward unless you see lava or I stop"
   *
   * This produces a `repeatSequence` step with sub-steps (hold click + move)
   * and stopConditions (key press + color detection).
   */
  _matchGameActionWithConditions(lower, original) {
    // Match: [action] [direction?] (unless|until) (you see [thing]) (or|and) (I press [key])
    const match = lower.match(
      /^(?:mine|dig|attack|break|harvest|chop|punch)\s*(?:blocks?\s*)?(?:(forward|forwards|ahead|backward|backwards|back|left|right|down|up))?\s+(?:unless|until|till)\s+(.+)$/
    );
    if (!match) return null;

    const directionStr = (match[1] || 'forward').toLowerCase();
    const conditionsStr = match[2].trim()
      .replace(/[.,!?;:]+$/, '')  // Strip trailing punctuation
      .trim();

    // Parse stop conditions from the conditions string
    // Split on " or " / " and " to get individual conditions
    const condParts = conditionsStr.split(/\s+(?:or|and)\s+/).map(s => s.trim()).filter(Boolean);

    const stopConditions = [];
    let hasKeyStop = false;

    for (const part of condParts) {
      // Visual condition: "you see lava", "you see water", "there's fire", "you spot lava"
      const visualMatch = part.match(/^(?:you\s+)?(?:see|spot|detect|notice|find|there'?s?\s*)\s*(.+)$/i);
      if (visualMatch) {
        const thingName = visualMatch[1].trim().toLowerCase()
          .replace(/[.,!?;:]+$/, '');

        // Look up known color profile
        const profile = GAME_COLOR_PROFILES[thingName];
        if (profile) {
          console.log(`[GameAction] Using optimized color detection for "${thingName}" (${profile.colors.length} color targets)`);
          stopConditions.push({
            type: 'colorDetect',
            description: profile.description,
            colors: profile.colors,
            matchThreshold: profile.matchThreshold,
          });
        } else {
          // Unknown visual target — use a generic warm color check and log a warning
          console.log(`[GameAction] Unknown visual target "${thingName}" — no color profile, using generic warm color detection`);
          stopConditions.push({
            type: 'colorDetect',
            description: thingName,
            colors: [
              { r: 220, g: 100, b: 30, tolerance: 50 },  // Generic warm/danger color
            ],
            matchThreshold: 0.03,
          });
        }
        continue;
      }

      // Key condition: "I press escape", "I press space", "i stop", "i press esc"
      const keyMatch = part.match(/^(?:i\s+)?(?:press\s+|hit\s+|stop|quit|done)(.*)$/i);
      if (keyMatch) {
        let keyName = keyMatch[1]?.trim().toLowerCase()
          .replace(/[.,!?;:]+$/, '') || 'escape';
        if (keyName === '' || keyName === 'stop' || keyName === 'done') keyName = 'escape';
        const keyCode = KEY_MAP[keyName] || charToVK(keyName) || VK.ESCAPE;
        stopConditions.push({
          type: 'keyPress',
          keyCode,
          description: keyName,
        });
        hasKeyStop = true;
        continue;
      }
    }

    // Always ensure Escape is a stop key
    if (!hasKeyStop) {
      stopConditions.push({
        type: 'keyPress',
        keyCode: VK.ESCAPE,
        description: 'escape',
      });
    }

    // Build the repeating sub-steps based on the action + direction
    const subSteps = [];

    if (directionStr === 'down') {
      // Mining down: look down (mouse move) + hold click (mine) + move forward
      subSteps.push({ type: 'mouseMove', dx: 0, dy: 300, description: 'Look down' });
      subSteps.push({ type: 'delay', duration: 100, description: 'Camera settle' });
      subSteps.push({ type: 'holdClick', button: 'left', duration: 1500, description: 'Mine block below' });
      subSteps.push({ type: 'delay', duration: 200, description: 'Block break delay' });
    } else if (directionStr === 'up') {
      // Mining up: look up + mine
      subSteps.push({ type: 'mouseMove', dx: 0, dy: -300, description: 'Look up' });
      subSteps.push({ type: 'delay', duration: 100, description: 'Camera settle' });
      subSteps.push({ type: 'holdClick', button: 'left', duration: 1500, description: 'Mine block above' });
      subSteps.push({ type: 'delay', duration: 200, description: 'Block break delay' });
    } else {
      // Mining horizontally: hold click to mine block in front + tap movement key
      const movement = GAME_MOVEMENT[directionStr] || GAME_MOVEMENT['forward'];
      subSteps.push({ type: 'holdClick', button: 'left', duration: 1200, description: `Mine block (${movement.desc})` });
      subSteps.push({ type: 'delay', duration: 200, description: 'Block break delay' });
      subSteps.push({ type: 'keyPress', key: movement.key, keyCode: movement.keyCode, duration: 250, description: `Step ${directionStr}` });
      subSteps.push({ type: 'delay', duration: 200, description: 'Step settle' });
    }

    const dirDesc = directionStr || 'forward';
    const condDesc = stopConditions.map(c =>
      c.type === 'keyPress' ? `${c.description} pressed` :
      c.type === 'colorDetect' ? `${c.description} detected` : c.description
    ).join(' or ');

    return {
      command: original || lower,
      intent: 'game_action_repeat',
      description: `Mining ${dirDesc} (stop: ${condDesc})`,
      steps: [
        {
          type: 'repeatSequence',
          subSteps,
          stopConditions,
          maxIterations: 200,
          description: `Repeat: mine ${dirDesc} until ${condDesc}`,
        },
      ],
    };
  }

  /**
   * "play spotify", "play soundcloud", "play youtube music", "play pandora",
   * "open spotify and play", "start spotify music", "listen to spotify",
   * "play music on spotify", "play some music on soundcloud"
   */
  _matchPlayService(lower, original) {
    // Music service definitions: name → { url, playDelay, playAction }
    const MUSIC_SERVICES = {
      'spotify': {
        url: 'https://open.spotify.com',
        title: 'Spotify',
        playDelay: 3000,
        playAction: { type: 'keyPress', key: 'Space', keyCode: VK.SPACE, description: 'Press Space to play' },
      },
      'soundcloud': {
        url: 'https://soundcloud.com/discover',
        title: 'SoundCloud',
        playDelay: 3000,
        playAction: { type: 'keyPress', key: 'Space', keyCode: VK.SPACE, description: 'Press Space to play' },
      },
      'youtube music': {
        url: 'https://music.youtube.com',
        title: 'YouTube Music',
        playDelay: 3500,
        playAction: { type: 'keyPress', key: 'Space', keyCode: VK.SPACE, description: 'Press Space to play' },
      },
      'youtube': {
        url: 'https://www.youtube.com',
        title: 'YouTube',
        playDelay: 3000,
        playAction: { type: 'keyPress', key: 'K', keyCode: 0x4B, description: 'Press K to play (YouTube shortcut)' },
      },
      'pandora': {
        url: 'https://www.pandora.com',
        title: 'Pandora',
        playDelay: 3500,
        playAction: { type: 'keyPress', key: 'Space', keyCode: VK.SPACE, description: 'Press Space to play' },
      },
      'apple music': {
        url: 'https://music.apple.com',
        title: 'Apple Music',
        playDelay: 4000,
        playAction: { type: 'keyPress', key: 'Space', keyCode: VK.SPACE, description: 'Press Space to play' },
      },
      'tidal': {
        url: 'https://listen.tidal.com',
        title: 'Tidal',
        playDelay: 3500,
        playAction: { type: 'keyPress', key: 'Space', keyCode: VK.SPACE, description: 'Press Space to play' },
      },
      'deezer': {
        url: 'https://www.deezer.com',
        title: 'Deezer',
        playDelay: 3500,
        playAction: { type: 'keyPress', key: 'Space', keyCode: VK.SPACE, description: 'Press Space to play' },
      },
    };

    // Match patterns:
    // "play spotify", "play soundcloud", "play youtube music"
    // "play music on spotify", "play some music on soundcloud"
    // "open spotify and play", "start spotify music"
    // "listen to spotify", "listen on soundcloud"
    const match = lower.match(
      /^(?:play|listen to|listen on|start)\s+(?:(?:some |my )?(?:music |songs? )?(?:on |from )?)?(.+?)(?:\s+(?:and play))?$/
    );
    if (!match) return null;

    let rawName = match[1].trim()
      .replace(/\s+(?:and play|and start|and listen)$/i, '')
      .trim();

    // Try full name first (e.g. "youtube music"), then without trailing "music"
    let serviceName = rawName;
    let service = MUSIC_SERVICES[serviceName];
    if (!service) {
      serviceName = rawName.replace(/\s+music$/i, '').trim();
      service = MUSIC_SERVICES[serviceName];
    }
    if (!service) return null;

    // First try to focus existing window, then fall back to opening the URL
    const steps = [
      // Try opening the URL in default browser
      { type: 'keyPress', key: 'LWin', keyCode: VK.LWIN, description: 'Press Windows key' },
      { type: 'delay', duration: 600, description: 'Wait for Start menu' },
      { type: 'typeText', text: 'edge', description: 'Type "edge"' },
      { type: 'delay', duration: 800, description: 'Wait for search' },
      { type: 'keyPress', key: 'Return', keyCode: VK.RETURN, description: 'Open browser' },
      { type: 'delay', duration: 2000, description: 'Wait for browser' },
      // Navigate to the service URL
      { type: 'hotkey', keys: ['Ctrl', 'L'], keyCodes: [VK.CONTROL, 0x4C], description: 'Focus address bar (Ctrl+L)' },
      { type: 'delay', duration: 300, description: 'Wait for address bar' },
      { type: 'typeText', text: service.url, description: `Navigate to ${service.title}` },
      { type: 'keyPress', key: 'Return', keyCode: VK.RETURN, description: 'Go to URL' },
      { type: 'delay', duration: service.playDelay, description: `Wait for ${service.title} to load` },
      // Play
      service.playAction,
    ];

    return {
      command: original || lower,
      intent: 'play_service',
      description: `Opening ${service.title} and playing music`,
      steps,
    };
  }

  _matchOpenApp(lower, original) {
    const match = lower.match(/^(?:open|launch|start|run)\s+(.+)$/);
    if (!match) return null;

    const appName = match[1].trim();

    // Common app aliases
    const appAliases = {
      'edge': 'microsoft edge',
      'chrome': 'google chrome',
      'firefox': 'mozilla firefox',
      'notepad': 'notepad',
      'calculator': 'calculator',
      'calc': 'calculator',
      'cmd': 'cmd',
      'command prompt': 'cmd',
      'terminal': 'windows terminal',
      'powershell': 'powershell',
      'explorer': 'file explorer',
      'file explorer': 'file explorer',
      'files': 'file explorer',
      'settings': 'settings',
      'task manager': 'task manager',
      'paint': 'paint',
      'word': 'word',
      'excel': 'excel',
      'outlook': 'outlook',
      'teams': 'microsoft teams',
      'spotify': 'spotify',
      'discord': 'discord',
      'vscode': 'visual studio code',
      'vs code': 'visual studio code',
      'code': 'visual studio code',
      'snipping tool': 'snipping tool',
      'screenshot': 'snipping tool',
    };

    const searchTerm = appAliases[appName] || appName;

    return {
      command: original,
      intent: 'open_app',
      description: `Opening ${searchTerm}`,
      steps: [
        { type: 'keyPress', key: 'LWin', keyCode: VK.LWIN, description: 'Press Windows key' },
        { type: 'delay', duration: 600, description: 'Wait for Start menu' },
        { type: 'typeText', text: searchTerm, description: `Type "${searchTerm}"` },
        { type: 'delay', duration: 800, description: 'Wait for search results' },
        { type: 'keyPress', key: 'Return', keyCode: VK.RETURN, description: 'Press Enter to launch' },
      ],
    };
  }

  /**
   * "close window", "close this", "close app"
   */
  _matchCloseWindow(lower) {
    if (!lower.match(/^close\s+(window|this|app|it|the window|the app|application)$/)) return null;

    return {
      command: lower,
      intent: 'close_window',
      description: 'Closing active window',
      steps: [
        { type: 'hotkey', keys: ['Alt', 'F4'], keyCodes: [VK.ALT, VK.F4], description: 'Alt+F4' },
      ],
    };
  }

  /**
   * Volume, mute, media playback, brightness controls.
   * Matches: "mute", "mute my pc", "unmute", "volume up", "turn up the volume",
   *          "volume down", "play", "pause", "next track", "skip", etc.
   */
  _matchMediaControl(lower) {
    // --- Mute / Unmute ---
    if (/^(?:mute|unmute|toggle mute|mute (?:my |the )?(?:pc|computer|sound|audio|volume|speakers?))$/.test(lower) ||
        /^(?:unmute|unmute (?:my |the )?(?:pc|computer|sound|audio|volume|speakers?))$/.test(lower)) {
      return {
        command: lower,
        intent: 'media_control',
        description: lower.startsWith('unmute') ? 'Unmuting audio (toggle mute)' : 'Muting audio',
        steps: [
          { type: 'keyPress', key: 'VolumeMute', keyCode: VK.VOLUME_MUTE, description: 'Press Volume Mute key' },
        ],
      };
    }

    // --- Volume Up ---
    const volUpMatch = lower.match(/^(?:volume up|turn (?:up|up the) (?:volume|sound|audio)|(?:increase|raise|louder|turn up)(?: (?:the )?(?:volume|sound|audio))?)$/);
    if (volUpMatch) {
      return {
        command: lower,
        intent: 'media_control',
        description: 'Turning volume up',
        steps: [
          { type: 'keyPress', key: 'VolumeUp', keyCode: VK.VOLUME_UP, description: 'Press Volume Up' },
          { type: 'keyPress', key: 'VolumeUp', keyCode: VK.VOLUME_UP, description: 'Press Volume Up' },
          { type: 'keyPress', key: 'VolumeUp', keyCode: VK.VOLUME_UP, description: 'Press Volume Up' },
          { type: 'keyPress', key: 'VolumeUp', keyCode: VK.VOLUME_UP, description: 'Press Volume Up' },
          { type: 'keyPress', key: 'VolumeUp', keyCode: VK.VOLUME_UP, description: 'Press Volume Up' },
        ],
      };
    }

    // --- Volume Down ---
    const volDownMatch = lower.match(/^(?:volume down|turn (?:down|down the) (?:volume|sound|audio)|(?:decrease|lower|quieter|turn down)(?: (?:the )?(?:volume|sound|audio))?)$/);
    if (volDownMatch) {
      return {
        command: lower,
        intent: 'media_control',
        description: 'Turning volume down',
        steps: [
          { type: 'keyPress', key: 'VolumeDown', keyCode: VK.VOLUME_DOWN, description: 'Press Volume Down' },
          { type: 'keyPress', key: 'VolumeDown', keyCode: VK.VOLUME_DOWN, description: 'Press Volume Down' },
          { type: 'keyPress', key: 'VolumeDown', keyCode: VK.VOLUME_DOWN, description: 'Press Volume Down' },
          { type: 'keyPress', key: 'VolumeDown', keyCode: VK.VOLUME_DOWN, description: 'Press Volume Down' },
          { type: 'keyPress', key: 'VolumeDown', keyCode: VK.VOLUME_DOWN, description: 'Press Volume Down' },
        ],
      };
    }

    // --- Play / Pause (not 'stop music' — handled by Media Stop below) ---
    if (/^(?:play|pause|play\/pause|resume|toggle play|pause music|play music|resume music)$/.test(lower)) {
      return {
        command: lower,
        intent: 'media_control',
        description: 'Toggling play/pause',
        steps: [
          { type: 'keyPress', key: 'MediaPlayPause', keyCode: VK.MEDIA_PLAY_PAUSE, description: 'Press Media Play/Pause' },
        ],
      };
    }

    // --- Next Track ---
    if (/^(?:next(?: track| song)?|skip(?: track| song)?|next music)$/.test(lower)) {
      return {
        command: lower,
        intent: 'media_control',
        description: 'Skipping to next track',
        steps: [
          { type: 'keyPress', key: 'MediaNextTrack', keyCode: VK.MEDIA_NEXT_TRACK, description: 'Press Media Next Track' },
        ],
      };
    }

    // --- Previous Track ---
    if (/^(?:prev(?:ious)?(?: track| song)?|go back(?: a)?(?: track| song)?|last track|last song)$/.test(lower)) {
      return {
        command: lower,
        intent: 'media_control',
        description: 'Going to previous track',
        steps: [
          { type: 'keyPress', key: 'MediaPrevTrack', keyCode: VK.MEDIA_PREV_TRACK, description: 'Press Media Previous Track' },
        ],
      };
    }

    // --- Media Stop ---
    if (/^(?:stop(?: media| music| playback)?)$/.test(lower)) {
      return {
        command: lower,
        intent: 'media_control',
        description: 'Stopping media playback',
        steps: [
          { type: 'keyPress', key: 'MediaStop', keyCode: VK.MEDIA_STOP, description: 'Press Media Stop' },
        ],
      };
    }

    // --- Brightness (Win + brightness isn't a standard VK but we can try Fn keys via Win+A/Settings) ---
    if (/^(?:(?:increase|raise|turn up|brighten)(?: (?:the )?(?:brightness|screen))?|brightness up|brighter)$/.test(lower)) {
      return {
        command: lower,
        intent: 'system_shortcut',
        description: 'Opening Quick Settings for brightness',
        steps: [
          { type: 'hotkey', keys: ['Win', 'A'], keyCodes: [VK.LWIN, 0x41], description: 'Open Quick Settings (Win+A)' },
        ],
      };
    }

    if (/^(?:(?:decrease|lower|turn down|dim)(?: (?:the )?(?:brightness|screen))?|brightness down|dimmer)$/.test(lower)) {
      return {
        command: lower,
        intent: 'system_shortcut',
        description: 'Opening Quick Settings for brightness',
        steps: [
          { type: 'hotkey', keys: ['Win', 'A'], keyCodes: [VK.LWIN, 0x41], description: 'Open Quick Settings (Win+A)' },
        ],
      };
    }

    return null;
  }

  /**
   * "press ctrl+c", "press enter", "press alt+tab", "hit escape"
   */
  _matchHotkey(lower) {
    const match = lower.match(/^(?:press|hit|tap)\s+(.+)$/);
    if (!match) return null;

    const keyStr = match[1].trim();

    // Check if it's a hotkey combination (contains +)
    if (keyStr.includes('+')) {
      const parts = keyStr.split('+').map(k => k.trim().toLowerCase());
      const keys = [];
      const keyCodes = [];

      for (const part of parts) {
        const vk = KEY_MAP[part];
        if (vk) {
          keys.push(part.charAt(0).toUpperCase() + part.slice(1));
          keyCodes.push(vk);
        } else if (part.length === 1) {
          const vk2 = charToVK(part);
          if (vk2) {
            keys.push(part.toUpperCase());
            keyCodes.push(vk2);
          }
        }
      }

      if (keyCodes.length === parts.length && keyCodes.length > 0) {
        return {
          command: lower,
          intent: 'hotkey',
          description: `Pressing ${keys.join('+')}`,
          steps: [
            { type: 'hotkey', keys, keyCodes, description: keys.join('+') },
          ],
        };
      }
    }

    // Single key press
    const vk = KEY_MAP[keyStr];
    if (vk) {
      return {
        command: lower,
        intent: 'key_press',
        description: `Pressing ${keyStr}`,
        steps: [
          { type: 'keyPress', key: keyStr, keyCode: vk, description: `Press ${keyStr}` },
        ],
      };
    }

    return null;
  }

  /**
   * "type hello world", "enter text something", "write hello"
   * Excludes conversational patterns like "write a script", "type me an essay"
   */
  _matchTypeText(lower, original) {
    const match = lower.match(/^(?:type|write|enter text|input)\s+(.+)$/);
    if (!match) return null;

    // Skip conversational patterns — these are LLM requests, not typing commands
    // e.g. "write a Python script", "write me a poem", "type out an email for me"
    const conversationalPattern = /^(?:type|write|enter text|input)\s+(?:a|an|me|some|the|this|that|my|our|about|out|up|down|code|script|program|function|class|method|essay|email|letter|story|poem|song|paragraph|summary|report|document|list|guide|tutorial|example|test|html|css|json|javascript|python|java|sql|query|app|application|file|page|template|blog|article|response|reply|message|instructions|recipe|plan|review|analysis|description|explanation|api|readme|documentation|comment|note)\b/;
    if (conversationalPattern.test(lower)) return null;

    // Preserve original casing for the text
    const text = original.substring(original.toLowerCase().indexOf(match[1]));

    return {
      command: original,
      intent: 'type_text',
      description: `Typing "${text}"`,
      steps: [
        { type: 'typeText', text, description: `Type "${text}"` },
      ],
    };
  }

  /**
   * "press enter", "press escape" (single key presses handled separately from matchHotkey)
   */
  _matchPressKey(lower) {
    // Already handled by _matchHotkey
    return null;
  }

  /**
   * "search for cats", "google how to cook rice", "look up weather"
   */
  _matchSearchWeb(lower, original) {
    const match = lower.match(/^(?:search\s+(?:for|the web for)?|google|look\s+up|bing)\s+(.+)$/);
    if (!match) return null;

    const query = match[1].trim();

    return {
      command: original,
      intent: 'search_web',
      description: `Searching the web for "${query}"`,
      steps: [
        { type: 'keyPress', key: 'LWin', keyCode: VK.LWIN, description: 'Press Windows key' },
        { type: 'delay', duration: 600, description: 'Wait for Start menu' },
        { type: 'typeText', text: 'edge', description: 'Type "edge"' },
        { type: 'delay', duration: 800, description: 'Wait for search results' },
        { type: 'keyPress', key: 'Return', keyCode: VK.RETURN, description: 'Press Enter' },
        { type: 'delay', duration: 2000, description: 'Wait for browser to open' },
        { type: 'hotkey', keys: ['Ctrl', 'L'], keyCodes: [VK.CONTROL, 0x4C], description: 'Focus address bar (Ctrl+L)' },
        { type: 'delay', duration: 300, description: 'Wait for address bar' },
        { type: 'typeText', text: query, description: `Type "${query}"` },
        { type: 'keyPress', key: 'Return', keyCode: VK.RETURN, description: 'Press Enter to search' },
      ],
    };
  }

  /**
   * Power commands: shutdown, restart, sleep, hibernate
   */
  _matchPowerCommand(lower) {
    // shutdown [this] [pc/computer/machine/system]
    if (/^(?:shut\s*down|power\s*(?:off|down)|turn\s*off)(?:\s+(?:this|the|my))?\s*(?:pc|computer|machine|system)?[.,!?]*$/i.test(lower)) {
      return {
        command: lower,
        intent: 'power',
        description: 'Shutting down PC',
        steps: [
          { type: 'powerCommand', command: 'shutdown', description: 'Shutdown PC' },
        ],
      };
    }

    // restart [this] [pc/computer/machine/system]
    if (/^(?:restart|reboot)(?:\s+(?:this|the|my))?\s*(?:pc|computer|machine|system)?[.,!?]*$/i.test(lower)) {
      return {
        command: lower,
        intent: 'power',
        description: 'Restarting PC',
        steps: [
          { type: 'powerCommand', command: 'restart', description: 'Restart PC' },
        ],
      };
    }

    // sleep [this] [pc/computer/machine/system]
    if (/^(?:sleep|suspend)(?:\s+(?:this|the|my))?\s*(?:pc|computer|machine|system)?[.,!?]*$/i.test(lower)) {
      return {
        command: lower,
        intent: 'power',
        description: 'Putting PC to sleep',
        steps: [
          { type: 'powerCommand', command: 'sleep', description: 'Sleep PC' },
        ],
      };
    }

    // hibernate [this] [pc/computer/machine/system]
    if (/^(?:hibernate)(?:\s+(?:this|the|my))?\s*(?:pc|computer|machine|system)?[.,!?]*$/i.test(lower)) {
      return {
        command: lower,
        intent: 'power',
        description: 'Hibernating PC',
        steps: [
          { type: 'powerCommand', command: 'hibernate', description: 'Hibernate PC' },
        ],
      };
    }

    return null;
  }

  /**
   * System commands: copy, paste, undo, redo, save, select all, minimize, maximize, etc.
   */
  _matchSystemCommand(lower) {
    const commands = {
      'copy': { keys: ['Ctrl', 'C'], keyCodes: [VK.CONTROL, 0x43], desc: 'Copy (Ctrl+C)' },
      'paste': { keys: ['Ctrl', 'V'], keyCodes: [VK.CONTROL, 0x56], desc: 'Paste (Ctrl+V)' },
      'cut': { keys: ['Ctrl', 'X'], keyCodes: [VK.CONTROL, 0x58], desc: 'Cut (Ctrl+X)' },
      'undo': { keys: ['Ctrl', 'Z'], keyCodes: [VK.CONTROL, 0x5A], desc: 'Undo (Ctrl+Z)' },
      'redo': { keys: ['Ctrl', 'Y'], keyCodes: [VK.CONTROL, 0x59], desc: 'Redo (Ctrl+Y)' },
      'save': { keys: ['Ctrl', 'S'], keyCodes: [VK.CONTROL, 0x53], desc: 'Save (Ctrl+S)' },
      'select all': { keys: ['Ctrl', 'A'], keyCodes: [VK.CONTROL, 0x41], desc: 'Select All (Ctrl+A)' },
      'find': { keys: ['Ctrl', 'F'], keyCodes: [VK.CONTROL, 0x46], desc: 'Find (Ctrl+F)' },
      'new tab': { keys: ['Ctrl', 'T'], keyCodes: [VK.CONTROL, 0x54], desc: 'New Tab (Ctrl+T)' },
      'close tab': { keys: ['Ctrl', 'W'], keyCodes: [VK.CONTROL, 0x57], desc: 'Close Tab (Ctrl+W)' },
      'refresh': { keys: ['F5'], keyCodes: [VK.F5], desc: 'Refresh (F5)' },
      'minimize': { keys: ['Win', 'Down'], keyCodes: [VK.LWIN, VK.DOWN], desc: 'Minimize (Win+Down)' },
      'maximize': { keys: ['Win', 'Up'], keyCodes: [VK.LWIN, VK.UP], desc: 'Maximize (Win+Up)' },
      'switch window': { keys: ['Alt', 'Tab'], keyCodes: [VK.ALT, VK.TAB], desc: 'Switch Window (Alt+Tab)' },
      'switch app': { keys: ['Alt', 'Tab'], keyCodes: [VK.ALT, VK.TAB], desc: 'Switch App (Alt+Tab)' },
      'screenshot': { keys: ['Win', 'Shift', 'S'], keyCodes: [VK.LWIN, VK.SHIFT, 0x53], desc: 'Screenshot (Win+Shift+S)' },
      'snip': { keys: ['Win', 'Shift', 'S'], keyCodes: [VK.LWIN, VK.SHIFT, 0x53], desc: 'Snip (Win+Shift+S)' },
      'lock': { keys: ['Win', 'L'], keyCodes: [VK.LWIN, 0x4C], desc: 'Lock Screen (Win+L)' },
      'lock screen': { keys: ['Win', 'L'], keyCodes: [VK.LWIN, 0x4C], desc: 'Lock Screen (Win+L)' },
      'show desktop': { keys: ['Win', 'D'], keyCodes: [VK.LWIN, 0x44], desc: 'Show Desktop (Win+D)' },
      'desktop': { keys: ['Win', 'D'], keyCodes: [VK.LWIN, 0x44], desc: 'Show Desktop (Win+D)' },
      'task view': { keys: ['Win', 'Tab'], keyCodes: [VK.LWIN, VK.TAB], desc: 'Task View (Win+Tab)' },
      'emoji': { keys: ['Win', '.'], keyCodes: [VK.LWIN, 0xBE], desc: 'Emoji Panel (Win+.)' },
      'clipboard': { keys: ['Win', 'V'], keyCodes: [VK.LWIN, 0x56], desc: 'Clipboard History (Win+V)' },
    };

    const cmd = commands[lower];
    if (cmd) {
      return {
        command: lower,
        intent: 'system_command',
        description: cmd.desc,
        steps: [
          { type: 'hotkey', keys: cmd.keys, keyCodes: cmd.keyCodes, description: cmd.desc },
        ],
      };
    }

    return null;
  }

  /**
   * Format an action plan as a user-friendly chat response.
   */
  formatActionResponse(actionPlan) {
    const lines = [`**⚡ Action: ${actionPlan.description}**`, ''];
    lines.push('Steps:');
    // Use displaySteps if available (for volume_set which has many redundant steps)
    const stepsToShow = actionPlan.displaySteps || actionPlan.steps;
    for (let i = 0; i < stepsToShow.length; i++) {
      const step = stepsToShow[i];
      if (!step.description) continue; // Skip empty descriptions
      const icon = step.type === 'delay' ? '⏳' : step.type === 'typeText' ? '⌨️' : step.type === 'visualClick' ? '🎯' : step.type === 'keyPress' ? '🔑' : step.type === 'focusWindow' ? '🪟' : step.type === 'holdKey' ? '🎮' : step.type === 'holdClick' ? '🖱️' : step.type === 'mouseMove' ? '🖱️' : step.type === 'repeatSequence' ? '🔁' : '🔧';
      lines.push(`${i + 1}. ${icon} ${step.description}`);
    }
    lines.push('');
    lines.push('*Executing on the host machine...*');
    return lines.join('\n');
  }

  /**
   * Check if a message looks like it could be an action request even if
   * the pattern matchers didn't catch it. Returns a helpful suggestion string
   * or null if it doesn't look action-like.
   */
  suggestAction(message) {
    const lower = message.toLowerCase().trim();

    // Keywords that suggest the user wants to perform a system action
    const actionKeywords = [
      { pattern: /\b(?:volume|sound|audio|loud|quiet)\b/, suggestion: 'Try: "mute", "unmute", "volume up", "volume down", or "set volume to 50"' },
      { pattern: /\b(?:mute|unmute|silence)\b/, suggestion: 'Try: "mute" or "unmute"' },
      { pattern: /\b(?:brightness|bright|dim|screen)\b/, suggestion: 'Try: "brightness up" or "brightness down"' },
      { pattern: /\b(?:play|pause|resume|stop|skip|next|previous|track|song|music)\b/, suggestion: 'Try: "play", "pause", "next track", "previous track", "stop music", or "play spotify" / "play soundcloud" to open a music service' },
      { pattern: /\b(?:open|launch|start|run)\b.*\b(?:app|application|program|browser|notepad|chrome|edge|firefox|explorer|settings|terminal|calculator|spotify|discord)\b/, suggestion: 'Try: "open [app name]" — e.g., "open edge", "open notepad", "open spotify"' },
      { pattern: /\b(?:focus|switch to|bring up|activate|alt.?tab)\b/, suggestion: 'Try: "focus [app name]" — e.g., "focus minecraft", "switch to chrome"' },
      { pattern: /\b(?:unpause|resume game)\b/, suggestion: 'Try: "unpause minecraft" or "unpause" to press Escape' },
      { pattern: /\b(?:go forward|go backward|walk|strafe|move forward|move backward)\b/, suggestion: 'Try: "go forward until escape" or "go left until I press space"' },
      { pattern: /\b(?:hold)\b.*\b(?:key|until)\b/, suggestion: 'Try: "hold w until escape" — holds a key until you press the stop key' },
      { pattern: /\b(?:mine|dig|break|harvest|chop|attack)\b/, suggestion: 'Try: "mine forward unless you see lava or I press escape" — repeating mine+move with visual stop conditions' },
      { pattern: /\b(?:close|exit|quit)\b.*\b(?:window|app|this|application)\b/, suggestion: 'Try: "close window"' },
      { pattern: /\b(?:copy|paste|cut|undo|redo|save|select all|find)\b/, suggestion: 'Try saying the command directly — e.g., "copy", "paste", "undo", "save"' },
      { pattern: /\b(?:screenshot|snip|screen\s*shot|capture)\b/, suggestion: 'Try: "screenshot"' },
      { pattern: /\b(?:lock|lock\s*screen)\b/, suggestion: 'Try: "lock" or "lock screen"' },
      { pattern: /\b(?:minimize|maximize|desktop)\b/, suggestion: 'Try: "minimize", "maximize", or "show desktop"' },
      { pattern: /\b(?:search|google|look\s*up|bing)\b/, suggestion: 'Try: "search for [query]" — e.g., "search for weather"' },
      { pattern: /\b(?:type|write|enter)\b.*\b(?:text|word|message)\b/, suggestion: 'Try: "type [text]" — e.g., "type hello world"' },
      { pattern: /\b(?:press|hit|tap)\b.*\b(?:key|button|enter|escape|tab)\b/, suggestion: 'Try: "press [key]" — e.g., "press enter", "press ctrl+c"' },
      { pattern: /\b(?:click|tap)\b.*\b(?:button|link|icon|text|word)\b/, suggestion: 'Try: "click [text on screen]" — e.g., "click Play", "click Submit", "click OK"' },
    ];

    for (const { pattern, suggestion } of actionKeywords) {
      if (pattern.test(lower)) {
        return suggestion;
      }
    }

    return null;
  }

  /**
   * Check if a message likely contains multiple action steps that regex might mis-parse.
   * Returns true when LLM-based parsing should be attempted.
   */
  looksLikeMultiStep(lower) {
    const actionVerbs = ['open', 'launch', 'start', 'run', 'click', 'tap', 'press',
      'wait', 'pause', 'delay', 'close', 'type', 'search', 'mute', 'unmute',
      'play', 'stop', 'minimize', 'maximize', 'lock', 'screenshot', 'set volume',
      'focus', 'switch', 'hold', 'go', 'move', 'walk', 'unpause', 'resume',
      'mine', 'dig', 'attack', 'break', 'harvest', 'chop', 'punch'];

    // Split on sentence boundaries (. ! ; followed by space)
    const sentences = lower.split(/[.!;]\s+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length < 2) return false;

    // Count how many sentences start with an action verb
    let actionCount = 0;
    for (const s of sentences) {
      if (actionVerbs.some(v => s.startsWith(v))) actionCount++;
    }
    return actionCount >= 2;
  }

  /**
   * Use LLM to parse a natural language command into individual action strings,
   * then run each through the existing regex matchers.
   * @param {string} message - User's message
   * @param {Function} callLLM - async (message, systemPrompt) => string
   * @returns {Object|null} Action plan or null
   */
  async detectActionWithLLM(message, callLLM) {
    const systemPrompt = `You split user commands into individual PC actions.
Available commands:
- open [app name]
- close window
- focus [app name]  (bring a running app's window to the foreground)
- wait [N] seconds  OR  wait [N] minutes
- click [text on screen]  /  right click [text]  /  double click [text]
- type [text]
- press [key]  (enter, escape, tab, f5, etc.)
- press ctrl+[key]  (ctrl+c, ctrl+v, alt+f4, ctrl+shift+esc, etc.)
- hold [key] until [stop key]  (holds a key down until the user presses the stop key)
- go forward / go backward / go left / go right  (game WASD movement)
- go forward until [stop key]  (hold movement key until user presses stop key)
- mine [direction] unless you see [thing] or I press [key]  (repeating mine+move with visual/key stop)
- unpause / unpause [game name]  (press Escape to unpause a game)
- mute / unmute / volume up / volume down / set volume to [N]
- play / pause / next track / previous track / stop music
- play spotify / play soundcloud / play youtube music  (opens the web app and starts playing)
- search for [query]
- lock / screenshot / sleep / minimize / maximize / show desktop
- shut down / restart / sleep / hibernate

Respond ONLY with a JSON object — NO markdown, NO code fences, NO explanation:
If the message contains action commands:
{"isAction":true,"actions":["focus minecraft","press escape","mine forward unless you see lava or I press escape"]}
If NOT an action:
{"isAction":false}

Rules:
- Each action string must be a simple imperative command from the list above
- Split multi-sentence or compound commands into individual actions
- Preserve the user's intent, order, and exact target text
- Convert vague durations: "a few seconds" → "wait 3 seconds"
- "unpause [game]" should become TWO actions: "focus [game]" then "press escape"
- "go forward until I press escape" → "go forward until escape"
- "mine forward unless you see lava or I press escape" stays as ONE action (it's a repeating sequence)
- If user says "until I press X" the stop key is X
- If no stop key specified for hold/movement, default to "escape"
- For visual conditions like "unless you see lava", keep the visual target name
- OPTIMIZATION: When the user mentions a known game element (lava, water, fire, creeper, diamond), use color detection (fast RGB sampling) NOT full image recognition. The system has built-in color profiles for these.
- Do NOT combine multiple actions into one string`;

    try {
      console.log(`[LLM Action Parser] Parsing: "${message.substring(0, 80)}"`);
      const response = await callLLM(message, systemPrompt);

      // Extract JSON from response (in case LLM wraps it)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('[LLM Action Parser] No JSON in response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.isAction || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
        console.log('[LLM Action Parser] Not an action');
        return null;
      }

      console.log(`[LLM Action Parser] Split into ${parsed.actions.length} actions:`, parsed.actions);

      // Run each action string through existing regex matchers
      const allSteps = [];
      const descriptions = [];

      for (let i = 0; i < parsed.actions.length; i++) {
        const actionStr = parsed.actions[i].trim();
        const plan = this._detectSingleAction(actionStr.toLowerCase(), actionStr);

        if (plan) {
          if (i > 0) {
            allSteps.push({ type: 'delay', duration: 500, description: 'Wait between actions' });
          }
          allSteps.push(...plan.steps);
          descriptions.push(plan.description);
        } else {
          console.log(`[LLM Action Parser] No regex match for: "${actionStr}"`);
        }
      }

      if (allSteps.length === 0) return null;

      return {
        command: message,
        intent: 'compound',
        description: descriptions.join(', then '),
        steps: allSteps,
      };
    } catch (err) {
      console.error('[LLM Action Parser] Error:', err.message);
      return null;
    }
  }
}

module.exports = { ActionService };
