// js/analysis.js
import * as utils from './utils.js';

let charts = {};

// --- BIKE TYPE COLORING ---

const bikeColors = {
    road: "#6b7280",      // grey road
    mtb: "#2e7d32",       // mountain green
    indoor: "#42a5f5",    // blue indoor
    gravel: "#d97706",    // yellow/orange gravel
    electric: "#facc15"   // yellow electric
};

const BIKE_TYPES = ['road', 'mtb', 'gravel', 'indoor', 'electric'];
const BIKE_TYPE_LABELS = { road: 'Road', mtb: 'MTB', gravel: 'Gravel', indoor: 'Indoor', electric: 'Electric' };

function getBikeType(r) {
    if (r.sport_type === "MountainBikeRide" || r.sport_type === "EMountainBikeRide") return "mtb";
    if (r.sport_type === "GravelBikeRide" || r.sport_type === "EGravelBikeRide") return "gravel";
    if (r.sport_type === "EBikeRide") return "electric";
    if (r.sport_type === "VirtualRide" || r.sport_type === "IndoorRide" || r.type === "VirtualRide" || (!r.start_latlng?.length && r.distance === 0)) return "indoor";
    return "road";
}

function getBikeTypeLabel(r) {
    const bikeType = getBikeType(r);
    if (bikeType === "mtb") return "MTB";
    if (bikeType === "gravel") return "Gravel";
    if (bikeType === "electric") return "Electric";
    if (bikeType === "indoor") return "Indoor";
    if (bikeType === "road") return "Road";
    return "Outdoor";
}

function bikeTypeBadge(r) {
    const bikeType = getBikeType(r);
    const label = getBikeTypeLabel(r);
    return `<span class="bike-type-badge bike-type-${bikeType}">${label}</span>`;
}


// ------------------------
// MAIN ENTRY
// ------------------------

export function renderBikeAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter = 'all', rollingWindowWeeks = 26) {

    const filteredActivities =
        utils.filterActivitiesByDate(allActivities, dateFilterFrom, dateFilterTo);

    const rideSportTypes = new Set([
        'Ride', 'MountainBikeRide', 'GravelBikeRide',
        'EBikeRide', 'EMountainBikeRide', 'EGravelBikeRide',
        'VirtualRide', 'IndoorRide'
    ]);
    const rideTypes = new Set(['Ride', 'VirtualRide', 'EBikeRide']);

    const rides = filteredActivities
        .filter(a => rideTypes.has(a.type) || rideSportTypes.has(a.sport_type))
        .filter(a => gearFilter === 'all' || a.gear_id === gearFilter);

    console.log("Rendering bike analysis for", rides.length, "rides");
    console.log(rides);

    if (!rides.length) return;

    renderSummaryCards(rides);
    renderBikeTypeSummary(rides);

    renderBikeTypeChart(rides);

    renderDistanceHistogram(rides);
    renderElevationHistogram(rides);

    renderSpeedVsDistanceChart(rides);
    renderDistanceVsElevationChart(rides);

    renderElevationRatioChart(rides);

    renderPowerVsSpeedChart(rides);

    renderAccumulatedDistanceChart(rides);
    renderWeeklyDistanceTrendChart(rides, rollingWindowWeeks);
    renderEddingtonSection(rides);

    renderTopActivities(rides);
    renderActivitiesTable(rides);

    renderConsistencyChart(rides, dateFilterFrom, dateFilterTo);
}

function buildWeeklyDistanceSeries(activities, distanceGetter) {
    const weeklyTotals = {};
    const parseLocalDate = (isoDateLike) => {
        const datePart = String(isoDateLike).substring(0, 10);
        const [y, m, d] = datePart.split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    };
    const toLocalDateKey = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    activities.forEach(activity => {
        if (!activity?.start_date_local) return;

        const date = parseLocalDate(activity.start_date_local);
        if (Number.isNaN(date.getTime())) return;

        const weekStart = new Date(date);
        const daysSinceMonday = (weekStart.getDay() + 6) % 7;
        weekStart.setDate(weekStart.getDate() - daysSinceMonday);
        weekStart.setHours(0, 0, 0, 0);

        const key = toLocalDateKey(weekStart);
        const km = Number(distanceGetter(activity)) || 0;
        weeklyTotals[key] = (weeklyTotals[key] || 0) + km;
    });

    const weekStarts = Object.keys(weeklyTotals).sort();
    if (weekStarts.length === 0) {
        return { labels: [], weeklyKm: [] };
    }

    const labels = [];
    const weeklyKm = [];
    const firstWeek = parseLocalDate(weekStarts[0]);
    const lastWeek = parseLocalDate(weekStarts[weekStarts.length - 1]);

    for (let d = new Date(firstWeek); d <= lastWeek; d.setDate(d.getDate() + 7)) {
        const key = toLocalDateKey(d);
        labels.push(key);
        weeklyKm.push(+((weeklyTotals[key] || 0).toFixed(2)));
    }

    return { labels, weeklyKm };
}

// ------------------------
// SORTABLE TABLE UTILITY
// ------------------------

function makeSortable(table) {
    if (!table) return;
    const headers = table.querySelectorAll('thead th[data-sort]');
    headers.forEach(th => {
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.addEventListener('click', () => {
            const tbody = table.querySelector('tbody');
            if (!tbody) return;
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const type = th.dataset.sort;
            const currentDir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
            headers.forEach(h => { h.dataset.dir = ''; h.classList.remove('sort-asc', 'sort-desc'); });
            th.dataset.dir = currentDir;
            th.classList.add(currentDir === 'asc' ? 'sort-asc' : 'sort-desc');
            const realIdx = Array.from(th.parentElement.children).indexOf(th);
            rows.sort((a, b) => {
                const cellA = a.children[realIdx];
                const cellB = b.children[realIdx];
                if (!cellA || !cellB) return 0;
                let vA, vB;
                if (type === 'num' || type === 'pace') {
                    vA = parseFloat(cellA.dataset.value ?? cellA.textContent) || 0;
                    vB = parseFloat(cellB.dataset.value ?? cellB.textContent) || 0;
                } else if (type === 'date') {
                    vA = new Date(cellA.textContent.trim()).getTime() || 0;
                    vB = new Date(cellB.textContent.trim()).getTime() || 0;
                } else {
                    vA = cellA.textContent.trim().toLowerCase();
                    vB = cellB.textContent.trim().toLowerCase();
                    return currentDir === 'asc' ? vA.localeCompare(vB) : vB.localeCompare(vA);
                }
                return currentDir === 'asc' ? vA - vB : vB - vA;
            });
            rows.forEach(r => tbody.appendChild(r));
        });
    });
}

// ------------------------
// CHART UTILITY
// ------------------------

function createChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    // Ensure charts are responsive and maintain aspect ratio
    if (!config.options) config.options = {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = true;

    const ctx = canvas.getContext("2d");
    const chart = new Chart(ctx, config);

    charts[canvasId] = chart;

    return chart;
}

function isDatasetVisible(chart, datasetIndex) {
    const meta = chart.getDatasetMeta(datasetIndex);
    const dataset = chart.data.datasets[datasetIndex];
    if (typeof chart.isDatasetVisible === 'function') {
        return chart.isDatasetVisible(datasetIndex);
    }
    return !(meta.hidden === null ? dataset.hidden : meta.hidden);
}

function toggleDatasetVisibility(chart, datasetIndex) {
    const meta = chart.getDatasetMeta(datasetIndex);
    meta.hidden = isDatasetVisible(chart, datasetIndex);
    chart.update();
}

function getRollingTrendLegendPriority(label) {
    if (label.startsWith('Rolling mean (')) return 0;
    if (label === 'Weekly distance (km)') return 1;
    if (label === 'Rolling mean speed (km/h)') return 2;
    return 99;
}

function getLegendColorValue(value, fallback) {
    if (Array.isArray(value)) return value[0] || fallback;
    return value || fallback;
}

function syncChartHtmlLegendOverlay(chart, canvasId) {
    const canvas = document.getElementById(canvasId);
    const container = canvas?.closest('.chart-container');
    if (!canvas || !container || !chart) return;

    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) return;

    container.style.position = 'relative';

    let overlay = container.querySelector(`.chart-html-legend-overlay[data-chart-legend-for="${canvasId}"]`);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'chart-html-legend-overlay';
        overlay.dataset.chartLegendFor = canvasId;
        container.appendChild(overlay);
    }

    const containerRect = container.getBoundingClientRect();
    overlay.style.left = `${canvasRect.left - containerRect.left}px`;
    overlay.style.top = `${canvasRect.bottom - containerRect.top - 28}px`;
    overlay.style.width = `${canvasRect.width}px`;
    overlay.style.height = '24px';

    const legendItems = chart.data.datasets
        .map((dataset, datasetIndex) => ({ dataset, datasetIndex }))
        .sort((a, b) => getRollingTrendLegendPriority(a.dataset.label) - getRollingTrendLegendPriority(b.dataset.label));

    const legendSignature = legendItems
        .map(({ dataset, datasetIndex }) => {
            const borderColor = getLegendColorValue(dataset.borderColor, '#777');
            const backgroundColor = getLegendColorValue(dataset.backgroundColor, borderColor);
            return [datasetIndex, dataset.label, borderColor, backgroundColor].join(':');
        })
        .join('|');

    if (overlay.dataset.legendSignature !== legendSignature) {
        overlay.innerHTML = '';
        overlay.dataset.legendSignature = legendSignature;

        legendItems.forEach(({ dataset, datasetIndex }) => {
            const borderColor = getLegendColorValue(dataset.borderColor, '#777');
            const backgroundColor = getLegendColorValue(dataset.backgroundColor, borderColor);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chart-html-legend-overlay__item';
            button.dataset.datasetIndex = String(datasetIndex);

            const swatch = document.createElement('span');
            swatch.className = 'chart-html-legend-overlay__swatch';
            swatch.style.backgroundColor = backgroundColor;
            swatch.style.borderColor = borderColor;

            const label = document.createElement('span');
            label.textContent = dataset.label;

            button.append(swatch, label);
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const currentChart = Chart.getChart(canvas) || chart;
                toggleDatasetVisibility(currentChart, datasetIndex);
            });

            overlay.appendChild(button);
        });
    }

    legendItems.forEach(({ datasetIndex }) => {
        const button = overlay.querySelector(`[data-dataset-index="${datasetIndex}"]`);
        if (!button) return;
        const visible = isDatasetVisible(chart, datasetIndex);
        button.classList.toggle('is-hidden', !visible);
        button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    });
}

function createHtmlLegendOverlayPlugin(canvasId) {
    return {
        id: `${canvasId}-html-legend-overlay`,
        afterDraw(chart) {
            syncChartHtmlLegendOverlay(chart, canvasId);
        }
    };
}


// ------------------------
// SUMMARY
// ------------------------

function renderBikeTypeSummary(rides) {
    const el = document.getElementById("bike-type-summary");
    if (!el) return;

    const types = ["road", "mtb", "gravel", "indoor", "electric"];
    const labels = { road: "Road", mtb: "MTB", gravel: "Gravel", indoor: "Indoor", electric: "Electric" };

    function agg(arr) {
        const count = arr.length;
        if (!count) return null;
        const totalDist = arr.reduce((s, a) => s + (a.distance || 0) / 1000, 0);
        const totalSec = arr.reduce((s, a) => s + (a.moving_time || 0), 0);
        const avgDist = totalDist / count;
        const avgSpeed = arr.reduce((s, a) => {
            const spd = (a.distance / 1000) / (a.moving_time / 3600);
            return s + (isFinite(spd) ? spd : 0);
        }, 0) / count;
        const avgTime = totalSec / count;
        const avgTimeH = Math.floor(avgTime / 3600);
        const avgTimeM = Math.floor((avgTime % 3600) / 60);
        const avgTimeStr = avgTimeH > 0
            ? `${avgTimeH}h ${String(avgTimeM).padStart(2, '0')}m`
            : `${avgTimeM}m`;
        return { count, totalDist, avgDist, avgSpeed, avgTimeStr };
    }

    const rows = types.map(t => {
        const arr = rides.filter(r => getBikeType(r) === t);
        const a = agg(arr);
        if (!a) return `<tr>
            <td><span class="bike-type-badge bike-type-${t}">${labels[t]}</span></td>
            <td>-</td><td>-</td><td>-</td><td>-</td>
        </tr>`;
        return `<tr>
            <td><span class="bike-type-badge bike-type-${t}">${labels[t]}</span></td>
            <td>${a.count}</td>
            <td>${a.totalDist.toFixed(0)} km</td>
            <td>${a.avgDist.toFixed(1)} km</td>
            <td>${utils.formatSpeedBike(a.avgSpeed)}</td>
            <td>${a.avgTimeStr}</td>
        </tr>`;
    }).join("");

    el.innerHTML = `
        <table class="compact-table">
            <thead>
                <tr>
                    <th>Type</th>
                    <th>Sessions</th>
                    <th>Total dist</th>
                    <th>Avg dist</th>
                    <th>Avg speed</th>
                    <th>Avg time</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderSummaryCards(rides) {

    const el = document.getElementById("bike-summary-cards");
    if (!el) return;

    const totalDistance =
        rides.reduce((s, a) => s + a.distance, 0) / 1000;

    const totalElevation =
        rides.reduce((s, a) => s + (a.total_elevation_gain || 0), 0);

    const totalTime =
        rides.reduce((s, a) => s + a.moving_time, 0);

    const avgSpeed =
        totalDistance / (totalTime / 3600);

    el.innerHTML = `
        <div class="card">
            <h3>Rides</h3>
            <p>${rides.length}</p>
        </div>

        <div class="card">
            <h3>Total Distance</h3>
            <p>${totalDistance.toFixed(1)} km</p>
        </div>

        <div class="card">
            <h3>Total Elevation</h3>
            <p>${totalElevation.toLocaleString()} m</p>
        </div>

        <div class="card">
            <h3>Avg Speed</h3>
            <p>${utils.formatSpeedBike(avgSpeed)}</p>
        </div>
    `;
}

// ------------------------
// ROAD VS MTB
// ------------------------

function renderBikeTypeChart(rides) {
    const counts = { road: 0, mtb: 0, indoor: 0, gravel: 0, electric: 0 };
    rides.forEach(r => { counts[getBikeType(r)]++; });

    const activeTypes = BIKE_TYPES.filter(t => counts[t] > 0);

    createChart("bike-type-chart", {
        type: "pie",
        data: {
            labels: activeTypes.map(t => BIKE_TYPE_LABELS[t]),
            datasets: [{
                data: activeTypes.map(t => counts[t]),
                backgroundColor: activeTypes.map(t => bikeColors[t])
            }]
        }
    });
}

// ------------------------
// DISTANCE HISTOGRAM
// ------------------------

function renderDistanceHistogram(rides) {
    const distances = rides
        .map(r => (r.distance ? r.distance / 1000 : 0))
        .filter(d => !isNaN(d) && d >= 0);

    if (!distances.length) return;

    // Separate indoor (distance=0) from outdoor
    const indoorCount = distances.filter(d => d === 0).length;
    const outdoorDistances = distances.filter(d => d > 0);

    const binSize = 5; //km
    const max = Math.max(...outdoorDistances, binSize);
    const bins = new Array(Math.ceil(max / binSize)).fill(0);

    outdoorDistances.forEach(d => {
        const idx = Math.floor(d / binSize);
        if (bins[idx] !== undefined) bins[idx]++;
    });

    // Prepend indoor bin
    const labels = ['Indoor (0 km)', ...bins.map((_, i) => `${i * binSize}-${(i + 1) * binSize}`)];
    const data = [indoorCount, ...bins];

    createChart("bike-distance-histogram", {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "# rides",
                data,
                backgroundColor: data.map((_, i) => i === 0 ? "rgba(158,158,158,0.7)" : "rgba(46,125,50,0.7)")
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } }
        }
    });
}





// ------------------------
// ELEVATION HISTOGRAM
// ------------------------

function renderElevationHistogram(rides) {
    const values = rides
        .map(r => r.total_elevation_gain || 0)
        .filter(v => !isNaN(v) && v >= 0);

    if (!values.length) return;

    // Separate indoor/flat (elevation=0) from outdoor
    const indoorCount = values.filter(v => v === 0).length;
    const outdoorValues = values.filter(v => v > 0);

    const binSize = 25;
    const max = Math.max(...outdoorValues, binSize);
    const bins = new Array(Math.ceil(max / binSize)).fill(0);

    outdoorValues.forEach(v => {
        const idx = Math.floor(v / binSize);
        if (bins[idx] !== undefined) bins[idx]++;
    });

    const labels = ['Indoor (0 m)', ...bins.map((_, i) => `${i * binSize}-${(i + 1) * binSize}`)];
    const data = [indoorCount, ...bins];

    createChart("bike-elevation-histogram", {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "# rides",
                data,
                backgroundColor: data.map((_, i) => i === 0 ? "rgba(158,158,158,0.7)" : "rgba(56,142,60,0.7)")
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } }
        }
    });
}



// ------------------------
// DISTANCE VS SPEED
// ------------------------

function buildScatterDatasets(rides, xFn, yFn) {
    return BIKE_TYPES
        .map(type => {
            const data = rides
                .filter(r => getBikeType(r) === type)
                .map(r => ({ x: xFn(r), y: yFn(r) }))
                .filter(p => isFinite(p.x) && isFinite(p.y) && p.x !== 0);
            return {
                label: BIKE_TYPE_LABELS[type],
                data,
                backgroundColor: bikeColors[type],
                borderColor: bikeColors[type],
                pointRadius: 4,
                pointHoverRadius: 6
            };
        })
        .filter(ds => ds.data.length > 0);
}

function renderSpeedVsDistanceChart(rides) {
    const validRides = rides.filter(r => r.moving_time > 0 && r.distance > 0);
    if (!validRides.length) return;

    const datasets = buildScatterDatasets(
        validRides,
        r => r.distance / 1000,
        r => (r.distance / 1000) / (r.moving_time / 3600)
    );

    createChart("bike-speed-distance-chart", {
        type: "scatter",
        data: { datasets },
        options: {
            scales: {
                x: { title: { display: true, text: "Distance (km)" } },
                y: { title: { display: true, text: "Speed (km/h)" } }
            },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}




// ------------------------
// DISTANCE VS ELEVATION
// ------------------------

function renderDistanceVsElevationChart(rides) {
    const validRides = rides.filter(r => r.distance > 0 && r.total_elevation_gain >= 0);
    if (!validRides.length) return;

    const datasets = buildScatterDatasets(
        validRides,
        r => r.distance / 1000,
        r => r.total_elevation_gain || 0
    );

    createChart("bike-distance-elevation-chart", {
        type: "scatter",
        data: { datasets },
        options: {
            scales: {
                x: { title: { display: true, text: "Distance (km)" } },
                y: { title: { display: true, text: "Elevation Gain (m)" } }
            },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}




// ------------------------
// ELEVATION RATIO
// ------------------------

function renderElevationRatioChart(rides) {
    const validRides = rides.filter(r => r.distance > 0);
    if (!validRides.length) return;

    const datasets = buildScatterDatasets(
        validRides,
        r => r.distance / 1000,
        r => (r.total_elevation_gain || 0) / (r.distance / 1000)
    );

    createChart("bike-elevation-ratio-chart", {
        type: "scatter",
        data: { datasets },
        options: {
            scales: {
                x: { title: { display: true, text: "Distance (km)" } },
                y: { title: { display: true, text: "m / km" } }
            },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}




// ------------------------
// POWER VS SPEED
// ------------------------

function renderPowerVsSpeedChart(rides) {
    const validRides = rides.filter(r => r.average_watts > 0 && r.moving_time > 0 && r.distance > 0);
    if (!validRides.length) return;

    const datasets = buildScatterDatasets(
        validRides,
        r => r.average_watts,
        r => (r.distance / 1000) / (r.moving_time / 3600)
    );

    createChart("bike-power-speed-chart", {
        type: "scatter",
        data: { datasets },
        options: {
            scales: {
                x: { title: { display: true, text: "Power (W)" } },
                y: { title: { display: true, text: "Speed (km/h)" } }
            },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}




// ------------------------
// TOP RIDES
// ------------------------

function renderTopActivities(rides) {

    const el = document.getElementById("top-rides");
    if (!el) return;

    const topDistance = [...rides]
        .sort((a, b) => b.distance - a.distance)
        .slice(0, 10);

    const topElevation = [...rides]
        .sort((a, b) => b.total_elevation_gain - a.total_elevation_gain)
        .slice(0, 10);

    const topFastest = [...rides]
        .filter(a => a.moving_time > 0 && a.distance > 0)
        .map(a => ({
            ...a,
            speed: (a.distance / 1000) / (a.moving_time / 3600)
        }))
        .sort((a, b) => b.speed - a.speed)
        .slice(0, 10);

    const formatTime = s => {

        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);

        return `${h}h ${m}m`;
    };

    const activityLink = a => {
        if (!a?.id) return a?.name || '-';
        return `<a href="html/activity-router.html?id=${encodeURIComponent(a.id)}" target="_blank" rel="noopener noreferrer">${a.name}</a>`;
    };

    el.innerHTML = `

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin: 2rem 0;">

        <div class="top-box" style="padding: 1.5rem; background: rgba(46, 125, 50, 0.08); border: 1px solid rgba(46, 125, 50, 0.25); border-radius: 12px;">

            <h3 style="margin-top: 0; color: #2e7d32;">Longest Rides</h3>

            <table class="compact-table" id="bike-top-distance-table">
            <thead><tr style="background: #2e7d32; color: #fff;"><th>#</th><th>Ride</th><th data-sort="num">km</th></tr></thead>
            <tbody>
                ${topDistance.map((a, i) =>
        `<tr><td>${i + 1}</td><td>${activityLink(a)}</td><td data-value="${a.distance / 1000}">${(a.distance / 1000).toFixed(1)} km</td></tr>`
    ).join("")}
            </tbody>
            </table>

        </div>

        <div class="top-box" style="padding: 1.5rem; background: rgba(46, 125, 50, 0.08); border: 1px solid rgba(46, 125, 50, 0.25); border-radius: 12px;">

            <h3 style="margin-top: 0; color: #2e7d32;">Most Elevation</h3>

            <table class="compact-table" id="bike-top-elevation-table">
            <thead><tr style="background: #2e7d32; color: #fff;"><th>#</th><th>Ride</th><th data-sort="num">Elev (m)</th></tr></thead>
            <tbody>
                ${topElevation.map((a, i) =>
        `<tr><td>${i + 1}</td><td>${activityLink(a)}</td><td data-value="${a.total_elevation_gain}">${a.total_elevation_gain} m</td></tr>`
    ).join("")}
            </tbody>
            </table>

        </div>

        <div class="top-box" style="padding: 1.5rem; background: rgba(46, 125, 50, 0.08); border: 1px solid rgba(46, 125, 50, 0.25); border-radius: 12px;">

            <h3 style="margin-top: 0; color: #2e7d32;">Fastest Rides</h3>

            <table class="compact-table" id="bike-top-speed-table">
            <thead><tr style="background: #2e7d32; color: #fff;"><th>#</th><th>Ride</th><th data-sort="num">km/h</th></tr></thead>
            <tbody>
                ${topFastest.map((a, i) =>
        `<tr><td>${i + 1}</td><td>${activityLink(a)}</td><td data-value="${a.speed}">${utils.formatSpeedBike(a.speed)}</td></tr>`
    ).join("")}
            </tbody>
            </table>

        </div>

        </div>
    `;

    makeSortable(document.getElementById('bike-top-distance-table'));
    makeSortable(document.getElementById('bike-top-elevation-table'));
    makeSortable(document.getElementById('bike-top-speed-table'));
}


///////////////////////
// ALL ACTIVITIES TABLE
///////////////////////

function renderActivitiesTable(rides) {

    const el = document.getElementById("bike-activities-table");
    if (!el) return;

    const rows = rides
        .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
        .map(a => {

            // --- safe base values ---
            const distance = a.distance || 0; // meters
            const movingTime = a.moving_time || 0;
            const elapsedTime = a.elapsed_time || 0;
            const elevation = a.total_elevation_gain || 0;

            const km = distance / 1000;

            // --- speed (km/h) ---
            const speed = movingTime > 0
                ? km / (movingTime / 3600)
                : 0;

            // --- moving ratio ---
            const ratio = elapsedTime > 0
                ? Math.min(movingTime / elapsedTime, 1)
                : 1;

            // --- difficulty (distance + elevation weight) ---
            const difficulty = km + 2.85 * (elevation / 100);

            // --- elevation per km ---
            const elevPerKmValue = km > 0
                ? elevation / km
                : 0;

            const elevPerKmDisplay = km > 0
                ? elevPerKmValue.toFixed(1)
                : "-";

            // --- activity link ---
            const safeName = escapeHTML(a.name || "Untitled");

            const activityLink = a.id
                ? `<a href="html/activity-router.html?id=${encodeURIComponent(a.id)}" target="_blank" rel="noopener noreferrer">${safeName}</a>`
                : safeName;

            // --- date ---
            const date = a.start_date_local
                ? a.start_date_local.substring(0, 10)
                : "-";

            // --- elapsed time formatting ---
            const elapsedH = Math.floor(elapsedTime / 3600);
            const elapsedM = Math.floor((elapsedTime % 3600) / 60);

            const elapsedStr = elapsedH > 0
                ? `${elapsedH}h ${String(elapsedM).padStart(2, '0')}m`
                : `${elapsedM}m`;

            return `
            <tr>
                <td>${date}</td>
                <td>${activityLink}</td>
                <td>${bikeTypeBadge(a)}</td>

                <td data-value="${km}">${km.toFixed(1)}</td>
                <td data-value="${elevation}">${elevation}</td>
                <td data-value="${elevPerKmValue}">${elevPerKmDisplay}</td>

                <td data-value="${speed}">${speed.toFixed(1)}</td>
                <td data-value="${difficulty}">${difficulty.toFixed(1)}</td>

                <td data-value="${a.average_watts ?? 0}">
                    ${a.average_watts != null ? `${a.average_watts} W` : '-'}
                </td>

                <td data-value="${ratio}">${(ratio * 100).toFixed(0)}%</td>
                <td data-value="${elapsedTime}">${elapsedStr}</td>
            </tr>
            `;
        })
        .join("");

    el.innerHTML = `
        <table id="bike-all-table" style="width: 100%; border-collapse: collapse; margin-top: 2rem; border: 1px solid rgba(46, 125, 50, 0.25); border-radius: 10px; overflow: hidden;">
            <thead>
                <tr style="background: #2e7d32; color: #fff;">
                    <th data-sort="date" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Date</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Activity</th>
                    <th data-sort="text" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Type</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">km</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Elev (m)</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Elev/km</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">km/h</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Difficulty</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Power</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Ratio</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Elapsed</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;

    makeSortable(document.getElementById('bike-all-table'));
}


// --- basic HTML escape (prevents XSS in names) ---
function escapeHTML(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}



export function renderConsistencyChart(rides, dateFilterFrom = null, dateFilterTo = null) {
    const container = document.getElementById('cal-heatmap-bike');
    if (!container) return;

    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.display = 'flex';
    container.style.justifyContent = 'center'; // CENTRAR
    container.style.alignItems = 'flex-start'; // alineación vertical al top

    // Wrapper interno para mantener la anchura del heatmap
    const heatmapWrapper = document.createElement('div');
    heatmapWrapper.style.display = 'inline-block';
    container.appendChild(heatmapWrapper);

    // Verificar disponibilidad de CalHeatmap
    if (typeof CalHeatmap === 'undefined') {
        heatmapWrapper.innerHTML = `<p style="text-align:center; color:#8c8c8c;">
            Heatmap no disponible en este dispositivo o navegador.
        </p>`;
        return;
    }

    // Agregar datos y calcular umbrales
    const safeRides = rides || [];
    const aggregatedData = safeRides.reduce((acc, act) => {
        const date = act.start_date_local.substring(0, 10);
        acc[date] = (acc[date] || 0) + (act.moving_time ? act.moving_time / 3600 : 0);
        return acc;
    }, {});

    const durationValues = Object.values(aggregatedData)
        .filter(v => v > 0)
        .sort((a, b) => a - b);

    const thresholds = durationValues.length >= 6
        ? [
            durationValues[Math.floor(0.1 * durationValues.length)],
            durationValues[Math.floor(0.25 * durationValues.length)],
            durationValues[Math.floor(0.45 * durationValues.length)],
            durationValues[Math.floor(0.6 * durationValues.length)],
            durationValues[Math.floor(0.75 * durationValues.length)],
            durationValues[Math.floor(0.9 * durationValues.length)]
        ]
        : [0.5, 1, 1.75, 2.75, 4, 6]; // horas

    const cal = new CalHeatmap();
    const today = new Date();
    const hasManualFilters = Boolean(dateFilterFrom || dateFilterTo);
    const periodStart = hasManualFilters
        ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 364)
        : new Date(today.getFullYear(), 0, 1);
    const periodEnd = hasManualFilters
        ? today
        : new Date(today.getFullYear(), 11, 31);

    const dayOfWeek = periodStart.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7;
    const firstMonday = new Date(periodStart);
    firstMonday.setDate(periodStart.getDate() + daysUntilMonday);

    const monthRange = hasManualFilters
        ? ((periodEnd.getFullYear() - firstMonday.getFullYear()) * 12 + (periodEnd.getMonth() - firstMonday.getMonth()) + 1)
        : 12;

    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    function markTodayCell() {
        const dayCells = heatmapWrapper.querySelectorAll('[data-day]');
        dayCells.forEach(cell => {
            const title = cell.getAttribute('title') || '';
            const ariaLabel = cell.getAttribute('aria-label') || '';
            const dataDate = cell.getAttribute('data-date') || '';
            const dateText = `${title} ${ariaLabel} ${dataDate}`;
            if (!dateText.includes(todayIso)) return;

            cell.style.outline = '2px solid #111';
            cell.style.outlineOffset = '1px';
            if (!cell.querySelector('.today-marker-x')) {
                const mark = document.createElement('span');
                mark.className = 'today-marker-x';
                mark.textContent = 'X';
                mark.style.position = 'absolute';
                mark.style.inset = '0';
                mark.style.display = 'flex';
                mark.style.alignItems = 'center';
                mark.style.justifyContent = 'center';
                mark.style.fontSize = '8px';
                mark.style.fontWeight = '700';
                mark.style.color = '#111';
                mark.style.pointerEvents = 'none';
                cell.style.position = 'relative';
                cell.appendChild(mark);
            }
        });
    }

    cal.paint({
        itemSelector: heatmapWrapper, // usamos wrapper
        domain: {
            type: 'month',
            gutter: 4,
            label: { text: 'MMM', textAlign: 'center', position: 'top' } // centrado
        },
        subDomain: {
            type: 'day',
            width: 11,
            height: 11,
            gutter: 2,
            radius: 2,
            label: null
        },
        date: { start: firstMonday, locale: { weekStart: 1 } },
        range: Math.max(1, monthRange),
        data: {
            source: Object.entries(aggregatedData).map(([date, value]) => ({
                date,
                value
            })),
            type: 'json',
            x: 'date',
            y: 'value'
        },
        scale: {
            color: {
                type: 'threshold',
                range: [
                    '#bbf7d0',  // verde claro visible
                    '#86efac',
                    '#4ade80',
                    '#22c55e',
                    '#16a34a',
                    '#15803d',
                    '#166534'
                ],
                domain: thresholds
            }
        }
    });

    // Agregar etiquetas de días de la semana (solo primera columna)
    setTimeout(() => {
        markTodayCell();

        const weekdayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
        const firstColumn = heatmapWrapper.querySelector('[data-week="1"]');

        if (firstColumn) {
            const days = firstColumn.querySelectorAll('[data-day]');
            days.forEach((day, idx) => {
                if (weekdayLabels[idx]) {
                    const label = document.createElement('span');
                    label.textContent = weekdayLabels[idx];
                    label.style.position = 'absolute';
                    label.style.left = '-12px';
                    label.style.fontSize = '9px';
                    label.style.color = '#767676';
                    day.style.position = 'relative';
                    day.appendChild(label);
                }
            });
        }
    }, 100);
}

export function renderAccumulatedDistanceChart(rides) {
    if (!rides || rides.length === 0) return;

    // 1. Aggregate distance per day (YYYY-MM-DD)
    const distanceByDay = rides.reduce((acc, act) => {
        const date = act.start_date_local.substring(0, 10);
        acc[date] = (acc[date] || 0) + (act.distance ? act.distance / 1000 : 0);
        return acc;
    }, {});

    // 2. Get all days from first to last activity
    const allDays = Object.keys(distanceByDay).sort();
    const startDate = new Date(allDays[0]);
    const endDate = new Date(allDays[allDays.length - 1]);
    const days = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
    }

    // 3. Build daily distances (0 for days without activity)
    const dailyDistances = days.map(date => distanceByDay[date] || 0);

    // 4. Compute accumulated distance
    const accumulated = [];
    dailyDistances.reduce((acc, d, i) => accumulated[i] = acc + d, 0);

    createChart('bike-accumulated-distance-chart', {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Accumulated Distance (km)',
                data: accumulated,
                borderColor: '#2e7d32',
                backgroundColor: 'rgba(46,125,50,0.1)',
                fill: true,
                pointRadius: 0,
                tension: 0.1
            }]
        },
        options: { scales: { y: { title: { display: true, text: 'Distance (km)' } } } }
    });
}

export function renderWeeklyDistanceTrendChart(rides, rollingWindowWeeks = 26) {
    if (!rides || rides.length === 0) return;

    const weeklyData = rides.reduce((acc, ride) => {
        const date = new Date(ride.start_date_local);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay() + 1); // Monday
        const weekKey = weekStart.toISOString().slice(0, 10);
        if (!acc[weekKey]) acc[weekKey] = { distance: 0, time: 0 };
        acc[weekKey].distance += (ride.distance || 0) / 1000;
        acc[weekKey].time += ride.moving_time || 0;
        return acc;
    }, {});
    const labels = Object.keys(weeklyData).sort();
    const weeklyKm = labels.map(k => weeklyData[k].distance);
    const weeklySpeed = labels.map(k => {
        const d = weeklyData[k];
        return d.time > 0 ? d.distance / (d.time / 3600) : 0;
    });
    const rolling = utils.rollingMean(weeklyKm, rollingWindowWeeks).map(v => +v.toFixed(2));
    const rollingSpeed = utils.rollingMean(weeklySpeed, rollingWindowWeeks).map(v => +v.toFixed(2));

    // Convert weeks to human-readable label
    const windowLabel = rollingWindowWeeks >= 52 ? '1 year'
        : rollingWindowWeeks >= 26 ? '6 months'
            : rollingWindowWeeks >= 12 ? '3 months'
                : '1 month';

    createChart('bike-weekly-distance-trend-chart', {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Weekly distance (km)',
                    data: weeklyKm,
                    type: 'bar',
                    yAxisID: 'y',
                    backgroundColor: 'rgba(46,125,50,0.20)',
                    borderColor: 'rgba(46,125,50,0.35)',
                    borderWidth: 1,
                    hidden: true,
                    order: 2
                },
                {
                    label: `Rolling mean (${windowLabel})`,
                    data: rolling,
                    type: 'line',
                    yAxisID: 'y',
                    borderColor: '#2e7d32',
                    backgroundColor: 'rgba(46,125,50,0.18)',
                    pointRadius: 0,
                    borderWidth: 4,
                    tension: 0.25,
                    order: 1
                },
                {
                    label: 'Rolling mean speed (km/h)',
                    data: rollingSpeed,
                    type: 'line',
                    yAxisID: 'ySpeed',
                    borderColor: '#d32f2f',
                    backgroundColor: 'rgba(211,47,47,0.18)',
                    pointRadius: 0,
                    borderWidth: 4,
                    tension: 0.25,
                    order: 1,
                    hidden: true
                }
            ]
        },
        plugins: [createHtmlLegendOverlayPlugin('bike-weekly-distance-trend-chart')],
        options: {
            layout: {
                padding: { bottom: 28 }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: { title: { display: true } },
                y: { title: { display: true, text: 'Distance (km)' } },
                ySpeed: {
                    display: 'auto',
                    position: 'right',
                    title: { display: true, text: 'Speed (km/h)' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });

    utils.upsertChartInfo('bike-weekly-distance-trend-chart', {
        title: 'Weekly trend, in short',
        bodyHtml: `Bars are the weekly totals and the solid line is the rolling mean over the selected window.<br>
           It helps separate one-off spikes from the underlying training trend.`,
        accentColor: '#2e7d32'
    });
}

function getBikeMilestoneLabels() {
    return new Map([
        [25, '25K E25'],
        [50, '50K E50'],
        [75, '75K E75'],
        [100, '100K E100'],
        [150, '150K E150'],
        [200, '200K E200']
    ]);
}

function attachBikeEddingtonInfo(canvasId, eddington, variant) {
    const current = eddington.summary.current;
    const recentWindow = eddington.summary.recentWindowDays;
    const projectionCount = eddington.summary.projectionCount;
    let bodyHtml;
    if (variant === 'weekly') {
        const multiplier = attachBikeEddingtonInfo._multiplier || 2;
        bodyHtml = `Current value: <strong>E${current}</strong> weekly (×${multiplier}).<br>
           E${current} means <strong>${current} different weeks</strong> with at least
           <strong>${current * multiplier} km</strong> total each week.<br>
           The dashed line projects the next <strong>${projectionCount}</strong> E values
           using your last <strong>${recentWindow}</strong> days of activity.`;
    } else if (variant === 'distribution') {
        bodyHtml = `Current value: <strong>E${current}</strong>.<br>
           A bike Eddington of 75 means <strong>75 different days</strong> with at least <strong>75 km</strong> each.<br>
           The bars count qualifying days; the solid line shows <strong>active days</strong> needed to reach each E.<br>
           The dashed continuation projects only the next <strong>${projectionCount}</strong> E values, using your last <strong>${recentWindow}</strong> days of activity.`;
    } else {
        bodyHtml = `Current value: <strong>E${current}</strong>.<br>
           The 50K, 75K or 200K markers only appear after reaching E50, E75 or E200.<br>
           A single 200 km ride does <strong>not</strong> create the E200 milestone.`;
    }

    utils.upsertChartInfo(canvasId, {
        title: 'How milestones work',
        bodyHtml,
        accentColor: '#2e7d32'
    });
}

export function renderEddingtonDistributionChart(rides) {
    if (!rides || rides.length === 0) return;

    const eddington = utils.buildEddingtonSeries(rides, ride => (ride.distance || 0) / 1000, { unitStep: 1 });
    if (!eddington.distributionSeries.length) return;

    createChart('bike-eddington-distribution-chart', {
        type: 'bar',
        data: {
            labels: eddington.distributionSeries.map(point => String(point.threshold)),
            datasets: [
                {
                    label: 'Days >= E km',
                    data: eddington.distributionSeries.map(point => point.qualifyingDays),
                    backgroundColor: 'rgba(46, 125, 50, 0.65)',
                    borderColor: '#2e7d32',
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    label: 'Days needed',
                    data: eddington.distributionSeries.map(point => point.activeDaysNeeded),
                    type: 'line',
                    borderColor: '#166534',
                    backgroundColor: 'rgba(22, 101, 52, 0.18)',
                    spanGaps: true,
                    tension: 0.25,
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    yAxisID: 'y1'
                },
                {
                    label: 'Projected days needed',
                    data: eddington.distributionSeries.map(point => point.projectedActiveDaysNeeded),
                    type: 'line',
                    borderColor: '#166534',
                    backgroundColor: 'transparent',
                    borderDash: [6, 6],
                    spanGaps: true,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const point = eddington.distributionSeries[context.dataIndex];
                            if (context.datasetIndex === 0) {
                                return `${point.qualifyingDays} days at ${point.threshold} km or more`;
                            }
                            if (context.datasetIndex === 1 && point.activeDaysNeeded == null) {
                                return `E${point.threshold} not reached yet`;
                            }
                            if (context.datasetIndex === 1) {
                                return `${point.activeDaysNeeded} active days to reach E${point.threshold} (${point.daysNeeded} calendar days)`;
                            }
                            if (point.projectedActiveDaysNeeded == null) {
                                return `No projection for E${point.threshold} yet`;
                            }
                            return `Projection: about ${point.projectedActiveDaysNeeded} active days to reach E${point.threshold}`;
                        }
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Eddington number (km)' } },
                y: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Qualifying days' }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: { display: true, text: 'Active days needed' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });

    attachBikeEddingtonInfo('bike-eddington-distribution-chart', eddington, 'distribution');
}

export function renderEddingtonProgressionChart(rides) {
    if (!rides || rides.length === 0) return;

    const eddington = utils.buildEddingtonSeries(rides, ride => (ride.distance || 0) / 1000, { unitStep: 1 });
    if (!eddington.achievementSeries.length) return;

    const milestoneLabels = getBikeMilestoneLabels();
    const milestoneData = eddington.achievementSeries
        .filter(point => milestoneLabels.has(point.threshold))
        .map(point => ({ x: point.date, y: point.threshold, label: milestoneLabels.get(point.threshold) }));

    createChart('bike-eddington-progression-chart', {
        type: 'line',
        data: {
            labels: eddington.achievementSeries.map(point => point.date),
            datasets: [
                {
                    label: 'Eddington reached',
                    data: eddington.achievementSeries.map(point => point.threshold),
                    borderColor: '#2e7d32',
                    backgroundColor: 'rgba(46, 125, 50, 0.18)',
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    tension: 0.15,
                    fill: false
                },
                {
                    label: 'Milestones',
                    type: 'scatter',
                    data: milestoneData,
                    borderColor: '#166534',
                    backgroundColor: '#166534',
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointStyle: 'rectRot',
                    showLine: false
                }
            ]
        },
        options: {
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        title(items) {
                            return items[0]?.label || '';
                        },
                        label(context) {
                            if (context.datasetIndex === 1) {
                                return `${context.raw.label}. Reached when you had ${context.raw.y} days of at least ${context.raw.y} km.`;
                            }
                            return `Reached E${context.raw} on ${context.label}`;
                        }
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Achievement date' } },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Eddington number (km)' }
                }
            }
        }
    });

    attachBikeEddingtonInfo('bike-eddington-progression-chart', eddington, 'progression');
}

function _drawBikeEddingtonCharts(rides, mode) {
    const distId = 'bike-eddington-distribution-chart';
    const progId = 'bike-eddington-progression-chart';
    const isWeekly = mode !== 'daily';
    const multiplier = isWeekly ? parseInt(mode.split('-')[1]) : 1;
    const unit = isWeekly ? 'weeks' : 'days';

    let eddington;
    if (isWeekly) {
        const weekly = utils.aggregateByWeek(rides, r => (r.distance || 0) / 1000);
        const pseudo = weekly.map(w => ({
            start_date_local: w.start_date_local,
            distance: (w.total / multiplier) * 1000
        }));
        eddington = utils.buildEddingtonSeries(pseudo, a => a.distance / 1000, { unitStep: 1 });
    } else {
        eddington = utils.buildEddingtonSeries(rides, r => (r.distance || 0) / 1000, { unitStep: 1 });
    }

    if (eddington.distributionSeries.length) {
        createChart(distId, {
            type: 'bar',
            data: {
                labels: eddington.distributionSeries.map(p => String(p.threshold)),
                datasets: [
                    {
                        label: isWeekly ? `Weeks ≥ E×${multiplier} km` : 'Days >= E km',
                        data: eddington.distributionSeries.map(p => p.qualifyingDays),
                        backgroundColor: 'rgba(46, 125, 50, 0.65)',
                        borderColor: '#2e7d32',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: isWeekly ? 'Weeks needed' : 'Days needed',
                        data: eddington.distributionSeries.map(p => p.activeDaysNeeded),
                        type: 'line',
                        borderColor: '#166534',
                        backgroundColor: 'rgba(22, 101, 52, 0.18)',
                        spanGaps: true, tension: 0.25, pointRadius: 2, pointHoverRadius: 4,
                        yAxisID: 'y1'
                    },
                    {
                        label: isWeekly ? 'Projected weeks needed' : 'Projected days needed',
                        data: eddington.distributionSeries.map(p => p.projectedActiveDaysNeeded),
                        type: 'line',
                        borderColor: '#166534', backgroundColor: 'transparent',
                        borderDash: [6, 6], spanGaps: true, tension: 0.2,
                        pointRadius: 0, pointHoverRadius: 4,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                const p = eddington.distributionSeries[context.dataIndex];
                                if (context.datasetIndex === 0) {
                                    return isWeekly
                                        ? `${p.qualifyingDays} weeks with ≥ ${(p.threshold * multiplier).toFixed(0)} km total`
                                        : `${p.qualifyingDays} days at ${p.threshold} km or more`;
                                }
                                if (context.datasetIndex === 1 && p.activeDaysNeeded == null) return `E${p.threshold} not reached yet`;
                                if (context.datasetIndex === 1) return `${p.activeDaysNeeded} active ${unit} to reach E${p.threshold} (${p.daysNeeded} calendar days)`;
                                if (p.projectedActiveDaysNeeded == null) return `No projection for E${p.threshold} yet`;
                                return `Projection: about ${p.projectedActiveDaysNeeded} active ${unit} to reach E${p.threshold}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { title: { display: true, text: isWeekly ? `Weekly Eddington (×${multiplier}, km/week)` : 'Eddington number (km)' } },
                    y: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: isWeekly ? 'Qualifying weeks' : 'Qualifying days' } },
                    y1: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: isWeekly ? 'Active weeks needed' : 'Active days needed' }, grid: { drawOnChartArea: false } }
                }
            }
        });
        attachBikeEddingtonInfo._multiplier = multiplier;
        attachBikeEddingtonInfo(distId, eddington, isWeekly ? 'weekly' : 'distribution');
    }

    if (eddington.achievementSeries.length) {
        const milestoneLabels = isWeekly ? null : getBikeMilestoneLabels();
        const milestoneData = milestoneLabels
            ? eddington.achievementSeries.filter(p => milestoneLabels.has(p.threshold)).map(p => ({ x: p.date, y: p.threshold, label: milestoneLabels.get(p.threshold) }))
            : [];
        const datasets = [
            {
                label: isWeekly ? 'Weekly Eddington reached' : 'Eddington reached',
                data: eddington.achievementSeries.map(p => p.threshold),
                borderColor: '#2e7d32',
                backgroundColor: 'rgba(46, 125, 50, 0.18)',
                pointRadius: 2, pointHoverRadius: 4, tension: 0.15, fill: false
            }
        ];
        if (!isWeekly && milestoneData.length) {
            datasets.push({
                label: 'Milestones', type: 'scatter', data: milestoneData,
                borderColor: '#166534', backgroundColor: '#166534',
                pointRadius: 5, pointHoverRadius: 7, pointStyle: 'rectRot', showLine: false
            });
        }
        createChart(progId, {
            type: 'line',
            data: { labels: eddington.achievementSeries.map(p => p.date), datasets },
            options: {
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            title(items) { return items[0]?.label || ''; },
                            label(context) {
                                if (context.datasetIndex === 1) return `${context.raw.label}. Reached when you had ${context.raw.y} days of at least ${context.raw.y} km.`;
                                const suffix = isWeekly ? ` (≥ ${(context.raw * multiplier).toFixed(0)} km/week)` : '';
                                return `Reached E${context.raw}${suffix} on ${context.label}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { title: { display: true, text: 'Achievement date' } },
                    y: { beginAtZero: true, title: { display: true, text: isWeekly ? `Weekly Eddington (×${multiplier})` : 'Eddington number (km)' } }
                }
            }
        });
        attachBikeEddingtonInfo._multiplier = multiplier;
        attachBikeEddingtonInfo(progId, eddington, isWeekly ? 'weekly' : 'progression');
    }
}

export function renderEddingtonSection(rides) {
    const selectorEl = document.getElementById('bike-eddington-mode-selector');
    function getMode() {
        return selectorEl?.querySelector('.eddington-mode-btn.active')?.dataset.mode || 'daily';
    }
    if (selectorEl) {
        selectorEl._rides = rides;
        if (!selectorEl.dataset.bound) {
            selectorEl.querySelectorAll('.eddington-mode-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectorEl.querySelectorAll('.eddington-mode-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    _drawBikeEddingtonCharts(selectorEl._rides, btn.dataset.mode);
                });
            });
            selectorEl.dataset.bound = 'true';
        }
    }
    _drawBikeEddingtonCharts(rides, getMode());
}
