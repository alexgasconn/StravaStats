// js/swim-analysis.js
import * as utils from './utils.js';

let charts = {};

// ------------------------
// SWIM TYPE & COLORS
// ------------------------

const swimColors = {
    pool: "#56b5f8",
    openwater: "#3204d4"
};

function getSwimType(a) {
    if (a.trainer === true) return "pool";
    if (a.start_latlng?.length === 2) return "openwater";
    return "pool";
}

function paceSecPer100m(act) {
    if (!act.distance || !act.moving_time) return null;
    return act.moving_time / (act.distance / 100);
}

function paceMinPer100m(act) {
    const sec = paceSecPer100m(act);
    if (!sec) return null;
    return sec / 60;
}

function getSwimPaceMinPer100m(swim) {
    if (swim?.pace_min100 && Number.isFinite(swim.pace_min100)) return swim.pace_min100;
    if (!swim?.distance || !swim?.moving_time) return null;
    return (swim.moving_time / 60) / (swim.distance / 100);
}

function getSwimEfficiency(swim) {
    return swim?.efficiency ?? null;
}



// ------------------------
// POOL / YARD LENGTH ESTIMATION
// ------------------------

const POOL_LENGTHS = [20, 25, 50, "25yd", "50yd"];

// Tiempo realista por largo (segundos)
function realisticLengthTime(poolLength, timePerLength) {
    switch (poolLength) {
        case 20: return timePerLength >= 15 && timePerLength <= 35;
        case 25: return timePerLength >= 18 && timePerLength <= 45;
        case 50: return timePerLength >= 35 && timePerLength <= 120;
        case "25yd": return timePerLength >= 15 && timePerLength <= 40;
        case "50yd": return timePerLength >= 35 && timePerLength <= 120;
        default: return false;
    }
}

function estimatePoolLength(activity, historicalCounts = {}) {
    if (!activity.distance || !activity.moving_time) return null;

    // candidatos divisibles
    let candidates = POOL_LENGTHS.filter(p => {
        if (typeof p === "number") return activity.distance % p === 0;
        if (p === "25yd") return activity.distance % 23 === 0; // aprox 25yd en metros
        if (p === "50yd") return activity.distance % 46 === 0; // aprox 50yd en metros
        return false;
    });

    if (!candidates.length) return null;

    // filtrar por tiempo por largo realista
    candidates = candidates.filter(p => {
        const lengths = activity.distance / (typeof p === "number" ? p : (p === "25yd" ? 23 : 46));
        const timePerLength = activity.moving_time / lengths;
        return realisticLengthTime(p, timePerLength);
    });

    if (candidates.length === 1) return candidates[0];

    if (candidates.length > 1) {
        // usar frecuencia histórica
        candidates.sort((a, b) => (historicalCounts[b] || 0) - (historicalCounts[a] || 0));
        return candidates[0];
    }

    return null; // ninguno válido
}




// ------------------------
// MAIN ENTRY
// ------------------------

export function renderSwimAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, rollingWindowWeeks = 26) {

    const filteredActivities =
        utils.filterActivitiesByDate(allActivities, dateFilterFrom, dateFilterTo);

    const swims = filteredActivities.filter(a =>
        a.type === "Swim" ||
        a.sport_type === "Swim" ||
        a.sport_type === "PoolSwim" ||
        a.sport_type === "OpenWaterSwim"
    );

    console.log("Rendering swim analysis for", swims.length, "swims");

    if (!swims.length) return;

    // calcular frecuencias de longitudes en todo el dataset
    const historicalCounts = { 20: 0, 25: 0, 50: 0, "25yd": 0, "50yd": 0 };

    swims.forEach(a => {

        if (getSwimType(a) !== "pool") return;

        const candidates = POOL_LENGTHS.filter(p => a.distance && a.distance % p === 0);

        if (candidates.length === 1) {
            historicalCounts[candidates[0]]++;
        }

    });

    const enriched = swims.map(a => {

        const swimType = getSwimType(a);

        const poolLength =
            swimType === "pool"
                ? estimatePoolLength(a, historicalCounts)
                : null;

        return {
            ...a,
            distance_km: a.distance ? a.distance / 1000 : 0,
            pace_sec100: paceSecPer100m(a),
            pace_min100: paceMinPer100m(a),
            swim_type: swimType,
            moving_ratio: a.elapsed_time ? (a.moving_time || 0) / a.elapsed_time : 1,
            pool_length: poolLength
        };
    });

    renderSummaryCards(enriched);
    renderPoolVsOpenWaterSummary(enriched);

    renderDistanceHistogram(enriched);
    renderPaceHistogram(enriched);

    renderPaceVsDistanceChart(enriched);
    renderPaceHrCurveChart(enriched);
    renderVolumeImprovementChart(enriched);
    renderEfficiencyEvolutionChart(enriched);

    renderTopSwims(enriched);
    renderSwimsTable(enriched);

    renderConsistencyChart(enriched, dateFilterFrom, dateFilterTo);

    renderPoolLengthChart(enriched);

    renderAccumulatedDistanceChart(enriched);
    renderWeeklyDistanceTrendChart(enriched, rollingWindowWeeks);
    renderEddingtonSection(enriched);
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
    headers.forEach((th, colIdx) => {
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.addEventListener('click', () => {
            const tbody = table.querySelector('tbody');
            if (!tbody) return;
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const type = th.dataset.sort; // num, text, pace, date
            const currentDir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
            // Reset all headers
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

    if (charts[canvasId]) charts[canvasId].destroy();

    // Use container-defined heights so charts remain stable across desktop/mobile.
    if (!config.options) config.options = {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;

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
    if (label === 'Rolling mean pace (min/km)') return 2;
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

function renderSummaryCards(swims) {

    const el = document.getElementById("swim-summary-cards");
    if (!el) return;

    const totalDistance =
        swims.reduce((s, a) => s + a.distance_km, 0);

    const totalTime =
        swims.reduce((s, a) => s + (a.moving_time || 0), 0);

    const avgPaceMin =
        swims.filter(a => a.pace_min100)
            .reduce((s, a) => s + a.pace_min100, 0) /
        Math.max(1, swims.filter(a => a.pace_min100).length);

    el.innerHTML = `
        <div class="card"><h3>Swims</h3><p>${swims.length}</p></div>
        <div class="card"><h3>Total Distance</h3><p>${totalDistance.toFixed(1)} km</p></div>
        <div class="card"><h3>Total Time</h3><p>${(totalTime / 3600).toFixed(1)} h</p></div>
        <div class="card"><h3>Avg Pace</h3><p>${utils.formatPaceSwim(avgPaceMin * 60)}</p></div>
    `;
}

function formatPace(paceMin100) {
    if (!paceMin100) return "-";
    return utils.formatPace(paceMin100 * 60, 1).replace(' /km', '');
}


function poolBadge(poolLength) {

    if (poolLength === 20)
        return `<span class="pool-badge pool-20">20m</span>`;

    if (poolLength === 25)
        return `<span class="pool-badge pool-25">25m</span>`;

    if (poolLength === 50)
        return `<span class="pool-badge pool-50">50m</span>`;

    return `<span class="pool-badge pool-unknown">-</span>`;
}

function poolLengthInt(poolLength) {
    const parsed = Number.parseInt(poolLength, 10);
    return Number.isFinite(parsed) ? String(parsed) : '-';
}

// ------------------------
// POOL VS OPEN WATER SUMMARY
// ------------------------

function renderPoolVsOpenWaterSummary(swims) {
    const el = document.getElementById("swim-pool-open-summary");
    if (!el) return;

    const pool = swims.filter(s => s.swim_type === "pool");
    const ow = swims.filter(s => s.swim_type === "openwater");

    function agg(arr) {
        const count = arr.length;

        const dist = arr.reduce((s, a) => s + (a.distance_km || 0), 0);
        const avgDist = count ? dist / count : 0;
        const avgPace = arr.filter(a => a.pace_min100 != null)
            .reduce((s, a) => s + a.pace_min100, 0) / Math.max(1, arr.filter(a => a.pace_min100 != null).length);
        const avgHr = arr.filter(a => a.average_heartrate != null)
            .reduce((s, a) => s + a.average_heartrate, 0) / Math.max(1, arr.filter(a => a.average_heartrate != null).length);
        const tempVals = arr.filter(a => a.average_temp != null);
        const avgTemp = tempVals.reduce((s, a) => s + a.average_temp, 0) / Math.max(1, tempVals.length);

        return { dist, count, avgPace, avgHr, avgDist, avgTemp };
    }

    const poolAgg = agg(pool);
    const owAgg = agg(ow);

    el.innerHTML = `
        <table class="compact-table">
            <thead>
                <tr>
                    <th></th>
                    <th>Pool</th>
                    <th>Open Water</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Sessions</td>
                    <td>${poolAgg.count}</td>
                    <td>${owAgg.count}</td>
                </tr>
                <tr>
                    <td>Distance total (km)</td>
                    <td>${poolAgg.dist.toFixed(1)}</td>
                    <td>${owAgg.dist.toFixed(1)}</td>
                </tr>
                <tr>
                    <td>Avg pace (/100m)</td>
                    <td>${poolAgg.count ? formatPace(poolAgg.avgPace) : "-"}</td>
                    <td>${owAgg.count ? formatPace(owAgg.avgPace) : "-"}</td>
                </tr>
                <tr>
                    <td>Avg HR</td>
                    <td>${isFinite(poolAgg.avgHr) ? poolAgg.avgHr.toFixed(0) : "-"}</td>
                    <td>${isFinite(owAgg.avgHr) ? owAgg.avgHr.toFixed(0) : "-"}</td>
                </tr>
                <tr>
                    <td>Avg Distance (km)</td>
                    <td>${poolAgg.count ? poolAgg.avgDist.toFixed(1) : "-"}</td>
                    <td>${owAgg.count ? owAgg.avgDist.toFixed(1) : "-"}</td>
                </tr>
                <tr>
                    <td>Avg Temp (°C)</td>
                    <td>${isFinite(poolAgg.avgTemp) ? poolAgg.avgTemp.toFixed(1) : "-"}</td>
                    <td>${isFinite(owAgg.avgTemp) ? owAgg.avgTemp.toFixed(1) : "-"}</td>
                </tr>

            </tbody>
        </table>
    `;
}

// ------------------------
// HISTOGRAMS
// ------------------------

function renderDistanceHistogram(swims) {

    const binSize = 0.2;

    const distances = swims.map(s => s.distance_km);
    if (!distances.length) return;

    const max = Math.max(...distances, 0);
    const binCount = Math.ceil(max / binSize);

    const binsPool = new Array(binCount).fill(0);
    const binsOW = new Array(binCount).fill(0);

    swims.forEach(s => {

        const idx = Math.min(Math.floor(s.distance_km / binSize), binCount - 1);
        if (idx >= binCount) return;

        if (s.swim_type === "pool") binsPool[idx]++;
        if (s.swim_type === "openwater") binsOW[idx]++;

    });

    createChart("swim-distance-histogram", {
        type: "bar",
        data: {
            labels: new Array(binCount).fill(0).map((_, i) =>
                `${(i * binSize).toFixed(1)}–${((i + 1) * binSize).toFixed(1)} km`
            ),
            datasets: [
                {
                    label: "Pool",
                    data: binsPool,
                    backgroundColor: swimColors.pool
                },
                {
                    label: "Open Water",
                    data: binsOW,
                    backgroundColor: swimColors.openwater
                }
            ]
        },
        options: {
            plugins: { legend: { display: true } }
        }
    });
}

function renderPaceHistogram(swims) {

    const poolPaces = swims
        .filter(s => s.swim_type === "pool" && s.pace_min100 && isFinite(s.pace_min100))
        .map(s => s.pace_min100);

    const openwaterPaces = swims
        .filter(s => s.swim_type === "openwater" && s.pace_min100 && isFinite(s.pace_min100))
        .map(s => s.pace_min100);

    const allPaces = [...poolPaces, ...openwaterPaces];
    if (!allPaces.length) return;

    const binSize = 0.05; // 3s aprox
    const max = Math.max(...allPaces, 0);
    const min = Math.min(...allPaces, max);
    const binCount = Math.ceil((max - min) / binSize);

    const binsPool = new Array(binCount).fill(0);
    const binsOW = new Array(binCount).fill(0);

    poolPaces.forEach(p => {
        const idx = Math.floor((p - min) / binSize);
        if (binsPool[idx] !== undefined) binsPool[idx]++;
    });

    openwaterPaces.forEach(p => {
        const idx = Math.floor((p - min) / binSize);
        if (binsOW[idx] !== undefined) binsOW[idx]++;
    });

    createChart("swim-pace-histogram", {
        type: "bar",
        data: {
            labels: binsPool.map((_, i) => {
                const from = min + i * binSize;
                const to = min + (i + 1) * binSize;
                return `${formatPace(from)}–${formatPace(to)}`;
            }),
            datasets: [
                {
                    label: "Pool",
                    data: binsPool,
                    backgroundColor: swimColors.pool
                },
                {
                    label: "Open Water",
                    data: binsOW,
                    backgroundColor: swimColors.openwater
                }
            ]
        },
        options: {
            plugins: { legend: { display: true } },
            scales: { x: { ticks: { maxRotation: 90, minRotation: 45 } } }
        }
    });
}


// ------------------------
// SCATTERS
// ------------------------

function renderPaceVsDistanceChart(swims) {

    const pool = swims
        .filter(s => s.swim_type === "pool" && s.distance_km > 0 && s.pace_min100)
        .map(s => ({
            x: s.distance_km,
            y: s.pace_min100
        }));

    const openwater = swims
        .filter(s => s.swim_type === "openwater" && s.distance_km > 0 && s.pace_min100)
        .map(s => ({
            x: s.distance_km,
            y: s.pace_min100
        }));

    createChart("swim-pace-distance-chart", {
        type: "scatter",
        data: {
            datasets: [
                {
                    label: "Pool",
                    data: pool,
                    backgroundColor: swimColors.pool
                },
                {
                    label: "Open Water",
                    data: openwater,
                    backgroundColor: swimColors.openwater
                }
            ]
        },
        options: {
            scales: {
                x: { title: { display: true, text: "Distance (km)" } },
                y: { title: { display: true, text: "Pace (min/100m)" } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const d = ctx.raw.x.toFixed(2);
                            const p = formatPace(ctx.raw.y);
                            return `Distance: ${d} km | Pace: ${p}/100m`;
                        }
                    }
                }
            }
        }
    });
}

export function renderPaceHrCurveChart(swims) {
    const validSwims = swims.filter(s =>
        s.average_heartrate &&
        Number.isFinite(getSwimPaceMinPer100m(s)) &&
        getSwimPaceMinPer100m(s) > 0
    );
    if (validSwims.length < 6) return;

    const sortedSwims = [...validSwims].sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));
    const third = Math.max(1, Math.floor(sortedSwims.length * 0.33));
    const earlySwims = sortedSwims.slice(0, third);
    const lateSwims = sortedSwims.slice(-third);

    const binSize = 5;
    const minHr = Math.min(...validSwims.map(s => s.average_heartrate));
    const maxHr = Math.max(...validSwims.map(s => s.average_heartrate));
    const minBin = Math.floor(minHr / binSize) * binSize;
    const maxBin = Math.ceil(maxHr / binSize) * binSize;
    const bins = [];
    for (let hr = minBin; hr <= maxBin; hr += binSize) bins.push(hr);

    const percentile = (arr, p) => {
        if (!arr.length) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = (sorted.length - 1) * p;
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        if (lower === upper) return sorted[lower];
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
    };

    const buildStats = (subset) => bins.map(hr => {
        const binSwims = subset.filter(s => Math.abs(s.average_heartrate - hr) < binSize / 2);
        if (!binSwims.length) return { avg: null, q25: null, q75: null };
        const paces = binSwims.map(getSwimPaceMinPer100m).filter(v => Number.isFinite(v));
        if (!paces.length) return { avg: null, q25: null, q75: null };
        return {
            avg: paces.reduce((sum, p) => sum + p, 0) / paces.length,
            q25: percentile(paces, 0.25),
            q75: percentile(paces, 0.75)
        };
    });

    const earlyStats = buildStats(earlySwims);
    const lateStats = buildStats(lateSwims);

    createChart('swim-pace-hr-curve-chart', {
        type: 'line',
        data: {
            labels: bins,
            datasets: [
                {
                    label: 'First swims 33%',
                    data: earlyStats.map(d => d.avg),
                    borderColor: 'rgba(86, 181, 248, 1)',
                    backgroundColor: 'rgba(86, 181, 248, 0.12)',
                    tension: 0.35,
                    pointRadius: 2,
                    borderWidth: 2,
                    spanGaps: true
                },
                {
                    label: 'Last swims 33%',
                    data: lateStats.map(d => d.avg),
                    borderColor: 'rgba(50, 4, 212, 1)',
                    backgroundColor: 'rgba(50, 4, 212, 0.08)',
                    tension: 0.35,
                    pointRadius: 2,
                    borderWidth: 2,
                    spanGaps: true
                }
            ]
        },
        options: {
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                tooltip: {
                    filter: function (tooltipItem) {
                        const label = tooltipItem.dataset.label;
                        return label.includes('First swims 33%') || label.includes('Last swims 33%');
                    },
                    callbacks: {
                        label(context) {
                            const value = context.raw;
                            if (value == null) return '';
                            return `${context.dataset.label}: ${utils.formatPaceSwim(value * 60)}`;
                        }
                    }
                },
                legend: {
                    labels: {
                        filter: (item) => !item.text.includes('Q75') && !item.text.includes('range')
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Heart Rate (bpm)' }
                },
                y: {
                    title: { display: true, text: 'Pace (min/100m)' }
                }
            }
        }
    });

    utils.upsertChartInfo('swim-pace-hr-curve-chart', {
        title: 'Swim Pace-Heart Rate Curve',
        bodyHtml: `Compares your pace at similar heart rates between early swims and recent swims.<br>
        If the recent curve is lower, you're swimming faster at the same effort.`,
        accentColor: '#56b5f8'
    });
}

export function renderVolumeImprovementChart(swims) {
    const validSwims = swims.filter(s => Number.isFinite(getSwimEfficiency(s)) && s.distance_km > 0);
    if (validSwims.length === 0) return;

    const monthlyData = {};
    validSwims.forEach(swim => {
        const date = new Date(swim.start_date_local);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[monthKey]) monthlyData[monthKey] = { swims: [], volume: 0 };
        monthlyData[monthKey].swims.push(swim);
        monthlyData[monthKey].volume += swim.distance_km;
    });

    const monthlyStats = Object.entries(monthlyData)
        .map(([month, data]) => {
            const efficiencies = data.swims.map(getSwimEfficiency).filter(v => Number.isFinite(v));
            if (!efficiencies.length) return null;
            const meanEfficiency = efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length;
            return { month, volume: data.volume, meanEfficiency };
        })
        .filter(Boolean)
        .sort((a, b) => a.volume - b.volume);

    if (monthlyStats.length < 6) return;

    const quintileSize = Math.floor(monthlyStats.length / 5);
    const quintiles = [];
    for (let i = 0; i < 5; i++) {
        const start = i * quintileSize;
        const end = i === 4 ? monthlyStats.length : (i + 1) * quintileSize;
        const slice = monthlyStats.slice(start, end);
        if (slice.length) quintiles.push(slice);
    }
    if (quintiles.length === 0) return;

    const improvementRates = quintiles.map((quintile, idx) => {
        let improvementCount = 0;
        quintile.forEach(monthStat => {
            const monthIndex = monthlyStats.findIndex(m => m.month === monthStat.month);
            if (monthIndex > 0) {
                const prevEfficiency = monthlyStats[monthIndex - 1].meanEfficiency;
                const currentEfficiency = monthStat.meanEfficiency;
                if (currentEfficiency < prevEfficiency) improvementCount++;
            }
        });

        const totalMonths = quintile.length;
        const improvementRate = totalMonths > 0 ? (improvementCount / totalMonths) * 100 : 0;
        return {
            quintile: `Q${idx + 1} (${quintile[0].volume.toFixed(1)}-${quintile[quintile.length - 1].volume.toFixed(1)} km)`,
            improvementRate
        };
    });

    createChart('swim-volume-improvement-chart', {
        type: 'bar',
        data: {
            labels: improvementRates.map(d => d.quintile),
            datasets: [{
                label: 'Improvement Rate (%)',
                data: improvementRates.map(d => d.improvementRate),
                backgroundColor: 'rgba(86, 181, 248, 0.75)',
                borderColor: '#56b5f8',
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                x: { title: { display: true, text: 'Volume Quintiles' } },
                y: { title: { display: true, text: 'Improvement Rate (%)' } }
            }
        }
    });

    utils.upsertChartInfo('swim-volume-improvement-chart', {
        title: 'Monthly Volume vs Improvement Probability',
        bodyHtml: `Groups your months by swim volume and shows how often efficiency improved versus the previous month.`,
        accentColor: '#56b5f8'
    });
}

export function renderEfficiencyEvolutionChart(swims) {
    const validSwims = swims.filter(s => Number.isFinite(getSwimEfficiency(s)));
    if (validSwims.length < 5) return;

    const sortedSwims = [...validSwims].sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));
    const efficiencyData = sortedSwims.map((swim, index) => ({
        date: new Date(swim.start_date_local),
        efficiency: getSwimEfficiency(swim),
        index
    }));

    const smoothedData = [];
    const windowSize = Math.max(5, Math.floor(efficiencyData.length * 0.1));

    efficiencyData.forEach((point, i) => {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(efficiencyData.length, i + Math.floor(windowSize / 2) + 1);
        const window = efficiencyData.slice(start, end);

        let weightedSum = 0;
        let weightSum = 0;

        window.forEach(w => {
            const denominator = windowSize / 2 || 1;
            const distance = Math.abs(w.index - i);
            const normalized = Math.min(1, distance / denominator);
            const weight = Math.pow(1 - Math.pow(normalized, 3), 3);
            weightedSum += w.efficiency * weight;
            weightSum += weight;
        });

        const smoothedEfficiency = weightSum > 0 ? weightedSum / weightSum : point.efficiency;
        smoothedData.push({ x: point.date, y: smoothedEfficiency });
    });

    createChart('swim-efficiency-evolution-chart', {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Raw Efficiency',
                    data: efficiencyData.map(d => ({ x: d.date, y: d.efficiency })),
                    backgroundColor: 'rgba(86, 181, 248, 0.3)',
                    borderColor: 'rgba(86, 181, 248, 0.45)',
                    pointRadius: 2,
                    tension: 0
                },
                {
                    label: 'LOESS Smoothed',
                    data: smoothedData,
                    borderColor: 'rgba(50, 4, 212, 0.95)',
                    backgroundColor: 'rgba(50, 4, 212, 0.08)',
                    pointRadius: 0,
                    tension: 0.35,
                    borderWidth: 2
                }
            ]
        },
        options: {
            scales: {
                x: {
                    type: 'time',
                    title: { display: true, text: 'Date' }
                },
                y: { title: { display: true, text: 'Efficiency (pace/HR)' } }
            }
        }
    });

    utils.upsertChartInfo('swim-efficiency-evolution-chart', {
        title: 'Aerobic Efficiency Evolution',
        bodyHtml: `Tracks pace-per-heartbeat over time in swimming. Lower values indicate better aerobic efficiency.`,
        accentColor: '#56b5f8'
    });
}



// ------------------------
// TOP SWIMS
// ------------------------

function renderTopSwims(swims) {

    const el = document.getElementById("swim-top");
    if (!el) return;

    const topDistance = [...swims]
        .sort((a, b) => b.distance_km - a.distance_km)
        .slice(0, 10);

    const topPace = [...swims]
        .filter(s => s.pace_min100)
        .sort((a, b) => a.pace_min100 - b.pace_min100)
        .slice(0, 10);

    const activityLink = s => {
        if (!s?.id) return s?.name || '-';
        return `<a href="html/activity-router.html?id=${encodeURIComponent(s.id)}" target="_blank" rel="noopener noreferrer">${s.name}</a>`;
    };

    el.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin: 2rem 0;">
            <div class="top-box">
                <h3>Longest Swims</h3>
                <table class="compact-table" id="swim-top-distance-table">
                <thead>
                <tr>
                <th>#</th>
                <th>Swim</th>
                <th data-sort="num">Distance</th>
                <th data-sort="pace">Pace</th>
                </tr>
                </thead>
                <tbody>
                ${topDistance.map((s, i) => `
                <tr>
                <td>${i + 1}</td>
                <td>${activityLink(s)}</td>
                <td data-value="${s.distance_km}">${s.distance_km.toFixed(2)} km</td>
                <td data-value="${s.pace_min100 || 9999}">${formatPace(s.pace_min100)}</td>
                </tr>`).join("")}
                </tbody>
                </table>
            </div>

            <div class="top-box">
                <h3>Best Pace</h3>
                <table class="compact-table" id="swim-top-pace-table">
                <thead>
                <tr>
                <th>#</th>
                <th>Swim</th>
                <th data-sort="num">Distance</th>
                <th data-sort="pace">Pace</th>
                </tr>
                </thead>
                <tbody>
                ${topPace.map((s, i) => `
                <tr>
                <td>${i + 1}</td>
                <td>${activityLink(s)}</td>
                <td data-value="${s.distance_km}">${s.distance_km.toFixed(2)} km</td>
                <td data-value="${s.pace_min100 || 9999}">${formatPace(s.pace_min100)}</td>
                </tr>`).join("")}
                </tbody>
                </table>
            </div>
        </div>
`;

    makeSortable(document.getElementById('swim-top-distance-table'));
    makeSortable(document.getElementById('swim-top-pace-table'));
}

// ------------------------
// TABLE
// ------------------------

function renderSwimsTable(swims) {

    const el = document.getElementById("swim-table");
    if (!el) return;

    const rows = swims
        .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
        .map(s => {
            const activityLink = s.id
                ? `<a href="html/activity-router.html?id=${encodeURIComponent(s.id)}" target="_blank" rel="noopener noreferrer">${s.name}</a>`
                : s.name;
            return `
                <tr>
                    <td>${s.start_date_local.substring(0, 10)}</td>
                    <td>${activityLink}</td>
                    <td data-value="${s.distance_km}">${s.distance_km.toFixed(2)}</td>
                    <td data-value="${s.pace_min100 || 9999}">${s.pace_min100 ? formatPace(s.pace_min100) : "-"}</td>
                    <td data-value="${s.average_heartrate || 0}">${s.average_heartrate ? s.average_heartrate.toFixed(0) : "-"}</td>
                    <td>
                        <span class="swim-badge ${s.swim_type}">
                        ${s.swim_type}
                        </span>
                        </td>
                    <td data-value="${(s.moving_ratio * 100).toFixed(2)}">${(s.moving_ratio * 100).toFixed(2)}%</td>
                    <td>${poolLengthInt(s.pool_length)}</td>
                </tr>
            `;
        }).join("");

    el.innerHTML = `
        <table id="swim-all-table">
            <thead>
                <tr>
                    <th data-sort="date">Date</th>
                    <th>Activity</th>
                    <th data-sort="num">km</th>
                    <th data-sort="pace">Pace /100m</th>
                    <th data-sort="num">Avg HR</th>
                    <th data-sort="text">Type</th>
                    <th data-sort="num">Moving %</th>
                    <th data-sort="text">Pool</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    makeSortable(document.getElementById('swim-all-table'));
}


// --- CHART RENDERING FUNCTIONS ---
export function renderConsistencyChart(swims, dateFilterFrom = null, dateFilterTo = null) {
    const container = document.getElementById('cal-heatmap-swim');
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
    const safeSwims = swims || [];
    const aggregatedData = safeSwims.reduce((acc, act) => {
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
        : [0.2, 0.4, 0.6, 0.9, 1.25, 2]; // horas

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
                    '#bfdbfe',  // azul claro visible
                    '#93c5fd',
                    '#60a5fa',
                    '#3b82f6',
                    '#2563eb',
                    '#1d4ed8',
                    '#1e3a8a'
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


// ------------------------
// POOL + OPEN WATER DISTRIBUTION
// ------------------------
function renderPoolLengthChart(swims) {

    const counts = {
        "20m": 0,
        "25m": 0,
        "50m": 0,
        "25yd": 0,
        "50yd": 0,
        "openwater": 0
    };

    swims.forEach(s => {
        if (s.swim_type === "pool") {
            switch (s.pool_length) {
                case 20: counts["20m"]++; break;
                case 25: counts["25m"]++; break;
                case 50: counts["50m"]++; break;
                case "25yd": counts["25yd"]++; break;
                case "50yd": counts["50yd"]++; break;
            }
        } else if (s.swim_type === "openwater") {
            counts.openwater++;
        }
    });

    // Filtrar solo longitudes con >0 sesiones
    const labels = [];
    const data = [];
    const backgroundColor = [];

    const colorMap = {
        "20m": "#10b981",
        "25m": "#2563eb",
        "50m": "#7c3aed",
        "25yd": "#f59e0b",
        "50yd": "#d97706",
        "openwater": "#3204d4"
    };

    Object.entries(counts).forEach(([key, val]) => {
        if (val > 0) {
            labels.push(key.replace("m", " m").replace("yd", " yd")); // formateo bonito
            data.push(val);
            backgroundColor.push(colorMap[key]);
        }
    });

    createChart("swim-pool-length-chart", {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Sessions",
                data,
                backgroundColor
            }]
        },
        options: {
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

export function renderAccumulatedDistanceChart(swims) {
    if (!swims || swims.length === 0) return;

    // 1. Aggregate distance per day (YYYY-MM-DD)
    const distanceByDay = swims.reduce((acc, act) => {
        const date = act.start_date_local.substring(0, 10);
        acc[date] = (acc[date] || 0) + (act.distance_km || 0);
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

    createChart('swim-accumulated-distance-chart', {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Accumulated Distance (km)',
                data: accumulated,
                borderColor: 'rgba(54,162,235,1)',
                pointRadius: 0,
                tension: 0.1
            }]
        },
        options: { scales: { y: { title: { display: true, text: 'Distance (km)' } } } }
    });
}

export function renderWeeklyDistanceTrendChart(swims, rollingWindowWeeks = 26) {
    if (!swims || swims.length === 0) return;

    const weeklyData = swims.reduce((acc, swim) => {
        const date = new Date(swim.start_date_local);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay() + 1); // Monday
        const weekKey = weekStart.toISOString().slice(0, 10);
        if (!acc[weekKey]) acc[weekKey] = { distance: 0, time: 0 };
        acc[weekKey].distance += swim.distance_km || 0;
        acc[weekKey].time += swim.moving_time || 0;
        return acc;
    }, {});
    const labels = Object.keys(weeklyData).sort();
    const weeklyKm = labels.map(k => weeklyData[k].distance);
    const weeklyPace = labels.map(k => {
        const d = weeklyData[k];
        return d.distance > 0 ? (d.time / 60) / d.distance : 0;
    });
    const rolling = utils.rollingMean(weeklyKm, rollingWindowWeeks).map(v => +v.toFixed(2));
    const rollingPace = utils.rollingMean(weeklyPace, rollingWindowWeeks).map(v => +v.toFixed(2));

    // Convert weeks to human-readable label
    const windowLabel = rollingWindowWeeks >= 52 ? '1 year'
        : rollingWindowWeeks >= 26 ? '6 months'
            : rollingWindowWeeks >= 12 ? '3 months'
                : '1 month';

    createChart('swim-weekly-distance-trend-chart', {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Weekly distance (km)',
                    data: weeklyKm,
                    type: 'bar',
                    yAxisID: 'y',
                    backgroundColor: 'rgba(54,162,235,0.20)',
                    borderColor: 'rgba(54,162,235,0.35)',
                    borderWidth: 1,
                    hidden: true,
                    order: 2
                },
                {
                    label: `Rolling mean (${windowLabel})`,
                    data: rolling,
                    type: 'line',
                    yAxisID: 'y',
                    borderColor: 'rgba(54,162,235,1)',
                    backgroundColor: 'rgba(54,162,235,0.18)',
                    pointRadius: 0,
                    borderWidth: 4,
                    tension: 0.25,
                    order: 1
                },
                {
                    label: 'Rolling mean pace (min/km)',
                    data: rollingPace,
                    type: 'line',
                    yAxisID: 'yPace',
                    borderColor: '#388e3c',
                    backgroundColor: 'rgba(56,142,60,0.18)',
                    pointRadius: 0,
                    borderWidth: 4,
                    tension: 0.25,
                    order: 1,
                    hidden: true
                }
            ]
        },
        plugins: [createHtmlLegendOverlayPlugin('swim-weekly-distance-trend-chart')],
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
                yPace: {
                    display: 'auto',
                    position: 'right',
                    reverse: true,
                    title: { display: true, text: 'Pace (min/km)' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });

    utils.upsertChartInfo('swim-weekly-distance-trend-chart', {
        title: 'Weekly trend, in short',
        bodyHtml: `Bars are the weekly totals and the solid line is the rolling mean over the selected window.<br>
           It makes it easier to see whether your swim volume is really rising or just bouncing around.`,
        accentColor: '#56b5f8'
    });
}

function getSwimMilestoneLabels() {
    return new Map([
        [5, '500m E5'],
        [10, '1K E10'],
        [15, '1.5K E15'],
        [20, '2K E20'],
        [21, '2.1K E21'],
        [30, '3K E30'],
        [42, '4.2K E42'],
        [50, '5K E50']
    ]);
}

function attachSwimEddingtonInfo(canvasId, eddington, variant) {
    const current = eddington.summary.current;
    const recentWindow = eddington.summary.recentWindowDays;
    const projectionCount = eddington.summary.projectionCount;
    let bodyHtml;
    if (variant === 'weekly') {
        const multiplier = attachSwimEddingtonInfo._multiplier || 2;
        bodyHtml = `Current value: <strong>E${current}</strong> weekly (×${multiplier}).<br>
           E${current} means <strong>${current} different weeks</strong> with at least
           <strong>${(current * multiplier * 100).toFixed(0)} m</strong> total each week.<br>
           The dashed line projects the next <strong>${projectionCount}</strong> E values
           using your last <strong>${recentWindow}</strong> days of activity.`;
    } else if (variant === 'distribution') {
        bodyHtml = `Current value: <strong>E${current}</strong> in 100 m blocks.<br>
           Example: E20 means <strong>20 different days</strong> with at least <strong>2000 m</strong> total each day.<br>
           Bars count qualifying days and the solid line shows <strong>active days</strong> needed to reach each E.<br>
           The dashed continuation projects only the next <strong>${projectionCount}</strong> E values, using your last <strong>${recentWindow}</strong> days of activity.`;
    } else {
        bodyHtml = `Current value: <strong>E${current}</strong> in 100 m blocks.<br>
           The 2K marker appears only when E20 is reached, not after a single 2000 m swim.<br>
           Each point is the first date when that exact E value was achieved.`;
    }

    utils.upsertChartInfo(canvasId, {
        title: 'About swim Eddington',
        bodyHtml,
        accentColor: '#56b5f8'
    });
}

export function renderEddingtonDistributionChart(swims) {
    if (!swims || swims.length === 0) return;

    const eddington = utils.buildEddingtonSeries(swims, swim => swim.distance_km || 0, { unitStep: 0.1 });
    if (!eddington.distributionSeries.length) return;

    createChart('swim-eddington-distribution-chart', {
        type: 'bar',
        data: {
            labels: eddington.distributionSeries.map(point => String(point.threshold)),
            datasets: [
                {
                    label: 'Days >= E x 100m',
                    data: eddington.distributionSeries.map(point => point.qualifyingDays),
                    backgroundColor: 'rgba(86, 181, 248, 0.65)',
                    borderColor: '#56b5f8',
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    label: 'Days needed',
                    data: eddington.distributionSeries.map(point => point.activeDaysNeeded),
                    type: 'line',
                    borderColor: '#3204d4',
                    backgroundColor: 'rgba(50, 4, 212, 0.18)',
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
                    borderColor: '#3204d4',
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
                                return `${point.qualifyingDays} days at ${(point.threshold * 100).toFixed(0)} m or more`;
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
                x: {
                    title: { display: true, text: 'Eddington number (100m)' },
                    ticks: {
                        callback: (value) => {
                            const label = eddington.distributionSeries[value]?.threshold;
                            return label != null ? (label * 100).toFixed(0) : '';
                        }
                    }
                },
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

    attachSwimEddingtonInfo('swim-eddington-distribution-chart', eddington, 'distribution');
}

export function renderEddingtonProgressionChart(swims) {
    if (!swims || swims.length === 0) return;

    const eddington = utils.buildEddingtonSeries(swims, swim => swim.distance_km || 0, { unitStep: 0.1 });
    if (!eddington.achievementSeries.length) return;

    const milestoneLabels = getSwimMilestoneLabels();
    const milestoneData = eddington.achievementSeries
        .filter(point => milestoneLabels.has(point.threshold))
        .map(point => ({ x: point.date, y: point.threshold, label: milestoneLabels.get(point.threshold) }));

    createChart('swim-eddington-progression-chart', {
        type: 'line',
        data: {
            labels: eddington.achievementSeries.map(point => point.date),
            datasets: [
                {
                    label: 'Eddington reached',
                    data: eddington.achievementSeries.map(point => point.threshold),
                    borderColor: '#56b5f8',
                    backgroundColor: 'rgba(86, 181, 248, 0.18)',
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    tension: 0.15,
                    fill: false
                },
                {
                    label: 'Milestones',
                    type: 'scatter',
                    data: milestoneData,
                    borderColor: '#3204d4',
                    backgroundColor: '#3204d4',
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
                                return `${context.raw.label}. Reached when you had ${context.raw.y} days of at least ${(context.raw.y * 100).toFixed(0)} m.`;
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
                    title: { display: true, text: 'Eddington number (100m)' }
                }
            }
        }
    });

    attachSwimEddingtonInfo('swim-eddington-progression-chart', eddington, 'progression');
}

function _drawSwimEddingtonCharts(swims, mode) {
    const distId = 'swim-eddington-distribution-chart';
    const progId = 'swim-eddington-progression-chart';
    const isWeekly = mode !== 'daily';
    const multiplier = isWeekly ? parseInt(mode.split('-')[1]) : 1;
    const unit = isWeekly ? 'weeks' : 'days';

    let eddington;
    if (isWeekly) {
        const weekly = utils.aggregateByWeek(swims, s => s.distance_km || 0);
        const pseudo = weekly.map(w => ({
            start_date_local: w.start_date_local,
            distance_km: w.total / multiplier
        }));
        eddington = utils.buildEddingtonSeries(pseudo, s => s.distance_km, { unitStep: 0.1 });
    } else {
        eddington = utils.buildEddingtonSeries(swims, s => s.distance_km || 0, { unitStep: 0.1 });
    }

    if (eddington.distributionSeries.length) {
        createChart(distId, {
            type: 'bar',
            data: {
                labels: eddington.distributionSeries.map(p => String(p.threshold)),
                datasets: [
                    {
                        label: isWeekly ? `Weeks ≥ E×${multiplier}×100m` : 'Days >= E x 100m',
                        data: eddington.distributionSeries.map(p => p.qualifyingDays),
                        backgroundColor: 'rgba(86, 181, 248, 0.65)',
                        borderColor: '#56b5f8',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: isWeekly ? 'Weeks needed' : 'Days needed',
                        data: eddington.distributionSeries.map(p => p.activeDaysNeeded),
                        type: 'line',
                        borderColor: '#3204d4',
                        backgroundColor: 'rgba(50, 4, 212, 0.18)',
                        spanGaps: true, tension: 0.25, pointRadius: 2, pointHoverRadius: 4,
                        yAxisID: 'y1'
                    },
                    {
                        label: isWeekly ? 'Projected weeks needed' : 'Projected days needed',
                        data: eddington.distributionSeries.map(p => p.projectedActiveDaysNeeded),
                        type: 'line',
                        borderColor: '#3204d4', backgroundColor: 'transparent',
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
                                        ? `${p.qualifyingDays} weeks with ≥ ${(p.threshold * multiplier * 100).toFixed(0)} m total`
                                        : `${p.qualifyingDays} days at ${(p.threshold * 100).toFixed(0)} m or more`;
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
                    x: {
                        title: { display: true, text: isWeekly ? `Weekly Eddington (×${multiplier}, per 100m)` : 'Eddington number (100m)' },
                        ticks: {
                            callback: (value) => {
                                const label = eddington.distributionSeries[value]?.threshold;
                                return label != null ? (label * 100).toFixed(0) : '';
                            }
                        }
                    },
                    y: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: isWeekly ? 'Qualifying weeks' : 'Qualifying days' } },
                    y1: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: isWeekly ? 'Active weeks needed' : 'Active days needed' }, grid: { drawOnChartArea: false } }
                }
            }
        });
        attachSwimEddingtonInfo._multiplier = multiplier;
        attachSwimEddingtonInfo(distId, eddington, isWeekly ? 'weekly' : 'distribution');
    }

    if (eddington.achievementSeries.length) {
        const milestoneLabels = isWeekly ? null : getSwimMilestoneLabels();
        const milestoneData = milestoneLabels
            ? eddington.achievementSeries.filter(p => milestoneLabels.has(p.threshold)).map(p => ({ x: p.date, y: p.threshold, label: milestoneLabels.get(p.threshold) }))
            : [];
        const datasets = [
            {
                label: isWeekly ? 'Weekly Eddington reached' : 'Eddington reached',
                data: eddington.achievementSeries.map(p => p.threshold),
                borderColor: '#56b5f8',
                backgroundColor: 'rgba(86, 181, 248, 0.18)',
                pointRadius: 2, pointHoverRadius: 4, tension: 0.15, fill: false
            }
        ];
        if (!isWeekly && milestoneData.length) {
            datasets.push({
                label: 'Milestones', type: 'scatter', data: milestoneData,
                borderColor: '#3204d4', backgroundColor: '#3204d4',
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
                                if (context.datasetIndex === 1) return `${context.raw.label}. Reached when you had ${context.raw.y} days of at least ${(context.raw.y * 100).toFixed(0)} m.`;
                                const suffix = isWeekly ? ` (≥ ${(context.raw * multiplier * 100).toFixed(0)} m/week)` : '';
                                return `Reached E${context.raw}${suffix} on ${context.label}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { title: { display: true, text: 'Achievement date' } },
                    y: { beginAtZero: true, title: { display: true, text: isWeekly ? `Weekly Eddington (×${multiplier})` : 'Eddington number (100m)' } }
                }
            }
        });
        attachSwimEddingtonInfo._multiplier = multiplier;
        attachSwimEddingtonInfo(progId, eddington, isWeekly ? 'weekly' : 'progression');
    }
}

export function renderEddingtonSection(swims) {
    const selectorEl = document.getElementById('swim-eddington-mode-selector');
    function getMode() {
        return selectorEl?.querySelector('.eddington-mode-btn.active')?.dataset.mode || 'daily';
    }
    if (selectorEl) {
        selectorEl._swims = swims;
        if (!selectorEl.dataset.bound) {
            selectorEl.querySelectorAll('.eddington-mode-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectorEl.querySelectorAll('.eddington-mode-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    _drawSwimEddingtonCharts(selectorEl._swims, btn.dataset.mode);
                });
            });
            selectorEl.dataset.bound = 'true';
        }
    }
    _drawSwimEddingtonCharts(swims, getMode());
}
