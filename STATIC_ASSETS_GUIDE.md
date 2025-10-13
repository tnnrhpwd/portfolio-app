# Static Assets Management Guide

This guide explains how to properly manage static assets (images, videos, documents) using AWS S3 and CloudFront for optimal performance.

## Why Use S3 + CloudFront for Static Assets?

### Benefits:
- **Smaller Bundle Size**: Removes large files from your frontend build
- **Global CDN**: CloudFront delivers assets from edge locations worldwide
- **Better Caching**: Long-term browser and CDN caching for static assets
- **Scalability**: No server load for serving static files
- **Cost Effective**: S3 storage + CloudFront is very cost-efficient

### Performance Impact:
- **Bundle Size Reduction**: Moving `simple_graphic.png` (6.4MB) to S3 reduced frontend bundle by ~6.4MB
- **Faster Initial Load**: Smaller bundle = faster initial page load
- **Lazy Loading**: Images load as needed, not blocking initial render
- **Global Performance**: CloudFront edge locations serve files closer to users

## Current Configuration

### S3 Bucket: `sthopwood`
- Region: `us-east-1`
- Public read access via bucket policy
- Organized folder structure

### CloudFront Domain: `d32l7e4oaztkq2.cloudfront.net`
- Global CDN distribution
- 1-year cache TTL for static assets
- Automatic compression and optimization

## Folder Structure

```
S3 Bucket: sthopwood/
├── static/
│   ├── images/
│   │   ├── simple_graphic.png          # System overview graphic
│   │   └── [other-static-images]
│   ├── videos/
│   │   └── [promotional-videos]
│   └── documents/
│       └── [pdfs-guides-etc]
├── users/
│   └── {userId}/
│       ├── uploads/                     # User uploaded files
│       └── migrated/                    # Migrated from DynamoDB
└── temp/
    └── [temporary-files]
```

## How to Add New Static Assets

### 1. Upload to S3
```bash
# Use the upload script
node upload-static-assets.js

# Or add to the assets array in upload-static-assets.js:
{
    localPath: '../frontend/src/assets/new-image.png',
    s3Key: 'static/images/new-image.png',
    description: 'Description of the image'
}
```

### 2. Add to Frontend Configuration
Update `frontend/src/config/staticAssets.js`:
```javascript
export const STATIC_IMAGES = {
    SIMPLE_GRAPHIC: `${CLOUDFRONT_DOMAIN}/static/images/simple_graphic.png`,
    NEW_IMAGE: `${CLOUDFRONT_DOMAIN}/static/images/new-image.png`,
    // Add more assets here
};
```

### 3. Use in Components
```javascript
import { STATIC_IMAGES } from '../../../config/staticAssets';

function MyComponent() {
    return (
        <img 
            src={STATIC_IMAGES.NEW_IMAGE}
            alt="Description"
            loading="lazy"
            onLoad={() => console.log('Image loaded from CloudFront')}
            onError={(e) => console.error('Failed to load image')}
        />
    );
}
```

## Best Practices

### Image Optimization
1. **Compress images** before uploading (use tools like TinyPNG, ImageOptim)
2. **Choose correct format**:
   - PNG: For graphics with transparency or text
   - JPEG: For photos and complex images
   - WebP: Modern format with better compression (when supported)
3. **Provide alt text** for accessibility
4. **Use lazy loading** for images below the fold

### Performance
1. **Set proper cache headers**: Static assets use 1-year cache
2. **Use responsive images**: Consider different sizes for mobile/desktop
3. **Optimize loading**: Use `loading="lazy"` for non-critical images
4. **Monitor bundle size**: Keep frontend bundle lightweight

### Security
1. **Public assets only**: Never upload sensitive files to public folders
2. **Content validation**: Validate file types and sizes
3. **Access control**: Use appropriate S3 bucket policies

## Migration Checklist

When moving an asset from frontend bundle to S3:

- [ ] Upload file to S3 using upload script
- [ ] Verify CloudFront URL is accessible
- [ ] Add URL to `staticAssets.js` configuration
- [ ] Update component to use CloudFront URL
- [ ] Test loading and error handling
- [ ] Remove local file from frontend
- [ ] Update any build scripts or references
- [ ] Document the change

## Troubleshooting

### Image Not Loading
1. Check CloudFront URL in browser directly
2. Verify S3 bucket policy allows public access
3. Check browser console for CORS errors
4. Ensure content-type is set correctly

### Cache Issues
1. CloudFront has ~15 minutes propagation delay
2. Use CloudFront invalidation for urgent updates
3. Add cache busting for dynamic content

### Performance Issues
1. Optimize image sizes and formats
2. Use lazy loading for non-critical images
3. Consider responsive images for different screen sizes
4. Monitor Core Web Vitals

## Tools and Scripts

### Available Scripts:
- `upload-static-assets.js`: Upload static assets to S3
- `migrate-images-to-s3.js`: Migrate existing DynamoDB images
- `backup-dynamodb.js`: Create backups before migrations

### Monitoring:
- CloudWatch: Monitor S3 and CloudFront metrics
- Browser DevTools: Check loading performance
- Lighthouse: Monitor Core Web Vitals

## Cost Optimization

### S3 Storage Classes:
- **Standard**: For frequently accessed assets
- **IA (Infrequent Access)**: For older promotional materials
- **Glacier**: For long-term archive of assets

### CloudFront:
- Monitor usage and costs in AWS Console
- Consider geographic restrictions if needed
- Use Origin Access Identity for better security

## Environment Variables

Required in `.env`:
```properties
AWS_S3_BUCKET=sthopwood
AWS_S3_REGION=us-east-1
AWS_CLOUDFRONT_DOMAIN=d32l7e4oaztkq2.cloudfront.net
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

## Support

For issues with static assets:
1. Check AWS Console for S3 and CloudFront status
2. Verify environment variables are correct
3. Test URLs directly in browser
4. Check browser console for errors
5. Review this documentation for best practices