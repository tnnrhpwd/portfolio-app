import { useState, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import dataService from '../features/data/dataService';
import { toast } from 'react-toastify';

// Used until GET /upload-config responds — mirrors backend/constants/upload.js.
// The server response replaces this, so the client check tracks the server's
// real limits instead of a copy that can drift.
const FALLBACK_UPLOAD_CONFIG = {
    allowedTypes: [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf',
        'text/plain', 'text/csv', 'application/json',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    maxFileBytes: 50 * 1024 * 1024, // 50 MB
};

export const useFileUpload = () => {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadConfig, setUploadConfig] = useState(FALLBACK_UPLOAD_CONFIG);

    const { user } = useSelector((state) => state.auth);

    // Pull the real limits from the server once we have a token.
    useEffect(() => {
        let active = true;
        dataService.getUploadConfig(user?.token)
            .then((cfg) => {
                if (!active || !cfg?.allowedTypes?.length) return;
                setUploadConfig({
                    allowedTypes: cfg.allowedTypes,
                    maxFileBytes: cfg.maxFileBytes || FALLBACK_UPLOAD_CONFIG.maxFileBytes,
                });
            })
            .catch(() => { /* keep the fallback */ });
        return () => { active = false; };
    }, [user?.token]);

    // Validate file before upload, against the server-provided limits.
    const validateFile = useCallback((file) => {
        const { maxFileBytes, allowedTypes } = uploadConfig;

        if (!file) {
            throw new Error('No file selected');
        }

        if (file.size > maxFileBytes) {
            const mb = Math.round(maxFileBytes / 1024 / 1024);
            throw new Error(`File size must be less than ${mb}MB (current: ${(file.size / 1024 / 1024).toFixed(2)}MB)`);
        }

        if (!allowedTypes.includes(file.type)) {
            throw new Error(`File type not supported: ${file.type}`);
        }

        return true;
    }, [uploadConfig]);

    // Upload file to S3 with complete workflow
    const uploadFile = useCallback(async (file, fileType = 'document', dataId = null) => {
        if (!user || !user.token) {
            throw new Error('Authentication required');
        }

        try {
            setUploading(true);
            setUploadProgress(0);

            // Validate file
            validateFile(file);

            console.log('Starting file upload workflow:', {
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                uploadType: fileType
            });

            // Step 1: Request pre-signed upload URL
            // Field names must match the backend contract
            // (controllers/fileUploadController.js#requestUploadUrl):
            // it requires `filename` + `contentType` + `fileSize`.
            const uploadUrlResponse = await dataService.requestUploadUrl({
                filename: file.name,
                contentType: file.type,
                fileSize: file.size,
                fileType,
                dataId
            }, user.token);

            if (!uploadUrlResponse?.success) {
                throw new Error(uploadUrlResponse?.error || 'Failed to get upload URL');
            }

            // The backend returns a FLAT object — { success, uploadUrl, s3Key,
            // cloudFrontUrl, expiresIn, metadata } — with no `.data` wrapper.
            const { uploadUrl, s3Key, cloudFrontUrl } = uploadUrlResponse;
            const publicUrl = cloudFrontUrl;

            // Step 2: Upload file directly to S3
            await dataService.uploadFileToS3(file, uploadUrl, (progress) => {
                setUploadProgress(progress);
            });

            // Step 3: Confirm upload and update database
            const confirmResponse = await dataService.confirmFileUpload({
                s3Key: s3Key,
                filename: file.name,
                contentType: file.type,
                fileSize: file.size,
                fileType,
                dataId
            }, user.token);

            if (!confirmResponse?.success) {
                throw new Error(confirmResponse?.error || 'Failed to confirm upload');
            }

            // Confirm returns { success, message, fileData, updatedItem? } —
            // there is no top-level `dataId`.
            const savedDataId = confirmResponse.updatedItem?.id || dataId || null;

            console.log('File upload completed successfully:', {
                s3Key,
                publicUrl,
                dataId: savedDataId
            });

            toast.success(`📁 File "${file.name}" uploaded successfully!`, {
                position: 'top-right',
                autoClose: 3000,
            });

            return {
                success: true,
                s3Key,
                publicUrl,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                dataId: savedDataId,
                data: confirmResponse.fileData
            };

        } catch (error) {
            console.error('File upload error:', error);
            
            toast.error(`❌ Upload failed: ${error.message}`, {
                position: 'top-right',
                autoClose: 5000,
            });

            throw error;
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    }, [user, validateFile]);

    // Delete uploaded file
    const deleteFile = useCallback(async (s3Key, dataId = null) => {
        if (!user || !user.token) {
            throw new Error('Authentication required');
        }

        try {
            console.log('Deleting file:', { s3Key, dataId });

            const response = await dataService.deleteUploadedFile(s3Key, dataId, user.token);

            if (!response.success) {
                throw new Error(response.error || 'Failed to delete file');
            }

            toast.success('🗑️ File deleted successfully!', {
                position: 'top-right',
                autoClose: 3000,
            });

            return response;

        } catch (error) {
            console.error('File delete error:', error);
            
            toast.error(`❌ Delete failed: ${error.message}`, {
                position: 'top-right',
                autoClose: 5000,
            });

            throw error;
        }
    }, [user]);

    // Upload multiple files
    const uploadMultipleFiles = useCallback(async (files, fileType = 'document', dataId = null) => {
        const results = [];
        const errors = [];

        for (let i = 0; i < files.length; i++) {
            try {
                const result = await uploadFile(files[i], fileType, dataId);
                results.push(result);
            } catch (error) {
                errors.push({
                    fileName: files[i].name,
                    error: error.message
                });
            }
        }

        if (errors.length > 0) {
            console.warn('Some files failed to upload:', errors);
        }

        return {
            success: results.length > 0,
            uploaded: results,
            errors: errors,
            total: files.length,
            successful: results.length,
            failed: errors.length
        };
    }, [uploadFile]);

    return {
        uploading,
        uploadProgress,
        uploadFile,
        deleteFile,
        uploadMultipleFiles,
        validateFile
    };
};

export default useFileUpload;