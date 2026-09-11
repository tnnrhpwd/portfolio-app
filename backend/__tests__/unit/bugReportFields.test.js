const { parseBugReportItem, parseIdList } = require('../../utils/bugReportFields');

const buildItem = (text, overrides = {}) => ({
  id: 'abc123',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  text,
  ...overrides,
});

describe('parseBugReportItem', () => {
  it('maps a legacy record with no optional fields', () => {
    const report = parseBugReportItem(
      buildItem(
        'Creator:user-1|Bug:Login fails|Severity:high|Description:Cannot log in|' +
          'Steps:1. Open the login page|Expected:Dashboard|Actual:Error|' +
          'Browser:Chrome|Device:Win32|Creator:me@example.com|Status:Open|Timestamp:2026-09-01T10:00:00.000Z'
      )
    );

    expect(report).toEqual({
      id: 'abc123',
      title: 'Login fails',
      severity: 'high',
      description: 'Cannot log in',
      steps: '1. Open the login page',
      expected: 'Dashboard',
      actual: 'Error',
      browser: 'Chrome',
      device: 'Win32',
      status: 'Open',
      creator: 'me@example.com',
      resolution: '',
      resolvedBy: '',
      resolvedAt: '',
      idea: '',
      relatedReports: [],
      timestamp: '2026-09-01T10:00:00.000Z',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    });
  });

  it('prefers the last Creator field (the display name, not the id prefix)', () => {
    const report = parseBugReportItem(
      buildItem('Creator:user-1|Bug:Title|Description:x|Creator:me@example.com|Status:Open')
    );
    expect(report.creator).toBe('me@example.com');
  });

  it('parses an attached improvement idea', () => {
    const report = parseBugReportItem(
      buildItem(
        'Bug:Sluggish dashboard|Description:Slow|Idea:Add a progress bar to the export button|Status:Open'
      )
    );
    expect(report.idea).toBe('Add a progress bar to the export button');
  });

  it('parses the linked related-report ids', () => {
    const report = parseBugReportItem(
      buildItem('Bug:Export fails|Description:x|RelatedReports:id1,id2|Status:Open')
    );
    expect(report.relatedReports).toEqual(['id1', 'id2']);
  });

  it('keeps working when the optional fields are absent or blank', () => {
    const report = parseBugReportItem(
      buildItem('Bug:Export fails|Description:x|Idea:|RelatedReports:|Status:Open')
    );
    expect(report.idea).toBe('');
    expect(report.relatedReports).toEqual([]);
  });

  it('ignores unknown fields so newer clients stay compatible', () => {
    const report = parseBugReportItem(
      buildItem('Bug:Export fails|SomeFutureField:whatever|Description:x|Status:Open')
    );
    expect(report.title).toBe('Export fails');
    expect(report.description).toBe('x');
  });

  it('keeps colons inside a value', () => {
    const report = parseBugReportItem(
      buildItem('Bug:Slow|Description:Failed at 10:30 each morning|Status:Open')
    );
    expect(report.description).toBe('Failed at 10:30 each morning');
  });

  it('keeps the resolution fields written by the close workflow', () => {
    const report = parseBugReportItem(
      buildItem(
        'Bug:Slow|Description:x|Status:Closed|Timestamp:2026-09-01T10:00:00.000Z|' +
          'Resolution:Fixed in abc123|ResolvedBy:Admin (me@example.com)|ResolvedAt:2026-09-02T10:00:00.000Z'
      )
    );
    expect(report.status).toBe('Closed');
    expect(report.resolution).toBe('Fixed in abc123');
    expect(report.resolvedBy).toBe('Admin (me@example.com)');
    expect(report.resolvedAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('falls back to sensible defaults for a sparse record', () => {
    const report = parseBugReportItem(buildItem('Bug:Only a title'));
    expect(report.title).toBe('Only a title');
    expect(report.severity).toBe('medium');
    expect(report.status).toBe('Open');
    expect(report.timestamp).toBe('2026-09-01T10:00:00.000Z');
  });

  it('handles a missing text field', () => {
    const report = parseBugReportItem({ id: 'x', createdAt: '2026-09-01T10:00:00.000Z' });
    expect(report.title).toBe('Untitled Bug Report');
    expect(report.description).toBe('');
  });
});

describe('parseIdList', () => {
  it.each([
    ['', []],
    [undefined, []],
    ['id1', ['id1']],
    ['id1,id2', ['id1', 'id2']],
    [' id1 , id2 ', ['id1', 'id2']],
    ['id1,,id2,', ['id1', 'id2']],
  ])('parses %p', (input, expected) => {
    expect(parseIdList(input)).toEqual(expected);
  });
});
