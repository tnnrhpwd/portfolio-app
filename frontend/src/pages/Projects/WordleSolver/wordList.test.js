/**
 * Guards the split Wordle word list.
 *
 * The app now loads exactly ONE `dictionary/words-<len>.txt` per word length, so
 * a bad split fails silently and badly: words missing from the length that needs
 * them (the solver offers "no possibilities", the game rejects a real word) or
 * leaking into the wrong length. These tests read the shipped parts directly.
 *
 * Regenerate the parts with: node frontend/scripts/split-dictionary.js --apply
 */

const fs = require('fs');
const path = require('path');
const { parseWords, MIN_LEN, MAX_LEN, GAME_MIN_LEN, GAME_MAX_LEN } = require('./wordList.js');

const DICTIONARY_DIR = path.join(__dirname, 'dictionary');

/**
 * The list's known size. If a regeneration truncates or duplicates words, the
 * total is the cheapest thing to notice — so it is pinned rather than derived.
 */
const TOTAL_WORDS = 178686;

const partFiles = () => fs.readdirSync(DICTIONARY_DIR).filter((f) => /^words-\d+\.txt$/.test(f));
const lengthOf = (file) => Number(file.match(/\d+/)[0]);
const wordsIn = (len) =>
  fs
    .readFileSync(path.join(DICTIONARY_DIR, `words-${len}.txt`), 'utf8')
    .split('\n')
    .filter(Boolean);

describe('split word list', () => {
  it('ships a part for every length either page can ask for', () => {
    const shipped = partFiles().map(lengthOf);
    // The solver offers MIN_LEN..MAX_LEN; the game allows GAME_MIN_LEN..GAME_MAX_LEN,
    // which is the wider range and must be fully covered.
    for (let len = GAME_MIN_LEN; len <= GAME_MAX_LEN; len++) {
      expect(shipped).toContain(len);
    }
    expect(MIN_LEN).toBeGreaterThanOrEqual(GAME_MIN_LEN);
    expect(MAX_LEN).toBeLessThanOrEqual(GAME_MAX_LEN);
  });

  it('contains only words of its own length', () => {
    for (const file of partFiles()) {
      const len = lengthOf(file);
      const words = wordsIn(len);
      expect(words.length).toBeGreaterThan(0);
      // The whole optimisation rests on this: a length's part must be exactly the
      // words of that length, so no runtime filter is needed.
      expect(words.filter((w) => w.length !== len)).toEqual([]);
    }
  });

  it('is upper-case, untrimmed-free, and free of CRLF', () => {
    for (const file of partFiles()) {
      const len = lengthOf(file);
      const raw = fs.readFileSync(path.join(DICTIONARY_DIR, `words-${len}.txt`), 'utf8');
      expect(raw).not.toContain('\r');
      for (const word of wordsIn(len)) {
        expect(word).toBe(word.trim());
        expect(word).toBe(word.toUpperCase());
      }
    }
  });

  it('holds the entire list, with no duplicates', () => {
    const all = partFiles().flatMap((f) => wordsIn(lengthOf(f)));
    expect(all.length).toBe(TOTAL_WORDS);
    expect(new Set(all).size).toBe(all.length);
  });

  it('covers the solver default length with a usable pool', () => {
    // 5 letters is where both pages open; a near-empty pool would be a silent
    // quality regression rather than a crash.
    expect(wordsIn(5).length).toBeGreaterThan(5000);
  });
});

describe('parseWords', () => {
  it('splits on LF and CRLF, and upper-cases', () => {
    expect(parseWords('cat\ndog\r\nbird')).toEqual(['CAT', 'DOG', 'BIRD']);
  });

  it('drops blank lines and surrounding whitespace', () => {
    expect(parseWords('\n  cat  \n\n\ndog\n')).toEqual(['CAT', 'DOG']);
  });

  it('tolerates null and undefined', () => {
    expect(parseWords(null)).toEqual([]);
    expect(parseWords(undefined)).toEqual([]);
  });

  it('round-trips a generated part without altering it', () => {
    const raw = fs.readFileSync(path.join(DICTIONARY_DIR, 'words-5.txt'), 'utf8');
    expect(parseWords(raw)).toEqual(wordsIn(5));
  });
});
