/**
 * Pure helpers for the Wordle word list.
 *
 * Deliberately free of `import.meta.glob` and `fetch` so it stays unit-testable
 * under Jest — babel-jest cannot evaluate Vite's glob transform. The
 * Vite/browser half lives in `loadDictionary.js`.
 */

/**
 * Word lengths the SOLVER UI offers (its chips render MIN_LEN..MAX_LEN).
 * Anything longer is unreachable from that page, which is why the word list is
 * split by length in the first place.
 */
export const MIN_LEN = 3;
export const MAX_LEN = 8;

/** Word lengths the GAME allows — it validates 3..15 (`newGameButton` guards). */
export const GAME_MIN_LEN = 3;
export const GAME_MAX_LEN = 15;

/** The length both pages open on. */
export const DEFAULT_LEN = 5;

/**
 * Normalise a word-list part into an array of upper-case words.
 *
 * The parts are generated LF-joined by `frontend/scripts/split-dictionary.js`,
 * but `\r?\n` also tolerates a file that picked up CRLF on the way through a
 * Windows editor (the old single-file loader needed a two-pass hack for this).
 */
export function parseWords(text) {
  return String(text ?? '')
    .toUpperCase()
    .split(/\r?\n/)
    .map((word) => word.trim())
    .filter(Boolean);
}
