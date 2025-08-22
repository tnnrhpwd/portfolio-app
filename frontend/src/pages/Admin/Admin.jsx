import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useNavigate } from "react-router-dom";
import { getAllData } from "../../features/data/dataSlice";
import CollapsibleSection from "../../components/Admin/CollapsibleSection.jsx";
import ScrollableTable from "../../components/Admin/ScrollableTable.jsx"; // Updated import
import VisitorMap from "../../components/Admin/VisitorMap.jsx";
import "./Admin.css";
import { toast } from "react-toastify";
import parseVisitorData from "../../utils/parseVisitorData.js";

function Admin() {
  const { user, data, dataMessage, dataIsSuccess, dataIsLoading, dataIsError } = useSelector((state) => state.data);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [allObjectArray, setAllObjectArray] = useState([]);
  const [visitorLocations, setVisitorLocations] = useState([]);

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
    
    console.log("Data received from Redux:", data); // Inspect the data
    console.log("Number of items in data:", data.length); // Check the length
    console.log("All Object Array after setting state:", allObjectArray); // Check the state
    console.log("Number of items in allObjectArray:", allObjectArray.length); // Check the state length
    
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

  // Filter functions for tables
  const filterMainTable = useCallback((item, searchText) => {
    const type = item.text && (item.text.includes("|IP:") || item.text.includes("|OS:") || item.text.includes("|Browser:"))
      ? "Visit"
      : "Input";

    return (
      (typeof item.text === 'string' && item.text.toLowerCase().includes(searchText.toLowerCase())) ||
      type.toLowerCase().includes(searchText.toLowerCase())
    );
  }, []);
  
  const filterVisitorTable = useCallback((item, searchText) => {
    return Object.values(item).some(
      val => typeof val === 'string' && val.toLowerCase().includes(searchText.toLowerCase())
    );
  }, []);

  // Format timestamp for better readability
  const formatTimestamp = useCallback((timestamp) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch (e) {
      return timestamp || '';
    }
  }, []);

  console.log("All Data:", allObjectArray);
  console.log("Number of items:", allObjectArray.length);

  return (
    <>
      <Header />
      <div className="admin-container">
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
                    { key: "type", label: "Type" }, // New column
                  ]}
                  data={allObjectArray}
                  filterFn={filterMainTable}
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
                    Displaying {filteredVisitorLocations.length} visit{filteredVisitorLocations.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {filteredVisitorLocations.length > 0 ? (
                  <VisitorMap locations={filteredVisitorLocations} />
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
            </>
          )}
        </section>
      </div>
      <Footer />
    </>
  );
}

export default Admin;
