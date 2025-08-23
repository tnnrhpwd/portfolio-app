const AWS = require('aws-sdk');
const { logger } = require('../middleware/logger');

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamodb = new AWS.DynamoDB.DocumentClient();

// Optimized query builder for DynamoDB
class DynamoDBQueryBuilder {
  constructor(tableName) {
    this.params = {
      TableName: tableName
    };
  }

  // Use query instead of scan when possible
  query(keyCondition, expressionAttributeValues = {}) {
    this.params.KeyConditionExpression = keyCondition;
    this.params.ExpressionAttributeValues = expressionAttributeValues;
    this.operation = 'query';
    return this;
  }

  // Add filter expression
  filter(filterExpression, expressionAttributeValues = {}) {
    this.params.FilterExpression = filterExpression;
    this.params.ExpressionAttributeValues = {
      ...this.params.ExpressionAttributeValues,
      ...expressionAttributeValues
    };
    return this;
  }

  // Add projection (select specific attributes)
  project(attributes) {
    this.params.ProjectionExpression = Array.isArray(attributes) 
      ? attributes.join(', ') 
      : attributes;
    return this;
  }

  // Add limit
  limit(count) {
    this.params.Limit = count;
    return this;
  }

  // Add sorting
  scanIndexForward(ascending = true) {
    this.params.ScanIndexForward = ascending;
    return this;
  }

  // Execute the query
  async execute() {
    try {
      const startTime = Date.now();
      let result;

      if (this.operation === 'query') {
        result = await dynamodb.query(this.params).promise();
      } else {
        // Fallback to scan if query is not set
        result = await dynamodb.scan(this.params).promise();
      }

      const duration = Date.now() - startTime;
      logger.info('DynamoDB operation completed', {
        operation: this.operation || 'scan',
        table: this.params.TableName,
        duration,
        itemCount: result.Items.length,
        scannedCount: result.ScannedCount
      });

      return result;
    } catch (error) {
      logger.error('DynamoDB operation failed', {
        operation: this.operation || 'scan',
        table: this.params.TableName,
        error: error.message,
        params: this.params
      });
      throw error;
    }
  }
}

// Batch operations for better performance
const batchGet = async (tableName, keys, projectionExpression = null) => {
  const params = {
    RequestItems: {
      [tableName]: {
        Keys: keys
      }
    }
  };

  if (projectionExpression) {
    params.RequestItems[tableName].ProjectionExpression = projectionExpression;
  }

  try {
    const startTime = Date.now();
    const result = await dynamodb.batchGet(params).promise();
    const duration = Date.now() - startTime;

    logger.info('DynamoDB batch get completed', {
      table: tableName,
      requestedKeys: keys.length,
      retrievedItems: result.Responses[tableName]?.length || 0,
      duration
    });

    return result.Responses[tableName] || [];
  } catch (error) {
    logger.error('DynamoDB batch get failed', {
      table: tableName,
      error: error.message,
      requestedKeys: keys.length
    });
    throw error;
  }
};

const batchWrite = async (tableName, items) => {
  // DynamoDB batch write can handle max 25 items at a time
  const batches = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  const results = [];
  for (const batch of batches) {
    const params = {
      RequestItems: {
        [tableName]: batch.map(item => ({
          PutRequest: { Item: item }
        }))
      }
    };

    try {
      const startTime = Date.now();
      const result = await dynamodb.batchWrite(params).promise();
      const duration = Date.now() - startTime;

      logger.info('DynamoDB batch write completed', {
        table: tableName,
        itemCount: batch.length,
        duration
      });

      results.push(result);
    } catch (error) {
      logger.error('DynamoDB batch write failed', {
        table: tableName,
        error: error.message,
        itemCount: batch.length
      });
      throw error;
    }
  }

  return results;
};

// Paginated query helper
const paginatedQuery = async (tableName, keyCondition, expressionAttributeValues = {}, limit = 20, lastEvaluatedKey = null) => {
  const params = {
    TableName: tableName,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: expressionAttributeValues,
    Limit: limit
  };

  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }

  try {
    const result = await dynamodb.query(params).promise();
    return {
      items: result.Items,
      lastEvaluatedKey: result.LastEvaluatedKey,
      hasMore: !!result.LastEvaluatedKey
    };
  } catch (error) {
    logger.error('Paginated query failed', { error: error.message, params });
    throw error;
  }
};

module.exports = {
  DynamoDBQueryBuilder,
  batchGet,
  batchWrite,
  paginatedQuery,
  dynamodb
};
