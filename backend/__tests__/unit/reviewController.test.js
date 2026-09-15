/**
 * reviewController.test.js — a user editing their own review.
 *
 * The interesting parts are the authorisation rule (a public row has no
 * `Creator:` segment, so ownership is the `User:<email>` field) and the fact
 * that an edit must preserve the original author and submission time while
 * adding an `EditedAt` stamp.
 */

const sent = [];

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockImplementation(async (command) => {
        // eslint-disable-next-line no-undef
        global.__reviewSent.push(command);
        return {};
      }),
    })),
  },
  GetCommand: jest.fn().mockImplementation((input) => ({ __type: 'Get', input })),
  PutCommand: jest.fn().mockImplementation((input) => ({ __type: 'Put', input })),
  DeleteCommand: jest.fn().mockImplementation((input) => ({ __type: 'Delete', input })),
}));

jest.mock('../../utils/accessData.js', () => ({ checkIP: jest.fn().mockResolvedValue() }));

jest.mock('../../utils/paginatedScan', () => ({
  paginatedScan: jest.fn(async () => []),
}));

global.__reviewSent = sent;

const { paginatedScan } = require('../../utils/paginatedScan');
const {
  LIMITS,
  parseReviewText,
  buildReviewText,
  normalizeReviewBody,
  listMyReviews,
  updateMyReview,
  deleteMyReview,
} = require('../../controllers/reviewController');

const ME = { id: 'me', text: 'Nickname:Me|Email:me@example.com|Password:[redacted]' };
const OTHER = { id: 'other', text: 'Nickname:Other|Email:other@example.com|Password:[redacted]' };

const reviewText = ({
  title = 'Great app',
  category = 'usability',
  rating = 5,
  content = 'Loving it so far',
  user = 'me@example.com',
  timestamp = '2026-01-01T00:00:00.000Z',
  editedAt = null,
} = {}) => buildReviewText({ title, category, rating, content, user, timestamp, editedAt });

const reviewRow = (overrides = {}) => ({
  id: overrides.id || 'review-1',
  text: reviewText(overrides),
  createdAt: overrides.createdAt || '2026-01-01T00:00:00.000Z',
  updatedAt: overrides.updatedAt || '2026-01-01T00:00:00.000Z',
});

/** A fake Express response that records the status it was given. */
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

beforeEach(() => {
  sent.length = 0;
  paginatedScan.mockReset();
  paginatedScan.mockResolvedValue([]);
});

describe('review blob parsing / building', () => {
  test('round-trips every field', () => {
    const parsed = parseReviewText(reviewText({ editedAt: '2026-02-02T00:00:00.000Z' }));
    expect(parsed).toMatchObject({
      title: 'Great app',
      category: 'usability',
      rating: 5,
      content: 'Loving it so far',
      user: 'me@example.com',
      timestamp: '2026-01-01T00:00:00.000Z',
      editedAt: '2026-02-02T00:00:00.000Z',
    });
  });

  test('a missing EditedAt segment reads as not-edited', () => {
    expect(parseReviewText(reviewText()).editedAt).toBe('');
  });

  test('keeps the segment order the existing readers expect', () => {
    const text = reviewText();
    expect(text.indexOf('Review:')).toBe(0);
    expect(text.indexOf('|Category:')).toBeGreaterThan(0);
    expect(text.indexOf('|Rating:')).toBeGreaterThan(text.indexOf('|Category:'));
    expect(text.indexOf('|Content:')).toBeGreaterThan(text.indexOf('|Rating:'));
    expect(text.indexOf('|User:')).toBeGreaterThan(text.indexOf('|Content:'));
    expect(text.indexOf('|Timestamp:')).toBeGreaterThan(text.indexOf('|User:'));
  });
});

describe('normalizeReviewBody', () => {
  test('accepts a well-formed body', () => {
    expect(normalizeReviewBody({ title: ' T ', category: 'design', rating: 4, content: ' C ' }))
      .toEqual({ title: 'T', category: 'design', rating: 4, content: 'C' });
  });

  test('reads the Support form\u2019s own field names too', () => {
    expect(normalizeReviewBody({ reviewTitle: 'T', reviewCategory: 'features', reviewRating: 3, reviewContent: 'C' }))
      .toEqual({ title: 'T', category: 'features', rating: 3, content: 'C' });
  });

  test('requires a title and content', () => {
    expect(() => normalizeReviewBody({ title: '', content: 'C', rating: 3 })).toThrow(/title/i);
    expect(() => normalizeReviewBody({ title: 'T', content: '   ', rating: 3 })).toThrow(/text is required/i);
  });

  test('rejects a rating outside 1-5 and non-integers', () => {
    for (const rating of [0, 6, 3.5, 'nope', undefined]) {
      expect(() => normalizeReviewBody({ title: 'T', content: 'C', rating })).toThrow(/Rating must be/);
    }
  });

  test('falls back to `general` for an unknown category rather than rejecting the review', () => {
    expect(normalizeReviewBody({ title: 'T', content: 'C', rating: 3, category: '<script>' }).category).toBe('general');
  });

  test('strips the delimiters that would corrupt the blob', () => {
    const { title, content } = normalizeReviewBody({
      title: 'a|b', content: 'line one\nline two | with pipe', rating: 3,
    });
    expect(title).toBe('a/b');
    expect(content).toBe('line one line two / with pipe');
  });

  test('bounds the fields to the form\u2019s own limits', () => {
    const { title, content } = normalizeReviewBody({
      title: 'x'.repeat(500), content: 'y'.repeat(5000), rating: 3,
    });
    expect(title).toHaveLength(LIMITS.titleMax);
    expect(content).toHaveLength(LIMITS.contentMax);
  });
});

describe('listMyReviews', () => {
  test('returns only the caller\u2019s reviews, newest edit first', async () => {
    paginatedScan.mockResolvedValue([
      reviewRow({ id: 'mine-1', title: 'Mine one', updatedAt: '2026-01-02T00:00:00.000Z' }),
      reviewRow({ id: 'theirs', title: 'Theirs', user: 'other@example.com' }),
      reviewRow({ id: 'mine-2', title: 'Mine two', updatedAt: '2026-03-02T00:00:00.000Z', editedAt: '2026-03-02T00:00:00.000Z' }),
    ]);

    const res = mockRes();
    await listMyReviews({ user: ME }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.reviews.map((r) => r.id)).toEqual(['mine-2', 'mine-1']);
    expect(res.body.reviews[0]).toMatchObject({ title: 'Mine two', edited: true, editedAt: '2026-03-02T00:00:00.000Z' });
  });

  test('matches the email case-insensitively', async () => {
    paginatedScan.mockResolvedValue([reviewRow({ id: 'mine', user: 'Me@Example.com' })]);
    const res = mockRes();
    await listMyReviews({ user: ME }, res);
    expect(res.body.reviews).toHaveLength(1);
  });

  test('refuses when the caller has no email on the account row', async () => {
    const res = mockRes();
    await expect(listMyReviews({ user: { id: 'me', text: 'Nickname:Me|Password:[redacted]' } }, res))
      .rejects.toThrow(/User not found/);
  });
});

describe('updateMyReview', () => {
  test('rewrites the row, preserving author and submission time, and stamps the edit', async () => {
    const item = reviewRow();
    paginatedScan.mockResolvedValue([item]);

    const res = mockRes();
    await updateMyReview(
      { user: ME, params: { id: 'review-1' }, body: { title: 'Updated', rating: 4, content: 'Changed my mind' } },
      res
    );

    expect(res.statusCode).toBe(200);
    const put = sent.find((c) => c.__type === 'Put');
    const parsed = parseReviewText(put.input.Item.text);
    expect(parsed).toMatchObject({
      title: 'Updated',
      rating: 4,
      content: 'Changed my mind',
      user: 'me@example.com',                        // author preserved
      timestamp: '2026-01-01T00:00:00.000Z',          // original submission time preserved
    });
    expect(parsed.editedAt).toBeTruthy();
    expect(res.body.review).toMatchObject({ title: 'Updated', edited: true });
  });

  test('a second edit keeps the original timestamp and moves EditedAt', async () => {
    paginatedScan.mockResolvedValue([reviewRow({ editedAt: '2026-02-02T00:00:00.000Z' })]);
    const res = mockRes();
    await updateMyReview({ user: ME, params: { id: 'review-1' }, body: { title: 'Again', rating: 3, content: 'C' } }, res);
    const parsed = parseReviewText(sent.find((c) => c.__type === 'Put').input.Item.text);
    expect(parsed.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.editedAt).not.toBe('2026-02-02T00:00:00.000Z');
  });

  test('refuses someone else\u2019s review with a 403 and writes nothing', async () => {
    paginatedScan.mockResolvedValue([reviewRow({ user: 'other@example.com' })]);
    const res = mockRes();
    await expect(updateMyReview({ user: ME, params: { id: 'review-1' }, body: { title: 'T', rating: 5, content: 'C' } }, res))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(sent.filter((c) => c.__type === 'Put')).toHaveLength(0);
  });

  test('refuses an anonymous review — there is no way to prove who wrote it', async () => {
    paginatedScan.mockResolvedValue([reviewRow({ user: 'anonymous' })]);
    const res = mockRes();
    await expect(updateMyReview({ user: ME, params: { id: 'review-1' }, body: { title: 'T', rating: 5, content: 'C' } }, res))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('404s on a review that does not exist', async () => {
    paginatedScan.mockResolvedValue([]);
    const res = mockRes();
    await expect(updateMyReview({ user: ME, params: { id: 'nope' }, body: { title: 'T', rating: 5, content: 'C' } }, res))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects an invalid body before writing', async () => {
    paginatedScan.mockResolvedValue([reviewRow()]);
    const res = mockRes();
    await expect(updateMyReview({ user: ME, params: { id: 'review-1' }, body: { title: 'T', rating: 9, content: 'C' } }, res))
      .rejects.toThrow(/Rating must be/);
    expect(sent).toHaveLength(0);
  });
});

describe('deleteMyReview', () => {
  test('deletes with the composite key, not just the partition key', async () => {
    paginatedScan.mockResolvedValue([reviewRow()]);
    const res = mockRes();
    await deleteMyReview({ user: ME, params: { id: 'review-1' } }, res);

    const del = sent.find((c) => c.__type === 'Delete');
    // The table's sort key has to come off the row we read, or DynamoDB throws
    // "The provided key element does not match the schema".
    expect(del.input.Key).toEqual({ id: 'review-1', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(res.body).toEqual({ success: true, id: 'review-1' });
  });

  test('refuses someone else\u2019s review', async () => {
    paginatedScan.mockResolvedValue([reviewRow({ user: 'other@example.com' })]);
    const res = mockRes();
    await expect(deleteMyReview({ user: ME, params: { id: 'review-1' } }, res)).rejects.toMatchObject({ statusCode: 403 });
    expect(sent.filter((c) => c.__type === 'Delete')).toHaveLength(0);
  });

  test('the OTHER user also cannot delete it', async () => {
    paginatedScan.mockResolvedValue([reviewRow({ user: 'me@example.com' })]);
    const res = mockRes();
    await expect(deleteMyReview({ user: OTHER, params: { id: 'review-1' } }, res)).rejects.toMatchObject({ statusCode: 403 });
  });
});
