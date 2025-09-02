// Image compression utilities
import { toast } from 'react-toastify';

/**
 * Compress image using Canvas API (client-side)
 * @param {File} file - The image file to compress
 * @param {number} maxSizeKB - Maximum size in KB
 * @returns {Promise<File>} - Compressed file
 */
export const compressImageCanvas = (file, maxSizeKB = 280) => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      // Calculate new dimensions
      let { width, height } = img;
      const maxDimension = 1200;
      
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width *= ratio;
        height *= ratio;
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      // Compress with decreasing quality until size is acceptable
      let quality = 0.9;
      
      const compress = () => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to compress image'));
            return;
          }
          
          if (blob.size <= maxSizeKB * 1024 || quality <= 0.1) {
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          } else {
            quality -= 0.1;
            compress();
          }
        }, 'image/jpeg', quality);
      };
      
      compress();
    };
    
    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };
    
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Compress image using CompressAPI (external API)
 * Note: This is an alternative method that requires an API key
 * @param {File} file - The image file to compress
 * @returns {Promise<File>} - Compressed file
 */
export const compressImageAPI = async (file) => {
  // This is an example using CompressAPI.org
  // You would need to sign up and get an API key
  const API_KEY = process.env.REACT_APP_COMPRESS_API_KEY;
  
  if (!API_KEY) {
    console.warn('No compression API key found, falling back to canvas compression');
    return compressImageCanvas(file);
  }
  
  try {
    const formData = new FormData();
    formData.append('image', file);
    
    const response = await fetch('https://api.compress-image.io/compress', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      },
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('API compression failed');
    }
    
    const blob = await response.blob();
    return new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
  } catch (error) {
    console.warn('API compression failed, falling back to canvas:', error);
    return compressImageCanvas(file);
  }
};

/**
 * Process multiple files with compression
 * @param {FileList|File[]} files - Files to process
 * @param {Object} options - Processing options
 * @returns {Promise<File[]>} - Processed files
 */
export const processFilesWithCompression = async (files, options = {}) => {
  const {
    maxFileSize = 280 * 1024, // 280KB per file
    maxTotalSize = 350 * 1024, // 350KB total
    useAPI = false // Whether to use API compression
  } = options;
  
  const processedFiles = [];
  const fileArray = Array.from(files);
  
  console.log(`Processing ${fileArray.length} files...`);
  
  for (const file of fileArray) {
    let processedFile = file;
    
    try {
      if (file.type.startsWith('image/')) {
        if (file.size > maxFileSize) {
          console.log(`Compressing image: ${file.name} (${Math.round(file.size/1024)}KB)`);
          
          processedFile = useAPI 
            ? await compressImageAPI(file)
            : await compressImageCanvas(file, 280);
          
          console.log(`Compressed to: ${Math.round(processedFile.size/1024)}KB`);
          
          toast.success(`📸 Compressed ${file.name} from ${Math.round(file.size/1024)}KB to ${Math.round(processedFile.size/1024)}KB`, {
            autoClose: 3000
          });
        } else {
          console.log(`Image ${file.name} is already optimized (${Math.round(file.size/1024)}KB)`);
        }
      } else {
        // For non-images, just check size limit
        if (file.size > maxFileSize) {
          toast.error(`File ${file.name} (${Math.round(file.size/1024)}KB) is too large. Maximum size is 280KB for non-image files.`);
          continue;
        }
      }
      
      processedFiles.push(processedFile);
    } catch (error) {
      console.error(`Error processing ${file.name}:`, error);
      toast.error(`Failed to process ${file.name}. Please try a different file.`);
    }
  }
  
  // Check total size
  const totalSize = processedFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > maxTotalSize) {
    toast.error(`Total file size (${Math.round(totalSize/1024)}KB) exceeds limit of 350KB. Please select fewer files.`);
    return [];
  }
  
  console.log(`Successfully processed ${processedFiles.length} files, Total: ${Math.round(totalSize/1024)}KB`);
  return processedFiles;
};

const imageCompressionUtils = {
  compressImageCanvas,
  compressImageAPI,
  processFilesWithCompression
};

export default imageCompressionUtils;
