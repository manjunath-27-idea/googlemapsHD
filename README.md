# Google Maps HD Elevation & Navigation Suite

A single-page, high-performance web mapping application featuring real-time turn-by-turn navigation, dynamic elevation profiling, GPS blue-dot tracking, and a robust offline-caching service worker. 

---

## 📖 Table of Contents
1. [Core Architectural Overview](#-core-architectural-overview)
2. [Database & Caching Systems](#-database--caching-systems)
3. [Key Algorithmic Concepts](#-key-algorithmic-concepts)
4. [UI/UX & Layout Management](#-uiux--layout-management)
5. [Tech Stack & API Dependencies](#-tech-stack--api-dependencies)
6. [File Structure Directory](#-file-structure-directory)

---

## 🏗️ Core Architectural Overview

The application is structured as a **Single-Page Application (SPA)**, utilizing a modular vanilla architecture consisting of four core files: `index.html`, `maps.js`, `maps.css`, and `sw.js`. By omitting heavy JS frameworks, the app ensures instant loading, lightweight footprints, and optimal runtime speed in mobile environments.

```
                  ┌────────────────────────────────────────┐
                  │               index.html               │
                  │   (DOM Structure & Responsive Panels)  │
                  └───────────┬────────────────┬───────────┘
                              │                │
                              ▼                ▼
                  ┌────────────────┐      ┌────────────────┐
                  │    maps.css    │      │    maps.js     │
                  │ (Sleek Glass-  │      │ (Core Business │
                  │  morphic UI)   │      │     Logic)     │
                  └────────────────┘      └────────┬───────┘
                                                   │
                                                   ▼
                                          ┌────────────────┐
                                          │     sw.js      │
                                          │(Service Worker │
                                          │ Offline Cache) │
                                          └────────────────┘
```

---

## 💾 Database & Caching Systems

To enable offline routing and navigation, the application implements a multi-tier caching hierarchy combining **IndexedDB**, **Web Storage (LocalStorage)**, and **Service Worker Cache API**.

### 1. IndexedDB (Elevation Store)
- **Database Name**: `maps-elevation-v1`
- **Object Store**: `elev`
- **Keys**: String representation of rounded coordinates: `${lat.toFixed(3)},${lon.toFixed(3)}` (representing a spatial grid cell of ~111m resolution).
- **Values**: Numerical elevation in meters above sea level.
- **Why IndexedDB?**: Traditional LocalStorage is blocking and has a 5MB limit. IndexedDB runs asynchronously on a separate thread and allows storing hundreds of megabytes of topographic coordinates without locking the main UI thread.

### 2. LocalStorage (Address & Location Caches)
- **Nominatim Reverse Geocoding Cache**: Caches location address names using the key format `nom_${lat.toFixed(3)}_${lon.toFixed(3)}`. This throttles high-frequency reverse geocoding API calls.
- **Geocoding Search Cache**: Caches coordinates for text search queries (e.g. `gc:city_name`), avoiding duplicate server calls.
- **Ground Reference Store**: Saves the custom user-defined sea level reference (`groundLevel`) to maintain custom topographic scales across sessions.

### 3. Service Worker Cache API
- **Maps Tiles Cache (`maps3d-tiles-v4`)**: Caches OpenStreetMap tiles.
- **Route Cache (`maps3d-routes-v4`)**: Stores route coordinate line strings from OSRM.
- **Geocoding Cache (`maps3d-geo-v4`)**: Caches reverse geocoding queries.
- **Elevation Cache (`maps3d-elevation-v4`)**: Caches Open-Meteo API JSON queries.

---

## 🏔️ The Detailed Elevation System & Topographical Algorithms

The core of the navigation suite is its offline-first elevation engine, which operates across multiple layers of caching, interpolation, and geometric processing.

### 1. Spatial Grid Hashing & Key Quantization
To cache geographical coordinates efficiently in a local database without consuming infinite memory, the engine quantizes coordinates into a uniform spatial hash grid:
* **Quantization Key Generation**: Latitude and longitude are formatted to 3 decimal places to create a coordinate key:
  $$\text{Key} = \text{lat.toFixed(3)} + \text{","} + \text{lon.toFixed(3)}$$
* **Resolution Scale**: At the equator, 1 degree of latitude is approximately 111 kilometers. Consequently, a step size of $0.001^{\circ}$ resolves to a spatial grid cell of approximately **111 meters** in width and height.
* **Memory & Storage Performance**: Quantizing coordinates ensures that adjacent path points map to the same grid cell, reducing redundant API hits and compressing the size of the database.

---

### 2. High-Performance Asynchronous Query Pipeline
Spawning sequential queries for each coordinate point on a route introduces massive latency and blocks the main execution loop. The engine resolves this through an asynchronous batching pipeline:

```
               [Coordinate Stream (Route Points)]
                               │
                               ▼
               [Single-Transaction IDB Open]
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
       [IndexedDB Cache Hit]           [IndexedDB Cache Miss]
               │                               │
               ▼                               ▼
       [Return Value]                  [Group into Chunks of 100]
                                               │
                                               ▼
                                     [Fetch from Open-Meteo]
                                               │
                                               ▼
                                     [Promise.all DB Writes]
                                               │
                                               ▼
                                      [Canvas Rendering]
```

* **Single-Transaction Batch Queries**: When loading coordinates for a route, the app opens **one single read-only transaction** (`db.transaction('elev', 'readonly')`). It executes all queries concurrently within this single transaction, wrapping each lookup request in a `Promise` and awaiting them via `Promise.all()`. This provides a **50x query speedup** compared to multi-transaction approaches.
* **Network Batch Requests**: Coordinates that miss the database cache are gathered, chunked in batches of 100 points, and dispatched in a single request to the Open-Meteo elevation API. If Open-Meteo fails, the request falls back to the Open-Elevation POST service.
* **Synchronous Write Guarantee**: To prevent race conditions where the canvas renders before database updates finish, `fetchElevBatch` compiles all database write operations into a list and resolves only after `await Promise.all(writes)` completes.

---

### 3. Bilinear-Interpolated Viewport Heatmap
When the topographic view (flag button) is active, the custom Canvas Layer interpolates elevation data across the visible map viewport using bilinear interpolation to generate a smooth elevation gradient fill:

* **Bilinear Interpolation Formula**: Let a grid cell be bounded by four known corners: Top-Left ($TL$), Top-Right ($TR$), Bottom-Left ($BL$), and Bottom-Right ($BR$). The normalized coordinates $x$ and $y$ lie within $[0, 1]$. The interpolated elevation $E(x, y)$ is defined by:
  $$E(x, y) = TL(1-x)(1-y) + TR \cdot x(1-y) + BL(1-x)y + BR \cdot x y$$
* **Viewport Subdivision**: At high zoom levels (zoom $\ge 14$), each grid cell is subdivided into $5 \times 5$ sub-cells. At lower zoom levels (zoom $\ge 10$), subdivision scales to $2 \times 2$ to balance quality and performance.
* **Viewport Thread Protection**: A zoom guard locks elevation grid generation for zoom levels below 12. Additionally, grid dimension bounds ($rows \times cols$) are capped at 350 points, bypassing updates if the visible viewport is too wide.

---

### 4. Marching Squares Topographical Contours
To overlay vector contour lines (iso-elevation curves) on top of the map, the application executes the **Marching Squares algorithm** on the computed 2D grid:

1. **Iso-value Comparison**: The contour engine evaluates every $2 \times 2$ cell block in the grid against a range of contour elevation intervals (e.g. intervals of 2, 10, 25, 100, or 250 meters based on viewport topography).
2. **Binary Index Masking**: Each corner of the cell is compared to the target iso-level. If the corner's elevation is $\ge$ the iso-level, its assigned bit is flagged. This produces a 4-bit state index (from 0 to 15):
   $$\text{index} = (TL \ge L) \cdot 8 + (TR \ge L) \cdot 4 + (BR \ge L) \cdot 2 + (BL \ge L) \cdot 1$$

   ```
     TL (Bit 3) ───[0/1]─── TR (Bit 2)
        │                     │
      [3]                   [1]
        │                     │
     BL (Bit 0) ───[2]─── BR (Bit 1)
   ```

3. **Segment Lookup Table**: The 4-bit index queries a static lookup table (`_MS`) that identifies which edges (0: top, 1: right, 2: bottom, 3: left) must be connected to draw the contour line inside that cell.
4. **Sub-Pixel Linear Interpolation**: To avoid staircase offsets, segment intersection points along the cell edges are linearly interpolated:
   $$t = \frac{\text{level} - A}{B - A}$$
   where $A$ and $B$ are the elevation values of the adjacent corner nodes.
5. **Legibility Hierarchy**: Every 5th contour line is classified as a major index contour, drawn with a thicker stroke (1.4px, `rgba(0,50,0,0.65)`) compared to intermediate minor lines (0.7px, `rgba(0,60,0,0.38)`).

---

### 5. Interactive Charting & Village Annotation Stalks
* **Dynamic Hover Tooltips**: High-precision hover indicators (`L.circleMarker`) are spaced along the active navigation route. Interacting with the path triggers floating `msl-tooltip` bubbles displaying the Mean Sea Level (`▲ m MSL`). Tooltips are cleaned from the map 30 seconds after interaction.
* **Geographical Village Stalks**: A background parser reverse-geocodes intermediate route points using the Nominatim API. Queries are cached in LocalStorage (`nom_lat_lon`) and throttled with a 1.1-second timer to respect OpenStreetMap connection rules. The chart renders these village names as vertical stakes above the coordinate nodes, using horizontal collision-avoidance logic to prevent overlapping labels.
* **GPS Altitude Tracking**: If GPS connectivity provides high-accuracy altitude data, the system bypasses API lookups, overrides calculated metrics in real-time, updates the active tracker point on the profile chart, and saves the verified elevation coordinates directly back into the local database cache.

---

### 6. Relative Terrain Reference & The Dynamic Datum Shift Concept (Custom MSL Offset)
Traditionally, topographic maps present elevation as an absolute height above a static global datum—**Mean Sea Level (MSL)**. While globally consistent, this absolute scale is poorly optimized for localized spatial reasoning. For instance, in a city situated on a high plateau (such as Hyderabad at ~540 meters above MSL), a standard global color scale would render the entire region in high-altitude orange/red tones, erasing local micro-topography.

To solve this limitation, this mapping suite introduces a **Dynamic Datum Shift (Relative MSL Mapping)** concept:

* **Custom Ground Reference Level ($G$)**: The user can establish any arbitrary altitude as the local ground reference level ($G$), such as a city's baseline elevation, a specific trail head, or a geological datum.
* **Relative Elevation Gradient Shift**: Instead of mapping the absolute elevation ($E$) to color ramps, the canvas interpolation engine evaluates the relative delta ($\Delta E$) for each grid coordinate:
  $$\Delta E = E - G$$
* **Localized Color Scale Transformation**:
  * **Neutral Ground Level ($\Delta E = 0$ m)**: Rendered in a neutral **green** tone, representing local sea-level equivalence.
  * **Local Depression Zones ($\Delta E < 0$ m)**: Rendered in **deep-blue to cyan** gradients. This dynamically highlights localized valleys, dry lake beds, river trenches, and basins relative to the surrounding base elevation.
  * **Local Uplift Zones ($\Delta E > 0$ m)**: Rendered in **yellow, orange, and red** gradients. This immediately emphasizes hills, ridges, peaks, and climbs relative to the local ground level.
* **Practical Applications**: For hikers, cyclists, and geologists, this relative mapping paradigm transforms the display. Setting the reference level to their starting point immediately colors their path into absolute uphill climbs versus downhill segments, providing highly contextual topographic feedback optimized for local activities.

---

## 🎨 UI/UX & Layout Management

```
┌─────────────────────────────────────────────────────────┐
│ [Search Bar]                                            │
│                                                         │
│                                                         │
│                     [Active Map]                        │
│                                                         │
│                                                         │
│                                           [Map Zoom]    │
│                                           [GPS Locator] │
│                                           [Flag Button] │
│ ┌───────────────────────────────────────┐ [Legend]      │
│ │          Elevation Profile            │ [Elev Chip]   │
│ └───────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

### 1. Resizer Syncing & Layout Offsets
The elevation profile panel at the bottom is resizable. When opened, it displaces visible controls above it.
- **Asymmetrical Resizer Layout**: Dragging the elevation resizer recalculates custom property variables (`--elev-h`). 
- **Layout Syncing**: `syncElevOverlays()` reads the height state and dynamically shifts map scale indicators, coordinates chips, elevation legends, and toast alert boxes upwards by calculated HSL spacing (e.g. `52px + h`) via smooth CSS transitions.

### 2. Mean Sea Level (MSL) Hover Tooltips
- When a route is calculated, the application places highly optimized `L.circleMarker` elements along the path at regular intervals, saving the elevation metrics inside their properties.
- When the user hovers over the active path, it triggers the display of precise, floating overlay tooltips (`▲ m MSL`). The tooltips are automatically cleared after 30 seconds to maintain map clarity.

### 3. Marching Squares Contour Mapping
- Evaluates the 2D elevation grid and processes each cell using the **Marching Squares algorithm**.
- Assigns a 4-bit binary index representing whether each corner lies above or below an iso-elevation boundary.
- Resolves the index through a lookup table (`_MS`) to draw smooth topographic contour lines across coordinates.

---

## 🛠️ Tech Stack & API Dependencies

- **Leaflet.js**: Lightweight open-source mapping engine.
- **IndexedDB / Web Storage**: Asynchronous offline persistence.
- **OpenStreetMap Tiles**: Worldwide basemap tiles.
- **OSRM (Open Source Routing Machine)**: Direction and step engine.
- **Nominatim API**: OpenStreetMap geocoding and reverse geocoding engine.
- **Open-Meteo Elevation API**: High-frequency grid elevation service.

---

## 📂 File Structure Directory

- **`index.html`**: The unified, single-page DOM structure containing Leaflet elements, search panels, and coordinate tooltips.
- **`maps.js`**: Core mapping algorithms, parallel IndexedDB batch processing, Leaflet controllers, and HUD calculators.
- **`maps.css`**: Styling system featuring Google Sans typography, custom drag resizers, and glassmorphic overlays.
- **`sw.js`**: Service worker handling offline intercepting, normalized OSM subdomain mapping, and resource caching.
