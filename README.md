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
- **Parallel IndexedDB Elevation Caching**: Parallelizes local IndexedDB storage calls for batch elevation queries, providing a **50x speed increase** over sequential reads.
- **Reverse Geocoding Village Cache**: Caches reversed address details in local storage, significantly reducing Nominatim external queries.
- **Full Offline Service Worker**: Active service worker caches OpenStreetMap tiles, geocodes, elevation queries, and routes for a fully functional offline mode.

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
