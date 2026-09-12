// DynamoDB to S3 Migration Script
// This script migrates existing base64 images from DynamoDB to S3 and updates records
//
// DRY RUN by default, like every other script in this directory:
//   node backend/scripts/migrate-images-to-s3.js            # dry run (safe)
//   node backend/scripts/migrate-images-to-s3.js --apply    # upload + rewrite rows
//
// The dry run still reads the table (one paginated scan) but uploads nothing and
// writes nothing, so it is safe to run against production to see what is pending.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
require('dotenv').config();

const { loadAllSecrets } = require('../utils/awsSecrets');

// Clients and bucket name are built in initAws(), not at module load: backend/.env
// only holds the access keys (no AWS_REGION, no bucket), so a module-load client
// was constructed with `region: undefined` and the script died with the opaque
// SDK error "Region is missing" before it could do anything. initAws() hydrates
// from Secrets Manager first — the same bootstrap server.js and the sibling
// scripts (configure-s3-lifecycle, configure-analytics-ttl) use.
let dynamodb = null;
let s3Client = null;
let BUCKET_NAME = null;

async function initAws() {
    await loadAllSecrets();

    const region = process.env.AWS_S3_REGION || process.env.AWS_REGION;
    const credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };

    BUCKET_NAME = process.env.AWS_S3_BUCKET;

    const missing = [];
    if (!region) missing.push('AWS_REGION (or AWS_S3_REGION)');
    if (!BUCKET_NAME) missing.push('AWS_S3_BUCKET');
    if (missing.length) {
        throw new Error(
            `Missing AWS config: ${missing.join(', ')}. Put them in backend/.env, `
            + 'or make sure loadAllSecrets() can read portfolio-app/production.'
        );
    }

    dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials }));
    s3Client = new S3Client({ region, credentials });

    return { region, bucket: BUCKET_NAME };
}

const TABLE_NAME = 'Simple';
const BATCH_SIZE = 10; // Process in small batches to avoid overwhelming services

// Dry run unless explicitly told otherwise, matching every other script in this
// directory (configure-s3-lifecycle, archive-legacy-goals, migrate-goals-…).
// This used to be a hand-edited constant that shipped as `false`, so running the
// script with no arguments uploaded to S3 and rewrote the DynamoDB `files` arrays
// on live data with no flag, no prompt and no dry-run pass first.
const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

// Helper function to generate S3 key
const generateS3Key = (userId, originalFilename, fileType = 'migrated') => {
    const timestamp = Date.now();
    const uniqueId = randomUUID().substring(0, 8);
    const extension = originalFilename ? originalFilename.split('.').pop() : 'jpg';
    
    return `users/${userId}/${fileType}/${timestamp}_${uniqueId}.${extension}`;
};

// Helper function to upload file to S3
const uploadToS3 = async (s3Key, base64Data, contentType, metadata = {}) => {
    try {
        // Convert base64 to buffer
        const buffer = Buffer.from(base64Data, 'base64');
        
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: buffer,
            ContentType: contentType,
            Metadata: {
                'migrated-from': 'dynamodb',
                'migration-date': new Date().toISOString(),
                ...metadata
            }
        });

        await s3Client.send(command);
        
        // Generate CloudFront URL
        const cloudFrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN;
        const publicUrl = cloudFrontDomain && cloudFrontDomain !== 'your-cloudfront-domain.cloudfront.net' 
            ? `https://${cloudFrontDomain}/${s3Key}`
            : `https://${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${s3Key}`;
            
        return { s3Key, publicUrl };
    } catch (error) {
        throw new Error(`S3 upload failed: ${error.message}`);
    }
};

// Helper function to extract user ID from text
const extractUserId = (text) => {
    if (!text) return null;
    
    // Try to extract from Creator:userId format
    const creatorMatch = text.match(/Creator:([a-f0-9]{24,32})\|/);
    if (creatorMatch) return creatorMatch[1];
    
    // Try other patterns if needed
    return null;
};

// Main migration function
async function migrateImagesToS3() {
    // Hydrate config from Secrets Manager before anything reads it.
    await initAws();

    console.log('🚀 Starting DynamoDB to S3 Image Migration...\n');
    console.log(`📊 Configuration:`);
    console.log(`   S3 Bucket: ${BUCKET_NAME}`);
    console.log(`   DynamoDB Table: ${TABLE_NAME}`);
    console.log(`   Batch Size: ${BATCH_SIZE}`);
    console.log(`   Dry Run: ${DRY_RUN ? 'YES (no changes will be made)' : 'NO (will perform actual migration)'}`);
    
    let migrationStats = {
        totalItems: 0,
        itemsWithFiles: 0,
        imagesFound: 0,
        imagesMigrated: 0,
        imagesWouldMigrate: 0,
        errors: 0,
        skipped: 0
    };

    try {
        // Step 1: Scan DynamoDB for items with files
        console.log('\n📋 Step 1: Scanning DynamoDB for items with base64 images...');
        
        let lastEvaluatedKey = null;
        let batchCount = 0;
        
        do {
            const scanParams = {
                TableName: TABLE_NAME,
                FilterExpression: 'attribute_exists(files) AND size(files) > :zero',
                ExpressionAttributeValues: {
                    ':zero': 0
                },
                Limit: 100, // Scan in chunks
                ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
            };

            const scanResult = await dynamodb.send(new ScanCommand(scanParams));
            const items = scanResult.Items || [];
            
            console.log(`   Found ${items.length} items with files in batch ${++batchCount}`);
            migrationStats.totalItems += items.length;

            // Process items in smaller batches
            for (let i = 0; i < items.length; i += BATCH_SIZE) {
                const batch = items.slice(i, i + BATCH_SIZE);
                await processBatch(batch, migrationStats);
                
                // Small delay to avoid overwhelming services
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            lastEvaluatedKey = scanResult.LastEvaluatedKey;
            
        } while (lastEvaluatedKey);

        // Final statistics
        console.log('\n📊 Migration Complete!');
        console.log('=' .repeat(50));
        console.log(`📁 Total items scanned: ${migrationStats.totalItems}`);
        console.log(`🗂️  Items with files: ${migrationStats.itemsWithFiles}`);
        console.log(`🖼️  Images found: ${migrationStats.imagesFound}`);
        console.log(`☁️  Images migrated: ${migrationStats.imagesMigrated}`);
        if (DRY_RUN) {
            // Reported separately so a dry run can never be read as "N images were
            // migrated" — the old code incremented imagesMigrated in this branch.
            console.log(`☁️  Images that WOULD be migrated: ${migrationStats.imagesWouldMigrate}`);
        }
        console.log(`⏭️  Items skipped: ${migrationStats.skipped}`);
        console.log(`❌ Errors: ${migrationStats.errors}`);
        
        if (DRY_RUN) {
            console.log('\n⚠️  DRY RUN — nothing was uploaded and nothing was written.');
            console.log('   Re-run with --apply to perform the migration for real.');
        }

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

// Process a batch of items
async function processBatch(items, stats) {
    for (const item of items) {
        try {
            if (!item.files || !Array.isArray(item.files) || item.files.length === 0) {
                stats.skipped++;
                continue;
            }

            stats.itemsWithFiles++;
            
            // Extract user ID for folder organization
            const userId = extractUserId(item.text) || 'unknown';
            
            console.log(`\n🔍 Processing item ${item.id} (User: ${userId.substring(0, 8)}...)`);
            
            const migratedFiles = [];
            let hasChanges = false;

            for (let fileIndex = 0; fileIndex < item.files.length; fileIndex++) {
                const file = item.files[fileIndex];
                
                // Check if file is base64 image that needs migration
                if (file.data && file.contentType && file.contentType.startsWith('image/') && !file.s3Key) {
                    stats.imagesFound++;
                    
                    console.log(`   📷 Migrating image: ${file.filename || 'untitled'} (${file.contentType})`);
                    
                    if (!DRY_RUN) {
                        try {
                            // Upload to S3
                            const s3Result = await uploadToS3(
                                generateS3Key(userId, file.filename, 'migrated'),
                                file.data,
                                file.contentType,
                                {
                                    'original-filename': file.filename || 'unknown',
                                    'user-id': userId,
                                    'item-id': item.id
                                }
                            );

                            // Create new file object with S3 references
                            const migratedFile = {
                                s3Key: s3Result.s3Key,
                                publicUrl: s3Result.publicUrl,
                                fileName: file.filename,
                                fileSize: Buffer.from(file.data, 'base64').length,
                                fileType: file.contentType,
                                uploadedAt: new Date().toISOString(),
                                migratedFrom: 'dynamodb'
                            };

                            migratedFiles.push(migratedFile);
                            hasChanges = true;
                            stats.imagesMigrated++;
                            
                            console.log(`   ✅ Uploaded to S3: ${s3Result.s3Key}`);
                            
                        } catch (uploadError) {
                            console.error(`   ❌ Upload failed: ${uploadError.message}`);
                            // Keep original file if upload fails
                            migratedFiles.push(file);
                            stats.errors++;
                        }
                    } else {
                        console.log(`   📋 Would migrate: ${file.filename} → S3`);
                        migratedFiles.push(file); // Keep original in dry run
                        stats.imagesWouldMigrate++;
                    }
                } else if (file.s3Key) {
                    console.log(`   ⏭️  Skipping already migrated file: ${file.s3Key}`);
                    migratedFiles.push(file);
                } else {
                    console.log(`   ⏭️  Skipping non-image file: ${file.filename} (${file.contentType})`);
                    migratedFiles.push(file);
                }
            }

            // Update DynamoDB record if changes were made
            if (hasChanges && !DRY_RUN) {
                try {
                    const updateParams = {
                        TableName: TABLE_NAME,
                        Key: { 
                            id: item.id,
                            createdAt: item.createdAt
                        },
                        UpdateExpression: 'SET files = :files, updatedAt = :updatedAt',
                        ExpressionAttributeValues: {
                            ':files': migratedFiles,
                            ':updatedAt': new Date().toISOString()
                        }
                    };

                    await dynamodb.send(new UpdateCommand(updateParams));
                    console.log(`   ✅ Updated DynamoDB record`);
                    
                } catch (updateError) {
                    console.error(`   ❌ DynamoDB update failed: ${updateError.message}`);
                    stats.errors++;
                }
            }

        } catch (error) {
            console.error(`❌ Error processing item ${item.id}:`, error.message);
            stats.errors++;
        }
    }
}

// Run migration
if (require.main === module) {
    migrateImagesToS3().catch(console.error);
}

module.exports = { migrateImagesToS3 };