import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useNavigate } from "react-router-dom";
import { getAllData } from "../../features/data/dataSlice";
import "./Admin.css";
import { toast } from 'react-toastify';

// Reusable collapsible section component
const CollapsibleSection = ({ title, children, defaultCollapsed = false }) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  
  return (
    <div className="collapsible-section">
      <div 
        className="collapsible-header"
        onClick={() => setIsCollapsed(prev => !prev)}
        aria-expanded={!isCollapsed}
        role="button"
        tabIndex={0}
        onKeyPress={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setIsCollapsed(prev => !prev);
          }
        }}
      >
        <h3>{title}</h3>
        <span className={`collapse-icon ${isCollapsed ? 'collapsed' : ''}`} aria-hidden="true">
          {isCollapsed ? '▼' : '▲'}
        </span>
      </div>
      {!isCollapsed && (
        <div className="collapsible-content">
          {children}
        </div>
      )}
    </div>
  );
};

// Table component for scrollable tables
const ScrollableTable = ({ headers, data, renderRow, filterFn }) => {
  const [searchText, setSearchText] = useState("");
  
  // Memoize filtered data to prevent unnecessary re-filtering
  const filteredData = useMemo(() => {
    return data.filter(filterFn ? 
      (item) => filterFn(item, searchText) : 
      () => true);
  }, [data, filterFn, searchText]);
    
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
        <table className="admin-table" aria-label="Data table">
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th key={index} scope="col">{header}</th>
              ))}
            </tr>
          </thead>
        </table>
        <div className="table-scroll-container">
          <table className="admin-table">
            <tbody>
              {filteredData.length > 0 ? (
                filteredData.map(renderRow)
              ) : (
                <tr>
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

// Enhanced map component with scroll-based zooming
const VisitorMap = ({ locations }) => {
  const [mapScale, setMapScale] = useState(1);
  const [hoveredLocation, setHoveredLocation] = useState(null);
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const mapRef = useCallback((node) => {
    if (node) {
      const { width, height, left, top } = node.getBoundingClientRect();
      setSvgDimensions({ width, height, left, top });
    }
  }, []);

  const handleZoom = useCallback((e) => {
    e.preventDefault();
    setMapScale((prevScale) => {
      const newScale = prevScale - e.deltaY * 0.001; // Adjust zoom sensitivity
      return Math.min(2, Math.max(0.5, newScale)); // Clamp scale between 0.5 and 2
    });
  }, []);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - mapOffset.x, y: e.clientY - mapOffset.y });
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setMapOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const visitorDots = useMemo(() => {
    return locations.map((loc, index) => {
      const x = getLocationX(loc.country, loc.region, svgDimensions);
      const y = getLocationY(loc.country, loc.region, svgDimensions);

      return (
        <div
          key={index}
          className="visitor-dot"
          style={{
            left: `${x}px`,
            top: `${y}px`,
          }}
          onMouseEnter={() => setHoveredLocation(loc)}
          onMouseLeave={() => setHoveredLocation(null)}
          title={`${loc.city || 'Unknown'}, ${loc.region || 'Unknown'}, ${loc.country || 'Unknown'}`}
          role="img"
          aria-label={`Visitor from ${loc.city || 'Unknown'}, ${loc.region || 'Unknown'}, ${loc.country || 'Unknown'}`}
        />
      );
    });
  }, [locations, svgDimensions]);

  return (
    <div
      className="visitor-map-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleZoom} // Add scroll-based zooming
    >
      <div className="map-controls">
        <button onClick={() => setMapScale((prev) => Math.min(2, prev + 0.1))} aria-label="Zoom in" disabled={mapScale >= 2}>
          Zoom In
        </button>
        <button onClick={() => setMapScale((prev) => Math.max(0.5, prev - 0.1))} aria-label="Zoom out" disabled={mapScale <= 0.5}>
          Zoom Out
        </button>
      </div>
      <div
        className="visitor-map"
        style={{
          transform: `scale(${mapScale}) translate(${mapOffset.x}px, ${mapOffset.y}px)`,
          cursor: isDragging ? "grabbing" : "grab",
        }}
      >
        <div className="world-map-placeholder" ref={mapRef}>
          <div className="map-background" role="presentation"></div>
          {visitorDots}
          {hoveredLocation && (
            <div
              className="visitor-popup"
              style={{
                left: `${getLocationX(hoveredLocation.country, hoveredLocation.region, svgDimensions)}px`,
                top: `${getLocationY(hoveredLocation.country, hoveredLocation.region, svgDimensions)}px`,
              }}
            >
              <p><strong>IP:</strong> {hoveredLocation.ip}</p>
              <p><strong>City:</strong> {hoveredLocation.city || 'Unknown'}</p>
              <p><strong>Region:</strong> {hoveredLocation.region || 'Unknown'}</p>
              <p><strong>Country:</strong> {hoveredLocation.country || 'Unknown'}</p>
              <p><strong>Browser:</strong> {hoveredLocation.browser || 'Unknown'}</p>
              <p><strong>OS:</strong> {hoveredLocation.os || 'Unknown'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Adjusted helper functions to calculate positions based on SVG dimensions
function getLocationX(country, region, svgDimensions) {
  const locationMap = {
    'US': { base: 0.2, 'California': 0.1, 'New York': 0.3, 'Georgia': 0.25 },
    'UK': 0.5,
    'DE': 0.55,
    'FR': 0.52,
    'JP': 0.85,
    'CN': 0.78,
    'AU': 0.9,
    'CA': 0.15,
    'BR': 0.4,
    'IN': 0.65,
    'RU': 0.6,
  };

  let x = 0.5; // Default center as a fraction
  if (typeof locationMap[country] === 'object') {
    x = region && locationMap[country][region] ? locationMap[country][region] : locationMap[country].base;
  } else if (locationMap[country]) {
    x = locationMap[country];
  }

  return svgDimensions.left + x * svgDimensions.width; // Adjusted for SVG bounding box
}

function getLocationY(country, region, svgDimensions) {
  const locationMap = {
    'US': 0.35,
    'UK': 0.4,
    'DE': 0.42,
    'FR': 0.45,
    'JP': 0.5,
    'CN': 0.3,
    'AU': 0.8,
    'CA': 0.3,
    'BR': 0.7,
    'IN': 0.5,
    'RU': 0.4,
  };

  let y = 0.5; // Default center as a fraction
  if (locationMap[country]) {
    y = locationMap[country];
  }

  return svgDimensions.top + y * svgDimensions.height; // Adjusted for SVG bounding box
}

// Parse visitor data from text with proper error handling
function parseVisitorData(text) {
  if (!text || typeof text !== 'string') return null;
  
  try {
    const ipMatch = text.match(/IP:([^|]+)/);
    const deviceMatch = text.match(/Device:([^|]+)/);
    const osMatch = text.match(/OS:([^|]+)/);
    const browserMatch = text.match(/Browser:([^|]+)/);
    const methodMatch = text.match(/Method:([^|]+)/);
    const urlMatch = text.match(/URL:([^|]+)/);
    const platformMatch = text.match(/Platform:([^|]+)/);
    const cityMatch = text.match(/City:([^|]+)/);
    const regionMatch = text.match(/Region:([^|]+)/);
    const countryMatch = text.match(/Country:([^|]+)/);
    
    if (!ipMatch) return null;
    
    // Extract timestamp from data if possible
    const timestamp = new Date().toISOString();
    
    return {
      ip: ipMatch ? ipMatch[1].trim() : '',
      device: deviceMatch ? deviceMatch[1].trim() : '',
      os: osMatch ? osMatch[1].trim() : '',
      browser: browserMatch ? browserMatch[1].trim() : '',
      method: methodMatch ? methodMatch[1].trim() : '',
      url: urlMatch ? urlMatch[1].trim() : '',
      platform: platformMatch ? platformMatch[1].trim() : '',
      city: cityMatch ? cityMatch[1].trim() : '',
      region: regionMatch ? regionMatch[1].trim() : '',
      country: countryMatch ? countryMatch[1].trim() : '',
      timestamp
    };
  } catch (error) {
    console.error("Error parsing visitor data:", error);
    return null;
  }
}

function Admin() {
  const { user, data, dataMessage, dataIsSuccess, dataIsLoading, dataIsError } = useSelector((state) => state.data);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [allObjectArray, setAllObjectArray] = useState([]);
  const [visitorLocations, setVisitorLocations] = useState([]);
  
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
      
      setVisitorLocations(Array.from(visitorMap.values()));
    } catch (error) {
      console.error("Error processing visitor data:", error);
    }
  }, [data, dataIsSuccess]);

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
                  headers={["ID", "Text", "Files", "Created At", "Updated At"]}
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
                {visitorLocations.length > 0 ? (
                  <VisitorMap locations={visitorLocations} />
                ) : (
                  <p className="admin-no-data">No visitor location data available</p>
                )}
              </CollapsibleSection>
              
              <CollapsibleSection title="Recent Visitors" defaultCollapsed={true}>
                {visitorLocations.length > 0 ? (
                  <ScrollableTable 
                    headers={["IP Address", "Location", "Country", "Browser/OS", "Timestamp"]}
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
