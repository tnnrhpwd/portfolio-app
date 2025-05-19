import React, { useState, useMemo } from "react";
import "./ScrollableTable.css"; // Add styles if needed

const ScrollableTable = ({ headers, data, renderRow, filterFn }) => {
  const [searchText, setSearchText] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

  // Handle sorting when a column header is clicked
  const handleSort = (key) => {
    setSortConfig((prevConfig) => {
      if (prevConfig.key === key) {
        // Toggle direction if the same column is clicked
        return { key, direction: prevConfig.direction === "asc" ? "desc" : "asc" };
      }
      // Default to ascending for a new column
      return { key, direction: "asc" };
    });
  };

  // Memoize filtered and sorted data
  const filteredAndSortedData = useMemo(() => {
    let filteredData = data.filter(
      filterFn ? (item) => filterFn(item, searchText) : () => true
    );

    if (sortConfig.key) {
      filteredData = [...filteredData].sort((a, b) => {
        const aValue = a[sortConfig.key] || "";
        const bValue = b[sortConfig.key] || "";
        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return filteredData;
  }, [data, filterFn, searchText, sortConfig]);

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
      <div className="admin-table-wrapper">
        <div className="table-scroll-container">
          <table className="admin-table" aria-label="Data table">
            <thead>
              <tr>
                {headers.map((header) => (
                  <th
                    key={header.key}
                    scope="col"
                    onClick={() => handleSort(header.key)}
                    className={`sortable-header ${
                      sortConfig.key === header.key ? sortConfig.direction : ""
                    }`}
                  >
                    {header.label}
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
