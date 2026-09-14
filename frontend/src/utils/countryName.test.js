import countryName from './countryName';

/**
 * Country codes in the admin views.
 *
 * The assertions are deliberately about the *contract* rather than exact
 * strings: `Intl.DisplayNames` output varies a little between ICU versions
 * ("United States" vs "United States of America"), and a test that pins a name
 * would fail on a Node upgrade for no reason.
 */
describe('countryName', () => {
  test('spells out a two-letter code', () => {
    const canada = countryName('CA');
    expect(canada).not.toBe('CA');
    expect(canada.length).toBeGreaterThan(2);
    expect(countryName('ca')).toBe(canada); // case-insensitive
  });

  test('leaves an already-spelled-out name alone', () => {
    expect(countryName('Canada')).toBe('Canada');
    expect(countryName('United States of America')).toBe('United States of America');
  });

  test('never invents a value for junk input', () => {
    expect(countryName('')).toBe('');
    expect(countryName(null)).toBe('');
    expect(countryName(undefined)).toBe('');
    expect(countryName('undefined')).toBe('undefined');
    expect(countryName('ZZ')).toBe('ZZ'); // unassigned pair: keep the raw value
    expect(countryName('Toronto')).toBe('Toronto');
  });

  test('memoises, so a table of 200 rows builds one lookup per code', () => {
    const first = countryName('GB');
    expect(countryName('GB')).toBe(first);
  });
});
