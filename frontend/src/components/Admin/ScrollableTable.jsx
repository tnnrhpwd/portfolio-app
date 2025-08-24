import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import "./ScrollableTable.css"; // Add styles if needed

const ScrollableTable = ({ headers, data, renderRow, filterFn, getColumnValue }) => {
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState(null);
  const [sortOrder, setSortOrder] = useState("asc");
  const [showColumnFilter, setShowColumnFilter] = useState(null);
  const tableRef = useRef(null);
  
  // Column resizing state
  const [columnWidths, setColumnWidths] = useState({});
  const [isResizing, setIsResizing] = useState(false);
  const [resizingColumn, setResizingColumn] = useState(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);

  // Multi-select filter state
  const [filterSelections, setFilterSelections] = useState({});
  const [filterSearchTerms, setFilterSearchTerms] = useState({});

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

  // Initialize column widths
  useEffect(() => {
    if (headers.length > 0 && Object.keys(columnWidths).length === 0) {
      const initialWidths = {};
      headers.forEach(header => {
        initialWidths[header.key] = 150; // Default width
      });
      setColumnWidths(initialWidths);
    }
  }, [headers, columnWidths]);

  // Column resizing handlers
  const handleMouseDown = useCallback((e, columnKey) => {
    e.preventDefault();
    setIsResizing(true);
    setResizingColumn(columnKey);
    setStartX(e.clientX);
    setStartWidth(columnWidths[columnKey] || 150);
  }, [columnWidths]);

  const handleMouseMove = useCallback((e) => {
    if (!isResizing || !resizingColumn) return;
    
    const diff = e.clientX - startX;
    const newWidth = Math.max(50, startWidth + diff); // Minimum width of 50px
    
    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn]: newWidth
    }));
  }, [isResizing, resizingColumn, startX, startWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    setResizingColumn(null);
    setStartX(0);
    setStartWidth(0);
  }, []);

  // Add global mouse event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

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

  // Handle Excel-style multi-select filter
  const handleFilterSelection = useCallback((columnKey, value, isSelected) => {
    setFilterSelections(prev => {
      const currentSelections = prev[columnKey] || new Set();
      const newSelections = new Set(currentSelections);
      
      if (isSelected) {
        newSelections.add(value);
      } else {
        newSelections.delete(value);
      }
      
      return {
        ...prev,
        [columnKey]: newSelections
      };
    });
  }, []);

  // Clear all filters for a column
  const clearColumnFilter = useCallback((columnKey) => {
    setFilterSelections(prev => {
      const newFilters = { ...prev };
      delete newFilters[columnKey];
      return newFilters;
    });
  }, []);

  // Select all values for a column filter
  const selectAllForColumn = useCallback((columnKey, allValues) => {
    setFilterSelections(prev => ({
      ...prev,
      [columnKey]: new Set(allValues)
    }));
  }, []);

  // Deselect all values for a column filter
  const deselectAllForColumn = useCallback((columnKey) => {
    setFilterSelections(prev => ({
      ...prev,
      [columnKey]: new Set()
    }));
  }, []);

  // Get unique values for Excel-style column filter dropdown
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

  // Check if a column has active filters
  const hasColumnFilter = useCallback((columnKey) => {
    const selections = filterSelections[columnKey];
    return selections && selections.size > 0;
  }, [filterSelections]);

  // Memoize filtered and sorted data
  const filteredAndSortedData = useMemo(() => {
    let filteredData = data.filter(item => {
      // Apply global search filter
      const matchesSearch = filterFn ? filterFn(item, searchText) : true;
      
      // Apply Excel-style column filters
      const matchesColumnFilters = Object.entries(filterSelections).every(([columnKey, selections]) => {
        if (!selections || selections.size === 0) return true;
        
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
        
        return selections.has(String(itemValue || ''));
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
  }, [data, filterFn, searchText, sortBy, sortOrder, filterSelections, getColumnValue]);

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
          <table className={`admin-table ${isResizing ? 'resizing' : ''}`} aria-label="Data table">
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th
                    key={header.key}
                    scope="col"
                    className={`sortable-header ${
                      sortBy === header.key ? sortOrder : ""
                    }`}
                    style={{ 
                      width: columnWidths[header.key] || 150,
                      position: 'relative'
                    }}
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
                          className={`column-filter-btn ${hasColumnFilter(header.key) ? 'active' : ''}`}
                          onClick={() => toggleColumnFilter(header.key)}
                          title={`Filter ${header.label}`}
                          aria-label={`Filter ${header.label} column`}
                        >
                          ▼
                        </button>
                        {hasColumnFilter(header.key) && (
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
                      <div className="excel-filter-dropdown">
                        <div className="filter-search">
                          <input
                            type="text"
                            className="filter-search-input"
                            placeholder="Search values..."
                            value={filterSearchTerms[header.key] || ''}
                            onChange={(e) => {
                              const searchTerm = e.target.value;
                              setFilterSearchTerms(prev => ({
                                ...prev,
                                [header.key]: searchTerm
                              }));
                            }}
                          />
                        </div>
                        <div className="filter-select-all">
                          <label className="filter-checkbox-label">
                            <input
                              type="checkbox"
                              checked={!hasColumnFilter(header.key) || (filterSelections[header.key] && filterSelections[header.key].size === getColumnUniqueValues(header.key).length)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  selectAllForColumn(header.key, getColumnUniqueValues(header.key));
                                } else {
                                  deselectAllForColumn(header.key);
                                }
                              }}
                            />
                            <span className="select-all-text">Select All</span>
                          </label>
                        </div>
                        <div className="filter-options-list">
                          {getColumnUniqueValues(header.key)
                            .filter(value => {
                              const searchTerm = filterSearchTerms[header.key];
                              return !searchTerm || String(value).toLowerCase().includes(searchTerm.toLowerCase());
                            })
                            .map((value, index) => {
                              const isSelected = !hasColumnFilter(header.key) || (filterSelections[header.key] && filterSelections[header.key].has(String(value)));
                              return (
                                <label key={index} className="filter-checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      handleFilterSelection(header.key, String(value), e.target.checked);
                                    }}
                                  />
                                  <span className="filter-value-text">
                                    {String(value).length > 30 ? String(value).substring(0, 30) + '...' : String(value)}
                                  </span>
                                </label>
                              );
                            })}
                        </div>
                        <div className="filter-actions">
                          <button
                            className="filter-ok-btn"
                            onClick={() => setShowColumnFilter(null)}
                          >
                            OK
                          </button>
                          <button
                            className="filter-cancel-btn"
                            onClick={() => {
                              clearColumnFilter(header.key);
                              setShowColumnFilter(null);
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}
                    {/* Resize handle - now available for all columns */}
                    <div
                      className="resize-handle"
                      onMouseDown={(e) => handleMouseDown(e, header.key)}
                      title="Drag to resize column"
                    />
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
                  
                  // Clone the row and apply column widths to each cell
                  const row = renderRow(item, index);
                  const rowWithWidths = React.cloneElement(row, {
                    children: React.Children.map(row.props.children, (cell, cellIndex) => {
                      if (cellIndex < headers.length) {
                        return React.cloneElement(cell, {
                          style: {
                            ...cell.props.style,
                            width: columnWidths[headers[cellIndex].key] || 150,
                            minWidth: columnWidths[headers[cellIndex].key] || 150,
                            maxWidth: columnWidths[headers[cellIndex].key] || 150
                          }
                        });
                      }
                      return cell;
                    })
                  });
                  
                  return (
                    <React.Fragment key={key}>
                      {rowWithWidths}
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
