import {
  REPORTS_PAGE_SIZE,
  filterReports,
  formatReportTimestamp,
  getReportStatusCounts,
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
