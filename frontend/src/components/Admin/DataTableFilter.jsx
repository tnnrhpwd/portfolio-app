import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import "./DataTableFilter.css";

const DataTableFilter = ({ data, onFilteredData, getLocationFromItem }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState({
    type: '',
    location: '',
    dateFrom: '',
    dateTo: '',
    textSearch: ''
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

  // Get unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const options = {
      type: [],
      location: []
    };

    data.forEach(item => {
      // Type filter options
      const type = item.text && (item.text.includes("|IP:") || item.text.includes("|OS:") || item.text.includes("|Browser:"))
        ? "Visit"
        : "Input";
      if (!options.type.includes(type)) {
        options.type.push(type);
      }

      // Location filter options
      const location = getLocationFromItem(item);
      if (location && location !== "N/A" && location !== "Parse Error" && !options.location.includes(location)) {
        options.location.push(location);
      }
    });

    // Sort all options
    Object.keys(options).forEach(key => {
      options[key].sort();
    });

    return options;
  }, [data, getLocationFromItem]);

  // Apply all filters to data
  const filteredData = useMemo(() => {
    return data.filter(item => {
      // Type filter
      if (filters.type) {
        const itemType = item.text && (item.text.includes("|IP:") || item.text.includes("|OS:") || item.text.includes("|Browser:"))
          ? "Visit"
          : "Input";
        if (!itemType.toLowerCase().includes(filters.type.toLowerCase())) {
          return false;
        }
      }

      // Location filter
      if (filters.location) {
        const location = getLocationFromItem(item);
        if (!location.toLowerCase().includes(filters.location.toLowerCase())) {
          return false;
        }
      }

      // Date range filter
      if (filters.dateFrom || filters.dateTo) {
        const itemDate = new Date(item.createdAt);
        if (filters.dateFrom && itemDate < new Date(filters.dateFrom)) {
          return false;
        }
        if (filters.dateTo && itemDate > new Date(filters.dateTo + 'T23:59:59')) {
          return false;
        }
      }

      // Text search filter
      if (filters.textSearch) {
        const searchText = filters.textSearch.toLowerCase();
        const matchesText = item.text && item.text.toLowerCase().includes(searchText);
        const matchesId = item._id && item._id.toLowerCase().includes(searchText);
        const matchesFiles = item.files && item.files.toLowerCase().includes(searchText);
        
        if (!matchesText && !matchesId && !matchesFiles) {
          return false;
        }
      }

      return true;
    });
  }, [data, filters, getLocationFromItem]);

  // Update parent component with filtered data
  React.useEffect(() => {
    onFilteredData(filteredData);
  }, [filteredData, onFilteredData]);

  const handleFilterChange = useCallback((filterKey, value) => {
    setFilters(prev => ({
      ...prev,
      [filterKey]: value
    }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({
      type: '',
      location: '',
      dateFrom: '',
      dateTo: '',
      textSearch: ''
    });
  }, []);

  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some(filter => filter !== '');
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    return Object.values(filters).filter(filter => filter !== '').length;
  }, [filters]);

  return (
    <div className="data-table-filter" ref={filterRef}>
      <button
        className={`filter-toggle-btn ${hasActiveFilters ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Advanced filters for data table"
      >
        🔍 Advanced Filters {hasActiveFilters && `(${activeFilterCount})`}
      </button>

      {isOpen && (
        <div className="filter-panel">
          <div className="filter-header">
            <h3>Advanced Data Filters</h3>
            <button 
              className="close-btn" 
              onClick={() => setIsOpen(false)}
              title="Close filter panel"
            >
              ×
            </button>
          </div>

          <div className="filter-content">
            {/* Text Search Filter */}
            <div className="filter-group">
              <label htmlFor="text-search">Text Search:</label>
              <input
                id="text-search"
                type="text"
                value={filters.textSearch}
                onChange={(e) => handleFilterChange('textSearch', e.target.value)}
                placeholder="Search in text, ID, or files..."
                className="filter-input"
              />
            </div>

            {/* Type Filter */}
            <div className="filter-group">
              <label htmlFor="type-filter">Type:</label>
              <select
                id="type-filter"
                value={filters.type}
                onChange={(e) => handleFilterChange('type', e.target.value)}
                className="filter-select"
              >
                <option value="">All Types</option>
                {filterOptions.type.map((option, index) => (
                  <option key={index} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            {/* Location Filter */}
            <div className="filter-group">
              <label htmlFor="location-filter">Location:</label>
              <div className="filter-input-group">
                <input
                  id="location-filter"
                  type="text"
                  value={filters.location}
                  onChange={(e) => handleFilterChange('location', e.target.value)}
                  placeholder="Filter by location..."
                  className="filter-input"
                />
                {filters.location && (
                  <button
                    className="clear-individual-filter"
                    onClick={() => handleFilterChange('location', '')}
                    title="Clear location filter"
                  >
                    ×
                  </button>
                )}
              </div>
              
              {filterOptions.location.length > 0 && (
                <div className="filter-suggestions">
                  <small>Popular locations:</small>
                  <div className="suggestion-chips">
                    {filterOptions.location.slice(0, 8).map((option, index) => (
                      <button
                        key={index}
                        className="suggestion-chip"
                        onClick={() => handleFilterChange('location', option)}
                        title={`Filter by ${option}`}
                      >
                        {option.length > 20 ? option.substring(0, 20) + '...' : option}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Quick filter presets */}
              <div className="filter-presets">
                <small>Quick filters:</small>
                <div className="preset-buttons">
                  <button
                    className="preset-btn"
                    onClick={() => handleFilterChange('location', 'United States')}
                    title="Show only US visitors"
                  >
                    🇺🇸 US Only
                  </button>
                  <button
                    className="preset-btn"
                    onClick={() => handleFilterChange('location', '')}
                    title="Show visitors with location data"
                  >
                    🌍 All Locations
                  </button>
                  <button
                    className="preset-btn"
                    onClick={() => {
                      setFilters(prev => ({ ...prev, location: 'N/A', type: 'Input' }));
                    }}
                    title="Show only non-visitor entries"
                  >
                    📝 Non-Visitors
                  </button>
                </div>
              </div>
            </div>

            {/* Date Range Filter */}
            <div className="filter-group">
              <label>Date Range:</label>
              <div className="date-range-inputs">
                <div className="date-input-group">
                  <label htmlFor="date-from">From:</label>
                  <input
                    id="date-from"
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                    className="filter-date"
                  />
                </div>
                <div className="date-input-group">
                  <label htmlFor="date-to">To:</label>
                  <input
                    id="date-to"
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                    className="filter-date"
                  />
                </div>
              </div>
            </div>

            <div className="filter-actions">
              <button
                className="clear-all-btn"
                onClick={clearAllFilters}
                disabled={!hasActiveFilters}
              >
                Clear All Filters
              </button>
              <div className="filter-results">
                Showing {filteredData.length} of {data.length} entries
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataTableFilter;
