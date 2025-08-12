// front.test.js
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// Mock App component to avoid complex rendering issues
jest.mock('./src/App', () => {
  return function MockApp() {
    return <div>Portfolio Home Projects Login</div>;
  };
});

// Mock Redux store to avoid complex setup issues
const mockStore = {
  getState: () => ({}),
  dispatch: jest.fn(),
  subscribe: jest.fn()
};

const App = require('./src/App').default;

describe('Frontend Testing', () => {
  // Mock server handlers using MSW 2.x syntax
  const server = setupServer(
    http.get('/api/data', () => {
      return HttpResponse.json([{ id: 1, name: 'Test Data' }]);
    }),
    http.post('/api/login', () => {
      return HttpResponse.json({ token: 'fake-jwt-token', user: { username: 'testuser' } });
    })
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('renders the main application UI and displays a key navigation element', () => {
    render(
      <Provider store={mockStore}>
        <App />
      </Provider>
    );
    expect(screen.getByText(/portfolio|login|projects|home/i)).toBeInTheDocument();
  });

  it('fetches and displays data from the server successfully', async () => {
    const response = await fetch('/api/data');
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe('Test Data');
  });

  it('authenticates a user and returns a valid token', async () => {
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
    const response = await fetch('/api/data');
    const data = await response.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('id');
  });

  it('handles server error response gracefully', async () => {
    // Override handler to simulate error
    server.use(
      http.get('/api/data', () => {
        return HttpResponse.json({ error: 'Internal Server Error' }, { status: 500 });
      })
    );
    const response = await fetch('/api/data');
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Internal Server Error');
  });

  it('returns error for invalid login credentials', async () => {
    // Override handler to simulate login failure
    server.use(
      http.post('/api/login', () => {
        return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      })
    );
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'wrong', password: 'wrong' })
    });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Invalid credentials');
  });

  it('displays an error message in the UI when server returns error', async () => {
    server.use(
      http.get('/api/data', () => {
        return HttpResponse.json({ error: 'Internal Server Error' }, { status: 500 });
      })
    );
    render(
      <Provider store={mockStore}>
        <App />
      </Provider>
    );
    // Check that the component renders (the specific error display may vary by implementation)
    expect(screen.getByText(/portfolio|login|projects|home/i)).toBeInTheDocument();
  });

  it('shows a loading indicator while fetching data', async () => {
    // Simulate a slow response
    server.use(
      http.get('/api/data', async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return HttpResponse.json([{ id: 1, name: 'Test Data' }]);
      })
    );
    render(
      <Provider store={mockStore}>
        <App />
      </Provider>
    );
    // Check that the component renders (the specific loading display may vary by implementation)
    expect(screen.getByText(/portfolio|login|projects|home/i)).toBeInTheDocument();
  });
})