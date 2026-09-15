/**
 * On-demand access to the Wordle word list.
 *
 * WHY THIS IS SPLIT BY LENGTH
 * ---------------------------
 * The list is 178,686 words (1.7 MB raw / 455 KB gzip). Neither consumer ever
 * needs more than one length at a time: `WordleSolver` pools
 * `words.filter(w => w.length === wordLength)`, and `Wordle` validates a guess
 * that is already `wordLength` characters long. Loading the monolith meant a
 * 5-letter game downloaded 178,686 words to use 8,938 of them.
 *
 * The parts are produced by `frontend/scripts/split-dictionary.js` and are the
 * committed source of truth for the word list. Measured on the wire:
 *
 *   whole file   455 KB gzip / 370 KB brotli
 *   5-letter      23 KB gzip /  12 KB brotli   ← 95% smaller, the default game
 *
 * Vite emits each part as a hashed immutable asset, so a visitor pays for a
 * length once and the service worker serves it from cache thereafter.
 */

import { parseWords } from './wordList.js';

// Eager so the URL map is in the bundle (a few hundred bytes); the word lists
// themselves are fetched lazily below and never all at once.
//
// `no-inline` matters: Vite inlines any asset under `build.assetsInlineLimit`
// (4 kB) as a `data:` URL, so the 2- and 3-letter parts silently became base64
// inside this chunk — loaded for every visitor even though nobody who plays the
// default 5-letter game ever needs them. Forcing a real file keeps the behaviour
// uniform across lengths and costs nothing until a length is actually used.
const partUrls = import.meta.glob('./dictionary/words-*.txt', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
});

const urlByLength = new Map();
for (const [partPath, url] of Object.entries(partUrls)) {
  const match = /words-(\d+)\.txt$/.exec(partPath);
  if (match) urlByLength.set(Number(match[1]), url);
}

/** Word lengths that have a shipped list, ascending. */
export function availableLengths() {
  return [...urlByLength.keys()].sort((a, b) => a - b);
}

/** length -> Promise<string[]> for in-flight and settled loads. */
const pending = new Map();
/** length -> string[] once resolved, so callers can read without awaiting. */
const resolved = new Map();

/**
 * Fetch and parse the word list for `length`, at most once per length.
 * Concurrent callers share a single request. Failures are NOT cached, so a
 * transient network error doesn't poison the length for the rest of the session.
 */
export function loadWords(length) {
  const key = Number(length);

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const url = urlByLength.get(key);
  const promise = url
    ? fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`Dictionary request failed: HTTP ${res.status}`);
          return res.text();
        })
        .then(parseWords)
    : Promise.reject(new Error(`No word list is shipped for ${key}-letter words`));

  promise.then(
    (words) => resolved.set(key, words),
    () => pending.delete(key),
  );

  pending.set(key, promise);
  return promise;
}

/**
 * The words for `length` if they are already loaded, else null.
 *
 * Needed because a component cannot read its own freshly-`set` state in the same
 * tick — after `await loadWords(n)` the caller still holds the previous render's
 * state. Reading the module cache keeps that path correct.
 */
export function getLoadedWords(length) {
  return resolved.get(Number(length)) ?? null;
}

/** Test seam: drop all memoised loads. */
export function __resetDictionaryCache() {
  pending.clear();
  resolved.clear();
}
