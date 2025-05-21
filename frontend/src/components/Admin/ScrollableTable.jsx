import React, { useState, useMemo, useCallback } from "react";
import "./ScrollableTable.css"; // Add styles if needed

const ScrollableTable = ({ headers, data, renderRow, filterFn }) => {
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState(null);
  const [sortOrder, setSortOrder] = useState("asc");

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

  // Memoize filtered and sorted data
  const filteredAndSortedData = useMemo(() => {
    let filteredData = data.filter(
      filterFn ? (item) => filterFn(item, searchText) : () => true
    );

    if (sortBy) {
      filteredData = [...filteredData].sort((a, b) => {
        const aValue = a[sortBy];
        const bValue = b[sortBy];

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
  }, [data, filterFn, searchText, sortBy, sortOrder]);

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
                      sortBy === header.key ? sortOrder : ""
                    }`}
                  >
                    {header.label}
                    {sortBy === header.key && (
                      <span>{sortOrder === "asc" ? " ▲" : " ▼"}</span>
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
