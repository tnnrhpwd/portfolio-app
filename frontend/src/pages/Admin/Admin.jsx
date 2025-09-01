import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useNavigate } from "react-router-dom";
import { getAllData, closeBugReport } from "../../features/data/dataSlice";
import CollapsibleSection from "../../components/Admin/CollapsibleSection.jsx";
import ScrollableTable from "../../components/Admin/ScrollableTable.jsx";
import VisitorMap from "../../components/Admin/VisitorMap.jsx";
import VisitorMapFilter from "../../components/Admin/VisitorMapFilter.jsx";
import "./Admin.css";
import { toast } from "react-toastify";
import parseVisitorData from "../../utils/parseVisitorData.js";

function Admin() {
  const { user, data, dataMessage, dataIsSuccess, dataIsLoading, dataIsError } = useSelector((state) => state.data);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [allObjectArray, setAllObjectArray] = useState([]);
  const [visitorLocations, setVisitorLocations] = useState([]);
  const [filteredMapLocations, setFilteredMapLocations] = useState([]);
  const [closingBugId, setClosingBugId] = useState(null);
  const [resolutionText, setResolutionText] = useState("");
  const [showResolutionModal, setShowResolutionModal] = useState(false);

  // Calculate default "From" and "To" dates
  const today = new Date().toISOString().split("T")[0];
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastWeekDate = lastWeek.toISOString().split("T")[0];

  const [fromDate, setFromDate] = useState(lastWeekDate); // Default "From" date is last week
  const [toDate, setToDate] = useState(today); // Default "To" date is today
  
  // Fetch data on component mount
  useEffect(() => {
    dispatch(getAllData());
  }, [dispatch]);

  // Authentication and authorization
  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    
    if (user._id.toString() !== "6770a067c725cbceab958619") {
      toast.error("Only admin are allowed to use that URL.");
      console.error("Only admin are allowed to use that URL");
      navigate("/");
    }
  }, [user, navigate]);

  // Handle error state
  useEffect(() => {
    if (dataIsError) {
      console.error("Error fetching data:", dataMessage);
      toast.error("Error fetching data.");
    }
  }, [dataIsError, dataMessage]);

  // Process data when it arrives
  useEffect(() => {
    if (!data || !dataIsSuccess) return;
    
    setAllObjectArray(data);
    
    console.log("Data received from Redux:", data.length, "items");
    
    // Log a sample of visitor data to see the format
    const sampleVisitorData = data.find(item => 
      item.text && item.text.includes("IP:") && item.text.includes("|OS:")
    );
    
    if (sampleVisitorData) {
      console.log("Sample visitor data text:", sampleVisitorData.text);
      console.log("Parsed sample visitor:", parseVisitorData(sampleVisitorData.text));
    } else {
      console.log("No visitor data found in sample");
    }
    
    // Extract and deduplicate visitor location data
    try {
      const visitorMap = new Map(); // Use map to deduplicate by IP
      
      data.forEach(item => {
        const visitor = parseVisitorData(item.text);
        if (visitor && visitor.country && visitor.ip) {
          // Only keep latest visit from each IP
          const existingVisitor = visitorMap.get(visitor.ip);
          if (!existingVisitor || new Date(item.createdAt) > new Date(existingVisitor.timestamp)) {
            visitor.timestamp = item.createdAt || visitor.timestamp;
            visitorMap.set(visitor.ip, visitor);
          }
        }
      });
      
      // Filter out undefined data points AND locations with missing city, region, or country
      const filteredVisitors = Array.from(visitorMap.values()).filter(
        (visitor) =>
          visitor.ip &&
          visitor.country &&
          visitor.city &&
          visitor.region &&
          visitor.country !== "undefined" &&
          visitor.city !== "undefined" &&
          visitor.region !== "undefined"
      );

      setVisitorLocations(filteredVisitors);
    } catch (error) {
      console.error("Error processing visitor data:", error);
    }
  }, [data, dataIsSuccess]);

  // Filter visitor locations by date range
  const filteredVisitorLocations = useMemo(() => {
    if (!fromDate && !toDate) return visitorLocations;

    return visitorLocations.filter((visitor) => {
      const visitorDate = new Date(visitor.timestamp).toISOString().split("T")[0];
      const isAfterFromDate = fromDate ? visitorDate >= fromDate : true;
      const isBeforeToDate = toDate ? visitorDate <= toDate : true;
      return isAfterFromDate && isBeforeToDate;
    });
  }, [visitorLocations, fromDate, toDate]);

  // Handle filtered locations from VisitorMapFilter
  const handleFilteredMapLocations = useCallback((filtered) => {
    setFilteredMapLocations(filtered);
  }, []);

  // Final locations to display on map (after both date and map filters)
  const finalMapLocations = useMemo(() => {
    return filteredMapLocations.length > 0 ? filteredMapLocations : filteredVisitorLocations;
  }, [filteredMapLocations, filteredVisitorLocations]);

  // Helper function to extract location from visitor data
  const getLocationFromItem = useCallback((item) => {
    // First, let's check if this is a visitor entry
    if (!item.text) {
      return "N/A";
    }
    
    // Check for different possible visitor data indicators
    const isVisitorData = item.text.includes("IP:") && 
                         (item.text.includes("|OS:") || item.text.includes("|Browser:"));
    
    if (!isVisitorData) {
      return "N/A";
    }
    
    try {
      // Try the parseVisitorData function first
      const visitor = parseVisitorData(item.text);
      
      if (visitor) {
        if (visitor.city && visitor.country && visitor.city !== "undefined" && visitor.country !== "undefined") {
          return `${visitor.city}, ${visitor.country}`;
        } else if (visitor.country && visitor.country !== "undefined") {
          return visitor.country;
        } else if (visitor.region && visitor.region !== "undefined") {
          return visitor.region;
        }
      }
      
      // If parseVisitorData didn't work, try direct regex matching
      const cityMatch = item.text.match(/\|City:([^|]+)/);
      const countryMatch = item.text.match(/\|Country:([^|]+)/);
      
      if (cityMatch && countryMatch) {
        const city = cityMatch[1].trim();
        const country = countryMatch[1].trim();
        if (city !== "undefined" && country !== "undefined") {
          return `${city}, ${country}`;
        }
      } else if (countryMatch) {
        const country = countryMatch[1].trim();
        if (country !== "undefined") {
          return country;
        }
      }
      
      return "Location Unknown";
    } catch (error) {
      console.log("Error parsing visitor data:", error);
      return "Parse Error";
    }
  }, []);

  // Filter functions for tables
  const filterMainTable = useCallback((item, searchText) => {
    const type = item.text && (item.text.includes("|IP:") || item.text.includes("|OS:") || item.text.includes("|Browser:"))
      ? "Visit"
      : "Input";
      
    const location = getLocationFromItem(item);

    return (
      (typeof item.text === 'string' && item.text.toLowerCase().includes(searchText.toLowerCase())) ||
      (typeof item._id === 'string' && item._id.toLowerCase().includes(searchText.toLowerCase())) ||
      (typeof item.files === 'string' && item.files.toLowerCase().includes(searchText.toLowerCase())) ||
      type.toLowerCase().includes(searchText.toLowerCase()) ||
      location.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [getLocationFromItem]);
  
  const filterVisitorTable = useCallback((item, searchText) => {
    return Object.values(item).some(
      val => typeof val === 'string' && val.toLowerCase().includes(searchText.toLowerCase())
    );
  }, []);

  // Custom column value extractor for ScrollableTable
  const getColumnValue = useCallback((item, columnKey) => {
    if (columnKey === 'type') {
      return item.text && (item.text.includes("|IP:") || item.text.includes("|OS:") || item.text.includes("|Browser:"))
        ? "Visit"
        : "Input";
    } else if (columnKey === 'location') {
      return getLocationFromItem(item);
    }
    return item[columnKey];
  }, [getLocationFromItem]);

  // Format timestamp for better readability
  const formatTimestamp = useCallback((timestamp) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch (e) {
      return timestamp || '';
    }
  }, []);

  // Filter functions for bug reports and ratings
  const getBugReports = useCallback(() => {
    if (!allObjectArray || !Array.isArray(allObjectArray)) return [];
    
    return allObjectArray
      .filter(item => 
        item.text && 
        item.text.includes('Bug:') && 
        item.text.includes('Status:') &&
        item.text.includes('Creator:')
      )
      .map(item => {
        const text = item.text || '';
        const bugData = {};
        
        // Parse the pipe-delimited data
        const parts = text.split('|');
        parts.forEach(part => {
          const [key, ...valueParts] = part.split(':');
          if (key && valueParts.length > 0) {
            bugData[key.toLowerCase()] = valueParts.join(':');
          }
        });
        
        return {
          id: item.id || item._id,
          title: bugData.bug || 'Untitled Bug Report',
          severity: bugData.severity || 'medium',
          description: bugData.description || '',
          steps: bugData.steps || '',
          expected: bugData.expected || '',
          actual: bugData.actual || '',
          browser: bugData.browser || '',
          device: bugData.device || '',
          status: bugData.status || 'Open',
          creator: bugData.creator || 'Unknown',
          resolution: bugData.resolution || '',
          resolvedby: bugData.resolvedby || '',
          resolvedat: bugData.resolvedat || '',
          timestamp: bugData.timestamp || item.createdAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Sort by newest first
  }, [allObjectArray]);

  // Handle closing bug reports
  const handleCloseBugReport = useCallback(async (reportId) => {
    if (!resolutionText.trim()) {
      toast.error('Please enter a resolution description before closing the report.');
      return;
    }

    try {
      await dispatch(closeBugReport({ reportId, resolutionText })).unwrap();
      toast.success('Bug report closed successfully!');
      setShowResolutionModal(false);
      setResolutionText('');
      setClosingBugId(null);
      
      // Refresh data to show updated status
      dispatch(getAllData());
    } catch (error) {
      console.error('Error closing bug report:', error);
      toast.error('Failed to close bug report. Please try again.');
    }
  }, [dispatch, resolutionText]);

  const openResolutionModal = useCallback((reportId) => {
    setClosingBugId(reportId);
    setShowResolutionModal(true);
    setResolutionText('');
  }, []);

  const closeResolutionModal = useCallback(() => {
    setShowResolutionModal(false);
    setResolutionText('');
    setClosingBugId(null);
  }, []);

  const getRatingsAndReviews = useCallback(() => {
    if (!allObjectArray || !Array.isArray(allObjectArray)) return [];
    
    return allObjectArray
      .filter(item => 
        item.text && 
        (item.text.includes('Review:') || item.text.includes('Rating:')) &&
        item.text.includes('User:')
      )
      .map(item => {
        const text = item.text || '';
        const reviewData = {};
        
        // Parse the pipe-delimited data
        const parts = text.split('|');
        parts.forEach(part => {
          const [key, ...valueParts] = part.split(':');
          if (key && valueParts.length > 0) {
            reviewData[key.toLowerCase()] = valueParts.join(':');
          }
        });
        
        return {
          id: item.id || item._id,
          title: reviewData.review || 'Untitled Review',
          category: reviewData.category || 'General',
          rating: reviewData.rating || 'N/A',
          content: reviewData.content || '',
          user: reviewData.user || 'Anonymous',
          timestamp: reviewData.timestamp || item.createdAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Sort by newest first
  }, [allObjectArray]);

  // Get filtered data
  const bugReports = useMemo(() => getBugReports(), [getBugReports]);
  const ratingsAndReviews = useMemo(() => getRatingsAndReviews(), [getRatingsAndReviews]);

  console.log("All Data:", allObjectArray);
  console.log("Number of items:", allObjectArray.length);
  
  // Add a debug function to window for manual testing
  React.useEffect(() => {
    window.debugLocationData = () => {
      console.log("=== DEBUG: Location Data Analysis ===");
      const visitorEntries = allObjectArray.filter(item => 
        item.text && item.text.includes("IP:") && item.text.includes("|OS:")
      );
      console.log(`Found ${visitorEntries.length} visitor entries out of ${allObjectArray.length} total`);
      
      visitorEntries.slice(0, 3).forEach((item, index) => {
        console.log(`\nVisitor Entry ${index + 1}:`);
        console.log("Full text:", item.text);
        console.log("Parsed:", parseVisitorData(item.text));
        console.log("Location result:", getLocationFromItem(item));
      });
    };
  }, [allObjectArray, getLocationFromItem]);

  return (
    <>
      <Header />
      <div className="admin-container">
        {/* Floating elements for visual interest */}
        <div className="floating-shapes">
          <div className="floating-circle floating-circle-1"></div>
          <div className="floating-circle floating-circle-2"></div>
          <div className="floating-circle floating-circle-3"></div>
        </div>
        
        <section className="admin-section-tile">
          <h2>Administrator Panel</h2>
          
          {dataIsLoading && <div className="admin-loading">Loading data...</div>}
          {dataIsError && <div className="admin-error">Error loading data. Please try again.</div>}
          
          {!dataIsLoading && data && (
            <>
              <CollapsibleSection title="All Data" defaultCollapsed={false}>
                <ScrollableTable 
                  headers={[
                    { key: "_id", label: "ID" },
                    { key: "text", label: "Text" },
                    { key: "files", label: "Files" },
                    { key: "createdAt", label: "Created At" },
                    { key: "updatedAt", label: "Updated At" },
                    { key: "type", label: "Type" },
                    { key: "location", label: "Location" }, // New column
                  ]}
                  data={allObjectArray}
                  filterFn={filterMainTable}
                  getColumnValue={getColumnValue}
                  renderRow={(item) => (
                    <tr key={item._id} className="admin-table-row">
                      <td className="admin-table-row-text">{item._id || ''}</td>
                      <td className="admin-table-row-text">
                        {item.text ? (item.text.length > 200 ? item.text.substring(0, 200) + '...' : item.text) : ''}
                      </td>
                      <td className="admin-table-row-text">{item.files || ''}</td>
                      <td className="admin-table-row-text">{formatTimestamp(item.createdAt)}</td>
                      <td className="admin-table-row-text">{formatTimestamp(item.updatedAt)}</td>
                      <td className="admin-table-row-text">
                        {item.text && (item.text.includes("|IP:") || item.text.includes("|OS:") || item.text.includes("|Browser:"))
                          ? "Visit"
                          : "Input"}
                      </td>
                      <td className="admin-table-row-text">{getLocationFromItem(item)}</td>
                    </tr>
                  )}
                />
              </CollapsibleSection>
              
              <CollapsibleSection title="Visitor Map" defaultCollapsed={true}>
                <div className="date-filter">
                  <label htmlFor="from-date">From:</label>
                  <input
                    type="date"
                    id="from-date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                  <label htmlFor="to-date">To:</label>
                  <input
                    type="date"
                    id="to-date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                  <span className="visit-counter">
                    Displaying {finalMapLocations.length} visit{finalMapLocations.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <VisitorMapFilter 
                  locations={filteredVisitorLocations} 
                  onFilteredLocations={handleFilteredMapLocations} 
                />
                {finalMapLocations.length > 0 ? (
                  <VisitorMap locations={finalMapLocations} />
                ) : (
                  <p className="admin-no-data">No visitor location data available</p>
                )}
              </CollapsibleSection>
              
              <CollapsibleSection title="Recent Visitors" defaultCollapsed={true}>
                {visitorLocations.length > 0 ? (
                  <ScrollableTable 
                    headers={[
                      { key: "ip", label: "IP Address" },
                      { key: "city", label: "City" },
                      { key: "country", label: "Country" },
                      { key: "browser", label: "Browser/OS" },
                      { key: "timestamp", label: "Timestamp" },
                    ]}
                    data={visitorLocations}
                    filterFn={filterVisitorTable}
                    renderRow={(visitor, index) => (
                      <tr key={`visitor-${index}`} className="admin-table-row">
                        <td className="admin-table-row-text">{visitor.ip}</td>
                        <td className="admin-table-row-text">{`${visitor.city || 'Unknown'}, ${visitor.region || 'Unknown'}`}</td>
                        <td className="admin-table-row-text">{visitor.country || 'Unknown'}</td>
                        <td className="admin-table-row-text">{`${visitor.browser || 'Unknown'} / ${visitor.os || 'Unknown'}`}</td>
                        <td className="admin-table-row-text">{formatTimestamp(visitor.timestamp)}</td>
                      </tr>
                    )}
                  />
                ) : (
                  <p className="admin-no-data">No visitor data available</p>
                )}
              </CollapsibleSection>
              
              <CollapsibleSection title="🐛 Bug Reports" defaultCollapsed={true}>
                {bugReports.length > 0 ? (
                  <ScrollableTable 
                    headers={[
                      { key: "title", label: "Bug Title" },
                      { key: "status", label: "Status" },
                      { key: "creator", label: "Reporter" },
                      { key: "description", label: "Description" },
                      { key: "createdAt", label: "Submitted" },
                      { key: "actions", label: "Actions" },
                    ]}
                    data={bugReports}
                    filterFn={(item, searchText) => {
                      return Object.values(item).some(
                        val => typeof val === 'string' && val.toLowerCase().includes(searchText.toLowerCase())
                      );
                    }}
                    renderRow={(report) => (
                      <tr key={report.id} className="admin-table-row">
                        <td className="admin-table-row-text">
                          <strong>{report.title}</strong>
                          {report.resolution && (
                            <div className="report-resolution">
                              <strong>Resolution:</strong> {report.resolution}
                              <br />
                              <small>
                                Resolved by {report.resolvedby} 
                                {report.resolvedat && ` on ${new Date(report.resolvedat).toLocaleDateString()}`}
                              </small>
                            </div>
                          )}
                        </td>
                        <td className="admin-table-row-text">
                          <span className={`status-badge status-${report.status.toLowerCase()}`}>
                            {report.status === 'Open' ? '🔓 Open' : '🔒 Closed'}
                          </span>
                        </td>
                        <td className="admin-table-row-text">{report.creator}</td>
                        <td className="admin-table-row-text">
                          {report.description.length > 100 
                            ? report.description.substring(0, 100) + '...' 
                            : report.description}
                        </td>
                        <td className="admin-table-row-text">{formatTimestamp(report.createdAt)}</td>
                        <td className="admin-table-row-text">
                          {report.status === 'Open' ? (
                            <button
                              className="admin-close-report-btn"
                              onClick={() => openResolutionModal(report.id)}
                              title="Close this bug report"
                            >
                              ✅ Close
                            </button>
                          ) : (
                            <span className="admin-report-closed">Resolved</span>
                          )}
                        </td>
                      </tr>
                    )}
                  />
                ) : (
                  <p className="admin-no-data">No bug reports found</p>
                )}
              </CollapsibleSection>

              <CollapsibleSection title="⭐ User Ratings & Reviews" defaultCollapsed={true}>
                {ratingsAndReviews.length > 0 ? (
                  <ScrollableTable 
                    headers={[
                      { key: "title", label: "Review Title" },
                      { key: "rating", label: "Rating" },
                      { key: "category", label: "Category" },
                      { key: "user", label: "User" },
                      { key: "content", label: "Review Content" },
                      { key: "createdAt", label: "Submitted" },
                    ]}
                    data={ratingsAndReviews}
                    filterFn={(item, searchText) => {
                      return Object.values(item).some(
                        val => typeof val === 'string' && val.toLowerCase().includes(searchText.toLowerCase())
                      );
                    }}
                    renderRow={(review) => (
                      <tr key={review.id} className="admin-table-row">
                        <td className="admin-table-row-text">
                          <strong>{review.title}</strong>
                        </td>
                        <td className="admin-table-row-text">
                          <span className="rating-badge">
                            {'⭐'.repeat(parseInt(review.rating) || 0)} {review.rating}
                          </span>
                        </td>
                        <td className="admin-table-row-text">
                          <span className="category-badge">{review.category}</span>
                        </td>
                        <td className="admin-table-row-text">{review.user}</td>
                        <td className="admin-table-row-text">
                          {review.content.length > 150 
                            ? review.content.substring(0, 150) + '...' 
                            : review.content}
                        </td>
                        <td className="admin-table-row-text">{formatTimestamp(review.createdAt)}</td>
                      </tr>
                    )}
                  />
                ) : (
                  <p className="admin-no-data">No ratings or reviews found</p>
                )}
              </CollapsibleSection>
            </>
          )}
        </section>
        
        {/* Resolution Modal */}
        {showResolutionModal && (
          <div className="admin-modal-overlay">
            <div className="admin-modal">
              <div className="admin-modal-header">
                <h3>🔒 Close Bug Report</h3>
                <button 
                  className="admin-modal-close" 
                  onClick={closeResolutionModal}
                >
                  ✕
                </button>
              </div>
              <div className="admin-modal-content">
                <label htmlFor="resolutionText">Resolution Description:</label>
                <textarea
                  id="resolutionText"
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  placeholder="Describe how this bug was resolved or why it's being closed..."
                  rows="4"
                  maxLength="500"
                />
                <small className="admin-char-count">
                  {resolutionText.length}/500 characters
                </small>
              </div>
              <div className="admin-modal-actions">
                <button 
                  className="admin-modal-cancel" 
                  onClick={closeResolutionModal}
                >
                  Cancel
                </button>
                <button 
                  className="admin-modal-confirm"
                  onClick={() => handleCloseBugReport(closingBugId)}
                  disabled={!resolutionText.trim()}
                >
                  Close Report
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}

export default Admin;
