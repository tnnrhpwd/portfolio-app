# AWS S3 + CloudFront Setup Guide

## Overview
This guide will help you set up AWS S3 and CloudFront for your portfolio app following Gemini's recommended workflow. Your app is already fully coded and ready - you just need to configure the AWS resources.

## Step 1: Create S3 Bucket

### 1.1 Create the Bucket
```bash
# Using AWS CLI (or use AWS Console)
aws s3 mb s3://sthopwood-portfolio-files --region us-east-1
```

**Or via AWS Console:**
1. Go to S3 in AWS Console
2. Click "Create bucket"
3. Bucket name: `sthopwood-portfolio-files`
4. Region: `US East (N. Virginia) us-east-1`
5. Block all public access: ✅ **KEEP CHECKED** (CloudFront will access privately)
6. Create bucket

### 1.2 Configure CORS Policy
```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
        "AllowedOrigins": [
            "https://sthopwood.com",
            "https://www.sthopwood.com", 
            "http://localhost:3000",
            "http://localhost:5000"
        ],
        "ExposeHeaders": ["ETag", "x-amz-meta-*"]
    }
]
```

**To apply CORS:**
1. Go to your S3 bucket → Permissions tab
2. Scroll to "Cross-origin resource sharing (CORS)"
3. Click Edit and paste the JSON above
4. Save changes

## Step 2: Create CloudFront Distribution

### 2.1 Create Distribution
1. Go to CloudFront in AWS Console
2. Click "Create Distribution"
3. Configure as follows:

**Origin Settings:**
- Origin Domain: `sthopwood-portfolio-files.s3.us-east-1.amazonaws.com`
- Origin Path: (leave empty)
- Name: `sthopwood-s3-origin`
- Origin Access: **Origin Access Control (OAC)** ← IMPORTANT!
- Create new OAC if needed

**Default Cache Behavior:**
- Viewer Protocol Policy: `Redirect HTTP to HTTPS`
- Allowed HTTP Methods: `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`
- Cache Headers: `Cache based on selected request headers`
- Select: `Origin`
- TTL Settings: Default (86400 seconds)

**Distribution Settings:**
- Price Class: Use all edge locations (best performance)
- WAF: Do not enable WAF
- Description: "Portfolio App File Delivery"

4. **Create Distribution** (takes 10-15 minutes to deploy)

### 2.2 Update S3 Bucket Policy
After creating CloudFront, you need to allow CloudFront access to your private S3 bucket:

1. Go back to S3 bucket → Permissions → Bucket policy
2. Add this policy (replace `E1234567890123` with your CloudFront distribution ID):

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowCloudFrontServicePrincipal",
            "Effect": "Allow",
            "Principal": {
                "Service": "cloudfront.amazonaws.com"
            },
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::sthopwood-portfolio-files/*",
            "Condition": {
                "StringEquals": {
                    "AWS:SourceArn": "arn:aws:cloudfront::YOUR_ACCOUNT_ID:distribution/YOUR_DISTRIBUTION_ID"
                }
            }
        }
    ]
}
```

## Step 3: Update Environment Variables

Update your `.env` file with the actual CloudFront domain:

```env
# After CloudFront deploys, you'll get a domain like:
AWS_CLOUDFRONT_DOMAIN=d1234abcd5678.cloudfront.net

# Verify these are correct:
AWS_S3_BUCKET=sthopwood-portfolio-files
AWS_S3_REGION=us-east-1
USE_CLOUDFRONT=true
```

## Step 4: Test the Setup

### 4.1 Test File Upload
1. Start your backend server
2. Log into your app
3. Go to any InfoData page
4. Click "Show Upload" and try uploading an image
5. Verify the file appears with cloud storage indicator

### 4.2 Test CloudFront Delivery
1. After uploading, check the Network tab in browser dev tools
2. Image requests should come from your CloudFront domain
3. First load may be slow (cache miss), subsequent loads should be fast

### 4.3 Test OCR Processing
1. Upload an image file
2. Use the OCR extraction feature
3. Verify it works with S3 URLs (no more connection resets!)

## The Complete Workflow (As Implemented)

### File Upload Process:
1. **Frontend** → Requests pre-signed URL from backend
2. **Backend** → Generates pre-signed S3 URL (15-minute expiration)
3. **Frontend** → Uploads file directly to S3 using pre-signed URL
4. **Backend** → Confirms upload and stores metadata in DynamoDB
5. **Frontend** → Updates UI with file information

### File Display Process:
1. **Frontend** → Requests data from backend
2. **Backend** → Queries DynamoDB for file metadata (including S3 keys)
3. **Frontend** → Constructs CloudFront URLs using S3 keys
4. **Browser** → Requests files from CloudFront
5. **CloudFront** → Serves from cache or fetches from S3

### OCR Processing:
1. **Frontend** → Sends S3 CloudFront URL to backend OCR service
2. **Backend** → XAI Vision API processes image from URL (no base64!)
3. **Result** → No more connection resets, fast processing

## Security Features Implemented

✅ **Private S3 Bucket** - Only CloudFront can access files
✅ **Pre-signed URLs** - Temporary upload permissions (15 minutes)
✅ **File Validation** - Type, size, and name sanitization  
✅ **User Isolation** - Files organized by user ID
✅ **CORS Protection** - Only your domains can upload
✅ **Metadata Tracking** - Who uploaded what and when

## Performance Benefits

⚡ **Global CDN** - CloudFront serves files from 400+ edge locations
⚡ **Direct Uploads** - Large files bypass your backend server
⚡ **Caching** - Repeated requests served instantly from cache
⚡ **Compression** - CloudFront automatically compresses compatible files

## Cost Optimization

💰 **Intelligent Tiering** - S3 automatically moves old files to cheaper storage
💰 **CloudFront Caching** - Reduces S3 requests (saves bandwidth costs)
💰 **Pre-signed URLs** - No server processing time for uploads

## Monitoring & Troubleshooting

### CloudWatch Metrics to Watch:
- S3: `BucketSizeBytes`, `NumberOfObjects`
- CloudFront: `Requests`, `BytesDownloaded`, `CacheHitRate`

### Common Issues:
1. **403 Errors**: Check S3 bucket policy allows CloudFront access
2. **CORS Errors**: Verify CORS policy includes your domain
3. **Upload Fails**: Check S3 permissions and pre-signed URL expiration
4. **Slow Loading**: CloudFront may need time to cache files

## Next Steps After Setup

1. **Test thoroughly** with different file types
2. **Monitor costs** in AWS Billing dashboard  
3. **Consider** enabling S3 Transfer Acceleration for global uploads
4. **Set up** CloudWatch alarms for cost/usage monitoring
5. **Implement** file cleanup policies for old files

Your implementation follows industry best practices and is production-ready! 🚀