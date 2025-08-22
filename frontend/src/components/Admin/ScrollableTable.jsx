import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import "./ScrollableTable.css"; // Add styles if needed

const ScrollableTable = ({ headers, data, renderRow, filterFn, getColumnValue }) => {
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState(null);
  const [sortOrder, setSortOrder] = useState("asc");
  const [columnFilters, setColumnFilters] = useState({});
  const [showColumnFilter, setShowColumnFilter] = useState(null);
  const tableRef = useRef(null);

  // Close column filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (tableRef.current && !tableRef.current.contains(event.target)) {
        setShowColumnFilter(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handle sorting when a column header is clicked
  const handleSort = useCallback(
    (key) => {
      if (sortBy === key) {
        setSortOrder(sortOrder === "asc" ? "desc" : "asc");
      } else {
        setSortBy(key);
        setSortOrder("asc");
      }
    },
    [sortBy, sortOrder]
  );

  // Handle column filter toggle
  const toggleColumnFilter = useCallback((columnKey) => {
    setShowColumnFilter(showColumnFilter === columnKey ? null : columnKey);
  }, [showColumnFilter]);

  // Handle column filter change
  const handleColumnFilterChange = useCallback((columnKey, value) => {
    setColumnFilters(prev => ({
      ...prev,
      [columnKey]: value
    }));
  }, []);

  // Clear column filter
  const clearColumnFilter = useCallback((columnKey) => {
    setColumnFilters(prev => {
      const newFilters = { ...prev };
      delete newFilters[columnKey];
      return newFilters;
    });
  }, []);

  // Get unique values for column filter dropdown
  const getColumnUniqueValues = useCallback((columnKey) => {
    const values = data.map(item => {
      let value;
      if (getColumnValue) {
        value = getColumnValue(item, columnKey);
      } else {
        value = item[columnKey];
        if (columnKey === 'type') {
          // Special handling for type column
          value = item.text && (item.text.includes("|IP:") || item.text.includes("|OS:") || item.text.includes("|Browser:"))
            ? "Visit"
            : "Input";
        }
      }
      return value;
    }).filter((value, index, self) => 
      value !== null && value !== undefined && value !== '' && self.indexOf(value) === index
    );
    return values.sort();
  }, [data, getColumnValue]);

  // Memoize filtered and sorted data
  const filteredAndSortedData = useMemo(() => {
    let filteredData = data.filter(item => {
      // Apply global search filter
      const matchesSearch = filterFn ? filterFn(item, searchText) : true;
      
      // Apply column filters
      const matchesColumnFilters = Object.entries(columnFilters).every(([columnKey, filterValue]) => {
        if (!filterValue) return true;
        
        let itemValue;
        if (getColumnValue) {
          itemValue = getColumnValue(item, columnKey);
        } else {
          itemValue = item[columnKey];
          if (columnKey === 'type') {
            // Special handling for type column
            itemValue = item.text && (item.text.includes("|IP:") || item.text.includes("|OS:") || item.text.includes("|Browser:"))
              ? "Visit"
              : "Input";
          }
        }
        
        return String(itemValue || '').toLowerCase().includes(filterValue.toLowerCase());
      });
      
      return matchesSearch && matchesColumnFilters;
    });

    if (sortBy) {
      filteredData = [...filteredData].sort((a, b) => {
        let aValue, bValue;
        
        if (getColumnValue) {
          aValue = getColumnValue(a, sortBy);
          bValue = getColumnValue(b, sortBy);
        } else {
          aValue = a[sortBy];
          bValue = b[sortBy];
          
          // Special handling for type column
          if (sortBy === 'type') {
            aValue = a.text && (a.text.includes("|IP:") || a.text.includes("|OS:") || a.text.includes("|Browser:"))
              ? "Visit"
              : "Input";
            bValue = b.text && (b.text.includes("|IP:") || b.text.includes("|OS:") || b.text.includes("|Browser:"))
              ? "Visit"
              : "Input";
          }
        }

        if (aValue === bValue) return 0;

        if (aValue == null) return sortOrder === "asc" ? -1 : 1;
        if (bValue == null) return sortOrder === "asc" ? 1 : -1;

        if (typeof aValue === "number" && typeof bValue === "number") {
          return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
        }

        if (typeof aValue === "string" && typeof bValue === "string") {
          return sortOrder === "asc"
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        }

        return String(aValue).localeCompare(String(bValue)) * (sortOrder === "asc" ? 1 : -1);
      });
    }

    return filteredData;
  }, [data, filterFn, searchText, sortBy, sortOrder, columnFilters, getColumnValue]);

  return (
    <>
      <input
        type="text"
        className="admin-search"
        placeholder="Search..."
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        aria-label="Search table entries"
      />
      <div className="admin-table-wrapper" ref={tableRef}>
        <div className="table-scroll-container">
          <table className="admin-table" aria-label="Data table">
            <thead>
              <tr>
                {headers.map((header) => (
                  <th
                    key={header.key}
                    scope="col"
                    className={`sortable-header ${
                      sortBy === header.key ? sortOrder : ""
                    }`}
                  >
                    <div className="header-content">
                      <span 
                        className="header-text"
                        onClick={() => handleSort(header.key)}
                      >
                        {header.label}
                        {sortBy === header.key && (
                          <span className="sort-indicator">{sortOrder === "asc" ? " ▲" : " ▼"}</span>
                        )}
                      </span>
                      <div className="filter-controls">
                        <button
                          className={`column-filter-btn ${columnFilters[header.key] ? 'active' : ''}`}
                          onClick={() => toggleColumnFilter(header.key)}
                          title={`Filter ${header.label}`}
                          aria-label={`Filter ${header.label} column`}
                        >
                          V
                        </button>
                        {columnFilters[header.key] && (
                          <button
                            className="clear-filter-btn"
                            onClick={() => clearColumnFilter(header.key)}
                            title={`Clear ${header.label} filter`}
                            aria-label={`Clear ${header.label} filter`}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                    {showColumnFilter === header.key && (
                      <div className="column-filter-dropdown">
                        <input
                          type="text"
                          className="column-filter-input"
                          placeholder={`Filter ${header.label}...`}
                          value={columnFilters[header.key] || ''}
                          onChange={(e) => handleColumnFilterChange(header.key, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                        <div className="filter-options">
                          {getColumnUniqueValues(header.key).slice(0, 10).map((value, index) => (
                            <button
                              key={index}
                              className="filter-option"
                              onClick={() => {
                                handleColumnFilterChange(header.key, String(value));
                                setShowColumnFilter(null);
                              }}
                            >
                              {String(value).length > 30 ? String(value).substring(0, 30) + '...' : String(value)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedData.length > 0 ? (
                // Wrap renderRow in a React.Fragment with key to ensure each row has a key
                filteredAndSortedData.map((item, index) => {
                  // Get the id from the item or use index as fallback
                  const key = item._id || `item-${index}`;
                  return (
                    <React.Fragment key={key}>
                      {renderRow(item, index)}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr key={`no-data-${headers.map((h) => h.key).join("-")}`}>
                  <td colSpan={headers.length} className="admin-table-no-data">
                    No matching data found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default ScrollableTable;
