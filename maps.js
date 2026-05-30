// ══════════════════════════════════════════
//  SERVICE WORKER REGISTRATION
// ══════════════════════════════════════════
let swReady = false, swCtrl = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    swReady = true;
    document.getElementById('sw-badge').style.display = 'inline';
    const ctrl = reg.active || reg.installing || reg.waiting;
    if (ctrl) swCtrl = ctrl;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      swCtrl = navigator.serviceWorker.controller;
    });
    navigator.serviceWorker.addEventListener('message', onSWMsg);
    setTimeout(getSWStats, 800);
  }).catch(e => console.warn('SW failed:', e));
}

// ══════════════════════════════════════════
//  ONLINE / OFFLINE
// ══════════════════════════════════════════
function updateNetStatus() {
  document.getElementById('offline-banner').classList.toggle('show', !navigator.onLine);
}
window.addEventListener('online', updateNetStatus);
window.addEventListener('offline', updateNetStatus);
updateNetStatus();

// ══════════════════════════════════════════
//  MAP
// ══════════════════════════════════════════
const map = L.map('map', { zoomControl: false }).setView([20, 0], 3);
L.control.scale({ imperial: true, metric: true, position: 'bottomright' }).addTo(map);

map.on('zoomend', () => {
    if (S.elevMarkersGroup) {
        if (map.getZoom() >= 14) {
            if (!map.hasLayer(S.elevMarkersGroup)) map.addLayer(S.elevMarkersGroup);
        } else {
            if (map.hasLayer(S.elevMarkersGroup)) map.removeLayer(S.elevMarkersGroup);
            if (typeof _elevProfileData !== 'undefined') {
                 _elevProfileData.forEach(d => { if (d.activeTooltip) { map.removeLayer(d.activeTooltip); d.activeTooltip = null; } });
            }
        }
    }
});

let _currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19, crossOrigin: true
}).addTo(map);

// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
const S = {
  mode: 'car', origin: null, dest: null, oC: null, dC: null,
  routeL: null, routeShadow: null, oMark: null, dMark: null,
  myMark: null, myCircle: null, watchId: null, gpsOk: false, gpsCoords: null,
  ctxLL: null, ctxElev: null, steps: [], stepCoords: [], activeStep: -1, navigating: false,
  areas: JSON.parse(localStorage.getItem('offAreas') || '[]'),
  groundLevel: parseFloat(localStorage.getItem('groundLevel') || '0'),
  mapLayer: 'map', heatmapOn: false, elevSegments: []
};

// ══════════════════════════════════════════
//  ICONS
// ══════════════════════════════════════════
function mkPin(color, ltr) {
  return L.divIcon({
    className: '',
    html: `<svg width="30" height="42" viewBox="0 0 30 42"><path d="M15 1C8.37 1 3 6.37 3 13c0 8.5 12 27 12 27S27 21.5 27 13C27 6.37 21.63 1 15 1z" fill="${color}" stroke="white" stroke-width="2"/><text x="15" y="17" text-anchor="middle" fill="white" font-size="10" font-weight="bold" font-family="sans-serif">${ltr}</text></svg>`,
    iconSize: [30, 42], iconAnchor: [15, 42], popupAnchor: [0, -42]
  });
}
function mkMyLoc() {
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:22px;height:22px"><div style="position:absolute;inset:0;border-radius:50%;background:#1a73e8;opacity:.2;transform:scale(2.5)"></div><div style="position:absolute;inset:4px;border-radius:50%;background:#1a73e8;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11]
  });
}
const iA = mkPin('#1a73e8', 'A'), iB = mkPin('#d93025', 'B'), iPin = mkPin('#5f6368', '');

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
let _tt = null;
function toast(msg, d = 3200) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  if (_tt) clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), d);
}

// ══════════════════════════════════════════
//  GPS
// ══════════════════════════════════════════
function requestGPS() {
  if (!navigator.geolocation) { toast('Geolocation not supported'); return; }
  if (S.gpsOk) { locateMe(); return; }
  document.getElementById('gps-panel').classList.add('show');
}
function grantGPS() {
  document.getElementById('gps-panel').classList.remove('show');
  document.getElementById('gps-status').classList.add('show');
  setGPSDot('searching', 'Searching for GPS…', '');
  if (S.watchId !== null) return;
  S.watchId = navigator.geolocation.watchPosition(
    pos => {
      const isFirst = !S.gpsOk;
      const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
      S.gpsOk = true; S.gpsCoords = [lat, lon];
      setGPSDot('active', 'GPS active', `±${Math.round(acc)}m`);
      document.getElementById('locate-fab').classList.add('active');
      document.getElementById('gps-status').classList.add('show');
      updateMyLocMarker(lat, lon, acc);
      if (S.navigating) doNavUpdate(lat, lon);
      if (isFirst && S.myCircle) {
        map.fitBounds(S.myCircle.getBounds(), { maxZoom: 18 });
      }
    },
    err => {
      const m = { 1: 'Location access denied', 2: 'Position unavailable', 3: 'Location timed out' };
      setGPSDot('error', m[err.code] || 'GPS error', '');
      toast(m[err.code] || 'Location error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 4000 }
  );
}
function skipGPS() { document.getElementById('gps-panel').classList.remove('show'); }
function setGPSDot(state, label, acc) {
  document.getElementById('gps-dot').className = 'gps-dot ' + state;
  document.getElementById('gps-label').textContent = label;
  document.getElementById('gps-acc').textContent = acc;
}
function locateMe() {
  if (S.gpsCoords) { map.flyTo(S.gpsCoords, 16, { duration: 1.2 }); }
  else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => map.flyTo([p.coords.latitude, p.coords.longitude], 16, { duration: 1.2 }),
      () => toast('Could not get location')
    );
  }
}
function updateMyLocMarker(lat, lon, acc) {
  if (S.myMark) map.removeLayer(S.myMark);
  if (S.myCircle) map.removeLayer(S.myCircle);
  S.myCircle = L.circle([lat, lon], { radius: acc, color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: .08 }).addTo(map);
  S.myMark = L.marker([lat, lon], { icon: mkMyLoc(), zIndexOffset: 1000 }).addTo(map);
}
function useMyLocation() {
  const go = (lat, lon) => {
    S.oC = [lat, lon];
    rgc(lat, lon).then(n => { S.origin = n.split(',').slice(0, 2).join(','); document.getElementById('origin-input').value = S.origin; });
    placeOrig([lat, lon]); map.flyTo([lat, lon], 14, { duration: 1 });
  };
  if (S.gpsCoords) { go(...S.gpsCoords); return; }
  if (!navigator.geolocation) { requestGPS(); return; }
  navigator.geolocation.getCurrentPosition(p => { S.gpsOk = true; go(p.coords.latitude, p.coords.longitude); }, () => requestGPS());
}

// ══════════════════════════════════════════
//  GEOCODING + LOCAL CACHE
// ══════════════════════════════════════════
const _gcMem = new Map();
async function gc(q) {
  if (_gcMem.has(q)) return _gcMem.get(q);
  const lk = 'gc:' + q.toLowerCase().trim();
  const ls = localStorage.getItem(lk);
  if (ls) { const p = JSON.parse(ls); _gcMem.set(q, p); return p; }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
    const d = await r.json(); _gcMem.set(q, d);
    try { localStorage.setItem(lk, JSON.stringify(d)); } catch { }
    return d;
  } catch { return []; }
}
async function rgc(lat, lon) {
  const lk = `rgc:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const ls = localStorage.getItem(lk); if (ls) return ls;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`, { headers: { 'Accept-Language': 'en' } });
    const d = await r.json(); const name = d.display_name || `${lat.toFixed(5)},${lon.toFixed(5)}`;
    try { localStorage.setItem(lk, name); } catch { }
    return name;
  } catch { return `${lat.toFixed(5)},${lon.toFixed(5)}`; }
}

// ══════════════════════════════════════════
//  AUTOCOMPLETE
// ══════════════════════════════════════════
const _acT = {};
function setupAC(inId, dropId, onSel) {
  const inp = document.getElementById(inId), drop = document.getElementById(dropId);
  inp.addEventListener('input', () => {
    const q = inp.value.trim();
    if (inId === 'main-search') document.getElementById('main-clear').style.display = q ? 'flex' : 'none';
    if (!q) { drop.classList.remove('open'); drop.innerHTML = ''; return; }
    clearTimeout(_acT[inId]);
    if (inId === 'main-search') document.getElementById('main-spinner').classList.add('on');
    _acT[inId] = setTimeout(async () => {
      const res = await gc(q);
      if (inId === 'main-search') document.getElementById('main-spinner').classList.remove('on');
      drop.innerHTML = '';
      if (!res.length) { drop.classList.remove('open'); return; }
      res.forEach(item => {
        const d = document.createElement('div'); d.className = 'ac-item';
        const main = item.display_name.split(',')[0];
        const sub = item.display_name.split(',').slice(1, 3).join(',').trim();
        d.innerHTML = `<div class="ac-ic"><svg width="11" height="11" viewBox="0 0 24 24" fill="#5f6368"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg></div><div><div class="ac-main">${esc(main)}</div><div class="ac-sub">${esc(sub)}</div></div>`;
        d.onclick = () => { drop.classList.remove('open'); onSel(item); };
        drop.appendChild(d);
      });
      drop.classList.add('open');
    }, 320);
  });
  document.addEventListener('click', e => { if (!inp.contains(e.target) && !drop.contains(e.target)) drop.classList.remove('open'); });
}

setupAC('main-search', 'main-ac', item => {
  const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
  document.getElementById('main-search').value = item.display_name.split(',').slice(0, 2).join(',');
  map.flyTo([lat, lon], 15, { duration: 1.2 });
  if (S.oMark && !S.oC) map.removeLayer(S.oMark);
  S.oMark = L.marker([lat, lon], { icon: iPin }).addTo(map)
    .bindPopup(`<b>${esc(item.display_name.split(',')[0])}</b>`, { maxWidth: 220 }).openPopup();
});
setupAC('origin-input', 'origin-ac', item => {
  S.origin = item.display_name.split(',').slice(0, 2).join(',');
  S.oC = [parseFloat(item.lat), parseFloat(item.lon)];
  document.getElementById('origin-input').value = S.origin;
  placeOrig(S.oC);
});
setupAC('dest-input', 'dest-ac', item => {
  S.dest = item.display_name.split(',').slice(0, 2).join(',');
  S.dC = [parseFloat(item.lat), parseFloat(item.lon)];
  document.getElementById('dest-input').value = S.dest;
  placeDest(S.dC);
});
document.getElementById('main-clear').onclick = () => {
  document.getElementById('main-search').value = '';
  document.getElementById('main-clear').style.display = 'none';
  document.getElementById('main-ac').classList.remove('open');
};

// ══════════════════════════════════════════
//  MARKERS
// ══════════════════════════════════════════
function placeOrig(coords) {
  if (S.oMark) map.removeLayer(S.oMark);
  S.oMark = L.marker(coords, { icon: iA, draggable: true }).addTo(map);
  S.oMark.on('dragend', async e => {
    const p = e.target.getLatLng(); S.oC = [p.lat, p.lng];
    S.origin = (await rgc(p.lat, p.lng)).split(',').slice(0, 2).join(',');
    document.getElementById('origin-input').value = S.origin;
  });
}
function placeDest(coords) {
  if (S.dMark) map.removeLayer(S.dMark);
  S.dMark = L.marker(coords, { icon: iB, draggable: true }).addTo(map);
  S.dMark.on('dragend', async e => {
    const p = e.target.getLatLng(); S.dC = [p.lat, p.lng];
    S.dest = (await rgc(p.lat, p.lng)).split(',').slice(0, 2).join(',');
    document.getElementById('dest-input').value = S.dest;
  });
}

// ══════════════════════════════════════════
//  PANEL MANAGEMENT
// ══════════════════════════════════════════
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const sp = document.getElementById('search-panel');
  const sw = document.getElementById('sidebar-inner-wrap');
  const fc = document.getElementById('floating-search-container');
  
  if(sb.classList.contains('hidden')) {
    sb.classList.remove('hidden');
    sw.insertBefore(sp, sw.firstChild);
    fc.classList.remove('floating-mode');
    document.getElementById('mini-rail').style.display = 'none';
  } else {
    sb.classList.add('hidden');
    document.getElementById('mini-rail').style.display = 'flex';
  }
}

function toggleSearchBox() {
  const sb = document.getElementById('sidebar');
  const sp = document.getElementById('search-panel');
  const fc = document.getElementById('floating-search-container');
  
  if(fc.contains(sp)) {
     const sw = document.getElementById('sidebar-inner-wrap');
     sw.insertBefore(sp, sw.firstChild);
     fc.classList.remove('floating-mode');
  } else {
     sb.classList.add('hidden');
     fc.appendChild(sp);
     fc.classList.add('floating-mode');
     document.getElementById('mini-rail').style.display = 'flex';
     document.getElementById('main-search').focus();
  }
}

function openDirections() {
  const sb = document.getElementById('sidebar');
  const dirPanel = document.getElementById('dir-panel');
  
  if (sb.classList.contains('hidden')) {
    toggleSidebar();
    if (!dirPanel.classList.contains('open')) toggleDirections();
  } else {
    toggleDirections(); // toggle if already visible
  }
}

function closeAll() {
  ['dir-panel', 'offline-panel', 'route-panel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  });
  document.querySelectorAll('.q-btn').forEach(b => b.classList.remove('active'));
  const dtBtn = document.getElementById('dir-toggle-btn');
  if (dtBtn) dtBtn.classList.remove('dir-active');
}

function toggleDirections() {
  const panel = document.getElementById('dir-panel');
  if (!panel) return;
  const open = panel.classList.contains('open');
  closeAll();
  if (!open) {
    panel.classList.add('open');
    const dtBtn = document.getElementById('dir-toggle-btn');
    if (dtBtn) dtBtn.classList.add('dir-active');
    document.getElementById('origin-input').focus();
  }
}
function toggleOfflinePanel() {
  const panel = document.getElementById('offline-panel');
  if (!panel) return;
  const open = panel.classList.contains('open');
  closeAll();
  if (!open) {
    panel.classList.add('open');
    const offBtn = document.getElementById('offline-btn');
    if (offBtn) offBtn.classList.add('active');
    renderAreas(); getSWStats();
  }
}
function setMode(m, el) {
  S.mode = m;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}
function swapWaypoints() {
  [S.origin, S.dest] = [S.dest, S.origin]; [S.oC, S.dC] = [S.dC, S.oC];
  document.getElementById('origin-input').value = S.origin || '';
  document.getElementById('dest-input').value = S.dest || '';
  if (S.oC) placeOrig(S.oC); if (S.dC) placeDest(S.dC);
}

// ══════════════════════════════════════════
//  ROUTING
// ══════════════════════════════════════════
async function getDirections() {
  const oV = document.getElementById('origin-input').value.trim();
  const dV = document.getElementById('dest-input').value.trim();
  if (!oV || !dV) { toast('Enter both a start point and a destination'); return; }
  const btn = document.getElementById('go-btn');
  btn.disabled = true;
  document.getElementById('go-spin').classList.add('on');
  document.getElementById('go-lbl').textContent = 'Calculating…';
  try {
    if (!S.oC || oV !== S.origin) {
      const r = await gc(oV); if (!r.length) { toast('Starting point not found'); return; }
      S.oC = [parseFloat(r[0].lat), parseFloat(r[0].lon)]; S.origin = oV; placeOrig(S.oC);
    }
    if (!S.dC || dV !== S.dest) {
      const r = await gc(dV); if (!r.length) { toast('Destination not found'); return; }
      S.dC = [parseFloat(r[0].lat), parseFloat(r[0].lon)]; S.dest = dV; placeDest(S.dC);
    }
    const prof = S.mode === 'foot' ? 'foot' : S.mode === 'bike' ? 'bike' : 'car';
    let routerBase = `https://router.project-osrm.org/route/v1/${prof}`;
    if (prof === 'bike') routerBase = `https://routing.openstreetmap.de/routed-bike/route/v1/driving`;
    else if (prof === 'foot') routerBase = `https://routing.openstreetmap.de/routed-foot/route/v1/driving`;
    
    const url = `${routerBase}/${S.oC[1]},${S.oC[0]};${S.dC[1]},${S.dC[0]}?overview=full&geometries=geojson&steps=true&alternatives=3`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.code === 'offline') { toast('You are offline — no cached route for this pair', 4000); return; }
    if (data.code !== 'Ok' || !data.routes.length) { toast('No route found'); return; }
    
    S.routesData = data.routes;
    renderRoutes(S.routesData, oV, dV, 0);
  } catch (e) { toast('Route failed — check your connection'); }
  finally {
    btn.disabled = false;
    document.getElementById('go-spin').classList.remove('on');
    document.getElementById('go-lbl').textContent = 'Get Directions';
  }
}

function renderRoutes(routes, from, to, activeIndex = 0) {
  if (S.routeLayers) S.routeLayers.forEach(l => map.removeLayer(l));
  S.routeLayers = [];

  let boundsToFit = null;

  for (let i = routes.length - 1; i >= 0; i--) {
    const route = routes[i];
    const isActive = (i === activeIndex);
    const layerGroup = L.layerGroup().addTo(map);

    if (isActive) {
      L.geoJSON(route.geometry, { style: { color: '#000', weight: 9, opacity: .1, lineCap: 'round', lineJoin: 'round' }, interactive: false }).addTo(layerGroup);
      const activeL = L.geoJSON(route.geometry, { style: { color: '#1a73e8', weight: 5, opacity: .88, lineCap: 'round', lineJoin: 'round' } }).addTo(layerGroup);
      activeL.on('mouseover', () => { if (window.triggerMSLHoverDisplay) window.triggerMSLHoverDisplay(); });
      boundsToFit = activeL.getBounds();
    } else {
      const altL = L.geoJSON(route.geometry, { style: { color: '#88aaff', weight: 5, opacity: .5, lineCap: 'round', lineJoin: 'round' } }).addTo(layerGroup);
      altL.on('click', () => renderRoutes(routes, from, to, i));
    }
    S.routeLayers.push(layerGroup);
  }

  if (boundsToFit && activeIndex === 0) {
    map.fitBounds(boundsToFit, { paddingTopLeft: [440, 60], paddingBottomRight: [60, 180] });
  }

  const activeRoute = routes[activeIndex];
  const dur = fmtDur(activeRoute.duration), dist = fmtDist(activeRoute.distance), road = mainRoad(activeRoute);
  document.getElementById('route-summary').innerHTML =
    `<div class="route-from-to">${esc(from)} → ${esc(to)}</div>
    <div class="route-meta"><span class="route-dur">${dur}</span><span class="route-dist">${dist}</span></div>
    <div class="route-via">via ${road}</div>
    <div class="route-cache-note" id="cache-note"></div>`;

  S.steps = activeRoute.legs[0].steps;
  S.stepCoords = S.steps.map(s => s.maneuver.location);
  document.getElementById('steps-list').innerHTML = S.steps.map((s, i) => `
    <div class="step-item" id="st-${i}" onclick="focusStep(${i})">
      <div class="step-icon">${mIcon(s.maneuver.type, s.maneuver.modifier)}</div>
      <div class="step-content">
        <div class="step-instr">${fmtInstr(s)}</div>
        <div class="step-dist">${fmtDist(s.distance)} · ${fmtDur(s.duration)}</div>
      </div>
    </div>`).join('');

  closeAll();
  document.getElementById('route-panel').classList.add('open');
  buildElevationProfile(activeRoute, from, to);
}

function focusStep(i) {
  S.activeStep = i;
  document.querySelectorAll('.step-item').forEach((el, j) => el.classList.toggle('active', j === i));
  const [lon, lat] = S.stepCoords[i]; map.setView([lat, lon], 17, { animate: true });
}

function clearRoute() {
  if (S.routeLayers) S.routeLayers.forEach(l => map.removeLayer(l));
  S.routeLayers = []; S.navigating = false;
  document.getElementById('nav-hud').classList.remove('show');
  document.getElementById('nav-bottom').classList.remove('show');
  closeAll();
  document.getElementById('dir-panel').classList.add('open');
  document.getElementById('dir-toggle-btn').classList.add('active');
}

// ══════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════
function startNavigation() {
  if (!S.steps.length) { toast('No route loaded'); return; }
  S.navigating = true; S.activeStep = 0;
  
  document.getElementById('sidebar').classList.add('hidden');
  document.getElementById('mini-rail').style.display = 'flex';
  
  document.getElementById('nav-hud').classList.add('show');
  document.getElementById('nav-bottom').classList.add('show');
  updHUD(0);
  
  // Activate 3D perspective plane tilt
  const mapEl = document.getElementById('map');
  if (mapEl) {
    mapEl.classList.add('tilted-3d');
    setTimeout(() => { map.invalidateSize(); }, 150); // Recalculate dimensions for the expanded tilted container
  }
  
  const [lon, lat] = S.stepCoords[0]; map.flyTo([lat, lon], 17, { duration: 1.5 });
  if (!S.gpsOk) toast('Enable GPS for live tracking', 5000);
}
function updHUD(i) {
  const s = S.steps[i]; if (!s) return;
  document.getElementById('nav-icon-el').innerHTML = mIcon(s.maneuver.type, s.maneuver.modifier);
  document.getElementById('nav-text-el').textContent = stripHtml(fmtInstr(s));
  document.getElementById('nav-dist-el').textContent = 'In ' + fmtDist(s.distance);
  const rem = S.steps.slice(i).reduce((a, x) => a + x.duration, 0);
  const eta = new Date(Date.now() + rem * 1000);
  document.getElementById('nav-eta-el').textContent = eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
let _lastAlertSegment = null;
function checkElevAlert(lat, lon) {
  if (!S.elevSegments || !S.elevSegments.length || !_elevProfileData || !_elevProfileData.length) return;
  
  // Find closest profile point to get current distance along route
  let nearIdx = 0, minD = Infinity;
  for (let i = 0; i < _elevProfileData.length; i++) {
    const p = _elevProfileData[i];
    const d = Math.pow(lat - p.lat, 2) + Math.pow(lon - p.lon, 2);
    if (d < minD) { minD = d; nearIdx = i; }
  }
  const currDist = _elevProfileData[nearIdx].dist;

  // Look for steep segments approaching (within 300m) or currently in progress
  const upcoming = S.elevSegments.find(s => 
    (s.startDist > currDist && (s.startDist - currDist) < 300 && (s.maxGrade > 6 || s.deltaElev > 30)) ||
    (currDist >= s.startDist && currDist <= s.endDist && (s.maxGrade > 6 || s.deltaElev > 30))
  );

  const bar = document.getElementById('elev-alert-bar');
  if (upcoming) {
    const distAway = Math.max(0, upcoming.startDist - currDist);
    const isClimb = upcoming.type === 'climb';
    
    if (_lastAlertSegment !== upcoming) {
      _lastAlertSegment = upcoming;
      const isSteep = upcoming.maxGrade > 10;
      const cls = isSteep ? 'valley' : (isClimb ? 'climb' : 'descent'); 
      const icon = isClimb ? '↗' : '↘';
      
      bar.innerHTML = `
        <div class="eab-icon ${cls}">${icon}</div>
        <div class="eab-body">
          <div class="eab-title" id="eab-title">Upcoming Terrain</div>
          <div class="eab-desc">${upcoming.deltaElev.toFixed(0)}m ${isClimb?'gain':'drop'} · ${upcoming.maxGrade.toFixed(1)}% slope</div>
        </div>
      `;
      bar.classList.remove('hidden');
    }
    
    // Update live title distance
    const tEl = document.getElementById('eab-title');
    if (tEl) {
      if (distAway > 25) {
        tEl.textContent = `In ${distAway.toFixed(0)}m: ${isClimb ? 'Steep Climb' : 'Sharp Descent'}`;
      } else {
        tEl.textContent = `Now ${isClimb ? 'Climbing' : 'Descending'}`;
      }
    }
  } else {
    if (!bar.classList.contains('hidden')) {
      bar.classList.add('hidden');
      _lastAlertSegment = null;
    }
  }
}

function doNavUpdate(lat, lon) {
  if (!S.navigating || !S.stepCoords.length) return;
  let near = 0, minD = Infinity;
  S.stepCoords.forEach(([sLon, sLat], i) => { const d = Math.hypot(lat - sLat, lon - sLon); if (d < minD) { minD = d; near = i; } });
  if (near !== S.activeStep) {
    S.activeStep = near; updHUD(near);
    document.querySelectorAll('.step-item').forEach((el, j) => el.classList.toggle('active', j === near));
  }
  map.setView([lat, lon], map.getZoom(), { animate: true });
  checkElevAlert(lat, lon);
}
function stopNavigation() {
  S.navigating = false;
  document.getElementById('nav-hud').classList.remove('show');
  document.getElementById('nav-bottom').classList.remove('show');
  document.getElementById('elev-alert-bar').classList.add('hidden');
  _lastAlertSegment = null;
  
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('mini-rail').style.display = 'none';
  
  // Restore flat 2D bird's-eye map view
  const mapEl = document.getElementById('map');
  if (mapEl) {
    mapEl.classList.remove('tilted-3d');
    setTimeout(() => { map.invalidateSize(); }, 850); // Recalculate dimensions after the 0.8s transition finishes
  }
}

// ══════════════════════════════════════════
//  OFFLINE CACHING
// ══════════════════════════════════════════
function getCtrl() { return navigator.serviceWorker && navigator.serviceWorker.controller; }

function cacheCurrentArea(customBounds) {
  if (!swReady || !getCtrl()) { toast('Offline mode initializing — try again in a moment'); return; }
  const bounds = customBounds || map.getBounds();
  const z = map.getZoom();
  const z1 = Math.max(3, z - 2), z2 = Math.min(17, z + 1);
  const b = { s: bounds.getSouth(), n: bounds.getNorth(), w: bounds.getWest(), e: bounds.getEast() };

  let total = 0;
  for (let zz = z1; zz <= z2; zz++) {
    const mn = ll2t(b.s, b.w, zz), mx = ll2t(b.n, b.e, zz);
    total += (mx.x - mn.x + 1) * (mn.y - mx.y + 1);
  }
  if (total > 3000) { toast(`~${total} tiles — zoom in more for a smaller area`, 5000); return; }

  const btn = document.getElementById('cache-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner on" style="border-color:rgba(255,255,255,.3);border-top-color:#fff;width:14px;height:14px"></div> Downloading…';
  const prog = document.getElementById('cache-progress');
  prog.classList.add('show');
  document.getElementById('cp-bar').style.width = '0';
  document.getElementById('cp-pct').textContent = '0%';
  document.getElementById('cp-label').textContent = `Caching ~${total} tiles…`;

  getCtrl().postMessage({ type: 'CACHE_AREA', b, z1, z2 });

  S.areas.push({ key: Date.now(), name: `Zoom ${z} view`, z, tiles: total, date: new Date().toLocaleDateString(), bounds: b });
  localStorage.setItem('offAreas', JSON.stringify(S.areas));
}

function onSWMsg(e) {
  const { type } = e.data;
  if (type === 'PROG') {
    const pct = Math.round(e.data.done / e.data.total * 100);
    document.getElementById('cp-bar').style.width = pct + '%';
    document.getElementById('cp-pct').textContent = pct + '%';
  }
  if (type === 'DONE') {
    document.getElementById('cp-bar').style.width = '100%';
    document.getElementById('cp-pct').textContent = '100%';
    setTimeout(() => document.getElementById('cache-progress').classList.remove('show'), 2000);
    const btn = document.getElementById('cache-btn');
    btn.disabled = false;
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Download Current View';
    toast(`✓ ${e.data.done} map tiles cached for offline use`, 4000);
    renderAreas(); getSWStats();
  }
  if (type === 'STATS_RES') {
    document.getElementById('tile-count').textContent = `${e.data.n.toLocaleString()} tiles cached`;
  }
  if (type === 'CLEARED') {
    toast('All offline data cleared'); S.areas = [];
    localStorage.setItem('offAreas', '[]');
    renderAreas();
    document.getElementById('tile-count').textContent = '0 tiles cached';
  }
}
navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', onSWMsg);

function getSWStats() {
  const ctrl = getCtrl();
  if (ctrl) ctrl.postMessage({ type: 'STATS' });
}

function renderAreas() {
  const list = document.getElementById('areas-list');
  const noMsg = document.getElementById('no-areas');
  if (!S.areas.length) { list.innerHTML = ''; list.appendChild(noMsg); noMsg.style.display = 'block'; return; }
  noMsg.style.display = 'none';
  list.innerHTML = S.areas.map((a, i) => `
    <div class="area-item" onclick="flyToArea(${i})">
      <div class="area-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="var(--blue)"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg></div>
      <div class="area-info">
        <div class="area-name">${esc(a.name)}</div>
        <div class="area-meta">~${a.tiles} tiles · zoom ${a.z} · ${a.date}</div>
      </div>
      <button class="area-del" onclick="event.stopPropagation();delArea(${i})">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    </div>`).join('');
}
function flyToArea(i) {
  const a = S.areas[i];
  map.flyToBounds([[a.bounds.s, a.bounds.w], [a.bounds.n, a.bounds.e]], { duration: 1.2 });
}
function delArea(i) { S.areas.splice(i, 1); localStorage.setItem('offAreas', JSON.stringify(S.areas)); renderAreas(); }
function clearAllCache() {
  if (!confirm('Clear all cached offline maps and routes?')) return;
  const ctrl = getCtrl();
  if (ctrl) { ctrl.postMessage({ type: 'CLEAR' }); }
  else { S.areas = []; localStorage.setItem('offAreas', '[]'); renderAreas(); toast('Cache cleared'); }
}

// ══════════════════════════════════════════
//  CONTEXT MENU
// ══════════════════════════════════════════
map.on('contextmenu', e => {
  S.ctxLL = e.latlng;
  S.ctxElev = null; // reset, prefetch in background
  fetchElev(e.latlng.lat, e.latlng.lng).then(info => { S.ctxElev = info; });
  const menu = document.getElementById('ctx-menu');
  document.getElementById('ctx-coords-el').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
  const cr = map.getContainer().getBoundingClientRect();
  let x = e.originalEvent.clientX - cr.left, y = e.originalEvent.clientY - cr.top;
  if (x + 200 > cr.width) x = cr.width - 200;
  if (y + 180 > cr.height) y -= 180;
  menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.style.display = 'block';
  setTimeout(() => document.addEventListener('click', closeCtx, { once: true }), 10);
});
function closeCtx() { document.getElementById('ctx-menu').style.display = 'none'; }
function ctxFrom() {
  const { lat, lng } = S.ctxLL; S.oC = [lat, lng];
  rgc(lat, lng).then(n => { S.origin = n.split(',').slice(0, 2).join(','); document.getElementById('origin-input').value = S.origin; });
  placeOrig([lat, lng]); closeAll();
  document.getElementById('dir-panel').classList.add('open');
  document.getElementById('dir-toggle-btn').classList.add('active');
  closeCtx();
}
function ctxTo() {
  const { lat, lng } = S.ctxLL; S.dC = [lat, lng];
  rgc(lat, lng).then(n => { S.dest = n.split(',').slice(0, 2).join(','); document.getElementById('dest-input').value = S.dest; });
  placeDest([lat, lng]); closeAll();
  document.getElementById('dir-panel').classList.add('open');
  document.getElementById('dir-toggle-btn').classList.add('active');
  closeCtx();
}
function ctxWhat() {
  const { lat, lng } = S.ctxLL;
  closeCtx();
  Promise.all([
    rgc(lat, lng),
    S.ctxElev ? Promise.resolve(S.ctxElev) : fetchElev(lat, lng)
  ]).then(([name, { elev }]) => {
    let html = `<div style="font-size:13px"><b>${esc(name.split(',')[0])}</b><br>
      <small>${esc(name.split(',').slice(1, 3).join(','))}</small><br>
      <span style="color:#5f6368;font-size:11px">${lat.toFixed(6)}, ${lng.toFixed(6)}</span>`;
    if (elev !== null)
      html += `<br><span style="color:#188038;font-size:12px;font-weight:500">▲ ${elev.toFixed(0)} m a.s.l.</span>
        <br><a href="#" onclick="setGroundLevel(${elev.toFixed(1)});document.querySelector('.leaflet-popup-close-button').click();return false;"
          style="color:#1a73e8;font-size:10px">📍 Set as ground reference</a>`;
    html += '</div>';
    L.popup({ maxWidth: 260 }).setLatLng([lat, lng]).setContent(html).openOn(map);
  });
}
function ctxCache() {
  const { lat, lng } = S.ctxLL; const pad = 0.04;
  const fakeBounds = { getSouth: () => lat - pad, getNorth: () => lat + pad, getWest: () => lng - pad, getEast: () => lng + pad };
  cacheCurrentArea(fakeBounds); closeCtx();
}


// ══════════════════════════════════════════
//  KEYBOARD & INPUT
// ══════════════════════════════════════════
async function triggerMainSearch() {
  document.getElementById('main-ac').classList.remove('open');
  const el = document.getElementById('main-search');
  const v = el.value.trim(); if (!v) return;
  const r = await gc(v);
  if (r.length) {
    const lat = parseFloat(r[0].lat), lon = parseFloat(r[0].lon);
    map.flyTo([lat, lon], 15, { duration: 1.2 });
    if (S.oMark) map.removeLayer(S.oMark);
    S.oMark = L.marker([lat, lon], { icon: iPin }).addTo(map).bindPopup(`<b>${esc(r[0].display_name.split(',')[0])}</b>`, { maxWidth: 200 }).openPopup();
  } else toast('Location not found');
}

document.getElementById('main-search').addEventListener('keydown', async e => {
  if (e.key === 'Enter') triggerMainSearch();
});
document.getElementById('dest-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { document.getElementById('dest-ac').classList.remove('open'); getDirections(); }
});

// ══════════════════════════════════════════
//  RESIZERS
// ══════════════════════════════════════════
const sResz = document.getElementById('sidebar-resizer');
sResz.onmousedown = e => {
  e.preventDefault();
  document.body.style.cursor = 'ew-resize';
  document.onmousemove = me => {
    let w = me.clientX;
    w = Math.max(250, Math.min(w, document.body.clientWidth - 100));
    document.documentElement.style.setProperty('--panel', w + 'px');
    map.invalidateSize();
  };
  document.onmouseup = () => { document.body.style.cursor = ''; document.onmousemove = document.onmouseup = null; };
};

const eResz = document.getElementById('elev-resizer');
let __elevH = 130;

function syncElevOverlays() {
  const ep = document.getElementById('elev-profile');
  const isOpen = ep.classList.contains('open');
  const h = isOpen ? __elevH : 0;
  document.getElementById('elev-chip').style.bottom = (52 + h) + 'px';
  const scaleCtrl = document.querySelector('.leaflet-control-scale');
  if (scaleCtrl) scaleCtrl.style.marginBottom = (8 + h) + 'px';
  document.getElementById('toast').style.bottom = (100 + h) + 'px';
  const legend = document.getElementById('elev-legend');
  if (legend) legend.style.bottom = (70 + h) + 'px';
}

eResz.onmousedown = e => {
  e.preventDefault();
  document.body.style.cursor = 'ns-resize';
  const ep = document.getElementById('elev-profile');
  ep.style.transition = 'none';
  document.onmousemove = me => {
    let h = document.body.clientHeight - me.clientY;
    h = Math.max(100, Math.min(h, document.body.clientHeight * 0.8));
    __elevH = h;
    document.documentElement.style.setProperty('--elev-h', h + 'px');
    syncElevOverlays();
    if (_elevProfileData.length) drawElevProfile(_elevProfileData);
  };
  document.onmouseup = () => { 
    document.body.style.cursor = ''; 
    ep.style.transition = ''; 
    document.onmousemove = document.onmouseup = null; 
  };
};

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
function fmtDur(s) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m} min`; }
function fmtDist(m) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`; }
function mainRoad(route) { for (const s of route.legs[0].steps) if (s.name && s.name.length > 2 && !/^\d/.test(s.name)) return s.name; return 'fastest route'; }
function esc(s = '') { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function stripHtml(s) { return s.replace(/<[^>]+>/g, ''); }
function fmtInstr(step) {
  const t = step.maneuver.type, m = step.maneuver.modifier || '';
  const n = step.name ? `<b>${esc(step.name)}</b>` : 'the road';
  return ({
    'turn': m ? `Turn ${m} onto ${n}` : `Turn onto ${n}`,
    'new name': `Continue onto ${n}`, 'depart': `Head ${m || 'forward'} on ${n}`,
    'arrive': `Arrive at destination`, 'merge': `Merge ${m || ''} onto ${n}`,
    'on ramp': `Take the on-ramp onto ${n}`, 'off ramp': `Take the exit onto ${n}`,
    'fork': `Keep ${m || 'straight'} onto ${n}`, 'end of road': `Turn ${m || 'right'} at end of ${n}`,
    'continue': `Continue straight on ${n}`, 'roundabout': `At the roundabout, take exit onto ${n}`,
    'rotary': `Enter roundabout onto ${n}`, 'use lane': `Use the ${m || ''} lane`
  }[t] || `Continue on ${n}`);
}
function mIcon(type, mod) {
  const c = '#1a73e8';
  if (type === 'arrive') return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${c}"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
  if (type === 'depart') return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${c}"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;
  if (type.includes('roundabout') || type.includes('rotary')) return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><circle cx="12" cy="12" r="7"/><path d="M12 5V8M19 12h-3" stroke-linecap="round"/></svg>`;
  if (mod && mod.includes('left')) return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${c}"><path d="M20 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H20c.55 0 1-.45 1-1s-.45-1-1-1z"/></svg>`;
  if (mod && mod.includes('right')) return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${c}"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>`;
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${c}"><path d="M12 2l-1.41 1.41L17.17 11H2v2h15.17l-6.58 6.59L12 21l9-9z"/></svg>`;
}
function ll2t(lat, lng, z) {
  const n = Math.pow(2, z), x = Math.floor((lng + 180) / 360 * n);
  const r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

// Haversine distance in metres
function haverDist(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dlat = (la2 - la1) * r, dlon = (lo2 - lo1) * r;
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dlon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ══════════════════════════════════════════
//  ELEVATION ENGINE
//  Sources : Open-Elevation API (online) +
//            IndexedDB cache (offline)
//  Strategy:
//    zoom < 7   → chip hidden
//    zoom 7-12  → sample map center, debounced 1.5 s
//    zoom > 12  → sample map center, debounced 0.7 s
//    mousemove  → tooltip from cache only (no extra API calls)
//    map click  → fetch & popup + chip update
//    route load → full elevation profile chart (gain/loss/min/max)
// ══════════════════════════════════════════

// ── IndexedDB persistence ────────────────────────────────
let _elevDB = null;
function openElevDB() {
  return new Promise((res, rej) => {
    if (_elevDB) { res(_elevDB); return; }
    const r = indexedDB.open('maps-elevation-v1', 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('elev'))
        db.createObjectStore('elev'); // key = "lat3,lon3"
    };
    r.onsuccess = e => { _elevDB = e.target.result; res(_elevDB); };
    r.onerror = () => rej(r.error);
  });
}
async function elevDbGet(key) {
  try {
    const db = await openElevDB();
    return new Promise((res) => {
      const req = db.transaction('elev', 'readonly').objectStore('elev').get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}
async function elevDbPut(key, val) {
  try {
    const db = await openElevDB();
    db.transaction('elev', 'readwrite').objectStore('elev').put(val, key);
  } catch { }
}

// Key: 3 decimal places ≈ 111 m resolution
function elevKey(lat, lon) { return `${lat.toFixed(3)},${lon.toFixed(3)}`; }

// ── Single-point elevation fetch ─────────────────────────
async function fetchElev(lat, lon) {
  const key = elevKey(lat, lon);
  // 1. IndexedDB cache hit
  const cached = await elevDbGet(key);
  if (cached !== null) return { elev: cached, src: 'cached' };
  // 2. Network (Open-Elevation free API)
  if (!navigator.onLine) return { elev: null, src: 'offline' };
  try {
    const r = await fetch(
      `https://api.open-elevation.com/api/v1/lookup?locations=${lat.toFixed(5)},${lon.toFixed(5)}`,
      { signal: AbortSignal.timeout(6000) }
    );
    const d = await r.json();
    if (d.results && d.results[0]) {
      const e = d.results[0].elevation;
      await elevDbPut(key, e);
      return { elev: e, src: 'live' };
    }
  } catch { }
  return { elev: null, src: 'error' };
}

// ── Batch elevation fetch (for route profile) ────────────
async function fetchElevBatch(points) {
  // points = [{latitude, longitude}]
  const results = new Array(points.length).fill(null);
  const missing = [];

  // Single transaction for batch reads — extremely performant and stable
  try {
    const db = await openElevDB();
    const tx = db.transaction('elev', 'readonly');
    const store = tx.objectStore('elev');
    
    const dbReads = points.map((p, i) => {
      return new Promise(resolve => {
        const req = store.get(elevKey(p.latitude, p.longitude));
        req.onsuccess = () => {
          if (req.result !== undefined && req.result !== null) {
            results[i] = req.result;
          } else {
            missing.push(i);
          }
          resolve();
        };
        req.onerror = () => {
          missing.push(i);
          resolve();
        };
      });
    });
    await Promise.all(dbReads);
  } catch {
    points.forEach((p, i) => missing.push(i));
  }

  if (!missing.length) return results;
  if (!navigator.onLine) return results;

  // Open-Meteo GET API (fast, no rate limit, single request)
  const chunks = [];
  for (let i = 0; i < missing.length; i += 100) chunks.push(missing.slice(i, i + 100));
  for (const chunk of chunks) {
    try {
      const lats = chunk.map(i => points[i].latitude.toFixed(5)).join(',');
      const lons = chunk.map(i => points[i].longitude.toFixed(5)).join(',');
      const r = await fetch(
        `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`,
        { signal: AbortSignal.timeout(10000) }
      );
      const d = await r.json();
      if (d.elevation && Array.isArray(d.elevation)) {
        const puts = [];
        d.elevation.forEach((elev, j) => {
          const idx = chunk[j]; results[idx] = elev;
          puts.push(elevDbPut(elevKey(points[idx].latitude, points[idx].longitude), elev));
        });
        await Promise.all(puts);
      }
    } catch {
      // Fallback: Open-Elevation POST API
      try {
        const locs = chunk.map(i => ({ latitude: points[i].latitude, longitude: points[i].longitude }));
        const r = await fetch('https://api.open-elevation.com/api/v1/lookup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locations: locs }),
          signal: AbortSignal.timeout(15000)
        });
        const d = await r.json();
        if (d.results) {
          const puts = [];
          d.results.forEach((res, j) => {
            const idx = chunk[j]; results[idx] = res.elevation;
            puts.push(elevDbPut(elevKey(points[idx].latitude, points[idx].longitude), res.elevation));
          });
          await Promise.all(puts);
        }
      } catch { }
    }
  }
  return results;
}

// ── Chip DOM refs ────────────────────────────────────────
const elevChip = document.getElementById('elev-chip');
const elevVal = document.getElementById('elev-val');
const elevSrc = document.getElementById('elev-src');
const elevSpinner = document.getElementById('elev-spin');

function showElevChip(m, src, slope, estimated) {
  if (m === null) { elevVal.textContent = 'No data'; elevSrc.textContent = ''; elevChip.classList.remove('hidden'); return; }
  elevVal.textContent = `${m.toFixed(0)} m${estimated ? ' est.' : ''}`;
  if (slope !== null && slope !== undefined)
    elevSrc.textContent = `≈${slope.toFixed(1)}% slope`;
  else
    elevSrc.textContent = src === 'cached' ? '●' : src === 'live' ? '' : src === 'offline' ? '○' : '';
  elevChip.classList.remove('hidden');
}
function hideElevChip() { elevChip.classList.add('hidden'); }

// ── Hover tooltip — only from cache, no extra calls ──────
const elevTip = document.getElementById('elev-tooltip');
let _hoverPending = null, _lastHoverKey = '', _tipHide = null;
map.on('mousemove', e => {
  if (map.getZoom() < 10) return;
  const { lat, lng } = e.latlng;
  const k = elevKey(lat, lng);
  if (k === _lastHoverKey) return;
  _lastHoverKey = k;
  clearTimeout(_hoverPending);
  _hoverPending = setTimeout(async () => {
    const cached = await elevDbGet(k);
    if (cached === null) return; // tooltip only from cache
    const pt = e.containerPoint;
    elevTip.style.left = (pt.x + 14) + 'px';
    elevTip.style.top = (pt.y - 28) + 'px';
    elevTip.textContent = `▲ ${cached.toFixed(0)} m asl`;
    elevTip.style.display = 'block';
    clearTimeout(_tipHide);
    _tipHide = setTimeout(() => { elevTip.style.display = 'none'; }, 1800);
  }, 120);
});
map.on('mouseout', () => { elevTip.style.display = 'none'; clearTimeout(_tipHide); });

// ── Chip update on map move/zoom ─────────────────────────
let _chipTimer = null;
function scheduleChipUpdate() {
  const z = map.getZoom();
  if (z < 7) { hideElevChip(); return; }
  const delay = z < 12 ? 1500 : 700;
  clearTimeout(_chipTimer);
  elevSpinner.classList.add('on');
  _chipTimer = setTimeout(async () => {
    const c = map.getCenter();
    const { elev, slope, estimated } = await getElevInfo(c.lat, c.lng, z);
    elevSpinner.classList.remove('on');
    showElevChip(elev, 'live', slope, estimated);
  }, delay);
}
map.on('moveend', scheduleChipUpdate);
map.on('zoomend', scheduleChipUpdate);

// ── Map click → getElevInfo (grid + max + slope) ─────────
map.on('click', async e => {
  const z = map.getZoom();
  if (z < 8) return;
  const { lat, lng } = e.latlng;
  elevSpinner.classList.add('on');
  const { elev, slope, estimated } = await getElevInfo(lat, lng, z);
  elevSpinner.classList.remove('on');
  showElevChip(elev, 'live', slope, estimated);
  if (elev !== null) {
    let html = `<div style="font-size:12px;line-height:1.7">
      <b>▲ ${elev.toFixed(0)} m${estimated ? ' <span style="color:#9aa0a6">(est.)</span>' : ''} above sea level</b>`;
    if (slope !== null) html += `<br><span style="color:#5f6368;font-size:11px">≈ ${slope.toFixed(1)}% max slope</span>`;
    html += `<br><span style="color:#5f6368;font-size:11px">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
      <br><a href="#" onclick="setGroundLevel(${elev.toFixed(1)});document.querySelector('.leaflet-popup-close-button').click();return false;"
        style="color:#1a73e8;font-size:10px;text-decoration:none">📍 Set as ground reference</a>
    </div>`;
    L.popup({ maxWidth: 240 }).setLatLng([lat, lng]).setContent(html).openOn(map);
  }
});

// ── GPS altitude integration ─────────────────────────────
const _origGrantGPS = grantGPS;
window.grantGPS = function () {
  _origGrantGPS && _origGrantGPS();
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(pos => {
      const alt = pos.coords.altitude;
      if (alt !== null && alt !== undefined) {
        elevVal.textContent = `${alt.toFixed(0)} m`;
        elevSrc.textContent = 'GPS';
        elevChip.classList.remove('hidden');
        const { latitude: la, longitude: lo } = pos.coords;
        elevDbPut(elevKey(la, lo), alt);
        if (S.navigating && typeof _elevProfileData !== 'undefined' && _elevProfileData.length) {
           drawElevProfile(_elevProfileData, la, lo);
        }
      }
    }, () => { }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 4000 });
  }
};

// ── Context menu elevation lookup ────────────────────────
function ctxElevation() {
  const { lat, lng } = S.ctxLL; closeCtx();
  elevSpinner.classList.add('on');
  fetchElev(lat, lng).then(({ elev, src }) => {
    elevSpinner.classList.remove('on');
    showElevChip(elev, src);
    if (elev !== null) {
      L.popup({ maxWidth: 200 }).setLatLng([lat, lng])
        .setContent(`<div style="font-size:12px"><b>▲ ${elev.toFixed(0)} m</b> above sea level<br><span style="color:#5f6368;font-size:11px">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>`)
        .openOn(map);
    } else {
      toast('Elevation data unavailable for this point');
    }
  });
}

// ── Route elevation profile chart ────────────────────────
let _elevProfileData = [];

async function buildElevationProfile(route, from, to) {
  const coords = route.geometry.coordinates; // [[lon, lat], ...]
  const MAX = 80;
  const step = Math.max(1, Math.floor(coords.length / MAX));
  const sampled = [], dists = [];
  let cumDist = 0;
  for (let i = 0; i < coords.length; i += step) {
    const [lon, lat] = coords[i];
    sampled.push({ latitude: lat, longitude: lon });
    if (i > 0) {
      const [plon, plat] = coords[Math.max(0, i - step)];
      cumDist += haverDist(plat, plon, lat, lon);
    }
    dists.push(cumDist);
  }
  
  const elevs = await fetchElevBatch(sampled);
  _elevProfileData = sampled.map((p, i) => ({ lat: p.latitude, lon: p.longitude, dist: dists[i], elev: elevs[i] }));
  
  if (_elevProfileData.length > 0) {
    const startV = from ? from.split(',')[0] : '';
    const endV = to ? to.split(',')[0] : '';
    _elevProfileData[0].village = startV;
    _elevProfileData[_elevProfileData.length - 1].village = endV;
    
    // MSL Popup Logic: Drop white circle markers that activate on blue path hover
    if (S.elevMarkersGroup) { map.removeLayer(S.elevMarkersGroup); }
    S.elevMarkersGroup = L.layerGroup();
    if (map.getZoom() >= 14) S.elevMarkersGroup.addTo(map);

    window.triggerMSLHoverDisplay = function() {
        if (typeof _elevProfileData === 'undefined' || !S.elevMarkersGroup || !map.hasLayer(S.elevMarkersGroup)) return;
        _elevProfileData.forEach(d => {
            if (d.marker && !d.activeTooltip) {
                d.activeTooltip = L.tooltip({ permanent: true, direction: 'top', className: 'msl-tooltip' })
                    .setLatLng([d.lat, d.lon]).setContent(d.tooltipContent).addTo(map);
            }
        });
        if (window._mslHoverTimeout) clearTimeout(window._mslHoverTimeout);
        window._mslHoverTimeout = setTimeout(() => {
            _elevProfileData.forEach(d => {
                if (d.activeTooltip) { map.removeLayer(d.activeTooltip); d.activeTooltip = null; }
            });
        }, 30000);
    };

    _elevProfileData.forEach(d => {
        if (d.elev !== null) {
            d.marker = L.circleMarker([d.lat, d.lon], { radius: 4, color: '#1a73e8', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1 }).addTo(S.elevMarkersGroup);
            d.tooltipContent = `<div style="font-size:10.5px;font-weight:500;text-align:center;line-height:1.3;padding:1px">▲ ${d.elev.toFixed(0)}m MSL</div>`;
        }
    });

    if (startV && _elevProfileData[0].marker) {
        _elevProfileData[0].tooltipContent = `<div style="font-size:11.5px;font-weight:500;text-align:center;line-height:1.3;padding:2px">▲ ${_elevProfileData[0].elev.toFixed(0)}m MSL<br/><span style="font-size:9.5px;color:#5f6368">${startV}</span></div>`;
    }
    if (endV && _elevProfileData[_elevProfileData.length-1].marker) {
        _elevProfileData[_elevProfileData.length-1].tooltipContent = `<div style="font-size:11.5px;font-weight:500;text-align:center;line-height:1.3;padding:2px">▲ ${_elevProfileData[_elevProfileData.length-1].elev.toFixed(0)}m MSL<br/><span style="font-size:9.5px;color:#5f6368">${endV}</span></div>`;
    }
    
    const numInter = Math.min(50, Math.floor(sampled.length / 2));
    if (numInter > 0) {
      const stepInter = Math.floor(sampled.length / (numInter + 1));
      const interIndices = [];
      for(let i=1; i<=numInter; i++) interIndices.push(i * stepInter);
      
      // Async sequential fetching so map doesn't block and API doesn't throttle
      (async function pollVillages() {
        let lastV = startV;
        for (const idx of interIndices) {
            if (!navigator.onLine && !localStorage.getItem(`nom_${sampled[idx].latitude.toFixed(3)}_${sampled[idx].longitude.toFixed(3)}`)) continue;
            if (_elevProfileData.length === 0) break; // exit if route cleared
            
            const pt = sampled[idx];
            const cKey = `nom_${pt.latitude.toFixed(3)}_${pt.longitude.toFixed(3)}`;
            let v = localStorage.getItem(cKey);
            
            if (!v) {
                await new Promise(r => setTimeout(r, 1100)); // Respect 1req/sec limits only when fetching
                if (_elevProfileData.length === 0) break; 
                try {
                    const req = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pt.latitude}&lon=${pt.longitude}&zoom=14`, { headers: { 'Accept-Language': 'en' }, signal: AbortSignal.timeout(4000) });
                    const d = await req.json();
                    const addr = d.address || {};
                    v = addr.village || addr.hamlet || addr.town || addr.suburb || addr.neighbourhood || addr.city || addr.municipality || d.name || (d.display_name ? d.display_name.split(',')[0] : null);
                    if (v && v.length > 2) {
                        try { localStorage.setItem(cKey, v); } catch(err){}
                    }
                } catch(e) { }
            }
            
            if (v && v.length > 2 && v !== lastV && v !== endV) {
                _elevProfileData[idx].village = v;
                lastV = v;
                drawElevProfile(_elevProfileData);
                if (_elevProfileData[idx].marker) {
                    _elevProfileData[idx].tooltipContent = `<div style="font-size:11.5px;font-weight:500;text-align:center;line-height:1.3;padding:2px">▲ ${_elevProfileData[idx].elev.toFixed(0)}m MSL<br/><span style="font-size:9.5px;color:#5f6368">${v}</span></div>`;
                    if (_elevProfileData[idx].activeTooltip) { _elevProfileData[idx].activeTooltip.setContent(_elevProfileData[idx].tooltipContent); }
                }
            }
        }
      })();
    }
  }

  drawElevProfile(_elevProfileData);
  document.getElementById('elev-profile').classList.add('open');
  syncElevOverlays();
}

function drawElevProfile(data, currLat, currLon) {
  const canvas = document.getElementById('elev-canvas');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx2 = canvas.getContext('2d'); ctx2.scale(dpr, dpr);

  const valid = data.filter(d => d.elev !== null);
  if (!valid.length) {
    ctx2.fillStyle = '#9aa0a6'; ctx2.font = '11px Roboto,sans-serif';
    ctx2.fillText('No elevation data available', W / 2 - 70, H / 2); return;
  }
  const elevs = valid.map(d => d.elev);
  const minE = Math.min(...elevs), maxE = Math.max(...elevs), range = maxE - minE || 1;
  const maxDist = data[data.length - 1].dist;

  // Stats
  let gain = 0, loss = 0;
  for (let i = 1; i < valid.length; i++) {
    const d = valid[i].elev - valid[i - 1].elev;
    if (d > 0) gain += d; else loss += Math.abs(d);
  }
  document.getElementById('ep-gain').textContent = `+${gain.toFixed(0)}m`;
  document.getElementById('ep-loss').textContent = `-${loss.toFixed(0)}m`;
  document.getElementById('ep-min').textContent = `${minE.toFixed(0)}m`;
  document.getElementById('ep-max').textContent = `${maxE.toFixed(0)}m`;

  const pad = { t: 36, r: 8, b: 18, l: 36 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
  const xOf = dist => pad.l + dist / maxDist * cW;
  const yOf = e => pad.t + (1 - (e - minE) / range) * cH;

  // Gradient fill
  const grad = ctx2.createLinearGradient(0, pad.t, 0, pad.t + cH);
  grad.addColorStop(0, 'rgba(26,115,232,.28)');
  grad.addColorStop(1, 'rgba(26,115,232,.04)');

  const pts = data.filter(d => d.elev !== null);
  ctx2.beginPath();
  pts.forEach((d, i) => { const x = xOf(d.dist), y = yOf(d.elev); i === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y); });
  ctx2.lineTo(xOf(pts[pts.length - 1].dist), pad.t + cH);
  ctx2.lineTo(xOf(pts[0].dist), pad.t + cH); ctx2.closePath();
  ctx2.fillStyle = grad; ctx2.fill();

  // Line
  ctx2.beginPath();
  pts.forEach((d, i) => { const x = xOf(d.dist), y = yOf(d.elev); i === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y); });
  ctx2.strokeStyle = '#1a73e8'; ctx2.lineWidth = 1.8; ctx2.lineJoin = 'round'; ctx2.stroke();

  // Y-axis labels
  ctx2.fillStyle = '#9aa0a6'; ctx2.font = '9px Roboto,sans-serif'; ctx2.textAlign = 'right';
  [minE, minE + range / 2, maxE].forEach(e => {
    const y = yOf(e); ctx2.fillText(`${e.toFixed(0)}`, pad.l - 3, y + 3);
    ctx2.beginPath(); ctx2.moveTo(pad.l, y); ctx2.lineTo(pad.l + cW, y);
    ctx2.strokeStyle = 'rgba(0,0,0,.05)'; ctx2.lineWidth = 1; ctx2.stroke();
  });

  // X-axis distance labels
  ctx2.textAlign = 'center'; ctx2.fillStyle = '#9aa0a6';
  const distKm = maxDist / 1000;
  [0, .25, .5, .75, 1].forEach(f => {
    ctx2.fillText(`${(distKm * f).toFixed(1)}km`, xOf(maxDist * f), H - 4);
  });

  // Draw village markers
  ctx2.font = '500 10.5px Roboto,sans-serif';
  ctx2.textBaseline = 'middle';
  
  const drawnLabels = []; // track boundaries to prevent overlaps
  
  pts.forEach((d, i) => {
    if (d.village) {
      const x = xOf(d.dist), y = yOf(d.elev);
      const textW = ctx2.measureText(d.village).width;
      
      let tx = x, align = 'center';
      if (i === 0 || x < pad.l + textW/2 + 5) { align = 'left'; tx = x + 4; }
      else if (i === pts.length - 1 || x > cW + pad.l - textW/2 - 5) { align = 'right'; tx = x - 4; }
      
      let yText = 12 + (i % 2 === 0 ? 0 : 12); 
      
      // Calculate horizontal boundaries with a 6px margin gap
      const x1 = tx - (align === 'center' ? textW/2 : align === 'right' ? textW : 0) - 3;
      const x2 = x1 + textW + 6;
      
      // Collision detection logic
      const overlap = drawnLabels.some(b => b.y === yText && !(x2 < b.x1 || x1 > b.x2));
      if (overlap && i !== 0 && i !== pts.length - 1) return; // Prioritize start/end labels always
      
      if (!overlap) drawnLabels.push({x1, x2, y: yText});

      ctx2.beginPath();
      ctx2.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx2.fillStyle = '#fff'; ctx2.fill();
      ctx2.lineWidth = 2; ctx2.strokeStyle = '#1a73e8'; ctx2.stroke();

      ctx2.textAlign = align;

      // draw stalk
      ctx2.beginPath();
      ctx2.moveTo(x, y - 2);
      ctx2.lineTo(x, yText + 6);
      ctx2.strokeStyle = 'rgba(26,115,232,0.4)';
      ctx2.lineWidth = 1;
      ctx2.stroke();

      ctx2.lineJoin = 'round';
      ctx2.lineWidth = 3.5;
      ctx2.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx2.strokeText(d.village, tx, yText);
      ctx2.fillStyle = '#174ea6';
      ctx2.fillText(d.village, tx, yText);
    }
  });

  if (currLat !== undefined && currLon !== undefined) {
      let near = pts[0], minDist = Infinity;
      pts.forEach(p => {
         const m = Math.abs(p.lat - currLat) + Math.abs(p.lon - currLon);
         if (m < minDist) { minDist = m; near = p; }
      });
      if (near && minDist < 0.05) {
          const x = xOf(near.dist), y = yOf(near.elev);
          ctx2.beginPath(); ctx2.arc(x, y, 6, 0, Math.PI*2);
          ctx2.fillStyle = '#4285F4'; ctx2.fill();
          ctx2.lineWidth = 2.5; ctx2.strokeStyle = '#fff'; ctx2.stroke();
          
          ctx2.font = '600 11px Roboto,sans-serif'; ctx2.textAlign = 'center';
          ctx2.fillStyle = '#1a73e8'; ctx2.fillText('▾', x, y - 10);
      }
  }

  // Hover scrubber
  canvas.onmousemove = ev => {
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left - pad.l) / cW));
    const targetDist = frac * maxDist;
    let near = pts[0];
    pts.forEach(p => { if (Math.abs(p.dist - targetDist) < Math.abs(near.dist - targetDist)) near = p; });
    elevTip.style.left = (ev.clientX + 10) + 'px'; elevTip.style.top = (ev.clientY - 30) + 'px';
    elevTip.textContent = `▲ ${near.elev.toFixed(0)} m  ·  ${(near.dist / 1000).toFixed(2)} km`;
    elevTip.style.display = 'block';
  };
  canvas.onmouseleave = () => { elevTip.style.display = 'none'; };
}

function closeElevProfile() {
  document.getElementById('elev-profile').classList.remove('open');
  _elevProfileData = []; // Setting to empty stops the async village background fetcher automatically
  document.getElementById('elev-suggestions').innerHTML = '';
  syncElevOverlays();
}

// ── Route elevation suggestions ──────────────────────────
// Analyzes _elevProfileData and generates human-readable
// suggestions about climbs, descents, steep sections, etc.
function generateElevSuggestions(data) {
  const el = document.getElementById('elev-suggestions');
  const valid = data.filter(d => d.elev !== null);
  if (valid.length < 3) { el.innerHTML = ''; return; }

  const cards = [];
  const elevs = valid.map(d => d.elev);
  const totalDist = valid[valid.length - 1].dist;
  const minE = Math.min(...elevs), maxE = Math.max(...elevs);
  const startE = valid[0].elev, endE = valid[valid.length - 1].elev;
  const netChange = endE - startE;

  // Compute total gain, loss, and find segments
  let totalGain = 0, totalLoss = 0;
  const segments = []; // {type:'climb'|'descent', start, end, deltaElev, dist, maxGrade}
  let segStart = 0, segDir = 0;

  for (let i = 1; i < valid.length; i++) {
    const de = valid[i].elev - valid[i - 1].elev;
    const dd = valid[i].dist - valid[i - 1].dist;
    if (de > 0) totalGain += de; else totalLoss += Math.abs(de);
    const dir = de > 0 ? 1 : de < 0 ? -1 : segDir;
    if (dir !== segDir && segDir !== 0) {
      // Segment ended
      const deltaE = valid[i - 1].elev - valid[segStart].elev;
      const segDist = valid[i - 1].dist - valid[segStart].dist;
      if (Math.abs(deltaE) > 10 && segDist > 50) {
        // Find max grade in this segment
        let maxGrade = 0;
        for (let j = segStart + 1; j < i; j++) {
          const d = valid[j].dist - valid[j - 1].dist;
          if (d > 0) { const g = Math.abs(valid[j].elev - valid[j - 1].elev) / d * 100; if (g > maxGrade) maxGrade = g; }
        }
        segments.push({
          type: deltaE > 0 ? 'climb' : 'descent',
          startIdx: segStart, endIdx: i - 1,
          deltaElev: Math.abs(deltaE), dist: segDist, maxGrade,
          startDist: valid[segStart].dist, endDist: valid[i - 1].dist
        });
      }
      segStart = i - 1;
    }
    segDir = dir;
  }
  // Close last segment
  if (segStart < valid.length - 1) {
    const deltaE = valid[valid.length - 1].elev - valid[segStart].elev;
    const segDist = valid[valid.length - 1].dist - valid[segStart].dist;
    if (Math.abs(deltaE) > 10 && segDist > 50) {
      let maxGrade = 0;
      for (let j = segStart + 1; j < valid.length; j++) {
        const d = valid[j].dist - valid[j - 1].dist;
        if (d > 0) { const g = Math.abs(valid[j].elev - valid[j - 1].elev) / d * 100; if (g > maxGrade) maxGrade = g; }
      }
      segments.push({
        type: deltaE > 0 ? 'climb' : 'descent',
        startIdx: segStart, endIdx: valid.length - 1,
        deltaElev: Math.abs(deltaE), dist: segDist, maxGrade,
        startDist: valid[segStart].dist, endDist: valid[valid.length - 1].dist
      });
    }
  }
  S.elevSegments = segments;

  // ── Overall difficulty ──
  const avgGrade = totalDist > 0 ? (totalGain + totalLoss) / (totalDist / 1000) : 0; // m per km
  let difficulty, diffBadge;
  if (avgGrade < 8 && maxE - minE < 50) { difficulty = 'Mostly flat route'; diffBadge = 'ok'; }
  else if (avgGrade < 20) { difficulty = 'Gently rolling terrain'; diffBadge = 'info'; }
  else if (avgGrade < 40) { difficulty = 'Moderate elevation changes'; diffBadge = 'info'; }
  else if (avgGrade < 70) { difficulty = 'Hilly route — significant climbs'; diffBadge = 'warn'; }
  else { difficulty = 'Very hilly — challenging elevation'; diffBadge = 'warn'; }

  cards.push(`<div class="es-card">
    <div class="es-icon ${diffBadge === 'ok' ? 'flat' : diffBadge === 'warn' ? 'steep' : 'climb'}">
      ${diffBadge === 'ok' ? '━' : diffBadge === 'warn' ? '⚠' : '〰'}
    </div>
    <div class="es-body">
      <div class="es-title">${difficulty}</div>
      <div class="es-detail">+${totalGain.toFixed(0)}m gain · −${totalLoss.toFixed(0)}m loss · ${(maxE - minE).toFixed(0)}m range</div>
      <span class="es-badge ${diffBadge}">${avgGrade.toFixed(0)} m/km avg undulation</span>
    </div></div>`);

  // ── Net elevation change ──
  if (Math.abs(netChange) > 15) {
    const goingUp = netChange > 0;
    cards.push(`<div class="es-card">
      <div class="es-icon ${goingUp ? 'climb' : 'descent'}">${goingUp ? '↗' : '↘'}</div>
      <div class="es-body">
        <div class="es-title">Destination is ${Math.abs(netChange).toFixed(0)}m ${goingUp ? 'higher' : 'lower'}</div>
        <div class="es-detail">${startE.toFixed(0)}m → ${endE.toFixed(0)}m elevation (net ${goingUp ? '+' : ''}${netChange.toFixed(0)}m)</div>
      </div></div>`);
  }

  // ── Summit / highest point ──
  if (maxE - Math.max(startE, endE) > 20) {
    const peakPt = valid.find(d => d.elev === maxE);
    cards.push(`<div class="es-card" onclick="map.setView([${peakPt.lat},${peakPt.lon}],15)">
      <div class="es-icon summit">▲</div>
      <div class="es-body">
        <div class="es-title">Highest point: ${maxE.toFixed(0)}m at ${(peakPt.dist / 1000).toFixed(1)}km</div>
        <div class="es-detail">${(maxE - startE).toFixed(0)}m above start · ${(maxE - endE).toFixed(0)}m above destination</div>
      </div></div>`);
  }

  // ── Valley / lowest point ──
  if (Math.min(startE, endE) - minE > 20) {
    const valPt = valid.find(d => d.elev === minE);
    cards.push(`<div class="es-card" onclick="map.setView([${valPt.lat},${valPt.lon}],15)">
      <div class="es-icon valley">▽</div>
      <div class="es-body">
        <div class="es-title">Lowest point: ${minE.toFixed(0)}m at ${(valPt.dist / 1000).toFixed(1)}km</div>
        <div class="es-detail">${(startE - minE).toFixed(0)}m below start · possible river/valley crossing</div>
      </div></div>`);
  }

  // ── Notable segments (steep climbs and descents) ──
  const steep = segments.filter(s => s.maxGrade > 6).sort((a, b) => b.maxGrade - a.maxGrade).slice(0, 4);
  for (const s of steep) {
    const label = s.type === 'climb' ? 'Steep climb' : 'Sharp descent';
    const icon = s.type === 'climb' ? '↑' : '↓';
    const cls = s.maxGrade > 12 ? 'steep' : s.type === 'climb' ? 'climb' : 'descent';
    const distLabel = `${(s.startDist / 1000).toFixed(1)}–${(s.endDist / 1000).toFixed(1)}km`;
    const pt = valid[Math.floor((s.startIdx + s.endIdx) / 2)];
    cards.push(`<div class="es-card" onclick="map.setView([${pt.lat},${pt.lon}],15)">
      <div class="es-icon ${cls}">${icon}</div>
      <div class="es-body">
        <div class="es-title">${label}: ${s.deltaElev.toFixed(0)}m over ${(s.dist / 1000).toFixed(1)}km</div>
        <div class="es-detail">At ${distLabel} · max grade ${s.maxGrade.toFixed(1)}%</div>
        ${s.maxGrade > 12 ? '<span class="es-badge warn">Very steep</span>' : s.maxGrade > 8 ? '<span class="es-badge info">Steep section</span>' : ''}
      </div></div>`);
  }

  // ── Flat stretches ──
  const flatSegs = segments.filter(s => s.maxGrade < 2 && s.dist > totalDist * 0.15);
  if (flatSegs.length) {
    const longest = flatSegs.sort((a, b) => b.dist - a.dist)[0];
    cards.push(`<div class="es-card">
      <div class="es-icon flat">━</div>
      <div class="es-body">
        <div class="es-title">Flat stretch: ${(longest.dist / 1000).toFixed(1)}km</div>
        <div class="es-detail">At ${(longest.startDist / 1000).toFixed(1)}–${(longest.endDist / 1000).toFixed(1)}km · easy terrain</div>
        <span class="es-badge ok">Easy</span>
      </div></div>`);
  }

  // ── Below sea level warning ──
  if (minE < 0) {
    cards.push(`<div class="es-card">
      <div class="es-icon valley">🌊</div>
      <div class="es-body">
        <div class="es-title">Below sea level: ${minE.toFixed(0)}m</div>
        <div class="es-detail">Parts of this route pass below sea level</div>
        <span class="es-badge warn">Below sea level</span>
      </div></div>`);
  }

  el.innerHTML = cards.length
    ? `<div class="es-header"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M14 6l-1-2H5v17h2v-7h5l1 2h7V6h-6zm4 8h-4l-1-2H7V6h5l1 2h5v6z"/></svg> Depth & Height Analysis</div>` + cards.join('')
    : '';
}

// ── Patch renderRoute to auto-build elevation profile ────
const __renderRoute = renderRoute;
window.renderRoute = function (route, from, to) {
  __renderRoute(route, from, to);
  closeElevProfile();
  buildElevationProfile(route, from, to).then(() => {
    generateElevSuggestions(_elevProfileData);
  }).catch(() => { });
};


// ══════════════════════════════════════════
//  ELEVATION GRID SAMPLING
//  Grid of points → max elevation + slope %
//  zoom ≥ 15  → 1×1 (exact point)
//  zoom 12-14 → 3×3, ~100 m spacing
//  zoom < 12  → 5×5, ~500 m spacing
// ══════════════════════════════════════════
async function elevGrid(lat, lon, zoom) {
  const size = zoom >= 15 ? 1 : zoom >= 12 ? 3 : 5;
  const spacingDeg = zoom >= 15 ? 0 : zoom >= 12 ? 0.001 : 0.005;
  const half = Math.floor(size / 2);
  const pts = [];
  for (let i = -half; i <= half; i++)
    for (let j = -half; j <= half; j++)
      pts.push({ lat: lat + i * spacingDeg, lon: lon + j * spacingDeg });
  const batch = pts.map(p => ({ latitude: p.lat, longitude: p.lon }));
  const elevs = await fetchElevBatch(batch);
  return pts.map((p, i) => ({ ...p, elev: elevs[i] }));
}

function calcSlope(gridPts, zoom) {
  if (zoom >= 15) return null; // single point — no slope
  const spacingDeg = zoom >= 12 ? 0.001 : 0.005;
  const size = zoom >= 12 ? 3 : 5;
  const centerIdx = Math.floor(gridPts.length / 2);
  const cElev = gridPts[centerIdx].elev;
  if (cElev === null) return null;
  const cLat = gridPts[centerIdx].lat;
  let maxSlope = 0;
  for (const pt of gridPts) {
    if (pt.elev === null || pt === gridPts[centerIdx]) continue;
    const dlat = (pt.lat - cLat) * 111000;
    const dlon = (pt.lon - gridPts[centerIdx].lon) * 111000 * Math.cos(cLat * Math.PI / 180);
    const distM = Math.sqrt(dlat * dlat + dlon * dlon);
    if (distM < 1) continue;
    const slope = Math.abs(pt.elev - cElev) / distM * 100;
    if (slope > maxSlope) maxSlope = slope;
  }
  return maxSlope;
}

async function getElevInfo(lat, lon, zoom) {
  const gridPts = await elevGrid(lat, lon, zoom);
  const validElevs = gridPts.map(p => p.elev).filter(e => e !== null);
  if (!validElevs.length) return { elev: null, slope: null, estimated: false };
  const elev = Math.max(...validElevs); // max of sampled grid
  const slope = calcSlope(gridPts, zoom);
  const estimated = zoom < 12;
  return { elev, slope, estimated };
}

// ══════════════════════════════════════════
//  MAP LAYER MANAGEMENT
//  OSM Standard / Esri Satellite / OpenTopoMap
// ══════════════════════════════════════════
const TILE_DEFS = {
  map: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19, opts: { crossOrigin: true }
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: 'Map data: © OpenStreetMap | Style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17, opts: {}
  }
};

function setLayer(id) {
  const def = TILE_DEFS[id];
  if (!def) return;
  if (_currentTileLayer) map.removeLayer(_currentTileLayer);
  _currentTileLayer = L.tileLayer(def.url, {
    attribution: def.attr, maxZoom: def.maxZoom, ...def.opts
  }).addTo(map);
  // Move to back so overlays stay on top
  _currentTileLayer.bringToBack();
  document.querySelectorAll('.layer-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.layer === id)
  );
  S.mapLayer = id;
}

// ══════════════════════════════════════════
//  TOPOGRAPHIC OVERLAY
//  When active, auto-fetches elevation for
//  the entire visible viewport, colors each
//  cell by (elev − groundLevel) delta.
//  Color ramp: deep-blue→cyan→green→yellow→red
//  Cells = solid blocks, NO interpolation
//  (straight fill between data nodes).
// ══════════════════════════════════════════

// ── IDB full scan ────────────────────────────────────────
async function getAllElevData() {
  try {
    const db = await openElevDB();
    return new Promise(res => {
      const out = [];
      const req = db.transaction('elev', 'readonly').objectStore('elev').openCursor();
      req.onsuccess = ev => {
        const cur = ev.target.result;
        if (cur) {
          const [la, lo] = cur.key.split(',').map(Number);
          if (!isNaN(la) && !isNaN(lo) && cur.value !== null)
            out.push({ lat: la, lon: lo, elev: cur.value });
          cur.continue();
        } else { res(out); }
      };
      req.onerror = () => res([]);
    });
  } catch { return []; }
}

// ── Grid step size (degrees) by zoom ─────────────────────
//  Smaller step = finer cells at high zoom
//  All steps are multiples of 0.001 (IDB key resolution)
function getTopoStep(zoom) {
  if (zoom < 8)  return 0.5;   // ~55 km − very coarse overview
  if (zoom < 10) return 0.1;   // ~11 km
  if (zoom < 12) return 0.02;  // ~2.2 km
  if (zoom < 14) return 0.005; // ~550 m
  if (zoom < 16) return 0.001; // ~111 m − street-level
  return 0.001;
}

// ── Auto-fetch elevation for visible viewport ─────────────
//  Generates a grid covering bounds at current step,
//  checks IDB (via fetchElevBatch), fetches missing from API.
//  Capped at 200 points per call to avoid API abuse.
let _fetchBusy = false;
async function autoFetchVisibleElev(m) {
  if (_fetchBusy || !navigator.onLine) return;
  const zoom = m.getZoom();
  if (zoom < 12) return; // Guard: prevent wide coordinates downloads at low zoom levels
  
  _fetchBusy = true;
  try {
    const b = m.getBounds();
    const step = getTopoStep(zoom);
    const s = Math.floor(b.getSouth() / step) * step;
    const n = Math.ceil(b.getNorth() / step) * step;
    const w = Math.floor(b.getWest() / step) * step;
    const e = Math.ceil(b.getEast() / step) * step;
    
    // Safety check: if grid dimensions are too large, skip to prevent locking UI thread
    const rows = Math.round((n - s) / step) + 1;
    const cols = Math.round((e - w) / step) + 1;
    if (rows * cols > 350) return;
    
    const pts = [];
    for (let lat = s; lat <= n + 1e-9; lat += step) {
      for (let lon = w; lon <= e + 1e-9; lon += step) {
        pts.push({
          latitude: parseFloat(lat.toFixed(6)),
          longitude: parseFloat(lon.toFixed(6))
        });
      }
    }
    if (pts.length) await fetchElevBatch(pts.slice(0, 200));
  } catch { }
  finally { _fetchBusy = false; }
}

// ── Delta → RGBA fill color ───────────────────────────────
function elevToColor(delta, a = 0.55) {
  const R = 500; let r, g, b;
  if      (delta <= -R)   { [r,g,b]=[0,0,95]; }
  else if (delta < -200)  { r=0; g=0; b=Math.round(95+160*(delta+R)/300); }
  else if (delta < -50)   { r=0; g=Math.round((delta+200)/150*200); b=200; }
  else if (delta < 0)     { r=0; g=200; b=Math.round(200*(1-(delta+50)/50)); }
  else if (delta < 1)     { [r,g,b]=[0,180,0]; }
  else if (delta <= 50)   { r=Math.round(delta/50*200); g=180; b=0; }
  else if (delta <= 200)  { r=200; g=Math.round(180-(delta-50)/150*130); b=0; }
  else if (delta <= R)    { r=200; g=Math.round(50*(1-(delta-200)/300)); b=0; }
  else                    { [r,g,b]=[200,0,0]; }
  return `rgba(${r},${g},${b},${a})`;
}

// ── Contour interval from elevation range ─────────────────
function getContourInterval(range) {
  if (range < 20)   return 2;
  if (range < 100)  return 10;
  if (range < 400)  return 25;
  if (range < 1500) return 100;
  return 250;
}

// ── Build 2-D grid from IDB cache ────────────────────────
function buildElevGrid(data, step, bounds) {
  const gS = Math.floor(bounds.getSouth()/step)*step;
  const gN = Math.ceil(bounds.getNorth()/step)*step;
  const gW = Math.floor(bounds.getWest()/step)*step;
  const gE = Math.ceil(bounds.getEast()/step)*step;
  const rows = Math.round((gN-gS)/step)+1;
  const cols = Math.round((gE-gW)/step)+1;
  const grid = Array.from({length:rows},()=>new Array(cols).fill(null));
  const lut = new Map();
  for (const {lat,lon,elev} of data) lut.set(elevKey(lat,lon),elev);
  for (let r=0;r<rows;r++) {
    for (let c=0;c<cols;c++) {
      const lat=parseFloat((gN-r*step).toFixed(6));
      const lon=parseFloat((gW+c*step).toFixed(6));
      const v=lut.get(elevKey(lat,lon));
      if (v!==undefined) grid[r][c]=v;
    }
  }
  return {grid,rows,cols,gN,gW};
}

// ── Marching Squares edge table ───────────────────────────
// Corners: bit3=TL bit2=TR bit1=BR bit0=BL
// Edges:   0=top 1=right 2=bottom 3=left
const _MS=[
  [],[[3,2]],[[1,2]],[[3,1]],      // 0-3
  [[0,1]],[[0,3],[1,2]],[[0,2]],[[0,3]], // 4-7
  [[0,3]],[[0,2]],[[0,1],[3,2]],[[0,1]], // 8-11
  [[1,3]],[[1,2]],[[2,3]],[]       // 12-15
];

// ── Draw one iso-contour level ────────────────────────────
function drawContourLevel(ctx,m,grid,rows,cols,gN,gW,step,level) {
  for (let r=0;r<rows-1;r++) {
    const laN=gN-r*step, laS=laN-step;
    for (let c=0;c<cols-1;c++) {
      const loW=gW+c*step, loE=loW+step;
      const tl=grid[r][c],tr=grid[r][c+1],bl=grid[r+1][c],br=grid[r+1][c+1];
      if (tl===null||tr===null||bl===null||br===null) continue;
      let idx=0;
      if(tl>=level)idx|=8; if(tr>=level)idx|=4;
      if(br>=level)idx|=2; if(bl>=level)idx|=1;
      const segs=_MS[idx]; if(!segs.length) continue;
      const t=(a,b)=>a===b?0.5:Math.max(0,Math.min(1,(level-a)/(b-a)));
      const ep=[
        [laN, loW+t(tl,tr)*step],      // 0 top
        [laN-t(tr,br)*step, loE],       // 1 right
        [laS, loW+t(bl,br)*step],       // 2 bottom
        [laN-t(tl,bl)*step, loW],       // 3 left
      ];
      for (const [a,b] of segs) {
        const pa=m.latLngToContainerPoint(ep[a]);
        const pb=m.latLngToContainerPoint(ep[b]);
        ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y);
      }
    }
  }
}

// ── Custom Leaflet Canvas Layer ───────────────────────────
// Renders: bilinear-interpolated color fill per cell +
//          marching-squares contour lines connecting equal-elev nodes.
const ElevHeatLayer = L.Layer.extend({
  onAdd(m) {
    this._map=m;
    this._cnv=document.createElement('canvas');
    this._cnv.style.cssText='position:absolute;top:0;left:0;pointer-events:none;z-index:300';
    m.getPane('overlayPane').appendChild(this._cnv);
    this._onMove=()=>{
      this._render();
      autoFetchVisibleElev(this._map).then(()=>this._render());
    };
    m.on('moveend zoomend resize',this._onMove);
    this._onMove();
  },
  onRemove(m) {
    this._cnv.remove();
    m.off('moveend zoomend resize',this._onMove);
  },
  async _render() {
    const m=this._map; if(!m) return;
    const size=m.getSize();
    const dpr=window.devicePixelRatio||1;
    this._cnv.width=size.x*dpr; this._cnv.height=size.y*dpr;
    this._cnv.style.width=size.x+'px'; this._cnv.style.height=size.y+'px';
    const ctx=this._cnv.getContext('2d');
    ctx.scale(dpr,dpr);
    ctx.clearRect(0,0,size.x,size.y);
    L.DomUtil.setPosition(this._cnv,m.containerPointToLayerPoint([0,0]));

    const zoom=m.getZoom();
    const step=getTopoStep(zoom);
    const all=await getAllElevData();
    if (all.length<4) return;

    const {grid,rows,cols,gN,gW}=buildElevGrid(all,step,m.getBounds());
    if (rows<2||cols<2) return;

    const ref=S.groundLevel;
    const SUBS=zoom>=14?5:zoom>=12?3:zoom>=10?2:1;
    const validE=all.map(d=>d.elev).filter(e=>e!==null);
    const minE=Math.min(...validE), maxE=Math.max(...validE);

    // ── 1. Bilinear-interpolated fill ──────────────────────
    // For each grid cell with 4 known corners, subdivide into SUBS×SUBS
    // sub-cells and bilinearly interpolate elevation → color.
    // This "connects the nodes" with a smooth gradient fill.
    for (let r=0;r<rows-1;r++) {
      const laN=gN-r*step, laS=laN-step;
      for (let c=0;c<cols-1;c++) {
        const loW=gW+c*step, loE=loW+step;
        const tl=grid[r][c],tr=grid[r][c+1],bl=grid[r+1][c],br=grid[r+1][c+1];
        if (tl===null||tr===null||bl===null||br===null) continue;
        for (let sr=0;sr<SUBS;sr++) {
          for (let sc=0;sc<SUBS;sc++) {
            // Bilinear interpolation at sub-cell center
            const fx=(sc+.5)/SUBS, fy=(sr+.5)/SUBS;
            const elev=tl*(1-fx)*(1-fy)+tr*fx*(1-fy)+bl*(1-fx)*fy+br*fx*fy;
            const p1=m.latLngToContainerPoint([laN-(sr/SUBS)*(laN-laS), loW+(sc/SUBS)*(loE-loW)]);
            const p2=m.latLngToContainerPoint([laN-((sr+1)/SUBS)*(laN-laS), loW+((sc+1)/SUBS)*(loE-loW)]);
            ctx.fillStyle=elevToColor(elev-ref);
            ctx.fillRect(Math.floor(p1.x),Math.floor(p1.y),Math.ceil(p2.x-p1.x)+1,Math.ceil(p2.y-p1.y)+1);
          }
        }
      }
    }

    // ── 2. Marching-squares contour lines ──────────────────
    // Draw iso-elevation lines at regular intervals (like topo map).
    const interval=getContourInterval(maxE-minE);
    const first=Math.ceil(minE/interval)*interval;
    ctx.lineJoin='round'; ctx.lineCap='round';
    for (let level=first;level<=maxE+.1;level+=interval) {
      // Thicker + darker every 5th line (index contours)
      const isMajor=Math.round((level-first)/interval)%5===0;
      ctx.strokeStyle=isMajor?'rgba(0,50,0,0.65)':'rgba(0,60,0,0.38)';
      ctx.lineWidth=isMajor?1.4:0.7;
      ctx.beginPath();
      drawContourLevel(ctx,m,grid,rows,cols,gN,gW,step,level);
      ctx.stroke();
    }
  }
});


let _heatLayer = null;
function toggleHeatmap() {
  const btn = document.getElementById('heatmap-btn');
  const legend = document.getElementById('elev-legend');
  S.heatmapOn = !S.heatmapOn;
  if (S.heatmapOn) {
    _heatLayer = new ElevHeatLayer();
    _heatLayer.addTo(map);
    btn.classList.add('active');
    legend.classList.remove('hidden');
    toast('Topographic view ON — fetching elevation for visible area…', 4000);
  } else {
    if (_heatLayer) { map.removeLayer(_heatLayer); _heatLayer = null; }
    btn.classList.remove('active');
    legend.classList.add('hidden');
  }
}

// ── Ground level reference ───────────────────────────────
function setGroundLevel(elev) {
  S.groundLevel = elev;
  localStorage.setItem('groundLevel', String(elev));
  document.getElementById('legend-ref').textContent = `Ref: ${elev.toFixed(0)} m`;
  toast(`Ground reference set to ${elev.toFixed(0)} m`, 2500);
  if (_heatLayer) _heatLayer._render(); // re-render with new ref
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
window.addEventListener('load', () => {
  setTimeout(() => {
    if (!S.gpsOk) document.getElementById('gps-panel').classList.add('show');
  }, 1000);
  renderAreas();
  // Update legend ref display from persisted value
  document.getElementById('legend-ref').textContent =
    `Ref: ${S.groundLevel.toFixed(0)} m${S.groundLevel === 0 ? ' (sea level)' : ''}`;
  // Pre-warm elevation chip after map settles
  setTimeout(scheduleChipUpdate, 2500);
});
