#!/usr/bin/env node
/**
 * pull-support-tickets.js — Pull bug reports + support tickets from DynamoDB.
 *
 * Scans the "Simple" table and extracts every support-channel record:
 *   1. bugReports      — "Bug:..." records (Support → Bug Report form, and the
 *                        goal agent's submit_bug_report tool).
 *   2. supportTickets  — "Memory:action" records filed by the /net AI chat tool
 *                        (source === "net-tool", title "Support ticket: ...").
 *   3. contactMessages — "Contact:..." records (Support → Contact form).
 *
 * The output is a JSON file (plus a console summary) designed to be handed to
 * another agent for triage/fixing. Every record keeps its raw text so no
 * detail is lost to pipe-delimited parsing.
 *
 * Usage:
 *   node backend/scripts/pull-support-tickets.js
 *   node backend/scripts/pull-support-tickets.js --open-only
 *   node backend/scripts/pull-support-tickets.js --types bug,support_ticket
 *   node backend/scripts/pull-support-tickets.js --out ./tickets.json
 *   node backend/scripts/pull-support-tickets.js --stdout
 *
 * Flags:
 *   --open-only   Only include open bug reports. (Contact messages and /net
 *                 support tickets have no close workflow, so they're always
 *                 included — every one of them is effectively "open".)
 *   --types <csv> Comma list of categories to include: bug,support_ticket,contact
 *                 (default: all three).
 *   --out <path>  Output JSON file.
 *                 (default: backend/reports/support-tickets-<timestamp>.json)
 *   --stdout      Also print the full JSON to stdout.
 *   --help        Show this help text.
 */

const fs = require('fs');
const path = require('path');

// Load the backend .env (AWS creds, region) regardless of the CWD the script
// is invoked from.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.DYNAMODB_TABLE || 'Simple';
const MEMORY_PREFIX = '|Memory:';

// ── CLI helpers ──────────────────────────────────────────────────────────────

function argValue(args, flag) {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return null;
}

function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf8').match(/\/\*\*[\s\S]*?\*\//)[0]
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((l) => l.replace(/^ \* ?/, ''))
    .join('\n'));
}

// ── Text parsing ─────────────────────────────────────────────────────────────

/**
 * Return every value for a pipe-delimited `Key:value` field. Mirrors the
 * backend's parseField() regex (adminController.js) so parsing is consistent
 * with how the app itself reads these records.
 */
function parseFields(text, key) {
  const re = new RegExp(`(?:^|\\|)${key}:([^|]*)`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

/** Last occurrence of a field (display value — e.g. the second `Creator`). */
function parseField(text, key) {
  const vals = parseFields(text, key);
  return vals.length ? vals[vals.length - 1] : '';
}

/** Classify a row by its `text` pattern. Returns null for irrelevant rows. */
function classify(text) {
  if (text.includes('Bug:') && text.includes('Status:') && text.includes('Creator:')) {
    return 'bug';
  }
  if (text.includes('Contact:') && text.includes('Message:')) return 'contact';
  if (text.includes(MEMORY_PREFIX)) return 'memory';
  return null;
}

/** Parse a `Creator:<id>|Memory:<type>|<json>` row (same logic as memoryService). */
function parseMemory(text) {
  const creatorMatch = text.match(/^Creator:([^|]+)/);
  const typeMatch = text.match(/\|Memory:([^|]+)\|/);
  if (!creatorMatch || !typeMatch) return null;
  const type = typeMatch[1];
  const jsonStart = text.indexOf(`|Memory:${type}|`) + `|Memory:${type}|`.length;
  let payload;
  try {
    payload = JSON.parse(text.substring(jsonStart));
  } catch {
    payload = { text: text.substring(jsonStart) };
  }
  return { userId: creatorMatch[1], type, payload };
}

// ── Record parsers ───────────────────────────────────────────────────────────

function parseBug(item) {
  const text = item.text || '';
  const creators = parseFields(text, 'Creator');
  const status = parseField(text, 'Status') || 'Open';
  return {
    id: item.id || '(no-id)',
    type: 'bug',
    title: parseField(text, 'Bug') || 'Untitled Bug Report',
    severity: parseField(text, 'Severity') || 'medium',
    description: parseField(text, 'Description'),
    steps: parseField(text, 'Steps'),
    expected: parseField(text, 'Expected'),
    actual: parseField(text, 'Actual'),
    browser: parseField(text, 'Browser'),
    device: parseField(text, 'Device'),
    status,
    isOpen: status.toLowerCase() === 'open',
    creator: creators[creators.length - 1] || '',
    creatorIds: creators,
    resolution: parseField(text, 'Resolution'),
    resolvedBy: parseField(text, 'ResolvedBy'),
    resolvedAt: parseField(text, 'ResolvedAt'),
    reportedAt: parseField(text, 'Timestamp') || item.createdAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    rawText: text,
  };
}

function parseContact(item) {
  const text = item.text || '';
  return {
    id: item.id || '(no-id)',
    type: 'contact',
    subject: parseField(text, 'Contact'),
    contactType: parseField(text, 'Type'),
    priority: parseField(text, 'Priority') || 'medium',
    name: parseField(text, 'Name'),
    email: parseField(text, 'Email'),
    message: parseField(text, 'Message'),
    status: 'open',
    isOpen: true,
    reportedAt: parseField(text, 'Timestamp') || item.createdAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    rawText: text,
  };
}

function parseSupportTicket(item, mem) {
  const title = String(mem.payload.title || '');
  return {
    id: item.id || '(no-id)',
    type: 'support_ticket',
    subject: title.replace(/^Support ticket:\s*/i, '') || title,
    category: mem.payload.category || '',
    priority: mem.payload.priority || 'medium',
    source: mem.payload.source || 'net-tool',
    userId: mem.userId,
    status: 'open',
    isOpen: true,
    submittedAt: mem.payload.timestamp || item.createdAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    rawText: item.text,
  };
}

// ── DynamoDB scan ────────────────────────────────────────────────────────────

async function scanAll() {
  const items = [];
  let lastKey;
  do {
    const res = await dynamodb.send(new ScanCommand({
      TableName: TABLE,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const openOnly = args.includes('--open-only');
  const stdout = args.includes('--stdout');
  const outArg = argValue(args, '--out');
  const typesArg = argValue(args, '--types');
  const enabledTypes = typesArg
    ? new Set(typesArg.split(',').map((s) => s.trim()).filter(Boolean))
    : null;

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ Missing AWS credentials.');
    console.error('   Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (and AWS_REGION) in backend/.env');
    process.exit(1);
  }

  console.log(`🔎 Scanning DynamoDB table "${TABLE}"...`);
  const all = await scanAll();
  console.log(`   ${all.length} total rows scanned.`);

  // Classify + parse every row.
  const bugs = [];
  const tickets = [];
  const contacts = [];
  for (const item of all) {
    const text = item.text || '';
    const kind = classify(text);
    if (kind === 'bug') {
      bugs.push(parseBug(item));
    } else if (kind === 'contact') {
      contacts.push(parseContact(item));
    } else if (kind === 'memory') {
      const mem = parseMemory(text);
      const isNetTicket = mem
        && mem.type === 'action'
        && (mem.payload?.source === 'net-tool' || /^Support ticket:/i.test(String(mem.payload?.title || '')));
      if (isNetTicket) tickets.push(parseSupportTicket(item, mem));
    }
  }

  const byDate = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  bugs.sort(byDate);
  tickets.sort(byDate);
  contacts.sort(byDate);

  const openBugs = bugs.filter((b) => b.isOpen);
  const closedBugs = bugs.filter((b) => !b.isOpen);

  // Build the payload, honouring --types and --open-only.
  const payload = {
    generatedAt: new Date().toISOString(),
    table: TABLE,
  };

  if (!enabledTypes || enabledTypes.has('bug')) {
    payload.bugReports = openOnly
      ? { open: openBugs }
      : { open: openBugs, closed: closedBugs };
  }
  if (!enabledTypes || enabledTypes.has('support_ticket')) payload.supportTickets = tickets;
  if (!enabledTypes || enabledTypes.has('contact')) payload.contactMessages = contacts;

  // Flat, agent-friendly list of everything that still needs attention.
  payload.open = [
    ...(payload.bugReports?.open || []),
    ...(payload.supportTickets || []),
    ...(payload.contactMessages || []),
  ].sort(byDate);

  payload.summary = {
    bugReports: {
      open: openBugs.length,
      closed: closedBugs.length,
      total: bugs.length,
    },
    supportTickets: { open: tickets.length, total: tickets.length },
    contactMessages: { open: contacts.length, total: contacts.length },
    openTotal: payload.open.length,
  };

  // Write output file.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = outArg || path.join(__dirname, '..', 'reports', `support-tickets-${ts}.json`);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\n📄 Wrote ${outFile}`);

  // Console summary.
  const s = payload.summary;
  console.log('\n══════════════════════════════════════════════════');
  console.log('  SUPPORT TICKET SUMMARY');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Bug reports      open: ${s.bugReports.open}   closed: ${s.bugReports.closed}`);
  console.log(`  /net tickets     open: ${s.supportTickets.open}`);
  console.log(`  Contact messages open: ${s.contactMessages.open}`);
  console.log(`  ── TOTAL OPEN: ${s.openTotal} ──`);
  console.log('══════════════════════════════════════════════════');

  if (payload.open.length === 0) {
    console.log('\n  🎉 No open tickets.');
  } else {
    console.log('\n  OPEN TICKETS (newest first):\n');
    payload.open.forEach((t, i) => {
      const when = (t.reportedAt || t.submittedAt || t.createdAt || '').slice(0, 10);
      const label = t.type === 'bug'
        ? `${t.title}`.slice(0, 60)
        : `${t.subject || t.message || '(no subject)'}`.slice(0, 60);
      const prio = (t.priority || t.severity || 'medium').padEnd(6);
      console.log(`  ${String(i + 1).padStart(2)}. [${t.type.padEnd(13)}] ${t.id}  (${prio}) ${when}  ${label}`);
    });
  }

  if (stdout) {
    console.log('\n════════ FULL JSON ════════');
    console.log(JSON.stringify(payload, null, 2));
  }
}

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const dynamodb = DynamoDBDocumentClient.from(client);

main().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.name === 'ResourceNotFoundException') {
    console.error(`   Table "${TABLE}" not found — check DYNAMODB_TABLE and AWS_REGION.`);
  }
  process.exit(1);
});
