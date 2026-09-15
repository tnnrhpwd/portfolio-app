import React from 'react';
import {
  REVIEW_CATEGORIES,
  REVIEW_LIMITS,
  formatReviewDate,
  reviewCategoryLabel,
} from '../../utils/reviewUtils.js';

/**
 * Review Tab Component
 *
 * Two jobs in one tab:
 *   1. submit a review (open to signed-out visitors, as it always has been), and
 *   2. for a signed-in user, list the reviews they have already posted so they
 *      can edit or delete one.
 *
 * The list belongs in *this* tab rather than a new one: a user who wants to
 * change a review is already in "Leave Review", and a separate "My Reviews" tab
 * would be a place nobody looks.
 *
 * Edit mode is driven entirely by `editingReviewId` — when it is set, the same
 * form switches to "save changes" and grows a Cancel button, so there is one form
 * and one set of validation rather than two near-identical ones.
 */
const ReviewTab = ({
  formData,
  handleInputChange,
  handleStarClick,
  handleReviewSubmit,
  isSubmitting,
  hoverRating,
  setHoverRating,
  // Own-review management (signed-in only)
  isSignedIn = false,
  myReviews = [],
  loadingReviews = false,
  editingReviewId = null,
  onEditReview,
  onCancelEdit,
  onDeleteReview,
}) => {
  const isEditing = Boolean(editingReviewId);

  return (
    <div className="support-form-section">
      <h2>{isEditing ? '✏️ Edit your review' : '⭐ Share Your Experience'}</h2>
      <p className="support-form-description">
        {isEditing
          ? 'Change anything below and save — you can edit your review as often as you like.'
          : 'Your feedback helps us improve! Share your thoughts about our application.'}
      </p>
      
      <form onSubmit={handleReviewSubmit} className="support-form">
        <div className="support-form-row">
          <div className="support-form-group">
            <label htmlFor="reviewTitle">Review Title *</label>
            <input
              type="text"
              id="reviewTitle"
              name="reviewTitle"
              value={formData.reviewTitle}
              onChange={handleInputChange}
              placeholder="Brief title for your review"
              required
              maxLength={REVIEW_LIMITS.title}
            />
          </div>
          <div className="support-form-group">
            <label htmlFor="reviewCategory">Category</label>
            <select
              id="reviewCategory"
              name="reviewCategory"
              value={formData.reviewCategory}
              onChange={handleInputChange}
            >
              {REVIEW_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="support-form-group">
          <label id="reviewRating">Rating</label>
          <div className="support-rating-container">
            <div
              className="support-rating-stars"
              role="radiogroup"
              aria-labelledby="reviewRating"
              onMouseLeave={() => setHoverRating(0)}
            >
              {[...Array(5)].map((_, i) => {
                const value = i + 1;
                return (
                  <span
                    key={i}
                    className={`support-star clickable ${
                      value <= (hoverRating || formData.reviewRating) ? 'filled' : ''
                    }`}
                    role="radio"
                    aria-checked={formData.reviewRating === value}
                    aria-label={`${value} star${value > 1 ? 's' : ''}`}
                    tabIndex={0}
                    onClick={() => handleStarClick(value)}
                    onMouseEnter={() => setHoverRating(value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleStarClick(value);
                      }
                    }}
                  >
                    ⭐
                  </span>
                );
              })}
              <span className="support-rating-text">({formData.reviewRating}/5)</span>
            </div>
          </div>
        </div>

        <div className="support-form-group">
          <label htmlFor="reviewContent">Your Review *</label>
          <textarea
            id="reviewContent"
            name="reviewContent"
            value={formData.reviewContent}
            onChange={handleInputChange}
            placeholder="Tell us about your experience with our application..."
            required
            rows="6"
            maxLength={1000}
          />
          <small className="support-char-count" aria-live="polite">
            {formData.reviewContent.length}/{REVIEW_LIMITS.content} characters
          </small>
        </div>

        <div className="support-review-actions">
          <button
            type="submit"
            className="support-submit-btn"
            disabled={isSubmitting || !formData.reviewTitle.trim() || !formData.reviewContent.trim()}
          >
            {isSubmitting
              ? (isEditing ? '💾 Saving...' : '📤 Submitting...')
              : (isEditing ? '💾 Save changes' : '⭐ Submit Review')}
          </button>
          {isEditing && (
            <button
              type="button"
              className="support-submit-btn support-submit-btn--muted"
              onClick={onCancelEdit}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {isSignedIn && (
        <section className="support-my-reviews" aria-live="polite">
          <h3>
            Your reviews
            {myReviews.length > 0 && <span className="support-my-reviews-count">{myReviews.length}</span>}
          </h3>

          {loadingReviews && <p className="support-form-description">Loading your reviews…</p>}

          {!loadingReviews && myReviews.length === 0 && (
            <p className="support-form-description">
              You haven&apos;t posted a review yet. Once you do, it will appear here so you can edit it
              at any time.
            </p>
          )}

          {!loadingReviews && myReviews.map((review) => (
            <article
              key={review.id}
              className={`support-review-row ${editingReviewId === review.id ? 'is-editing' : ''}`}
            >
              <div className="support-review-row-main">
                <div className="support-review-row-head">
                  <strong>{review.title}</strong>
                  <span className="support-review-row-stars" aria-label={`${review.rating} out of 5`}>
                    {'⭐'.repeat(Math.max(0, Math.min(5, review.rating)))}
                  </span>
                  {review.edited && <span className="support-review-row-chip">edited</span>}
                </div>
                <p className="support-review-row-meta">
                  {reviewCategoryLabel(review.category)} · {formatReviewDate(review.updatedAt)}
                </p>
                <p className="support-review-row-body">{review.content}</p>
              </div>

              <div className="support-review-row-actions">
                <button
                  type="button"
                  className="support-review-btn"
                  onClick={() => onEditReview(review)}
                  disabled={isSubmitting}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="support-review-btn support-review-btn--danger"
                  onClick={() => onDeleteReview(review)}
                  disabled={isSubmitting}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}

          <p className="support-form-description support-my-reviews-note">
            Reviews are public and can be edited or deleted at any time. Anonymous reviews (posted while
            signed out) can&apos;t be edited, because there is no way to confirm who wrote them.
          </p>
        </section>
      )}
    </div>
  );
};

export default ReviewTab;
