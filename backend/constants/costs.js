/**
 * costs.js — third-party list prices used for cost ESTIMATES and admin
 * reporting (storage/cost dashboards).
 *
 * These are NOT billing truth: they are us-east-1 on-demand list prices,
 * region-dependent, and exclude requests, egress, CloudFront, and tax. Verify
 * against the AWS console / your invoice before making decisions on them.
 */

/** S3 storage price per GB-month, by storage class. */
const S3_USD_PER_GB_MONTH = Object.freeze({
    STANDARD: 0.023,
    STANDARD_IA: 0.0125,
    GLACIER_IR: 0.004,
});

/**
 * DynamoDB Standard table storage price per GB-month (us-east-1, on-demand).
 * ~10x S3 — this is why record data should stay small and file bytes belong in
 * S3. (First 25 GB/region is AWS Free Tier.)
 */
const DDB_USD_PER_GB_MONTH = 0.25;

/** Bytes → GB (GiB, which is what S3 bills in). */
const bytesToGb = (bytes) => (Number(bytes) || 0) / (1024 ** 3);

/**
 * Estimated monthly S3 storage cost in USD for a number of bytes.
 * @param {number} bytes
 * @param {keyof typeof S3_USD_PER_GB_MONTH} [storageClass]
 */
function estimateS3StorageCost(bytes, storageClass = 'STANDARD') {
    const rate = S3_USD_PER_GB_MONTH[storageClass] ?? S3_USD_PER_GB_MONTH.STANDARD;
    return bytesToGb(bytes) * rate;
}

/** Estimated monthly DynamoDB table storage cost in USD. */
function estimateDynamoStorageCost(bytes) {
    return bytesToGb(bytes) * DDB_USD_PER_GB_MONTH;
}

module.exports = {
    S3_USD_PER_GB_MONTH,
    DDB_USD_PER_GB_MONTH,
    bytesToGb,
    estimateS3StorageCost,
    estimateDynamoStorageCost,
};
