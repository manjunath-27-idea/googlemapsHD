// Maps Offline – Service Worker
const TC = 'maps-tiles-v3', RC = 'maps-routes-v3', GC = 'maps-geo-v3', ALL = [TC, RC, GC];

self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => !ALL.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);

  // ── Tile cache (OpenStreetMap) ──────────────────────────
  if (u.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(caches.open(TC).then(async c => {
      const h = await c.match(e.request);
      if (h) return h;
      try {
        const r = await fetch(e.request.clone(), { mode: 'cors' });
        if (r.ok) c.put(e.request, r.clone());
        return r;
      } catch {
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8e0d8"/><text x="128" y="136" text-anchor="middle" fill="#9aa0a6" font-size="11" font-family="sans-serif">Map tile unavailable offline</text></svg>',
          { headers: { 'Content-Type': 'image/svg+xml' } }
        );
      }
    }));
    return;
  }

  // ── Route cache (OSRM) ─────────────────────────────────
  if (u.hostname === 'router.project-osrm.org') {
    e.respondWith(caches.open(RC).then(async c => {
      const h = await c.match(e.request);
      if (h) {
        fetch(e.request.clone()).then(r => { if (r && r.ok) c.put(e.request, r.clone()); }).catch(() => {});
        return h;
      }
      try {
        const r = await fetch(e.request.clone());
        if (r.ok) c.put(e.request, r.clone());
        return r;
      } catch {
        return new Response(JSON.stringify({ code: 'offline' }), { headers: { 'Content-Type': 'application/json' } });
      }
    }));
    return;
  }

  // ── Geocoding cache (Nominatim) ────────────────────────
  if (u.hostname === 'nominatim.openstreetmap.org') {
    e.respondWith(caches.open(GC).then(async c => {
      const h = await c.match(e.request);
      if (h) return h;
      try {
        const r = await fetch(e.request.clone(), { headers: { 'Accept-Language': 'en' } });
        if (r.ok) c.put(e.request, r.clone());
        return r;
      } catch {
        return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
      }
    }));
    return;
  }
});

self.addEventListener('message', async e => {
  // ── Cache an area ──────────────────────────────────────
  if (e.data.type === 'CACHE_AREA') {
    const { b, z1, z2 } = e.data;
    const tiles = getTiles(b, z1, z2);
    const c = await caches.open(TC);
    let done = 0;
    for (const { x, y, z } of tiles) {
      const sd = ['a', 'b', 'c'][Math.abs(x + y) % 3];
      const url = 'https://' + sd + '.tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';
      try {
        if (!(await c.match(url))) {
          const r = await fetch(url, { mode: 'cors' });
          if (r.ok) await c.put(url, r);
        }
        done++;
        if (done % 20 === 0) e.source.postMessage({ type: 'PROG', done, total: tiles.length });
      } catch { }
    }
    e.source.postMessage({ type: 'DONE', done, total: tiles.length });
  }

  // ── Stats ──────────────────────────────────────────────
  if (e.data.type === 'STATS') {
    const c = await caches.open(TC);
    const k = await c.keys();
    e.source.postMessage({ type: 'STATS_RES', n: k.length });
  }

  // ── Clear all caches ───────────────────────────────────
  if (e.data.type === 'CLEAR') {
    await Promise.all(ALL.map(n => caches.delete(n)));
    e.source.postMessage({ type: 'CLEARED' });
  }
});

// ── Tile math helpers ──────────────────────────────────────
function getTiles(b, z1, z2) {
  const t = [];
  for (let z = z1; z <= z2; z++) {
    const mn = ll2t(b.s, b.w, z), mx = ll2t(b.n, b.e, z);
    for (let x = mn.x; x <= mx.x; x++)
      for (let y = mx.y; y <= mn.y; y++)
        t.push({ x, y, z });
  }
  return t;
}

function ll2t(lat, lng, z) {
  const n = Math.pow(2, z);
  const x = Math.floor((lng + 180) / 360 * n);
  const r = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}
