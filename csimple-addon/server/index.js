/**
 * CSimple Addon Express Server
 * 
 * Adapted from C-Simple/src/CSimple.Webapp/server/index.js for Electron packaging.
 * Changes from original:
 *   - Removed static file serving (client UI is in portfolio-app)
 *   - Removed SPA catch-all route
 *   - Added CORS for sthopwood.com
 *   - Fixed SCRIPTS_PATH/PROJECT_ROOT for packaged Electron app
 *   - Server exports start/stop functions for Electron lifecycle control
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');
const multer = require('multer');
const { LlmService } = require('./llm-service');
const { ActionService } = require('./action-service');
const { GitHubModelsService, GITHUB_MODELS } = require('./github-models-service');
const { checkMessage, checkActionPlan, checkScriptContent } = require('./security-guard');

const app = express();
const DEFAULT_PORT = 3001;

// ─── Path Resolution ─────────────────────────────────────────────────────────
// In development: scripts are in ../scripts relative to this file
// In packaged Electron: scripts are in the extraResources/scripts folder

function resolveScriptsPath() {
  // Check if running in packaged Electron app
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'scripts');
    if (fs.existsSync(packaged)) return packaged;
  }
  // Development fallback
  const dev = path.join(__dirname, '..', 'scripts');
  if (fs.existsSync(dev)) return dev;
  return dev; // Return even if not exists; will error at runtime
}

const SCRIPTS_PATH = resolveScriptsPath();
const HF_SCRIPT = path.join(SCRIPTS_PATH, 'run_hf_model.py');

// CSimple Resources path (user data directory)
const RESOURCES_PATH = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources');
const SETTINGS_PATH = path.join(RESOURCES_PATH, 'settings.json');
const BEHAVIORS_PATH = path.join(RESOURCES_PATH, 'Behaviors');
const MEMORY_PATH = path.join(RESOURCES_PATH, 'Memory');
const PERSONALITY_PATH = path.join(RESOURCES_PATH, 'Personality');
const AGENTS_PATH = path.join(RESOURCES_PATH, 'Agents');

// Ensure all resource directories exist
const dirs = [RESOURCES_PATH, BEHAVIORS_PATH, MEMORY_PATH, PERSONALITY_PATH, AGENTS_PATH];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Security Helpers ──────────────────────────────────────────────────────────

/**
 * Sanitize a filename to prevent path traversal attacks.
 * Strips directory separators, null bytes, and validates the result stays within baseDir.
 * @param {string} filename - User-provided filename
 * @param {string} baseDir - The allowed base directory
 * @returns {string|null} Safe absolute path, or null if the filename is malicious
 */
function safePath(filename, baseDir) {
  if (!filename || typeof filename !== 'string') return null;
  // Strip null bytes, directory separators, and parent traversal
  const cleaned = filename
    .replace(/\0/g, '')           // null bytes
    .replace(/\.\./g, '')         // parent traversal
    .replace(/[/\\]/g, '')        // directory separators
    .trim();
  if (!cleaned || cleaned.length === 0 || cleaned.length > 255) return null;
  const resolved = path.resolve(baseDir, cleaned);
  // Ensure the resolved path is still within baseDir
  if (!resolved.startsWith(path.resolve(baseDir))) return null;
  return resolved;
}

/**
 * Validate file size of request body content (max 1MB for text files).
 */
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

function validateFileContent(content) {
  if (typeof content !== 'string') return 'Content must be a string';
  if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) return 'Content exceeds maximum size of 1MB';
  return null;
}

/**
 * Load personality context from identity.md, soul.md, user.md files.
 * Returns a string to prepend to the system prompt.
 */
function loadPersonalityContext() {
  const files = ['identity.md', 'soul.md', 'user.md'];
  const sections = [];

  for (const file of files) {
    const filePath = path.join(PERSONALITY_PATH, file);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content) sections.push(content);
      } catch (err) {
        console.log(`[Personality] Failed to read ${file}: ${err.message}`);
      }
    }
  }

  if (sections.length === 0) return '';
  return '\n\n---\n' + sections.join('\n\n---\n') + '\n\n---\n';
}

/**
 * Load memory context from all files in the Memory directory.
 * Memory files contain persistent knowledge the LLM should reference.
 * Caps total memory context at 8KB to avoid prompt bloat.
 * Returns a formatted string for the system prompt.
 */
const MAX_MEMORY_CONTEXT_BYTES = 8 * 1024; // 8KB cap for memory in prompt

function loadMemoryContext() {
  if (!fs.existsSync(MEMORY_PATH)) return '';
  
  try {
    const files = fs.readdirSync(MEMORY_PATH)
      .filter(f => !fs.statSync(path.join(MEMORY_PATH, f)).isDirectory())
      .sort(); // deterministic order

    if (files.length === 0) return '';

    const memories = [];
    let totalSize = 0;
    
    for (const file of files) {
      const filePath = path.join(MEMORY_PATH, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) continue;
        
        const entrySize = Buffer.byteLength(content, 'utf-8');
        if (totalSize + entrySize > MAX_MEMORY_CONTEXT_BYTES) {
          // Add truncation notice and stop
          memories.push(`[Memory truncated — ${files.length - memories.length} more files not loaded due to size limit]`);
          break;
        }
        
        const name = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        memories.push(`## ${name}\n${content}`);
        totalSize += entrySize;
      } catch (err) {
        console.log(`[Memory] Failed to read ${file}: ${err.message}`);
      }
    }

    if (memories.length === 0) return '';
    return '\n\n--- MEMORY (persistent knowledge) ---\n' + 
           memories.join('\n\n') + 
           '\n--- END MEMORY ---\n';
  } catch (err) {
    console.log(`[Memory] Failed to load memory context: ${err.message}`);
    return '';
  }
}

/**
 * Parse and save [MEMORY_SAVE:filename] blocks from LLM responses.
 * This enables the LLM to autonomously create/update memory files.
 * Returns the cleaned response text (with save blocks removed) and list of saved files.
 * 
 * Format:
 *   [MEMORY_SAVE:my_notes.md]
 *   Content to save here
 *   [/MEMORY_SAVE]
 */
function processMemorySaves(responseText) {
  if (!responseText) return { cleanedText: responseText, savedMemories: [] };

  const MEMORY_SAVE_REGEX = /\[MEMORY_SAVE:([^\]]+)\]\s*\n([\s\S]*?)\[\/MEMORY_SAVE\]/g;
  const savedMemories = [];
  let match;

  while ((match = MEMORY_SAVE_REGEX.exec(responseText)) !== null) {
    const rawFilename = match[1].trim();
    const content = match[2].trim();

    // Validate filename with safePath
    const filePath = safePath(rawFilename, MEMORY_PATH);
    if (!filePath) {
      console.log(`[Memory Auto-Save] Rejected invalid filename: "${rawFilename}"`);
      continue;
    }

    // Validate content size
    const sizeErr = validateFileContent(content);
    if (sizeErr) {
      console.log(`[Memory Auto-Save] Content too large for "${rawFilename}": ${sizeErr}`);
      continue;
    }

    try {
      if (!fs.existsSync(MEMORY_PATH)) {
        fs.mkdirSync(MEMORY_PATH, { recursive: true });
      }

      const isUpdate = fs.existsSync(filePath);
      fs.writeFileSync(filePath, content, 'utf-8');
      savedMemories.push({
        filename: rawFilename,
        action: isUpdate ? 'updated' : 'created',
      });
      console.log(`[Memory Auto-Save] ${isUpdate ? 'Updated' : 'Created'}: ${rawFilename}`);
    } catch (err) {
      console.error(`[Memory Auto-Save] Failed to save "${rawFilename}": ${err.message}`);
    }
  }

  // Remove the MEMORY_SAVE blocks from the visible response
  const cleanedText = responseText.replace(MEMORY_SAVE_REGEX, '').trim();

  return { cleanedText, savedMemories };
}

/**
 * Process all LLM response blocks: MEMORY_SAVE, FILE_CREATE, SCRIPT_CREATE, SCRIPT_RUN.
 * Executes file operations and collects results for the response.
 * @param {string} responseText - Raw LLM response
 * @returns {Promise<{cleanedText: string, operations: object[]}>}
 */
async function processLLMBlocks(responseText) {
  if (!responseText) return { cleanedText: responseText, operations: [] };

  const operations = [];

  // 1. Process MEMORY_SAVE blocks
  const { cleanedText: afterMemory, savedMemories } = processMemorySaves(responseText);
  for (const mem of savedMemories) {
    operations.push({ type: 'memory_save', ...mem });
  }

  // 2. Process FILE_CREATE blocks
  const FILE_CREATE_REGEX = /\[FILE_CREATE:([^\]]+)\]\s*\n([\s\S]*?)\[\/FILE_CREATE\]/g;
  let text = afterMemory;
  let fileMatch;
  while ((fileMatch = FILE_CREATE_REGEX.exec(afterMemory)) !== null) {
    const filename = fileMatch[1].trim();
    const content = fileMatch[2].trim();
    const result = actionService.createFile(filename, content, 'files');
    operations.push({ type: 'file_create', filename, ...result });
    console.log(`[File Auto-Create] ${result.success ? result.action : 'FAILED'}: ${filename}`);
  }
  text = text.replace(FILE_CREATE_REGEX, '').trim();

  // 3. Process SCRIPT_CREATE blocks
  const SCRIPT_CREATE_REGEX = /\[SCRIPT_CREATE:([^\]]+)\]\s*\n([\s\S]*?)\[\/SCRIPT_CREATE\]/g;
  let scriptMatch;
  while ((scriptMatch = SCRIPT_CREATE_REGEX.exec(text)) !== null) {
    const filename = scriptMatch[1].trim();
    const content = scriptMatch[2].trim();
    const ext = require('path').extname(filename).toLowerCase();
    // ── Security: validate script content before saving ──────────────────
    const scriptCheck = checkScriptContent(content, ext);
    if (scriptCheck.blocked) {
      console.warn(`[Security] Script create blocked for ${filename}: ${scriptCheck.reason}`);
      operations.push({ type: 'script_create', filename, success: false, error: `Blocked: ${scriptCheck.reason}` });
      continue;
    }
    const result = actionService.createFile(filename, content, 'scripts');
    operations.push({ type: 'script_create', filename, ...result });
    console.log(`[Script Auto-Create] ${result.success ? result.action : 'FAILED'}: ${filename}`);
  }
  text = text.replace(SCRIPT_CREATE_REGEX, '').trim();

  // 4. Process SCRIPT_RUN blocks (after script creation so the script exists)
  const SCRIPT_RUN_REGEX = /\[SCRIPT_RUN:([^\]]+)\]\s*(?:\n([\s\S]*?))?\[\/SCRIPT_RUN\]/g;
  let runMatch;
  while ((runMatch = SCRIPT_RUN_REGEX.exec(text)) !== null) {
    const filename = runMatch[1].trim();
    const argsText = (runMatch[2] || '').trim();
    const args = argsText ? argsText.split('\n').map(a => a.trim()).filter(Boolean) : [];
    
    console.log(`[Script Auto-Run] Executing: ${filename} with args: ${JSON.stringify(args)}`);
    const result = await actionService.executeScript(filename, args);
    operations.push({
      type: 'script_run',
      filename,
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout?.slice(0, 2000),
      stderr: result.stderr?.slice(0, 1000),
      error: result.error,
    });
    console.log(`[Script Auto-Run] ${result.success ? 'SUCCESS' : 'FAILED'} (exit ${result.exitCode}): ${filename}`);
  }
  text = text.replace(SCRIPT_RUN_REGEX, '').trim();

  return { cleanedText: text, operations };
}

// Configure multer for agent avatar uploads
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const avatarsDir = path.join(AGENTS_PATH, 'avatars');
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const agentId = req.params.agentId || Date.now().toString();
    cb(null, `${agentId}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Initialize LLM service (uses SCRIPTS_PATH parent for projectRoot to find HFModels)
const projectRoot = process.resourcesPath
  ? path.join(process.resourcesPath, 'scripts', '..')
  : path.join(__dirname, '..');

const llmService = new LlmService({
  pythonScript: HF_SCRIPT,
  projectRoot: projectRoot,
});

// Initialize Action service
const actionService = new ActionService();

// Initialize GitHub Models service
const githubModelsService = new GitHubModelsService();

// ─── Middleware ─────────────────────────────────────────────────────────────────

// CORS: Allow portfolio frontend (sthopwood.com) and localhost origins
app.use(cors({
  origin: [
    'https://sthopwood.com',
    'http://sthopwood.com',
    'https://www.sthopwood.com',
    'http://www.sthopwood.com',
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
    /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  ],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ─── API Routes ────────────────────────────────────────────────────────────────

// Health check
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    pythonScript: HF_SCRIPT,
    timestamp: new Date().toISOString(),
    version: require('../package.json').version,
  });
});

// Get local network info for accessing from other devices
app.get('/api/network', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({
          interface: name,
          address: net.address,
          url: `http://${net.address}:${activePort}`,
          httpsUrl: `https://${net.address}:${activeHttpsPort}`,
        });
      }
    }
  }

  res.json({
    hostname: os.hostname(),
    port: activePort,
    httpsPort: activeHttpsPort,
    addresses,
  });
});

// List available models (scan local HFModels directory + defaults + GitHub Models)
app.get('/api/models', async (req, res) => {
  try {
    const localModels = await llmService.listAvailableModels();
    const webappSettings = readWebappSettings();
    const ghModels = (webappSettings.githubToken) ? GITHUB_MODELS : [];
    res.json({ models: [...localModels, ...ghModels] });
  } catch (err) {
    console.error('Error listing models:', err);
    res.json({ models: llmService.getDefaultModels() });
  }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const {
    message,
    modelId = 'gpt2',
    systemPrompt = '',
    temperature = 0.7,
    topP = 0.9,
    maxLength = 500,
    conversationHistory = [],
  } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // ── Security Layer 1: screen raw message before any processing ───────────
  const msgCheck = checkMessage(message);
  if (msgCheck.blocked) {
    console.warn(`[Security] Message blocked: ${msgCheck.reason}`);
    return res.status(403).json({
      error: 'Request blocked by security policy',
      reason: msgCheck.reason,
    });
  }

  try {
    const parseStartTime = Date.now();
    console.log(`[${new Date().toISOString()}] Chat request: model=${modelId}, message="${message.substring(0, 80)}..."`);

    // Check if the message is an action command
    let actionPlan = actionService.detectAction(message);

    // If message looks multi-step, prefer LLM parsing
    if (actionService.looksLikeMultiStep(message.toLowerCase())) {
      const webappSettings = readWebappSettings();
      if (webappSettings.githubToken) {
        githubModelsService.setToken(webappSettings.githubToken);
        try {
          const llmPlan = await actionService.detectActionWithLLM(message, async (msg, sysPrompt) => {
            const result = await githubModelsService.chat({
              message: msg,
              modelId: 'gpt-4o-mini',
              systemPrompt: sysPrompt,
              temperature: 0.1,
              maxLength: 300,
              conversationHistory: [],
            });
            return result.text;
          });
          if (llmPlan) actionPlan = llmPlan;
        } catch (err) {
          console.log(`[LLM Action Parser] Fallback to regex: ${err.message}`);
        }
      }
    }

    if (actionPlan) {
      console.log(`[${new Date().toISOString()}] Action detected: ${actionPlan.intent} - ${actionPlan.description}`);

      // Ask the LLM if this action needs user confirmation
      const webappSettings = readWebappSettings();
      if (webappSettings.githubToken) {
        githubModelsService.setToken(webappSettings.githubToken);
        try {
          const confirmResult = await actionService.checkConfirmation(
            actionPlan,
            message,
            async (msg, sysPrompt) => {
              const result = await githubModelsService.chat({
                message: msg,
                modelId: 'gpt-4o-mini',
                systemPrompt: sysPrompt,
                temperature: 0.1,
                maxLength: 200,
                conversationHistory: [],
              });
              return result.text;
            }
          );

          if (confirmResult && confirmResult.needsConfirmation) {
            const confirmationId = actionService.storeConfirmation(
              actionPlan,
              confirmResult.question,
              confirmResult.options,
              message
            );
            const parseTimeMs = Date.now() - parseStartTime;
            const elapsedSec = (parseTimeMs / 1000).toFixed(2);

            return res.json({
              response: confirmResult.question,
              modelId,
              generationTime: `${elapsedSec}s`,
              timestamp: new Date().toISOString(),
              confirmation: {
                id: confirmationId,
                question: confirmResult.question,
                options: confirmResult.options,
                originalAction: actionPlan.description,
              },
            });
          }
        } catch (err) {
          console.log(`[Confirmation Check] Skipping confirmation (error): ${err.message}`);
        }
      }

      // ── Security Layer 2: validate action plan before queuing ───────────
      const planCheck = checkActionPlan(actionPlan);
      if (planCheck.blocked) {
        console.warn(`[Security] Action plan blocked: ${planCheck.reason}`);
        return res.status(403).json({
          error: 'Action blocked by security policy',
          reason: planCheck.reason,
        });
      }

      // Execute immediately (no confirmation needed)
      const queuedAction = actionService.queueAction(actionPlan);
      const bridgeConnected = lastBridgePoll > 0 && (Date.now() - lastBridgePoll) < 5000;

      const estimatedMs = actionPlan.steps.reduce((sum, step) => {
        if (step.type === 'delay') return sum + (step.duration || 0);
        if (step.type === 'visualClick') return sum + 8000;
        if (step.type === 'typeText') return sum + (step.text?.length || 0) * 60;
        return sum + 100;
      }, 0);
      const parseTimeMs = Date.now() - parseStartTime;
      const totalEstimatedSec = ((estimatedMs + parseTimeMs) / 1000).toFixed(1);

      let responseText = actionService.formatActionResponse(actionPlan);
      if (!bridgeConnected) {
        responseText += '\n\n⚠️ **No action bridge connected.** Actions are queued but won\'t execute until the bridge is running.';
      }

      return res.json({
        response: responseText,
        modelId,
        generationTime: `~${totalEstimatedSec}s`,
        timestamp: new Date().toISOString(),
        action: {
          id: queuedAction.id,
          intent: actionPlan.intent,
          description: actionPlan.description,
          steps: actionPlan.steps,
          status: queuedAction.status,
          bridgeConnected,
        },
      });
    }

    // Check for action-like suggestions
    const suggestion = actionService.suggestAction(message);
    if (suggestion) {
      const elapsedSec = ((Date.now() - parseStartTime) / 1000).toFixed(2);
      const responseText = `I can help with that! 💡\n\n${suggestion}\n\nJust type the command directly and I'll execute it on your PC.`;
      return res.json({
        response: responseText,
        modelId,
        generationTime: `${elapsedSec}s`,
        timestamp: new Date().toISOString(),
      });
    }

    // Normal LLM chat with personality + memory context
    const personalityContext = loadPersonalityContext();
    const memoryContext = loadMemoryContext();
    const capabilitiesNote = `\nYou can execute system actions on this Windows PC: open apps, control volume/media, press keys, type text, play music services, and more. If the user asks to do something on their computer, do it or suggest a command like "mute", "open edge", "volume up", "play spotify", etc.\n\nYou can also:\n1. Save persistent memories using [MEMORY_SAVE:filename.md] blocks.\n2. Create files in the user's workspace using [FILE_CREATE:filename.ext] blocks.\n3. Create and run scripts using [SCRIPT_CREATE:filename.py] followed by [SCRIPT_RUN:filename.py] blocks.\n\nBlock formats:\n[MEMORY_SAVE:notes.md]\nPersistent knowledge to remember\n[/MEMORY_SAVE]\n\n[FILE_CREATE:document.txt]\nFile content here\n[/FILE_CREATE]\n\n[SCRIPT_CREATE:task.py]\nprint("Hello from CSimple")\n[/SCRIPT_CREATE]\n\n[SCRIPT_RUN:task.py]\n(optional args, one per line)\n[/SCRIPT_RUN]\n\nFiles are created in the CSimple Workspace directory. Scripts have a 30-second timeout.`;
    const memoryInstructions = memoryContext ? 
      `\nThe MEMORY section above contains your persistent knowledge. Reference it when relevant to the conversation.` : 
      '';
    const augmentedPrompt = (systemPrompt || '') + personalityContext + memoryContext + capabilitiesNote + memoryInstructions;

    const isGitHubModel = GITHUB_MODELS.some(m => m.id === modelId);

    let result;
    if (isGitHubModel) {
      const webappSettings = readWebappSettings();
      if (!webappSettings.githubToken) {
        return res.status(400).json({ error: 'GitHub token not configured. Go to Settings → General → LLM Provider to add your token.' });
      }
      githubModelsService.setToken(webappSettings.githubToken);
      result = await githubModelsService.chat({
        message,
        modelId,
        systemPrompt: augmentedPrompt,
        temperature,
        maxLength,
        conversationHistory,
      });
    } else {
      result = await llmService.chat({
        message,
        modelId,
        systemPrompt: augmentedPrompt,
        temperature,
        topP,
        maxLength,
        conversationHistory,
      });
    }

    // Post-process: extract and execute any LLM blocks (MEMORY_SAVE, FILE_CREATE, SCRIPT_CREATE, SCRIPT_RUN)
    const { cleanedText, operations } = await processLLMBlocks(result.text);

    const totalElapsedSec = ((Date.now() - parseStartTime) / 1000).toFixed(2);
    res.json({
      response: cleanedText,
      modelId,
      generationTime: `${totalElapsedSec}s`,
      timestamp: new Date().toISOString(),
      ...(operations.length > 0 && { operations }),
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({
      error: err.message || 'Model execution failed',
    });
  }
});

// Chat endpoint with Server-Sent Events for streaming
app.post('/api/chat/stream', async (req, res) => {
  const {
    message,
    modelId = 'gpt2',
    systemPrompt = '',
    temperature = 0.7,
    topP = 0.9,
    maxLength = 500,
    conversationHistory = [],
  } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    res.write(`data: ${JSON.stringify({ type: 'status', text: 'Loading model...' })}\n\n`);

    const result = await llmService.chat({
      message,
      modelId,
      systemPrompt,
      temperature,
      topP,
      maxLength,
      conversationHistory,
      onProgress: (progressText) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', text: progressText })}\n\n`);
      },
    });

    res.write(`data: ${JSON.stringify({ type: 'result', text: result.text, generationTime: result.generationTime })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`);
    res.end();
  }
});

// Stop current generation
app.post('/api/chat/stop', (req, res) => {
  llmService.stopCurrentGeneration();
  res.json({ status: 'stopped' });
});

// Confirm a pending action
app.post('/api/chat/confirm', async (req, res) => {
  const { confirmationId, selectedOption } = req.body;

  if (!confirmationId || !selectedOption) {
    return res.status(400).json({ error: 'confirmationId and selectedOption are required' });
  }

  const confirmation = actionService.getConfirmation(confirmationId);
  if (!confirmation) {
    return res.status(404).json({ error: 'Confirmation expired or not found. Please try again.' });
  }

  try {
    const webappSettings = readWebappSettings();
    let resolution = { action: 'execute' };

    if (webappSettings.githubToken) {
      githubModelsService.setToken(webappSettings.githubToken);
      resolution = await actionService.resolveConfirmation(
        confirmation,
        selectedOption,
        async (msg, sysPrompt) => {
          const result = await githubModelsService.chat({
            message: msg,
            modelId: 'gpt-4o-mini',
            systemPrompt: sysPrompt,
            temperature: 0.1,
            maxLength: 100,
            conversationHistory: [],
          });
          return result.text;
        }
      );
    } else {
      const lower = selectedOption.toLowerCase();
      if (lower.includes('cancel') || lower.includes('no') || lower.includes('never mind')) {
        resolution = { action: 'cancel' };
      }
    }

    if (resolution.action === 'cancel') {
      return res.json({
        response: 'Action cancelled.',
        cancelled: true,
        timestamp: new Date().toISOString(),
      });
    }

    let finalPlan = confirmation.actionPlan;
    if (resolution.action === 'modify' && resolution.modifiedCommand) {
      const newPlan = actionService.detectAction(resolution.modifiedCommand);
      if (newPlan) finalPlan = newPlan;
    }

    // ── Security Layer 2: re-validate final plan (it may have changed via modify) ──
    const confirmPlanCheck = checkActionPlan(finalPlan);
    if (confirmPlanCheck.blocked) {
      return res.status(403).json({ error: 'Action blocked by security policy', reason: confirmPlanCheck.reason });
    }

    const queuedAction = actionService.queueAction(finalPlan);
    const bridgeConnected = lastBridgePoll > 0 && (Date.now() - lastBridgePoll) < 5000;

    let responseText = actionService.formatActionResponse(finalPlan);
    if (!bridgeConnected) {
      responseText += '\n\n⚠️ **No action bridge connected.**';
    }

    return res.json({
      response: responseText,
      timestamp: new Date().toISOString(),
      action: {
        id: queuedAction.id,
        intent: finalPlan.intent,
        description: finalPlan.description,
        steps: finalPlan.steps,
        status: queuedAction.status,
        bridgeConnected,
      },
    });
  } catch (err) {
    console.error('[Confirmation] Error:', err.message);
    // ── Security: validate fallback plan too ───────────────────────────
    const fallbackCheck = checkActionPlan(confirmation.actionPlan);
    if (fallbackCheck.blocked) {
      return res.status(403).json({ error: 'Action blocked by security policy', reason: fallbackCheck.reason });
    }
    const queuedAction = actionService.queueAction(confirmation.actionPlan);
    return res.json({
      response: actionService.formatActionResponse(confirmation.actionPlan),
      timestamp: new Date().toISOString(),
      action: {
        id: queuedAction.id,
        intent: confirmation.actionPlan.intent,
        description: confirmation.actionPlan.description,
        steps: confirmation.actionPlan.steps,
        status: queuedAction.status,
      },
    });
  }
});

// ─── Action Execution API ──────────────────────────────────────────────────────

app.post('/api/actions/execute', (req, res) => {
  const { command } = req.body;
  if (!command || !command.trim()) {
    return res.status(400).json({ error: 'Command is required' });
  }

  // ── Security Layer 1: screen command message ──────────────────────────────
  const cmdMsgCheck = checkMessage(command);
  if (cmdMsgCheck.blocked) {
    return res.status(403).json({ error: 'Command blocked by security policy', reason: cmdMsgCheck.reason });
  }

  const actionPlan = actionService.detectAction(command);
  if (!actionPlan) {
    return res.status(400).json({
      error: 'Could not parse action command',
      hint: 'Try commands like: "open edge", "type hello", "press ctrl+c", "copy", "save"',
    });
  }

  // ── Security Layer 2: validate action plan ────────────────────────────────
  const cmdPlanCheck = checkActionPlan(actionPlan);
  if (cmdPlanCheck.blocked) {
    return res.status(403).json({ error: 'Action blocked by security policy', reason: cmdPlanCheck.reason });
  }

  const queuedAction = actionService.queueAction(actionPlan);
  res.json({
    action: {
      id: queuedAction.id,
      intent: actionPlan.intent,
      description: actionPlan.description,
      steps: actionPlan.steps,
      status: queuedAction.status,
    },
  });
});

// Get pending actions (polled by MAUI app or ActionBridge)
let lastBridgePoll = 0;
app.get('/api/actions/pending', (req, res) => {
  lastBridgePoll = Date.now();
  const actions = actionService.getPendingActions();
  res.json({ actions });
});

// Mark action as completed
app.post('/api/actions/complete', (req, res) => {
  const { actionId, success, error } = req.body;
  const action = actionService.completeAction(actionId, success, error);
  res.json({ action: action || null });
});

// Check if an action bridge is connected
app.get('/api/actions/bridge-status', (req, res) => {
  const connected = lastBridgePoll > 0 && (Date.now() - lastBridgePoll) < 5000;
  res.json({
    connected,
    lastPoll: lastBridgePoll,
    // Help the frontend show useful guidance when bridge is not connected
    info: connected ? null : {
      message: 'No ActionBridge connected. System actions (keyboard, mouse, app control) require the ActionBridge.',
      downloadUrl: 'https://github.com/tnnrhpwd/portfolio-app/releases',
      hint: 'Download and run CSimple.ActionBridge to enable PC automation features.',
    },
  });
});

// Get action execution history
app.get('/api/actions/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({ actions: actionService.getHistory(limit) });
});

// ─── Workspace File Operations API ────────────────────────────────────────────
// Sandboxed file operations in ~/Documents/CSimple/Workspace/
// Enables agents to create files, scripts, and auto-execute them.

// List files in workspace
app.get('/api/workspace/files', (req, res) => {
  const subdir = req.query.type === 'scripts' ? 'scripts' : 'files';
  const result = actionService.listFiles(subdir);
  if (result.success) {
    res.json({ files: result.files, directory: subdir });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Get a workspace file
app.get('/api/workspace/files/:filename', (req, res) => {
  const subdir = req.query.type === 'scripts' ? 'scripts' : 'files';
  const result = actionService.readFile(req.params.filename, subdir);
  if (result.success) {
    res.json({ filename: req.params.filename, content: result.content, path: result.path });
  } else {
    res.status(result.error === 'File not found' ? 404 : 400).json({ error: result.error });
  }
});

// Create/update a workspace file
app.post('/api/workspace/files', (req, res) => {
  const { filename, content, type } = req.body;
  if (!filename) return res.status(400).json({ error: 'Filename is required' });
  const subdir = type === 'scripts' ? 'scripts' : 'files';
  // ── Security: validate script content before saving ──────────────────────
  if (subdir === 'scripts' && content) {
    const fileExt = require('path').extname(filename).toLowerCase();
    const fileCheck = checkScriptContent(content, fileExt);
    if (fileCheck.blocked) {
      return res.status(403).json({ error: 'Script content blocked by security policy', reason: fileCheck.reason });
    }
  }
  const result = actionService.createFile(filename, content || '', subdir);
  if (result.success) {
    res.json({ status: result.action, filename, path: result.path });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// Delete a workspace file
app.delete('/api/workspace/files/:filename', (req, res) => {
  const subdir = req.query.type === 'scripts' ? 'scripts' : 'files';
  const result = actionService.deleteFile(req.params.filename, subdir);
  if (result.success) {
    res.json({ status: 'deleted', filename: req.params.filename });
  } else {
    res.status(result.error === 'File not found' ? 404 : 400).json({ error: result.error });
  }
});

// Execute a script from the workspace (requires confirmation for destructive scripts)
app.post('/api/workspace/execute', async (req, res) => {
  const { filename, args = [] } = req.body;
  if (!filename) return res.status(400).json({ error: 'Script filename is required' });

  console.log(`[Workspace] Executing script: ${filename} with args: ${JSON.stringify(args)}`);
  const result = await actionService.executeScript(filename, args);

  // Log to action history
  const historyEntry = {
    id: Date.now().toString(),
    command: `execute ${filename}`,
    intent: 'script_execute',
    description: `Execute script: ${filename}`,
    steps: [{ type: 'runScript', filename, args }],
    status: result.success ? 'completed' : 'failed',
    queuedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    result: {
      exitCode: result.exitCode,
      stdout: result.stdout?.slice(0, 2000), // Truncate for history
      stderr: result.stderr?.slice(0, 1000),
    },
  };
  actionService.actionHistory.push(historyEntry);
  actionService._persistHistory();

  if (result.success) {
    res.json({
      status: 'completed',
      filename,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } else {
    res.status(400).json({
      status: 'failed',
      filename,
      exitCode: result.exitCode,
      error: result.error,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
});

// ─── Vision-based text/element finding ─────────────────────────────────────────

app.post('/api/vision/find-text', async (req, res) => {
  const { image, target, width, height } = req.body;
  if (!image || !target) {
    return res.status(400).json({ found: false, error: 'image (base64) and target are required' });
  }

  try {
    const webappSettings = readWebappSettings();
    if (!webappSettings.githubToken) {
      return res.status(400).json({ found: false, error: 'GitHub token not configured' });
    }

    githubModelsService.setToken(webappSettings.githubToken);

    const prompt = `You are a VISUAL ELEMENT DETECTOR for mouse automation.
Task: Find the clickable BUTTON containing "${target}" by detecting its VISUAL BOUNDARIES.
Screenshot: ${width} × ${height} px

Return ONLY this JSON (NO markdown):
{"found":true,"bounds":{"left":100,"top":50,"right":300,"bottom":150},"x":200,"y":100}

If not visible: {"found":false}`;

    const result = await githubModelsService.chatWithImage({
      prompt,
      imageBase64: image,
      mimeType: 'image/jpeg',
      modelId: 'gpt-4o-mini',
      temperature: 0.1,
      maxLength: 100,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ found: false, error: 'No structured response from model' });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.found && parsed.bounds) {
      const { left, top, right, bottom } = parsed.bounds;
      const calculatedX = Math.round((left + right) / 2);
      const calculatedY = Math.round((top + bottom) / 2);
      if (Math.abs(parsed.x - calculatedX) > 5 || Math.abs(parsed.y - calculatedY) > 5) {
        parsed.x = calculatedX;
        parsed.y = calculatedY;
      }
    }

    return res.json(parsed);
  } catch (err) {
    console.error(`[Vision] Error: ${err.message}`);
    return res.status(500).json({ found: false, error: err.message });
  }
});

// ─── Settings API ──────────────────────────────────────────────────────────────

function readWebappSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      return data.webapp || getDefaultWebappSettings();
    }
  } catch (err) {
    console.error('Error reading settings:', err.message);
  }
  return getDefaultWebappSettings();
}

function writeWebappSettings(webappSettings) {
  try {
    let data = {};
    if (fs.existsSync(SETTINGS_PATH)) {
      data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
    data.webapp = webappSettings;
    data.lastUpdated = new Date().toISOString().replace('T', ' ').substring(0, 19);
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing settings:', err.message);
    return false;
  }
}

function getDefaultWebappSettings() {
  return {
    saveChatsLocally: true,
    theme: 'dark',
    fontSize: 'medium',
    sendWithEnter: true,
    showTimestamps: true,
    enableMarkdown: true,
    maxConversationHistory: 50,
    defaultTemperature: 0.7,
    defaultMaxTokens: 500,
    agents: [
      {
        id: 'default',
        name: 'C-Simple AI',
        avatarUrl: null,
        behaviorFile: 'default.txt',
        isDefault: true,
      },
    ],
    selectedAgentId: 'default',
  };
}

app.get('/api/settings', (req, res) => {
  res.json(readWebappSettings());
});

app.put('/api/settings', (req, res) => {
  const settings = req.body;
  if (writeWebappSettings(settings)) {
    res.json({ status: 'ok', settings });
  } else {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ─── Behavior Files API ────────────────────────────────────────────────────────

app.get('/api/behaviors', (req, res) => {
  try {
    if (!fs.existsSync(BEHAVIORS_PATH)) {
      return res.json({ behaviors: [] });
    }
    const files = fs.readdirSync(BEHAVIORS_PATH)
      .filter(f => f.endsWith('.txt'))
      .map(f => ({
        filename: f,
        name: f.replace('.txt', '').replace(/_/g, ' '),
      }));
    res.json({ behaviors: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/behaviors/:filename', (req, res) => {
  try {
    const filePath = safePath(req.params.filename, BEHAVIORS_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Behavior file not found' });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ filename: req.params.filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/behaviors', (req, res) => {
  try {
    const { filename, content } = req.body;
    if (!filename || !filename.endsWith('.txt')) {
      return res.status(400).json({ error: 'Filename must end with .txt' });
    }
    const sizeErr = validateFileContent(content);
    if (sizeErr) return res.status(400).json({ error: sizeErr });
    const filePath = safePath(filename, BEHAVIORS_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(BEHAVIORS_PATH)) {
      fs.mkdirSync(BEHAVIORS_PATH, { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      return res.status(409).json({ error: 'File already exists' });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ status: 'created', filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/behaviors/:filename', (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    const sizeErr = validateFileContent(content);
    if (sizeErr) return res.status(400).json({ error: sizeErr });
    const filePath = safePath(req.params.filename, BEHAVIORS_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Behavior file not found' });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ status: 'updated', filename: req.params.filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/behaviors/:filename', (req, res) => {
  try {
    const filePath = safePath(req.params.filename, BEHAVIORS_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Behavior file not found' });
    }
    if (req.params.filename === 'default.txt') {
      return res.status(403).json({ error: 'Cannot delete default behavior file' });
    }
    fs.unlinkSync(filePath);
    res.json({ status: 'deleted', filename: req.params.filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Memory Files API ──────────────────────────────────────────────────────────

app.get('/api/memory', (req, res) => {
  try {
    if (!fs.existsSync(MEMORY_PATH)) {
      return res.json({ files: [] });
    }
    const files = fs.readdirSync(MEMORY_PATH)
      .filter(f => !fs.statSync(path.join(MEMORY_PATH, f)).isDirectory())
      .map(f => ({
        filename: f,
        name: f.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
      }));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/memory/:filename', (req, res) => {
  try {
    const filePath = safePath(req.params.filename, MEMORY_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Memory file not found' });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ filename: req.params.filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memory', (req, res) => {
  try {
    const { filename, content } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }
    const sizeErr = validateFileContent(content);
    if (sizeErr) return res.status(400).json({ error: sizeErr });
    const filePath = safePath(filename, MEMORY_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(MEMORY_PATH)) {
      fs.mkdirSync(MEMORY_PATH, { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      return res.status(409).json({ error: 'File already exists' });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ status: 'created', filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/memory/:filename', (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    const sizeErr = validateFileContent(content);
    if (sizeErr) return res.status(400).json({ error: sizeErr });
    const filePath = safePath(req.params.filename, MEMORY_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Memory file not found' });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ status: 'updated', filename: req.params.filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/memory/:filename', (req, res) => {
  try {
    const filePath = safePath(req.params.filename, MEMORY_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Memory file not found' });
    }
    fs.unlinkSync(filePath);
    res.json({ status: 'deleted', filename: req.params.filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Personality Files API ─────────────────────────────────────────────────────

app.get('/api/personality', (req, res) => {
  try {
    if (!fs.existsSync(PERSONALITY_PATH)) {
      return res.json({ files: [] });
    }
    const files = fs.readdirSync(PERSONALITY_PATH)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        filename: f,
        name: f.replace('.md', '').replace(/_/g, ' '),
      }));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/personality/:filename', (req, res) => {
  try {
    const filePath = safePath(req.params.filename, PERSONALITY_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Personality file not found' });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ filename: req.params.filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/personality/:filename', (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    const sizeErr = validateFileContent(content);
    if (sizeErr) return res.status(400).json({ error: sizeErr });
    const filePath = safePath(req.params.filename, PERSONALITY_PATH);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ status: 'updated', filename: req.params.filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent Avatar API ──────────────────────────────────────────────────────────

app.post('/api/agents/:agentId/avatar', avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or invalid file type' });
  }
  const avatarUrl = `/api/agents/${req.params.agentId}/avatar`;
  res.json({ status: 'ok', avatarUrl });
});

app.get('/api/agents/:agentId/avatar', (req, res) => {
  const avatarsDir = path.join(AGENTS_PATH, 'avatars');
  if (!fs.existsSync(avatarsDir)) {
    return res.status(404).json({ error: 'No avatar found' });
  }
  const files = fs.readdirSync(avatarsDir).filter(f => f.startsWith(req.params.agentId + '.'));
  if (files.length === 0) {
    return res.status(404).json({ error: 'No avatar found' });
  }
  res.sendFile(path.join(avatarsDir, files[0]));
});

// ─── Signal Bridge Config ──────────────────────────────────────────────────────

app.get('/api/signal/config', (req, res) => {
  const configPath = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources', 'signal-bridge.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const safe = {
        signalPhone: config.signalPhone ? config.signalPhone.replace(/.(?=.{4})/g, '*') : '',
        modelId: config.modelId,
        webappUrl: config.webappUrl,
        pollIntervalMs: config.pollIntervalMs,
        allowedNumbers: (config.allowedNumbers || []).length,
        configured: !!config.signalPhone,
      };
      res.json(safe);
    } catch (err) {
      res.json({ configured: false, error: err.message });
    }
  } else {
    res.json({ configured: false });
  }
});

// ─── HTTPS Self-Signed Certificate ─────────────────────────────────────────────

function getCertsDir() {
  return path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'CSimple', 'certs'
  );
}

function ensureSelfSignedCert() {
  const certsDir = getCertsDir();
  const keyPath = path.join(certsDir, 'server.key');
  const certPath = path.join(certsDir, 'server.crt');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  try {
    if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });
    console.log('[HTTPS] Generating self-signed certificate...');

    // Collect all local IPv4 addresses for SAN
    const sanParts = ['DNS:localhost', 'IP:127.0.0.1'];
    const interfaces = os.networkInterfaces();
    for (const nets of Object.values(interfaces)) {
      for (const net of nets) {
        if (net.family === 'IPv4' && !net.internal) {
          sanParts.push(`IP:${net.address}`);
        }
      }
    }

    // Find OpenSSL
    let opensslCmd = 'openssl';
    try {
      execSync('openssl version', { stdio: 'pipe' });
    } catch {
      const gitOpenssl = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
      if (fs.existsSync(gitOpenssl)) {
        opensslCmd = `"${gitOpenssl}"`;
      } else {
        throw new Error('OpenSSL not found on PATH or in Git for Windows');
      }
    }

    execSync(
      `${opensslCmd} req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
      `-days 365 -nodes -subj "/CN=CSimple Local Dev" ` +
      `-addext "subjectAltName=${sanParts.join(',')}"`,
      { stdio: 'pipe' }
    );
    console.log('[HTTPS] Certificate generated successfully.');
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  } catch (e) {
    console.warn('[HTTPS] OpenSSL not available — HTTPS disabled.');
    console.warn('[HTTPS] Error:', e.message);
    return null;
  }
}

// ─── Server Lifecycle ──────────────────────────────────────────────────────────

let httpServer = null;
let httpsServer = null;
let activePort = DEFAULT_PORT;
let activeHttpsPort = DEFAULT_PORT + 443;

/**
 * Start the Express server. Tries the default port and increments if busy.
 * @param {Object} options
 * @param {number} options.port - Starting port (default: 3001)
 * @param {string} options.host - Bind address (default: '0.0.0.0')
 * @returns {Promise<{ port: number, httpsPort: number|null }>}
 */
function startServer(options = {}) {
  const { port = DEFAULT_PORT, host = '0.0.0.0' } = options;

  return new Promise((resolve, reject) => {
    let tryPort = port;
    const maxAttempts = 10;

    function tryListen(attempt) {
      if (attempt >= maxAttempts) {
        return reject(new Error(`Could not find an available port after ${maxAttempts} attempts`));
      }

      httpServer = app.listen(tryPort, host, () => {
        activePort = tryPort;
        activeHttpsPort = tryPort + 443;
        console.log(`[Server] HTTP listening on ${host}:${activePort}`);

        // Try HTTPS
        const sslCreds = ensureSelfSignedCert();
        if (sslCreds) {
          try {
            httpsServer = https.createServer(sslCreds, app);
            httpsServer.listen(activeHttpsPort, host, () => {
              console.log(`[Server] HTTPS listening on ${host}:${activeHttpsPort}`);
              resolve({ port: activePort, httpsPort: activeHttpsPort });
            });
            httpsServer.on('error', () => {
              console.warn(`[Server] HTTPS port ${activeHttpsPort} unavailable`);
              resolve({ port: activePort, httpsPort: null });
            });
          } catch (e) {
            console.warn('[Server] HTTPS failed:', e.message);
            resolve({ port: activePort, httpsPort: null });
          }
        } else {
          resolve({ port: activePort, httpsPort: null });
        }
      });

      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[Server] Port ${tryPort} in use, trying ${tryPort + 1}...`);
          tryPort++;
          tryListen(attempt + 1);
        } else {
          reject(err);
        }
      });
    }

    tryListen(0);
  });
}

/**
 * Stop the Express server and clean up.
 */
function stopServer() {
  return new Promise((resolve) => {
    let closed = 0;
    const total = (httpServer ? 1 : 0) + (httpsServer ? 1 : 0);
    if (total === 0) return resolve();

    const onClose = () => {
      closed++;
      if (closed >= total) resolve();
    };

    if (httpsServer) {
      httpsServer.close(onClose);
      httpsServer = null;
    }
    if (httpServer) {
      httpServer.close(onClose);
      httpServer = null;
    }

    // Force resolve after 3 seconds
    setTimeout(resolve, 3000);
  });
}

/**
 * Stop LLM generation if running.
 */
function stopGeneration() {
  llmService.stopCurrentGeneration();
}

module.exports = {
  app,
  startServer,
  stopServer,
  stopGeneration,
  getPort: () => activePort,
  getHttpsPort: () => activeHttpsPort,
};
