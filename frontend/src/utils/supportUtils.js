/**
 * Support utility functions
 */

/**
 * Get user identifier from user object
 * @param {Object} user - User object
 * @returns {string} User identifier
 */
export const getUserIdentifier = (user) => {
  if (!user) return 'Anonymous';
  
  // Check for direct email property first (most likely in frontend user object)
  if (user.email) return user.email;
  
  // Check for email in the text field (backend format)
  if (user.text && user.text.includes('Email:')) {
    const emailMatch = user.text.match(/Email:([^|]+)/);
    if (emailMatch) return emailMatch[1];
  }
  
  // Fallback to other identifiers
  return user.id || user.nickname || 'Anonymous';
};

/**
 * Get browser information
 * @returns {string} Browser info string
 */
export const getBrowserInfo = () => {
  const userAgent = navigator.userAgent;
  let browser = 'Unknown';
  
  if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari')) browser = 'Safari';
  else if (userAgent.includes('Edge')) browser = 'Edge';
  
  return `${browser} (${userAgent})`;
};

/**
 * Get device information
 * @returns {string} Device info string
 */
export const getDeviceInfo = () => {
  const { screen, navigator } = window;
  return `${navigator.platform} - ${screen.width}x${screen.height} - ${navigator.language}`;
};

/* ===================================================================
 * Bug Reports: filtering, sorting and formatting helpers
 * (pure functions - unit tested in supportUtils.test.js)
 * ================================================================ */

/** How many reports are rendered per "page" before "Show more" */
export const REPORTS_PAGE_SIZE = 10;

/** Values for the `sort` control, in display order */
export const REPORT_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'severity', label: 'Severity' },
  { value: 'status', label: 'Status' },
];

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

const toTime = (value) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

/**
 * Count open/closed reports.
 * @param {Array} reports
 * @returns {{ all: number, open: number, closed: number }}
 */
export const getReportStatusCounts = (reports = []) => {
  const list = Array.isArray(reports) ? reports : [];
  return {
    all: list.length,
    open: list.filter((report) => report?.status === 'Open').length,
    closed: list.filter((report) => report?.status === 'Closed').length,
  };
};

/**
 * Filter + sort bug reports for the "My Reports" list.
 * @param {Array} reports - Raw reports
 * @param {Object} [options]
 * @param {string} [options.query] - Free-text search across title/description/steps
 * @param {'all'|'Open'|'Closed'} [options.status] - Status filter
 * @param {'newest'|'oldest'|'severity'|'status'} [options.sort] - Sort order
 * @returns {Array} A new, filtered + sorted array
 */
export const filterReports = (reports = [], { query = '', status = 'all', sort = 'newest' } = {}) => {
  const list = Array.isArray(reports) ? reports : [];
  const needle = query.trim().toLowerCase();

  const filtered = list.filter((report) => {
    if (status !== 'all' && report?.status !== status) return false;
    if (!needle) return true;
    return [report?.title, report?.description, report?.steps]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });

  const sorted = [...filtered];
  switch (sort) {
    case 'oldest':
      sorted.sort((a, b) => toTime(a?.createdAt) - toTime(b?.createdAt));
      break;
    case 'severity':
      sorted.sort((a, b) => {
        const diff =
          (SEVERITY_RANK[a?.severity] ?? 99) - (SEVERITY_RANK[b?.severity] ?? 99);
        // tie-break with newest first
        return diff !== 0 ? diff : toTime(b?.createdAt) - toTime(a?.createdAt);
      });
      break;
    case 'status':
      sorted.sort((a, b) => {
        if (a?.status === b?.status) return toTime(b?.createdAt) - toTime(a?.createdAt);
        // Open before Closed
        return a?.status === 'Open' ? -1 : 1;
      });
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => toTime(b?.createdAt) - toTime(a?.createdAt));
      break;
  }
  return sorted;
};

/**
 * Short, human-friendly timestamp for a collapsed report row.
 * @param {string|number|Date} value
 * @returns {string} e.g. "9/11/2026" or "--" when invalid
 */
export const formatReportTimestamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.toLocaleDateString()} at ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
};

/**
 * Collapse whitespace and clip long text for collapsed previews.
 * @param {string} text
 * @param {number} [max] - Maximum length before truncation
 * @returns {string}
 */
export const truncateText = (text, max = 160) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}...`;
};

/* ===================================================================
 * Bug reports: linked improvement ideas
 *
 * A report can carry two extra optional fields, appended only when they have
 * a value so older records and the existing parsers are unaffected:
 *
 *   Idea:<free text>              the improvement idea attached to the report
 *   RelatedReports:<id>,<id>      other reports this one is connected to
 *
 * The id list mirrors the existing `Agrees:`/`Disagrees:` comma-separated
 * convention on these pipe-delimited records.
 * ================================================================ */

/** How many other reports a single report may link to. */
export const MAX_RELATED_REPORTS = 5;

/**
 * Remove pipe characters. A `|` inside a value would be read as a field
 * separator and split the record into bogus fields, so the attached idea text
 * is sanitised before it is written.
 */
export const stripFieldSeparators = (value = '') =>
  String(value ?? '').replace(/\|/g, '/').trim();

/** Serialize linked report ids into the comma-separated field value. */
export const serializeRelatedReportIds = (ids = []) => {
  const list = Array.isArray(ids) ? ids : [];
  const unique = [];
  for (const raw of list) {
    const id = String(raw ?? '').trim();
    if (id && !unique.includes(id)) unique.push(id);
    if (unique.length >= MAX_RELATED_REPORTS) break;
  }
  return unique.join(',');
};

/** Parse the comma-separated field value back into an array of ids. */
export const parseRelatedReportIds = (value = '') =>
  String(value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

/**
 * Build the pipe-delimited text for a bug report.
 *
 * Existing fields are written exactly as before (raw values, newlines and all)
 * so live records keep their current shape; `Idea`/`RelatedReports` are only
 * appended when the reporter actually supplied them.
 */
export const buildBugReportText = ({
  creatorPrefix = '',
  title = '',
  severity = 'medium',
  description = '',
  steps = '',
  expected = '',
  actual = '',
  browser = '',
  device = '',
  creator = '',
  idea = '',
  relatedReports = [],
} = {}) => {
  const fields = [
    `${creatorPrefix}Bug:${title}`,
    `Severity:${severity}`,
    `Description:${description}`,
    `Steps:${steps}`,
    `Expected:${expected}`,
    `Actual:${actual}`,
    `Browser:${browser}`,
    `Device:${device}`,
  ];

  const ideaText = stripFieldSeparators(idea);
  if (ideaText) fields.push(`Idea:${ideaText}`);

  const linked = serializeRelatedReportIds(relatedReports);
  if (linked) fields.push(`RelatedReports:${linked}`);

  fields.push(`Creator:${creator}`, 'Status:Open', `Timestamp:${new Date().toISOString()}`);

  return fields.join('|');
};

/**
 * Resolve linked ids against the reports the user can see, so the detail view
 * can show a title and whether the link is reachable from the current list.
 * @param {string[]} ids
 * @param {Array} reports
 * @returns {Array<{ id: string, title: string, inList: boolean }>}
 */
export const describeRelatedReports = (ids = [], reports = []) => {
  const list = Array.isArray(reports) ? reports : [];
  const idList = Array.isArray(ids) ? ids : parseRelatedReportIds(ids);
  return idList.map((id) => {
    const match = list.find((report) => report?.id === id);
    return {
      id,
      title: match?.title || 'Report no longer in your list',
      inList: Boolean(match),
    };
  });
};

/**
 * Scroll to support content section
 */
export const scrollToContent = () => {
  const contentElement = document.querySelector('.support-content');
  if (contentElement) {
    contentElement.scrollIntoView({ 
      behavior: 'smooth',
      block: 'start'
    });
  }
};
