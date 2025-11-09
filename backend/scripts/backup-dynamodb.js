// DynamoDB Backup Script
// Creates a backup of all items with files before migration

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

async function createBackup() {
    console.log('💾 Creating DynamoDB Backup Before Migration...\n');

    const backupDir = path.join(__dirname, 'migration-backups');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `dynamodb-backup-${timestamp}.json`);

    try {
        // Create backup directory
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
            console.log(`📁 Created backup directory: ${backupDir}`);
        }

        console.log('📊 Scanning DynamoDB for items with files...');
        
        let allItems = [];
        let lastEvaluatedKey = null;
        let totalScanned = 0;
        
        do {
            const scanParams = {
                TableName: 'Simple',
                FilterExpression: 'attribute_exists(files) AND size(files) > :zero',
                ExpressionAttributeValues: {
                    ':zero': 0
                },
                Limit: 100,
                ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
            };

            const scanResult = await dynamodb.send(new ScanCommand(scanParams));
            const items = scanResult.Items || [];
            
            allItems = allItems.concat(items);
            totalScanned += items.length;
            
            console.log(`   Scanned ${totalScanned} items with files...`);
            
            lastEvaluatedKey = scanResult.LastEvaluatedKey;
            
        } while (lastEvaluatedKey);

        // Create backup object
        const backup = {
            timestamp: new Date().toISOString(),
            totalItems: allItems.length,
            description: 'DynamoDB backup before S3 migration',
            items: allItems
        };

        // Write backup file
        fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
        
        console.log('\n✅ Backup completed successfully!');
        console.log(`📁 Backup file: ${backupFile}`);
        console.log(`📊 Items backed up: ${allItems.length}`);
        
        // Calculate backup file size
        const stats = fs.statSync(backupFile);
        const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`📏 Backup size: ${fileSizeMB} MB`);

        return backupFile;

    } catch (error) {
        console.error('❌ Backup failed:', error.message);
        throw error;
    }
}

// Restore function (in case of emergency)
async function restoreFromBackup(backupFile) {
    console.log('🔄 Restoring from backup...\n');
    
    try {
        if (!fs.existsSync(backupFile)) {
            throw new Error(`Backup file not found: ${backupFile}`);
        }

        const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
        console.log(`📊 Backup contains ${backupData.totalItems} items from ${backupData.timestamp}`);
        
        // Note: This would require implementing batch restore logic
        console.log('⚠️  Restore functionality would need to be implemented based on your specific needs');
        console.log('   For now, the backup file can be used for manual recovery if needed');
        
    } catch (error) {
        console.error('❌ Restore failed:', error.message);
        throw error;
    }
}

// Run backup if called directly
if (require.main === module) {
    createBackup().catch(console.error);
}

module.exports = { createBackup, restoreFromBackup };