import React from 'react';
import FileUpload from '../FileUpload/FileUpload';

/**
 * File upload section component
 * @param {boolean} showUpload - Whether to show the upload UI
 * @param {Function} onToggle - Handler to toggle upload UI visibility
 * @param {Function} onUploadComplete - Handler for upload completion
 * @param {string} dataId - The data item ID
 * @param {boolean} isOwner - Whether the current user owns this data
 */
const FileUploadSection = ({ showUpload, onToggle, onUploadComplete, dataId, isOwner }) => {
  if (!isOwner) return null;

  return (
    <div className='infodata-file-section'>
      <div className='infodata-file-header'>
        <h3>
          <span>📁</span>
          Upload Files
        </h3>
        <p>Add images, documents, or other files to this item</p>
        <button
          className='infodata-toggle-upload-btn'
          onClick={onToggle}
          type="button"
        >
          {showUpload ? '🔽 Hide Upload' : '📤 Show Upload'}
        </button>
      </div>
      
      {showUpload && (
        <div className='infodata-file-upload-container'>
          <FileUpload
            onUploadComplete={onUploadComplete}
            fileType="image"
            dataId={dataId}
            multiple={true}
            className="infodata-file-upload"
          />
        </div>
      )}
    </div>
  );
};

export default FileUploadSection;
