import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { createData } from '../features/data/dataSlice';

/**
 * Custom hook to manage comments (fetch, create)
 * @param {Object} chosenData - The current data item
 * @param {Object} user - The current user
 * @param {Object} commentState - Comment state from useInfoDataState
 * @returns {Object} Comment handlers
 */
export const useCommentsManagement = (chosenData, user, commentState) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  
  const {
    commentText,
    setCommentText,
    comments,
    setComments,
    setCommentsLoading,
  } = commentState;

  // Fetch comments when chosenData is available
  useEffect(() => {
    const fetchComments = async () => {
      if (!chosenData?._id) return;
      
      setCommentsLoading(true);
      try {
        console.log('=== DEBUG: Fetching comments for ID:', chosenData._id);
        const commentSearchQuery = `Comment:${chosenData._id}`;
        
        // Fetch comments directly without using Redux to avoid state conflicts
        const queryData = JSON.stringify({ text: commentSearchQuery });
        const searchParams = new URLSearchParams({
          data: queryData
        });
        const response = await fetch(`/api/data/public?${searchParams}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('=== DEBUG: Comments fetch result:', result);
          
          // Process comments directly without affecting main data state
          if (result.data && Array.isArray(result.data)) {
            const commentData = result.data.filter(item => {
              const itemData = typeof item.data === 'string' ? item.data : item.data?.text || '';
              return itemData.includes(`Comment:${chosenData._id}`);
            });
            console.log('Found comments:', commentData.length);
            setComments(commentData);
          }
        }
      } catch (error) {
        console.error('Error fetching comments:', error);
      } finally {
        setCommentsLoading(false);
      }
    };

    fetchComments();
  }, [chosenData?._id, setComments, setCommentsLoading]);

  // Handle comment submission
  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    
    if (!commentText.trim()) {
      toast.error('Please enter a comment');
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    if (!chosenData?._id) {
      toast.error('Cannot add comment - missing data ID');
      return;
    }

    try {
      // Create comment with format: Comment:ParentID|CommentText|Public:true (comments are always public)
      const commentData = `Comment:${chosenData._id}|${commentText.trim()}|Public:true`;
      
      console.log('=== DEBUG: Creating comment ===');
      console.log('Comment data:', commentData);
      
      await dispatch(createData({ data: commentData })).unwrap();
      
      setCommentText('');
      toast.success('Comment added successfully!', { autoClose: toastDuration });
      
      // Refresh comments using direct fetch to avoid Redux state conflicts
      const commentSearchQuery = `Comment:${chosenData._id}`;
      try {
        const queryData = JSON.stringify({ text: commentSearchQuery });
        const searchParams = new URLSearchParams({ data: queryData });
        const response = await fetch(`/api/data/public?${searchParams}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.data && Array.isArray(result.data)) {
            const commentData = result.data.filter(item => {
              const itemData = typeof item.data === 'string' ? item.data : item.data?.text || '';
              return itemData.includes(`Comment:${chosenData._id}`);
            });
            setComments(commentData);
          }
        }
      } catch (error) {
        console.error('Error refreshing comments:', error);
      }
      
    } catch (error) {
      console.error('Error creating comment:', error);
      toast.error('Failed to add comment');
    }
  };

  return {
    handleCommentSubmit,
    comments,
  };
};
