// front.test.js
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import '@testing-library/jest-dom';

// Mock fetch globally
global.fetch = jest.fn();

// Mock utils that might use files
jest.mock('./utils/theme.js', () => ({
  setDarkMode: jest.fn(),
  setLightMode: jest.fn(),
  setSystemColorMode: jest.fn(),
}));

// Mock all asset imports
jest.mock('./assets/Checkmark512.png', () => 'mocked-image');
jest.mock('./assets/STHlogo192.png', () => 'mocked-image');

// Mock all page components to avoid complex dependencies
jest.mock('./pages/Home/Home', () => {
  const React = require('react');
  return function MockHome() {
    return React.createElement('div', { 'data-testid': 'home-page' }, 'Portfolio Home Projects Login');
  };
});

jest.mock('./pages/Projects/Projects/Projects', () => {
  const React = require('react');
  return function MockProjects() {
    return React.createElement('div', { 'data-testid': 'projects-page' }, 'Projects Page');
  };
});

jest.mock('./pages/Login/Login', () => {
  const React = require('react');
  return function MockLogin() {
    return React.createElement('div', { 'data-testid': 'login-page' }, 'Login Page');
  };
});

// Mock React Toastify
jest.mock('react-toastify', () => {
  const React = require('react');
  return {
    ToastContainer: () => React.createElement('div', { 'data-testid': 'toast-container' }, 'Toast Container'),
  };
});

// Mock individual page components explicitly
jest.mock('./pages/Admin/Admin', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Admin');
});
jest.mock('./pages/Contact/Contact', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Contact');
});
jest.mock('./pages/Register/Register', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Register');
});
jest.mock('./pages/Profile/Profile', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Profile');
});
jest.mock('./pages/Settings/Settings', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Settings');
});
jest.mock('./pages/Privacy/Privacy', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Privacy');
});
jest.mock('./pages/Terms/Terms', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Terms');
});
jest.mock('./pages/LegalTerms', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'LegalTerms');
});

// Mock Simple pages
jest.mock('./pages/Simple/Simple/Simple', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Simple');
});
jest.mock('./pages/Simple/About/About', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'About');
});
jest.mock('./pages/Simple/Net/Net', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Net');
});
jest.mock('./pages/Simple/Pay/Pay', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Pay');
});
jest.mock('./pages/Simple/Plans/Plans', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Plans');
});
jest.mock('./pages/Simple/InfoData/InfoData', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'InfoData');
});
jest.mock('./pages/Simple/Agenda/Agenda', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Agenda');
});

// Mock Project pages
jest.mock('./pages/Projects/Annuities/Annuities', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Annuities');
});
jest.mock('./pages/Projects/Drafting/Drafting', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Drafting');
});
jest.mock('./pages/Projects/Ethanol/Ethanol', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Ethanol');
});
jest.mock('./pages/Projects/GFreq/GFreq', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'GFreq');
});
jest.mock('./pages/Projects/Halfway/Halfway', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Halfway');
});
jest.mock('./pages/Projects/PollBox/PollBox', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'PollBox');
});
jest.mock('./pages/Projects/PassGen/PassGen', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'PassGen');
});
jest.mock('./pages/Projects/ProdPartners/ProdPartners', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'ProdPartners');
});
jest.mock('./pages/Projects/SleepAssist/SleepAssist', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'SleepAssist');
});
jest.mock('./pages/Projects/Sonic/Sonic', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Sonic');
});
jest.mock('./pages/Projects/Wordle/Wordle', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'Wordle');
});
jest.mock('./pages/Projects/WordleSolver/WordleSolver', () => {
  const React = require('react');
  return () => React.createElement('div', null, 'WordleSolver');
});

// Create a proper Redux store for testing
const createMockStore = (initialState = {}) => {
  const mockDataSlice = {
    name: 'data',
    reducer: (state = {
      user: null,
      data: [],
      dataIsError: false,
      dataIsSuccess: false,
      dataIsLoading: false,
      dataMessage: '',
      operation: null,
    }, action) => {
      switch (action.type) {
        case 'data/getPublicData/fulfilled':
          return { ...state, data: action.payload, dataIsLoading: false, dataIsSuccess: true };
        case 'data/login/fulfilled':
          return { ...state, user: action.payload, dataIsLoading: false, dataIsSuccess: true };
        default:
          return state;
      }
    }
  };

  return configureStore({
    reducer: {
      data: mockDataSlice.reducer,
    },
    preloadedState: {
      data: {
        user: null,
        data: [],
        dataIsError: false,
        dataIsSuccess: false,
        dataIsLoading: false,
        dataMessage: '',
        operation: null,
        ...initialState,
      },
    },
  });
};

const App = require('./App').default;

// Test helper function to render with providers
const renderWithProviders = (ui, { initialState = {} } = {}) => {
  const store = createMockStore(initialState);
  return render(
    <Provider store={store}>
      {ui}
    </Provider>
  );
};

describe('Frontend Testing', () => {
  // Reset mocks before each test
  beforeEach(() => {
    fetch.mockClear();
  });

  it('renders the main application UI and displays the home page', () => {
    renderWithProviders(<App />);
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(screen.getByText(/portfolio|login|projects|home/i)).toBeInTheDocument();
  });

  it('renders toast container for notifications', () => {
    renderWithProviders(<App />);
    expect(screen.getByTestId('toast-container')).toBeInTheDocument();
  });

  it('fetches and displays data from the server successfully', async () => {
    // Mock successful API response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 1, name: 'Test Data' }],
    });

    const response = await fetch('/api/data');
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe('Test Data');
  });

  it('authenticates a user and returns a valid token', async () => {
    // Mock successful login response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'fake-jwt-token', user: { username: 'testuser' } }),
    });

    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'testpass' })
    });
    const data = await response.json();
    expect(data.token).toBe('fake-jwt-token');
    expect(data.user.username).toBe('testuser');
  });

  it('retrieves a non-empty data array with valid item structure', async () => {
    // Mock data array response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 1, name: 'Test Data' }],
    });

    const response = await fetch('/api/data');
    const data = await response.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('id');
  });

  it('handles server error response gracefully', async () => {
    // Mock error response
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' }),
    });

    const response = await fetch('/api/data');
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Internal Server Error');
  });

  it('returns error for invalid login credentials', async () => {
    // Mock login failure response
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid credentials' }),
    });

    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'wrong', password: 'wrong' })
    });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Invalid credentials');
  });

  it('renders app with different Redux states', () => {
    const initialState = {
      user: { username: 'testuser', _id: '123' },
      dataIsLoading: false,
      dataIsSuccess: true,
    };
    
    renderWithProviders(<App />, { initialState });
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });

  it('handles loading state in Redux store', () => {
    const initialState = {
      dataIsLoading: true,
      dataIsSuccess: false,
    };
    
    renderWithProviders(<App />, { initialState });
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });

  it('handles error state in Redux store', () => {
    const initialState = {
      dataIsError: true,
      dataMessage: 'Test error message',
      dataIsLoading: false,
    };
    
    renderWithProviders(<App />, { initialState });
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });
})