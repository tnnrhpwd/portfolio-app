/**
 * OpenAI Function-Calling Tool Definitions for CSimple Addon
 *
 * These replace the regex-based action detection system. The LLM decides
 * whether the user wants a PC action or a conversational reply.
 *
 * Each tool maps to an action plan that the existing executeActionDirect()
 * pipeline already knows how to run via PowerShell.
 *
 * Memory/personality/behavior tools are executed directly (no PowerShell).
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Read resources path from global (set by main.js) or fall back to default
function resolveResourcesPath() {
  if (global.CSIMPLE_RESOURCES_PATH) return global.CSIMPLE_RESOURCES_PATH;
  try {
    const configPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'csimple-addon', 'resources-path.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.resourcesPath) return config.resourcesPath;
    }
  } catch {}
  return path.join(os.homedir(), 'Documents', 'CSimple', 'Resources');
}

const RESOURCES_PATH = resolveResourcesPath();
const MEMORY_PATH = path.join(RESOURCES_PATH, 'Memory');
const PERSONALITY_PATH = path.join(RESOURCES_PATH, 'Personality');
const BEHAVIORS_PATH = path.join(RESOURCES_PATH, 'Behaviors');

const ADDON_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'open_application',
      description: 'Open/launch an application on the PC. Examples: "open notepad", "launch chrome", "start spotify".',
      parameters: {
        type: 'object',
        properties: {
          app_name: { type: 'string', description: 'Name of the application to open (e.g. "notepad", "chrome", "spotify", "discord")' },
        },
        required: ['app_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_window',
      description: 'Close the currently focused window or a specific app window.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Optional: specific window/app name to close. Leave empty for current window.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus_window',
      description: 'Bring a running application window to the foreground.',
      parameters: {
        type: 'object',
        properties: {
          app_name: { type: 'string', description: 'Name of the application to focus (e.g. "chrome", "discord", "minecraft")' },
        },
        required: ['app_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Simulate physical keyboard input — literally presses keys on the user\'s PC. ONLY use when the user explicitly wants text typed INTO an already-open application (e.g. "type hello world", "type my password", "fill in the form"). NEVER use for: writing code, writing scripts, writing emails, composing content, answering questions, creating files, generating text. For those, respond in your normal text reply.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The exact text to physically type on the keyboard' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Press a keyboard key or key combination (hotkey). Examples: "press enter", "press ctrl+c", "press alt+f4".',
      parameters: {
        type: 'object',
        properties: {
          keys: { type: 'string', description: 'Key or key combination (e.g. "enter", "escape", "ctrl+c", "alt+f4", "ctrl+shift+esc", "f5")' },
        },
        required: ['keys'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hold_key',
      description: 'Hold a key down continuously until a stop key is pressed. Useful for games.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to hold down (e.g. "w", "shift", "space")' },
          stop_key: { type: 'string', description: 'Key that stops the hold (default: "escape")' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_on_screen',
      description: 'Click on text/element visible on the screen using visual recognition.',
      parameters: {
        type: 'object',
        properties: {
          target_text: { type: 'string', description: 'Text or element to click on screen' },
          click_type: { type: 'string', enum: ['left', 'right', 'double'], description: 'Type of click (default: left)' },
        },
        required: ['target_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_volume',
      description: 'Set the system volume to a specific level.',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'integer', description: 'Volume level from 0 to 100' },
        },
        required: ['level'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'media_control',
      description: 'Control media playback: play, pause, stop, next track, previous track, mute, unmute, volume up, volume down.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['play', 'pause', 'play_pause', 'stop', 'next_track', 'previous_track', 'mute', 'unmute', 'volume_up', 'volume_down'],
            description: 'Media action to perform',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_music_service',
      description: 'Open a music streaming service and start playing. Supports spotify, soundcloud, youtube music.',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', enum: ['spotify', 'soundcloud', 'youtube_music'], description: 'Music service to play' },
        },
        required: ['service'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for a query (opens browser with search results).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'system_command',
      description: 'Execute a system command: lock screen, take screenshot, sleep, show desktop, minimize all, maximize window.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['lock', 'screenshot', 'sleep', 'show_desktop', 'minimize', 'maximize'],
            description: 'System command to execute',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'power_command',
      description: 'Power management: shut down, restart, hibernate, or sleep the PC. These are destructive — only call when the user clearly intends this.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['shutdown', 'restart', 'hibernate', 'sleep'], description: 'Power action' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_duration',
      description: 'Wait/pause for a specified duration before continuing.',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'Number of seconds to wait' },
        },
        required: ['seconds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'game_action',
      description: 'Perform a game action like moving forward/backward/left/right, jumping, mining, attacking, etc. Supports optional stop conditions.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Movement or action (e.g. "forward", "backward", "left", "right", "jump", "mine forward", "attack")' },
          stop_key: { type: 'string', description: 'Key that stops the action (default: "escape")' },
          visual_stop: { type: 'string', description: 'Visual condition to stop (e.g. "lava", "water", "creeper") — uses screen recognition' },
          repeat: { type: 'boolean', description: 'Whether to repeat the action until stopped (default: false)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_multiple_actions',
      description: 'Run multiple PC actions in sequence. Use this when the user wants several things done in order (e.g. "open notepad and type hello").',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description: 'Ordered list of action descriptions to execute sequentially. Each should be a simple imperative command.',
            items: { type: 'string' },
          },
        },
        required: ['actions'],
      },
    },
  },

  // ── File Save Tool ───────────────────────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'save_file',
      description: 'Save/create a file on the user\'s PC. Use this when the user asks to save content (code, text, scripts, etc.) to a specific location like their Desktop, Documents, Downloads, or a custom path. This actually writes the file to disk.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Name of the file to create (e.g. "sort_list.py", "notes.txt", "index.html")' },
          content: { type: 'string', description: 'Full content of the file to save' },
          location: {
            type: 'string',
            enum: ['desktop', 'documents', 'downloads', 'workspace', 'custom'],
            description: 'Where to save the file. Use "desktop", "documents", "downloads" for standard folders, "workspace" for the CSimple workspace, or "custom" with custom_path.',
          },
          custom_path: { type: 'string', description: 'Absolute directory path when location is "custom" (e.g. "C:\\Projects\\myapp")' },
        },
        required: ['filename', 'content', 'location'],
      },
    },
  },

  // ── Memory / Personality / Behavior Auto-Management Tools ─────────────

  {
    type: 'function',
    function: {
      name: 'update_memory',
      description: 'Create or update a memory file to persist knowledge across conversations. Use this proactively when the user shares personal info (name, preferences, projects, relationships, goals, job, location, important dates), or when you learn something worth remembering. Memories survive across sessions. Use descriptive filenames like "user_preferences.md", "project_notes.md", "important_dates.md". READ existing memory first (from the MEMORY section in your context) before writing to avoid overwriting — merge new info with existing content.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Memory filename (e.g. "user_preferences.md", "projects.md"). Use .md extension.' },
          content: { type: 'string', description: 'Full content of the memory file. If updating, include ALL existing content plus new additions — this overwrites the file.' },
          reason: { type: 'string', description: 'Brief internal note for why this memory is being saved (not shown to user).' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_memory',
      description: 'Delete a memory file that is no longer relevant or accurate.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Memory filename to delete' },
        },
        required: ['filename'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_personality',
      description: 'Update a personality file that defines your character and behavior. Files: "identity.md" (who you are, your name, tone, style), "soul.md" (core values, principles, emotional disposition), "user.md" (what you know about this specific user — their communication style, how they like to be addressed, relationship context). Update these when the user asks you to change how you behave, adopt a persona, remember their preferences for interaction style, or when you discover meaningful patterns about how they communicate.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', enum: ['identity.md', 'soul.md', 'user.md'], description: 'Which personality file to update' },
          content: { type: 'string', description: 'Full replacement content for the personality file.' },
          reason: { type: 'string', description: 'Brief note for why this personality update is happening.' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_behavior',
      description: 'Create or update a behavior file that provides high-level instructions for how you should operate. Behaviors are like custom instruction sets — e.g. "coding_assistant.txt" might say "Always provide code examples, prefer TypeScript, explain tradeoffs". Update behaviors when the user wants to customize how you respond for specific contexts or tasks.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Behavior filename (e.g. "default.txt", "coding_mode.txt"). Use .txt extension.' },
          content: { type: 'string', description: 'Full content of the behavior file — instructions for how you should act.' },
          reason: { type: 'string', description: 'Brief note for why this behavior is being updated.' },
        },
        required: ['filename', 'content'],
      },
    },
  },
];

/**
 * Convert an LLM tool call into an actionPlan that the existing
 * actionService.queueAction() / executeActionDirect() pipeline can execute.
 */
function toolCallToActionPlan(toolCall, actionService) {
  const { name } = toolCall.function;
  const args = JSON.parse(toolCall.function.arguments);

  switch (name) {
    case 'open_application': {
      const app = args.app_name;
      return {
        command: `open ${app}`,
        intent: 'open_app',
        description: `Opening ${app}`,
        steps: [{ type: 'openApp', target: app, description: `Open ${app}` }],
      };
    }

    case 'close_window': {
      return {
        command: 'close window',
        intent: 'close_window',
        description: 'Closing current window',
        steps: [{ type: 'hotkey', keys: ['alt', 'f4'], description: 'Close window (Alt+F4)' }],
      };
    }

    case 'focus_window': {
      const app = args.app_name;
      return {
        command: `focus ${app}`,
        intent: 'focus_window',
        description: `Focusing ${app}`,
        steps: [{ type: 'focusWindow', target: app, description: `Focus ${app}` }],
      };
    }

    case 'type_text': {
      const text = args.text;
      return {
        command: `type ${text}`,
        intent: 'type_text',
        description: `Typing "${text}"`,
        steps: [{ type: 'typeText', text, description: `Type "${text}"` }],
      };
    }

    case 'press_key': {
      const keys = args.keys.toLowerCase().split('+').map(k => k.trim());
      if (keys.length === 1) {
        return {
          command: `press ${args.keys}`,
          intent: 'key_press',
          description: `Pressing ${args.keys}`,
          steps: [{ type: 'keyPress', key: keys[0], description: `Press ${args.keys}` }],
        };
      }
      return {
        command: `press ${args.keys}`,
        intent: 'hotkey',
        description: `Pressing ${args.keys}`,
        steps: [{ type: 'hotkey', keys, description: `Press ${args.keys}` }],
      };
    }

    case 'hold_key': {
      const key = args.key.toLowerCase();
      const stopKey = (args.stop_key || 'escape').toLowerCase();
      return {
        command: `hold ${key} until ${stopKey}`,
        intent: 'hold_key',
        description: `Holding ${key} until ${stopKey} is pressed`,
        steps: [{ type: 'holdKey', key, stopKey, description: `Hold ${key} until ${stopKey}` }],
      };
    }

    case 'click_on_screen': {
      const target = args.target_text;
      const clickType = args.click_type || 'left';
      return {
        command: `click ${target}`,
        intent: 'visual_click',
        description: `Clicking "${target}"`,
        steps: [{ type: 'visualClick', target, clickType, description: `${clickType === 'double' ? 'Double-click' : clickType === 'right' ? 'Right-click' : 'Click'} "${target}"` }],
      };
    }

    case 'set_volume': {
      const level = Math.min(100, Math.max(0, args.level));
      return {
        command: `set volume to ${level}`,
        intent: 'volume_set',
        description: `Setting volume to ${level}%`,
        steps: [{ type: 'setVolume', volumeLevel: level, description: `Set volume to ${level}%` }],
      };
    }

    case 'media_control': {
      const mediaKeyMap = {
        play: 'MediaPlayPause', pause: 'MediaPlayPause', play_pause: 'MediaPlayPause',
        stop: 'MediaStop', next_track: 'MediaNextTrack', previous_track: 'MediaPreviousTrack',
        mute: 'VolumeMute', unmute: 'VolumeMute', volume_up: 'VolumeUp', volume_down: 'VolumeDown',
      };
      const key = mediaKeyMap[args.action] || 'MediaPlayPause';
      return {
        command: args.action.replace('_', ' '),
        intent: 'media_control',
        description: `${args.action.replace('_', ' ')}`,
        steps: [{ type: 'mediaKey', key, description: args.action.replace('_', ' ') }],
      };
    }

    case 'play_music_service': {
      const serviceUrls = {
        spotify: 'https://open.spotify.com',
        soundcloud: 'https://soundcloud.com',
        youtube_music: 'https://music.youtube.com',
      };
      const url = serviceUrls[args.service] || serviceUrls.spotify;
      const label = args.service.replace('_', ' ');
      return {
        command: `play ${label}`,
        intent: 'play_service',
        description: `Opening ${label}`,
        steps: [
          { type: 'openUrl', url, description: `Open ${label}` },
          { type: 'delay', duration: 3000, description: 'Wait for page to load' },
          { type: 'mediaKey', key: 'MediaPlayPause', description: 'Press play' },
        ],
      };
    }

    case 'search_web': {
      const q = encodeURIComponent(args.query);
      return {
        command: `search for ${args.query}`,
        intent: 'search_web',
        description: `Searching for "${args.query}"`,
        steps: [{ type: 'openUrl', url: `https://www.google.com/search?q=${q}`, description: `Search: "${args.query}"` }],
      };
    }

    case 'system_command': {
      const sysSteps = {
        lock: [{ type: 'hotkey', keys: ['win', 'l'], description: 'Lock screen' }],
        screenshot: [{ type: 'hotkey', keys: ['win', 'shift', 's'], description: 'Take screenshot' }],
        sleep: [{ type: 'systemCommand', command: 'sleep', description: 'Sleep' }],
        show_desktop: [{ type: 'hotkey', keys: ['win', 'd'], description: 'Show desktop' }],
        minimize: [{ type: 'hotkey', keys: ['win', 'down'], description: 'Minimize window' }],
        maximize: [{ type: 'hotkey', keys: ['win', 'up'], description: 'Maximize window' }],
      };
      return {
        command: args.command,
        intent: 'system_command',
        description: `${args.command.replace('_', ' ')}`,
        steps: sysSteps[args.command] || [],
      };
    }

    case 'power_command': {
      const powerSteps = {
        shutdown: [{ type: 'systemCommand', command: 'shutdown', description: 'Shut down PC' }],
        restart: [{ type: 'systemCommand', command: 'restart', description: 'Restart PC' }],
        hibernate: [{ type: 'systemCommand', command: 'hibernate', description: 'Hibernate PC' }],
        sleep: [{ type: 'systemCommand', command: 'sleep', description: 'Sleep PC' }],
      };
      return {
        command: args.action,
        intent: 'power',
        description: `${args.action} PC`,
        steps: powerSteps[args.action] || [],
      };
    }

    case 'wait_duration': {
      const ms = Math.round(args.seconds * 1000);
      return {
        command: `wait ${args.seconds} seconds`,
        intent: 'wait',
        description: `Waiting ${args.seconds} seconds`,
        steps: [{ type: 'delay', duration: ms, description: `Wait ${args.seconds}s` }],
      };
    }

    case 'game_action': {
      // Use regex-based detection for game actions since they have complex step generation
      const desc = args.action;
      const stop = args.stop_key ? ` until ${args.stop_key}` : '';
      const vis = args.visual_stop ? ` unless you see ${args.visual_stop}` : '';
      const cmd = `${desc}${stop}${vis}`;
      // Try the regex matchers to build proper game steps
      const plan = actionService._matchGameActionWithConditions(cmd.toLowerCase(), cmd)
        || actionService._matchHoldKey(cmd.toLowerCase(), cmd)
        || actionService._matchGameAction(cmd.toLowerCase(), cmd);
      if (plan) return plan;
      // Fallback: simple key mapping
      const dirMap = { forward: 'w', backward: 's', left: 'a', right: 'd', jump: 'space' };
      const key = dirMap[desc.toLowerCase()] || desc.toLowerCase();
      return {
        command: cmd,
        intent: 'game_action',
        description: `Game: ${desc}`,
        steps: [{ type: 'keyPress', key, description: desc }],
      };
    }

    case 'run_multiple_actions': {
      // Parse each sub-action string through regex matchers for step generation
      const allSteps = [];
      const descriptions = [];
      for (let i = 0; i < args.actions.length; i++) {
        const actionStr = args.actions[i].trim();
        // Try detecting via regex matchers
        const plan = actionService._detectSingleAction(actionStr.toLowerCase(), actionStr);
        if (plan) {
          if (i > 0) allSteps.push({ type: 'delay', duration: 500, description: 'Wait between actions' });
          allSteps.push(...plan.steps);
          descriptions.push(plan.description);
        }
      }
      if (allSteps.length === 0) return null;
      return {
        command: args.actions.join(', then '),
        intent: 'compound',
        description: descriptions.join(', then '),
        steps: allSteps,
      };
    }

    case 'save_file': {
      // save_file is handled by executeMemoryTool, not as a PC action
      return null;
    }

    default:
      return null;
  }
}

/**
 * Sanitise a filename and resolve against a base directory — prevents directory traversal.
 */
function safePath(filename, baseDir) {
  if (!filename || typeof filename !== 'string') return null;
  const cleaned = filename.replace(/\0/g, '').replace(/\.\./g, '').replace(/[/\\]/g, '').trim();
  if (!cleaned || cleaned.length === 0 || cleaned.length > 255) return null;
  const resolved = path.resolve(baseDir, cleaned);
  if (!resolved.startsWith(path.resolve(baseDir))) return null;
  return resolved;
}

/**
 * Execute a memory/personality/behavior tool call directly (no PowerShell).
 * Returns { executed: true, result: string } if handled, or { executed: false } if not a memory tool.
 */
function executeMemoryTool(toolCall) {
  const { name } = toolCall.function;
  const args = JSON.parse(toolCall.function.arguments);

  switch (name) {
    case 'update_memory': {
      const filePath = safePath(args.filename, MEMORY_PATH);
      if (!filePath) return { executed: true, result: `Error: invalid filename "${args.filename}"` };
      const isUpdate = fs.existsSync(filePath);
      try {
        if (!fs.existsSync(MEMORY_PATH)) fs.mkdirSync(MEMORY_PATH, { recursive: true });
        fs.writeFileSync(filePath, args.content, 'utf-8');
        console.log(`[Memory Tool] ${isUpdate ? 'Updated' : 'Created'}: ${args.filename}${args.reason ? ` — ${args.reason}` : ''}`);
        return { executed: true, result: `Memory ${isUpdate ? 'updated' : 'created'}: ${args.filename}`, operation: { type: 'memory_save', filename: args.filename, action: isUpdate ? 'updated' : 'created' } };
      } catch (err) {
        return { executed: true, result: `Error saving memory: ${err.message}` };
      }
    }

    case 'delete_memory': {
      const filePath = safePath(args.filename, MEMORY_PATH);
      if (!filePath) return { executed: true, result: `Error: invalid filename "${args.filename}"` };
      if (!fs.existsSync(filePath)) return { executed: true, result: `Memory file not found: ${args.filename}` };
      try {
        fs.unlinkSync(filePath);
        console.log(`[Memory Tool] Deleted: ${args.filename}`);
        return { executed: true, result: `Memory deleted: ${args.filename}`, operation: { type: 'memory_delete', filename: args.filename } };
      } catch (err) {
        return { executed: true, result: `Error deleting memory: ${err.message}` };
      }
    }

    case 'update_personality': {
      const allowed = ['identity.md', 'soul.md', 'user.md'];
      if (!allowed.includes(args.filename)) return { executed: true, result: `Invalid personality file. Must be one of: ${allowed.join(', ')}` };
      const filePath = path.join(PERSONALITY_PATH, args.filename);
      const isUpdate = fs.existsSync(filePath);
      try {
        if (!fs.existsSync(PERSONALITY_PATH)) fs.mkdirSync(PERSONALITY_PATH, { recursive: true });
        fs.writeFileSync(filePath, args.content, 'utf-8');
        console.log(`[Personality Tool] ${isUpdate ? 'Updated' : 'Created'}: ${args.filename}${args.reason ? ` — ${args.reason}` : ''}`);
        return { executed: true, result: `Personality ${isUpdate ? 'updated' : 'created'}: ${args.filename}`, operation: { type: 'personality_update', filename: args.filename, action: isUpdate ? 'updated' : 'created' } };
      } catch (err) {
        return { executed: true, result: `Error updating personality: ${err.message}` };
      }
    }

    case 'update_behavior': {
      const filePath = safePath(args.filename, BEHAVIORS_PATH);
      if (!filePath) return { executed: true, result: `Error: invalid filename "${args.filename}"` };
      const isUpdate = fs.existsSync(filePath);
      try {
        if (!fs.existsSync(BEHAVIORS_PATH)) fs.mkdirSync(BEHAVIORS_PATH, { recursive: true });
        fs.writeFileSync(filePath, args.content, 'utf-8');
        console.log(`[Behavior Tool] ${isUpdate ? 'Updated' : 'Created'}: ${args.filename}${args.reason ? ` — ${args.reason}` : ''}`);
        return { executed: true, result: `Behavior ${isUpdate ? 'updated' : 'created'}: ${args.filename}`, operation: { type: 'behavior_update', filename: args.filename, action: isUpdate ? 'updated' : 'created' } };
      } catch (err) {
        return { executed: true, result: `Error updating behavior: ${err.message}` };
      }
    }

    case 'save_file': {
      // Resolve the target directory based on location
      let targetDir;
      switch (args.location) {
        case 'desktop':
          targetDir = path.join(os.homedir(), 'Desktop');
          break;
        case 'documents':
          targetDir = path.join(os.homedir(), 'Documents');
          break;
        case 'downloads':
          targetDir = path.join(os.homedir(), 'Downloads');
          break;
        case 'workspace':
          targetDir = path.join(os.homedir(), 'Documents', 'CSimple', 'Workspace', 'files');
          break;
        case 'custom':
          if (!args.custom_path) return { executed: true, result: 'Error: custom_path is required when location is "custom"' };
          targetDir = args.custom_path;
          break;
        default:
          targetDir = path.join(os.homedir(), 'Desktop');
      }

      // Security: don't allow saving to system dirs
      const normalizedDir = path.resolve(targetDir).toLowerCase();
      const blockedPrefixes = ['c:\\windows', 'c:\\program files', 'c:\\programdata', '/usr', '/bin', '/sbin', '/etc'];
      if (blockedPrefixes.some(p => normalizedDir.startsWith(p))) {
        return { executed: true, result: `Error: Cannot save files to ${targetDir} — system directory` };
      }

      const filename = args.filename.replace(/\0/g, '').replace(/\.\./g, '').replace(/[\/\\]/g, '').trim();
      if (!filename) return { executed: true, result: 'Error: invalid filename' };

      try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        const filePath = path.join(targetDir, filename);
        if (Buffer.byteLength(args.content || '', 'utf-8') > 5 * 1024 * 1024) {
          return { executed: true, result: 'Error: content exceeds 5MB limit' };
        }
        fs.writeFileSync(filePath, args.content, 'utf-8');
        console.log(`[Save File] Saved: ${filePath}`);
        return { executed: true, result: `File saved: ${filePath}`, operation: { type: 'file_save', filename, path: filePath, location: args.location } };
      } catch (err) {
        return { executed: true, result: `Error saving file: ${err.message}` };
      }
    }

    default:
      return { executed: false };
  }
}

/** Check if a tool call is a memory/personality/behavior/file tool (not a PC action). */
function isMemoryTool(toolName) {
  return ['update_memory', 'delete_memory', 'update_personality', 'update_behavior', 'save_file'].includes(toolName);
}

module.exports = { ADDON_TOOL_SCHEMAS, toolCallToActionPlan, executeMemoryTool, isMemoryTool };
