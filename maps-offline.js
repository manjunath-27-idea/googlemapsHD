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
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
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
  ctxLL: null, steps: [], stepCoords: [], activeStep: -1, navigating: false,
  areas: JSON.parse(localStorage.getItem('offAreas') || '[]')
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
      const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
      S.gpsOk = true; S.gpsCoords = [lat, lon];
      setGPSDot('active', 'GPS active', `±${Math.round(acc)}m`);
      document.getElementById('locate-fab').classList.add('active');
      document.getElementById('gps-status').classList.add('show');
      updateMyLocMarker(lat, lon, acc);
      if (S.navigating) doNavUpdate(lat, lon);
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
function closeAll() {
  ['dir-panel', 'offline-panel', 'route-panel'].forEach(id => {
    document.getElementById(id).classList.remove('open');
  });
  document.querySelectorAll('.q-btn').forEach(b => b.classList.remove('active'));
}
function toggleDirections() {
  const open = document.getElementById('dir-panel').classList.contains('open');
  closeAll();
  if (!open) {
    document.getElementById('dir-panel').classList.add('open');
    document.getElementById('dir-toggle-btn').classList.add('active');
    document.getElementById('origin-input').focus();
  }
}
function toggleOfflinePanel() {
  const open = document.getElementById('offline-panel').classList.contains('open');
  closeAll();
  if (!open) {
    document.getElementById('offline-panel').classList.add('open');
    document.getElementById('offline-btn').classList.add('active');
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
    const url = `https://router.project-osrm.org/route/v1/${prof}/${S.oC[1]},${S.oC[0]};${S.dC[1]},${S.dC[0]}?overview=full&geometries=geojson&steps=true`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.code === 'offline') { toast('You are offline — no cached route for this pair', 4000); return; }
    if (data.code !== 'Ok' || !data.routes.length) { toast('No route found'); return; }
    renderRoute(data.routes[0], oV, dV);
  } catch (e) { toast('Route failed — check your connection'); }
  finally {
    btn.disabled = false;
    document.getElementById('go-spin').classList.remove('on');
    document.getElementById('go-lbl').textContent = 'Get Directions';
  }
}

function renderRoute(route, from, to) {
  if (S.routeShadow) map.removeLayer(S.routeShadow);
  if (S.routeL) map.removeLayer(S.routeL);
  S.routeShadow = L.geoJSON(route.geometry, { style: { color: '#000', weight: 9, opacity: .1, lineCap: 'round', lineJoin: 'round' } }).addTo(map);
  S.routeL = L.geoJSON(route.geometry, { style: { color: '#1a73e8', weight: 5, opacity: .88, lineCap: 'round', lineJoin: 'round' } }).addTo(map);
  map.fitBounds(S.routeL.getBounds(), { padding: [60, 380] });

  const dur = fmtDur(route.duration), dist = fmtDist(route.distance), road = mainRoad(route);
  document.getElementById('route-summary').innerHTML =
    `<div class="route-from-to">${esc(from)} → ${esc(to)}</div>
    <div class="route-meta"><span class="route-dur">${dur}</span><span class="route-dist">${dist}</span></div>
    <div class="route-via">via ${road}</div>
    <div class="route-cache-note" id="cache-note"></div>`;

  S.steps = route.legs[0].steps;
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
}

function focusStep(i) {
  S.activeStep = i;
  document.querySelectorAll('.step-item').forEach((el, j) => el.classList.toggle('active', j === i));
  const [lon, lat] = S.stepCoords[i]; map.setView([lat, lon], 17, { animate: true });
}

function clearRoute() {
  if (S.routeL) map.removeLayer(S.routeL);
  if (S.routeShadow) map.removeLayer(S.routeShadow);
  S.routeL = S.routeShadow = null; S.navigating = false;
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
  document.getElementById('nav-hud').classList.add('show');
  document.getElementById('nav-bottom').classList.add('show');
  updHUD(0);
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
function doNavUpdate(lat, lon) {
  if (!S.navigating || !S.stepCoords.length) return;
  let near = 0, minD = Infinity;
  S.stepCoords.forEach(([sLon, sLat], i) => { const d = Math.hypot(lat - sLat, lon - sLon); if (d < minD) { minD = d; near = i; } });
  if (near !== S.activeStep) {
    S.activeStep = near; updHUD(near);
    document.querySelectorAll('.step-item').forEach((el, j) => el.classList.toggle('active', j === near));
  }
  map.setView([lat, lon], map.getZoom(), { animate: true });
}
function stopNavigation() {
  S.navigating = false;
  document.getElementById('nav-hud').classList.remove('show');
  document.getElementById('nav-bottom').classList.remove('show');
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
  rgc(lat, lng).then(name => {
    L.popup({ maxWidth: 240 }).setLatLng([lat, lng])
      .setContent(`<div style="font-size:13px"><b>${esc(name.split(',')[0])}</b><br><small>${esc(name.split(',').slice(1, 3).join(','))}</small><br><span style="color:#5f6368;font-size:11px">${lat.toFixed(6)}, ${lng.toFixed(6)}</span></div>`)
      .openOn(map);
  }); closeCtx();
}
function ctxCache() {
  const { lat, lng } = S.ctxLL; const pad = 0.04;
  const fakeBounds = { getSouth: () => lat - pad, getNorth: () => lat + pad, getWest: () => lng - pad, getEast: () => lng + pad };
  cacheCurrentArea(fakeBounds); closeCtx();
}

// ══════════════════════════════════════════
//  KEYBOARD
// ══════════════════════════════════════════
document.getElementById('main-search').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  document.getElementById('main-ac').classList.remove('open');
  const v = e.target.value.trim(); if (!v) return;
  const r = await gc(v);
  if (r.length) {
    const lat = parseFloat(r[0].lat), lon = parseFloat(r[0].lon);
    map.flyTo([lat, lon], 15, { duration: 1.2 });
    if (S.oMark) map.removeLayer(S.oMark);
    S.oMark = L.marker([lat, lon], { icon: iPin }).addTo(map).bindPopup(`<b>${esc(r[0].display_name.split(',')[0])}</b>`, { maxWidth: 200 }).openPopup();
  } else toast('Location not found');
});
document.getElementById('dest-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { document.getElementById('dest-ac').classList.remove('open'); getDirections(); }
});

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

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
window.addEventListener('load', () => {
  setTimeout(() => {
    if (!S.gpsOk) document.getElementById('gps-panel').classList.add('show');
  }, 1000);
  renderAreas();
});
