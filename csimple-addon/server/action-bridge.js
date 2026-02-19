/**
 * CSimple Built-in Action Bridge
 *
 * Polls /api/actions/pending and executes queued actions directly on the host
 * Windows machine using PowerShell (keybd_event + SendKeys + Start-Process).
 *
 * This replaces the need for the separate C# MAUI ActionBridge app.
 */

'use strict';

const http  = require('http');
const https = require('https');
const { spawn } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ─── PS helper definitions ──────────────────────────────────────────────────────

const PS_KBD_TYPEDEF = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class KbdHelper {
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public static void Down(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); }
    public static void Up  (byte vk) { keybd_event(vk, 0, 2, UIntPtr.Zero); }
    public static void Press(byte vk){ Down(vk); System.Threading.Thread.Sleep(60); Up(vk); }
}
'@ -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
`;

// ─── SendKeys escape ────────────────────────────────────────────────────────────

function escapeSendKeys(text) {
  // Characters that have special meaning in SendKeys must be wrapped in {}
  return text.replace(/[+^%~(){}[\]]/g, ch => `{${ch}}`);
}

// ─── App name → process / URI map ──────────────────────────────────────────────

const APP_LAUNCH_MAP = {
  'edge':          'msedge.exe',
  'microsoft edge':'msedge.exe',
  'chrome':        'chrome.exe',
  'google chrome': 'chrome.exe',
  'firefox':       'firefox.exe',
  'notepad':       'notepad.exe',
  'calculator':    'calc.exe',
  'calc':          'calc.exe',
  'explorer':      'explorer.exe',
  'file explorer': 'explorer.exe',
  'spotify':       'spotify.exe',
  'discord':       'discord.exe',
  'steam':         'steam.exe',
  'vlc':           'vlc.exe',
  'powershell':    'powershell.exe',
  'terminal':      'wt.exe',
  'cmd':           'cmd.exe',
  'settings':      'ms-settings:',
  'task manager':  'taskmgr.exe',
  'paint':         'mspaint.exe',
  'wordpad':       'wordpad.exe',
  'control panel': 'control.exe',
  'obs':           'obs64.exe',
  'teams':         'teams.exe',
  'word':          'WINWORD.EXE',
  'excel':         'EXCEL.EXE',
  'powerpoint':    'POWERPNT.EXE',
  'vscode':        'code.exe',
  'vs code':       'code.exe',
  'visual studio code': 'code.exe',
};

// ─── PowerShell step generator ──────────────────────────────────────────────────

function stepsToPS(steps) {
  const lines = [];

  for (const step of steps) {
    switch (step.type) {

      case 'delay':
        lines.push(`Start-Sleep -Milliseconds ${step.duration || 100}`);
        break;

      case 'keyPress': {
        const vk = step.keyCode ?? step.vk ?? step.key;
        if (vk != null) {
          const vkHex = typeof vk === 'number' ? `0x${vk.toString(16).toUpperCase().padStart(2,'0')}` : `0x${parseInt(vk, 16).toString(16).toUpperCase().padStart(2,'0')}`;
          lines.push(`[KbdHelper]::Press(${vkHex})`);
          lines.push(`Start-Sleep -Milliseconds 60`);
        }
        break;
      }

      case 'keyDown': {
        const vk = step.keyCode ?? step.vk ?? step.key;
        if (vk != null) {
          const vkHex = typeof vk === 'number' ? `0x${vk.toString(16).toUpperCase().padStart(2,'0')}` : `0x${parseInt(vk, 16).toString(16).toUpperCase().padStart(2,'0')}`;
          lines.push(`[KbdHelper]::Down(${vkHex})`);
        }
        break;
      }

      case 'keyUp': {
        const vk = step.keyCode ?? step.vk ?? step.key;
        if (vk != null) {
          const vkHex = typeof vk === 'number' ? `0x${vk.toString(16).toUpperCase().padStart(2,'0')}` : `0x${parseInt(vk, 16).toString(16).toUpperCase().padStart(2,'0')}`;
          lines.push(`[KbdHelper]::Up(${vkHex})`);
        }
        break;
      }

      case 'hotkey': {
        // keys is array of VK codes (e.g. [0x11, 0x43] for Ctrl+C)
        const keys = step.keys || (step.keyCode ? [step.keyCode] : []);
        // Press down all modifier keys
        for (const vk of keys) {
          const vkHex = `0x${(vk).toString(16).toUpperCase().padStart(2,'0')}`;
          lines.push(`[KbdHelper]::Down(${vkHex})`);
          lines.push(`Start-Sleep -Milliseconds 30`);
        }
        // Release in reverse order
        for (const vk of [...keys].reverse()) {
          const vkHex = `0x${(vk).toString(16).toUpperCase().padStart(2,'0')}`;
          lines.push(`[KbdHelper]::Up(${vkHex})`);
          lines.push(`Start-Sleep -Milliseconds 30`);
        }
        break;
      }

      case 'typeText': {
        const text = step.text || '';
        const escaped = escapeSendKeys(text);
        // Use single-quoted PS string with any embedded quotes escaped
        const psString = escaped.replace(/'/g, "''");
        lines.push(`[System.Windows.Forms.SendKeys]::SendWait('${psString}')`);
        lines.push(`Start-Sleep -Milliseconds 50`);
        break;
      }

      case 'focusWindow': {
        const title = (step.title || '').replace(/'/g, "''");
        lines.push(`$wnd = Get-Process | Where-Object { $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1`);
        lines.push(`if ($wnd) { [void][System.Runtime.InteropServices.Marshal]::GetIUnknownForObject($wnd); (New-Object -ComObject WScript.Shell).AppActivate($wnd.MainWindowTitle) | Out-Null }`);
        lines.push(`Start-Sleep -Milliseconds 300`);
        break;
      }

      case 'launchApp': {
        const app = (step.app || '').toLowerCase().trim();
        const exe = APP_LAUNCH_MAP[app];
        if (exe) {
          if (exe.startsWith('ms-') || exe.includes(':')) {
            lines.push(`Start-Process '${exe}'`);
          } else {
            lines.push(`Start-Process '${exe}' -ErrorAction SilentlyContinue`);
          }
        } else if (step.path) {
          const safePath = step.path.replace(/'/g, "''");
          lines.push(`Start-Process '${safePath}' -ErrorAction SilentlyContinue`);
        }
        lines.push(`Start-Sleep -Milliseconds 500`);
        break;
      }

      case 'mouseMove': {
        const dx = step.dx || 0;
        const dy = step.dy || 0;
        // Relative mouse move using user32 mouse_event
        lines.push(`[KbdHelper]::MouseMove(${dx}, ${dy})`);
        break;
      }

      default:
        // Unknown step — skip
        break;
    }
  }

  return lines.join('\r\n');
}

// ─── Run a PowerShell script string ────────────────────────────────────────────

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    // Write to a temp file to avoid quoting hell on the CLI
    const tmpFile = path.join(os.tmpdir(), `csimple_bridge_${Date.now()}.ps1`);
    const fullScript = `${PS_KBD_TYPEDEF}\r\n${script}`;

    try {
      fs.writeFileSync(tmpFile, fullScript, 'utf-8');
    } catch (e) {
      return reject(new Error(`Failed to write PS temp file: ${e.message}`));
    }

    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', tmpFile,
    ], { windowsHide: true });

    let stdout = '', stderr = '';
    ps.stdout.on('data', d => { stdout += d; });
    ps.stderr.on('data', d => { stderr += d; });

    ps.on('close', (code) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({ success: false, output: stdout.trim(), error: stderr.trim() || `Exit ${code}` });
      }
    });

    ps.on('error', (err) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      reject(err);
    });
  });
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const opts = new URL(url);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request({
      hostname: opts.hostname,
      port: opts.port,
      path: opts.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      timeout: 3000,
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(json);
    req.end();
  });
}

// ─── Action Bridge class ────────────────────────────────────────────────────────

class ActionBridge {
  constructor(port = 3001) {
    this.port = port;
    this.baseUrl = `http://localhost:${port}`;
    this.running = false;
    this.pollInterval = null;
    this.POLL_MS = 1000; // poll every second
    this.executing = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log(`[ActionBridge] Started — polling ${this.baseUrl}/api/actions/pending every ${this.POLL_MS}ms`);
    this.pollInterval = setInterval(() => this._poll(), this.POLL_MS);
    // Immediate first poll
    this._poll();
  }

  stop() {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[ActionBridge] Stopped');
  }

  async _poll() {
    if (!this.running || this.executing) return;

    let result;
    try {
      result = await httpGet(`${this.baseUrl}/api/actions/pending`);
    } catch (_) {
      // Server not ready yet — silent retry
      return;
    }

    const actions = result?.actions || [];
    if (actions.length === 0) return;

    this.executing = true;
    for (const action of actions) {
      await this._execute(action);
    }
    this.executing = false;
  }

  async _execute(action) {
    console.log(`[ActionBridge] Executing action ${action.id}: ${action.description || action.intent}`);

    const steps = action.steps || [];
    if (steps.length === 0) {
      await this._complete(action.id, true);
      return;
    }

    try {
      const psScript = stepsToPS(steps);
      console.log(`[ActionBridge] PS script:\n${psScript}`);
      const result = await runPowerShell(psScript);

      if (result.success) {
        console.log(`[ActionBridge] ✅ Action ${action.id} completed`);
        if (result.output) console.log(`[ActionBridge] Output:`, result.output);
      } else {
        console.warn(`[ActionBridge] ⚠️ Action ${action.id} finished with error:`, result.error);
      }

      await this._complete(action.id, result.success, result.error);
    } catch (err) {
      console.error(`[ActionBridge] ❌ Action ${action.id} failed:`, err.message);
      await this._complete(action.id, false, err.message);
    }
  }

  async _complete(actionId, success, error) {
    try {
      await httpPost(`${this.baseUrl}/api/actions/complete`, { actionId, success, error: error || null });
    } catch (err) {
      console.warn(`[ActionBridge] Failed to report completion for ${actionId}:`, err.message);
    }
  }
}

module.exports = { ActionBridge };
