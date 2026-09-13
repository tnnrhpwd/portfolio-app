/**
 * AdminLayout — the console's access gate and its view switcher.
 *
 * Two levels of access, and both halves of "Special" are load-bearing:
 *
 *   - the *tab row* hides the views a Special account can't open, so it is never
 *     offered a link that would only 403 (`backend/middleware/adminAccess.js` is
 *     the real boundary, this is the mirror);
 *   - the *gate* bounces anyone else off `/admin` entirely.
 *
 * The subtle case these tests exist for: a tag an admin applies to an account
 * that is **already signed in**. The flag rides on the login response, so the
 * stored user object still says `false`, and without the live `/usage` question
 * the console hides everything from an account that has every right to be there.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

jest.mock('../../components/Header/Header.jsx', () => () => <div>HEADER</div>);
jest.mock('../../components/Footer/Footer.jsx', () => () => <div>FOOTER</div>);
jest.mock('../../components/SEO/SEO.jsx', () => () => null);
jest.mock('react-toastify', () => ({ toast: { error: jest.fn() } }));
jest.mock('../../features/data/dataService.js', () => ({
  __esModule: true,
  default: { getUserUsage: jest.fn() },
}));

import dataService from '../../features/data/dataService.js';
import { toast } from 'react-toastify';
import dataReducer from '../../features/data/dataSlice.js';
import AdminLayout from './AdminLayout.jsx';

const ADMIN_ID = '6770a067c725cbceab958619';
const ADMIN = { _id: ADMIN_ID, nickname: 'Owner', isAdmin: true, isSpecial: false, token: 't' };
const SPECIAL = { _id: 'helper-1', nickname: 'Helper', isAdmin: false, isSpecial: true, token: 't' };
const PLAIN = { _id: 'ordinary-1', nickname: 'Priya', isAdmin: false, isSpecial: false, token: 't' };

const makeStore = (user) =>
  configureStore({
    reducer: { data: dataReducer },
    preloadedState: { data: { ...dataReducer(undefined, { type: '@@INIT' }), user } },
  });

const renderConsole = (user) => {
  const store = makeStore(user);
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/" element={<div>HOME PAGE</div>} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<div>DASHBOARD VIEW</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
};

const tabNames = () =>
  screen.queryAllByRole('link').map((a) => a.textContent.replace(/\s+/g, '')).filter((t) => t && !t.startsWith('↗'));

const adminViewsNav = () => screen.queryByRole('navigation', { name: 'Admin views' });

beforeEach(() => {
  jest.clearAllMocks();
  dataService.getUserUsage.mockResolvedValue({ membership: 'Free' });
});

describe('AdminLayout — the admin account', () => {
  it('gets every view in the switcher', async () => {
    renderConsole(ADMIN);
    expect(await screen.findByText('DASHBOARD VIEW')).toBeInTheDocument();
    const tabs = tabNames();
    expect(tabs).toEqual(
      expect.arrayContaining(['📊Dashboard', '👥Users', '🗺️Visitors', '🧪Funnel'])
    );
    expect(tabs).toHaveLength(9);
    // Nothing to ask the server: the flag is already decided.
    expect(dataService.getUserUsage).not.toHaveBeenCalled();
  });
});

describe('AdminLayout — a Special account', () => {
  it('is offered only the four views it may open', async () => {
    renderConsole(SPECIAL);
    expect(await screen.findByText('DASHBOARD VIEW')).toBeInTheDocument();
    expect(tabNames()).toEqual(['📊Dashboard', '🗺️Visitors', '⭐Reviews', '📈Rankings']);
  });

  it('hides the views it may not open, rather than offering a link that 403s', async () => {
    renderConsole(SPECIAL);
    await screen.findByText('DASHBOARD VIEW');
    expect(screen.queryByText('👥Users')).not.toBeInTheDocument();
    expect(screen.queryByText('🗄️Data')).not.toBeInTheDocument();
    expect(screen.queryByText('🏷️Hometitle')).not.toBeInTheDocument();
    expect(screen.queryByText('🧪Funnel')).not.toBeInTheDocument();
  });

  it('says so in the toolbar', async () => {
    renderConsole(SPECIAL);
    expect(await screen.findByText(/Special access/)).toBeInTheDocument();
  });
});

describe('AdminLayout — an ordinary account', () => {
  it('asks the server once, then bounces home when the answer is "not Special"', async () => {
    renderConsole(PLAIN);
    expect(await screen.findByText('HOME PAGE')).toBeInTheDocument();
    expect(adminViewsNav()).not.toBeInTheDocument();
    expect(dataService.getUserUsage).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Only admin are allowed to use that URL.');
  });

  it('lets a tag applied *after* sign-in through without a re-login', async () => {
    // The stored user says isSpecial:false — the login response predates the tag.
    // `/usage` is the live answer, and it also raises the cached flag so the
    // dropper's Admin link appears for the rest of the session.
    dataService.getUserUsage.mockResolvedValue({ membership: 'Special', isSpecial: true });
    const store = renderConsole(PLAIN);
    expect(await screen.findByText('DASHBOARD VIEW')).toBeInTheDocument();
    expect(tabNames()).toEqual(['📊Dashboard', '🗺️Visitors', '⭐Reviews', '📈Rankings']);
    expect(store.getState().data.user.isSpecial).toBe(true);
  });

  it('renders nothing while the answer is still in flight, so the bounce cannot fire early', async () => {
    let resolveUsage;
    dataService.getUserUsage.mockReturnValue(new Promise((r) => { resolveUsage = r; }));
    renderConsole(PLAIN);
    await waitFor(() => expect(dataService.getUserUsage).toHaveBeenCalled());
    expect(adminViewsNav()).not.toBeInTheDocument();
    expect(screen.queryByText('HOME PAGE')).not.toBeInTheDocument();

    resolveUsage({ membership: 'Special', isSpecial: true });
    expect(await screen.findByText('DASHBOARD VIEW')).toBeInTheDocument();
  });

  it('stops waiting when the check fails, instead of leaving a blank console', async () => {
    dataService.getUserUsage.mockRejectedValue(new Error('offline'));
    renderConsole(PLAIN);
    expect(await screen.findByText('HOME PAGE')).toBeInTheDocument();
  });

  it('is asked to log in when nobody is signed in', async () => {
    renderConsole(null);
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument();
    expect(dataService.getUserUsage).not.toHaveBeenCalled();
  });
});
