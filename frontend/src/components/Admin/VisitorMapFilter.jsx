import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import "./VisitorMapFilter.css";

const VisitorMapFilter = ({ locations, onFilteredLocations }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState({
    country: '',
    region: '',
    city: '',
    browser: '',
    os: ''
  });
  const filterRef = useRef(null);

  // Close filter panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Get unique values for each filter category
  const filterOptions = useMemo(() => {
    const options = {
      country: [],
      region: [],
      city: [],
      browser: [],
      os: []
    };

    locations.forEach(location => {
      if (location.country && !options.country.includes(location.country)) {
        options.country.push(location.country);
      }
      if (location.region && !options.region.includes(location.region)) {
        options.region.push(location.region);
      }
      if (location.city && !options.city.includes(location.city)) {
        options.city.push(location.city);
      }
      if (location.browser && !options.browser.includes(location.browser)) {
        options.browser.push(location.browser);
      }
      if (location.os && !options.os.includes(location.os)) {
        options.os.push(location.os);
      }
    });

    // Sort all options alphabetically
    Object.keys(options).forEach(key => {
      options[key].sort();
    });

    return options;
  }, [locations]);

  // Apply filters to locations
  const filteredLocations = useMemo(() => {
    return locations.filter(location => {
      return Object.entries(filters).every(([key, value]) => {
        if (!value) return true;
        const locationValue = location[key] || '';
        return locationValue.toLowerCase().includes(value.toLowerCase());
      });
    });
  }, [locations, filters]);

  // Update parent component with filtered locations
  React.useEffect(() => {
    onFilteredLocations(filteredLocations);
  }, [filteredLocations, onFilteredLocations]);

  const handleFilterChange = useCallback((filterKey, value) => {
    setFilters(prev => ({
      ...prev,
      [filterKey]: value
    }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({
      country: '',
      region: '',
      city: '',
      browser: '',
      os: ''
    });
  }, []);

  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some(filter => filter !== '');
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    return Object.values(filters).filter(filter => filter !== '').length;
  }, [filters]);

  return (
    <div className="visitor-map-filter" ref={filterRef}>
      <button
        className={`filter-toggle-btn ${hasActiveFilters ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Filter visitor locations"
      >
        🔍 Filter {hasActiveFilters && `(${activeFilterCount})`}
      </button>

      {isOpen && (
        <div className="filter-panel">
          <div className="filter-header">
            <h3>Filter Locations</h3>
            <button 
              className="close-btn" 
              onClick={() => setIsOpen(false)}
              title="Close filter panel"
            >
              ×
            </button>
          </div>

          <div className="filter-content">
            {Object.entries(filters).map(([filterKey, filterValue]) => (
              <div key={filterKey} className="filter-group">
                <label htmlFor={`filter-${filterKey}`}>
                  {filterKey.charAt(0).toUpperCase() + filterKey.slice(1)}:
                </label>
                <div className="filter-input-group">
                  <input
                    id={`filter-${filterKey}`}
                    type="text"
                    value={filterValue}
                    onChange={(e) => handleFilterChange(filterKey, e.target.value)}
                    placeholder={`Filter by ${filterKey}...`}
                    className="filter-input"
                  />
                  {filterValue && (
                    <button
                      className="clear-individual-filter"
                      onClick={() => handleFilterChange(filterKey, '')}
                      title={`Clear ${filterKey} filter`}
                    >
                      ×
                    </button>
                  )}
                </div>
                
                {filterOptions[filterKey].length > 0 && (
                  <div className="filter-suggestions">
                    <small>Popular options:</small>
                    <div className="suggestion-chips">
                      {filterOptions[filterKey].slice(0, 5).map((option, index) => (
                        <button
                          key={index}
                          className="suggestion-chip"
                          onClick={() => handleFilterChange(filterKey, option)}
                          title={`Filter by ${option}`}
                        >
                          {option.length > 15 ? option.substring(0, 15) + '...' : option}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div className="filter-actions">
              <button
                className="clear-all-btn"
                onClick={clearAllFilters}
                disabled={!hasActiveFilters}
              >
                Clear All Filters
              </button>
              <div className="filter-results">
                Showing {filteredLocations.length} of {locations.length} locations
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VisitorMapFilter;
