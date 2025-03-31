import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleMap, LoadScript, Marker, InfoWindow } from '@react-google-maps/api';
import { useDispatch, useSelector } from 'react-redux';
import { getMapConfig, geocodeLocations } from '../../features/data/dataSlice';

const containerStyle = {
  width: '100%',
  height: '100%'
};

// Default center (can be overridden when map loads)
const defaultCenter = {
  lat: 20,
  lng: 0
};

// Animation constants - use these instead of directly referencing window.google.maps
const ANIMATION_DROP = 2; // Equivalent to google.maps.Animation.DROP

const VisitorMap = ({ locations = [] }) => {
  const [selectedMarker, setSelectedMarker] = useState(null);
  const dispatch = useDispatch();
  const { mapConfig, geocodedLocations, dataIsLoading } = useSelector((state) => state.data);
  const [isLoading, setIsLoading] = useState(true);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const mapRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [zoom, setZoom] = useState(2);
  const [center, setCenter] = useState(defaultCenter);

  // Fetch map configuration including API key
  useEffect(() => {
    setIsLoading(true);
    dispatch(getMapConfig())
      .finally(() => setIsLoading(false));
  }, [dispatch]);

  // Fetch coordinates from backend for all locations
  useEffect(() => {
    if (mapConfig && locations.length > 0) {
      setIsLoading(true);
      dispatch(geocodeLocations(locations))
        .then((response) => {
          if (response.payload && response.payload.length > 0) {
            // If we have locations, center map on the most recent visitor
            setMapCenter(response.payload[0].coordinates);
          }
        })
        .finally(() => setIsLoading(false));
    }
  }, [locations, mapConfig, dispatch]);

  // Reference to track if component is mounted
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);
  
  // Function to fit map to markers
  const fitMapToMarkers = useCallback(() => {
    if (!mapInstance || !geocodedLocations || geocodedLocations.length === 0 || !window.google || !window.google.maps) return;
    
    try {
      const bounds = new window.google.maps.LatLngBounds();
      
      geocodedLocations.forEach((location) => {
        if (location.coordinates) {
          bounds.extend({
            lat: location.coordinates.lat,
            lng: location.coordinates.lng
          });
        }
      });
      
      mapInstance.fitBounds(bounds);
      
      // If we only have one marker, set an appropriate zoom level
      if (geocodedLocations.length === 1 && isMounted.current) {
        setZoom(4);
        setTimeout(() => {
          if (mapInstance && isMounted.current) mapInstance.setZoom(4);
        }, 100);
      }
    } catch (e) {
      console.error('Error fitting map to markers:', e);
    }
  }, [mapInstance, geocodedLocations]);
  
  // Fit map to markers when map loads or locations change
  useEffect(() => {
    if (mapInstance && geocodedLocations && geocodedLocations.length > 0) {
      fitMapToMarkers();
    }
  }, [mapInstance, geocodedLocations, fitMapToMarkers]);

  // Handler for map load
  const onMapLoad = useCallback((loadedMap) => {
    setMapInstance(loadedMap);
  }, []);

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch (e) {
      return timestamp || '';
    }
  };

  // Get marker size based on visitor count (for visual scaling)
  const getMarkerSize = (visitorCount) => {
    // Base size of 20px
    const baseSize = 20;
    
    // Scale based on visitor count, but with a max size 
    const scaleFactor = Math.min(1.5, 1 + (visitorCount - 1) * 0.1);
    
    return {
      width: `${baseSize * scaleFactor}px`,
      height: `${baseSize * scaleFactor}px`,
    };
  };

  if (isLoading || !mapConfig) {
    return (
      <div className="visitor-map-container">
        <div className="loading-spinner">Loading map data...</div>
      </div>
    );
  }

  // Show error state
  if (!mapConfig || !mapConfig.apiKey) {
    return (
      <div className="visitor-map-container">
        <div className="error-message">
          {"Map configuration error. Please check your Google Maps API key."}
        </div>
      </div>
    );
  }

  // Show empty state
  if (!geocodedLocations || geocodedLocations.length === 0) {
    return (
      <div className="visitor-map-container">
        <div className="no-visitors-overlay">No visitor location data available</div>
      </div>
    );
  }

  return (
    <div className="visitor-map-container">
      <LoadScript googleMapsApiKey={mapConfig.apiKey}>
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={center}
          zoom={zoom}
          onLoad={onMapLoad}
          options={mapConfig.mapOptions}
        >
          {geocodedLocations && geocodedLocations.map((location, index) => {
            // Check if location has valid coordinates
            if (!location.coordinates || typeof location.coordinates.lat !== 'number') return null;
            
            // Get marker options based on whether this is a mock location
            const markerOptions = location.isMockLocation 
              ? { opacity: 0.5 }
              : {};
            
            // Get visitor count (default to 1 if not specified)
            const visitorCount = location.visitorCount || 1;
            
            // Create custom marker with count
            return (
              <Marker
                key={`marker-${location.ip || index}`}
                position={{
                  lat: location.coordinates.lat,
                  lng: location.coordinates.lng
                }}
                onClick={() => setSelectedMarker(location)}
                animation={ANIMATION_DROP}
                label={{
                  text: visitorCount > 1 ? visitorCount.toString() : '',
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: 'bold'
                }}
                icon={{
                  path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
                  fillColor: '#4285F4',
                  fillOpacity: 0.9,
                  scale: 8 + Math.min(8, (visitorCount - 1) * 2), // Scale based on visitor count
                  strokeColor: '#ffffff',
                  strokeWeight: 2,
                }}
                {...markerOptions}
              />
            );
          })}

          {selectedMarker && (
            <InfoWindow
              position={{
                lat: selectedMarker.coordinates.lat,
                lng: selectedMarker.coordinates.lng
              }}
              onCloseClick={() => setSelectedMarker(null)}
            >
              <div className="visitor-info-window">
                <h4>{selectedMarker.city || 'Unknown'}, {selectedMarker.country || 'Unknown'}</h4>
                {selectedMarker.isMockLocation && (
                  <p><i>Note: Approximate location only</i></p>
                )}
                <p><strong>Visitors:</strong> {selectedMarker.visitorCount || 1}</p>
                <p><strong>Last visit:</strong> {formatTimestamp(selectedMarker.timestamp)}</p>
                
                {/* Show details of all visitors if multiple */}
                {selectedMarker.visitors && selectedMarker.visitors.length > 1 && (
                  <div>
                    <p><strong>Recent visitors:</strong></p>
                    <ul className="visitor-list">
                      {selectedMarker.visitors.slice(0, 5).map((visitor, idx) => (
                        <li key={idx}>
                          {visitor.browser || 'Unknown browser'} / {visitor.os || 'Unknown OS'}
                          <br />
                          <small>{formatTimestamp(visitor.timestamp)}</small>
                        </li>
                      ))}
                      {selectedMarker.visitors.length > 5 && (
                        <li>...and {selectedMarker.visitors.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
                
                {/* Show single visitor details if just one */}
                {(!selectedMarker.visitors || selectedMarker.visitors.length === 1) && (
                  <>
                    <p><strong>Browser:</strong> {selectedMarker.browser || 'Unknown'}</p>
                    <p><strong>OS:</strong> {selectedMarker.os || 'Unknown'}</p>
                  </>
                )}
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </LoadScript>
      
      <div className="map-controls">
        <button onClick={fitMapToMarkers}>Fit to Visitors</button>
      </div>
      
      <div className="map-legend">
        <span>Visitor count indicated by number</span>
      </div>
    </div>
  );
};

export default VisitorMap;
