import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlanChecklist from './PlanChecklist.jsx';

/**
 * PlanChecklist is the visible half of the plan surface (the backend half is
 * `harness/planSurface.js`).
 *
 * The component's whole job is to make "where is it, and is that the right order?"
 * answerable while a turn is running — so these cases are about what a user can
 * READ at a glance, and about the component not inventing anything the server
 * already decided (bounds, the one-in-progress rule, which step is current).
 */

const plan = (items) => ({ items, counts: countsFor(items) });

function countsFor(items) {
  const counts = { pending: 0, in_progress: 0, done: 0, blocked: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

const step = (id, text, status) => ({ id, text, status });

afterEach(cleanup);

describe('PlanChecklist', () => {
  it('renders nothing at all without a plan', () => {
    // A turn that published no plan must not leave an empty checklist frame
    // behind — most turns are one tool call or a plain reply.
    const { container } = render(<PlanChecklist />);
    expect(container).toBeEmptyDOMElement();
    expect(render(<PlanChecklist plan={null} />).container).toBeEmptyDOMElement();
    expect(render(<PlanChecklist plan={{ items: [] }} />).container).toBeEmptyDOMElement();
  });

  it('renders every step in order, with its status', () => {
    render(<PlanChecklist plan={plan([
      step('p1', 'find the limit', 'done'),
      step('p2', 'raise it', 'in_progress'),
      step('p3', 'run the check', 'pending'),
    ])} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((li) => li.textContent)).toEqual([
      '✓find the limit',
      '▸raise it',
      '·run the check',
    ]);
    // The status is in the class as well, because that is what carries the colour.
    expect(items[0]).toHaveClass('plan__item--done');
    expect(items[1]).toHaveClass('plan__item--in_progress');
  });

  it('names the current step in the summary — the one thing worth reading mid-turn', () => {
    render(<PlanChecklist plan={plan([
      step('p1', 'find the limit', 'done'),
      step('p2', 'raise it', 'in_progress'),
      step('p3', 'run the check', 'pending'),
    ])} />);

    expect(screen.getByText('3 steps · 1 done · working on: raise it')).toBeInTheDocument();
  });

  it('says so when everything is done', () => {
    render(<PlanChecklist plan={plan([
      step('p1', 'one', 'done'),
      step('p2', 'two', 'done'),
    ])} />);

    expect(screen.getByText('2 steps · 2 done · all done')).toBeInTheDocument();
  });

  it('surfaces blocked work, since that is usually about the user', () => {
    render(<PlanChecklist plan={plan([
      step('p1', 'waiting on the API key', 'blocked'),
      step('p2', 'deploy', 'pending'),
    ])} />);

    expect(screen.getByText('2 steps · 1 blocked')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveClass('plan__item--blocked');
  });

  it('renders an in_progress step even when nothing is done yet', () => {
    // The state a turn is in for most of its life. It must not read as empty.
    render(<PlanChecklist plan={plan([step('p1', 'read the file', 'in_progress')])} />);
    expect(screen.getByText('1 step · working on: read the file')).toBeInTheDocument();
  });

  it('gives a screen reader the status as a WORD, not a strikethrough', () => {
    render(<PlanChecklist plan={plan([
      step('p1', 'done thing', 'done'),
      step('p2', 'current thing', 'in_progress'),
    ])} />);

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('aria-label', 'done: done thing');
    expect(items[1]).toHaveAttribute('aria-label', 'in progress: current thing');
  });

  it('does not pick a current step of its own', () => {
    // Two marked in progress could only reach here if the server let it through —
    // and the server does not (see planSurface.test.js). The assertion is that
    // this component never *chooses*: it renders what it was given and the
    // summary simply names the first it finds.
    render(<PlanChecklist plan={plan([
      step('p1', 'a', 'in_progress'),
      step('p2', 'b', 'in_progress'),
    ])} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2 steps · working on: a')).toBeInTheDocument();
  });

  it('falls back to an unknown status rather than dropping the step', () => {
    // Defensive: a status the backend does not know must still be VISIBLE work,
    // not a step that silently disappears from the user's view of the plan.
    render(<PlanChecklist plan={plan([{ id: 'p1', text: 'mystery', status: 'sideways' }])} />);
    expect(screen.getByText('mystery')).toBeInTheDocument();
  });
});
