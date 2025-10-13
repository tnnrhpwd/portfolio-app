// Static Assets Configuration
// CloudFront URLs for static assets stored on S3

// Base CloudFront domain
const CLOUDFRONT_DOMAIN = 'https://d32l7e4oaztkq2.cloudfront.net';

// Static Images
export const STATIC_IMAGES = {
    SIMPLE_GRAPHIC: `${CLOUDFRONT_DOMAIN}/static/images/simple_graphic.png`,
    // Add more static images here as needed
};

// Static Assets Helper Functions
export const getStaticImageUrl = (imageName) => {
    const imageKey = imageName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return STATIC_IMAGES[imageKey] || null;
};

// Fallback function for development or if CloudFront fails
export const getImageWithFallback = (cloudFrontUrl, fallbackUrl = null) => {
    // In development, you might want to use local assets
    // In production, always use CloudFront for performance
    if (process.env.NODE_ENV === 'development' && fallbackUrl) {
        return fallbackUrl;
    }
    return cloudFrontUrl;
};

export default STATIC_IMAGES;