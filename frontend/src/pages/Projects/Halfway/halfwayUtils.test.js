import {
  MINUTES_PER_DAY,
  formatDuration,
  minutesTo12h,
  minutesToCompact,
  minutesToHhmm,
  minutesToLabel,
  normalizeMinutes,
  parseTimeInput,
  solveTimeMath,
} from './halfwayUtils';

describe('parseTimeInput', () => {
  it.each([
    // 24-hour forms (backward compatible with the original calculator)
    ['1400', 14 * 60],
    ['14:00', 14 * 60],
    ['900', 9 * 60],
    ['9:00', 9 * 60],
    ['9', 9 * 60],
    ['0000', 0],
    ['0:00', 0],
    ['2359', 23 * 60 + 59],
    ['0', 0],
    // 12-hour forms
    ['2:00pm', 14 * 60],
    ['2 pm', 14 * 60],
    ['2PM', 14 * 60],
    ['930 pm', 21 * 60 + 30],
    ['9:30pm', 21 * 60 + 30],
    ['9pm', 21 * 60],
    ['12:00am', 0],
    ['12 am', 0],
    ['12:00pm', 12 * 60],
    ['12pm', 12 * 60],
    ['0930pm', 21 * 60 + 30],
    // whitespace tolerance
    ['  14 : 30  ', 14 * 60 + 30],
  ])('parses %p as %p minutes', (input, expected) => {
    expect(parseTimeInput(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [''],
    ['   '],
    ['abcd'],
    ['24:00'],
    ['25:00'],
    ['9:60'],
    ['-5'],
    ['14:00am'], // 14 is not a valid 12-hour hour
    ['13pm'],
    ['0:30am'], // 12-hour clocks start at 12, not 0
  ])('rejects invalid input %p', input => {
    expect(parseTimeInput(input)).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('formats 24-hour clock strings', () => {
    expect(minutesToHhmm(0)).toBe('00:00');
    expect(minutesToHhmm(14 * 60)).toBe('14:00');
    expect(minutesToHhmm(23 * 60 + 59)).toBe('23:59');
  });

  it('formats 12-hour clock strings', () => {
    expect(minutesTo12h(0)).toBe('12:00 AM');
    expect(minutesTo12h(14 * 60)).toBe('2:00 PM');
    expect(minutesTo12h(23 * 60 + 59)).toBe('11:59 PM');
    expect(minutesTo12h(12 * 60)).toBe('12:00 PM');
  });

  it('formats compact input values', () => {
    expect(minutesToCompact(7 * 60 + 55)).toBe('0755');
    expect(minutesToCompact(14 * 60)).toBe('1400');
    expect(minutesToCompact(0)).toBe('0000');
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(330)).toBe('5 h 30 min');
  });

  it('combines both clock conventions', () => {
    expect(minutesToLabel(17 * 60 + 55)).toBe('17:55 (5:55 PM)');
  });

  it('normalizes out-of-range and fractional minutes', () => {
    expect(normalizeMinutes(-5)).toBe(MINUTES_PER_DAY - 5);
    expect(normalizeMinutes(MINUTES_PER_DAY + 30)).toBe(30);
    expect(normalizeMinutes(60.4)).toBe(60);
    expect(normalizeMinutes(60.6)).toBe(61);
  });
});

describe('solveTimeMath — midpoint mode', () => {
  it('finds the middle of a same-day window', () => {
    const result = solveTimeMath('midpoint', 14 * 60, 19 * 60 + 50);
    expect(result.error).toBeNull();
    expect(result.start).toBe(14 * 60);
    expect(result.end).toBe(19 * 60 + 50);
    expect(result.midpoint).toBe(16 * 60 + 55);
    expect(result.duration).toBe(350);
    expect(result.crossesMidnight).toBe(false);
  });

  it('finds the middle of a window that crosses midnight', () => {
    // 19:50 -> 01:40 next day is a 5 h 50 min window -> 22:45
    const result = solveTimeMath('midpoint', 19 * 60 + 50, 1 * 60 + 40);
    expect(result.error).toBeNull();
    expect(result.midpoint).toBe(22 * 60 + 45);
    expect(result.duration).toBe(350);
    expect(result.crossesMidnight).toBe(true);
  });

  it('rounds odd-length windows to the nearest minute', () => {
    // 08:00 -> 08:07 is 7 min; exact middle is 08:03:30 -> 08:04
    const result = solveTimeMath('midpoint', 8 * 60, 8 * 60 + 7);
    expect(result.midpoint).toBe(8 * 60 + 4);
    expect(result.duration).toBe(7);
  });

  it('flags identical times as an error', () => {
    const result = solveTimeMath('midpoint', 9 * 60, 9 * 60);
    expect(result.error).toBe('same');
  });
});

describe('solveTimeMath — reverse modes', () => {
  it('finds the end time given a start and halfway (same day)', () => {
    // Start 08:00, halfway 10:30 -> end 13:00
    const result = solveTimeMath('end', 8 * 60, 10 * 60 + 30);
    expect(result.error).toBeNull();
    expect(result.start).toBe(8 * 60);
    expect(result.end).toBe(13 * 60);
    expect(result.midpoint).toBe(10 * 60 + 30);
    expect(result.duration).toBe(300);
    expect(result.crossesMidnight).toBe(false);
  });

  it('finds an end time that crosses midnight', () => {
    // Start 14:00, halfway 22:00 -> window 14:00 -> 06:00 next day
    const result = solveTimeMath('end', 14 * 60, 22 * 60);
    expect(result.error).toBeNull();
    expect(result.end).toBe(6 * 60);
    expect(result.duration).toBe(16 * 60);
    expect(result.crossesMidnight).toBe(true);
  });

  it('finds the start time given an end and halfway', () => {
    // End 13:00, halfway 10:30 -> start 08:00
    const result = solveTimeMath('start', 13 * 60, 10 * 60 + 30);
    expect(result.error).toBeNull();
    expect(result.start).toBe(8 * 60);
    expect(result.end).toBe(13 * 60);
    expect(result.midpoint).toBe(10 * 60 + 30);
  });

  it('rejects an unreachable halfway point in end mode', () => {
    // Start 08:00; the halfway of a forward window can never be 06:00.
    const result = solveTimeMath('end', 8 * 60, 6 * 60);
    expect(result.error).toBe('range');
  });

  it('rejects an unreachable halfway point in start mode', () => {
    // End 20:00; the halfway can never be after the end time.
    const result = solveTimeMath('start', 20 * 60, 22 * 60);
    expect(result.error).toBe('range');
  });

  it('rejects identical inputs in reverse modes', () => {
    expect(solveTimeMath('end', 8 * 60, 8 * 60).error).toBe('same');
    expect(solveTimeMath('start', 8 * 60, 8 * 60).error).toBe('same');
  });
});
