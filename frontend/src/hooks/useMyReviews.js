import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { createPublicData } from '../features/data/dataSlice';
import { useDispatch } from 'react-redux';
import { deleteMyReview, listMyReviews, updateMyReview } from '../services/reviewApi.js';
import {
  EMPTY_REVIEW,
  buildReviewText,
  reviewToForm,
} from '../utils/reviewUtils.js';

/**
 * useMyReviews — a signed-in user's own reviews, and the edit/delete actions
 * over them.
 *
 * A review is created through the *public* create path (`createPublicData`),
 * because the review tab is open to signed-out visitors and always has been.
 * Editing one can't use the generic `PUT /api/data/:id` (that route requires a
 * `Creator:<userId>` segment, which a public row has never had), so edits go
 * through the dedicated `/reviews/:id` endpoints, which authorise on the
 * review's `User:<email>` field instead.
 *
 * @param {object|null} user - redux user (needs `token` and `email`)
 * @param {object} formData - the shared support form state
 * @param {Function} setFormData
 */
export const useMyReviews = (user, formData, setFormData) => {
  const dispatch = useDispatch();
  const [myReviews, setMyReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState(null);
  const [isSavingReview, setIsSavingReview] = useState(false);

  const isSignedIn = Boolean(user?.token);

  const fetchMyReviews = useCallback(async () => {
    if (!user?.token) {
      setMyReviews([]);
      return;
    }
    setLoadingReviews(true);
    try {
      setMyReviews(await listMyReviews(user.token));
    } catch (error) {
      // A failure here is not worth a toast on page load — the form above still
      // works, which is the actual job of this tab.
      console.warn('Could not load your reviews:', error.message);
      setMyReviews([]);
    } finally {
      setLoadingReviews(false);
    }
  }, [user]);

  // Load once when the user is known, and again after a sign-in.
  useEffect(() => {
    fetchMyReviews();
  }, [fetchMyReviews]);

  /** Put a stored review into the form and switch the button to "save". */
  const startEditReview = useCallback((review) => {
    setEditingReviewId(review.id);
    setFormData((prev) => ({
      ...prev,
      ...reviewToForm(review),
    }));
  }, [setFormData]);

  const cancelEditReview = useCallback(() => {
    setEditingReviewId(null);
    setFormData((prev) => ({ ...prev, ...EMPTY_REVIEW }));
  }, [setFormData]);

  /**
   * Submit the form: a new review, or an edit of the one `editingReviewId`
   * points at. Both paths keep the same field validation the form already does.
   */
  const submitReview = useCallback(async (event) => {
    event.preventDefault();
    setIsSavingReview(true);

    try {
      if (editingReviewId) {
        const updated = await updateMyReview(user.token, editingReviewId, {
          title: formData.reviewTitle,
          category: formData.reviewCategory,
          rating: formData.reviewRating,
          content: formData.reviewContent,
        });
        setMyReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        setEditingReviewId(null);
        toast.success('Your review has been updated.', { autoClose: 4000 });
      } else {
        const reviewData = {
          text: buildReviewText({
            title: formData.reviewTitle,
            category: formData.reviewCategory,
            rating: formData.reviewRating,
            content: formData.reviewContent,
            // Signed-out visitors can still review; the row records "Anonymous"
            // and is then read-only, since there is no way to prove authorship.
            user: user?.email || 'Anonymous',
            timestamp: new Date().toISOString(),
          }),
        };

        await dispatch(createPublicData(reviewData)).unwrap();
        toast.success('Thank you for your review! We appreciate your feedback.', { autoClose: 4000 });
        // The new row is only reachable through the list endpoint, so re-read it
        // rather than guessing its id.
        await fetchMyReviews();
      }

      setFormData((prev) => ({ ...prev, ...EMPTY_REVIEW }));
    } catch (error) {
      console.error('Error saving review:', error);
      toast.error(
        editingReviewId ? 'Failed to save your changes. Please try again.' : 'Failed to submit review. Please try again.',
        { autoClose: 3000 }
      );
    } finally {
      setIsSavingReview(false);
    }
  }, [dispatch, editingReviewId, fetchMyReviews, formData, setFormData, user]);

  const removeReview = useCallback(async (review) => {
    if (!window.confirm(`Delete your review "${review.title}"? This cannot be undone.`)) return;

    setIsSavingReview(true);
    try {
      await deleteMyReview(user.token, review.id);
      setMyReviews((prev) => prev.filter((r) => r.id !== review.id));
      // Deleting the review you were editing must not leave the form in edit mode
      // pointed at a row that no longer exists.
      if (editingReviewId === review.id) {
        setEditingReviewId(null);
        setFormData((prev) => ({ ...prev, ...EMPTY_REVIEW }));
      }
      toast.success('Review deleted.', { autoClose: 3000 });
    } catch (error) {
      console.error('Error deleting review:', error);
      toast.error('Failed to delete the review. Please try again.', { autoClose: 3000 });
    } finally {
      setIsSavingReview(false);
    }
  }, [editingReviewId, setFormData, user]);

  return {
    isSignedIn,
    myReviews,
    loadingReviews,
    /** True while an edit or delete is in flight (drives the button states). */
    isSavingReview,
    editingReviewId,
    fetchMyReviews,
    startEditReview,
    cancelEditReview,
    submitReview,
    removeReview,
  };
};
