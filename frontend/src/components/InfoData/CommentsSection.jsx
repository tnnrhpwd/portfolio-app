import React from 'react';
import { useNavigate } from 'react-router-dom';
import Spinner from '../Spinner/Spinner';
import DataResult from '../Simple/DataResult/DataResult';
import { extractCommentText, extractCommentUserID } from '../../utils/validationUtils';

/**
 * Comments section component
 * @param {Object} props - Component props
 */
const CommentsSection = ({
  chosenData,
  user,
  comments,
  commentsLoading,
  commentText,
  onCommentTextChange,
  onCommentSubmit
}) => {
  const navigate = useNavigate();

  if (!chosenData) return null;

  return (
    <div className='infodata-comments-section'>
      <div className='infodata-comments-header'>
        <h3 className='infodata-comments-title'>
          <span className='infodata-comments-icon'>💬</span>
          Comments ({comments.length})
        </h3>
      </div>

      {/* Comment Input */}
      {user && (
        <div className='infodata-comment-input-section'>
          <form onSubmit={onCommentSubmit} className='infodata-comment-form'>
            <div className='infodata-comment-input-group'>
              <label htmlFor="commentTextArea" className='infodata-comment-label'>
                Add a comment:
              </label>
              <textarea
                id="commentTextArea"
                className='infodata-comment-textarea'
                value={commentText}
                onChange={(e) => onCommentTextChange(e.target.value)}
                placeholder="Share your thoughts, ask questions, or provide additional context..."
                rows={3}
              />
            </div>
            <div className='infodata-comment-actions'>
              <button 
                type="submit" 
                className='infodata-comment-submit'
                disabled={!commentText.trim()}
              >
                <span className="btn-icon">💬</span>
                <span className="btn-text">Post Comment</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Comments List */}
      <div className='infodata-comments-list'>
        {commentsLoading && (
          <div className='infodata-comments-loading'>
            <Spinner />
            <p>Loading comments...</p>
          </div>
        )}

        {!commentsLoading && comments.length === 0 && (
          <div className='infodata-comments-empty'>
            <div className='infodata-comments-empty-icon'>💭</div>
            <p className='infodata-comments-empty-text'>No comments yet</p>
            <p className='infodata-comments-empty-subtext'>
              {user ? 'Be the first to share your thoughts!' : 'Log in to join the conversation'}
            </p>
          </div>
        )}

        {!commentsLoading && comments.length > 0 && (
          <>
            {comments.map((comment, index) => {
              // Extract comment data and metadata
              const commentData = typeof comment.data === 'string' ? comment.data : comment.data?.text || '';
              const commentUserID = extractCommentUserID(commentData);
              const cleanCommentText = extractCommentText(commentData);

              return (
                <div key={`comment-${comment._id || comment.id}-${index}`} className='infodata-comment-item'>
                  <DataResult
                    importPlanString={cleanCommentText}
                    updatedAtData={comment.updatedAt || comment.createdAt}
                    itemID={chosenData._id}
                    files={comment.files || []}
                    userName={`User ${commentUserID.substring(0, 8)}`}
                    userBadge="Silver"
                  />
                  <div className='infodata-comment-meta'>
                    <span className='infodata-comment-type'>💬 Comment</span>
                    <span className='infodata-comment-reply'>
                      Click above to reply or view nested comments
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Login prompt for non-users */}
      {!user && (
        <div className='infodata-comment-login-prompt'>
          <div className='infodata-comment-login-content'>
            <span className='infodata-comment-login-icon'>🔐</span>
            <p>Want to join the conversation?</p>
            <button 
              className='infodata-comment-login-btn'
              onClick={() => navigate('/login')}
            >
              Log in to comment
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommentsSection;
