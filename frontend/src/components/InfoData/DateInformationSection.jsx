import React from 'react';
import CreatedAt from '../Simple/DataResult/CreatedAt';

/**
 * Date information display component
 * @param {string} createdAt - Creation timestamp
 * @param {string} updatedAt - Last update timestamp
 */
const DateInformationSection = ({ createdAt, updatedAt }) => {
  return (
    <div className='infodata-date-section'>
      <h3 className='infodata-date-title'>
        <span className='infodata-date-icon'>📅</span>
        Date Information
      </h3>
      <div className='infodata-date-grid'>
        <div className='infodata-date-item'>
          <div className='infodata-date-label'>Created:</div>
          <div className='infodata-date-value'>
            {createdAt ? (
              <>
                <CreatedAt createdAt={createdAt} />
                <span className='infodata-date-full'> ({new Date(createdAt).toLocaleString()})</span>
              </>
            ) : (
              <span className='infodata-date-unavailable'>Date unavailable</span>
            )}
          </div>
        </div>
        <div className='infodata-date-item'>
          <div className='infodata-date-label'>Last Updated:</div>
          <div className='infodata-date-value'>
            {updatedAt ? (
              <>
                <CreatedAt createdAt={updatedAt} />
                <span className='infodata-date-full'> ({new Date(updatedAt).toLocaleString()})</span>
              </>
            ) : (
              <span className='infodata-date-unavailable'>Date unavailable</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DateInformationSection;
