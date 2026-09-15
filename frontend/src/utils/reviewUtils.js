/**
 * reviewUtils.js — pure helpers for the Support review tab.
 *
 * Kept out of the hooks so they can be unit-tested without a store or a DOM:
 * the review blob's segment rules are the part that must not drift from the
 * server (`backend/controllers/reviewController.js` parses exactly this shape).
 */

/** The categories the review form offers. Must match the server's allow-list. */
export const REVIEW_CATEGORIES = [
  { value: 'general', label: 'General Experience' },
  { value: 'usability', label: 'Usability' },
  { value: 'performance', label: 'Performance' },
  { value: 'features', label: 'Features' },
  { value: 'design', label: 'Design' },
  { value: 'support', label: 'Customer Support' },
];

export const REVIEW_LIMITS = { title: 100, content: 1000 };

/** The review form's empty state. */
export const EMPTY_REVIEW = {
  reviewTitle: '',
  reviewContent: '',
  reviewRating: 5,
  reviewCategory: 'general',
};

/**
 * A `|` or a newline would end the blob's segment early and corrupt the review
 * for every reader that splits on `|` (the admin Reviews table, the support-ticket
 * export). The server replaces them too — this stops the user seeing a character
 * in the box that never gets stored.
 */
export const sanitizeReviewSegment = (value) =>
  String(value ?? '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ');

/**
 * Build the pipe-delimited review row the Support tab has always posted.
 *
 * ⚠️ The segment order (`Review:` → `Category:` → `Rating:` → `Content:` →
 * `User:` → `Timestamp:`) is load-bearing: `adminController.categorise()` keys on
 * the presence of `Review:`/`Rating:`/`User:`, and `Admin/Reviews.jsx` splits on
 * `|` and takes the first segment as the title.
 */
export const buildReviewText = ({ title, category, rating, content, user, timestamp }) =>
  [
    `Review:${sanitizeReviewSegment(title).trim()}`,
    `Category:${sanitizeReviewSegment(category).trim() || 'general'}`,
    `Rating:${rating}/5`,
    `Content:${sanitizeReviewSegment(content).trim()}`,
    `User:${user || 'Anonymous'}`,
    `Timestamp:${timestamp}`,
  ].join('|');

/** Map a stored review onto the form's field names so it can be edited in place. */
export const reviewToForm = (review) => ({
  reviewTitle: review?.title || '',
  reviewContent: review?.content || '',
  reviewRating: Number(review?.rating) || 5,
  reviewCategory: REVIEW_CATEGORIES.some((c) => c.value === review?.category)
    ? review.category
    : 'general',
});

/** Short, human date for the "your reviews" list. */
export const formatReviewDate = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const reviewCategoryLabel = (value) =>
  REVIEW_CATEGORIES.find((c) => c.value === value)?.label || 'General Experience';
