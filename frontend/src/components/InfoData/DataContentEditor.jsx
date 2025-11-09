import React from 'react';

/**
 * Data content editor textarea component
 * @param {string} value - The current text value
 * @param {Function} onChange - Handler for text changes
 * @param {boolean} isOwner - Whether the current user owns this data
 */
const DataContentEditor = ({ value, onChange, isOwner }) => {
  return (
    <div className='infodata-data-content'>
      <label htmlFor="dataTextArea" className='infodata-data-label'>
        Data Content (Always Editable):
      </label>
      <textarea
        id="dataTextArea"
        className="infodata-data-textarea infodata-data-textarea-editing"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter your data content here..."
        rows={8}
      />
    </div>
  );
};

export default DataContentEditor;
