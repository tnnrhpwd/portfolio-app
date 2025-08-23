import React from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({ 
  size = 'medium', 
  message = 'Loading...', 
  overlay = false,
  fullScreen = false,
  color = 'primary' 
}) => {
  const containerClass = `
    loading-spinner-container 
    loading-spinner-${size}
    ${overlay ? 'loading-spinner-overlay' : ''}
    ${fullScreen ? 'loading-spinner-fullscreen' : ''}
    loading-spinner-${color}
  `.trim();

  return (
    <div className={containerClass}>
      <div className="loading-spinner">
        <div className="loading-spinner-circle"></div>
        <div className="loading-spinner-circle"></div>
        <div className="loading-spinner-circle"></div>
      </div>
      {message && (
        <p className="loading-spinner-message">{message}</p>
      )}
    </div>
  );
};

// Skeleton loading component for better perceived performance
export const SkeletonLoader = ({ 
  lines = 3, 
  height = '20px', 
  className = '',
  animated = true 
}) => {
  return (
    <div className={`skeleton-loader ${className} ${animated ? 'skeleton-animated' : ''}`}>
      {Array.from({ length: lines }, (_, index) => (
        <div 
          key={index}
          className="skeleton-line" 
          style={{ 
            height,
            width: index === lines - 1 ? '70%' : '100%'
          }}
        />
      ))}
    </div>
  );
};

// Card skeleton for loading cards/items
export const CardSkeleton = ({ showAvatar = false, lines = 2 }) => {
  return (
    <div className="card-skeleton skeleton-animated">
      {showAvatar && <div className="skeleton-avatar" />}
      <div className="skeleton-content">
        <div className="skeleton-title" />
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="skeleton-text" />
        ))}
      </div>
    </div>
  );
};

export default LoadingSpinner;
