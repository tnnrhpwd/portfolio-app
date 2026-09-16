import { defineConfig, createLogger } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

// Silence proxy errors that happen while the backend is still booting (e.g.
// nodemon typically takes a second or two to start listening on port 5000),
// since those are expected and resolve themselves. Vite already responds to
// the client with a 500 in this case, so this only affects console output.
//
// Connection-level errors (ECONNREFUSED while the backend is booting or a
// nodemon restart is in progress, ECONNRESET when it dies mid-request) are
// transient by nature during development — the bootstrap requests in the app
// retry automatically, so we suppress them entirely rather than spamming the
// console. Any other proxy error is logged as a single concise line instead
// of the full stack dump, since a persistent error at that point likely
// indicates a real problem.
const STARTUP_GRACE_PERIOD_MS = 5000;
const TRANSIENT_PROXY_ERROR = /ECONNREFUSED|ECONNRESET|ECONNABORTED|socket hang up/i;
const startedAt = Date.now();
const logger = createLogger();
const loggerError = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (msg.includes('http proxy error')) {
    if (Date.now() - startedAt < STARTUP_GRACE_PERIOD_MS) return;
    const err = options?.error;
    const detail = `${err?.code || ''} ${err?.message || ''}`;
    if (TRANSIENT_PROXY_ERROR.test(detail)) return;
    loggerError(msg.split('\n')[0], options);
    return;
  }
  loggerError(msg, options);
};

// Which browser an EXPLICIT `--open` launches. Vite's opener (the one derived
// from CRA) only accepts a boolean/path through `server.open`, so the browser
// itself is named via BROWSER. Left alone, an existing BROWSER wins — set
// `BROWSER=none` to skip the window entirely, or e.g. `BROWSER=chrome`.
// This line opens nothing by itself: see `server.open` below.
if (!process.env.BROWSER) process.env.BROWSER = 'msedge';

export default defineConfig({
  customLogger: logger,
  plugins: [
    react({ include: /\.(jsx|js|tsx|ts)$/ }),
    svgr(), // enables: import { ReactComponent as X } from './icon.svg'
  ],
  esbuild: {
    // `tsx` parses both TypeScript (strips types) and JSX (used by .js files
    // that contain JSX, which the React plugin leaves to esbuild in builds).
    loader: 'tsx',
    include: /src\/.*\.(jsx?|tsx?)$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  build: {
    outDir: 'build', // match CRA output dir so Netlify config stays the same
    sourcemap: false, // disable sourcemaps in production for smaller deploy
    target: 'es2020', // modern browsers only – smaller output, native async/await
    cssMinify: 'lightningcss', // faster & smaller CSS minification
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          redux: ['@reduxjs/toolkit', 'react-redux'],
          charts: ['chart.js', 'react-chartjs-2'],
          // Phaser is huge (~1.4 MB) and only used by the Coliseum route,
          // which lazy-loads it. Its own chunk lets the browser cache it
          // independently and keeps it out of every other route's graph.
          phaser: ['phaser'],
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '127.0.0.1',
    // Opening a window is opt-in per command, not a property of the server.
    // Every fresh `vite` process used to claim a tab — a restart of the stack, a
    // VS Code task, a spare copy that fell back to another port — which is the
    // noise this avoids. Only the repo-root `npm start` asks for a tab now, by
    // passing the CLI's `--open` through `frontend`'s `start:open` script; a CLI
    // flag outranks this file, so that one command opens and nothing else does.
    // (Vite never re-opens on its own internal restart either.)
    open: false,
    proxy: {
      // Proxy API requests to the backend (replaces package.json "proxy" field).
      // Use 127.0.0.1 (not localhost) to avoid IPv6 (::1) resolution ambiguity
      // on Windows, which can otherwise cause ECONNREFUSED proxy errors.
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
});
