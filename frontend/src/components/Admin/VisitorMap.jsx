import React, { useState, useCallback, useMemo } from "react";
import "./VisitorMap.css"; // Add styles if needed

const VisitorMap = ({ locations }) => {
  const [mapScale, setMapScale] = useState(1);
  const [hoveredLocation, setHoveredLocation] = useState(null);
  const [svgDimensions, setSvgDimensions] = useState({
    width: 0,
    height: 0,
    left: 0,
    top: 0,
  });
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
          title={`${loc.city || "Unknown"}, ${loc.region || "Unknown"}, ${
            loc.country || "Unknown"
          }`}
          role="img"
          aria-label={`Visitor from ${loc.city || "Unknown"}, ${
            loc.region || "Unknown"
          }, ${loc.country || "Unknown"}`}
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
        <button
          onClick={() => setMapScale((prev) => Math.min(2, prev + 0.1))}
          aria-label="Zoom in"
          disabled={mapScale >= 2}
        >
          Zoom In
        </button>
        <button
          onClick={() => setMapScale((prev) => Math.max(0.5, prev - 0.1))}
          aria-label="Zoom out"
          disabled={mapScale <= 0.5}
        >
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
                left: `${getLocationX(
                  hoveredLocation.country,
                  hoveredLocation.region,
                  svgDimensions
                )}px`,
                top: `${getLocationY(
                  hoveredLocation.country,
                  hoveredLocation.region,
                  svgDimensions
                )}px`,
              }}
            >
              <p>
                <strong>IP:</strong> {hoveredLocation.ip}
              </p>
              <p>
                <strong>City:</strong> {hoveredLocation.city || "Unknown"}
              </p>
              <p>
                <strong>Region:</strong> {hoveredLocation.region || "Unknown"}
              </p>
              <p>
                <strong>Country:</strong> {hoveredLocation.country || "Unknown"}
              </p>
              <p>
                <strong>Browser:</strong> {hoveredLocation.browser || "Unknown"}
              </p>
              <p>
                <strong>OS:</strong> {hoveredLocation.os || "Unknown"}
              </p>
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
    US: { 
      base: 0.2, 
      "New York": 0.30, 
      Georgia: 0.265, 
      Virginia: 0.29, 
      Texas: 0.24,
      "North Carolina": 0.28
    },
    MX: 0.25, // Added Mexico (MX) with approximate X coordinate
    UK: 0.5,
    DE: 0.55,
    FR: 0.52,
    JP: 0.85,
    CN: 0.78,
    AU: 0.9,
    CA: 0.3,
    BR: 0.4,
    IN: 0.65,
    RU: 0.6,
  };

  let x = 0.5; // Default center as a fraction
  if (typeof locationMap[country] === "object") {
    x =
      region && locationMap[country][region]
        ? locationMap[country][region]
        : locationMap[country].base;
  } else if (locationMap[country]) {
    x = locationMap[country];
  }

  // Ensure the x-coordinate is within the SVG's width
  return Math.max(0, Math.min(svgDimensions.width, x * svgDimensions.width));
}

function getLocationY(country, region, svgDimensions) {
  const locationMap = {
    US: {
      base: 0.35,
      "New York": 0.275,
      Georgia: 0.33,
      Virginia: 0.31, 
      Texas: 0.34,
      "North Carolina": 0.32
    },
    MX: 0.45, // Mexico
    UK: 0.4,
    DE: 0.42,
    FR: 0.45,
    JP: 0.5,
    CN: 0.3,
    AU: 0.8,
    CA: 0.23,
    BR: 0.7,
    IN: 0.5,
    RU: 0.4,
  };

  let y = 0.5; // Default center as a fraction
  if (typeof locationMap[country] === "object") {
    y =
      region && locationMap[country][region]
        ? locationMap[country][region]
        : locationMap[country].base;
  } else if (locationMap[country]) {
    y = locationMap[country];
  }

  // Ensure the y-coordinate is within the SVG's height
  return Math.max(0, Math.min(svgDimensions.height, y * svgDimensions.height));
}

export default VisitorMap;
