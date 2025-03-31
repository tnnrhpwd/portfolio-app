import React, { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useDispatch, useSelector } from "react-redux";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useNavigate } from "react-router-dom";
import { getAllData } from "../../features/data/dataSlice";
import CollapsibleSection from "../../components/Admin/CollapsibleSection.jsx";
import ScrollableTable from "../../components/Admin/ScrollableTable.jsx";
import { toast } from "react-toastify";
import parseVisitorData from "../../utils/parseVisitorData.js";
import axios from 'axios';  // Import axios for direct API calls
import "./Admin.css";

// Use React.lazy for the VisitorMap component to improve performance
const VisitorMap = React.lazy(() => import("../../components/Admin/VisitorMap.jsx"));

function Admin() {
  const { user, data, dataMessage, dataIsSuccess, dataIsLoading, dataIsError } = useSelector((state) => state.data);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [allObjectArray, setAllObjectArray] = useState([]);
  const [visitorLocations, setVisitorLocations] = useState([]);
  const [mapLocations, setMapLocations] = useState([]);  // New state for consolidated map data points
  const [mapConfig, setMapConfig] = useState(null);
  const [isMapConfigLoading, setIsMapConfigLoading] = useState(false);
  const [mapConfigError, setMapConfigError] = useState(null);

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

  // Fetch map configuration for admin user
  useEffect(() => {
    const fetchMapConfig = async () => {
      if (!user || user._id.toString() !== "6770a067c725cbceab958619") return;
      
      setIsMapConfigLoading(true);
      try {
        const config = {
          headers: {
            Authorization: `Bearer ${user.token}`,
          },
        };
        const response = await axios.get('/api/data/map-config', config);
        setMapConfig(response.data);
        setMapConfigError(null);
      } catch (error) {
        console.error('Error fetching map configuration:', error);
        setMapConfigError('Failed to load map configuration');
        toast.error('Failed to load map configuration');
      } finally {
        setIsMapConfigLoading(false);
      }
    };
    
    fetchMapConfig();
  }, [user]);

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
      
      // Filter out undefined data points
      const filteredVisitors = Array.from(visitorMap.values()).filter(
        (visitor) => visitor.ip && visitor.country && visitor.city
      );

      setVisitorLocations(filteredVisitors);
    } catch (error) {
      console.error("Error processing visitor data:", error);
    }
  }, [data, dataIsSuccess]);

  // Create consolidated map locations (group by city+country and add count)
  useEffect(() => {
    if (!visitorLocations.length) return;
    
    try {
      // Create a map to consolidate locations by city and country
      const locationMap = new Map();
      
      visitorLocations.forEach(visitor => {
        const locationKey = `${visitor.city}|${visitor.country}`;
        
        if (!locationMap.has(locationKey)) {
          // Create new entry with count 1
          locationMap.set(locationKey, {
            ...visitor,
            visitorCount: 1,
            visitors: [visitor] // Store all visitors at this location
          });
        } else {
          // Update existing entry
          const existingLocation = locationMap.get(locationKey);
          existingLocation.visitorCount += 1;
          existingLocation.visitors.push(visitor);
          
          // If this visitor is more recent, update the timestamp
          if (new Date(visitor.timestamp) > new Date(existingLocation.timestamp)) {
            existingLocation.timestamp = visitor.timestamp;
          }
        }
      });
      
      // Convert map to array
      const consolidatedLocations = Array.from(locationMap.values());
      console.log(`Consolidated ${visitorLocations.length} visitors into ${consolidatedLocations.length} map locations`);
      
      setMapLocations(consolidatedLocations);
    } catch (error) {
      console.error("Error consolidating map locations:", error);
    }
  }, [visitorLocations]);

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

  // Filter map locations by date range
  const filteredMapLocations = useMemo(() => {
    if (!fromDate && !toDate) return mapLocations;

    return mapLocations.filter((location) => {
      const locationDate = new Date(location.timestamp).toISOString().split("T")[0];
      const isAfterFromDate = fromDate ? locationDate >= fromDate : true;
      const isBeforeToDate = toDate ? locationDate <= toDate : true;
      return isAfterFromDate && isBeforeToDate;
    });
  }, [mapLocations, fromDate, toDate]);

  // Filter functions for tables
  const filterMainTable = useCallback((item, searchText) => {
    return typeof item.text === 'string' && item.text.toLowerCase().includes(searchText.toLowerCase());
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

  // Geocode visitor locations if necessary
  const geocodeVisitorLocations = useCallback(async (locations) => {
    if (!user || user._id.toString() !== "6770a067c725cbceab958619" || !locations.length) {
      return locations;
    }

    try {
      // Only try to geocode locations that don't already have coordinates
      const locationsToGeocode = locations.filter(location => 
        !location.coordinates && location.city && location.country
      );
      
      if (!locationsToGeocode.length) {
        console.log('No locations need geocoding');
        return locations;
      }
      
      console.log(`Attempting to geocode ${locationsToGeocode.length} locations`);
      
      const config = {
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
      };
      
      const response = await axios.post('/api/data/geocode', 
        { locations: locationsToGeocode }, 
        config
      );
      
      if (!response.data || !Array.isArray(response.data)) {
        console.error('Invalid geocoding response:', response.data);
        return locations;
      }
      
      console.log(`Received ${response.data.length} geocoded locations`);
      
      // Merge geocoded locations with original locations
      const geocodedMap = new Map();
      response.data.forEach(location => {
        if (location.ip) {
          geocodedMap.set(location.ip, location);
        }
      });
      
      // Build new array with geocoded data where available
      return locations.map(location => {
        if (location.ip && geocodedMap.has(location.ip)) {
          return geocodedMap.get(location.ip);
        }
        return location;
      });
    } catch (error) {
      console.error('Error geocoding locations:', error);
      toast.error('Error geocoding visitor locations');
      return locations; // Return original locations if geocoding fails
    }
  }, [user]);

  // Geocode map locations when they're available
  useEffect(() => {
    if (mapLocations.length > 0) {
      geocodeVisitorLocations(mapLocations)
        .then(geocodedLocations => {
          if (JSON.stringify(geocodedLocations) !== JSON.stringify(mapLocations)) {
            setMapLocations(geocodedLocations);
          }
        });
    }
  }, [mapLocations, geocodeVisitorLocations]);

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
                </div>
                <Suspense fallback={<div className="admin-loading">Loading map...</div>}>
                  <VisitorMap 
                    locations={filteredMapLocations} 
                    mapConfig={mapConfig}
                    isLoading={isMapConfigLoading}
                    error={mapConfigError}
                  />
                </Suspense>
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
