/**
 * reviewUtils.test.js — the review blob's segment rules.
 *
 * The server parses exactly this shape, and `Admin/Reviews.jsx` splits on `|`
 * and treats the first segment as the title, so the ORDER and the delimiter
 * handling here are contract, not formatting.
 */

import {
  EMPTY_REVIEW,
  REVIEW_CATEGORIES,
  buildReviewText,
  formatReviewDate,
  reviewCategoryLabel,
  reviewToForm,
  sanitizeReviewSegment,
} from './reviewUtils';

describe('sanitizeReviewSegment', () => {
  test('replaces the delimiter and newlines that would break the blob', () => {
    expect(sanitizeReviewSegment('a|b')).toBe('a/b');
    expect(sanitizeReviewSegment('one\ntwo')).toBe('one two');
    expect(sanitizeReviewSegment('one\r\ntwo')).toBe('one two');
  });

  test('is safe on null and undefined', () => {
    expect(sanitizeReviewSegment(null)).toBe('');
    expect(sanitizeReviewSegment(undefined)).toBe('');
  });
});

describe('buildReviewText', () => {
  const built = buildReviewText({
    title: 'Great app',
    category: 'design',
    rating: 4,
    content: 'Loving it',
    user: 'me@example.com',
    timestamp: '2026-01-01T00:00:00.000Z',
  });

  test('writes the segments in the order every reader expects', () => {
    expect(built.indexOf('Review:')).toBe(0);
    expect(built.indexOf('|Category:')).toBeGreaterThan(0);
    expect(built.indexOf('|Rating:')).toBeGreaterThan(built.indexOf('|Category:'));
    expect(built.indexOf('|Content:')).toBeGreaterThan(built.indexOf('|Rating:'));
    expect(built.indexOf('|User:')).toBeGreaterThan(built.indexOf('|Content:'));
    expect(built.indexOf('|Timestamp:')).toBeGreaterThan(built.indexOf('|User:'));
  });

  test('keeps the markers the admin filter and categoriser look for', () => {
    // adminController.categorise() uses these three to call a row a review.
    expect(built).toContain('Review:');
    expect(built).toContain('Rating:');
    expect(built).toContain('User:');
    expect(built).toMatch(/Rating:4\/5/);
  });

  test('a signed-out review is recorded as Anonymous', () => {
    expect(buildReviewText({ title: 'T', content: 'C', rating: 5, category: 'general', user: '', timestamp: 'x' }))
      .toContain('|User:Anonymous|');
  });

  test('a pipe typed into the title or body cannot shift a segment', () => {
    const text = buildReviewText({
      title: 'a|b', category: 'general', rating: 3, content: 'x|y', user: 'me@example.com', timestamp: 'ts',
    });
    expect(text.split('|').filter((part) => part.startsWith('User:'))).toHaveLength(1);
    expect(text).toContain('Review:a/b');
    expect(text).toContain('Content:x/y');
  });
});

describe('reviewToForm', () => {
  test('maps a stored review onto the form fields', () => {
    expect(reviewToForm({ title: 'T', content: 'C', rating: 4, category: 'support' }))
      .toEqual({ reviewTitle: 'T', reviewContent: 'C', reviewRating: 4, reviewCategory: 'support' });
  });

  test('falls back to general for a category the form does not offer', () => {
    expect(reviewToForm({ title: 'T', content: 'C', rating: 4, category: 'legacy-thing' }).reviewCategory).toBe('general');
  });

  test('a missing review becomes the empty form rather than blanks in the fields', () => {
    expect(reviewToForm(null)).toEqual({ ...EMPTY_REVIEW, reviewCategory: 'general' });
  });
});

describe('labels and dates', () => {
  test('every offered category has a label', () => {
    for (const option of REVIEW_CATEGORIES) {
      expect(reviewCategoryLabel(option.value)).toBe(option.label);
    }
  });

  test('an unknown category still renders a label', () => {
    expect(reviewCategoryLabel('nope')).toBe('General Experience');
  });

  test('formats a date, and nothing for a bad value', () => {
    expect(formatReviewDate('2026-03-04T00:00:00.000Z')).toMatch(/2026/);
    expect(formatReviewDate('nope')).toBe('');
  });
});
