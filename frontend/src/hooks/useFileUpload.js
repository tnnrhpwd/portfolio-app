import { useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import dataService from '../features/data/dataService';
import { toast } from 'react-toastify';

export const useFileUpload = () => {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    
    const { user } = useSelector((state) => state.auth);

    // Validate file before upload
    const validateFile = useCallback((file) => {
        const maxSize = 50 * 1024 * 1024; // 50MB
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'text/plain', 'text/csv',
            'application/json',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];

        if (!file) {
            throw new Error('No file selected');
        }

        if (file.size > maxSize) {
            throw new Error(`File size must be less than 50MB (current: ${(file.size / 1024 / 1024).toFixed(2)}MB)`);
        }

        if (!allowedTypes.includes(file.type)) {
            throw new Error(`File type not supported: ${file.type}`);
        }

        return true;
    }, []);

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
            const uploadUrlResponse = await dataService.requestUploadUrl({
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                uploadType: fileType,
                dataId: dataId
            }, user.token);

            if (!uploadUrlResponse.success) {
                throw new Error(uploadUrlResponse.error || 'Failed to get upload URL');
            }

            const { uploadUrl, s3Key, publicUrl } = uploadUrlResponse.data;

            // Step 2: Upload file directly to S3
            await dataService.uploadFileToS3(file, uploadUrl, (progress) => {
                setUploadProgress(progress);
            });

            // Step 3: Confirm upload and update database
            const confirmResponse = await dataService.confirmFileUpload({
                s3Key: s3Key,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                uploadType: fileType,
                dataId: dataId
            }, user.token);

            if (!confirmResponse.success) {
                throw new Error(confirmResponse.error || 'Failed to confirm upload');
            }

            console.log('File upload completed successfully:', {
                s3Key,
                publicUrl,
                dataId: confirmResponse.dataId
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
                dataId: confirmResponse.dataId,
                data: confirmResponse.data
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