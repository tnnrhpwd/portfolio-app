/**
 * HeaderDropper — where the unread count is first seen.
 *
 * The drawer is the only place most pages name Talk, so the badge on its Talk
 * link is the feature's front door: a signed-in account with unread messages
 * gets a count, and everyone else (no messages, signed out) gets nothing at all
 * in that spot.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

jest.mock('../../services/messengerApi.js', () => ({
  getMessengerDirectory: jest.fn(),
}));

// `config/api.js` reads `import.meta.env`, which the Jest transform cannot
// parse — and the redux slice imports it transitively.
jest.mock('../../config/api', () => ({
  getApiBase: () => 'http://localhost/api/data/',
  getApiOrigin: () => 'http://localhost',
}));

import { getMessengerDirectory } from '../../services/messengerApi.js';
import dataReducer from '../../features/data/dataSlice.js';
import HeaderDropper from './HeaderDropper.jsx';
import { publishTalkUnread, resetTalkUnread } from '../../utils/talkUnread.js';

const TOKEN = 'jwt-for-me';
const USER = { _id: 'me-1', nickname: 'Me', token: TOKEN };

const renderDropper = (user) => {
  const store = configureStore({
    reducer: { data: dataReducer },
    preloadedState: {
      data: { ...dataReducer(undefined, { type: '@@INIT' }), user },
    },
  });

  render(
    <Provider store={store}>
      <MemoryRouter>
        <HeaderDropper colTheme="light-theme" handleThemeToggle={() => {}} />
      </MemoryRouter>
    </Provider>
  );
};

const talkLink = () => screen.getByRole('link', { name: /Talk/ });

beforeEach(() => {
  getMessengerDirectory.mockReset();
  resetTalkUnread();
});

test('counts the unread messages on the drawer’s Talk link', async () => {
  getMessengerDirectory.mockResolvedValue({
    contacts: [{ unread: 3 }, { unread: 0 }],
  });

  renderDropper(USER);

  expect(talkLink()).toHaveTextContent('Talk');
  await waitFor(() => expect(within(talkLink()).getByText('3')).toBeInTheDocument());
  expect(within(talkLink()).getByLabelText('3 unread messages')).toBeInTheDocument();
});

test('shows no badge when the count is zero', async () => {
  getMessengerDirectory.mockResolvedValue({ contacts: [{ unread: 0 }] });

  renderDropper(USER);

  await waitFor(() => expect(getMessengerDirectory).toHaveBeenCalled());
  expect(within(talkLink()).queryByLabelText(/unread message/)).not.toBeInTheDocument();
});

test('a visitor who is not signed in gets no Talk link at all, and no request', () => {
  renderDropper(null);

  // The whole Workspace group (Talk included) is signed-in only, so there is
  // nothing to badge and nothing worth asking the server about.
  expect(screen.queryByRole('link', { name: /Talk/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/unread message/)).not.toBeInTheDocument();
  expect(getMessengerDirectory).not.toHaveBeenCalled();
});

test('a link into Talk is still a link into Talk when the count fails to load', async () => {
  getMessengerDirectory.mockRejectedValue(new Error('offline'));

  renderDropper(USER);

  await waitFor(() => expect(getMessengerDirectory).toHaveBeenCalled());
  expect(talkLink()).toHaveAttribute('href', '/talk');
});
