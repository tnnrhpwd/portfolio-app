import React from 'react';
import './ActionResult.css';

function ActionResult(props) {// ActionResult component displays the result of an action. If the length of the action string exceeds 200 characters, it truncates the string and appends '...' to indicate truncation.
  let displayText = props.selAction;
  if (props.selAction.length > 200) {  // Check if the length of selAction exceeds 200 characters
    displayText = props.selAction.slice(0, 200) + '...';    // If so, truncate the string and append '...' to indicate it's truncated
  }
  return (  // Render the component with the truncated or original text
    <div className='actionresult'>
      {displayText}
    </div>
  );
}

export default ActionResult;
