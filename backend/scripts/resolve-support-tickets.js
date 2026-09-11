#!/usr/bin/env node
/**
 * resolve-support-tickets.js — Close bug reports that have been fixed.
 *
 * Companion to pull-support-tickets.js: triage the export, fix the code, then
 * close the reports you believe are done, with a resolution note that lands in
 * Support → My Reports so the trail is visible to the reporter.
 *
 * The text rewrite mirrors the app's own close workflow
 * (backend/controllers/putHashData.js, action `close_bug_report`) exactly:
 *
 *   Status:<x>  ->  Status:Closed
 *   + |Resolution:<note>|ResolvedBy:<who>|ResolvedAt:<timestamp>
 *
 * Unlike the web UI this does NOT email the reporter — closing a report
 * programmatically should not send a customer an unsolicited resolution email.
 * Close from the admin UI instead when the reporter should be notified.
 *
 * Tickets are looked up by their composite key ({ id, createdAt }), so the ids
 * must come from an export produced by pull-support-tickets.js — re-run the pull
 * if a report is newer than your export file.
 *
 * Usage:
 *   # preview what would change (writes nothing)
 *   node backend/scripts/resolve-support-tickets.js --ids abc123,def456 \
 *     --resolution "Fixed in 7da5fee." --dry-run
 *
 *   # bulk close with one shared note
 *   node backend/scripts/resolve-support-tickets.js --ids abc123,def456 \
 *     --resolution "Fixed in 7da5fee."
 *
 *   # per-ticket notes (JSON object of { "<id>": "<note>" })
 *   node backend/scripts/resolve-support-tickets.js --map resolutions.json
 *
 * Flags:
 *   --ids <csv>       Comma-separated ticket ids to close (default: all open bugs
 *                     in the export that have a resolution available).
 *   --resolution <s>  Note applied to every selected ticket.
 *                     (default: "Resolved.")
 *   --map <path>      JSON file of { "<id>": "<note>" }; overrides --resolution
 *                     for the ids it contains and, on its own, selects them.
 *   --from <path>     Export to read ids/keys from.
 *                     (default: backend/reports/open-tickets.json)
 *   --resolved-by <s> Value stored in ResolvedBy.
 *                     (default: "Agent (support-ticket pass)")
 *   --dry-run         Print the planned changes without writing to DynamoDB.
 *   --help            Show this help text.
 */

const fs = require('fs');
const path = require('path');

// Load the backend .env (AWS creds, region) regardless of the CWD the script
// is invoked from.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.DYNAMODB_TABLE || 'Simple';
const DEFAULT_FROM = path.join(__dirname, '..', 'reports', 'open-tickets.json');
const DEFAULT_RESOLVED_BY = 'Agent (support-ticket pass)';

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

function hasFlag(args, flag) {
  return args.includes(flag);
}

function printHelp() {
  console.log(
    fs
      .readFileSync(__filename, 'utf8')
      .match(/\/\*\*[\s\S]*?\*\//)[0]
      .replace(/^\/\*\*|\*\/$/g, '')
      .split('\n')
      .map((l) => l.replace(/^ \* ?/, ''))
      .join('\n')
  );
}

// ── Export loading ───────────────────────────────────────────────────────────

/**
 * Read the ids + composite keys out of a pull-support-tickets.js export.
 * Returns a Map of id -> ticket (only rows that carry a `createdAt` key).
 */
function loadExport(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = [
    ...(raw?.bugReports?.open || []),
    ...(raw?.bugReports?.closed || []),
    ...(raw?.supportTickets || []),
    ...(raw?.contactMessages || []),
  ];
  const byId = new Map();
  for (const row of rows) {
    if (row && row.id) byId.set(row.id, row);
  }
  return byId;
}

// ── Close logic ──────────────────────────────────────────────────────────────

/** Apply the app's close rewrite to a report's text. */
function buildClosedText(text, note, resolvedBy, timestamp) {
  // Same regex as putHashData.js: flip the first Status field.
  const closed = text.replace(/Status:([^|]+)/, 'Status:Closed');
  return `${closed}|Resolution:${note}|ResolvedBy:${resolvedBy}|ResolvedAt:${timestamp}`;
}

const isBugReport = (text = '') => text.includes('Bug:') && text.includes('Status:');

async function resolveOne(dynamodb, ticket, note, resolvedBy, dryRun) {
  const label = (ticket.title || '').slice(0, 60);

  const found = await dynamodb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { id: ticket.id, createdAt: ticket.createdAt },
    })
  );

  if (!found.Item) {
    return { id: ticket.id, status: 'missing', label };
  }

  const text = found.Item.text || '';
  if (!isBugReport(text)) {
    return { id: ticket.id, status: 'not-a-bug-report', label };
  }
  if (/Status:Closed/i.test(text)) {
    return { id: ticket.id, status: 'already-closed', label };
  }

  const timestamp = new Date().toISOString();
  const updatedText = buildClosedText(text, note, resolvedBy, timestamp);

  if (dryRun) {
    return { id: ticket.id, status: 'would-close', label, note };
  }

  await dynamodb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { ...found.Item, text: updatedText, updatedAt: timestamp },
    })
  );

  return { id: ticket.id, status: 'closed', label, note };
}

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printHelp();
    return;
  }

  const dryRun = hasFlag(args, '--dry-run');
  const fromFile = argValue(args, '--from') || DEFAULT_FROM;
  const resolvedBy = argValue(args, '--resolved-by') || DEFAULT_RESOLVED_BY;
  const defaultNote = argValue(args, '--resolution') || 'Resolved.';

  // Optional per-ticket notes: { "<id>": "<note>" }
  const mapFile = argValue(args, '--map');
  let notesById = new Map();
  if (mapFile) {
    const parsed = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    notesById = new Map(Object.entries(parsed));
  }

  // Selection: explicit --ids wins, then --map keys.
  const idsArg = argValue(args, '--ids');
  const ids = idsArg
    ? idsArg.split(',').map((s) => s.trim()).filter(Boolean)
    : [...notesById.keys()];

  if (ids.length === 0) {
    console.error('✖ No tickets selected. Pass --ids <csv> or --map <file>.\n');
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(fromFile)) {
    console.error(`✖ Export not found: ${fromFile}\n  Run: npm --prefix backend run pull-support-tickets -- --open-only`);
    process.exitCode = 1;
    return;
  }

  const byId = loadExport(fromFile);

  const selected = [];
  const unknown = [];
  for (const id of ids) {
    const ticket = byId.get(id);
    if (ticket) selected.push(ticket);
    else unknown.push(id);
  }

  for (const id of unknown) {
    console.warn(`⚠ ${id} is not in ${path.basename(fromFile)} — re-run the pull export to include it.`);
  }
  if (selected.length === 0) {
    console.error('✖ None of the requested ids are in the export.');
    process.exitCode = 1;
    return;
  }

  const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const dynamodb = DynamoDBDocumentClient.from(client);

  console.log(`🔧 ${dryRun ? 'Planning' : 'Closing'} ${selected.length} ticket(s) in "${TABLE}"...\n`);

  const results = [];
  for (const ticket of selected) {
    const note = notesById.get(ticket.id) || defaultNote;
    try {
      results.push(await resolveOne(dynamodb, ticket, note, resolvedBy, dryRun));
    } catch (err) {
      results.push({ id: ticket.id, status: 'error', error: err.message });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const icon = {
    closed: '✅',
    'would-close': '·',
    'already-closed': '⏭',
    missing: '✖',
    'not-a-bug-report': '✖',
    error: '✖',
  };

  console.log('═'.repeat(72));
  for (const r of results) {
    console.log(`${icon[r.status] || '?'} [${r.status}] ${r.id}${r.label ? `  ${r.label}` : ''}`);
    if (r.note && r.status === 'would-close') console.log(`     → ${r.note}`);
    if (r.error) console.log(`     ${r.error}`);
  }
  console.log('═'.repeat(72));

  const count = (status) => results.filter((r) => r.status === status).length;
  const closed = dryRun ? count('would-close') : count('closed');
  console.log(
    `  ${dryRun ? 'would close' : 'closed'}: ${closed}   ` +
      `already closed: ${count('already-closed')}   ` +
      `failed: ${count('missing') + count('not-a-bug-report') + count('error')}`
  );
  if (dryRun) console.log('  (dry run — nothing was written)');
  console.log('═'.repeat(72));
}

main().catch((err) => {
  console.error('✖ resolve-support-tickets failed:', err);
  process.exitCode = 1;
});
