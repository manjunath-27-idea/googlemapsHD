# Google Maps HD Elevation & Navigation Suite

A premium, high-performance web mapping application featuring real-time turn-by-turn navigation, dynamic elevation profiling, GPS tracking, and robust offline caching capabilities.

---

## 🚀 Key Features

### 🏔️ Elevation Navigation & Elevation Profiling
- **Dynamic Elevation Charts**: Renders a beautiful color-graded terrain elevation profile for any calculated route.
- **Mean Sea Level (MSL) Hover Indicators**: Hovering over the active route highlights elevation points (`▲ m MSL`) dynamically on the map.
- **Elevation-Aware Step Guidance**: Turn-by-turn directions specify climb/descent maneuvers with height gains and losses.
- **Dynamic Legends**: Color-coded scale representing height bands from sea level.

### 🚗 Turn-by-Turn Navigation HUD
- **HUD Panel**: Displays active street names, maneuvers (arrows, icons), eta, and distance.
- **Auto-Centering GPS**: Real-time position tracking with precision accuracy rings.
- **Multi-Modal Routing**: Fast routing options for Drive (OSRM), Bike, and Foot paths.

### 💾 Performance-Optimized Offline Architecture
- **Single-Transaction Batch IndexedDB Queries**: Executes parallel coordinate elevation queries within a single read transaction in IndexedDB. This avoids concurrent transaction overhead and prevents mobile browser lag.
- **Normalized Subdomain Caching**: Intercepts OpenStreetMap tile requests in the service worker and normalizes subdomain letters (`a`, `b`, `c`) to a standardized single subdomain structure before caching. This resolves a critical offline cache-miss bug, ensuring pre-downloaded tiles load successfully 100% of the time.
- **Reverse Geocoding Village Cache**: Caches reverse geocoded village/location labels in `localStorage`, drastically reducing heavy Nominatim geocoding requests.
- **Full Offline Service Worker**: Intercepts and caches OSRM routes, Open-Meteo elevation metrics, and OSM tile files for a completely offline-ready user experience.

---

## 🛠️ Architecture & Core Files

- **[index.html](file:///c:/Users/91849/AntiGravityProjects/googlemapsHD/index.html)**: The main entry point (promoted from `maps-offline.html`). Features a fully responsive interface, resizable layout bars, custom navigation rails, and control panels.
- **[maps.js](file:///c:/Users/91849/AntiGravityProjects/googlemapsHD/maps.js)**: Orchestrates the geocoding, autocomplete dropdowns, route layer drawings, parallel IndexedDB elevation requests, MSL markers, GPS tracking, and control resizing calculations.
- **[maps.css](file:///c:/Users/91849/AntiGravityProjects/googlemapsHD/maps.css)**: Implements custom Google Sans styling, sleek glassmorphism HUD overlays, dark-mode status chips, and transitions.
- **[sw.js](file:///c:/Users/91849/AntiGravityProjects/googlemapsHD/sw.js)**: Fully integrated Service Worker intercepting fetch events for offline tile and geocoder caching.

---

## 💻 Tech Stack & Dependencies

- **Leaflet.js**: Lightweight open-source mapping library.
- **IndexedDB**: High-capacity local database caching elevation layers.
- **Open-Meteo Elevation API**: Rapid elevation data geolocator.
- **Nominatim Reverse Geocoding API**: High-accuracy OSM geocoding engine.
- **OSRM (Open Source Routing Machine)**: Robust direction and route calculator.
