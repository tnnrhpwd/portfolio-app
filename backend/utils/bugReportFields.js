/**
 * bugReportFields.js — parse a stored bug-report record into API fields.
 *
 * Bug reports live in the `Simple` table as pipe-delimited `Key:value` text:
 *
 *   Creator:<id>|Bug:<title>|Severity:<...>|Description:<...>|...|Status:Open
 *
 * Extracted from getHashData.js so the mapping is covered by unit tests. The
 * parsing behaviour is unchanged: split on `|`, split each part on the first
 * `:`, and let the LAST occurrence of a key win (records carry two `Creator`
 * fields — the DB id prefix and the display name — and the display name is the
 * one the UI shows).
 *
 * Unknown keys are collected but ignored, so records written by an older
 * client keep working and records written by a newer client can add fields
 * without breaking this parser.
 */

/** Parse pipe-delimited text into a lower-cased key -> value map. */
function parseFields(text = '') {
  const fields = {};
  for (const part of String(text).split('|')) {
    const [key, ...valueParts] = part.split(':');
    if (key && valueParts.length > 0) {
      fields[key.toLowerCase()] = valueParts.join(':');
    }
  }
  return fields;
}

/**
 * Split the comma-separated `RelatedReports` id list (same convention as the
 * existing `Agrees:`/`Disagrees:` fields).
 */
function parseIdList(value = '') {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Map one DynamoDB item to the bug-report shape returned by the API.
 * @param {{ id: string, text?: string, createdAt?: string, updatedAt?: string }} item
 */
function parseBugReportItem(item = {}) {
  const fields = parseFields(item.text || '');
  return {
    id: item.id,
    title: fields.bug || 'Untitled Bug Report',
    severity: fields.severity || 'medium',
    description: fields.description || '',
    steps: fields.steps || '',
    expected: fields.expected || '',
    actual: fields.actual || '',
    browser: fields.browser || '',
    device: fields.device || '',
    status: fields.status || 'Open',
    creator: fields.creator || '',
    resolution: fields.resolution || '',
    resolvedBy: fields.resolvedby || '',
    resolvedAt: fields.resolvedat || '',
    // Optional fields added with the "link an improvement idea" feature.
    // Absent on older records -> empty string / empty array.
    idea: fields.idea || '',
    relatedReports: parseIdList(fields.relatedreports),
    timestamp: fields.timestamp || item.createdAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

module.exports = { parseBugReportItem, parseFields, parseIdList };
