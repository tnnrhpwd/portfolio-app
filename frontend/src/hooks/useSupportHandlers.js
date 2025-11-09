import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { createData } from '../features/data/dataSlice';
import { getUserIdentifier } from '../utils/supportUtils';

/**
 * Custom hook to handle form submissions
 * @param {Object} user - Current user
 * @param {Object} formData - Form data state
 * @param {Function} setFormData - Form data setter
 * @param {Function} setIsSubmitting - Submitting state setter
 * @param {string} activeTab - Current active tab
 * @param {Function} fetchUserBugReports - Function to refresh bug reports
 */
export const useSupportHandlers = (user, formData, setFormData, setIsSubmitting, activeTab, fetchUserBugReports) => {
  const dispatch = useDispatch();

  const handleInputChange = (e) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseInt(value) : value
    }));
  };

  const handleStarClick = (rating) => {
    setFormData(prev => ({
      ...prev,
      reviewRating: rating
    }));
  };

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const reviewData = {
        text: `Review:${formData.reviewTitle}|Category:${formData.reviewCategory}|Rating:${formData.reviewRating}/5|Content:${formData.reviewContent}|User:${user?.email || 'Anonymous'}|Timestamp:${new Date().toISOString()}`
      };

      await dispatch(createData(reviewData)).unwrap();
      
      toast.success('Thank you for your review! We appreciate your feedback.', { autoClose: 4000 });
      
      // Reset form
      setFormData(prev => ({
        ...prev,
        reviewTitle: '',
        reviewContent: '',
        reviewRating: 5,
        reviewCategory: 'general'
      }));
      
    } catch (error) {
      console.error('Error submitting review:', error);
      toast.error('Failed to submit review. Please try again.', { autoClose: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const contactData = {
        text: `Contact:${formData.contactSubject}|Type:${formData.contactType}|Priority:${formData.contactPriority}|Name:${formData.contactName}|Email:${formData.contactEmail}|Message:${formData.contactMessage}|Timestamp:${new Date().toISOString()}`
      };

      await dispatch(createData(contactData)).unwrap();
      
      toast.success('Message sent successfully! We\'ll get back to you soon.', { autoClose: 4000 });
      
      // Reset form
      setFormData(prev => ({
        ...prev,
        contactName: '',
        contactSubject: '',
        contactMessage: '',
        contactPriority: 'medium',
        contactType: 'support'
      }));
      
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message. Please try again.', { autoClose: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBugReportSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const userId = getUserIdentifier(user);
      const bugData = {
        text: `Bug:${formData.bugTitle}|Severity:${formData.bugSeverity}|Description:${formData.bugDescription}|Steps:${formData.bugSteps}|Expected:${formData.bugExpected}|Actual:${formData.bugActual}|Browser:${formData.bugBrowser}|Device:${formData.bugDevice}|Creator:${userId}|Status:Open|Timestamp:${new Date().toISOString()}`
      };

      await dispatch(createData(bugData)).unwrap();
      
      toast.success('Bug report submitted! Thank you for helping us improve.', { autoClose: 4000 });
      
      // Reset form
      setFormData(prev => ({
        ...prev,
        bugTitle: '',
        bugDescription: '',
        bugSteps: '',
        bugExpected: '',
        bugActual: '',
        bugSeverity: 'medium'
      }));

      // Refresh bug reports if user is on reports tab
      if (activeTab === 'reports') {
        fetchUserBugReports();
      }
      
    } catch (error) {
      console.error('Error submitting bug report:', error);
      toast.error('Failed to submit bug report. Please try again.', { autoClose: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    handleInputChange,
    handleStarClick,
    handleReviewSubmit,
    handleContactSubmit,
    handleBugReportSubmit,
  };
};
