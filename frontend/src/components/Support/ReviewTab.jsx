import React from 'react';

/**
 * Review Tab Component
 */
const ReviewTab = ({ formData, handleInputChange, handleStarClick, handleReviewSubmit, isSubmitting, hoverRating, setHoverRating }) => {
  return (
    <div className="support-form-section">
      <h2>⭐ Share Your Experience</h2>
      <p className="support-form-description">
        Your feedback helps us improve! Share your thoughts about our application.
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
              maxLength={100}
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
              <option value="general">General Experience</option>
              <option value="usability">Usability</option>
              <option value="performance">Performance</option>
              <option value="features">Features</option>
              <option value="design">Design</option>
              <option value="support">Customer Support</option>
            </select>
          </div>
        </div>

        <div className="support-form-group">
          <label htmlFor="reviewRating">Rating</label>
          <div className="support-rating-container">
            <div className="support-rating-stars">
              {[...Array(5)].map((_, i) => (
                <span
                  key={i}
                  className={`support-star clickable ${
                    i < (hoverRating || formData.reviewRating) ? 'filled' : ''
                  }`}
                  onClick={() => handleStarClick(i + 1)}
                  onMouseEnter={() => setHoverRating(i + 1)}
                  onMouseLeave={() => setHoverRating(0)}
                >
                  ⭐
                </span>
              ))}
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
          <small className="support-char-count">
            {formData.reviewContent.length}/1000 characters
          </small>
        </div>

        <button
          type="submit"
          className="support-submit-btn"
          disabled={isSubmitting || !formData.reviewTitle.trim() || !formData.reviewContent.trim()}
        >
          {isSubmitting ? '📤 Submitting...' : '⭐ Submit Review'}
        </button>
      </form>
    </div>
  );
};

export default ReviewTab;
