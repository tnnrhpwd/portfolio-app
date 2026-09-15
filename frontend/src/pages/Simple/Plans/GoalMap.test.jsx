import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import GoalMap from './GoalMap.jsx';

jest.mock('../../../services/workspaceApi.js', () => ({
  getWorkspaceItem: jest.fn(),
  generateGoalMapViaBackend: jest.fn(),
}));

// eslint-disable-next-line import/first
import { getWorkspaceItem, generateGoalMapViaBackend } from '../../../services/workspaceApi.js';

const goal = (slug, title, status = 'active') => ({
  _id: slug,
  type: 'goal',
  data: { title, status },
});

const storedMap = {
  version: 1,
  generatedAt: '2026-09-15T14:02:00.000Z',
  categories: [{ id: 'web', label: 'Web' }, { id: 'life', label: 'Life' }],
  nodes: [
    { slug: 'alpha', title: 'Alpha goal', category: 'web', order: 1, dependsOn: [] },
    { slug: 'beta', title: 'Beta goal', category: 'life', order: 1, dependsOn: ['alpha'] },
    { slug: 'ghost', title: 'A goal that was deleted', category: 'life', order: 2, dependsOn: [] },
  ],
  stats: { categoryCount: 2, edgeCount: 1, totalGoals: 3, mappedGoals: 3, truncated: false },
};

/** Items fetched from the workspace store: the saved map, or nothing. */
const storedItem = (map) => (map ? { kind: 'map', slug: 'goal-map', content: JSON.stringify(map) } : null);

const renderMap = (props = {}) =>
  render(
    <MemoryRouter>
      <GoalMap token="t" goals={[goal('alpha', 'Alpha goal'), goal('beta', 'Beta goal', 'blocked')]} {...props} />
    </MemoryRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  getWorkspaceItem.mockResolvedValue(null);
});
afterEach(cleanup);

describe('GoalMap', () => {
  test('offers to generate when nothing is stored, and spends nothing on its own', async () => {
    renderMap();

    expect(await screen.findByText(/No map yet/)).toBeInTheDocument();
    expect(getWorkspaceItem).toHaveBeenCalledWith('t', 'map', 'goal-map');
    expect(generateGoalMapViaBackend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Generate map/ })).toBeEnabled();
    expect(document.querySelector('svg.goal-map-svg')).toBeNull();
  });

  test('renders a stored map: one lane per category, a legend, and the links', async () => {
    getWorkspaceItem.mockResolvedValue(storedItem(storedMap));
    renderMap();

    const laneLabels = await screen.findAllByText(/^(WEB|LIFE)$/);
    expect(laneLabels.map((el) => el.textContent)).toEqual(['WEB', 'LIFE']);
    expect(document.querySelectorAll('.goal-map-node')).toHaveLength(3);
    expect(document.querySelectorAll('.goal-map-edge')).toHaveLength(1);
    expect(screen.getByText('Web')).toBeInTheDocument();
    expect(screen.getByText(/generated/)).toBeInTheDocument();
    // Reading a stored map must not regenerate it.
    expect(generateGoalMapViaBackend).not.toHaveBeenCalled();
  });

  test('a node opens its goal, and one whose goal is gone is not clickable', async () => {
    getWorkspaceItem.mockResolvedValue(storedItem(storedMap));
    const onOpen = jest.fn();
    renderMap({ onOpen });

    const alpha = await screen.findByRole('button', { name: /Alpha goal — Active/ });
    await userEvent.click(alpha);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ _id: 'alpha' }));

    // `ghost` is in the saved map but no longer exists among the goals.
    expect(screen.queryByRole('button', { name: /A goal that was deleted/ })).toBeNull();
    expect(document.querySelectorAll('.goal-map-node.is-gone')).toHaveLength(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('generating replaces the map and reports what came back', async () => {
    generateGoalMapViaBackend.mockResolvedValue({ ok: true, map: storedMap, meta: { saved: true } });
    renderMap();

    await userEvent.click(await screen.findByRole('button', { name: /Generate map/ }));

    expect(generateGoalMapViaBackend).toHaveBeenCalledWith('t');
    expect(await screen.findByText(/Map updated — 3 goals in 2 groups/)).toBeInTheDocument();
    expect(document.querySelectorAll('.goal-map-node')).toHaveLength(3);
    // Waits the whole promise chain out: the button only reads "Update map" and
    // re-enables in the commit that clears the generating flag, so asserting on
    // it also keeps that last state update inside act().
    const button = await screen.findByRole('button', { name: /Update map/ });
    await waitFor(() => expect(button).toBeEnabled());
    expect(document.querySelector('.goal-map-progress')).toBeNull();
  });

  test('a credit limit is reported with the upgrade path, keeping the old map', async () => {
    getWorkspaceItem.mockResolvedValue(storedItem(storedMap));
    const error = new Error('Monthly AI usage limit reached for your plan.');
    error.status = 402;
    error.upgradeUrl = '/pricing';
    generateGoalMapViaBackend.mockRejectedValue(error);
    renderMap();

    await userEvent.click(await screen.findByRole('button', { name: /Update map/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Monthly AI usage limit reached');
    expect(alert.querySelector('a')).toHaveAttribute('href', '/pricing');
    // The snapshot on screen survives a failed update, and the button returns to
    // its resting state (which is also what flushes the promise chain inside act).
    expect(document.querySelectorAll('.goal-map-node')).toHaveLength(3);
    const button = screen.getByRole('button', { name: /Update map/ });
    await waitFor(() => expect(button).toBeEnabled());
  });

  test('says what changed since the map was generated, and says nothing without one', async () => {
    getWorkspaceItem.mockResolvedValue(storedItem(storedMap));
    const { unmount } = renderMap({ goals: [goal('alpha', 'Alpha goal'), goal('beta', 'Beta goal'), goal('new', 'Added later')] });

    const note = await screen.findByText(/1 new goal since this map was made/);
    expect(note).toHaveTextContent(/1 goal in this map is gone/);
    unmount();

    getWorkspaceItem.mockResolvedValue(null);
    renderMap();
    await screen.findByText(/No map yet/);
    expect(document.querySelector('.goal-map-note')).toBeNull();
  });

  test('with no goals it explains itself, hides any stored map and disables the button', async () => {
    getWorkspaceItem.mockResolvedValue(storedItem(storedMap));
    renderMap({ goals: [] });

    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument();
    expect(document.querySelector('svg.goal-map-svg')).toBeNull();
    const button = screen.getByRole('button', { name: /Update map/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Add a goal first');
  });

  test('a corrupt stored map is treated as no map', async () => {
    getWorkspaceItem.mockResolvedValue({ kind: 'map', slug: 'goal-map', content: '{not json' });
    renderMap();

    await waitFor(() => expect(screen.getByText(/No map yet/)).toBeInTheDocument());
    expect(document.querySelector('svg.goal-map-svg')).toBeNull();
  });
});
