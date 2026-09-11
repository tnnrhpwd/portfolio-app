import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import BugReportTab from './BugReportTab';
import { MAX_RELATED_REPORTS } from '../../utils/supportUtils';

const baseFormData = {
  bugTitle: '',
  bugDescription: '',
  bugSteps: '',
  bugExpected: '',
  bugActual: '',
  bugSeverity: 'medium',
  bugBrowser: 'Chrome',
  bugDevice: 'Win32',
  bugIdea: '',
  bugRelatedReports: [],
};

const buildReports = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `report-${index}`,
    title: `Existing report ${index}`,
    status: index % 2 === 0 ? 'Open' : 'Closed',
  }));

/** Controlled wrapper so typing/checking behaves like the real page. */
const Harness = ({ reports = [], onSubmit = jest.fn() }) => {
  const [formData, setFormData] = useState(baseFormData);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleRelatedReportToggle = (reportId) => {
    setFormData((prev) => {
      const current = prev.bugRelatedReports;
      const linked = current.includes(reportId);
      return {
        ...prev,
        bugRelatedReports: linked
          ? current.filter((id) => id !== reportId)
          : [...current, reportId],
      };
    });
  };

  return (
    <BugReportTab
      formData={formData}
      handleInputChange={handleInputChange}
      handleBugReportSubmit={(event) => {
        event.preventDefault();
        onSubmit(formData);
      }}
      handleRelatedReportToggle={handleRelatedReportToggle}
      isSubmitting={false}
      userReports={reports}
    />
  );
};

describe('BugReportTab - related improvement ideas', () => {
  it('keeps the required fields required and the new ones optional', () => {
    render(<Harness />);

    expect(screen.getByLabelText('Bug Title *')).toBeRequired();
    expect(screen.getByLabelText('Bug Description *')).toBeRequired();
    expect(screen.getByLabelText('Improvement idea')).not.toBeRequired();
    expect(screen.getByLabelText('Steps to Reproduce (optional)')).not.toBeRequired();
  });

  it('submits the typed improvement idea', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Bug Title *'), 'Export is slow');
    await user.type(screen.getByLabelText('Bug Description *'), 'Takes 30 seconds');
    await user.type(screen.getByLabelText('Improvement idea'), 'Show a progress bar');
    await user.click(screen.getByRole('button', { name: /Submit Bug Report/ }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ bugIdea: 'Show a progress bar' })
    );
  });

  it('says so when there is nothing to link to', () => {
    render(<Harness reports={[]} />);
    expect(screen.getByText('You have no other reports to link to yet.')).toBeInTheDocument();
  });

  it('links and unlinks an existing report', async () => {
    const user = userEvent.setup();
    render(<Harness reports={buildReports(3)} />);

    const checkbox = screen.getByRole('checkbox', { name: /Existing report 1/ });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText(/Link related reports \(1\/5\)/)).toBeInTheDocument();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('sorts linked reports to the top of the list', async () => {
    const user = userEvent.setup();
    render(<Harness reports={buildReports(3)} />);

    await user.click(screen.getByRole('checkbox', { name: /Existing report 2/ }));

    const items = screen.getAllByRole('checkbox').map((box) => box.closest('label'));
    expect(within(items[0]).getByText('Existing report 2')).toBeInTheDocument();
  });

  it('filters the report list once there are enough reports to need it', async () => {
    const user = userEvent.setup();
    render(<Harness reports={buildReports(8)} />);

    expect(screen.getAllByRole('checkbox')).toHaveLength(8);

    await user.type(screen.getByPlaceholderText('Filter your reports...'), 'report 3');

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText('Existing report 3')).toBeInTheDocument();
  });

  it('blocks linking past the limit and keeps selected items selectable', async () => {
    const user = userEvent.setup();
    const reports = buildReports(MAX_RELATED_REPORTS + 2);
    render(<Harness reports={reports} />);

    const boxes = screen.getAllByRole('checkbox');
    for (let i = 0; i < MAX_RELATED_REPORTS; i++) {
      await user.click(boxes[i]);
    }

    expect(screen.getByText(`Link related reports (${MAX_RELATED_REPORTS}/5)`)).toBeInTheDocument();
    // the two unlinked checkboxes are disabled...
    expect(boxes[MAX_RELATED_REPORTS]).toBeDisabled();
    // ...but a linked one can still be unchecked
    expect(boxes[0]).not.toBeDisabled();
  });

  it('shows a friendly message when the filter matches nothing', async () => {
    const user = userEvent.setup();
    render(<Harness reports={buildReports(8)} />);

    await user.type(screen.getByPlaceholderText('Filter your reports...'), 'zzzz');

    expect(screen.getByText('No reports match that filter.')).toBeInTheDocument();
  });
});
