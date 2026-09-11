import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import MyReportsTab from './MyReportsTab';
import { REPORTS_PAGE_SIZE } from '../../utils/supportUtils';

// Spinner.jsx relies on the automatic JSX runtime (it has no React import),
// so stub it out for the loading-state assertion.
jest.mock('../Spinner/Spinner', () => ({ __esModule: true, default: () => null }));

const buildReports = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `report-${index}`,
    title: `Report number ${index}`,
    description: `Description for report ${index}`,
    steps: `Steps for report ${index}`,
    expected: 'It works',
    actual: 'It broke',
    status: index % 3 === 0 ? 'Closed' : 'Open',
    severity: ['low', 'medium', 'high', 'critical'][index % 4],
    browser: 'Chrome',
    device: 'Windows',
    createdAt: new Date(2026, 0, 1 + index).toISOString(),
    updatedAt: new Date(2026, 0, 1 + index).toISOString(),
  }));

const renderTab = (props = {}) =>
  render(
    <MyReportsTab
      userBugReports={buildReports(30)}
      loadingReports={false}
      isSubmitting={false}
      closeBugReport={jest.fn()}
      setActiveTab={jest.fn()}
      {...props}
    />
  );

const getCollapsedRows = () =>
  screen.queryAllByRole('button', { expanded: false, name: /Report number/ });

describe('MyReportsTab - long list layout', () => {
  it('renders at most one page of reports and only collapsed rows', () => {
    renderTab();

    const rows = screen.getAllByRole('button', { name: /Report number/ });
    expect(rows).toHaveLength(REPORTS_PAGE_SIZE);
    expect(screen.getByText(`Showing ${REPORTS_PAGE_SIZE} of 30`)).toBeInTheDocument();
    // details are not rendered while collapsed
    expect(screen.queryByText('Steps to Reproduce:')).not.toBeInTheDocument();
  });

  it('reveals more reports on demand', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: /Show 10 more reports/i }));
    expect(screen.getAllByRole('button', { name: /Report number/ })).toHaveLength(20);

    await user.click(screen.getByRole('button', { name: /Show all 30/i }));
    expect(screen.getAllByRole('button', { name: /Report number/ })).toHaveLength(30);
    expect(screen.queryByRole('button', { name: /Show .* more reports/i })).not.toBeInTheDocument();
  });

  it('expands and collapses a single report on click', async () => {
    const user = userEvent.setup();
    renderTab();

    // newest-first paging, so report 25 is on the first page
    const row = screen.getByRole('button', { name: /Report number 25 / });
    await user.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Steps to Reproduce:')).toBeInTheDocument();

    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Steps to Reproduce:')).not.toBeInTheDocument();
  });

  it('expands and collapses every visible report at once', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(getCollapsedRows()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(getCollapsedRows()).toHaveLength(REPORTS_PAGE_SIZE);
  });

  it('filters by status with counts and resets paging', async () => {
    const user = userEvent.setup();
    renderTab();

    // 10 closed reports (indices 0,3,6,...27)
    await user.click(screen.getByRole('button', { name: /^Closed/ }));
    expect(screen.getByText('Showing 10 of 10 (30 total)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Open/ }));
    expect(screen.getByText('Showing 10 of 20 (30 total)')).toBeInTheDocument();
  });

  it('searches titles and shows a no-match state that can be cleared', async () => {
    const user = userEvent.setup();
    renderTab();

    const search = screen.getByLabelText('Search your bug reports');
    await user.type(search, 'number 12');

    expect(screen.getAllByRole('button', { name: /Report number 12/ })).toHaveLength(1);
    expect(screen.getByText('Showing 1 of 1 (30 total)')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'zzzz');
    expect(screen.getByText('No reports match your search.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Showing 10 of 30')).toBeInTheDocument();
  });

  it('sorts by severity from the toolbar', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.selectOptions(screen.getByRole('combobox'), 'severity');
    const rows = screen.getAllByRole('button', { name: /Report number/ });
    // critical reports (index % 4 === 3) sort first, newest first within the group
    expect(within(rows[0]).getByText('🔴 Critical')).toBeInTheDocument();
  });

  it('shows the empty state with a call to action', async () => {
    const user = userEvent.setup();
    const setActiveTab = jest.fn();
    renderTab({ userBugReports: [], setActiveTab });

    expect(screen.getByText("You haven't submitted any bug reports yet.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Report Your First Bug' }));
    expect(setActiveTab).toHaveBeenCalledWith('bug');
  });

  it('shows a loading state', () => {
    renderTab({ loadingReports: true });
    expect(screen.getByText('Loading your bug reports...')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /Report number/ })).toHaveLength(0);
  });

  it('closes an open report from its expanded details', async () => {
    const user = userEvent.setup();
    const closeBugReport = jest.fn();
    renderTab({ closeBugReport });

    await user.click(screen.getByRole('button', { name: /Report number 25 / }));
    await user.click(screen.getByRole('button', { name: '✅ Mark as Resolved' }));

    expect(closeBugReport).toHaveBeenCalledWith('report-25');
  });
});

describe('MyReportsTab - linked improvement ideas', () => {
  const linkedReports = [
    { ...buildReports(1)[0], id: 'old', title: 'Original report', createdAt: '2026-01-01T10:00:00.000Z' },
    {
      ...buildReports(1)[0],
      id: 'new',
      title: 'Follow-up report',
      createdAt: '2026-02-01T10:00:00.000Z',
      idea: 'Add a progress bar while the export runs',
      relatedReports: ['old'],
    },
  ];

  it('shows an indicator on the collapsed row', () => {
    renderTab({ userBugReports: linkedReports });
    const row = screen.getByRole('button', { name: /Follow-up report/ });
    expect(within(row).getByText(/💡 idea/)).toBeInTheDocument();
    expect(within(row).getByText(/🔗 1 related/)).toBeInTheDocument();
  });

  it('renders the attached idea and a link to the related report', async () => {
    const user = userEvent.setup();
    renderTab({ userBugReports: linkedReports });

    expect(screen.queryByText(/Add a progress bar/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Follow-up report/ }));

    expect(screen.getByText('Add a progress bar while the export runs')).toBeInTheDocument();
    expect(screen.getByText('💡 Improvement idea:')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Go to related report: Original report' })
    ).toBeInTheDocument();
  });

  it('expands and reveals the linked report when the link is clicked', async () => {
    const user = userEvent.setup();
    renderTab({ userBugReports: linkedReports });

    await user.click(screen.getByRole('button', { name: /Follow-up report/ }));
    const originalRow = screen.getByRole('button', { name: /^Original report / });
    expect(originalRow).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'Go to related report: Original report' }));

    expect(screen.getByRole('button', { name: /^Original report / })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    // the linked report's own body is now rendered
    const card = document.getElementById('support-report-old');
    expect(within(card).getByText('Steps to Reproduce:')).toBeInTheDocument();
  });

  it('reveals a linked report that is on a later page', async () => {
    const user = userEvent.setup();
    // newest-first: 'new' is first, 'old' sits past the first page
    const many = buildReports(REPORTS_PAGE_SIZE + 2).map((report, index) => ({
      ...report,
      createdAt: new Date(2026, 0, 1 + index).toISOString(),
    }));
    const oldest = many[0];
    many.push({
      ...buildReports(1)[0],
      id: 'newest',
      title: 'Newest report',
      createdAt: new Date(2026, 5, 1).toISOString(),
      relatedReports: [oldest.id],
    });

    renderTab({ userBugReports: many });
    expect(
      screen.queryByRole('button', { name: new RegExp(`^${oldest.title} `) })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Newest report/ }));
    await user.click(
      screen.getByRole('button', { name: `Go to related report: ${oldest.title}` })
    );

    const revealed = screen.getByRole('button', { name: new RegExp(`^${oldest.title} `) });
    expect(revealed).toHaveAttribute('aria-expanded', 'true');
  });

  it('labels a link whose report is no longer in the list', async () => {
    const user = userEvent.setup();
    renderTab({
      userBugReports: [
        {
          ...buildReports(1)[0],
          id: 'only',
          title: 'Solo report',
          relatedReports: ['gone'],
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: /Solo report/ }));

    expect(screen.getByText('Report no longer in your list')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report no longer in your list' })).not.toBeInTheDocument();
  });
});
