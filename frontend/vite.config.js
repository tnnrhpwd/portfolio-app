import { defineConfig, createLogger } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

// Silence the noisy AggregateError/ECONNREFUSED stack traces that Vite logs
// whenever the backend proxy target isn't reachable yet (e.g. during dev
// server startup before the backend has finished booting, or briefly while
// nodemon restarts it). Vite already responds to the client with a 500, so
// this only affects console output: proxy errors are logged as a single
// concise line instead of a full stack dump.
const logger = createLogger();
const loggerError = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (msg.includes('http proxy error')) {
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
