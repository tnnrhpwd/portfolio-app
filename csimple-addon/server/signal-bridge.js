/**
 * Signal Bridge Service for CSimple Webapp
 *
 * Bridges Signal messages to the webapp's /api/chat endpoint using signal-cli.
 * One Signal account acts as the "bot" — any messages it receives get forwarded
 * to the LLM, and responses are sent back via Signal.
 *
 * Requirements:
 *   - Java 21+ (for signal-cli)
 *   - signal-cli installed and on PATH (or set SIGNAL_CLI_PATH env var)
 *   - A registered Signal account (phone number) dedicated as the bot
 *
 * Usage:
 *   node server/signal-bridge.js              # standalone
 *   npm run start:signal                       # via npm script
 *
 * Environment variables:
 *   SIGNAL_PHONE        - Bot's phone number in E.164 format (e.g., +15551234567)
 *   SIGNAL_CLI_PATH     - Path to signal-cli binary (default: "signal-cli" on PATH)
 *   WEBAPP_URL          - Webapp base URL (default: http://localhost:3001)
 *   SIGNAL_MODEL        - LLM model to use (default: gpt-4o-mini)
 *   SIGNAL_POLL_INTERVAL - Poll interval in ms (default: 2000)
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');

// ─── Configuration ─────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources');
const SIGNAL_CONFIG_PATH = path.join(CONFIG_DIR, 'signal-bridge.json');

/** Load or create default config */
function loadConfig() {
  const defaults = {
    signalPhone: process.env.SIGNAL_PHONE || '',
    signalCliPath: process.env.SIGNAL_CLI_PATH || 'signal-cli',
    webappUrl: process.env.WEBAPP_URL || 'http://localhost:3001',
    modelId: process.env.SIGNAL_MODEL || 'gpt-4o-mini',
    pollIntervalMs: parseInt(process.env.SIGNAL_POLL_INTERVAL) || 2000,
    systemPrompt: 'You are a helpful AI assistant responding via Signal messages. Keep responses concise and mobile-friendly. Use plain text formatting (no markdown).',
    maxResponseLength: 1500,
    allowedNumbers: [], // empty = allow all; otherwise whitelist of E.164 numbers
    conversationHistory: {}, // per-sender history: { "+1555...": [{role, content}] }
    maxHistoryPerUser: 20,
  };

  if (fs.existsSync(SIGNAL_CONFIG_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SIGNAL_CONFIG_PATH, 'utf-8'));
      return { ...defaults, ...saved, conversationHistory: defaults.conversationHistory };
    } catch (err) {
      console.error(`[Signal Bridge] ⚠️ Failed to read config: ${err.message}`);
    }
  }

  return defaults;
}

/** Save config (excluding runtime state) */
function saveConfig(config) {
  const toSave = { ...config };
  delete toSave.conversationHistory; // Don't persist conversation state
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SIGNAL_CONFIG_PATH, JSON.stringify(toSave, null, 2));
}

// ─── Signal CLI Wrapper ────────────────────────────────────────────────────────

class SignalCli {
  constructor(cliPath, phoneNumber) {
    this.cliPath = cliPath;
    this.phone = phoneNumber;
    // For .bat files on Windows, we need to use cmd.exe /c to execute them
    this.isBat = cliPath.endsWith('.bat') || cliPath.endsWith('.cmd');
  }

  /** Build the shell command string, handling .bat files properly */
  _buildCmd(args) {
    const argsStr = args.join(' ');
    if (this.isBat) {
      // cmd /c requires the entire command in quotes for paths with spaces
      return `cmd /c ""${this.cliPath}" ${argsStr}"`;
    }
    return `"${this.cliPath}" ${argsStr}`;
  }

  /** Run a signal-cli command and return stdout */
  exec(args, timeoutMs = 30000) {
    const fullArgs = ['-a', this.phone, ...args];
    const cmd = this._buildCmd(fullArgs);

    try {
      const result = execSync(cmd, {
        timeout: timeoutMs,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim();
    } catch (err) {
      const stderr = err.stderr?.toString().trim() || '';
      throw new Error(`signal-cli error: ${stderr || err.message}`);
    }
  }

  /** Run a signal-cli command with global flags before -a */
  execGlobal(globalArgs, subArgs, timeoutMs = 30000) {
    const fullArgs = [...globalArgs, '-a', this.phone, ...subArgs];
    const cmd = this._buildCmd(fullArgs);

    try {
      const result = execSync(cmd, {
        timeout: timeoutMs,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim();
    } catch (err) {
      const stderr = err.stderr?.toString().trim() || '';
      throw new Error(`signal-cli error: ${stderr || err.message}`);
    }
  }

  /** Receive new messages as JSON */
  receive() {
    try {
      const output = this.execGlobal(['-o', 'json'], ['receive', '-t', '5', '--send-read-receipts'], 60000);
      if (!output) return [];

      // signal-cli outputs one JSON object per line
      return output
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (err) {
      console.error(`[Signal Bridge] ❌ Receive error: ${err.message}`);
      return [];
    }
  }

  /** Send a message to a recipient */
  send(recipient, message) {
    try {
      // Escape double quotes in the message for shell safety
      const escapedMsg = message.replace(/"/g, '\\"');
      this.exec(['send', '-m', `"${escapedMsg}"`, recipient]);
      return true;
    } catch (err) {
      console.error(`[Signal Bridge] ❌ Send error: ${err.message}`);
      return false;
    }
  }

  /** Send a reaction to a message */
  sendReaction(recipient, emoji, targetTimestamp) {
    try {
      this.exec([
        'sendReaction',
        '-t', targetTimestamp.toString(),
        '-e', emoji,
        recipient,
      ]);
    } catch {
      // Reactions are best-effort
    }
  }

  /** Check if signal-cli is available */
  checkAvailable() {
    try {
      const cmd = this.isBat
        ? `cmd /c ""${this.cliPath}" --version"`
        : `"${this.cliPath}" --version`;
      const version = execSync(cmd, {
        timeout: 10000,
        encoding: 'utf-8',
      }).trim();
      return version;
    } catch {
      return null;
    }
  }

  /** Check if the phone number is registered */
  checkRegistered() {
    try {
      const accounts = this.exec(['listAccounts'], 10000);
      return accounts.includes(this.phone);
    } catch {
      try {
        this.exec(['receive', '-t', '1'], 15000);
        return true;
      } catch {
        return false;
      }
    }
  }
}

// ─── Webapp Chat Client ────────────────────────────────────────────────────────

class WebappChatClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Send a chat message to the webapp and get the response */
  async chat(message, modelId, systemPrompt, conversationHistory = [], maxLength = 1500) {
    const url = `${this.baseUrl}/api/chat`;
    const body = JSON.stringify({
      message,
      modelId,
      systemPrompt,
      temperature: 0.7,
      maxLength,
      conversationHistory,
    });

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        rejectUnauthorized: false, // Allow self-signed certs
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    });
  }

  /** Check if webapp is reachable */
  async checkHealth() {
    return new Promise((resolve) => {
      const url = `${this.baseUrl}/api/status`;
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(url, { rejectUnauthorized: false }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(true));
      });
      req.on('error', () => resolve(false));
      req.setTimeout(5000, () => { req.destroy(); resolve(false); });
    });
  }
}

// ─── Bridge Logic ──────────────────────────────────────────────────────────────

class SignalBridge {
  constructor(config) {
    this.config = config;
    this.cli = new SignalCli(config.signalCliPath, config.signalPhone);
    this.chatClient = new WebappChatClient(config.webappUrl);
    this.running = false;
    this.messageCount = 0;
    this.startTime = null;
  }

  /** Extract text message from signal-cli JSON envelope */
  extractMessage(envelope) {
    // Standard data message
    if (envelope?.envelope?.dataMessage?.message) {
      return {
        sender: envelope.envelope.source || envelope.envelope.sourceNumber,
        text: envelope.envelope.dataMessage.message,
        timestamp: envelope.envelope.dataMessage.timestamp,
        isGroup: !!envelope.envelope.dataMessage.groupInfo,
        groupId: envelope.envelope.dataMessage.groupInfo?.groupId,
      };
    }
    // syncMessage (messages sent by the bot account itself — ignore)
    if (envelope?.envelope?.syncMessage) {
      return null;
    }
    return null;
  }

  /** Manage per-user conversation history */
  getHistory(sender) {
    if (!this.config.conversationHistory[sender]) {
      this.config.conversationHistory[sender] = [];
    }
    return this.config.conversationHistory[sender];
  }

  addToHistory(sender, role, content) {
    const history = this.getHistory(sender);
    history.push({ role, content });
    // Trim to max history
    while (history.length > this.config.maxHistoryPerUser) {
      history.shift();
    }
  }

  clearHistory(sender) {
    this.config.conversationHistory[sender] = [];
  }

  /** Process a single incoming message */
  async processMessage(msgInfo) {
    const { sender, text, timestamp } = msgInfo;

    // Check allowlist
    if (this.config.allowedNumbers.length > 0 &&
        !this.config.allowedNumbers.includes(sender)) {
      console.log(`[Signal Bridge] 🚫 Blocked message from ${sender} (not in allowlist)`);
      return;
    }

    console.log(`[Signal Bridge] 📩 From ${sender}: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

    // Handle special commands
    const lowerText = text.trim().toLowerCase();
    if (lowerText === '/clear' || lowerText === '/reset') {
      this.clearHistory(sender);
      this.cli.send(sender, '🧹 Conversation history cleared.');
      return;
    }
    if (lowerText === '/status') {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const mins = Math.floor((uptime % 3600) / 60);
      const webappOk = await this.chatClient.checkHealth();
      this.cli.send(sender, [
        `📊 Signal Bridge Status`,
        `• Uptime: ${hours}h ${mins}m`,
        `• Messages processed: ${this.messageCount}`,
        `• Model: ${this.config.modelId}`,
        `• Webapp: ${webappOk ? '✅ connected' : '❌ offline'}`,
        `• History: ${this.getHistory(sender).length} messages`,
      ].join('\n'));
      return;
    }
    if (lowerText === '/help') {
      this.cli.send(sender, [
        `🤖 CSimple Signal Bot`,
        ``,
        `Just send any message to chat with the AI.`,
        ``,
        `Commands:`,
        `• /clear — Reset conversation history`,
        `• /status — Show bridge status`,
        `• /model <name> — Switch LLM model`,
        `• /help — Show this help`,
      ].join('\n'));
      return;
    }
    if (lowerText.startsWith('/model ')) {
      const newModel = text.trim().substring(7).trim();
      this.config.modelId = newModel;
      saveConfig(this.config);
      this.cli.send(sender, `🔄 Model switched to: ${newModel}`);
      return;
    }

    // Forward to webapp chat
    try {
      const history = this.getHistory(sender);

      const result = await this.chatClient.chat(
        text,
        this.config.modelId,
        this.config.systemPrompt,
        history,
        this.config.maxResponseLength
      );

      const response = result.response || result.error || 'No response from AI.';

      // Update history
      this.addToHistory(sender, 'user', text);
      this.addToHistory(sender, 'assistant', response);

      // Truncate very long responses for Signal
      let finalResponse = response;
      if (finalResponse.length > 4000) {
        finalResponse = finalResponse.substring(0, 3950) + '\n\n... (truncated)';
      }

      // Send response back
      const sent = this.cli.send(sender, finalResponse);
      if (sent) {
        this.messageCount++;
        console.log(`[Signal Bridge] ✅ Replied to ${sender} (${result.generationTime || '?'})`);
      } else {
        console.error(`[Signal Bridge] ❌ Failed to send reply to ${sender}`);
      }
    } catch (err) {
      console.error(`[Signal Bridge] ❌ Chat error: ${err.message}`);
      this.cli.send(sender, `⚠️ Error: ${err.message}\n\nMake sure the webapp server is running.`);
    }
  }

  /** Main polling loop */
  async run() {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  🔗 CSimple Signal Bridge');
    console.log('════════════════════════════════════════════════════════════');

    // Pre-flight checks
    const version = this.cli.checkAvailable();
    if (!version) {
      console.error('\n❌ signal-cli not found!');
      console.error('   Install it from: https://github.com/AsamK/signal-cli/releases');
      console.error(`   Or set SIGNAL_CLI_PATH env var to the full path.`);
      console.error(`   Current path: "${this.config.signalCliPath}"`);
      process.exit(1);
    }
    console.log(`  ✅ signal-cli: ${version}`);

    if (!this.config.signalPhone) {
      console.error('\n❌ No Signal phone number configured!');
      console.error('   Set SIGNAL_PHONE env var or edit:');
      console.error(`   ${SIGNAL_CONFIG_PATH}`);
      console.error('   Example: SIGNAL_PHONE=+15551234567 node server/signal-bridge.js');
      process.exit(1);
    }
    console.log(`  📱 Bot number: ${this.config.signalPhone}`);

    const webappOk = await this.chatClient.checkHealth();
    console.log(`  🌐 Webapp: ${webappOk ? '✅ connected' : '⚠️ offline (will retry)'} (${this.config.webappUrl})`);
    console.log(`  🤖 Model: ${this.config.modelId}`);
    console.log(`  ⏱️  Poll interval: ${this.config.pollIntervalMs}ms`);

    if (this.config.allowedNumbers.length > 0) {
      console.log(`  🔒 Allowlist: ${this.config.allowedNumbers.join(', ')}`);
    } else {
      console.log(`  🔓 Allowlist: disabled (accepting all senders)`);
    }

    console.log('════════════════════════════════════════════════════════════');
    console.log('  Listening for incoming Signal messages...\n');

    // Save config if it was freshly generated
    saveConfig(this.config);

    this.running = true;
    this.startTime = Date.now();

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n[Signal Bridge] Shutting down...');
      this.running = false;
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      this.running = false;
      process.exit(0);
    });

    // Polling loop
    while (this.running) {
      try {
        const envelopes = this.cli.receive();

        for (const envelope of envelopes) {
          const msgInfo = this.extractMessage(envelope);
          if (msgInfo && msgInfo.text && !msgInfo.isGroup) {
            await this.processMessage(msgInfo);
          }
        }
      } catch (err) {
        console.error(`[Signal Bridge] ⚠️ Poll error: ${err.message}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
    }
  }
}

// ─── CLI Entry Point ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Handle setup subcommand
  if (args[0] === 'setup') {
    await runSetup();
    return;
  }

  if (args[0] === 'register') {
    await registerAccount(args[1]);
    return;
  }

  if (args[0] === 'verify') {
    await verifyAccount(args[1], args[2]);
    return;
  }

  if (args[0] === 'link') {
    await linkDevice();
    return;
  }

  const config = loadConfig();
  const bridge = new SignalBridge(config);
  await bridge.run();
}

/** Interactive setup helper */
async function runSetup() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('\n🔧 CSimple Signal Bridge Setup\n');

  const config = loadConfig();

  // Check signal-cli
  const cli = new SignalCli(config.signalCliPath, '');
  const version = cli.checkAvailable();
  if (!version) {
    console.log('❌ signal-cli not found on PATH.');
    console.log('');
    console.log('Installation steps:');
    console.log('  1. Install Java 21+: https://adoptium.net/');
    console.log('  2. Download signal-cli: https://github.com/AsamK/signal-cli/releases');
    console.log('  3. Extract and add to PATH (or set SIGNAL_CLI_PATH)');
    console.log('');
    const cliPath = await ask('Enter signal-cli path (or press Enter to skip): ');
    if (cliPath.trim()) {
      config.signalCliPath = cliPath.trim();
      const cli2 = new SignalCli(config.signalCliPath, '');
      const v2 = cli2.checkAvailable();
      if (!v2) {
        console.log(`❌ Still can't find signal-cli at "${cliPath}". Exiting.`);
        rl.close();
        return;
      }
      console.log(`✅ Found: ${v2}`);
    } else {
      console.log('⏭️  Skipping — install signal-cli first, then re-run setup.');
      rl.close();
      return;
    }
  } else {
    console.log(`✅ signal-cli found: ${version}`);
  }

  // Phone number
  console.log('');
  const phone = await ask('Enter the bot Signal phone number (E.164 format, e.g., +15551234567): ');
  if (!phone.trim().startsWith('+')) {
    console.log('❌ Phone number must start with + (E.164 format)');
    rl.close();
    return;
  }
  config.signalPhone = phone.trim();

  // Registration method
  console.log('');
  console.log('How is this number set up with Signal?');
  console.log('  1. Already registered with signal-cli (ready to use)');
  console.log('  2. Need to register via SMS verification');
  console.log('  3. Need to link as secondary device to existing Signal app');
  const method = await ask('Choice (1/2/3): ');

  if (method.trim() === '2') {
    console.log(`\nRegistering ${config.signalPhone} via SMS...`);
    try {
      const regCli = new SignalCli(config.signalCliPath, config.signalPhone);
      regCli.exec(['register'], 30000);
      console.log('📱 SMS verification code sent!');
      const code = await ask('Enter the verification code: ');
      regCli.exec(['verify', code.trim()], 30000);
      console.log('✅ Registration complete!');
    } catch (err) {
      console.error(`❌ Registration failed: ${err.message}`);
      console.log('You may need to use a captcha. See: https://github.com/AsamK/signal-cli/wiki/Registration-with-captcha');
    }
  } else if (method.trim() === '3') {
    console.log(`\nGenerating link QR code...`);
    console.log('This will print a URI — open it as a QR code or paste into Signal desktop.');
    try {
      const linkCli = new SignalCli(config.signalCliPath, config.signalPhone);
      const output = linkCli.exec(['link', '-n', 'CSimple-Bot'], 60000);
      console.log(`\nLink URI:\n${output}`);
      console.log('\nScan this QR code in Signal app → Settings → Linked Devices → Link New Device');
    } catch (err) {
      console.error(`❌ Link failed: ${err.message}`);
    }
  }

  // Model
  console.log('');
  const model = await ask(`LLM model (Enter for ${config.modelId}): `);
  if (model.trim()) config.modelId = model.trim();

  // Webapp URL
  const webapp = await ask(`Webapp URL (Enter for ${config.webappUrl}): `);
  if (webapp.trim()) config.webappUrl = webapp.trim();

  // Allowlist
  console.log('');
  const allowlistInput = await ask('Allowed phone numbers (comma-separated, or Enter for all): ');
  if (allowlistInput.trim()) {
    config.allowedNumbers = allowlistInput.split(',').map(n => n.trim()).filter(Boolean);
  }

  saveConfig(config);
  console.log(`\n✅ Config saved to: ${SIGNAL_CONFIG_PATH}`);
  console.log('\nStart the bridge with:');
  console.log('  npm run signal');
  console.log('  — or —');
  console.log(`  SIGNAL_PHONE=${config.signalPhone} node server/signal-bridge.js`);

  rl.close();
}

/** Register a new number */
async function registerAccount(phone) {
  if (!phone) {
    console.error('Usage: node signal-bridge.js register +15551234567');
    process.exit(1);
  }
  const config = loadConfig();
  const cli = new SignalCli(config.signalCliPath, phone);
  try {
    console.log(`Registering ${phone}...`);
    cli.exec(['register']);
    console.log('✅ SMS sent! Run: node signal-bridge.js verify ' + phone + ' <code>');
  } catch (err) {
    console.error(`❌ ${err.message}`);
  }
}

/** Verify registration code */
async function verifyAccount(phone, code) {
  if (!phone || !code) {
    console.error('Usage: node signal-bridge.js verify +15551234567 123456');
    process.exit(1);
  }
  const config = loadConfig();
  const cli = new SignalCli(config.signalCliPath, phone);
  try {
    cli.exec(['verify', code]);
    console.log('✅ Verification complete!');
    config.signalPhone = phone;
    saveConfig(config);
    console.log('Config updated. Run: npm run signal');
  } catch (err) {
    console.error(`❌ ${err.message}`);
  }
}

/** Link as secondary device */
async function linkDevice() {
  const config = loadConfig();
  const isBat = config.signalCliPath.endsWith('.bat') || config.signalCliPath.endsWith('.cmd');
  try {
    console.log('Generating device link...');
    const cmd = isBat
      ? `cmd /c ""${config.signalCliPath}" link -n "CSimple-Bot""`
      : `"${config.signalCliPath}" link -n "CSimple-Bot"`;
    const output = execSync(cmd, {
      timeout: 60000,
      encoding: 'utf-8',
    }).trim();
    console.log(`\nLink URI:\n${output}`);
    console.log('\nScan from Signal → Settings → Linked Devices');
  } catch (err) {
    console.error(`❌ ${err.message}`);
  }
}

// Run
main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
