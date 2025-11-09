import React from 'react';

/**
 * Attached files display component
 * @param {Array} files - Array of file objects
 * @param {Function} onFileDelete - Handler for file deletion
 * @param {boolean} isOwner - Whether the current user owns this data
 * @param {string} dataId - The data item ID
 */
const AttachedFilesSection = ({ files, onFileDelete, isOwner, dataId }) => {
  if (!files || files.length === 0) return null;

  return (
    <div className='infodata-files-section'>
      <h3>
        <span>📎</span>
        Attached Files ({files.length})
      </h3>
      <div className='infodata-files-grid'>
        {files.map((file, index) => {
          // Handle both old base64 files and new S3 files
          const isS3File = file.s3Key && file.publicUrl;
          const fileType = file.fileType || file.contentType;
          const fileName = file.fileName || file.filename;
          const fileUrl = isS3File 
            ? file.publicUrl 
            : `data:${file.contentType};base64,${file.data}`;

          return (
            <div key={dataId + "attachments" + index} className='infodata-file-item'>
              <div className='infodata-file-preview'>
                {fileType?.startsWith('image/') && (
                  <img 
                    src={fileUrl} 
                    alt={fileName} 
                    className='infodata-file-img'
                    onError={(e) => {
                      console.error('Image failed to load:', fileUrl);
                      e.target.style.display = 'none';
                    }}
                  />
                )}
                {fileType?.startsWith('video/') && (
                  <video controls className='infodata-file-video'>
                    <source src={fileUrl} type={fileType} />
                    Your browser does not support the video tag.
                  </video>
                )}
                {!fileType?.startsWith('image/') && !fileType?.startsWith('video/') && (
                  <div className='infodata-file-icon'>
                    {fileType?.includes('pdf') ? '📄' : 
                     fileType?.includes('text') ? '📝' : 
                     fileType?.includes('json') ? '🗂️' : 
                     fileType?.includes('document') ? '📋' : 
                     fileType?.includes('spreadsheet') ? '📊' : '📁'}
                  </div>
                )}
              </div>
              
              <div className='infodata-file-info'>
                <div className='infodata-file-name'>{fileName}</div>
                <div className='infodata-file-type'>{fileType}</div>
                {file.fileSize && (
                  <div className='infodata-file-size'>
                    {(file.fileSize / 1024 / 1024).toFixed(2)} MB
                  </div>
                )}
                {isS3File && (
                  <div className='infodata-file-storage'>☁️ Cloud Storage</div>
                )}
              </div>
              
              <div className='infodata-file-actions'>
                {isS3File && (
                  <a 
                    href={file.publicUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className='infodata-file-action-btn infodata-file-view-btn'
                    title="View file"
                  >
                    👁️
                  </a>
                )}
                {isOwner && isS3File && (
                  <button 
                    onClick={() => onFileDelete(file)}
                    className='infodata-file-action-btn infodata-file-delete-btn'
                    title="Delete file"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AttachedFilesSection;
