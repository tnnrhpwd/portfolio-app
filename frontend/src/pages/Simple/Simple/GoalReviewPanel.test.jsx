import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import GoalReviewPanel from './GoalReviewPanel.jsx';

jest.mock('../../../services/workspaceApi.js', () => ({
  getWorkspaceItem: jest.fn(),
  upsertWorkspaceItem: jest.fn(),
  generateGoalReviewViaBackend: jest.fn(),
  applyGoalReviewViaBackend: jest.fn(),
}));

jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line import/first
import { toast } from 'react-toastify';
// eslint-disable-next-line import/first
import {
  getWorkspaceItem,
  upsertWorkspaceItem,
  generateGoalReviewViaBackend,
  applyGoalReviewViaBackend,
} from '../../../services/workspaceApi.js';

/** One proposal of each kind, plus an observation the pass made. */
const storedReview = {
  version: 1,
  generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  items: [
    {
      id: 'horizon:garden:0',
      kind: 'horizon',
      goalSlug: 'garden',
      goalName: 'Plant a garden',
      title: 'Plant a garden',
      why: 'It reads like a season, not a decade.',
      patch: { horizon: 'year', from: 'none' },
    },
    {
      id: 'split:career:0',
      kind: 'split',
      goalSlug: 'career',
      goalName: 'Get better at my craft',
      title: 'Get better at my craft',
      why: 'Nothing under it that can be started this week.',
      patch: {
        children: [
          { title: 'Ship one side project', horizon: 'quarter' },
          { title: 'Summarise the release notes weekly', horizon: 'week' },
        ],
      },
    },
    {
      id: 'plan:garden:1',
      kind: 'plan',
      goalSlug: 'garden',
      goalName: 'Plant a garden',
      title: 'A first plan for Plant a garden',
      why: 'There is nothing to work from yet.',
      patch: { steps: ['Pick a bed', 'Buy seeds', 'Sow them'] },
    },
    {
      id: 'new-goal:new:0',
      kind: 'new-goal',
      goalSlug: null,
      goalName: null,
      title: 'Read the two books already on your shelf',
      why: 'It follows from the reading goal.',
      patch: { horizon: 'quarter', description: 'Start with the shorter one.' },
    },
  ],
  lessons: [{ id: 'lesson:0', text: 'Your week goals are the ones that actually move.' }],
  stats: { totalGoals: 6, truncated: 2 },
};

const storedItem = (review) =>
  (review ? { kind: 'review', slug: 'goal-review', content: JSON.stringify(review) } : null);

const renderPanel = (props = {}) =>
  render(
    <MemoryRouter>
      <GoalReviewPanel token="t" goalCount={6} onGoalsChanged={jest.fn()} {...props} />
    </MemoryRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  getWorkspaceItem.mockResolvedValue(null);
  upsertWorkspaceItem.mockResolvedValue({});
  generateGoalReviewViaBackend.mockResolvedValue({ ok: true, review: storedReview });
  applyGoalReviewViaBackend.mockResolvedValue({ ok: true, counts: { goals: 1, plans: 1 }, skipped: [], review: storedReview });
});
afterEach(cleanup);

/** Rendered staged state, read from the DOM rather than from a prop. */
const totalStaged = () => document.querySelectorAll('.sd-review-item.is-staged').length;

describe('GoalReviewPanel', () => {
  test('opens on the stored review and spends nothing to do it', async () => {
    getWorkspaceItem.mockResolvedValue(storedItem(storedReview));
    renderPanel();

    expect(await screen.findByText(/^Reviewed /)).toHaveTextContent('6 goals');
    expect(getWorkspaceItem).toHaveBeenCalledWith('t', 'review', 'goal-review');
    // Reading what a previous pass produced must never run another one.
    expect(generateGoalReviewViaBackend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Review again/ })).toBeEnabled();
  });

  test('an unreadable snapshot is an empty state, not an error', async () => {
    getWorkspaceItem.mockResolvedValue({ kind: 'review', slug: 'goal-review', content: '{not json' });
    renderPanel();

    expect(await screen.findByText(/Nothing reviewed yet/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('asks for a goal first when there is nothing to review', async () => {
    renderPanel({ goalCount: 0 });

    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Work on my goals/ })).toBeDisabled();
  });

  test('runs a pass, groups the proposals, and stages nothing by itself', async () => {
    renderPanel();
    await screen.findByText(/Nothing reviewed yet/);

    await userEvent.click(screen.getByRole('button', { name: /Work on my goals/ }));

    await waitFor(() => expect(generateGoalReviewViaBackend).toHaveBeenCalledWith('t', { force: true }));
    // One section per kind, in the fixed order the utils declare.
    const titles = [...document.querySelectorAll('.sd-review-section-title')].map((el) => el.textContent);
    expect(titles[0]).toMatch(/Re-scope/);
    expect(titles[1]).toMatch(/Break down/);
    expect(titles[2]).toMatch(/Plan/);
    expect(titles[3]).toMatch(/New goals/);
    expect(document.querySelectorAll('.sd-review-item')).toHaveLength(5); // 4 proposals + 1 observation
    // The batch footer only exists once something is staged.
    expect(screen.queryByRole('button', { name: /^Apply / })).toBeNull();
  });

  test('staging is local: the batch is summarised, and applying sends only the staged ids', async () => {
    const onGoalsChanged = jest.fn();
    getWorkspaceItem.mockResolvedValue(storedItem(storedReview));
    renderPanel({ onGoalsChanged });
    await screen.findByText(/^Reviewed /);

    await userEvent.click(screen.getAllByRole('button', { name: 'Stage' })[0]);
    expect(screen.getByText(/1 staged/)).toBeInTheDocument();
    // Staging a proposal must not write anything on its own.
    expect(applyGoalReviewViaBackend).not.toHaveBeenCalled();

    // Staging the first item relabels its button, so the remaining "Stage"
    // buttons shift up by one — this is the plan proposal now.
    await userEvent.click(screen.getAllByRole('button', { name: 'Stage' })[1]);
    await userEvent.click(screen.getByRole('button', { name: /^Apply 2 changes/ }));

    await waitFor(() =>
      expect(applyGoalReviewViaBackend).toHaveBeenCalledWith('t', ['horizon:garden:0', 'plan:garden:1'])
    );
    expect(totalStaged()).toBe(0);
    await waitFor(() => expect(onGoalsChanged).toHaveBeenCalled());
    // The skipped-proposal path is silent when nothing was skipped.
    expect(toast.info).not.toHaveBeenCalled();
  });

  test('unstage all clears the batch', async () => {
    getWorkspaceItem.mockResolvedValue(storedItem(storedReview));
    renderPanel();
    await screen.findByText(/^Reviewed /);

    await userEvent.click(screen.getAllByRole('button', { name: 'Stage' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Unstage all' }));

    expect(totalStaged()).toBe(0);
    expect(screen.queryByRole('button', { name: /^Apply / })).toBeNull();
  });

  test('says so when a staged change no longer applies', async () => {
    getWorkspaceItem.mockResolvedValue(storedItem(storedReview));
    applyGoalReviewViaBackend.mockResolvedValue({
      ok: true,
      counts: { goals: 0, plans: 0 },
      skipped: [{ id: 'horizon:garden:0', reason: 'goal-gone' }],
      review: storedReview,
    });
    renderPanel();
    await screen.findByText(/^Reviewed /);

    await userEvent.click(screen.getAllByRole('button', { name: 'Stage' })[0]);
    await userEvent.click(screen.getByRole('button', { name: /^Apply 1 change/ }));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/no longer applied/)));
  });

  test('a refused run (402) is shown in the panel, not thrown away', async () => {
    const err = new Error('You are out of credits.');
    generateGoalReviewViaBackend.mockRejectedValue(err);
    renderPanel();
    await screen.findByText(/Nothing reviewed yet/);

    await userEvent.click(screen.getByRole('button', { name: /Work on my goals/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You are out of credits.');
    // The button comes back so the user can retry after upgrading.
    expect(screen.getByRole('button', { name: /Work on my goals/ })).toBeEnabled();
  });

  test('keeping an observation writes a real lesson item', async () => {
    getWorkspaceItem.mockResolvedValue(storedItem(storedReview));
    renderPanel();
    await screen.findByText(/^Reviewed /);

    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));

    await waitFor(() => expect(upsertWorkspaceItem).toHaveBeenCalled());
    const [token, kind, slug, body] = upsertWorkspaceItem.mock.calls[0];
    expect(token).toBe('t');
    expect(kind).toBe('lesson');
    expect(slug).toMatch(/^review-/);
    const content = JSON.parse(body.content);
    expect(content.pattern).toMatch(/week goals/);
    expect(content.source).toBe('goal-review');
    // Kept once, it leaves the list.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull());
  });

  test('no token means no request at all', async () => {
    renderPanel({ token: null });

    expect(await screen.findByText(/Sign in to have your goals reviewed/)).toBeInTheDocument();
    expect(getWorkspaceItem).not.toHaveBeenCalled();
    expect(generateGoalReviewViaBackend).not.toHaveBeenCalled();
  });
});
