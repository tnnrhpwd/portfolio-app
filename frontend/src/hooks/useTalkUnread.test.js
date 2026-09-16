/**
 * useTalkUnread — the count the site chrome shows, and its three rules.
 *
 *   1. one poll per page, however many badges ask for it;
 *   2. no request for a value someone else published seconds ago (the /net rail
 *      and `/talk` publish their own dashboard);
 *   3. nothing thrown at the page when the request fails.
 *
 * Rule 2 is the one that keeps this honest about cost: on `/net` and `/talk` the
 * hook should make NO request at all, which is what the "published" test pins.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

jest.mock('../services/messengerApi.js', () => ({
  getMessengerDirectory: jest.fn(),
}));

// `config/api.js` reads `import.meta.env`, which the Jest transform cannot
// parse — and the redux slice imports it transitively.
jest.mock('../config/api', () => ({
  getApiBase: () => 'http://localhost/api/data/',
  getApiOrigin: () => 'http://localhost',
}));

import { getMessengerDirectory } from '../services/messengerApi.js';
import dataReducer from '../features/data/dataSlice.js';
import useTalkUnread from './useTalkUnread.js';
import { publishTalkUnread, readTalkUnread, resetTalkUnread } from '../utils/talkUnread.js';

const TOKEN = 'jwt-for-me';

const wrapperFor = (token) => {
  const store = configureStore({
    reducer: { data: dataReducer },
    preloadedState: {
      data: {
        ...dataReducer(undefined, { type: '@@INIT' }),
        user: token ? { nickname: 'Me', token } : null,
      },
    },
  });

  return function Wrapper({ children }) {
    return <Provider store={store}>{children}</Provider>;
  };
};

const renderUnread = (token = TOKEN) =>
  renderHook(() => useTalkUnread(), { wrapper: wrapperFor(token) });

beforeEach(() => {
  getMessengerDirectory.mockReset();
  resetTalkUnread();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('adds up what the Talk dashboard reports', async () => {
  getMessengerDirectory.mockResolvedValue({
    contacts: [{ unread: 2 }, { unread: 0 }, { unread: '3' }],
  });

  const { result } = renderUnread();

  expect(result.current).toBe(0);
  await waitFor(() => expect(result.current).toBe(5));
  expect(getMessengerDirectory).toHaveBeenCalledWith(TOKEN);
});

test('reads a dashboard another surface published, without asking again', async () => {
  publishTalkUnread(TOKEN, 4);
  getMessengerDirectory.mockResolvedValue({ contacts: [] });

  const { result } = renderUnread();

  expect(result.current).toBe(4);
  // The freshness check is what makes this true — and it has to survive a tick,
  // not just the first render.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(getMessengerDirectory).not.toHaveBeenCalled();
});

test('publishes what it fetched, so the same page never asks twice', async () => {
  getMessengerDirectory.mockResolvedValue({ contacts: [{ unread: 6 }] });

  const first = renderUnread();
  await waitFor(() => expect(first.result.current).toBe(6));

  // A second consumer — a second badge on the same page.
  const second = renderUnread();
  expect(second.result.current).toBe(6);
  expect(readTalkUnread(TOKEN)).toBe(6);
  expect(getMessengerDirectory).toHaveBeenCalledTimes(1);
});

test('never shows one account the count published for another', async () => {
  publishTalkUnread('someone-elses-jwt', 9);
  getMessengerDirectory.mockResolvedValue({ contacts: [] });

  const { result } = renderUnread();

  expect(result.current).toBe(0);
  await waitFor(() => expect(getMessengerDirectory).toHaveBeenCalled());
  expect(result.current).toBe(0);
});

test('a signed-out visitor asks for nothing', () => {
  const { result } = renderUnread('');

  expect(result.current).toBe(0);
  expect(getMessengerDirectory).not.toHaveBeenCalled();
});

test('a failed request is silent: no throw, no badge, and the last value stays', async () => {
  publishTalkUnread(TOKEN, 2);
  // Push the published value past the freshness window, so the hook has to ask.
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60000);
  getMessengerDirectory.mockRejectedValue(new Error('offline'));

  const { result } = renderUnread();

  await waitFor(() => expect(getMessengerDirectory).toHaveBeenCalled());
  expect(result.current).toBe(2);
});

test('a dashboard with no contacts is 0, not a crash', async () => {
  getMessengerDirectory.mockResolvedValue({});

  const { result } = renderUnread();

  await waitFor(() => expect(getMessengerDirectory).toHaveBeenCalled());
  expect(result.current).toBe(0);
});
