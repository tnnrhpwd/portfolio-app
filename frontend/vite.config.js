import { defineConfig, createLogger } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

// Silence proxy errors that happen while the backend is still booting (e.g.
// nodemon typically takes a second or two to start listening on port 5000),
// since those are expected and resolve themselves. Vite already responds to
// the client with a 500 in this case, so this only affects console output.
// Once the grace period has passed, proxy errors are logged as a single
// concise line instead of the full AggregateError stack dump, since a
// persistent error at that point likely indicates a real problem.
const STARTUP_GRACE_PERIOD_MS = 5000;
const startedAt = Date.now();
const logger = createLogger();
const loggerError = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (msg.includes('http proxy error')) {
    if (Date.now() - startedAt < STARTUP_GRACE_PERIOD_MS) return;
    loggerError(msg.split('\n')[0], options);
    return;
  }
  loggerError(msg, options);
};

export default defineConfig({
  customLogger: logger,
  plugins: [
    react({ include: /\.(jsx|js|tsx|ts)$/ }),
    svgr(), // enables: import { ReactComponent as X } from './icon.svg'
  ],
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
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
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '127.0.0.1',
    proxy: {
      // Proxy API requests to the backend (replaces package.json "proxy" field)
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
