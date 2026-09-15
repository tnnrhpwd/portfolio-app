import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReviewTab from './ReviewTab.jsx';

/**
 * ReviewTab — the part of the review edit feature a user actually touches.
 *
 * What matters here:
 *   - the form switches to "save changes" while editing, and offers a way out;
 *   - the list only appears for a signed-in user (a visitor submitting a review
 *     has no list, and should not be told they do);
 *   - Edit hands the whole review back, not just its id.
 */

const baseForm = { reviewTitle: '', reviewContent: '', reviewRating: 5, reviewCategory: 'general' };

const renderTab = (overrides = {}) => {
  const props = {
    formData: baseForm,
    handleInputChange: jest.fn(),
    handleStarClick: jest.fn(),
    handleReviewSubmit: jest.fn(),
    isSubmitting: false,
    hoverRating: 0,
    setHoverRating: jest.fn(),
    onEditReview: jest.fn(),
    onCancelEdit: jest.fn(),
    onDeleteReview: jest.fn(),
    ...overrides,
  };
  return { ...render(<ReviewTab {...props} />), props };
};

const myReview = {
  id: 'review-1',
  title: 'Great app',
  content: 'Loving it so far',
  rating: 4,
  category: 'design',
  updatedAt: '2026-03-04T00:00:00.000Z',
  edited: false,
};

afterEach(cleanup);

describe('ReviewTab — submitting', () => {
  test('offers the submit action and no edit affordances when not editing', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /submit review/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  test('submit is blocked until both required fields have content', () => {
    renderTab({ formData: { ...baseForm, reviewTitle: 'Title' } });
    expect(screen.getByRole('button', { name: /submit review/i })).toBeDisabled();
  });
});

describe('ReviewTab — editing', () => {
  test('switches the action to save and offers a cancel', () => {
    renderTab({ editingReviewId: 'review-1', formData: { ...baseForm, reviewTitle: 'T', reviewContent: 'C' } });

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit review/i })).not.toBeInTheDocument();
    // The heading, not the description — both say "edit your review".
    expect(screen.getByRole('heading', { name: /edit your review/i })).toBeInTheDocument();
  });

  test('cancel calls back rather than clearing the form itself', () => {
    const { props } = renderTab({
      editingReviewId: 'review-1',
      formData: { ...baseForm, reviewTitle: 'T', reviewContent: 'C' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(props.onCancelEdit).toHaveBeenCalledTimes(1);
  });

  test('while saving, the action is disabled and says so', () => {
    renderTab({ editingReviewId: 'review-1', isSubmitting: true });
    const save = screen.getByRole('button', { name: /saving/i });
    expect(save).toBeDisabled();
  });
});

describe('ReviewTab — your reviews list', () => {
  test('a signed-out visitor sees only the form', () => {
    renderTab({ isSignedIn: false, myReviews: [myReview] });
    expect(screen.queryByText(/your reviews/i)).not.toBeInTheDocument();
    expect(screen.queryByText(myReview.title)).not.toBeInTheDocument();
  });

  test('a signed-in user with no reviews is told what will appear here', () => {
    renderTab({ isSignedIn: true, myReviews: [] });
    expect(screen.getByText(/your reviews/i)).toBeInTheDocument();
    expect(screen.getByText(/haven't posted a review yet/i)).toBeInTheDocument();
  });

  test('lists each review with its category, rating and edited flag', () => {
    const { container } = renderTab({ isSignedIn: true, myReviews: [{ ...myReview, edited: true }] });
    expect(screen.getByText(myReview.title)).toBeInTheDocument();
    // The category also appears as a `<option>` in the form, so match the
    // composed meta line ("Design · Mar 4, 2026") rather than the word alone.
    expect(screen.getByText(/Design ·/)).toBeInTheDocument();
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="4 out of 5"]')).not.toBeNull();
  });

  test('Edit hands back the whole review so the form can be filled from it', () => {
    const { props } = renderTab({ isSignedIn: true, myReviews: [myReview] });
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(props.onEditReview).toHaveBeenCalledWith(myReview);
  });

  test('Delete hands back the review too, and is a distinct control from Edit', () => {
    const { props } = renderTab({ isSignedIn: true, myReviews: [myReview] });
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(props.onDeleteReview).toHaveBeenCalledWith(myReview);
    expect(props.onEditReview).not.toHaveBeenCalled();
  });

  test('the row being edited is marked, so the form and the row visibly match', () => {
    const { container } = renderTab({ isSignedIn: true, myReviews: [myReview], editingReviewId: 'review-1' });
    expect(container.querySelector('.support-review-row.is-editing')).not.toBeNull();
  });
});
