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
