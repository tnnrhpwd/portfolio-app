// DynamoDB doesn't enforce a schema, but we can define the structure we'll use.
// This is more for documentation and consistency.

const dataModel = {
  id: { type: String, description: 'Unique ID' },
  text: { type: String, description: 'Main text data' },
  ActionGroupObject: { type: Object, description: 'Action group object' },
  files: { type: Array, description: 'Array of file objects' },
  createdAt: { type: String, description: 'Creation timestamp' },
  updatedAt: { type: String, description: 'Update timestamp' }
};

module.exports = dataModel;
