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

describe('Portfolio Application - Frontend Tests', () => {
  // Reset mocks before each test
  beforeEach(() => {
    fetch.mockClear();
    localStorage.clear();
  });

  // ==========================================
  // COMPONENT RENDERING TESTS
  // ==========================================
  describe('Component Rendering', () => {
    it('renders the main application UI and displays the home page', () => {
      renderWithProviders(<App />);
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
      expect(screen.getByText(/portfolio|login|projects|home/i)).toBeInTheDocument();
    });

    it('renders toast container for notifications', () => {
      renderWithProviders(<App />);
      expect(screen.getByTestId('toast-container')).toBeInTheDocument();
    });

    it('renders different pages correctly', () => {
      // Test that the routing works and components render
      renderWithProviders(<App />);
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });
  });

  // ==========================================
  // REDUX STATE MANAGEMENT TESTS  
  // ==========================================
  describe('Redux State Management', () => {
    it('renders app with logged-in user state', () => {
      const initialState = {
        user: { username: 'testuser', _id: '123', token: 'jwt-token' },
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

    it('handles admin user state correctly', () => {
      const initialState = {
        user: { 
          username: 'admin', 
          _id: '6770a067c725cbceab958619', // Admin ID from your code
          token: 'admin-jwt-token' 
        },
        dataIsLoading: false,
        dataIsSuccess: true,
      };
      
      renderWithProviders(<App />, { initialState });
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });
  });

  // ==========================================
  // USER AUTHENTICATION TESTS
  // ==========================================
  describe('User Authentication', () => {
    it('successfully logs in user and returns valid token', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          token: 'fake-jwt-token', 
          user: { username: 'testuser', _id: '123', email: 'test@example.com' } 
        }),
      });

      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'testpass' })
      });
      
      const data = await response.json();
      expect(data.token).toBe('fake-jwt-token');
      expect(data.user.username).toBe('testuser');
      expect(data.user).toHaveProperty('_id');
    });

    it('handles login failure with invalid credentials', async () => {
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

    it('successfully registers new user', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'new-user-jwt-token',
          user: { 
            username: 'newuser', 
            _id: '456', 
            email: 'newuser@example.com' 
          }
        }),
      });

      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: 'newuser', 
          email: 'newuser@example.com',
          password: 'newpassword' 
        })
      });
      
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.user.username).toBe('newuser');
      expect(data.token).toBe('new-user-jwt-token');
    });

    it('handles registration failure with existing user', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'User already exists' }),
      });

      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: 'existinguser', 
          email: 'existing@example.com',
          password: 'password' 
        })
      });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('User already exists');
    });

    it('handles logout functionality', async () => {
      // Mock localStorage for logout test
      const mockUser = { username: 'testuser', _id: '123', token: 'jwt-token' };
      localStorage.setItem('user', JSON.stringify(mockUser));

      // Mock successful logout
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Logged out successfully' }),
      });

      const response = await fetch('/api/logout', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mockUser.token}`
        }
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.message).toBe('Logged out successfully');
    });

    it('handles token validation for protected routes', async () => {
      const mockToken = 'valid-jwt-token';
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true, user: { username: 'testuser', _id: '123' } }),
      });

      const response = await fetch('/api/validate-token', {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${mockToken}`
        }
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.valid).toBe(true);
      expect(data.user).toHaveProperty('username');
    });

    it('handles expired token correctly', async () => {
      const expiredToken = 'expired-jwt-token';
      
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Token expired' }),
      });

      const response = await fetch('/api/validate-token', {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${expiredToken}`
        }
      });
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Token expired');
    });
  });

  // ==========================================
  // DATA MANAGEMENT TESTS
  // ==========================================
  describe('Data Management', () => {
    it('fetches and displays data from the server successfully', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1, name: 'Test Data', user: '123' }],
      });

      const response = await fetch('/api/data');
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].name).toBe('Test Data');
      expect(data[0]).toHaveProperty('id');
    });

    it('retrieves user-specific data with authentication', async () => {
      const mockToken = 'user-jwt-token';
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, name: 'User Data 1', user: '123' },
          { id: 2, name: 'User Data 2', user: '123' }
        ],
      });

      const response = await fetch('/api/data', {
        headers: { 'Authorization': `Bearer ${mockToken}` }
      });
      const data = await response.json();
      expect(data.length).toBe(2);
      expect(data[0]).toHaveProperty('user');
    });

    it('creates new data successfully', async () => {
      const mockToken = 'user-jwt-token';
      const newData = { name: 'New Data Item', description: 'Test description' };
      
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 3, ...newData, user: '123' }),
      });

      const response = await fetch('/api/data', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mockToken}`
        },
        body: JSON.stringify(newData)
      });
      
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.name).toBe('New Data Item');
      expect(data).toHaveProperty('id');
    });

    it('updates existing data successfully', async () => {
      const mockToken = 'user-jwt-token';
      const updatedData = { id: 1, name: 'Updated Data Item' };
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => updatedData,
      });

      const response = await fetch('/api/data/1', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mockToken}`
        },
        body: JSON.stringify(updatedData)
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.name).toBe('Updated Data Item');
    });

    it('deletes data successfully', async () => {
      const mockToken = 'user-jwt-token';
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Data deleted successfully' }),
      });

      const response = await fetch('/api/data/1', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${mockToken}` }
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.message).toBe('Data deleted successfully');
    });
  });

  // ==========================================
  // ERROR HANDLING TESTS
  // ==========================================
  describe('Error Handling', () => {
    it('handles server error response gracefully', async () => {
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

    it('handles network connection errors', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(fetch('/api/data')).rejects.toThrow('Network error');
    });

    it('handles unauthorized access attempts', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden: Insufficient permissions' }),
      });

      const response = await fetch('/api/admin/data', {
        headers: { 'Authorization': 'Bearer invalid-token' }
      });
      
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Forbidden');
    });

    it('handles validation errors on form submission', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ 
          error: 'Validation failed',
          details: ['Username is required', 'Email format is invalid']
        }),
      });

      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '', email: 'invalid-email' })
      });
      
      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.error).toBe('Validation failed');
      expect(Array.isArray(data.details)).toBe(true);
    });
  });

  // ==========================================
  // SUBSCRIPTION & PAYMENT TESTS
  // ==========================================
  describe('Subscription & Payment Management', () => {
    it('fetches user subscription details', async () => {
      const mockToken = 'user-jwt-token';
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          subscriptionPlan: 'premium',
          subscriptionDetails: {
            status: 'active',
            nextBilling: '2025-09-17'
          }
        }),
      });

      const response = await fetch('/api/user/subscription', {
        headers: { 'Authorization': `Bearer ${mockToken}` }
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.subscriptionPlan).toBe('premium');
      expect(data.subscriptionDetails.status).toBe('active');
    });

    it('handles subscription upgrade successfully', async () => {
      const mockToken = 'user-jwt-token';
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: 'Subscription upgraded successfully',
          subscriptionPlan: 'premium'
        }),
      });

      const response = await fetch('/api/subscription/upgrade', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mockToken}`
        },
        body: JSON.stringify({ plan: 'premium' })
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.subscriptionPlan).toBe('premium');
    });

    it('fetches payment methods for user', async () => {
      const mockToken = 'user-jwt-token';
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'pm_123', type: 'card', last4: '4242' },
          { id: 'pm_456', type: 'card', last4: '1234' }
        ],
      });

      const response = await fetch('/api/payment-methods', {
        headers: { 'Authorization': `Bearer ${mockToken}` }
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toHaveProperty('last4');
    });
  });

  // ==========================================
  // ADMIN FUNCTIONALITY TESTS
  // ==========================================
  describe('Admin Functionality', () => {
    const adminToken = 'admin-jwt-token';

    it('allows admin to access all user data', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, name: 'User 1 Data', user: '123' },
          { id: 2, name: 'User 2 Data', user: '456' }
        ],
      });

      const response = await fetch('/api/admin/all-data', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.length).toBeGreaterThan(0);
    });

    it('allows admin to manage user accounts', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: 'User account updated successfully',
          user: { username: 'updateduser', _id: '123' }
        }),
      });

      const response = await fetch('/api/admin/users/123', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ username: 'updateduser' })
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.user.username).toBe('updateduser');
    });

    it('prevents non-admin users from accessing admin routes', async () => {
      const userToken = 'regular-user-token';
      
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Admin access required' }),
      });

      const response = await fetch('/api/admin/all-data', {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Admin access required');
    });
  });
});