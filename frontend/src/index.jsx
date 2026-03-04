import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './app/store';
import App from './App';
import { initWebVitals } from './utils/webVitals';
import { warmBackend } from './utils/warmBackend';
import './index.css';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);

// ── Post-render performance & warming ──────────────────────
initWebVitals();   // collect Core Web Vitals (LCP, FID, CLS, FCP, TTFB)
warmBackend();     // fire-and-forget ping to wake the Render backend
