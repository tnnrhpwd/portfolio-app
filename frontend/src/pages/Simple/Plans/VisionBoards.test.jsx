import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import VisionBoards from './VisionBoards.jsx';

jest.mock('../../../services/visionBoardApi.js', () => ({
  generateVisionBoards: jest.fn(),
  listVisionBoards: jest.fn(),
  deleteVisionBoard: jest.fn(),
}));

jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line import/first
import { toast } from 'react-toastify';
// eslint-disable-next-line import/first
import { generateVisionBoards, listVisionBoards, deleteVisionBoard } from '../../../services/visionBoardApi.js';

/** One stored board, as the workspace list returns it. */
const board = (over = {}) => {
  const record = {
    version: 1,
    scope: 'dream',
    source: {
      total: 6,
      used: 3,
      truncated: 0,
      goals: [{ slug: 'retire', title: 'Retire by the coast', horizon: 'life' }],
    },
    prompt: 'A wide empty beach at golden hour, a small boat at the tideline.',
    promptSource: 'model',
    image: { url: 'https://cdn.example/board.png', s3Key: 'users/u1/generated/board.png', bytes: 1000, recordId: 'r1' },
    generatedAt: '2026-09-16T10:00:00.000Z',
    ...over,
  };
  return {
    kind: 'vision',
    slug: 'board-20260916-100000-dreams-ab',
    name: 'Vision board — dreams',
    updatedAt: '2026-09-16T10:00:05.000Z',
    content: JSON.stringify(record),
  };
};

const renderPanel = (props = {}) => render(
  <MemoryRouter>
    <VisionBoards
      token="t"
      dreamCount={4}
      allCount={9}
      open={false}
      onOpenChange={jest.fn()}
      {...props}
    />
  </MemoryRouter>,
);

beforeEach(() => {
  jest.clearAllMocks();
  listVisionBoards.mockResolvedValue([]);
  generateVisionBoards.mockResolvedValue({ boards: [board()], skipped: [], failures: [], meta: {} });
  deleteVisionBoard.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('VisionBoards · the history', () => {
  test('renders the stored boards, newest first, and spends nothing to do it', async () => {
    listVisionBoards.mockResolvedValue([
      board({ generatedAt: '2026-09-01T10:00:00.000Z' }),
      board({ generatedAt: '2026-09-16T10:00:00.000Z', scope: 'all' }),
    ]);
    renderPanel();

    expect(await screen.findByRole('region', { name: 'Vision boards' })).toBeInTheDocument();
    // Both caps, and the scope is what tells them apart.
    const cards = await screen.findAllByRole('button', { name: /Open Vision board/ });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAccessibleName(/All goals/);
    expect(screen.getByText('2 boards')).toBeInTheDocument();
    // Reading the gallery must never generate.
    expect(generateVisionBoards).not.toHaveBeenCalled();
  });

  test('with no boards and no dialog open, the panel says nothing at all', async () => {
    renderPanel();

    await waitFor(() => expect(listVisionBoards).toHaveBeenCalledWith('t'));
    expect(screen.queryByRole('region', { name: 'Vision boards' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a corrupt record is skipped instead of breaking the gallery', async () => {
    listVisionBoards.mockResolvedValue([
      { kind: 'vision', slug: 'broken', name: 'x', content: '{not json' },
      board(),
    ]);
    renderPanel();

    expect(await screen.findAllByRole('button', { name: /Open Vision board/ })).toHaveLength(1);
  });

  test('no token means no request', async () => {
    renderPanel({ token: null });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Vision boards' })).toBeNull());
    expect(listVisionBoards).not.toHaveBeenCalled();
  });
});

describe('VisionBoards · making one', () => {
  test('the dialog leads with dreams, states the cost, and can be told to use everything', async () => {
    renderPanel({ open: true });

    const dialog = screen.getByRole('dialog', { name: /Make a vision board/ });
    expect(dialog).toBeInTheDocument();
    // Dream goals are the default source.
    expect(screen.getByRole('checkbox', { name: /Dreams/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /All goals/ })).not.toBeChecked();
    expect(screen.getByText('1 image · 1 credit')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /All goals/ }));
    expect(screen.getByText('2 images · 2 credits')).toBeInTheDocument();
  });

  test('a scope with no goals behind it cannot be picked', async () => {
    renderPanel({ open: true, dreamCount: 0 });
    // Dreams are empty, so the dialog starts on the source that exists…
    expect(screen.getByRole('checkbox', { name: /Dreams/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /All goals/ })).toBeChecked();
    // …and says so on the row rather than in the cost line: the cost line talks
    // about what is about to be drawn, and an unpicked scope draws nothing.
    expect(screen.getByText('nothing here yet')).toBeInTheDocument();
    expect(screen.getByText('1 image · 1 credit')).toBeInTheDocument();
  });

  test('making a board sends the scopes and the steer, reloads, and closes', async () => {
    const onOpenChange = jest.fn();
    renderPanel({ open: true, onOpenChange });

    await userEvent.type(screen.getByLabelText(/Anything to add/), 'film photography');
    await userEvent.click(screen.getByRole('button', { name: /Make my board/ }));

    await waitFor(() => expect(generateVisionBoards).toHaveBeenCalledWith('t', ['dream'], { hint: 'film photography' }));
    // The list is re-read rather than spliced: the server decides what was saved.
    await waitFor(() => expect(listVisionBoards).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Made 1 board/));
  });

  test('being out of credits is shown in the dialog, with a way to fix it', async () => {
    const err = new Error('Not enough image credits for a vision board.');
    err.status = 402;
    err.requiresUpgrade = true;
    err.upgradeUrl = '/pricing';
    generateVisionBoards.mockRejectedValue(err);
    const onOpenChange = jest.fn();
    renderPanel({ open: true, onOpenChange });

    await userEvent.click(screen.getByRole('button', { name: /Make my board/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not enough image credits');
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/pricing');
    // The dialog stays open and the button comes back, so the choice can change.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Make my board/ })).toBeEnabled();
  });

  test('a scope with nothing in it is explained instead of closing on nothing', async () => {
    generateVisionBoards.mockResolvedValue({
      boards: [],
      skipped: [{ scope: 'dream', reason: 'scope-empty' }],
      failures: [],
      meta: {},
    });
    const onOpenChange = jest.fn();
    renderPanel({ open: true, onOpenChange });

    await userEvent.click(screen.getByRole('button', { name: /Make my board/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/none of your goals are on that list yet/);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('VisionBoards · one board at full size', () => {
  test('opening a board shows its prompt and what it was made from', async () => {
    listVisionBoards.mockResolvedValue([board()]);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /Open Vision board/ }));

    const lightbox = screen.getByRole('dialog', { name: /Vision board .* Dreams/ });
    expect(lightbox).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retire by the coast' })).toHaveAttribute('href', '/plans/goal/retire');
    // The prompt is provenance and is one click away, not in the way.
    await userEvent.click(screen.getByText('How this picture was described'));
    expect(screen.getByText(/A wide empty beach at golden hour/)).toBeInTheDocument();
  });

  test('deleting a board asks first, then removes it for good', async () => {
    listVisionBoards.mockResolvedValue([board()]);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /Open Vision board/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete board' }));

    // Deleting is destructive and irreversible, so it has its own confirmation.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(deleteVisionBoard).not.toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete board' })[1]);

    await waitFor(() => expect(deleteVisionBoard).toHaveBeenCalledWith('t', 'board-20260916-100000-dreams-ab'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Board deleted');
  });

  test('cancelling the confirmation deletes nothing', async () => {
    listVisionBoards.mockResolvedValue([board()]);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /Open Vision board/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete board' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(deleteVisionBoard).not.toHaveBeenCalled();
  });
});
