import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleMap, LoadScript, Marker, InfoWindow } from '@react-google-maps/api';
import axios from 'axios';

const containerStyle = {
  width: '100%',
  height: '100%'
};

// Default center (can be overridden when map loads)
const defaultCenter = {
  lat: 20,
  lng: 0
};

const VisitorMap = ({ locations = [] }) => {
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [geocodedLocations, setGeocodedLocations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [mapConfig, setMapConfig] = useState(null);
  const mapRef = useRef(null);

  // Fetch map configuration including API key
  useEffect(() => {
    const fetchMapConfig = async () => {
      try {
        // Get token from localStorage
        const user = JSON.parse(localStorage.getItem('user'));
        if (!user || !user.token) {
          console.error('No authentication token available');
          setIsLoading(false);
          return;
        }

        const response = await axios.get('/api/data/map-config', {
          headers: { Authorization: `Bearer ${user.token}` }
        });
        
        setMapConfig(response.data);
      } catch (error) {
        console.error('Error fetching map configuration:', error);
      }
    };

    fetchMapConfig();
  }, []);

  // Fetch coordinates from backend for all locations
  useEffect(() => {
    const fetchCoordinates = async () => {
      if (!locations.length) {
        setIsLoading(false);
        return;
      }

      try {
        // Get token from localStorage
        const user = JSON.parse(localStorage.getItem('user'));
        if (!user || !user.token) {
          console.error('No authentication token available');
          setIsLoading(false);
          return;
        }

        const response = await axios.post(
          '/api/data/geocode',
          { locations },
          {
            headers: { Authorization: `Bearer ${user.token}` }
          }
        );

        const locationsWithCoordinates = response.data.filter(loc => loc.coordinates);
        setGeocodedLocations(locationsWithCoordinates);

        // If we have locations, center map on the most recent visitor
        if (locationsWithCoordinates.length > 0) {
          setMapCenter(locationsWithCoordinates[0].coordinates);
        }
      } catch (error) {
        console.error('Error fetching coordinates:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (mapConfig) {
      fetchCoordinates();
    }
  }, [locations, mapConfig]);

  // Handler for map load
  const onMapLoad = useCallback(map => {
    mapRef.current = map;
  }, []);

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch (e) {
      return timestamp || '';
    }
  };

  if (isLoading || !mapConfig) {
    return (
      <div className="visitor-map-container">
        <div className="loading-spinner">Loading map data...</div>
      </div>
    );
  }

  return (
    <div className="visitor-map-container">
      <LoadScript googleMapsApiKey={mapConfig.apiKey}>
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={mapCenter}
          zoom={2}
          onLoad={onMapLoad}
          options={mapConfig.mapOptions}
        >
          {geocodedLocations.map((visitor, index) => (
            <Marker
              key={`visitor-marker-${index}`}
              position={visitor.coordinates}
              onClick={() => setSelectedMarker(visitor)}
              animation={window.google.maps.Animation.DROP}
            />
          ))}

          {selectedMarker && (
            <InfoWindow
              position={selectedMarker.coordinates}
              onCloseClick={() => setSelectedMarker(null)}
            >
              <div className="visitor-info-window">
                <h4>{selectedMarker.city}, {selectedMarker.country}</h4>
                <p>IP: {selectedMarker.ip}</p>
                <p>Browser: {selectedMarker.browser || 'Unknown'}</p>
                <p>OS: {selectedMarker.os || 'Unknown'}</p>
                <p>Visited: {formatTimestamp(selectedMarker.timestamp)}</p>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </LoadScript>
      
      {geocodedLocations.length === 0 && (
        <div className="no-visitors-overlay">
          No visitor location data available
        </div>
      )}
    </div>
  );
};

export default VisitorMap;
