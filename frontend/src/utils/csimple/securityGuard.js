/**
 * CSimple Client-Side Security Guard
 *
 * Pre-screens user messages in the browser before they are sent to the addon
 * or portfolio backend. Mirrors the server-side patterns in security-guard.js.
 *
 * This is the first defence layer — fast, offline, and user-facing.
 * It provides an immediate warning dialog so the user knows the command was
 * rejected, rather than getting a silent error from the server.
 *
 * Returns: { blocked: boolean, reason: string | null }
 */

const DANGEROUS_PATTERNS = [
  // Wholesale delete / wipe
  { pattern: /\b(?:rm|del|rmdir|rd)\s+[/-][sfqr]/i,               reason: 'Recursive delete command detected' },
  { pattern: /del(?:ete)?\s+(?:all\s+)?(?:files?|everything)\s+(?:on\s+)?[A-Za-z]:/i, reason: 'Mass file deletion detected' },
  { pattern: /\bformat\s+[A-Za-z]:/i,                              reason: 'Drive format command detected' },
  { pattern: /\bdiskpart\b/i,                                      reason: 'Diskpart utility is not allowed' },
  // Windows / System32
  { pattern: /\bsystem32\b/i,                                      reason: 'System32 directory is protected' },
  { pattern: /delete\s+(?:system32|windows|win32)/i,               reason: 'Deleting Windows system files is not allowed' },
  // Registry
  { pattern: /reg\s+(?:delete|add)\s+hklm/i,                      reason: 'Modifying the system registry is not allowed' },
  { pattern: /regedit\b/i,                                         reason: 'Registry editor commands are not allowed' },
  // Security disruption
  { pattern: /(?:disable|turn\s+off)\s+(?:windows\s+defender|antivirus|firewall)/i, reason: 'Disabling security software is not allowed' },
  { pattern: /netsh\s+advfirewall\s+set\s+\w+\s+state\s+off/i,    reason: 'Disabling the firewall is not allowed' },
  { pattern: /Set-MpPreference\s+.*DisableRealtimeMonitoring/i,    reason: 'Disabling Windows Defender is not allowed' },
  // User / privilege escalation
  { pattern: /net\s+(?:user|localgroup)\s+administrator/i,         reason: 'Modifying administrator accounts is not allowed' },
  { pattern: /net\s+user\s+\S+\s+\/add/i,                         reason: 'Adding system users is not allowed' },
  // Script injection / obfuscation
  { pattern: /iex\s*\(/i,                                          reason: 'Invoke-Expression execution is not allowed' },
  { pattern: /Invoke-Expression/i,                                 reason: 'Invoke-Expression execution is not allowed' },
  { pattern: /DownloadString\s*\(/i,                               reason: 'Downloading and executing remote scripts is not allowed' },
  { pattern: /\[convert\]::frombase64string/i,                     reason: 'Base64 payload execution is not allowed' },
  { pattern: /-enc(?:oded)?(?:command)?\s+[A-Za-z0-9+/=]{20,}/i,  reason: 'Encoded PowerShell commands are not allowed' },
  // Boot / shadow copies
  { pattern: /\b(?:bootrec|bcdedit|bcdboot)\b/i,                  reason: 'Modifying boot configuration is not allowed' },
  { pattern: /vssadmin\b/i,                                        reason: 'Modifying volume shadow copies is not allowed' },
  { pattern: /wmic\s+shadowcopy\s+delete/i,                       reason: 'Deleting shadow copies is not allowed' },
];

/**
 * Check a message for dangerous patterns.
 * @param {string} message
 * @returns {{ blocked: boolean, reason: string | null }}
 */
export function checkMessage(message) {
  if (!message || typeof message !== 'string') return { blocked: false, reason: null };

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(message)) {
      return { blocked: true, reason };
    }
  }

  return { blocked: false, reason: null };
}
