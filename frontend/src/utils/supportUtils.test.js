import {
  MAX_RELATED_REPORTS,
  REPORTS_PAGE_SIZE,
  buildBugReportText,
  describeRelatedReports,
  filterReports,
  formatReportTimestamp,
  getReportStatusCounts,
  parseRelatedReportIds,
  serializeRelatedReportIds,
  stripFieldSeparators,
  truncateText,
} from './supportUtils';

const makeReport = (overrides = {}) => ({
  id: overrides.id ?? 'r1',
  title: 'Default title',
  description: 'Default description',
  steps: 'Default steps',
  status: 'Open',
  severity: 'medium',
  createdAt: '2026-01-01T10:00:00.000Z',
  ...overrides,
});

const reports = [
  makeReport({ id: 'a', title: 'Login fails', status: 'Open', severity: 'critical', createdAt: '2026-01-01T10:00:00.000Z' }),
  makeReport({ id: 'b', title: 'Slow dashboard', status: 'Closed', severity: 'low', createdAt: '2026-03-01T10:00:00.000Z' }),
  makeReport({ id: 'c', title: 'Broken export', status: 'Open', severity: 'high', createdAt: '2026-02-01T10:00:00.000Z' }),
];

describe('getReportStatusCounts', () => {
  it('counts open, closed and total reports', () => {
    expect(getReportStatusCounts(reports)).toEqual({ all: 3, open: 2, closed: 1 });
  });

  it('handles empty and non-array input', () => {
    expect(getReportStatusCounts([])).toEqual({ all: 0, open: 0, closed: 0 });
    expect(getReportStatusCounts(null)).toEqual({ all: 0, open: 0, closed: 0 });
    expect(getReportStatusCounts(undefined)).toEqual({ all: 0, open: 0, closed: 0 });
  });
});

describe('filterReports', () => {
  it('defaults to newest first', () => {
    expect(filterReports(reports).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts oldest first', () => {
    expect(filterReports(reports, { sort: 'oldest' }).map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by severity, most severe first', () => {
    expect(filterReports(reports, { sort: 'severity' }).map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts open before closed', () => {
    expect(filterReports(reports, { sort: 'status' }).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('filters by status', () => {
    expect(filterReports(reports, { status: 'Open' }).map((r) => r.id)).toEqual(['c', 'a']);
    expect(filterReports(reports, { status: 'Closed' }).map((r) => r.id)).toEqual(['b']);
    expect(filterReports(reports, { status: 'all' })).toHaveLength(3);
  });

  it('searches title, description and steps case-insensitively', () => {
    expect(filterReports(reports, { query: 'LOGIN' }).map((r) => r.id)).toEqual(['a']);
    expect(filterReports(reports, { query: 'default steps' })).toHaveLength(3);
    // terms must all live in a single field - fields are not concatenated
    expect(filterReports(reports, { query: 'login default' })).toHaveLength(0);
    expect(filterReports(reports, { query: '  ' })).toHaveLength(3);
  });

  it('combines search and status filters', () => {
    expect(filterReports(reports, { query: 'e', status: 'Open' }).map((r) => r.id)).toEqual(['c', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [...reports];
    filterReports(input, { status: 'Open', query: 'e' });
    expect(input.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles missing or malformed reports', () => {
    expect(filterReports(null)).toEqual([]);
    expect(filterReports([{ id: 'x' }, null], { status: 'Open' })).toEqual([]);
    expect(filterReports([null], { sort: 'severity' })).toEqual([null]);
  });
});

describe('truncateText', () => {
  it('collapses whitespace and keeps short text intact', () => {
    expect(truncateText('  a   b\n c ')).toBe('a b c');
  });

  it('truncates long text with an ellipsis', () => {
    const result = truncateText('abcdefghij', 5);
    expect(result).toBe('abcde...');
  });

  it('handles nullish input', () => {
    expect(truncateText(null)).toBe('');
    expect(truncateText(undefined)).toBe('');
  });
});

describe('formatReportTimestamp', () => {
  it('renders a readable date and time', () => {
    expect(formatReportTimestamp('2026-09-11T15:30:00.000Z')).toContain('at');
  });

  it('falls back to a dash for invalid input', () => {
    expect(formatReportTimestamp('not-a-date')).toBe('--');
    expect(formatReportTimestamp(undefined)).toBe('--');
  });
});

describe('REPORTS_PAGE_SIZE', () => {
  it('keeps the pager page size a positive number', () => {
    expect(REPORTS_PAGE_SIZE).toBeGreaterThan(0);
  });
});

describe('stripFieldSeparators', () => {
  it('replaces pipes that would split the record into extra fields', () => {
    expect(stripFieldSeparators('idea | with pipe')).toBe('idea / with pipe');
  });

  it('trims and tolerates nullish input', () => {
    expect(stripFieldSeparators('  spaced  ')).toBe('spaced');
    expect(stripFieldSeparators(null)).toBe('');
    expect(stripFieldSeparators(undefined)).toBe('');
  });
});

describe('related report id lists', () => {
  it('serializes to a comma-separated list', () => {
    expect(serializeRelatedReportIds(['a', 'b'])).toBe('a,b');
  });

  it('de-duplicates, trims, drops blanks and caps the count', () => {
    expect(serializeRelatedReportIds([' a ', 'a', '', null, 'b'])).toBe('a,b');
    const many = Array.from({ length: MAX_RELATED_REPORTS + 3 }, (_, i) => `id${i}`);
    expect(serializeRelatedReportIds(many).split(',')).toHaveLength(MAX_RELATED_REPORTS);
  });

  it('handles non-array input', () => {
    expect(serializeRelatedReportIds(null)).toBe('');
    expect(serializeRelatedReportIds(undefined)).toBe('');
  });

  it('round-trips through parse', () => {
    const ids = ['id1', 'id2'];
    expect(parseRelatedReportIds(serializeRelatedReportIds(ids))).toEqual(ids);
  });

  it('parses tolerant of blanks and whitespace', () => {
    expect(parseRelatedReportIds(' a ,, b, ')).toEqual(['a', 'b']);
    expect(parseRelatedReportIds('')).toEqual([]);
    expect(parseRelatedReportIds(undefined)).toEqual([]);
  });
});

describe('buildBugReportText', () => {
  const base = {
    title: 'Export fails',
    severity: 'high',
    description: 'Clicking export 500s',
    steps: '1. Click export',
    expected: 'File downloads',
    actual: 'Nothing happens',
    browser: 'Chrome',
    device: 'Win32',
    creator: 'me@example.com',
  };

  it('writes the same base fields as before, in order', () => {
    const text = buildBugReportText(base);
    expect(text.startsWith('Bug:Export fails|Severity:high|Description:Clicking export 500s|')).toBe(true);
    expect(text).toContain('|Creator:me@example.com|Status:Open|Timestamp:');
  });

  it('prefixes the creator id when given one', () => {
    expect(buildBugReportText({ ...base, creatorPrefix: 'Creator:user-1|' })).toContain(
      'Creator:user-1|Bug:Export fails'
    );
  });

  it('omits the optional fields when they are empty', () => {
    const text = buildBugReportText({ ...base, idea: '   ', relatedReports: [] });
    expect(text).not.toContain('Idea:');
    expect(text).not.toContain('RelatedReports:');
  });

  it('appends an idea and linked report ids when supplied', () => {
    const text = buildBugReportText({
      ...base,
      idea: 'Show a progress bar',
      relatedReports: ['id1', 'id2'],
    });
    expect(text).toContain('|Idea:Show a progress bar|RelatedReports:id1,id2|');
  });

  it('strips pipes from the idea so the record cannot be split', () => {
    const text = buildBugReportText({ ...base, idea: 'do this | then that' });
    expect(text).toContain('|Idea:do this / then that|');
    // exactly one field carries the idea
    expect(text.split('|').filter((part) => part.startsWith('Idea:'))).toHaveLength(1);
  });
});

describe('describeRelatedReports', () => {
  const reports = [
    { id: 'id1', title: 'First report' },
    { id: 'id2', title: 'Second report' },
  ];

  it('resolves ids to titles and flags which are reachable', () => {
    expect(describeRelatedReports(['id1', 'missing'], reports)).toEqual([
      { id: 'id1', title: 'First report', inList: true },
      { id: 'missing', title: 'Report no longer in your list', inList: false },
    ]);
  });

  it('accepts a raw comma-separated field value', () => {
    expect(describeRelatedReports('id2', reports)).toEqual([
      { id: 'id2', title: 'Second report', inList: true },
    ]);
  });

  it('handles empty input', () => {
    expect(describeRelatedReports([], reports)).toEqual([]);
    expect(describeRelatedReports(undefined, undefined)).toEqual([]);
  });
});
