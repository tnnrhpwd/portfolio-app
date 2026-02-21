/**
 * CSimple Security Guard
 *
 * Multi-layer security enforcement to prevent the AI from executing dangerous,
 * destructive, or system-altering commands on the host machine.
 *
 * Layers:
 *   1. Message pre-screen  — catches obvious dangerous intent in raw user input
 *   2. Action plan check   — validates intent + steps before queuing
 *   3. PowerShell script check — scans generated PS before it runs
 *
 * Every check returns: { blocked: boolean, reason: string | null }
 */

'use strict';

// ─── Protected System Paths ───────────────────────────────────────────────────
// Any action that references these paths is blocked.

const PROTECTED_PATH_PATTERNS = [
  /\bsystem32\b/i,
  /\bsyswow64\b/i,
  /\\windows\\/i,
  /[Cc]:[/\\]windows\b/i,
  /[Cc]:[/\\]program\s*files\b/i,
  /[Cc]:[/\\]programdata\b/i,
  /\bhklm\\/i,                        // HKEY_LOCAL_MACHINE registry
  /\bhkcc\\/i,                        // HKEY_CURRENT_CONFIG
  /\bhkcr\\/i,                        // HKEY_CLASSES_ROOT
  /registry::hklm/i,
  /\bsam\b.*\bregistry\b/i,
  /\bsecurity\b.*\bregistry\b/i,
];

// ─── Dangerous Message Patterns ───────────────────────────────────────────────
// Applied to raw user messages before any AI processing begins.

const DANGEROUS_MESSAGE_PATTERNS = [
  // Wholesale delete / wipe
  { pattern: /\b(?:rm|del|rmdir|rd)\s+[/-][sfqr]/i,            reason: 'Recursive delete command detected' },
  { pattern: /del(?:ete)?\s+(?:all\s+)?(?:files?|everything)\s+(?:on\s+)?[A-Za-z]:/i, reason: 'Mass file deletion detected' },
  { pattern: /\bformat\s+[A-Za-z]:/i,                           reason: 'Drive format command detected' },
  { pattern: /\bdiskpart\b/i,                                   reason: 'Diskpart utility blocked' },
  // Windows/System32 targeting
  { pattern: /\bsystem32\b/i,                                   reason: 'System32 path is protected' },
  { pattern: /delete\s+(?:system32|windows|win32)/i,            reason: 'Critical Windows directory is protected' },
  // Registry destruction
  { pattern: /reg\s+(?:delete|add)\s+hklm/i,                   reason: 'System registry modification blocked' },
  { pattern: /regedit\s+/i,                                     reason: 'Registry editor command blocked' },
  // Disabling security / firewall
  { pattern: /(?:disable|turn\s+off)\s+(?:windows\s+defender|antivirus|firewall)/i, reason: 'Disabling security software is blocked' },
  { pattern: /netsh\s+advfirewall\s+set\s+\w+\s+state\s+off/i, reason: 'Firewall disable command blocked' },
  { pattern: /Set-MpPreference\s+.*DisableRealtimeMonitoring/i, reason: 'Defender disable command blocked' },
  // User / privilege escalation
  { pattern: /net\s+(?:user|localgroup)\s+administrator/i,      reason: 'Administrator account modification blocked' },
  { pattern: /net\s+user\s+\S+\s+\/add/i,                      reason: 'Adding system users is blocked' },
  // Script injection / obfuscation
  { pattern: /iex\s*\(/i,                                       reason: 'Invoke-Expression execution blocked' },
  { pattern: /Invoke-Expression/i,                              reason: 'Invoke-Expression execution blocked' },
  { pattern: /DownloadString\s*\(/i,                            reason: 'Remote script download blocked' },
  { pattern: /DownloadFile\s*\(/i,                              reason: 'Remote file download to disk blocked' },
  { pattern: /\bwebclient\b.*\bdownload/i,                      reason: 'Remote download blocked' },
  { pattern: /\[convert\]::frombase64string/i,                  reason: 'Base64 payload execution blocked' },
  // PowerShell encoded commands
  { pattern: /-enc(?:oded)?(?:command)?\s+[A-Za-z0-9+/=]{20,}/i, reason: 'Encoded PowerShell command blocked' },
  // cipher wipe
  { pattern: /\bcipher\s+\/[wW]/i,                             reason: 'Secure wipe command blocked' },
  // Boot record
  { pattern: /\b(?:bootrec|bcdedit|bcdboot)\b/i,               reason: 'Boot configuration modification blocked' },
  // Shadow copies
  { pattern: /vssadmin\b/i,                                     reason: 'Volume shadow copies modification blocked' },
  { pattern: /wmic\s+shadowcopy\s+delete/i,                     reason: 'Shadow copy deletion blocked' },
  // taskkill /f system processes
  { pattern: /taskkill\s+.*\/f\s+.*(?:winlogon|lsass|csrss|smss|wininit|services\.exe)/i, reason: 'Killing critical system process blocked' },
];

// ─── Dangerous PowerShell Patterns ───────────────────────────────────────────
// Applied to the final PS script string just before execution.

const DANGEROUS_PS_PATTERNS = [
  // Bulk delete
  { pattern: /Remove-Item\s+.*-Recurse\s+.*-Force/i,           reason: 'Recursive forced deletion blocked' },
  { pattern: /Remove-Item\s+-Force\s+.*-Recurse/i,             reason: 'Recursive forced deletion blocked' },
  { pattern: /\brd\s+\/s\s+\/q/i,                              reason: 'Recursive directory removal blocked' },
  { pattern: /\brmdir\s+\/s\s+\/q/i,                           reason: 'Recursive directory removal blocked' },
  { pattern: /\bdel\s+\/[sqfr]/i,                              reason: 'Recursive delete flag blocked' },
  // Protected paths (re-check in generated script)
  { pattern: /[Cc]:[/\\](?:Windows|System32|SysWOW64)\b/i,     reason: 'Windows system path is protected' },
  { pattern: /[Cc]:[/\\]Program\s*Files\b/i,                   reason: 'Program Files path is protected' },
  // Registry modifications
  { pattern: /Remove-Item\s+.*HKLM/i,                          reason: 'System registry deletion blocked' },
  { pattern: /Set-ItemProperty\s+.*HKLM/i,                     reason: 'System registry write blocked' },
  { pattern: /New-Item\s+.*HKLM/i,                             reason: 'System registry write blocked' },
  { pattern: /\breg\s+(?:delete|add)\s+hklm/i,                 reason: 'Registry modification blocked' },
  // Encoded execution
  { pattern: /iex\s*\(/i,                                      reason: 'Invoke-Expression blocked' },
  { pattern: /Invoke-Expression/i,                             reason: 'Invoke-Expression blocked' },
  { pattern: /\[convert\]::frombase64string/i,                 reason: 'Base64 decoded execution blocked' },
  { pattern: /-enc(?:odedcommand)?\s+[A-Za-z0-9+/=]{20,}/i,   reason: 'Encoded PowerShell command blocked' },
  // Downloading and running
  { pattern: /DownloadString\s*\(/i,                           reason: 'Remote script execution blocked' },
  { pattern: /DownloadFile\s*\(\s*['"]https?:/i,               reason: 'Downloading files from internet blocked' },
  { pattern: /Invoke-WebRequest.*\|.*iex/i,                    reason: 'Web download execution blocked' },
  // Security disruption
  { pattern: /Set-MpPreference.*-Disable/i,                    reason: 'Windows Defender modification blocked' },
  { pattern: /netsh\s+advfirewall/i,                           reason: 'Firewall modification blocked' },
  // Format / diskpart
  { pattern: /\bformat\s+[A-Za-z]:/i,                         reason: 'Drive format blocked' },
  { pattern: /\bdiskpart\b/i,                                  reason: 'Diskpart blocked' },
  // Stopping security services
  { pattern: /Stop-Service\s+.*(?:WinDefend|MpSvc|wscsvc|BFE|mpssvc)/i, reason: 'Stopping security services blocked' },
  { pattern: /sc\s+(?:stop|config)\s+(?:windefend|mpssvc|wscsvc|bfe)/i, reason: 'Stopping security services blocked' },
  // Boot
  { pattern: /\bbcdedit\b/i,                                   reason: 'Boot configuration edit blocked' },
  { pattern: /\bbootrec\b/i,                                   reason: 'Boot record modification blocked' },
  // User escalation
  { pattern: /net\s+(?:user|localgroup)\s+administrator/i,     reason: 'Admin escalation blocked' },
  { pattern: /Add-LocalGroupMember.*Administrator/i,           reason: 'Admin escalation blocked' },
];

// ─── Dangerous Action Intents ─────────────────────────────────────────────────
// These action "intent" strings (from action plans) are always blocked.

const BLOCKED_INTENTS = new Set([
  'delete_system',
  'format_drive',
  'wipe_disk',
  'disable_security',
  'escalate_privilege',
  'modify_registry',
  'kill_system_process',
]);

// ─── Safe Step Type Allowlist ─────────────────────────────────────────────────
// Only these step types may appear in an action plan.
// Any unknown type is logged as a warning (not blocked by default, but flagged).

const ALLOWED_STEP_TYPES = new Set([
  'delay',
  'keyPress',
  'keyDown',
  'keyUp',
  'hotkey',
  'typeText',
  'focusWindow',
  'launchApp',
  'mouseMove',
  'holdKey',
  'holdClick',
  'repeatSequence',
  'setVolume',
  'mediaControl',
  'powerCommand',   // power commands still pass step-type check but need confirmation
  'visualClick',
  'wait',
  'runScript',      // sandboxed; further validated by content checks
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check a string against an array of { pattern, reason } objects.
 * Returns the first match or null.
 */
function matchPatterns(str, patterns) {
  for (const { pattern, reason } of patterns) {
    if (pattern.test(str)) return reason;
  }
  return null;
}

/**
 * Check a string against the protected path list.
 */
function matchesProtectedPath(str) {
  for (const p of PROTECTED_PATH_PATTERNS) {
    if (p.test(str)) return true;
  }
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Layer 1: Screen a raw user message before any AI processing.
 * @param {string} message
 * @returns {{ blocked: boolean, reason: string | null }}
 */
function checkMessage(message) {
  if (!message || typeof message !== 'string') return { blocked: false, reason: null };

  const reason = matchPatterns(message, DANGEROUS_MESSAGE_PATTERNS);
  if (reason) {
    console.warn(`[SecurityGuard] Message blocked — ${reason} — "${message.slice(0, 120)}"`);
    return { blocked: true, reason };
  }

  return { blocked: false, reason: null };
}

/**
 * Layer 2: Validate a parsed action plan before it is queued.
 * Checks intent, step types, and any embedded text that references protected paths.
 * @param {{ intent: string, steps: Array, description?: string }} plan
 * @returns {{ blocked: boolean, reason: string | null }}
 */
function checkActionPlan(plan) {
  if (!plan || typeof plan !== 'object') return { blocked: false, reason: null };

  // Block known dangerous intents
  if (plan.intent && BLOCKED_INTENTS.has(plan.intent)) {
    const reason = `Dangerous action intent: ${plan.intent}`;
    console.warn(`[SecurityGuard] Action plan blocked — ${reason}`);
    return { blocked: true, reason };
  }

  // Check description for protected paths
  if (plan.description && matchesProtectedPath(plan.description)) {
    const reason = 'Action description references a protected system path';
    console.warn(`[SecurityGuard] Action plan blocked — ${reason}`);
    return { blocked: true, reason };
  }

  // Check each step
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  for (const step of steps) {
    // Unknown step types are flagged — not fully blocked unless they contain dangerous text
    if (step.type && !ALLOWED_STEP_TYPES.has(step.type)) {
      console.warn(`[SecurityGuard] Unknown step type: "${step.type}" — flagging but not blocking`);
    }

    // Check typed text for dangerous patterns
    if (step.type === 'typeText' && step.text) {
      const reason = matchPatterns(step.text, DANGEROUS_MESSAGE_PATTERNS);
      if (reason) {
        console.warn(`[SecurityGuard] Step typeText blocked — ${reason}`);
        return { blocked: true, reason: `Typed text is dangerous: ${reason}` };
      }
      if (matchesProtectedPath(step.text)) {
        const reason = 'Typed text references a protected system path';
        console.warn(`[SecurityGuard] Step typeText blocked — ${reason}`);
        return { blocked: true, reason };
      }
    }

    // Check script filenames / paths in runScript steps
    if (step.type === 'runScript') {
      const target = step.path || step.filename || '';
      if (matchesProtectedPath(target)) {
        const reason = 'Script path references a protected system path';
        console.warn(`[SecurityGuard] runScript step blocked — ${reason}`);
        return { blocked: true, reason };
      }
    }

    // Check launchApp paths for protected locations
    if (step.type === 'launchApp' && step.path) {
      if (matchesProtectedPath(step.path)) {
        const reason = 'Launch path references a protected system path';
        console.warn(`[SecurityGuard] launchApp step blocked — ${reason}`);
        return { blocked: true, reason };
      }
    }
  }

  return { blocked: false, reason: null };
}

/**
 * Layer 3: Scan a generated PowerShell script string before execution.
 * This is the last line of defence — runs even if the plan passed earlier checks.
 * @param {string} script
 * @returns {{ blocked: boolean, reason: string | null }}
 */
function checkPSScript(script) {
  if (!script || typeof script !== 'string') return { blocked: false, reason: null };

  // Check dangerous PS patterns
  const reason = matchPatterns(script, DANGEROUS_PS_PATTERNS);
  if (reason) {
    console.warn(`[SecurityGuard] PowerShell script blocked — ${reason}`);
    return { blocked: true, reason };
  }

  // Check protected paths embedded in the script
  if (matchesProtectedPath(script)) {
    const blockReason = 'PowerShell script references a protected system path';
    console.warn(`[SecurityGuard] PowerShell script blocked — ${blockReason}`);
    return { blocked: true, reason: blockReason };
  }

  return { blocked: false, reason: null };
}

/**
 * Validate a user-supplied script file content before saving to disk.
 * Less strict than the PS check — used for agent-created script files.
 * @param {string} content
 * @param {string} extension  e.g. '.ps1', '.py', '.js'
 * @returns {{ blocked: boolean, reason: string | null }}
 */
function checkScriptContent(content, extension) {
  if (!content || typeof content !== 'string') return { blocked: false, reason: null };

  // For PowerShell files, run the full PS check
  if (extension === '.ps1') {
    return checkPSScript(content);
  }

  // For all script types, check for protected path references and common dangerous patterns
  const reason = matchPatterns(content, DANGEROUS_MESSAGE_PATTERNS);
  if (reason) {
    console.warn(`[SecurityGuard] Script content blocked — ${reason}`);
    return { blocked: true, reason };
  }

  if (matchesProtectedPath(content)) {
    const blockReason = 'Script content references a protected system path';
    console.warn(`[SecurityGuard] Script content blocked — ${blockReason}`);
    return { blocked: true, reason: blockReason };
  }

  return { blocked: false, reason: null };
}

module.exports = {
  checkMessage,
  checkActionPlan,
  checkPSScript,
  checkScriptContent,
  // Exposed for testing
  DANGEROUS_MESSAGE_PATTERNS,
  DANGEROUS_PS_PATTERNS,
  PROTECTED_PATH_PATTERNS,
  BLOCKED_INTENTS,
};
