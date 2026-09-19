/**
 * User-agent parsing shared by the access log (`utils/accessData.js`) and the
 * password-reset notification email (`utils/passwordReset.js`).
 *
 * This replaces the `useragent` package. That package is unmaintained and
 * depends on `tmp@0.0.x`, which carries two high-severity advisories
 * (GHSA-52f5-9888-hmc6, GHSA-ph9p-34f9-6g65). Neither has a fixed release —
 * `tmp@0.2.5` is both the latest and still vulnerable — so the only way to
 * clear them is to drop `useragent` itself. `ua-parser-js` is the maintained
 * equivalent and pulls in no such dependency.
 *
 * The output shape deliberately matches the old `useragent` one:
 * `<family> <major>.<minor>.<patch>`. The `|Device:` / `|OS:` / `|Browser:`
 * fragments are persisted in the access log and read back out of it by
 * `utils/refererAnalytics.js` and the admin table, so the strings must stay
 * parseable by `/\|Browser:([^|]*)/` and by the `text.includes('|OS:')`
 * checks. An unrecognised or missing header yields `Other 0.0.0` for all
 * three fields, exactly as `useragent` did.
 *
 * Known differences from `useragent`, all deliberate:
 * - Family labels come from ua-parser-js, so macOS reads `macOS` (was
 *   `Mac OS X`) and Android Chrome reads `Mobile Chrome` (was `Chrome
 *   Mobile`). These are stored string values, not parsed enums.
 * - Android versions are reported (`Android 13.0.0`); `useragent` always said
 *   `Android 0.0.0`.
 * - Crawlers read as `Other 0.0.0`. `useragent` named them (`Googlebot
 *   2.1.0` / device `Spider 0.0.0`); ua-parser-js 2.0.10 exposes no bot
 *   detection (no `getBot()`), so that cannot be reproduced without
 *   re-adding a dependency of the kind being removed here.
 */

const { UAParser } = require('ua-parser-js');

const UNKNOWN = 'Other 0.0.0';

/**
 * Render a version string as the `major.minor.patch` triple `useragent` used.
 * Missing segments become `0`, so `'145.0.0.0'` -> `'145.0.0'` and
 * `'10'` -> `'10.0.0'` (keeping the old `Windows 10.0.0` output).
 * @param {string} [version]
 * @returns {string}
 */
function toVersionTriple(version) {
    const [major = '0', minor = '0', patch = '0'] = String(version || '').split('.');
    return `${major}.${minor}.${patch}`;
}

/**
 * @param {string} [family]
 * @param {string} [version]
 * @returns {string} e.g. `'Chrome 120.0.0'`, or `'Other 0.0.0'` when unknown.
 */
function familyWithVersion(family, version) {
    const name = String(family || '').trim();
    if (!name) return UNKNOWN;
    return `${name} ${toVersionTriple(version)}`;
}

/**
 * `useragent` reported device *families* (e.g. `iPhone 0.0.0`) and fell back
 * to `Other 0.0.0` for desktop browsers, which carry no device information.
 *
 * Only devices ua-parser-js actually classified get a label: a Windows or
 * macOS *desktop* has no `type`, so it stays `Other 0.0.0` as before — the
 * model ua-parser-js exposes for a Mac desktop (`Macintosh`) would otherwise
 * make the two desktop platforms disagree with each other.
 * @param {{ model?: string, type?: string }} device
 * @returns {string}
 */
function deviceLabel(device) {
    const type = String(device.type || '').trim();
    if (!type) return UNKNOWN;

    const model = String(device.model || '').trim();
    if (model) return `${model} 0.0.0`;

    return `${type.charAt(0).toUpperCase()}${type.slice(1)} 0.0.0`;
}

/**
 * Parse a `User-Agent` header into the three display strings the access log
 * and the security-notification email record.
 * @param {string} [header] Raw `User-Agent` header value.
 * @returns {{ browser: string, os: string, device: string }}
 */
function userAgentInfo(header) {
    const parser = new UAParser(String(header || ''));
    const browser = parser.getBrowser();
    const os = parser.getOS();

    return {
        browser: familyWithVersion(browser.name, browser.version),
        os: familyWithVersion(os.name, os.version),
        device: deviceLabel(parser.getDevice()),
    };
}

module.exports = { userAgentInfo };
