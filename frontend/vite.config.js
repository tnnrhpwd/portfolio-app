import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
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
    proxy: {
      // Proxy API requests to the backend (replaces package.json "proxy" field)
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
