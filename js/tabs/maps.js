// js/maps.js
// Mapa global: dibuja polilíneas (rutas) o puntos (start/end) para todas las actividades
// No realiza llamadas a la API por actividad; usa los datos ya cargados en `activities`.

function decodePolyline(encoded) {
    if (!encoded) return [];
    let index = 0, lat = 0, lng = 0, coordinates = [];
    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += deltaLat;

        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += deltaLng;

        coordinates.push([lat / 1e5, lng / 1e5]);
    }
    return coordinates;
}

function parseActivityPolyline(a) {
    const encoded = a.map && (a.map.summary_polyline || a.map.polyline) ? (a.map.summary_polyline || a.map.polyline) : (a.summary_polyline || a.polyline);
    if (!encoded) return null;
    return decodePolyline(encoded);
}

// Summit detection configuration (meters)
const SUMMIT_DETECTION_RADIUS_METERS = 150; // default threshold for completed
const SUMMIT_DETECTION_NEAR_MIN = 150;
const SUMMIT_DETECTION_NEAR_MAX = 300;

// --- Geodesic helpers ---
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const toRad = v => v * Math.PI / 180;
    const R = 6371000; // Earth radius in meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Convert lat/lon differences to approximate meters around a reference latitude (good for short distances)
function latLngToXYMeters(lat, lng, latRef) {
    const metersPerDeg = 111320; // approx
    const x = (lng) * Math.cos(latRef * Math.PI / 180) * metersPerDeg;
    const y = (lat) * metersPerDeg;
    return { x, y };
}

function distancePointToSegmentMeters(pLat, pLng, aLat, aLng, bLat, bLng) {
    // Project onto local Cartesian with reference latitude = pLat
    const ref = pLat;
    const p = latLngToXYMeters(pLat - ref, pLng, ref);
    const a = latLngToXYMeters(aLat - ref, aLng, ref);
    const b = latLngToXYMeters(bLat - ref, bLng, ref);
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = p.x - a.x;
    const wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    const c2 = vx * vx + vy * vy;
    let t = 0;
    if (c2 > 0) t = c1 / c2;
    t = Math.max(0, Math.min(1, t));
    const projx = a.x + t * vx;
    const projy = a.y + t * vy;
    const dx = p.x - projx;
    const dy = p.y - projy;
    return Math.sqrt(dx * dx + dy * dy);
}


function makeTileLayer(key) {
    if (key === 'carto') return L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '&copy; Carto' });
    if (key === 'carto_light') return L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; Carto' });
    if (key === 'stamen') return L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/toner/{z}/{x}/{y}.png', { attribution: '&copy; Stamen' });
    if (key === 'esri') return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' });
    if (key === 'satellite') return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenTopoMap' });
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' });
}

export function renderMapTab(activities = [], dateFrom = null, dateTo = null) {
    const container = document.getElementById('map-tab');
    if (!container) return;

    // Initialize controls
    const dateFromInput = document.getElementById('map-date-from');
    const dateToInput = document.getElementById('map-date-to');
    const applyBtn = document.getElementById('map-apply-date');
    const resetBtn = document.getElementById('map-reset-date');
    const sportSel = document.getElementById('map-sport-filter');
    const vizSel = document.getElementById('map-visualization');
    const tilesSel = document.getElementById('map-tiles');
    const densitySlider = document.getElementById('map-heat-intensity');
    const radiusSlider = document.getElementById('map-heat-radius');
    const blurSlider = document.getElementById('map-heat-blur');
    const colorBySportCheckbox = document.getElementById('map-color-by-sport');
    const mapEl = document.getElementById('global-map');

    // color palette per activity type when showing all sports
    const typeColors = {
        Run: '#e31a1c',
        Ride: '#1f78b4',
        Swim: '#33a02c',
        Walk: '#ff7f00',
        Hike: '#6a3d9a',
        Row: '#b15928',
        Default: '#888'
    };

    // Populate sport types and apply defaults
    const types = [...new Set(activities.map(a => (a.sport_type || a.type || 'Unknown').trim()).filter(Boolean))].sort();
    sportSel.innerHTML = '<option value="all">All</option>' + types.map(t => `<option value="${t}">${t}</option>`).join('');
    // default control values
    sportSel.value = 'all';
    // ensure vizSel has an 'Empty' option
    if (vizSel) {
        try {
            if (!Array.from(vizSel.options).some(o => o.value === 'empty')) vizSel.add(new Option('Empty', 'empty'));
            vizSel.value = 'heat';
        } catch (e) { }
    }
    if (densitySlider) densitySlider.value = '1.133';
    if (radiusSlider) radiusSlider.value = '8';
    if (blurSlider) blurSlider.value = '14';
    if (colorBySportCheckbox) colorBySportCheckbox.checked = false;
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';

    // Ensure tiles selector has Carto option and default to Carto Voyager
    if (tilesSel) {
        try {
            if (!Array.from(tilesSel.options).some(o => o.value === 'carto')) {
                tilesSel.add(new Option('Carto', 'carto'), tilesSel.options[0] || null);
            }
            tilesSel.value = 'carto';
        } catch (e) { }
    }


    // Initialize leaflet map singleton
    if (!window._stravaMap) {
        window._stravaMap = L.map(mapEl, { preferCanvas: true });
        const base = makeTileLayer(tilesSel?.value || 'carto');
        base.addTo(window._stravaMap);
        window._stravaBase = base;
        window._stravaPolylines = L.layerGroup().addTo(window._stravaMap);
        window._stravaPoints = L.layerGroup().addTo(window._stravaMap);
        window._stravaHeat = null;
        window._stravaMap.setView([48.0, 2.0], 4);
    }

    function clearLayers() {
        window._stravaPolylines.clearLayers();
        window._stravaPoints.clearLayers();
        if (window._stravaHeat) {
            try { window._stravaMap.removeLayer(window._stravaHeat); } catch (e) { }
            window._stravaHeat = null;
        }
    }

    function filterActivities() {
        return activities.filter(a => {
            if (!a) return false;
            // Date filter (convert dd/mm/yyyy inputs to ISO)
            const d = a.start_date_local ? a.start_date_local.split('T')[0] : null;
            const parseDMY = str => {
                const parts = str.split('/');
                if (parts.length !== 3) return null;
                const [dd, mm, yy] = parts;
                return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
            };
            if (dateFromInput?.value) {
                const iso = parseDMY(dateFromInput.value);
                if (iso && d && d < iso) return false;
            }
            if (dateToInput?.value) {
                const iso = parseDMY(dateToInput.value);
                if (iso && d && d > iso) return false;
            }
            // Sport filter
            if (sportSel?.value && sportSel.value !== 'all' && (a.sport_type || a.type || 'Unknown').trim() !== sportSel.value) return false;
            return true;
        });
    }

    function render() {
        clearLayers();
        const visible = filterActivities();
        const bounds = [];
        const view = vizSel?.value || 'routes';

        if (view === 'heat') {
            const factor = parseFloat(densitySlider?.value) || 1.133;
            const rad = parseInt(radiusSlider?.value, 10) || 8;
            const blur = parseInt(blurSlider?.value, 10) || 14;
            const heatPoints = [];
            visible.forEach(a => {
                const coords = parseActivityPolyline(a);
                if (coords && coords.length) coords.forEach(c => heatPoints.push([c[0], c[1], 0.5 * factor]));
                else if (a.start_latlng && a.start_latlng.length === 2) heatPoints.push([a.start_latlng[0], a.start_latlng[1], 0.5 * factor]);
            });
            if (heatPoints.length) {
                console.log(`factor: ${factor}, rad: ${rad}, blur: ${blur}, points: ${heatPoints.length}`);
                try { window._stravaHeat = L.heatLayer(heatPoints, { radius: rad, blur: blur, maxZoom: 12 }).addTo(window._stravaMap); } catch (e) { }
            }
        } else if (view === 'empty') {
            // empty view: show only base map (summits layer handled separately)
        } else {
            visible.forEach(a => {
                const coords = parseActivityPolyline(a);
                const useColorBySport = colorBySportCheckbox ? colorBySportCheckbox.checked : true;
                const baseColor = (sportSel?.value && sportSel.value !== 'all')
                    ? '#e31a1c'
                    : (useColorBySport ? (typeColors[a.type] || typeColors.Default) : '#e31a1c');

                if (view === 'routes' && coords && coords.length) {
                    const poly = L.polyline(coords, { color: baseColor, weight: 3, opacity: 0.8, smoothFactor: 1 }).addTo(window._stravaPolylines);
                    bounds.push(...coords);
                    poly.activity = a;
                }

                if (view === 'points' || (view === 'routes' && !coords)) {
                    if (a.start_latlng && a.start_latlng.length === 2) {
                        const m = L.circleMarker([a.start_latlng[0], a.start_latlng[1]], { radius: 5, color: baseColor, fillColor: baseColor, fillOpacity: 0.9 });
                        m.bindPopup(`<strong>${a.name || a.type}</strong><br>${a.start_date_local || ''}`);
                        m.addTo(window._stravaPoints);
                        bounds.push([a.start_latlng[0], a.start_latlng[1]]);
                    }
                    let end = null;
                    if (a.end_latlng && a.end_latlng.length === 2) end = a.end_latlng;
                    else if (coords && coords.length) end = coords[coords.length - 1];
                    if (end) {
                        const me = L.circleMarker([end[0], end[1]], { radius: 5, color: baseColor, fillColor: baseColor, fillOpacity: 0.9 });
                        me.bindPopup(`<strong>End: ${a.name || a.type}</strong><br>${a.start_date_local || ''}`);
                        me.addTo(window._stravaPoints);
                        bounds.push([end[0], end[1]]);
                    }
                }
            });
        }

        if (bounds.length) {
            try {
                const bb = L.latLngBounds(bounds);
                window._stravaMap.fitBounds(bb.pad(0.1));
            } catch (e) { }
        }
    }

    // Tile switcher
    tilesSel?.addEventListener('change', () => {
        if (!window._stravaMap) return;
        try { window._stravaMap.removeLayer(window._stravaBase); } catch (e) { }
        window._stravaBase = makeTileLayer(tilesSel.value);
        window._stravaBase.addTo(window._stravaMap);
    });

    // Add extra tile options programmatically if select exists
    if (tilesSel) {
        const want = [{ v: 'esri', t: 'Esri Satellite' }, { v: 'carto_light', t: 'Carto Light' }, { v: 'satellite', t: 'Topo' }];
        want.forEach(opt => { if (!Array.from(tilesSel.options).some(o => o.value === opt.v)) tilesSel.add(new Option(opt.t, opt.v)); });
    }

    // Controls
    applyBtn?.addEventListener('click', () => render());
    resetBtn?.addEventListener('click', () => {
        dateFromInput.value = '';
        dateToInput.value = '';
        sportSel.value = 'all';
        if (densitySlider) densitySlider.value = '1.133';
        if (radiusSlider) radiusSlider.value = '8';
        if (blurSlider) blurSlider.value = '14';
        if (colorBySportCheckbox) colorBySportCheckbox.checked = false;
        vizSel.value = 'heat';
        render();
    });
    vizSel?.addEventListener('change', () => render());
    sportSel?.addEventListener('change', () => render());
    densitySlider?.addEventListener('input', () => render());
    radiusSlider?.addEventListener('input', () => render());
    blurSlider?.addEventListener('input', () => render());
    colorBySportCheckbox?.addEventListener('change', () => render());

    // Initial render
    render();

    // Create external 100 Cims button near filters (more visible)
    let summitsActive = false;
    try {
        const btnId = 'toggle-summits-btn';
        if (!document.getElementById(btnId)) {
            const btn = document.createElement('button');
            btn.id = btnId;
            btn.style.marginLeft = '8px';
            btn.style.padding = '6px 10px';
            btn.style.fontWeight = '600';
            btn.textContent = '100 Cims';
            // place next to vizSel if possible
            if (vizSel && vizSel.parentNode) vizSel.parentNode.insertBefore(btn, vizSel.nextSibling);
            else if (tilesSel && tilesSel.parentNode) tilesSel.parentNode.insertBefore(btn, tilesSel.nextSibling);
            else container.insertBefore(btn, mapEl);
            btn.addEventListener('click', async () => {
                summitsActive = !summitsActive;
                btn.textContent = summitsActive ? '100 Cims ✓' : '100 Cims';
                if (summitsActive) await showSummitsLayer(); else hideSummitsLayer();
            });
        }
    } catch (e) { }

    // Build summits list under the map (as a table)
    function buildSummitsListContainer() {
        let list = document.getElementById('summits-list');
        if (list) return list;
        list = document.createElement('div');
        list.id = 'summits-list';
        list.style.marginTop = '8px';
        list.style.padding = '8px';
        list.style.background = 'white';
        list.style.borderRadius = '6px';
        list.style.boxShadow = '0 1px 4px rgba(0,0,0,0.1)';
        // header with sorting and table
        list.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-weight:700">Lista de Cimas</div>
                <div>
                    <select id="summit-sort"><option value="name_asc">Nombre A-Z</option><option value="height_desc">Altitud ↓</option><option value="height_asc">Altitud ↑</option><option value="completed_first">Completadas primero</option><option value="notcompleted_first">No completadas primero</option><option value="essential_first">Esenciales primero</option></select>
                </div>
            </div>
            <div style="max-height:360px;overflow:auto;border-top:1px solid #eee">
                <table id="summit-table" style="width:100%;border-collapse:collapse;font-size:0.95em">
                    <thead style="position:sticky;top:0;background:#fafafa;z-index:1">
                        <tr>
                            <th style="width:40px;padding:6px;border-bottom:1px solid #eee">Foto</th>
                            <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Nombre</th>
                            <th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Comarca</th>
                            <th style="text-align:right;padding:6px;border-bottom:1px solid #eee">Altitud</th>
                            <th style="text-align:center;padding:6px;border-bottom:1px solid #eee">Esencial</th>
                            <th style="text-align:center;padding:6px;border-bottom:1px solid #eee">Completado</th>
                            <th style="text-align:center;padding:6px;border-bottom:1px solid #eee">Enlace</th>
                        </tr>
                    </thead>
                    <tbody id="summit-table-body"></tbody>
                </table>
            </div>
        `;
        // append after map element
        if (mapEl && mapEl.parentNode) mapEl.parentNode.insertBefore(list, mapEl.nextSibling);
        else container.appendChild(list);
        document.getElementById('summit-sort')?.addEventListener('change', () => renderSummitsList());
        return list;
    }

    function renderSummitsList() {
        const list = buildSummitsListContainer();
        const tbody = document.getElementById('summit-table-body');
        tbody.innerHTML = '';
        detectCompletedSummits().then(data => {
            // apply same filters as applySummitFilters
            const regionVal = document.getElementById('summit-region-filter')?.value || 'all';
            const statusVal = document.getElementById('summit-status-filter')?.value || 'all';
            const altMin = Number(document.getElementById('summit-alt-min')?.value) || -Infinity;
            const altMaxRaw = document.getElementById('summit-alt-max')?.value; const altMax = altMaxRaw ? Number(altMaxRaw) : Infinity;
            const essentialVal = document.getElementById('summit-essential-filter')?.value || 'all';
            let filtered = data.filter(s => {
                if (regionVal !== 'all' && !(s.region || []).includes(regionVal)) return false;
                if (statusVal !== 'all' && s.status !== statusVal) return false;
                if (!isNaN(altMin) && s.height != null && s.height < altMin) return false;
                if (!isNaN(altMax) && s.height != null && s.height > altMax) return false;
                if (essentialVal === 'only' && !s.essencial) return false;
                if (essentialVal === 'no' && s.essencial) return false;
                return true;
            });
            // sorting
            const sortVal = document.getElementById('summit-sort')?.value || 'name_asc';
            const sorters = {
                name_asc: (a, b) => a.name.localeCompare(b.name),
                height_desc: (a, b) => (b.height || 0) - (a.height || 0),
                height_asc: (a, b) => (a.height || 0) - (b.height || 0),
                completed_first: (a, b) => (b.status === 'COMPLETED') - (a.status === 'COMPLETED'),
                notcompleted_first: (a, b) => (a.status === 'COMPLETED') - (b.status === 'COMPLETED'),
                essential_first: (a, b) => (b.essencial ? 1 : 0) - (a.essencial ? 1 : 0)
            };
            filtered.sort(sorters[sortVal]);
            if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="7" style="padding:8px;color:#666">No hay cimas con estos filtros.</td></tr>'; return; }
            filtered.forEach(s => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #f1f1f1';
                tr.style.cursor = 'pointer';
                const imgTd = `<td style="padding:6px;text-align:center"><img src="${s.image || ''}" style="width:36px;height:24px;object-fit:cover;border-radius:3px" onerror="this.style.display='none'"/></td>`;
                const nameTd = `<td style="padding:6px"><strong>${s.name}</strong><div style="font-size:0.85em;color:#666">${s.matchedActivity && s.matchedActivity.name ? s.matchedActivity.name : ''}</div></td>`;
                const regionTd = `<td style="padding:6px;color:#333">${(s.region || []).join(', ')}</td>`;
                const heightTd = `<td style="padding:6px;text-align:right">${s.height ? s.height + ' m' : ''}</td>`;
                const essentialTd = `<td style="padding:6px;text-align:center">${s.essencial ? 'Sí' : 'No'}</td>`;
                const statusSym = s.status === 'COMPLETED' ? '<span style="color:green">✓</span>' : (s.status === 'NEAR' ? '<span style="color:orange">●</span>' : '<span style="color:#d00">○</span>');
                const statusTd = `<td style="padding:6px;text-align:center">${statusSym}</td>`;
                const linkTd = `<td style="padding:6px;text-align:center">${s.url ? `<a href="${s.url}" target="_blank" rel="noopener noreferrer">🔗</a>` : ''}</td>`;
                tr.innerHTML = imgTd + nameTd + regionTd + heightTd + essentialTd + statusTd + linkTd;
                tr.addEventListener('click', () => {
                    let found = null;
                    window._stravaSummits.eachLayer(l => { if (l.summit && l.summit.id === s.id) found = l; });
                    if (found) { window._stravaMap.setView(found.getLatLng(), 13); found.openPopup(); }
                });
                tbody.appendChild(tr);
            });
        });
    }

    // --- 100 Cims functionality ---
    // Use a window-scoped cache to avoid reprocessing unless activities change
    if (!window._summitDetectionCache) window._summitDetectionCache = { key: null, results: null };
    if (!window._stravaSummits) window._stravaSummits = L.layerGroup();

    // Load summits JSON (returns array of processed summits)
    async function loadSummits() {
        try {
            const url = '../../media/muntanyesRepte100CimsFEEC.json';
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to load ${url}`);
            const data = await res.json();
            // Normalize and sanitize
            return (Array.isArray(data) ? data : []).map(s => ({
                id: s.id,
                url: s.url || '',
                image: s.image || '',
                name: s.name || 'Unknown',
                height: Number(s.height) || null,
                region: (s.region || '').split(',').map(r => r.trim()).filter(Boolean),
                essencial: !!s.essencial,
                latitude: Number(s.latitude),
                longitude: Number(s.longitude)
            })).filter(s => !isNaN(s.latitude) && !isNaN(s.longitude));
        } catch (e) {
            console.warn('Could not load summits JSON', e);
            return [];
        }
    }

    function makeSummitKeyForActivities(acts) {
        // Simple snapshot key: number of activities + joined ids/start dates
        try {
            return `${acts.length}|${acts.map(a => a.id || a.start_date_local || a.name || '').join(',')}`;
        } catch (e) { return `${acts.length}`; }
    }

    // Detect summit status across activities (runs once and caches result)
    async function detectCompletedSummits() {
        const summits = await loadSummits();
        const key = makeSummitKeyForActivities(activities || []);
        if (window._summitDetectionCache.key === key && window._summitDetectionCache.results) return window._summitDetectionCache.results;

        // Prepare results structure
        const results = summits.map(s => ({ ...s, status: 'NOT_COMPLETED', distanceMeters: null, matchedActivity: null }));

        // For performance: build simplified point lists once per activity
        const activityTracks = (activities || []).map(a => {
            const coords = parseActivityPolyline(a);
            // also check for streams latlng (if present as streams.latlng.data)
            const streams = a.streams || a.streams_data || null;
            const streamLatLng = streams && streams.latlng && streams.latlng.data ? streams.latlng.data : null;
            const streamAlt = streams && streams.altitude && streams.altitude.data ? streams.altitude.data : null;
            return { activity: a, coords: coords || streamLatLng || (a.start_latlng && a.start_latlng.length === 2 ? [[a.start_latlng[0], a.start_latlng[1]]] : []), streamAlt };
        });

        // For each summit, quickly check candidates using bounding box then precise distance to segments
        const maxCheckMeters = SUMMIT_DETECTION_NEAR_MAX;
        const metersPerDegLat = 111320;

        results.forEach(s => {
            const lat = s.latitude;
            const lon = s.longitude;
            const latDelta = maxCheckMeters / metersPerDegLat;
            const lonDelta = maxCheckMeters / (metersPerDegLat * Math.cos(lat * Math.PI / 180) || 1);
            let best = { dist: Infinity, activity: null, date: null, name: null, elevAtPoint: null };

            for (let at of activityTracks) {
                if (!at.coords || at.coords.length === 0) continue;
                // Quick bbox filter on coordinates array
                let withinBox = false;
                for (let p of at.coords) {
                    const plat = Number(p[0]); const plong = Number(p[1]);
                    if (isNaN(plat) || isNaN(plong)) continue;
                    if (plat >= lat - latDelta && plat <= lat + latDelta && plong >= lon - lonDelta && plong <= lon + lonDelta) { withinBox = true; break; }
                }
                if (!withinBox) continue;

                // compute precise minimal distance to segments
                const pts = at.coords;
                for (let i = 0; i < pts.length - 1; i++) {
                    const a = pts[i]; const b = pts[i + 1];
                    const d = distancePointToSegmentMeters(lat, lon, Number(a[0]), Number(a[1]), Number(b[0]), Number(b[1]));
                    if (d < best.dist) {
                        best.dist = d;
                        best.activity = at.activity;
                        best.date = at.activity.start_date_local || null;
                        best.name = at.activity.name || at.activity.type || '';
                        // if streamAlt available, try to get altitude at nearest index (approx)
                        if (at.streamAlt && pts.length === at.streamAlt.length) {
                            // find nearest point index
                            let nearestIdx = 0; let nearestD = Infinity;
                            for (let j = 0; j < pts.length; j++) {
                                const dd = haversineDistanceMeters(lat, lon, Number(pts[j][0]), Number(pts[j][1]));
                                if (dd < nearestD) { nearestD = dd; nearestIdx = j; }
                            }
                            best.elevAtPoint = at.streamAlt[nearestIdx];
                        }
                    }
                }
                // also check single-point activities
                if (pts.length === 1) {
                    const d0 = haversineDistanceMeters(lat, lon, Number(pts[0][0]), Number(pts[0][1]));
                    if (d0 < best.dist) {
                        best.dist = d0; best.activity = at.activity; best.date = at.activity.start_date_local || null; best.name = at.activity.name || at.activity.type || '';
                    }
                }
            }

            if (best.activity) {
                s.distanceMeters = Math.round(best.dist);
                s.matchedActivity = { id: best.activity.id || null, name: best.name, date: best.date, elevAtPoint: best.elevAtPoint };
                if (best.dist <= SUMMIT_DETECTION_RADIUS_METERS) s.status = 'COMPLETED';
                else if (best.dist > SUMMIT_DETECTION_NEAR_MIN && best.dist <= SUMMIT_DETECTION_NEAR_MAX) s.status = 'NEAR';
                else if (best.dist <= SUMMIT_DETECTION_NEAR_MIN) s.status = 'COMPLETED'; // fallback
            }
        });

        window._summitDetectionCache = { key, results };
        return results;
    }

    function createSummitPopupHTML(s) {
        const statusLabel = s.status === 'COMPLETED' ? '✓ COMPLETADO' : (s.status === 'NEAR' ? '● CERCA' : '○ NO COMPLETADO');
        const distLine = s.distanceMeters != null ? `<div><strong>Distancia al track:</strong> ${s.distanceMeters} m</div>` : '';
        const actLine = s.matchedActivity ? `<div><strong>Actividad:</strong> ${s.matchedActivity.name || ''}</div><div><strong>Fecha:</strong> ${s.matchedActivity.date || ''}</div>` : '';
        const img = s.image ? `<img src="${s.image}" style="max-width:200px;max-height:120px;display:block;margin-bottom:6px;" onerror="this.style.display='none'" />` : '';
        const essencial = s.essencial ? 'Sí' : 'No';
        const url = s.url ? `<a href="${s.url}" target="_blank" rel="noopener noreferrer">Ver en FEEC</a>` : '';
        return `<div style="min-width:220px">${img}<div style="font-weight:bold;font-size:1.05em">${s.name}</div><div>${s.height ? s.height + ' m' : ''}</div><div>${(s.region || []).join(', ')}</div><div style="margin-top:6px"><strong>Estado:</strong> ${statusLabel}</div>${distLine}${actLine}<div><strong>Esencial:</strong> ${essencial}</div><div style="margin-top:6px">${url}</div></div>`;
    }

    function createSummitMarker(s) {
        let color = '#d62728'; // red default
        if (s.status === 'COMPLETED') color = '#2ca02c';
        else if (s.status === 'NEAR') color = '#ff7f0e';
        const m = L.circleMarker([s.latitude, s.longitude], { radius: 6, color: color, fillColor: color, fillOpacity: 0.9 });
        m.bindPopup(createSummitPopupHTML(s));
        m.summit = s;
        return m;
    }

    // Build a simple panel with filters and summary
    function buildSummitPanel() {
        let panel = document.getElementById('summits-panel');
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = 'summits-panel';
        panel.style.position = 'absolute';
        panel.style.right = '10px';
        panel.style.top = '60px';
        panel.style.zIndex = 4000;
        panel.style.background = 'white';
        panel.style.padding = '8px';
        panel.style.borderRadius = '6px';
        panel.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';
        panel.style.maxWidth = '260px';
        panel.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px">100 CIMS</div>
            <div id="summits-summary">Cargando...</div>
            <div style="margin-top:8px">
                <label>Región:</label>
                <select id="summit-region-filter"><option value="all">Todas</option></select>
            </div>
            <div style="margin-top:6px">
                <label>Estado:</label>
                <select id="summit-status-filter"><option value="all">Todas</option><option value="COMPLETED">Completadas</option><option value="NOT_COMPLETED">No completadas</option><option value="NEAR">Cerca</option></select>
            </div>
            <div style="margin-top:6px">
                <label>Altitud min:</label><input id="summit-alt-min" type="number" style="width:100%" />
                <label>Altitud max:</label><input id="summit-alt-max" type="number" style="width:100%" />
            </div>
            <div style="margin-top:6px">
                <label>Esencial:</label>
                <select id="summit-essential-filter"><option value="all">Todas</option><option value="only">Sólo esenciales</option><option value="no">Sólo no esenciales</option></select>
            </div>
            <div style="margin-top:8px;text-align:right"><button id="summit-close-btn">Cerrar</button></div>
        `;
        container.appendChild(panel);
        document.getElementById('summit-close-btn').addEventListener('click', () => { panel.style.display = 'none'; });
        return panel;
    }

    async function showSummitsLayer() {
        const panel = buildSummitPanel(); panel.style.display = 'block';
        let data = await detectCompletedSummits();
        // create unique region list
        const regions = new Set(); data.forEach(s => (s.region || []).forEach(r => regions.add(r)));
        const regionSel = document.getElementById('summit-region-filter');
        regionSel.innerHTML = '<option value="all">Todas</option>' + Array.from(regions).sort().map(r => `<option value="${r}">${r}</option>`).join('');

        // empty existing layer then add markers
        window._stravaSummits.clearLayers();
        data.forEach(s => {
            const m = createSummitMarker(s);
            window._stravaSummits.addLayer(m);
        });

        // add to map if not present
        if (!window._stravaMap.hasLayer(window._stravaSummits)) window._stravaSummits.addTo(window._stravaMap);

        updateSummitSummary(data);
        try { renderSummitsList(); } catch (e) { }

        // wire up filter events to only show/hide markers
        const statusSel = document.getElementById('summit-status-filter');
        const altMin = document.getElementById('summit-alt-min');
        const altMax = document.getElementById('summit-alt-max');
        const essentialSel = document.getElementById('summit-essential-filter');
        const updateFilters = () => applySummitFilters();
        regionSel?.addEventListener('change', updateFilters);
        statusSel?.addEventListener('change', updateFilters);
        altMin?.addEventListener('input', updateFilters);
        altMax?.addEventListener('input', updateFilters);
        essentialSel?.addEventListener('change', updateFilters);
    }

    function hideSummitsLayer() {
        try { window._stravaMap.removeLayer(window._stravaSummits); } catch (e) { }
        const panel = document.getElementById('summits-panel'); if (panel) panel.style.display = 'none';
    }

    function applySummitFilters() {
        const regionVal = document.getElementById('summit-region-filter')?.value || 'all';
        const statusVal = document.getElementById('summit-status-filter')?.value || 'all';
        const altMin = Number(document.getElementById('summit-alt-min')?.value) || -Infinity;
        const altMaxRaw = document.getElementById('summit-alt-max')?.value;
        const altMax = altMaxRaw ? Number(altMaxRaw) : Infinity;
        const essentialVal = document.getElementById('summit-essential-filter')?.value || 'all';

        const allMarkers = [];
        window._stravaSummits.eachLayer(l => allMarkers.push(l));
        let visibleCount = 0, completedCount = 0, nearCount = 0, total = allMarkers.length, essencialCompleted = 0, essencialTotal = 0;

        allMarkers.forEach(m => {
            const s = m.summit;
            if (!s) return;
            let show = true;
            if (regionVal !== 'all' && !(s.region || []).includes(regionVal)) show = false;
            if (statusVal !== 'all' && s.status !== statusVal) show = false;
            if (!isNaN(altMin) && s.height != null && s.height < altMin) show = false;
            if (!isNaN(altMax) && s.height != null && s.height > altMax) show = false;
            if (essentialVal === 'only' && !s.essencial) show = false;
            if (essentialVal === 'no' && s.essencial) show = false;
            if (show) { window._stravaSummits.addLayer(m); visibleCount++; } else { window._stravaSummits.removeLayer(m); }
            if (s.status === 'COMPLETED') completedCount++;
            if (s.status === 'NEAR') nearCount++;
            if (s.essencial) { essencialTotal++; if (s.status === 'COMPLETED') essencialCompleted++; }
        });

        updateSummitSummary({ total, completedCount, nearCount, visibleCount, essencialCompleted, essencialTotal });
        // update the list view as well
        try { renderSummitsList(); } catch (e) { }
    }

    function updateSummitSummary(data) {
        const panel = document.getElementById('summits-panel');
        const summaryEl = panel ? document.getElementById('summits-summary') : null;
        if (!summaryEl) return;
        // data can be array of summits or an object
        if (Array.isArray(data)) {
            const total = data.length;
            const completed = data.filter(s => s.status === 'COMPLETED').length;
            const near = data.filter(s => s.status === 'NEAR').length;
            const essencialTotal = data.filter(s => s.essencial).length;
            const essencialCompleted = data.filter(s => s.essencial && s.status === 'COMPLETED').length;
            const percent = total ? Math.round((completed / total) * 1000) / 10 : 0;
            summaryEl.innerHTML = `<div><strong>${completed} / ${total} completados</strong> (${percent}%)</div><div>● ${near} cerca</div><div>○ ${total - completed - near} pendientes</div><div style="margin-top:6px">Esenciales: ${essencialCompleted} / ${essencialTotal}</div>`;
        } else {
            const total = data.total || 0;
            const completed = data.completedCount || 0;
            const near = data.nearCount || 0;
            const visible = data.visibleCount || 0;
            const essencialTotal = data.essencialTotal || 0;
            const essencialCompleted = data.essencialCompleted || 0;
            const percent = total ? Math.round((completed / total) * 1000) / 10 : 0;
            summaryEl.innerHTML = `<div><strong>${completed} / ${total} completados</strong> (${percent}%)</div><div>● ${near} cerca</div><div>○ ${total - completed - near} pendientes</div><div style="margin-top:6px">Esenciales: ${essencialCompleted} / ${essencialTotal}</div>`;
        }
    }

    // (External toggle button created near controls; no Leaflet control here.)
}

export default { renderMapTab };

