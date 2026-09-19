/**
 * dev-preview.js — open the addon's renderer pages in a normal browser, with live reload.
 *
 *   npm run addon                     (from the repo root)
 *   npm run preview                   (from simple-addon/)
 *   node scripts/dev-preview.js --help
 *
 * WHY THIS EXISTS
 *   The dashboard, calibration screen and eye overlay are `file://` pages loaded by
 *   Electron, and they cannot run in a browser on their own for two reasons:
 *
 *     1. Each one calls into the preload bridge (`window.simpleDashboard` etc.) at module
 *        scope, so the FIRST such call throws and every line after it in the page's script
 *        never runs — the page looks broken rather than unstubbed.
 *     2. `file://` pages are not reloadable-on-change by anything, and Chromium refuses
 *        module scripts from `file://`, which is why the addon's own JS is classic scripts.
 *
 *   So this serves `renderer/` over HTTP on loopback and injects a small shim ahead of the
 *   page's own scripts. That gives a live-editable view of the real markup, the real
 *   stylesheets and the real DOM logic — edit a CSS value or a panel and the browser
 *   reloads itself. No `npm start`, no Electron, no build, no release.
 *
 * WHAT IT IS NOT
 *   It is not the app. The shim returns empty responses for everything that goes over IPC
 *   (device lists, Python status, gaze streams), so those panels render their empty state.
 *   Panels that go through the local HTTP server instead — the dashboard's status,
 *   permissions, skills, marketplace, appearance — show REAL data whenever the tray app is
 *   running, because the addon's CORS allowlist accepts any `127.0.0.1`/`localhost` origin.
 *
 * ⚠️ The shim is only ever injected by this server, into pages this server is serving. It is
 * never part of the shipped addon: nothing under `renderer/` references it, and the packaged
 * app loads those same files straight from disk.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const SHIM_PATH = '/__dev/shim.js';
const EVENTS_PATH = '/__dev/events';

/** Pages worth printing at startup. Any file under `renderer/` is served, these are just
 *  the three the app actually opens. */
const KNOWN_PAGES = [
  { file: 'dashboard.html', what: 'Dashboard (the main window)' },
  { file: 'chat.html', what: 'Chat (the agent conversation, a mirror of /net)' },
  { file: 'calibration.html', what: 'Eye-tracking calibration (fullscreen)' },
  { file: 'eye-overlay.html', what: 'Gaze overlay (transparent, drawn over the desktop)' },
];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const opts = { port: Number(process.env.ADDON_PREVIEW_PORT) || 4173, page: 'dashboard.html', open: true, addonPort: process.env.ADDON_PORT || '3001' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--port') opts.port = Number(argv[++i]);
    else if (arg === '--page') opts.page = String(argv[++i] || opts.page);
    else if (arg === '--addon-port') opts.addonPort = String(argv[++i] || opts.addonPort);
  }
  return opts;
}

const HELP = `
Addon dev preview — the renderer pages in a browser, with live reload.

  --port <n>        port to serve on            (default 4173)
  --page <file>     page to open first          (default dashboard.html)
  --addon-port <n>  port the tray app is on     (default 3001)
  --no-open         don't launch a browser
  --help, -h        this text

Edits under simple-addon/renderer/ reload the page automatically.
`;

/**
 * The shim: a stand-in for the Electron preload bridges, plus a live-reload client.
 *
 * The bridges are Proxies rather than hand-written stubs so the page can call something
 * nobody thought of and still not throw. Three shapes, by method name:
 *   `on*`      → a subscription: returns an unsubscribe function (the pages call the
 *                returned value to clean up, so it has to BE a function)
 *   `get*`     → a promise resolving to `[]` for the ones that return collections (the
 *                pages `.map`/`.forEach` them), `{}` otherwise
 *   anything   → a promise resolving to `{}`
 */
const SHIM = `
(function () {
  'use strict';
  var ARRAY_METHODS = ['getCameras', 'getDisplays', 'listDevices'];

  function makeBridge(label) {
    return new Proxy({}, {
      get: function (_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === '__isDevShim') return true;
        if (prop.indexOf('on') === 0 && prop[2] === prop[2].toUpperCase()) {
          return function () { return function () {}; };
        }
        return function () {
          if (ARRAY_METHODS.indexOf(prop) !== -1) return Promise.resolve([]);
          return Promise.resolve({});
        };
      },
      has: function () { return true; },
    });
  }

  window.simpleDashboard = makeBridge('simpleDashboard');
  window.simpleChat = makeBridge('simpleChat');
  window.calibrationAPI = makeBridge('calibrationAPI');
  window.eyeOverlayAPI = makeBridge('eyeOverlayAPI');

  // Unmistakable in a tab strip — this is never the real app.
  if (document.title.indexOf('[dev] ') !== 0) document.title = '[dev] ' + document.title;

  console.info('%c[dev preview]', 'color:#0ab;font-weight:bold',
    'IPC bridges are stubbed: panels fed over IPC show empty state; anything the local server answers is real.');

  // Live reload. Server-Sent Events, so no polling and no dependency.
  try {
    var source = new EventSource('${EVENTS_PATH}');
    source.addEventListener('reload', function () { window.location.reload(); });
    source.addEventListener('error', function () { /* server gone (or restarted): reload to reconnect */ });
  } catch (e) {
    console.warn('[dev preview] live reload unavailable:', e && e.message);
  }
})();
`;

/** Inject the shim as the FIRST thing in the document, so it is defined before any of the
 *  page's own scripts run — that ordering is the whole point (see the header). */
function injectShim(html) {
  const tag = `<script src="${SHIM_PATH}"></script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${tag}${html.slice(at)}`;
  }
  return `${tag}\n${html}`;
}

const clients = new Set();

function broadcastReload(file) {
  for (const res of clients) {
    try { res.write(`event: reload\ndata: ${file}\n\n`); } catch { /* dropped client */ }
  }
}

/** Watch the whole renderer tree (the appearance module lives in a subfolder). */
function watchRenderer() {
  let timer = null;
  try {
    const watcher = fs.watch(RENDERER_DIR, { recursive: true }, (_event, filename) => {
      if (!filename || filename.endsWith('~') || filename.endsWith('.tmp')) return;
      clearTimeout(timer);
      // Debounce: a single editor save can fire several events.
      timer = setTimeout(() => {
        const changed = String(filename);
        console.log(`  ↻ ${changed}`);
        broadcastReload(changed);
      }, 80);
    });
    watcher.on('error', (err) => console.warn('[dev preview] watcher error:', err.message));
  } catch (err) {
    console.warn('[dev preview] live reload disabled (cannot watch renderer/):', err.message);
  }
}

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? 'dashboard.html' : decoded.replace(/^\/+/, '');
  const full = path.resolve(RENDERER_DIR, rel);
  // Path traversal guard: the resolved file must stay inside renderer/.
  if (full !== RENDERER_DIR && !full.startsWith(RENDERER_DIR + path.sep)) return null;
  return full;
}

function serveFile(req, res, urlPath) {
  let full = resolveRequestPath(urlPath);
  if (!full) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  try {
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      full = path.join(full, 'index.html');
    }
    if (!fs.existsSync(full)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const type = CONTENT_TYPES[ext] || 'application/octet-stream';
    let body = fs.readFileSync(full);
    if (ext === '.html') body = Buffer.from(injectShim(body.toString('utf-8')), 'utf-8');
    // Never cache: the point is to see the edit you just made.
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Failed to read ${urlPath}: ${err.message}`);
  }
}

function createServer() {
  return http.createServer((req, res) => {
    const urlPath = req.url || '/';

    if (urlPath.split('?')[0] === SHIM_PATH) {
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'], 'Cache-Control': 'no-store' });
      res.end(SHIM);
      return;
    }

    if (urlPath.split('?')[0] === EVENTS_PATH) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (urlPath.split('?')[0] === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    serveFile(req, res, urlPath);
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // `start` is a cmd builtin; the empty "" is the window title slot.
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    console.warn(`[dev preview] could not open a browser (${err.message}) — open the URL above.`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (!fs.existsSync(RENDERER_DIR)) {
    console.error(`[dev preview] cannot find ${RENDERER_DIR}`);
    process.exit(1);
  }

  const server = createServer();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[dev preview] port ${opts.port} is already in use — pass --port <n>.`);
      process.exit(1);
    }
    console.error('[dev preview]', err.message);
    process.exit(1);
  });

  server.listen(opts.port, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${opts.port}`;
    // The appearance params are only the FIRST paint: once the page reaches the tray app it
    // adopts the stored scheme (see renderer/appearance/appearance.js).
    const open = `${base}/${opts.page}?port=${opts.addonPort}`;
    console.log(`\n  Simple Addon — dev preview\n`);
    console.log(`  serving   ${RENDERER_DIR}`);
    for (const page of KNOWN_PAGES) {
      console.log(`    ${page.what.padEnd(42)} ${base}/${page.file}?port=${opts.addonPort}`);
    }
    console.log(`\n  watching for changes — edit anything under renderer/ and the page reloads`);
    console.log(`  IPC bridges are stubbed; server-backed panels show real data if the tray app is on ${opts.addonPort}`);
    console.log(`\n  ${open}\n`);
    watchRenderer();
    if (opts.open) openBrowser(open);
  });
}

main();
