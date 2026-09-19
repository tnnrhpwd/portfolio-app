import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StepList from './StepList.jsx';

/**
 * StepList is the visible half of the turn journal (the backend half is
 * `backend/services/harness/stepJournal.js`). Two things are under test that a
 * later "tidy-up" could quietly break:
 *
 *   1. a row is updated, not duplicated — the backend emits each step twice
 *      (running → ok/error), so the component must key on `id`;
 *   2. a REDACTED step never renders its arguments. `argsPreview: null` with
 *      `argsRedacted: true` is the server saying "private argument"; there is
 *      deliberately no fallback that looks anywhere else for the value.
 */

afterEach(cleanup);

const step = (over = {}) => ({
  id: 'run_1_s1',
  index: 1,
  tool: 'repo_search',
  plane: 'repo',
  label: 'Searching the repository…',
  status: 'ok',
  argsPreview: { query: 'MARKER' },
  argsRedacted: false,
  argKeys: [],
  resultPreview: '2 matching line(s)',
  error: null,
  ms: 120,
  ...over,
});

describe('StepList', () => {
  it('renders nothing without steps', () => {
    const { container } = render(<StepList />);
    expect(container).toBeEmptyDOMElement();
    const { container: empty } = render(<StepList steps={[]} />);
    expect(empty).toBeEmptyDOMElement();
  });

  it('summarises the run: count, failures, total time', () => {
    render(<StepList steps={[
      step({ id: 'a', ms: 100 }),
      step({ id: 'b', ms: 50, status: 'error', error: 'boom', label: 'Reading a.js…' }),
    ]} />);

    expect(screen.getByText('2 steps · 1 failed · 150ms')).toBeInTheDocument();
  });

  it('shows a duration in seconds once it is worth counting in seconds', () => {
    render(<StepList steps={[step({ ms: 2400 })]} />);
    expect(screen.getByText('2.4s')).toBeInTheDocument();
  });

  it('marks a step with its own status glyph and no duration while running', () => {
    render(<StepList steps={[
      step({ id: 'a', status: 'ok', label: 'Reading a.js…' }),
      step({ id: 'b', status: 'running', label: 'Editing b.js…', ms: null }),
    ]} />);

    const running = screen.getByRole('button', { name: /Editing b\.js…/ });
    expect(running).toHaveTextContent('•');
    expect(running).not.toHaveTextContent('ms');
    expect(screen.getByRole('button', { name: /Reading a\.js…/ })).toHaveTextContent('✓');
  });

  it('badges the plane only when it is not the site itself', () => {
    render(<StepList steps={[
      step({ id: 'a', plane: 'cloud', label: 'Saving your goal…' }),
      step({ id: 'b', plane: 'repo', label: 'Reading x.js…' }),
      step({ id: 'c', plane: 'addon', label: 'Opening Notepad…' }),
    ]} />);

    const cloud = screen.getByRole('button', { name: /Saving your goal…/ });
    expect(cloud).not.toHaveTextContent('site');
    expect(screen.getByRole('button', { name: /Reading x\.js…/ })).toHaveTextContent('repo');
    expect(screen.getByRole('button', { name: /Opening Notepad…/ })).toHaveTextContent('PC');
  });

  it('expands a row to show the arguments and the result', () => {
    render(<StepList steps={[step()]} />);

    const row = screen.getByRole('button', { name: /Searching the repository…/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/"query": "MARKER"/)).not.toBeInTheDocument();

    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/"query": "MARKER"/)).toBeInTheDocument();
    expect(screen.getByText('2 matching line(s)')).toBeInTheDocument();
  });

  it('says a private argument was passed, and never renders it', () => {
    render(<StepList steps={[step({
      tool: 'save_note',
      plane: 'cloud',
      label: 'Saving a note…',
      argsPreview: null,
      argsRedacted: true,
      argKeys: ['text'],
    })]} />);

    fireEvent.click(screen.getByRole('button', { name: /Saving a note…/ }));

    expect(screen.getByText(/private argument \(text\) — not recorded/)).toBeInTheDocument();
  });

  it('shows a refused step as a decision, not a failure, and counts it', () => {
    render(<StepList steps={[
      step({ id: 'a', label: 'Reading a.js…', ms: 120 }),
      step({
        id: 'b',
        tool: 'repo_commit_changes',
        status: 'denied',
        label: 'Committing the change…',
        resultPreview: 'Denied: you declined',
        ms: 0,
      }),
    ]} />);

    expect(screen.getByText('2 steps · 1 not approved · 120ms')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Committing the change…/ })).toHaveTextContent('⊘');
  });

  it('leads with the error on a failed step', () => {
    render(<StepList steps={[step({
      status: 'error',
      error: 'invalid file path',
      resultPreview: 'Error: invalid file path.',
    })]} />);

    fireEvent.click(screen.getByRole('button', { name: /Searching the repository…/ }));

    expect(screen.getByText('invalid file path')).toBeInTheDocument();
  });

  it('collapses again on a second click', () => {
    render(<StepList steps={[step()]} />);
    const row = screen.getByRole('button', { name: /Searching the repository…/ });

    fireEvent.click(row);
    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/"query": "MARKER"/)).not.toBeInTheDocument();
  });
});

/**
 * The "Try again" affordance on a refused step.
 *
 * The rule under test is that this component does NOT decide whether a retry is
 * offered — `step.reaskable` does, computed server-side from the refusal
 * vocabulary (`backend/services/harness/refusalCause.js`). A UI that kept its own
 * list of which refusals are re-askable would drift from that table, and the
 * failure mode is a button that promises something the machine has already
 * refused. So: no `reaskable`, no button, and a policy denial never gets one.
 */
describe('StepList — retrying a refused step', () => {
  const refused = (over = {}) => step({
    id: 'refused',
    tool: 'pc_do',
    plane: 'addon',
    status: 'denied',
    label: 'Opening Notepad…',
    resultPreview: 'Denied (expired): pc_do open_app was not run — the prompt was never answered.',
    outcome: 'permission',
    cause: 'expired',
    reaskable: true,
    ms: 0,
    ...over,
  });

  it('offers the action on a re-askable refusal', () => {
    render(<StepList steps={[refused()]} onRetryStep={() => {}} />);

    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button).toBeInTheDocument();
    // It asks; it does not approve. The tooltip must not overpromise.
    expect(button).toHaveAttribute('title', expect.stringContaining('still say no'));
  });

  it('hands the whole step to the caller, not just an id', () => {
    const onRetryStep = jest.fn();
    render(<StepList steps={[refused()]} onRetryStep={onRetryStep} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // The caller needs `cause` and `label` to phrase the message, so the record
    // travels intact rather than being flattened to an identifier.
    expect(onRetryStep).toHaveBeenCalledWith(expect.objectContaining({
      id: 'refused',
      cause: 'expired',
      label: 'Opening Notepad…',
    }));
  });

  it('offers nothing when the refusal is not re-askable', () => {
    // A stored policy (or the kill switch) refuses identically forever, so a
    // retry would be a lie.
    render(<StepList
      steps={[refused({ cause: 'policy-deny', reaskable: false })]}
      onRetryStep={() => {}}
    />);

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers nothing when no handler is wired up', () => {
    // This is how the button disappears while a turn is running: the caller passes
    // no handler rather than passing a disabled one.
    render(<StepList steps={[refused()]} />);

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers nothing on an ordinary failure or a success', () => {
    render(<StepList
      steps={[
        step({ id: 'a', status: 'error', error: 'boom' }),
        step({ id: 'b', status: 'ok' }),
      ]}
      onRetryStep={() => {}}
    />);

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('keeps the retry button OUT of the row button', () => {
    // The row is itself a <button> (it expands the detail), and a button inside a
    // button is invalid HTML that browsers silently re-parent — which is how a
    // click ends up toggling the detail instead of retrying.
    const onRetryStep = jest.fn();
    const { container } = render(<StepList steps={[refused()]} onRetryStep={onRetryStep} />);

    expect(container.querySelectorAll('button button')).toHaveLength(0);
  });

  it('still opens the detail from the row when a retry is offered', () => {
    const onRetryStep = jest.fn();
    render(<StepList steps={[refused()]} onRetryStep={onRetryStep} />);

    fireEvent.click(screen.getByRole('button', { name: /Opening Notepad…/ }));

    expect(onRetryStep).not.toHaveBeenCalled();
    expect(screen.getByText(/the prompt was never answered/)).toBeInTheDocument();
  });
});
