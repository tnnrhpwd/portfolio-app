import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./VisitorMap.css";

/**
 * Interactive Leaflet map plotting real visitor coordinates on
 * OpenStreetMap/CARTO dark tiles (no API key or billing required).
 * Replaces the old static SVG + hardcoded-coordinate approach.
 */
const VisitorMap = ({ locations }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(null);

  // Initialise the Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      worldCopyJump: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);

    mapRef.current = map;
    markersRef.current = L.layerGroup().addTo(map);

    // Make sure the map fills its container once it is visible
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Redraw markers whenever the filtered locations change
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    const points = locations.filter(
      (loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lon)
    );

    points.forEach((loc) => {
      const marker = L.circleMarker([loc.lat, loc.lon], {
        radius: 7,
        color: "#2e7d32",
        weight: 1.5,
        fillColor: "#4caf50",
        fillOpacity: 0.85,
      });

      marker.bindPopup(
        [
          `<strong>IP:</strong> ${loc.ip || "Unknown"}`,
          `<strong>City:</strong> ${loc.city || "Unknown"}`,
          `<strong>Region:</strong> ${loc.region || "Unknown"}`,
          `<strong>Country:</strong> ${loc.country || "Unknown"}`,
          `<strong>Browser:</strong> ${loc.browser || "Unknown"}`,
          `<strong>OS:</strong> ${loc.os || "Unknown"}`,
        ].join("<br/>")
      );

      marker.bindTooltip(
        [loc.city, loc.country].filter(Boolean).join(", ") || "Unknown",
        { direction: "top", offset: L.point(0, -8) }
      );

      marker.addTo(layer);
    });

    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 5);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])), {
        padding: [30, 30],
        maxZoom: 8,
      });
    }
  }, [locations]);

  return <div ref={containerRef} className="visitor-map-leaflet" />;
};

export default VisitorMap;
