/**
 * Pure time-math helpers for the Halfway calculator.
 *
 * All times are "minutes since midnight" integers in `[0, 1439]` unless a
 * function says otherwise. Keeping every calculation in this module (no React,
 * no DOM) makes the behaviour easy to unit test.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** Wrap any (possibly negative, possibly fractional) minute value into [0, 1440). */
export function normalizeMinutes(minutes) {
  const value = Math.round(minutes);
  return ((value % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Parse a user-typed time into minutes since midnight, or `null` when invalid.
 *
 * Accepts 24-hour forms ("1400", "14:00", "9" = 09:00) and 12-hour forms
 * ("2:30pm", "930 pm", "12:00 AM"). Plain digit strings are read as 24-hour
 * military time to stay backward compatible with the original calculator.
 */
export function parseTimeInput(input) {
  if (input === null || input === undefined) return null;
  let cleaned = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!cleaned) return null;

  let use12 = false;
  const meridiem = cleaned.match(/([ap])m$/);
  if (meridiem) {
    use12 = true;
    cleaned = cleaned.slice(0, -2);
  }

  let hours;
  let minutes;
  if (cleaned.includes(':')) {
    const [hPart, mPart = ''] = cleaned.split(':');
    if (
      !/^\d{1,2}$/.test(hPart) ||
      (mPart !== '' && !/^\d{1,2}$/.test(mPart))
    ) {
      return null;
    }
    hours = Number(hPart);
    minutes = mPart === '' ? 0 : Number(mPart);
  } else if (/^\d{1,4}$/.test(cleaned)) {
    if (cleaned.length <= 2) {
      // "9" or "9pm" -> 09:00 / 9:00 pm
      hours = Number(cleaned);
      minutes = 0;
    } else {
      const padded = cleaned.padStart(4, '0');
      hours = Number(padded.slice(0, 2));
      minutes = Number(padded.slice(2, 4));
    }
  } else {
    return null;
  }

  if (use12) {
    if (hours < 1 || hours > 12) return null;
    if (hours === 12) hours = 0;
    if (meridiem[1] === 'p') hours += 12;
  } else if (hours > 23) {
    return null;
  }
  if (minutes > 59) return null;

  return hours * 60 + minutes;
}

/** "HH:MM" 24-hour clock string. */
export function minutesToHhmm(minutes) {
  const total = normalizeMinutes(minutes);
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const mins = String(total % 60).padStart(2, '0');
  return `${hours}:${mins}`;
}

/** "h:mm AM/PM" 12-hour clock string. */
export function minutesTo12h(minutes) {
  const total = normalizeMinutes(minutes);
  const hours24 = Math.floor(total / 60);
  const mins = String(total % 60).padStart(2, '0');
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${mins} ${period}`;
}

/** "HHMM" compact 24-hour string, used to pre-fill the text inputs. */
export function minutesToCompact(minutes) {
  const total = normalizeMinutes(minutes);
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const mins = String(total % 60).padStart(2, '0');
  return `${hours}${mins}`;
}

/** "2:00 PM (14:00)" style label showing both clock conventions. */
export function minutesToLabel(minutes) {
  return `${minutesToHhmm(minutes)} (${minutesTo12h(minutes)})`;
}

/** "5 h 30 min", "45 min", "2 h". */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

/**
 * Solve one of three time puzzles on a 24-hour clock.
 *
 * @param {'midpoint'|'end'|'start'} mode
 *   - 'midpoint' – given the start and end of a window, find its exact middle.
 *   - 'end'      – given the start and a desired halfway time, find the end.
 *   - 'start'    – given the end and a desired halfway time, find the start.
 * @param {number} firstMinutes  Field 1 as minutes since midnight.
 * @param {number} secondMinutes Field 2 as minutes since midnight.
 *
 * A window always runs *forward* from its start, so a window whose end lands
 * earlier on the clock is treated as crossing midnight (e.g. 23:00 → 01:00).
 * Midpoints are rounded to the nearest minute.
 *
 * Returns `{ error }` with one of:
 *   - 'same'  – both times are identical (a zero-length window).
 *   - 'range' – reverse modes only: the desired halfway point is not reachable
 *     within 12 hours of the known endpoint.
 * Otherwise returns `{ start, end, midpoint, duration, crossesMidnight }`
 * where every time is minutes since midnight.
 */
export function solveTimeMath(mode, firstMinutes, secondMinutes) {
  const a = normalizeMinutes(firstMinutes);
  const b = normalizeMinutes(secondMinutes);

  if (mode === 'end' || mode === 'start') {
    const isEnd = mode === 'end';
    const known = a; // field 1 is always the fixed endpoint (start or end)
    const half = b; // field 2 is always the desired halfway time
    const delta = isEnd
      ? (half - known + MINUTES_PER_DAY) % MINUTES_PER_DAY
      : (known - half + MINUTES_PER_DAY) % MINUTES_PER_DAY;

    if (delta === 0) return { error: 'same' };
    // The halfway point of a forward window can never be more than 12 hours
    // from the start (a full-day window would make start and end identical).
    if (delta >= MINUTES_PER_DAY / 2) return { error: 'range' };

    const duration = delta * 2;
    const start = isEnd ? known : normalizeMinutes(known - duration);
    const end = isEnd ? normalizeMinutes(known + duration) : known;
    const midpoint = normalizeMinutes(start + duration / 2);

    return {
      error: null,
      start,
      end,
      midpoint,
      duration,
      crossesMidnight: end < start,
    };
  }

  // 'midpoint' mode
  const start = a;
  const end = b;
  if (start === end) return { error: 'same' };

  const duration = (end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const midpoint = normalizeMinutes(start + duration / 2);

  return {
    error: null,
    start,
    end,
    midpoint,
    duration,
    crossesMidnight: end < start,
  };
}
