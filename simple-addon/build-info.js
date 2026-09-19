/**
 * build-info.js — read this build's own build-info.json.
 *
 * scripts/write-build-info.js stamps that file just before packaging, so a
 * packaged copy can say which rev it is and whether it came from this machine
 * ('local', via scripts/build-local.js) or from the release workflow
 * ('release'). A from-source run has no such file, and that absence is itself
 * the signal: `readBuildInfo()` returning null means "running from source".
 *
 * Kept dependency-free (fs + path only) on purpose: server/update-bridge.js
 * reads it to describe the running build, and that module must stay loadable
 * outside Electron so the HTTP layer can be tested without launching an app.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const INFO_PATH = path.join(__dirname, 'build-info.json');

/**
 * @returns {{version: string, rev: number, channel?: string, builtAt?: string}|null}
 *   null when this copy was never stamped (dev/unpackaged) or the file is unreadable.
 */
function readBuildInfo() {
  try {
    if (!fs.existsSync(INFO_PATH)) return null;
    return JSON.parse(fs.readFileSync(INFO_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

module.exports = { readBuildInfo, INFO_PATH };
