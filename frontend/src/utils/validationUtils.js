/**
 * Validation utilities for InfoData component
 */

/**
 * Validate comment text
 * @param {string} commentText - The comment text to validate
 * @returns {Object} Validation result { isValid: boolean, error: string }
 */
export const validateComment = (commentText) => {
  if (!commentText || !commentText.trim()) {
    return {
      isValid: false,
      error: 'Please enter a comment'
    };
  }
  
  if (commentText.length > 5000) {
    return {
      isValid: false,
      error: 'Comment is too long (max 5000 characters)'
    };
  }
  
  return {
    isValid: true,
    error: null
  };
};

/**
 * Validate data update
 * @param {string} currentText - The current text to update
 * @param {string} originalText - The original text before edit
 * @returns {Object} Validation result { isValid: boolean, error: string, hasChanges: boolean }
 */
export const validateUpdate = (currentText, originalText) => {
  if (!currentText || !currentText.trim()) {
    return {
      isValid: false,
      error: 'Please enter data to update',
      hasChanges: false
    };
  }
  
  // Check if there are actually changes to save
  if (currentText === originalText) {
    return {
      isValid: true,
      error: 'No changes detected',
      hasChanges: false
    };
  }
  
  return {
    isValid: true,
    error: null,
    hasChanges: true
  };
};

/**
 * Extract comment text from comment data string
 * @param {string} commentData - The full comment data string
 * @returns {string} The extracted comment text
 */
export const extractCommentText = (commentData) => {
  // Extract comment text (everything after Comment:ParentID|)
  const commentTextMatch = commentData.match(/Comment:[a-f0-9]+\|(.+)$/);
  const displayCommentText = commentTextMatch ? commentTextMatch[1] : commentData;
  
  // Clean comment text for display
  return displayCommentText.replace(/Creator:.*?\|/, '').trim();
};

/**
 * Extract comment user ID
 * @param {string} commentData - The full comment data string
 * @returns {string} The extracted user ID
 */
export const extractCommentUserID = (commentData) => {
  // Extract user ID from comment data
  const mongoIdMatch = commentData.match(/Creator:([a-f0-9]{24})\|/);
  const dynamoIdMatch = commentData.match(/Creator:([a-f0-9]{32})\|/);
  
  if (mongoIdMatch) {
    return mongoIdMatch[1];
  } else if (dynamoIdMatch) {
    return dynamoIdMatch[1];
  }
  return '';
};
