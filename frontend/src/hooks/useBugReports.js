import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { getUserBugReports } from '../features/data/dataSlice';
import { getUserIdentifier } from '../utils/supportUtils';

/**
 * Custom hook to manage bug reports
 * @param {Object} user - Current user
 * @param {Array} userBugReports - Current bug reports
 * @param {Function} setUserBugReports - Bug reports setter
 * @param {Function} setLoadingReports - Loading state setter
 * @param {Function} setIsSubmitting - Submitting state setter
 */
export const useBugReports = (user, userBugReports, setUserBugReports, setLoadingReports, setIsSubmitting) => {
  const dispatch = useDispatch();

  const fetchUserBugReports = async () => {
    // Check for user authentication
    if (!user) {
      toast.error('Please log in to view your bug reports.', { autoClose: 3000 });
      return;
    }
    
    // Use getUserIdentifier to check if we can identify the user
    const userId = getUserIdentifier(user);
    if (userId === 'Anonymous') {
      toast.error('Please log in to view your bug reports.', { autoClose: 3000 });
      return;
    }
    
    setLoadingReports(true);
    try {
      const response = await dispatch(getUserBugReports()).unwrap();
      console.log('Bug reports response:', response);
      
      const bugReports = response.data || response || [];
      setUserBugReports(bugReports);
      
    } catch (error) {
      console.error('Error fetching bug reports:', error);
      toast.error('Failed to load your bug reports.', { autoClose: 3000 });
      setUserBugReports([]);
    } finally {
      setLoadingReports(false);
    }
  };

  const closeBugReport = async (reportId) => {
    try {
      setIsSubmitting(true);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update the local state to show the report as closed
      setUserBugReports(prevReports => 
        prevReports.map(report => 
          report.id === reportId 
            ? { ...report, status: 'Closed', updatedAt: new Date().toISOString() }
            : report
        )
      );
      
      toast.success('Bug report marked as resolved!', { autoClose: 4000 });
      
    } catch (error) {
      console.error('Error closing bug report:', error);
      toast.error('Failed to close bug report. Please try again.', { autoClose: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    fetchUserBugReports,
    closeBugReport,
  };
};
