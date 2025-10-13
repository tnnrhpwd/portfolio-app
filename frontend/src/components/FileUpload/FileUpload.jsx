import React, { useState, useCallback } from 'react';
import { useFileUpload } from '../../hooks/useFileUpload';
import './FileUpload.css';

const FileUpload = ({ 
    onUploadComplete, 
    fileType = 'document',
    dataId = null,
    multiple = false,
    accept = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.json,.docx,.xlsx',
    maxSize = '50MB',
    className = '',
    disabled = false
}) => {
    const [dragActive, setDragActive] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState([]);
    
    const { 
        uploading, 
        uploadProgress, 
        uploadFile, 
        uploadMultipleFiles,
        validateFile 
    } = useFileUpload();

    // Handle file selection
    const handleFileSelect = useCallback((files) => {
        const fileArray = Array.from(files);
        
        // Validate files
        const validFiles = [];
        const invalidFiles = [];
        
        fileArray.forEach(file => {
            try {
                validateFile(file);
                validFiles.push(file);
            } catch (error) {
                invalidFiles.push({ file, error: error.message });
            }
        });

        if (invalidFiles.length > 0) {
            console.warn('Invalid files:', invalidFiles);
            // You could show these errors to the user
        }

        setSelectedFiles(validFiles);
    }, [validateFile]);

    // Handle file input change
    const handleInputChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files);
        }
    };

    // Handle drag events
    const handleDrag = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    }, []);

    // Handle drop
    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files);
        }
    }, [handleFileSelect]);

    // Upload selected files
    const handleUpload = async () => {
        if (selectedFiles.length === 0) return;

        try {
            let result;
            
            if (multiple && selectedFiles.length > 1) {
                result = await uploadMultipleFiles(selectedFiles, fileType, dataId);
            } else {
                result = await uploadFile(selectedFiles[0], fileType, dataId);
            }

            if (onUploadComplete) {
                onUploadComplete(result);
            }

            // Clear selected files after successful upload
            setSelectedFiles([]);
            
            // Reset file input
            const fileInput = document.getElementById('file-upload-input');
            if (fileInput) {
                fileInput.value = '';
            }

        } catch (error) {
            console.error('Upload error:', error);
        }
    };

    // Remove file from selection
    const removeFile = (index) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    // Format file size
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className={`file-upload-container ${className}`}>
            <div 
                className={`file-upload-dropzone ${dragActive ? 'drag-active' : ''} ${disabled ? 'disabled' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => !disabled && document.getElementById('file-upload-input')?.click()}
            >
                <input
                    id="file-upload-input"
                    type="file"
                    multiple={multiple}
                    accept={accept}
                    onChange={handleInputChange}
                    disabled={disabled}
                    style={{ display: 'none' }}
                />
                
                <div className="upload-icon">
                    📁
                </div>
                
                <div className="upload-text">
                    <p className="primary-text">
                        {dragActive 
                            ? 'Drop files here' 
                            : 'Click to select files or drag and drop'
                        }
                    </p>
                    <p className="secondary-text">
                        Max size: {maxSize} • Supports: Images, PDFs, Documents
                    </p>
                </div>
            </div>

            {/* Selected Files */}
            {selectedFiles.length > 0 && (
                <div className="selected-files">
                    <h4>Selected Files:</h4>
                    {selectedFiles.map((file, index) => (
                        <div key={index} className="file-item">
                            <div className="file-info">
                                <span className="file-name">{file.name}</span>
                                <span className="file-size">{formatFileSize(file.size)}</span>
                            </div>
                            <button 
                                type="button"
                                className="remove-file-btn"
                                onClick={() => removeFile(index)}
                                disabled={uploading}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Upload Progress */}
            {uploading && (
                <div className="upload-progress">
                    <div className="progress-bar">
                        <div 
                            className="progress-fill" 
                            style={{ width: `${uploadProgress}%` }}
                        ></div>
                    </div>
                    <span className="progress-text">{uploadProgress}%</span>
                </div>
            )}

            {/* Upload Button */}
            {selectedFiles.length > 0 && !uploading && (
                <button 
                    type="button"
                    className="upload-btn"
                    onClick={handleUpload}
                    disabled={disabled}
                >
                    Upload {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''}
                </button>
            )}
        </div>
    );
};

export default FileUpload;