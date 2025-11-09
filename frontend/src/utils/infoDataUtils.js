import { toast } from 'react-toastify';

/**
 * Parse item data from different data structures (MongoDB vs DynamoDB)
 * @param {Object} selectedItem - The data item to parse
 * @returns {string} The item string data
 */
export const parseItemData = (selectedItem) => {
  // Handle different data structures (direct text vs nested data object)
  if (selectedItem.text) {
    // DynamoDB structure: direct text property
    return selectedItem.text;
  } else if (selectedItem.data) {
    // MongoDB structure: data property (string or object)
    return typeof selectedItem.data === 'string' ? selectedItem.data : selectedItem.data.text;
  } else {
    console.error('Unknown data structure:', selectedItem);
    return '';
  }
};

/**
 * Extract user ID from item string (handles both MongoDB and DynamoDB IDs)
 * @param {string} itemString - The item data string
 * @returns {string} The extracted user ID
 */
export const extractUserID = (itemString) => {
  // Handle both MongoDB ObjectIds (24 chars) and DynamoDB IDs (32 chars)
  const mongoIdMatch = itemString.match(/Creator:([a-f0-9]{24})\|/);
  const dynamoIdMatch = itemString.match(/Creator:([a-f0-9]{32})\|/);
  
  if (mongoIdMatch) {
    return mongoIdMatch[1];
  } else if (dynamoIdMatch) {
    return dynamoIdMatch[1];
  }
  return '';
};

/**
 * Find the target item from an array of data items
 * @param {Array} planObject - Array of data items
 * @param {string} id - The target ID to find
 * @param {number} toastDuration - Toast notification duration
 * @returns {Object|null} The found item or null
 */
export const findTargetItem = (planObject, id, toastDuration) => {
  console.log('=== DEBUG: handleAllOutputData called ===');
  console.log('PlanObject type:', typeof planObject);
  console.log('PlanObject value:', planObject);
  console.log('PlanObject is array:', Array.isArray(planObject));
  console.log('PlanObject length:', planObject ? planObject.length : 'N/A');
  console.log('Current ID being searched:', id);
  
  // Validate input
  if (!planObject || planObject.length === 0) {
    console.warn(`❌ No data found for ID: ${id}`);
    return null;
  } else {
    console.log('✅ Data found successfully');
    const dataPreview = JSON.stringify(planObject).length > 100 
      ? JSON.stringify(planObject).substring(0, 100) + "..."
      : JSON.stringify(planObject);
    console.log('PlanObject preview:', dataPreview);
  }
  
  // Find the specific item that matches the URL ID parameter
  let targetItem = planObject.find(item => {
    const itemId = item._id || item.id;
    return itemId === id;
  });
  
  // If we didn't find an exact ID match, check if we got a comment about this ID
  if (!targetItem) {
    console.log('=== No exact ID match found, checking for comments about this ID ===');
    const commentAboutId = planObject.find(item => {
      const itemText = item.data?.text || item.text || '';
      return itemText.includes(`Comment:${id}|`);
    });
    
    if (commentAboutId) {
      console.log('Found comment about target ID, but target item not found');
      console.log('This suggests the original item may have been deleted or is not accessible');
      toast.error(`Original item ${id.substring(0, 10)}... not found. Only comments about it exist.`, { autoClose: toastDuration });
      
      // Return a placeholder object
      return {
        data: `Original item with ID ${id} not found. This item may have been deleted or you may not have permission to view it.`,
        userID: 'system',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _id: id,
        files: [],
      };
    }
  }
  
  if (!targetItem) {
    console.log('=== DEBUGGING: Available items analysis ===');
    console.log('Total items returned:', planObject.length);
    planObject.forEach((item, index) => {
      console.log(`Item ${index}:`);
      console.log('  - _id:', item._id);
      console.log('  - id:', item.id);
      console.log('  - text preview:', (item.text || item.data?.text || JSON.stringify(item.data) || 'No text found').substring(0, 100));
      console.log('  - full item keys:', Object.keys(item));
    });
    console.log('Search ID we are looking for:', id);
    console.log('=== END DEBUGGING ===');
    return null;
  }
  
  console.log('✅ Found target item with matching ID');
  return targetItem;
};

/**
 * Format file data from different structures
 * @param {Object} selectedItem - The data item
 * @returns {Array} Array of formatted file objects
 */
export const formatFileData = (selectedItem) => {
  // Handle different file structures
  let itemFiles = [];
  if (selectedItem.files) {
    // Direct files property
    itemFiles = selectedItem.files;
  } else if (selectedItem.data?.files) {
    // Nested in data object
    itemFiles = selectedItem.data.files;
  }
  return itemFiles;
};

/**
 * Process data array and extract the target item
 * @param {Array} planObject - Array of data items
 * @param {string} id - The target ID
 * @param {number} toastDuration - Toast duration
 * @returns {Object|null} Formatted chosen data object
 */
export const processDataArray = (planObject, id, toastDuration) => {
  const targetItem = findTargetItem(planObject, id, toastDuration);
  
  if (!targetItem) {
    return null;
  }
  
  const selectedItem = targetItem;
  const itemString = parseItemData(selectedItem);
  const itemUserID = extractUserID(itemString);
  const itemCreatedAt = selectedItem.createdAt;
  const itemUpdatedAt = selectedItem.updatedAt;
  const itemID = selectedItem._id || selectedItem.id;
  const itemFiles = formatFileData(selectedItem);
  
  // Truncate individual item console log
  const itemPreview = JSON.stringify(selectedItem).length > 100 
    ? JSON.stringify(selectedItem).substring(0, 100) + "..."
    : JSON.stringify(selectedItem);
  console.log('Item preview:', itemPreview);
  
  return {
    data: itemString,
    userID: itemUserID,
    createdAt: itemCreatedAt,
    updatedAt: itemUpdatedAt,
    _id: itemID,
    files: itemFiles,
  };
};
