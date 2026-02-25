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
const { checkActionPlan, checkPSScript } = require('./security-guard');

// ─── PS helper definitions ──────────────────────────────────────────────────────

const PS_KBD_TYPEDEF = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class KbdHelper {
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr extra);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

    public static void Down(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); }
    public static void Up  (byte vk) { keybd_event(vk, 0, 2, UIntPtr.Zero); }
    public static void Press(byte vk){ Down(vk); System.Threading.Thread.Sleep(60); Up(vk); }

    public static void ClickAt(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(50);
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(30);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    }
    public static void RightClickAt(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(50);
        mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(30);
        mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero);
    }
    public static void DoubleClickAt(int x, int y) {
        ClickAt(x, y);
        System.Threading.Thread.Sleep(80);
        ClickAt(x, y);
    }
    public static void MouseMove(int dx, int dy) {
        mouse_event(0x0001, dx, dy, 0, UIntPtr.Zero);
    }
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

// ─── VK code mapping ────────────────────────────────────────────────────────────

const VK_MAP = {
  // Letters
  'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45, 'f': 0x46, 'g': 0x47, 'h': 0x48,
  'i': 0x49, 'j': 0x4A, 'k': 0x4B, 'l': 0x4C, 'm': 0x4D, 'n': 0x4E, 'o': 0x4F, 'p': 0x50,
  'q': 0x51, 'r': 0x52, 's': 0x53, 't': 0x54, 'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58,
  'y': 0x59, 'z': 0x5A,
  // Numbers
  '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
  '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
  // Modifiers
  'ctrl': 0x11, 'control': 0x11, 'shift': 0x10, 'alt': 0x12, 'menu': 0x12,
  'win': 0x5B, 'windows': 0x5B, 'lwin': 0x5B, 'rwin': 0x5C,
  // Navigation
  'enter': 0x0D, 'return': 0x0D, 'tab': 0x09, 'space': 0x20, 'backspace': 0x08,
  'delete': 0x2E, 'del': 0x2E, 'escape': 0x1B, 'esc': 0x1B,
  'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
  'home': 0x24, 'end': 0x23, 'pageup': 0x21, 'pagedown': 0x22, 'insert': 0x2D,
  // Function keys
  'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74, 'f6': 0x75,
  'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
  // Media
  'volumeup': 0xAF, 'volumedown': 0xAE, 'volumemute': 0xAD, 'mute': 0xAD,
  'nexttrack': 0xB0, 'prevtrack': 0xB1, 'mediastop': 0xB2, 'playpause': 0xB3,
  'mediaplay': 0xB3, 'medianext': 0xB0, 'mediaprev': 0xB1,
  // Misc
  'capslock': 0x14, 'numlock': 0x90, 'scrolllock': 0x91,
  'printscreen': 0x2C, 'prtsc': 0x2C,
};

/**
 * Resolve a key name or VK code to a numeric VK code.
 * Accepts: number, hex string '0x41', or key name 'ctrl', 'a', 'enter', etc.
 */
function resolveVK(key) {
  if (typeof key === 'number') return key;
  const str = String(key).toLowerCase().trim();
  if (VK_MAP[str] != null) return VK_MAP[str];
  if (str.startsWith('0x')) { const v = parseInt(str, 16); if (!isNaN(v)) return v; }
  if (str.length === 1) return str.toUpperCase().charCodeAt(0);
  return null;
}

function vkHex(code) {
  return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`;
}

// ─── PowerShell step generator ──────────────────────────────────────────────────

function stepsToPS(steps) {
  const lines = [];

  for (const step of steps) {
    switch (step.type) {

      case 'delay':
        lines.push(`Start-Sleep -Milliseconds ${step.duration || 100}`);
        break;

      case 'keyPress': {
        const vk = resolveVK(step.keyCode ?? step.vk ?? step.key);
        if (vk != null) {
          lines.push(`[KbdHelper]::Press(${vkHex(vk)})`);
          lines.push(`Start-Sleep -Milliseconds 60`);
        }
        break;
      }

      case 'keyDown': {
        const vk = resolveVK(step.keyCode ?? step.vk ?? step.key);
        if (vk != null) {
          lines.push(`[KbdHelper]::Down(${vkHex(vk)})`);
        }
        break;
      }

      case 'keyUp': {
        const vk = resolveVK(step.keyCode ?? step.vk ?? step.key);
        if (vk != null) {
          lines.push(`[KbdHelper]::Up(${vkHex(vk)})`);
        }
        break;
      }

      case 'hotkey': {
        const keys = (step.keys || (step.keyCode ? [step.keyCode] : [])).map(k => resolveVK(k)).filter(Boolean);
        for (const vk of keys) {
          lines.push(`[KbdHelper]::Down(${vkHex(vk)})`);
          lines.push(`Start-Sleep -Milliseconds 30`);
        }
        for (const vk of [...keys].reverse()) {
          lines.push(`[KbdHelper]::Up(${vkHex(vk)})`);
          lines.push(`Start-Sleep -Milliseconds 30`);
        }
        break;
      }

      case 'typeText': {
        const text = step.text || '';
        const escaped = escapeSendKeys(text);
        const psString = escaped.replace(/'/g, "''");
        lines.push(`[System.Windows.Forms.SendKeys]::SendWait('${psString}')`);
        lines.push(`Start-Sleep -Milliseconds 50`);
        break;
      }

      case 'focusWindow': {
        const title = (step.title || step.target || '').replace(/'/g, "''");
        lines.push(`$wnd = Get-Process | Where-Object { $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1`);
        lines.push(`if ($wnd) { (New-Object -ComObject WScript.Shell).AppActivate($wnd.MainWindowTitle) | Out-Null }`);
        lines.push(`Start-Sleep -Milliseconds 300`);
        break;
      }

      case 'openApp':
      case 'launchApp': {
        const app = (step.app || step.target || '').toLowerCase().trim();
        const exe = APP_LAUNCH_MAP[app];
        if (exe) {
          if (exe.startsWith('ms-') || exe.includes(':')) {
            lines.push(`Start-Process '${exe}'`);
          } else {
            lines.push(`Start-Process '${exe}' -ErrorAction SilentlyContinue`);
          }
        } else {
          // Try as direct executable or Start-Process search
          const safeName = (step.app || step.target || '').replace(/'/g, "''");
          lines.push(`try { Start-Process '${safeName}' -ErrorAction Stop } catch { Start-Process powershell -ArgumentList '-Command', "Start-Process '${safeName}'" -ErrorAction SilentlyContinue }`);
        }
        lines.push(`Start-Sleep -Milliseconds 500`);
        break;
      }

      case 'visualClick': {
        // Use Windows UI Automation to find the target element and click it
        const target = (step.target || '').replace(/'/g, "''");
        const clickType = step.clickType || 'left';
        const clickFn = clickType === 'double' ? 'DoubleClickAt' : clickType === 'right' ? 'RightClickAt' : 'ClickAt';
        lines.push(`# --- Visual Click: "${target}" ---`);
        lines.push(`Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue`);
        lines.push(`Add-Type -AssemblyName UIAutomationTypes -ErrorAction SilentlyContinue`);
        lines.push(`$vcTarget = '${target}'`);
        lines.push(`$vcFound = $false`);
        lines.push(`try {`);
        // First: search within the foreground window (fast)
        lines.push(`  $fgHwnd = [KbdHelper]::GetForegroundWindow()`);
        lines.push(`  if ($fgHwnd -ne [IntPtr]::Zero) {`);
        lines.push(`    $fgEl = [System.Windows.Automation.AutomationElement]::FromHandle($fgHwnd)`);
        lines.push(`    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $vcTarget, [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)`);
        lines.push(`    $el = $fgEl.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)`);
        // Partial match fallback within foreground window
        lines.push(`    if (-not $el) {`);
        lines.push(`      $all = $fgEl.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)`);
        lines.push(`      foreach ($item in $all) {`);
        lines.push(`        try { $nm = $item.Current.Name; if ($nm -and $nm -like "*$vcTarget*") { $el = $item; break } } catch {}`);
        lines.push(`      }`);
        lines.push(`    }`);
        lines.push(`    if ($el) {`);
        lines.push(`      $rect = $el.Current.BoundingRectangle`);
        lines.push(`      if ($rect.Width -gt 0 -and $rect.Height -gt 0) {`);
        lines.push(`        $cx = [int]($rect.X + $rect.Width / 2)`);
        lines.push(`        $cy = [int]($rect.Y + $rect.Height / 2)`);
        lines.push(`        [KbdHelper]::${clickFn}($cx, $cy)`);
        lines.push(`        $vcFound = $true`);
        lines.push(`      }`);
        lines.push(`    }`);
        lines.push(`  }`);
        // Fallback: search the full desktop tree
        lines.push(`  if (-not $vcFound) {`);
        lines.push(`    $root = [System.Windows.Automation.AutomationElement]::RootElement`);
        lines.push(`    $cond2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $vcTarget, [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)`);
        lines.push(`    $el2 = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond2)`);
        lines.push(`    if ($el2) {`);
        lines.push(`      $rect2 = $el2.Current.BoundingRectangle`);
        lines.push(`      if ($rect2.Width -gt 0 -and $rect2.Height -gt 0) {`);
        lines.push(`        $cx2 = [int]($rect2.X + $rect2.Width / 2)`);
        lines.push(`        $cy2 = [int]($rect2.Y + $rect2.Height / 2)`);
        lines.push(`        [KbdHelper]::${clickFn}($cx2, $cy2)`);
        lines.push(`        $vcFound = $true`);
        lines.push(`      }`);
        lines.push(`    }`);
        lines.push(`  }`);
        lines.push(`} catch { Write-Host "[VisualClick] Error: $_" }`);
        lines.push(`if (-not $vcFound) { Write-Host "[VisualClick] Could not find: $vcTarget" }`);
        lines.push(`Start-Sleep -Milliseconds 200`);
        break;
      }

      case 'holdKey': {
        const vk = resolveVK(step.key);
        if (vk != null) {
          const duration = step.duration || 3000;
          lines.push(`[KbdHelper]::Down(${vkHex(vk)})`);
          lines.push(`Start-Sleep -Milliseconds ${duration}`);
          lines.push(`[KbdHelper]::Up(${vkHex(vk)})`);
        }
        break;
      }

      case 'holdClick': {
        // Mouse down, wait, mouse up at current position
        const duration = step.duration || 1000;
        lines.push(`mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)`);
        lines.push(`Start-Sleep -Milliseconds ${duration}`);
        lines.push(`mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)`);
        break;
      }

      case 'mouseMove': {
        const dx = step.dx || 0;
        const dy = step.dy || 0;
        lines.push(`[KbdHelper]::MouseMove(${dx}, ${dy})`);
        break;
      }

      default:
        console.log(`[stepsToPS] Unknown step type: ${step.type}`);
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

    // ── Security Layer 2: validate action plan before execution ──────────────
    const planCheck = checkActionPlan(action);
    if (planCheck.blocked) {
      console.error(`[ActionBridge] 🚫 Action ${action.id} BLOCKED by security guard: ${planCheck.reason}`);
      await this._complete(action.id, false, `SECURITY_BLOCKED: ${planCheck.reason}`);
      return;
    }

    const steps = action.steps || [];
    if (steps.length === 0) {
      await this._complete(action.id, true);
      return;
    }

    try {
      const psScript = stepsToPS(steps);

      // ── Security Layer 3: validate generated PowerShell before running ──────
      const psCheck = checkPSScript(psScript);
      if (psCheck.blocked) {
        console.error(`[ActionBridge] 🚫 PowerShell BLOCKED by security guard: ${psCheck.reason}`);
        await this._complete(action.id, false, `SECURITY_BLOCKED: ${psCheck.reason}`);
        return;
      }

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

module.exports = { ActionBridge, stepsToPS, runPowerShell };
