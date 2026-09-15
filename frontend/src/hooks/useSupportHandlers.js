import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { createData, createPublicData } from '../features/data/dataSlice';
import {
  MAX_RELATED_REPORTS,
  buildBugReportText,
  getUserIdentifier,
} from '../utils/supportUtils';

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

  // Link / unlink another report on the bug report form. Kept here (rather than
  // reading e.target.value) because the control is a checkbox list.
  const handleRelatedReportToggle = (reportId) => {
    setFormData(prev => {
      const current = Array.isArray(prev.bugRelatedReports) ? prev.bugRelatedReports : [];
      const isLinked = current.includes(reportId);
      if (!isLinked && current.length >= MAX_RELATED_REPORTS) {
        toast.info(`You can link up to ${MAX_RELATED_REPORTS} reports.`, { autoClose: 3000 });
        return prev;
      }
      return {
        ...prev,
        bugRelatedReports: isLinked
          ? current.filter(id => id !== reportId)
          : [...current, reportId],
      };
    });
  };

  // NOTE: submitting a review is NOT here. A review submit is either a create or
  // an edit of an existing row, and deciding between them needs the user's review
  // list — so it lives in `useMyReviews`, which owns that list. This hook keeps
  // the contact and bug-report forms, which have exactly one behaviour each.
  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const contactData = {
        text: `Contact:${formData.contactSubject}|Type:${formData.contactType}|Priority:${formData.contactPriority}|Name:${formData.contactName}|Email:${formData.contactEmail}|Message:${formData.contactMessage}|Timestamp:${new Date().toISOString()}`
      };

      // The Contact tab is visible to signed-out visitors too (the form collects
      // its own name/email), but createData is a PROTECTED thunk — for an
      // anonymous visitor it threw on the missing token, so the form always
      // failed with "Failed to send message". Use the public create path, the
      // same one reviews already use. Contact messages carry no `Public:true`
      // flag, so the public GET filter (getData.js) never returns them.
      await dispatch(createPublicData(contactData)).unwrap();
      
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
      // Prepend the DB user ID as its own Creator field so logged-in users' reports
      // still show up in "My Reports" (which filters by Creator:<user._id>), while
      // still allowing anonymous (logged-out) submissions.
      const creatorPrefix = user?._id ? `Creator:${user._id}|` : '';
      const bugData = {
        text: buildBugReportText({
          creatorPrefix,
          title: formData.bugTitle,
          severity: formData.bugSeverity,
          description: formData.bugDescription,
          steps: formData.bugSteps,
          expected: formData.bugExpected,
          actual: formData.bugActual,
          browser: formData.bugBrowser,
          device: formData.bugDevice,
          creator: userId,
          idea: formData.bugIdea,
          relatedReports: formData.bugRelatedReports,
        })
      };

      await dispatch(createPublicData(bugData)).unwrap();
      
      toast.success('Bug report submitted! Thank you for helping us improve.', { autoClose: 4000 });
      
      // Reset form
      setFormData(prev => ({
        ...prev,
        bugTitle: '',
        bugDescription: '',
        bugSteps: '',
        bugExpected: '',
        bugActual: '',
        bugSeverity: 'medium',
        bugIdea: '',
        bugRelatedReports: []
      }));

      // Refresh bug reports if user is on reports tab (or the bug form, which
      // lists their reports so the new one can be linked to them)
      if (activeTab === 'reports' || activeTab === 'bug') {
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
    handleRelatedReportToggle,
    handleContactSubmit,
    handleBugReportSubmit,
  };
};
