/**
 * countryName — turn an ISO 3166-1 alpha-2 code into a readable country name.
 *
 * Visitor records store whatever the geolocation lookup returned, which is
 * ipinfo's `country` field: the **two-letter code** (`CA`, `US`, `GB`). That is
 * fine in a data dump and unreadable in a report, so the admin views run it
 * through here — "CA" becomes "Canada".
 *
 * `Intl.DisplayNames` does the mapping, so there is no country table to keep
 * current (and no 250-line list to get wrong). Anything that isn't a bare
 * two-letter code — a name that is already spelled out, `undefined`, an empty
 * string, a region like "Unknown Region" — passes through untouched, which is
 * what a report should do rather than inventing a value.
 */

// Built once: constructing an Intl.DisplayNames is not free, and this runs per
// rendered row. `null` when the runtime lacks it (older browsers, a Node build
// without full ICU) — the helper then degrades to the raw value.
const REGION_NAMES = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

const cache = new Map();

export default function countryName(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (cache.has(raw)) return cache.get(raw);

  let resolved = raw;
  if (REGION_NAMES && /^[A-Za-z]{2}$/.test(raw)) {
    try {
      const name = REGION_NAMES.of(raw.toUpperCase());
      // `of()` returns the code itself for an unassigned pair, and
      // "Unknown Region" for a well-formed but unassigned one — neither is an
      // improvement on what we were handed.
      if (name && name.toLowerCase() !== raw.toLowerCase() && name !== 'Unknown Region') {
        resolved = name;
      }
    } catch {
      // RangeError on a code the runtime doesn't know — keep the raw value.
    }
  }

  cache.set(raw, resolved);
  return resolved;
}
