// js/run-analysis.js
import * as utils from './utils.js';
import { getCachedGears } from './api.js';

function getGears() {
    const cached = getCachedGears();
    if (cached) return cached;
    return JSON.parse(localStorage.getItem('strava_gears') || '[]');
}

// Calculate global HR max reference using 99th percentile of all hr_max values
function calculateGlobalHrMaxRef(runs) {
    const hrMaxValues = runs
        .filter(r => r.max_heartrate && r.max_heartrate > 0)
        .map(r => r.max_heartrate)
        .sort((a, b) => a - b);

    if (hrMaxValues.length === 0) return 190; // fallback default

    // Calculate 99th percentile
    const index = Math.floor(0.99 * (hrMaxValues.length - 1));
    return hrMaxValues[index];
}

const DEFAULT_RUN_RENDER_CONTEXT = {
    idPrefix: '',
    root: document
};

let runRenderContext = DEFAULT_RUN_RENDER_CONTEXT;

function withRunRenderContext(options = {}, callback) {
    const previousContext = runRenderContext;
    const root = options.containerId
        ? document.getElementById(options.containerId)
        : (options.root || document);

    runRenderContext = {
        idPrefix: options.idPrefix || '',
        root: root || document
    };

    try {
        return callback();
    } finally {
        runRenderContext = previousContext;
    }
}

function scopedId(id) {
    return `${runRenderContext.idPrefix || ''}${id}`;
}

function idAttr(id) {
    return scopedId(id);
}

function getElement(id) {
    const resolvedId = scopedId(id);
    if (runRenderContext.root && runRenderContext.root !== document) {
        return runRenderContext.root.querySelector(`#${resolvedId}`) || document.getElementById(resolvedId);
    }
    return document.getElementById(resolvedId);
}

function upsertChartInfo(canvasId, options) {
    utils.upsertChartInfo(scopedId(canvasId), options);
}

export function renderRunAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter = 'all', rollingWindowWeeks = 26, options = {}) {
    return withRunRenderContext(options, () => {
        const filteredActivities = utils.filterActivitiesByDate(allActivities, dateFilterFrom, dateFilterTo);
        const runs = filteredActivities
            .filter(a => a.type && a.type.includes('Run'))
            .filter(a => gearFilter === 'all' || a.gear_id === gearFilter);

        renderSummaryCards(runs);
        renderActivityTypeChart(runs);
        renderMonthlyDistanceChart(runs);
        renderPaceVsDistanceChart(runs);
        renderDistanceHistogram(runs);
        renderDistanceSection(runs, rollingWindowWeeks);
        renderEddingtonSection(runs);
        renderDistanceVsElevationChart(runs);
        renderElevationHistogram(runs);
        renderConsistencyChart(runs, dateFilterFrom, dateFilterTo);
        renderTopRuns(runs);
        renderActivitiesTable(runs);
        renderPaceHistogram(runs);
        renderPaceHrCurveChart(runs);
        renderConsistencyImprovementChart(runs);
        renderVolumeImprovementChart(runs);
        renderEfficiencyEvolutionChart(runs);
        renderDistanceEfficiencyChart(runs);
        renderPaceHrEfficiencyChart(runs);
    });
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

let charts = {};

// --- SORTABLE TABLE UTILITY ---
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

// --- UTILITY ---
function createChart(canvasId, config) {
    const resolvedCanvasId = scopedId(canvasId);
    const canvas = getElement(canvasId);
    if (!canvas) {
        console.error(`Canvas with id ${resolvedCanvasId} not found.`);
        return;
    }
    // Si ya existe un gráfico en ese canvas, lo destruimos primero
    if (charts[resolvedCanvasId]) {
        charts[resolvedCanvasId].destroy();
    }
    // Use container-defined heights so charts remain stable across desktop/mobile.
    if (!config.options) config.options = {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;
    charts[resolvedCanvasId] = new Chart(canvas, config);
    return charts[resolvedCanvasId];
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
    const resolvedCanvasId = scopedId(canvasId);
    return {
        id: `${resolvedCanvasId}-html-legend-overlay`,
        afterDraw(chart) {
            syncChartHtmlLegendOverlay(chart, resolvedCanvasId);
        }
    };
}


// --- CHART RENDERING FUNCTIONS ---
export function renderConsistencyChart(runs, dateFilterFrom = null, dateFilterTo = null) {
    const container = getElement('cal-heatmap-run');
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
    const safeRuns = runs || [];
    const aggregatedData = safeRuns.reduce((acc, act) => {
        const date = act.start_date_local.substring(0, 10);
        acc[date] = (acc[date] || 0) + (act.distance ? act.distance / 1000 : 0);
        return acc;
    }, {});

    const kmValues = Object.values(aggregatedData)
        .filter(v => v > 0)
        .sort((a, b) => a - b);

    const thresholds = kmValues.length >= 6
        ? [
            kmValues[Math.floor(0.1 * kmValues.length)],
            kmValues[Math.floor(0.25 * kmValues.length)],
            kmValues[Math.floor(0.45 * kmValues.length)],
            kmValues[Math.floor(0.6 * kmValues.length)],
            kmValues[Math.floor(0.75 * kmValues.length)],
            kmValues[Math.floor(0.9 * kmValues.length)]
        ]
        : [3, 5, 8, 12, 18, 30]; // km

    const cal = new CalHeatmap();
    const today = new Date();
    const hasManualFilters = Boolean(dateFilterFrom || dateFilterTo);

    // Default: full current year (Jan-Dec). With filters: rolling last 365 days.
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
                    '#fed7aa',  // naranja claro visible
                    '#fdba74',
                    '#fb923c',
                    '#f97316',
                    '#ea580c',
                    '#c2410c',
                    '#7c2d12'
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









export function renderActivityTypeChart(runs) {
    if (!runs || runs.length === 0) return;

    const p80Distance = [...runs].map(a => a.distance)
        .sort((a, b) => a - b)[Math.floor(0.8 * runs.length)];

    const avg_tss = runs.reduce((sum, a) => sum + (a.tss || 0), 0) / runs.length;

    // Clasificación de cada actividad.
    runs.forEach(a => {
        if (a.sport_type === 'TrailRun') {
            a.workout_type_classified = 'Trail Run';
        } else if (a.workout_type !== 1 && a.distance >= p80Distance) {
            a.workout_type_classified = 'Long Run';
        } else if (a.workout_type === 1) {
            a.workout_type_classified = 'Race';
        }
        else if (a.tss && a.tss >= avg_tss * 1.5) {
            a.workout_type_classified = 'High intensity Run';
        }
        else if (a.tss && a.tss >= avg_tss * 0.5) {
            a.workout_type_classified = 'Moderate intensity Run';
        }
        else if (a.tss && a.tss < avg_tss * 0.5) {
            a.workout_type_classified = 'Low intensity Run';
        }
        else {
            a.workout_type_classified = 'Other';
        }
    });

    // Contar por categoría
    const workoutTypeCounts = {};
    runs.forEach(a => {
        const key = a.workout_type_classified;
        workoutTypeCounts[key] = (workoutTypeCounts[key] || 0) + 1;
    });

    const workoutTypeLabels = Object.keys(workoutTypeCounts);
    const workoutTypeData = workoutTypeLabels.map(label => workoutTypeCounts[label]);

    createChart('activity-type-barchart', {
        type: 'bar',
        data: {
            labels: workoutTypeLabels,
            datasets: [{
                label: '# Activities',
                data: workoutTypeData,
                backgroundColor: 'rgba(252, 82, 0, 0.7)'
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: { legend: { display: false } }
        }
    });
}


export function renderMonthlyDistanceChart(runs) {
    if (!runs || runs.length === 0) return;

    // Aggregate data by month
    const monthlyData = runs.reduce((acc, act) => {
        const month = act.start_date_local.substring(0, 7);
        if (!acc[month]) acc[month] = { distance: 0, count: 0 };
        acc[month].distance += act.distance / 1000;
        acc[month].count += 1;
        return acc;
    }, {});

    // Find the first and last month
    const monthsSortedByDate = runs
        .map(act => act.start_date_local.substring(0, 7))
        .sort();
    const firstMonth = monthsSortedByDate[0];
    const lastMonth = monthsSortedByDate[monthsSortedByDate.length - 1];

    // Generate all months between firstMonth and lastMonth
    function getMonthRange(start, end) {
        const result = [];
        let [sy, sm] = start.split('-').map(Number);
        let [ey, em] = end.split('-').map(Number);
        while (sy < ey || (sy === ey && sm <= em)) {
            result.push(`${sy.toString().padStart(4, '0')}-${sm.toString().padStart(2, '0')}`);
            sm++;
            if (sm > 12) {
                sm = 1;
                sy++;
            }
        }
        return result;
    }
    const allMonths = getMonthRange(firstMonth, lastMonth);

    // Fill missing months with zeros
    const monthlyDistances = allMonths.map(m => monthlyData[m]?.distance || 0);
    const monthlyCounts = allMonths.map(m => monthlyData[m]?.count || 0);

    createChart('monthly-distance-chart', {
        type: 'bar',
        data: {
            labels: allMonths,
            datasets: [
                {
                    type: 'bar',
                    label: 'Distance (km)',
                    data: monthlyDistances,
                    backgroundColor: 'rgba(252, 82, 0, 0.7)',
                    borderColor: '#FC5200',
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: '# Runs',
                    data: monthlyCounts,
                    borderColor: 'rgba(54,162,235,1)',
                    backgroundColor: 'rgba(54,162,235,0.25)',
                    fill: false,
                    yAxisID: 'y1',
                    tension: 0.2,
                    pointRadius: 3,
                    hidden: true
                }
            ]
        },
        options: {
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Distance (km)' }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: '# Runs' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
}

export function renderPaceVsDistanceChart(runs) {
    // Prepare datasets for each category
    const generalData = [];
    const raceData = [];
    const trailData = [];

    runs.forEach(r => {
        if (!r.distance || !r.moving_time) return;
        const point = {
            x: r.distance / 1000,
            y: (r.moving_time / 60) / (r.distance / 1000) // Pace in min/km
        };
        if (r.workout_type === 1) {
            raceData.push(point);
        } else if (r.sport_type === 'TrailRun') {
            trailData.push(point);
        } else {
            generalData.push(point);
        }
    });

    createChart('pace-vs-distance-chart', {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Run',
                    data: generalData,
                    backgroundColor: 'rgba(252, 82, 0, 0.7)',
                    pointStyle: 'circle'
                },
                {
                    label: 'Race',
                    data: raceData,
                    backgroundColor: 'rgba(199, 164, 4, 0.9)',
                    pointStyle: 'rectRot'
                },
                {
                    label: 'Trail Run',
                    data: trailData,
                    backgroundColor: 'rgba(93, 22, 1, 0.98)',
                    pointStyle: 'circle'
                }
            ]
        },
        options: {
            scales: {
                x: { title: { display: true, text: 'Distance (km)' } },
                y: { title: { display: true, text: 'Pace (min/km)' } }
            }
        }
    });
}

const formatPace = paceDecimal => {
    if (!paceDecimal || paceDecimal <= 0) return '-';
    const min = Math.floor(paceDecimal);
    const sec = Math.round((paceDecimal - min) * 60);
    return `${min}:${sec.toString().padStart(2, '0')} min/km`;
};

export function renderPaceHistogram(runs) {
    if (!runs || runs.length === 0) return;

    // Convertimos cada actividad a ritmo medio (min/km)
    const paces = runs
        .filter(a => a.distance > 0 && a.moving_time > 0)
        .map(a => (a.moving_time / 60) / (a.distance / 1000));

    if (paces.length === 0) return;

    // Definir bins (por ejemplo, de 4 a 8 min/km en pasos de 0.25)
    const minPace = Math.min(...paces);
    const maxPace = Math.max(...paces);

    const binSize = 10 / 60; // 10 segundos
    const bins = [];
    for (let p = Math.floor(minPace); p <= Math.ceil(maxPace) + 1; p += binSize) {
        bins.push(+p.toFixed(2));
    }

    // Contar cuántos ritmos caen en cada bin
    const counts = new Array(bins.length).fill(0);
    paces.forEach(p => {
        const idx = Math.min(
            bins.length - 1,
            Math.floor((p - bins[0]) / binSize)
        );
        counts[idx]++;
    });

    createChart('pace-histogram-chart', {
        type: 'bar',
        data: {
            labels: bins.map(b => formatPace(b)),
            datasets: [{
                label: 'Actividades',
                data: counts,
                backgroundColor: 'rgba(252, 82, 0, 0.7)',
                borderColor: '#FC5200',
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                x: {
                    title: { display: true, text: 'Ritmo (min/km)' }
                },
                y: {
                    title: { display: true, text: '# Actividades' },
                    beginAtZero: true
                }
            }
        }
    });
}


export function renderDistanceHistogram(runs) {
    const HISTOGRAM_BIN_SIZE_KM = 1;
    const distances = runs.map(act => act.distance / 1000);
    const maxDistance = Math.max(...distances, 0);
    const binCount = Math.ceil(maxDistance / HISTOGRAM_BIN_SIZE_KM);
    const bins = Array(binCount).fill(0);
    distances.forEach(d => {
        const idx = Math.floor(d / HISTOGRAM_BIN_SIZE_KM);
        if (idx < binCount) bins[idx]++;
    });

    createChart('distance-histogram', {
        type: 'bar',
        data: {
            labels: bins.map((_, i) => `${(i * HISTOGRAM_BIN_SIZE_KM).toFixed(0)}-${((i + 1) * HISTOGRAM_BIN_SIZE_KM).toFixed(0)}`),
            datasets: [{ label: '# Activities', data: bins, backgroundColor: 'rgba(252, 82, 0, 0.5)' }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: `Distance (bins of ${HISTOGRAM_BIN_SIZE_KM} km)` } },
                y: { title: { display: true, text: 'Count' } }
            }
        }
    });
}



export async function renderGearGanttChart(runs) {
    // 1. Obtener todos los IDs de gear usados
    const gearIds = Array.from(new Set(runs.map(a => a.gear_id).filter(Boolean)));

    // 2. Si no hay gears, no hacemos nada
    if (gearIds.length === 0) return;

    // 3. Traer info detallada de cada gear
    let gearIdToName = {};
    try {
        const allGears = getGears();
        allGears.forEach(gear => {
            gearIdToName[gear.id] = gear.name || [gear.brand_name, gear.model_name].filter(Boolean).join(' ');
        });
    } catch (error) {
        console.error("Failed to fetch gear details:", error);
        return;
    }

    // 4. Agregar distancia por gear por mes
    const gearMonthKm = runs.reduce((acc, a) => {
        if (!a.gear_id) return acc;
        const gearKey = a.gear_id;
        const month = a.start_date_local.substring(0, 7);
        if (!acc[month]) acc[month] = {};
        acc[month][gearKey] = (acc[month][gearKey] || 0) + a.distance / 1000;
        return acc;
    }, {});

    // 5. Rango de meses
    const monthsSorted = runs.map(a => a.start_date_local.substring(0, 7)).sort();
    const firstMonth = monthsSorted[0];
    const lastMonth = monthsSorted[monthsSorted.length - 1];
    function getMonthRange(start, end) {
        const result = [];
        let [sy, sm] = start.split('-').map(Number);
        let [ey, em] = end.split('-').map(Number);
        while (sy < ey || (sy === ey && sm <= em)) {
            result.push(`${sy.toString().padStart(4, '0')}-${sm.toString().padStart(2, '0')}`);
            sm++;
            if (sm > 12) {
                sm = 1;
                sy++;
            }
        }
        return result;
    }
    const allMonths = getMonthRange(firstMonth, lastMonth);

    // 6. Todos los gears
    const allGears = gearIds;

    // 7. Construir datasets
    const datasets = allGears.map((gearId, idx) => ({
        label: gearIdToName[gearId] || gearId,
        data: allMonths.map(month => gearMonthKm[month]?.[gearId] || 0),
        backgroundColor: `hsl(${(idx * 60) % 360}, 70%, 60%)`
    }));

    // 8. Crear gráfico
    createChart('gear-gantt-chart', {
        type: 'bar',
        data: { labels: allMonths, datasets },
        options: {
            indexAxis: 'y',
            scales: {
                x: { stacked: true, title: { display: true, text: 'Distance (km)' } },
                y: { stacked: true, title: { display: true, text: 'Year-Month' } }
            }
        }
    });
}


export function renderDistanceVsElevationChart(runs) {
    // Separate data for trail and non-trail runs
    const trailData = [];
    const roadData = [];
    runs.forEach(r => {
        const point = {
            x: r.distance / 1000,
            y: r.total_elevation_gain || 0
        };
        if (r.sport_type === 'TrailRun') {
            trailData.push(point);
        } else {
            roadData.push(point);
        }
    });

    createChart('distance-vs-elevation-chart', {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Trail Run',
                    data: trailData,
                    backgroundColor: 'rgba(174, 59, 2, 0.87)'
                },
                {
                    label: 'Run',
                    data: roadData,
                    backgroundColor: 'rgba(245, 131, 0, 0.78)'
                }
            ]
        },
        options: {
            scales: {
                x: { title: { display: true, text: 'Distance (km)' } },
                y: { title: { display: true, text: 'Elevation Gain (m)' } }
            }
        }
    });
}

export function renderElevationHistogram(runs) {
    const values = runs.map(r => r.total_elevation_gain || 0);
    const binSize = 10;
    const maxVal = Math.max(...values, 0);
    const binCount = Math.ceil(maxVal / binSize);
    const bins = Array(binCount).fill(0);
    values.forEach(v => {
        const idx = Math.floor(v / binSize);
        if (idx < binCount) bins[idx]++;
    });

    createChart('elevation-histogram', {
        type: 'bar',
        data: {
            labels: bins.map((_, i) => `${i * binSize}-${(i + 1) * binSize}`),
            datasets: [{
                label: '# Activities',
                data: bins,
                backgroundColor: 'rgba(252, 82, 0, 0.5)'
            }]
        },
        options: { scales: { x: { title: { display: true, text: 'Elevation Gain (m)' } } } }
    });
}

export function renderAccumulatedDistanceChart(runs) {
    if (!runs || runs.length === 0) return;

    // 1. Aggregate distance per day (YYYY-MM-DD)
    const distanceByDay = runs.reduce((acc, act) => {
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

    createChart('accumulated-distance-chart', {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Accumulated Distance (km)',
                data: accumulated,
                borderColor: '#FC5200',
                backgroundColor: 'rgba(252, 82, 0, 0.16)',
                pointRadius: 0,
                tension: 0.1
            }]
        },
        options: {
            plugins: {
                legend: {
                    position: 'bottom'
                }
            },
            scales: { y: { title: { display: true, text: 'Distance (km)' } } }
        }
    });
}

export function renderRollingMeanDistanceChart(runs, rollingWindowWeeks = 26) {
    if (!runs || runs.length === 0) return;

    const weeklyData = runs.reduce((acc, run) => {
        const date = new Date(run.start_date_local);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay() + 1); // Monday
        const weekKey = weekStart.toISOString().slice(0, 10);
        if (!acc[weekKey]) acc[weekKey] = { distance: 0, time: 0 };
        acc[weekKey].distance += (run.distance || 0) / 1000;
        acc[weekKey].time += run.moving_time || 0;
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

    createChart('rolling-mean-distance-chart', {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Weekly distance (km)',
                    data: weeklyKm,
                    type: 'bar',
                    yAxisID: 'y',
                    backgroundColor: 'rgba(252, 82, 0, 0.20)',
                    borderColor: 'rgba(252, 82, 0, 0.35)',
                    borderWidth: 1,
                    hidden: true,
                    order: 2
                },
                {
                    label: `Rolling mean (${windowLabel})`,
                    data: rolling,
                    type: 'line',
                    yAxisID: 'y',
                    borderColor: '#FC5200',
                    backgroundColor: 'rgba(252, 82, 0, 0.18)',
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
                    borderColor: '#1976d2',
                    backgroundColor: 'rgba(25,118,210,0.18)',
                    pointRadius: 0,
                    borderWidth: 4,
                    tension: 0.25,
                    order: 1,
                    hidden: true
                }
            ]
        },
        plugins: [createHtmlLegendOverlayPlugin('rolling-mean-distance-chart')],
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

    upsertChartInfo('rolling-mean-distance-chart', {
        title: 'Weekly trend, in short',
        bodyHtml: `Bars are the weekly totals and the solid line is the rolling mean over the selected window.<br>
           Longer windows smooth more noise; shorter windows react faster to changes.`,
        accentColor: '#FC5200'
    });
}

function getRunMilestoneLabels() {
    return new Map([
        [5, '5K E5'],
        [10, '10K E10'],
        [15, '15K E15'],
        [20, '20K E20'],
        [21, 'Half-marathon E21'],
        [30, '30K E30'],
        [42, 'Marathon E42'],
        [50, '50K E50'],
        [100, 'Ultra E100']
    ]);
}

function attachRunEddingtonInfo(canvasId, eddington, variant) {
    const current = eddington.summary.current;
    const recentWindow = eddington.summary.recentWindowDays;
    const projectionCount = eddington.summary.projectionCount;
    const milestoneNote = current >= 42
        ? 'The marathon marker appears because E42 has been reached.'
        : 'A marathon marker only appears once E42 is reached: 42 different days of at least 42 km.';

    let bodyHtml;
    if (variant === 'weekly') {
        const multiplier = attachRunEddingtonInfo._multiplier || 3;
        bodyHtml = `Current value: <strong>E${current}</strong> weekly (×${multiplier}).<br>
           E${current} means <strong>${current} different weeks</strong> with at least
           <strong>${current * multiplier} km</strong> total each week.<br>
           The dashed line projects the next <strong>${projectionCount}</strong> E values
           using your last <strong>${recentWindow}</strong> days of activity.`;
    } else if (variant === 'distribution') {
        bodyHtml = `Current value: <strong>E${current}</strong>.<br>
           The bars show how many different days were at least that distance.<br>
              The solid line shows how many <strong>active days</strong> it took to reach each E value.<br>
              The dashed continuation projects only the next <strong>${projectionCount}</strong> E values, using your last <strong>${recentWindow}</strong> days of activity.<br>
           ${milestoneNote}`;
    } else {
        bodyHtml = `Current value: <strong>E${current}</strong>.<br>
           Each step marks the first date on which that exact E value was achieved.<br>
           Special markers are not single activities. They only appear when the matching E value is reached.<br>
           Example: one marathon day does <strong>not</strong> mean Marathon E42.`;
    }

    upsertChartInfo(canvasId, {
        title: 'Eddington, in short',
        bodyHtml,
        accentColor: '#FC5200'
    });
}

export function renderEddingtonDistributionChart(runs) {
    if (!runs || runs.length === 0) return;

    const eddington = utils.buildEddingtonSeries(runs, run => (run.distance || 0) / 1000, { unitStep: 1 });
    if (!eddington.distributionSeries.length) return;

    createChart('run-eddington-distribution-chart', {
        type: 'bar',
        data: {
            labels: eddington.distributionSeries.map(point => String(point.threshold)),
            datasets: [
                {
                    label: 'Days >= E km',
                    data: eddington.distributionSeries.map(point => point.qualifyingDays),
                    backgroundColor: 'rgba(252, 82, 0, 0.65)',
                    borderColor: '#FC5200',
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    label: 'Days needed',
                    data: eddington.distributionSeries.map(point => point.activeDaysNeeded),
                    type: 'line',
                    borderColor: '#7c2d12',
                    backgroundColor: 'rgba(124, 45, 18, 0.18)',
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
                    borderColor: '#7c2d12',
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

    attachRunEddingtonInfo('run-eddington-distribution-chart', eddington, 'distribution');
}

export function renderEddingtonProgressionChart(runs) {
    if (!runs || runs.length === 0) return;

    const eddington = utils.buildEddingtonSeries(runs, run => (run.distance || 0) / 1000, { unitStep: 1 });
    if (!eddington.achievementSeries.length) return;

    const milestoneLabels = getRunMilestoneLabels();
    const milestoneData = eddington.achievementSeries
        .filter(point => milestoneLabels.has(point.threshold))
        .map(point => ({ x: point.date, y: point.threshold, label: milestoneLabels.get(point.threshold) }));

    createChart('run-eddington-progression-chart', {
        type: 'line',
        data: {
            labels: eddington.achievementSeries.map(point => point.date),
            datasets: [
                {
                    label: 'Eddington reached',
                    data: eddington.achievementSeries.map(point => point.threshold),
                    borderColor: '#FC5200',
                    backgroundColor: 'rgba(252, 82, 0, 0.18)',
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    tension: 0.15,
                    fill: false
                },
                {
                    label: 'Milestones',
                    type: 'scatter',
                    data: milestoneData,
                    borderColor: '#7c2d12',
                    backgroundColor: '#7c2d12',
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

    attachRunEddingtonInfo('run-eddington-progression-chart', eddington, 'progression');
}

function _drawRunEddingtonCharts(runs, mode) {
    const distId = 'run-eddington-distribution-chart';
    const progId = 'run-eddington-progression-chart';
    const isWeekly = mode !== 'daily';
    const multiplier = isWeekly ? parseInt(mode.split('-')[1]) : 1;
    const unit = isWeekly ? 'weeks' : 'days';

    let eddington;
    if (isWeekly) {
        const weekly = utils.aggregateByWeek(runs, r => (r.distance || 0) / 1000);
        const pseudo = weekly.map(w => ({
            start_date_local: w.start_date_local,
            distance: (w.total / multiplier) * 1000
        }));
        eddington = utils.buildEddingtonSeries(pseudo, a => a.distance / 1000, { unitStep: 1 });
    } else {
        eddington = utils.buildEddingtonSeries(runs, r => (r.distance || 0) / 1000, { unitStep: 1 });
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
                        backgroundColor: 'rgba(252, 82, 0, 0.65)',
                        borderColor: '#FC5200',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: isWeekly ? 'Weeks needed' : 'Days needed',
                        data: eddington.distributionSeries.map(p => p.activeDaysNeeded),
                        type: 'line',
                        borderColor: '#7c2d12',
                        backgroundColor: 'rgba(124, 45, 18, 0.18)',
                        spanGaps: true, tension: 0.25, pointRadius: 2, pointHoverRadius: 4,
                        yAxisID: 'y1'
                    },
                    {
                        label: isWeekly ? 'Projected weeks needed' : 'Projected days needed',
                        data: eddington.distributionSeries.map(p => p.projectedActiveDaysNeeded),
                        type: 'line',
                        borderColor: '#7c2d12', backgroundColor: 'transparent',
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
        attachRunEddingtonInfo._multiplier = multiplier;
        attachRunEddingtonInfo(distId, eddington, isWeekly ? 'weekly' : 'distribution');
    }

    if (eddington.achievementSeries.length) {
        const milestoneLabels = isWeekly ? null : getRunMilestoneLabels();
        const milestoneData = milestoneLabels
            ? eddington.achievementSeries.filter(p => milestoneLabels.has(p.threshold)).map(p => ({ x: p.date, y: p.threshold, label: milestoneLabels.get(p.threshold) }))
            : [];
        const datasets = [
            {
                label: isWeekly ? 'Weekly Eddington reached' : 'Eddington reached',
                data: eddington.achievementSeries.map(p => p.threshold),
                borderColor: '#FC5200',
                backgroundColor: 'rgba(252, 82, 0, 0.18)',
                pointRadius: 2, pointHoverRadius: 4, tension: 0.15, fill: false
            }
        ];
        if (!isWeekly && milestoneData.length) {
            datasets.push({
                label: 'Milestones', type: 'scatter', data: milestoneData,
                borderColor: '#7c2d12', backgroundColor: '#7c2d12',
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
        attachRunEddingtonInfo._multiplier = multiplier;
        attachRunEddingtonInfo(progId, eddington, isWeekly ? 'weekly' : 'progression');
    }
}

export function renderDistanceSection(runs, rollingWindowWeeks = 26) {
    renderAccumulatedDistanceChart(runs);
    renderRollingMeanDistanceChart(runs, rollingWindowWeeks);
}

export function renderEddingtonSection(runs) {
    const selectorEl = getElement('run-eddington-mode-selector');
    const contextOptions = {
        idPrefix: runRenderContext.idPrefix,
        root: runRenderContext.root
    };
    function getMode() {
        return selectorEl?.querySelector('.eddington-mode-btn.active')?.dataset.mode || 'daily';
    }
    if (selectorEl) {
        selectorEl._runs = runs;
        if (!selectorEl.dataset.bound) {
            selectorEl.querySelectorAll('.eddington-mode-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    withRunRenderContext(contextOptions, () => {
                        selectorEl.querySelectorAll('.eddington-mode-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        _drawRunEddingtonCharts(selectorEl._runs, btn.dataset.mode);
                    });
                });
            });
            selectorEl.dataset.bound = 'true';
        }
    }
    _drawRunEddingtonCharts(runs, getMode());
}



export function renderRunsHeatmap(runs) {
    const mapDiv = getElement("runs-heatmap");
    if (!mapDiv) return;

    // Set container size
    mapDiv.style.width = "100%";
    mapDiv.style.height = "400px";

    // Recolectar puntos (inicio y fin)
    const markerPoints = [];
    runs.forEach(run => {
        if (run.start_latlng?.length >= 2) {
            markerPoints.push({ lat: run.start_latlng[0], lng: run.start_latlng[1], type: "start" });
        }
        if (run.end_latlng?.length >= 2) {
            markerPoints.push({ lat: run.end_latlng[0], lng: run.end_latlng[1], type: "end" });
        }
    });

    if (markerPoints.length === 0) {
        mapDiv.innerHTML = `<p>No valid coordinates found. Runs: ${runs.length}</p>`;
        return;
    }

    // Eliminar mapa anterior si existe
    if (window.runsPointsMap) {
        window.runsPointsMap.remove();
        window.runsPointsMap = null;
    }
    mapDiv.innerHTML = "";

    // Inicializar mapa Leaflet
    if (typeof L !== "undefined") {
        const first = markerPoints[0];
        window.runsPointsMap = L.map(mapDiv).setView([first.lat, first.lng], 3);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors"
        }).addTo(window.runsPointsMap);

        // Agregar marcadores
        markerPoints.forEach(p => {
            const color = p.type === "start" ? "green" : "red";
            L.circleMarker([p.lat, p.lng], {
                radius: 4,
                color,
                fillColor: color,
                fillOpacity: 0.8,
                weight: 1
            })
                .bindPopup(`${p.type === "start" ? "Start" : "End"} Point`)
                .addTo(window.runsPointsMap);
        });

        // Ajustar vista
        const bounds = markerPoints.map(p => [p.lat, p.lng]);
        if (bounds.length > 1) window.runsPointsMap.fitBounds(bounds);
    } else {
        mapDiv.innerHTML = `<p>Leaflet.js is required for map visualization.</p>`;
    }
}


function renderSummaryCards(runs) {
    const summaryContainer = getElement('run-summary-cards');
    if (summaryContainer) {
        const totalDistance = runs.reduce((s, a) => s + a.distance, 0) / 1000;
        const totalElevation = runs.reduce((s, a) => s + a.total_elevation_gain, 0);
        const totalTime = runs.reduce((s, a) => s + a.moving_time, 0);
        const avgPaceSeconds = totalDistance > 0 ? (totalTime / totalDistance) : 0;
        const paceMin = Math.floor(avgPaceSeconds / 60);
        const paceSec = Math.round(avgPaceSeconds % 60);

        summaryContainer.innerHTML = `
            <div class="card"><h3>Runs</h3><p>${runs.length}</p></div>
            <div class="card"><h3>Total Distance</h3><p>${totalDistance.toFixed(0)} km</p></div>
            <div class="card"><h3>Total Elevation</h3><p>${totalElevation.toLocaleString()} m</p></div>
            <div class="card"><h3>Avg Pace</h3><p>${paceMin}:${paceSec.toString().padStart(2, '0')} /km</p></div>
        `;
    }
}




function renderStreaks(runs) {
    const streaksInfo = getElement('streaks-info');
    if (!streaksInfo) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const referenceDate = new Date(today);

    // --- UTILIDADES ---
    function formatDate(dateStr) {
        if (!dateStr) return '-';
        const [y, m, d] = dateStr.split('-');
        if (d) return utils.formatDate(dateStr);
        if (m) return `01/${m}/${y}`;
        return dateStr;
    }

    function formatWeek(weekStr) {
        if (!weekStr) return '-';
        const [y, w] = weekStr.split('-W');
        return `W${w}/${y}`;
    }

    // Cálculo ISO Week más preciso
    function getISOWeek(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 4 - (d.getDay() || 7));
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return { year: d.getFullYear(), week: weekNo };
    }

    function getWeekString(date) {
        const { year, week } = getISOWeek(date);
        return `${year}-W${String(week).padStart(2, '0')}`;
    }

    // Comparación precisa de fechas
    function daysBetween(date1Str, date2Str) {
        const d1 = new Date(date1Str);
        const d2 = new Date(date2Str);
        d1.setHours(0, 0, 0, 0);
        d2.setHours(0, 0, 0, 0);
        return Math.round((d2 - d1) / 86400000);
    }

    function weeksBetween(week1Str, week2Str) {
        const [y1, w1] = week1Str.split('-W').map(Number);
        const [y2, w2] = week2Str.split('-W').map(Number);

        // Convertir a días desde época y calcular semanas
        const date1 = getDateFromWeek(y1, w1);
        const date2 = getDateFromWeek(y2, w2);
        return Math.round((date2 - date1) / (7 * 86400000));
    }

    function getDateFromWeek(year, week) {
        const jan4 = new Date(year, 0, 4);
        const dayOffset = (week - 1) * 7;
        const weekStart = new Date(jan4);
        weekStart.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1 + dayOffset);
        return weekStart;
    }

    function monthsBetween(month1Str, month2Str) {
        const [y1, m1] = month1Str.split('-').map(Number);
        const [y2, m2] = month2Str.split('-').map(Number);
        return (y2 - y1) * 12 + (m2 - m1);
    }

    // Cálculo mejorado de rachas
    function calcStreaks(items, type) {
        if (items.length === 0) return { sorted: [], maxStreak: 0, maxStart: null, maxEnd: null };

        const sorted = Array.from(new Set(items)).sort();
        let maxStreak = 0, currentStreak = 0;
        let maxStart = null, maxEnd = null;
        let tempStart = null;

        for (let i = 0; i < sorted.length; i++) {
            const item = sorted[i];

            if (currentStreak === 0) {
                currentStreak = 1;
                tempStart = item;
            } else {
                let diff = 0;
                const prev = sorted[i - 1];

                if (type === 'day') {
                    diff = daysBetween(prev, item);
                } else if (type === 'week') {
                    diff = weeksBetween(prev, item);
                } else if (type === 'month') {
                    diff = monthsBetween(prev, item);
                }

                if (diff === 1) {
                    currentStreak++;
                } else {
                    // Guardar racha anterior si es mejor
                    if (currentStreak > maxStreak) {
                        maxStreak = currentStreak;
                        maxStart = tempStart;
                        maxEnd = sorted[i - 1];
                    }
                    currentStreak = 1;
                    tempStart = item;
                }
            }
        }

        // Verificar última racha
        if (currentStreak > maxStreak) {
            maxStreak = currentStreak;
            maxStart = tempStart;
            maxEnd = sorted[sorted.length - 1];
        }

        return { sorted, maxStreak, maxStart, maxEnd };
    }

    // Cálculo mejorado de racha actual
    function calcCurrentStreak(sorted, type) {
        if (sorted.length === 0) return { value: 0, start: null, end: null };

        let currentStreak = 0, start = null, end = null;

        // Obtener la referencia temporal (hoy o periodo actual)
        let checkDate;
        if (type === 'day') {
            checkDate = referenceDate.toISOString().slice(0, 10);
        } else if (type === 'week') {
            checkDate = getWeekString(referenceDate);
        } else if (type === 'month') {
            checkDate = referenceDate.toISOString().slice(0, 7);
        }

        // Buscar desde el final hacia atrás
        for (let i = sorted.length - 1; i >= 0; i--) {
            const item = sorted[i];
            let diff = 0;

            if (type === 'day') {
                diff = daysBetween(item, checkDate);
            } else if (type === 'week') {
                diff = weeksBetween(item, checkDate);
            } else if (type === 'month') {
                diff = monthsBetween(item, checkDate);
            }

            if (diff === 0) {
                // Encontramos el periodo actual/ayer
                if (currentStreak === 0) {
                    end = item;
                }
                currentStreak++;
                start = item;

                // Actualizar checkDate para buscar el periodo anterior
                if (type === 'day') {
                    const d = new Date(checkDate);
                    d.setDate(d.getDate() - 1);
                    checkDate = d.toISOString().slice(0, 10);
                } else if (type === 'week') {
                    const [y, w] = checkDate.split('-W').map(Number);
                    const prevDate = getDateFromWeek(y, w);
                    prevDate.setDate(prevDate.getDate() - 7);
                    checkDate = getWeekString(prevDate);
                } else if (type === 'month') {
                    let [y, m] = checkDate.split('-').map(Number);
                    m--;
                    if (m === 0) { m = 12; y--; }
                    checkDate = `${y}-${String(m).padStart(2, '0')}`;
                }
            } else if (diff > 0) {
                // Hay un gap, terminamos
                break;
            }
            // Si diff < 0, seguimos buscando hacia atrás
        }

        return { value: currentStreak, start, end };
    }

    // --- CALCULO DE RACHAS ---
    if (runs.length === 0) {
        streaksInfo.innerHTML = '<p>No hay carreras registradas aún.</p>';
        return;
    }

    // Días
    const dayItems = runs.map(r => r.start_date_local.substring(0, 10));
    const dayStreaks = calcStreaks(dayItems, 'day');
    const currentDay = calcCurrentStreak(dayStreaks.sorted, 'day');

    // Semanas (ISO)
    const weekItems = runs.map(r => {
        const d = new Date(r.start_date_local);
        return getWeekString(d);
    });
    const weekStreaks = calcStreaks(weekItems, 'week');
    const currentWeek = calcCurrentStreak(weekStreaks.sorted, 'week');

    // Meses
    const monthItems = runs.map(r => r.start_date_local.substring(0, 7));
    const monthStreaks = calcStreaks(monthItems, 'month');
    const currentMonth = calcCurrentStreak(monthStreaks.sorted, 'month');

    // --- RENDER ---
    streaksInfo.innerHTML = `
      <div style="display: flex; gap: 2rem; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 250px;">
          <h4 style="margin-bottom: 1rem;">🏆 Best Historical Streak</h4>
          <div style="margin-bottom: 0.8rem;">
            <b>Consecutive Days:</b> ${dayStreaks.maxStreak || 0}
            ${dayStreaks.maxStart ? `<br><small style="color: #666;">${formatDate(dayStreaks.maxStart)} - ${formatDate(dayStreaks.maxEnd)}</small>` : ''}
          </div>
          <div style="margin-bottom: 0.8rem;">
            <b>Consecutive Weeks:</b> ${weekStreaks.maxStreak || 0}
            ${weekStreaks.maxStart ? `<br><small style="color: #666;">${formatWeek(weekStreaks.maxStart)} - ${formatWeek(weekStreaks.maxEnd)}</small>` : ''}
          </div>
          <div style="margin-bottom: 0.8rem;">
            <b>Consecutive Months:</b> ${monthStreaks.maxStreak || 0}
            ${monthStreaks.maxStart ? `<br><small style="color: #666;">${formatDate(monthStreaks.maxStart)} - ${formatDate(monthStreaks.maxEnd)}</small>` : ''}
          </div>
        </div>
        <div style="flex: 1; min-width: 250px;">
          <h4 style="margin-bottom: 1rem;">🔥 Current Streak</h4>
          <div style="margin-bottom: 0.8rem;">
            <b>Consecutive Days:</b> ${currentDay.value || 0}
            ${currentDay.start ? `<br><small style="color: #666;">${formatDate(currentDay.start)} - ${formatDate(currentDay.end)}</small>` : ''}
          </div>
          <div style="margin-bottom: 0.8rem;">
            <b>Consecutive Weeks:</b> ${currentWeek.value || 0}
            ${currentWeek.start ? `<br><small style="color: #666;">${formatWeek(currentWeek.start)} - ${formatWeek(currentWeek.end)}</small>` : ''}
          </div>
          <div style="margin-bottom: 0.8rem;">
            <b>Consecutive Months:</b> ${currentMonth.value || 0}
            ${currentMonth.start ? `<br><small style="color: #666;">${formatDate(currentMonth.start)} - ${formatDate(currentMonth.end)}</small>` : ''}
          </div>
        </div>
      </div>
    `;
}
// --- TOP RUNS SECTION ---
function renderTopRuns(runs) {
    const el = getElement("run-top");
    if (!el) return;

    const topDistance = [...runs]
        .sort((a, b) => b.distance - a.distance)
        .slice(0, 10);

    const topElevation = [...runs]
        .sort((a, b) => b.total_elevation_gain - a.total_elevation_gain)
        .slice(0, 10);

    // Calculate pace (seconds per km) and sort by fastest (lowest pace)
    const topFastest = [...runs]
        .map(a => ({
            ...a,
            pace: a.distance > 0 ? (a.moving_time / (a.distance / 1000)) : Infinity
        }))
        .sort((a, b) => a.pace - b.pace)
        .slice(0, 10);

    const formatTime = s => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${h}h ${m}m`;
    };

    const activityLink = a => {
        if (!a?.id) return a?.name || '-';
        return `<a href="/html/activity-router.html?id=${encodeURIComponent(a.id)}" target="_blank" rel="noopener noreferrer">${a.name}</a>`;
    };

    el.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin: 2rem 0;">
            <div class="top-box" style="padding: 1.5rem; background: rgba(252, 82, 0, 0.08); border: 1px solid rgba(252, 82, 0, 0.25); border-radius: 12px;">
                <h3 style="margin-top: 0; color: #FC5200;">🏃 Longest Runs</h3>
                <table class="compact-table" id="${idAttr('run-top-distance-table')}">
                <thead><tr style="background: #FC5200; color: #fff;"><th>#</th><th>Run</th><th data-sort="num">km</th></tr></thead>
                <tbody>
                    ${topDistance.map((a, i) => `<tr><td>${i + 1}</td><td>${activityLink(a)}</td><td data-value="${a.distance / 1000}">${(a.distance / 1000).toFixed(1)} km</td></tr>`).join("")}
                </tbody>
                </table>
            </div>

            <div class="top-box" style="padding: 1.5rem; background: rgba(252, 82, 0, 0.08); border: 1px solid rgba(252, 82, 0, 0.25); border-radius: 12px;">
                <h3 style="margin-top: 0; color: #FC5200;">⛰️ Most Elevation</h3>
                <table class="compact-table" id="${idAttr('run-top-elevation-table')}">
                <thead><tr style="background: #FC5200; color: #fff;"><th>#</th><th>Run</th><th data-sort="num">Elev (m)</th></tr></thead>
                <tbody>
                    ${topElevation.map((a, i) => `<tr><td>${i + 1}</td><td>${activityLink(a)}</td><td data-value="${a.total_elevation_gain}">${a.total_elevation_gain} m</td></tr>`).join("")}
                </tbody>
                </table>
            </div>

            <div class="top-box" style="padding: 1.5rem; background: rgba(252, 82, 0, 0.08); border: 1px solid rgba(252, 82, 0, 0.25); border-radius: 12px;">
                <h3 style="margin-top: 0; color: #FC5200;">⚡ Fastest Races</h3>
                <table class="compact-table" id="${idAttr('run-top-pace-table')}">
                <thead><tr style="background: #FC5200; color: #fff;"><th>#</th><th>Run</th><th data-sort="num">Pace</th></tr></thead>
                <tbody>
                    ${topFastest.map((a, i) => `<tr><td>${i + 1}</td><td>${activityLink(a)}</td><td data-value="${a.pace}">${utils.formatPace(a.pace, 1)}</td></tr>`).join("")}
                </tbody>
                </table>
            </div>
        </div>
    `;

    makeSortable(getElement('run-top-distance-table'));
    makeSortable(getElement('run-top-elevation-table'));
    makeSortable(getElement('run-top-pace-table'));
}

// --- ACTIVITIES TABLE ---
function renderActivitiesTable(runs) {
    const el = getElement("run-activities-table");
    if (!el) return;

    const rows = runs
        .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
        .map(a => {
            const pace = utils.formatPace(1000 / a.average_speed, 1);
            const paceVal = a.average_speed > 0 ? (1000 / a.average_speed) : 9999;
            const activityLink = a.id
                ? `<a href="/html/activity-router.html?id=${encodeURIComponent(a.id)}" target="_blank" rel="noopener noreferrer">${a.name}</a>`
                : a.name;
            return `
            <tr>
                <td>${a.start_date_local.substring(0, 10)}</td>
                <td>${activityLink}</td>
                <td data-value="${(a.distance / 1000).toFixed(2)}">${(a.distance / 1000).toFixed(2)}</td>
                <td data-value="${a.total_elevation_gain || 0}">${a.total_elevation_gain || 0}</td>
                <td data-value="${paceVal}">${pace}</td>
                <td data-value="${a.average_heartrate || 0}">${a.average_heartrate ? Math.round(a.average_heartrate) : "-"}</td>
            </tr>
            `;
        })
        .join("");

    el.innerHTML = `
        <table id="${idAttr('run-all-table')}" style="width: 100%; border-collapse: collapse; margin-top: 2rem; border: 1px solid rgba(252, 82, 0, 0.25); border-radius: 10px; overflow: hidden;">
            <thead>
                <tr style="background: #FC5200; color: #fff;">
                    <th data-sort="date" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Date</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Activity</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Distance (km)</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Elevation (m)</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Pace /km</th>
                    <th data-sort="num" style="padding: 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.2);">Avg HR</th>
                </tr>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;

    makeSortable(getElement('run-all-table'));
}

export function renderPaceHrCurveChart(runs) {
    const validRuns = runs.filter(r => r.average_heartrate && r.distance && r.moving_time);
    if (validRuns.length === 0) return;

    // Sort runs by date
    const sortedRuns = validRuns.sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));

    // Split into first and last 33%
    const third = Math.floor(sortedRuns.length * 0.33);
    const earlyRuns = sortedRuns.slice(0, third);
    const lateRuns = sortedRuns.slice(-third);

    // Group by 5 bpm bins
    const binSize = 5;
    const minHr = Math.min(...validRuns.map(r => r.average_heartrate));
    const maxHr = Math.max(...validRuns.map(r => r.average_heartrate));
    const minBin = Math.floor(minHr / binSize) * binSize;
    const maxBin = Math.ceil(maxHr / binSize) * binSize;

    const bins = [];
    for (let hr = minBin; hr <= maxBin; hr += binSize) {
        bins.push(hr);
    }

    const calculatePace = r => (r.moving_time / 60) / (r.distance / 1000); // min/km

    const buildDatasetStats = (runsSubset) => {
        return bins.map(hr => {
            const binRuns = runsSubset.filter(
                r => Math.abs(r.average_heartrate - hr) < binSize / 2
            );

            if (binRuns.length === 0) {
                return {
                    avg: null,
                    q25: null,
                    q75: null
                };
            }

            const paces = binRuns.map(calculatePace);

            return {
                avg: paces.reduce((sum, p) => sum + p, 0) / paces.length,
            };
        });
    };

    const earlyStats = buildDatasetStats(earlyRuns);
    const lateStats = buildDatasetStats(lateRuns);

    createChart('pace-hr-curve-chart', {
        type: 'line',
        data: {
            labels: bins,
            datasets: [

                // EARLY AVG LINE
                {
                    label: 'First runs',
                    data: earlyStats.map(d => d.avg),
                    borderColor: 'rgba(252, 82, 0, 1)',
                    backgroundColor: 'rgba(252, 82, 0, 0.1)',
                    tension: 0.4,
                    pointRadius: 2,
                    borderWidth: 2,
                    spanGaps: true
                },

                // LATE AVG LINE
                {
                    label: 'Last runs',
                    data: lateStats.map(d => d.avg),
                    borderColor: 'rgba(93, 22, 1, 1)',
                    backgroundColor: 'rgba(93, 22, 1, 0.1)',
                    tension: 0.4,
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
                        return label.includes('First runs') || label.includes('Last runs');
                    },
                    callbacks: {
                        label: function (context) {
                            const value = context.raw;
                            if (value == null) return '';

                            const min = Math.floor(value);
                            const sec = Math.round((value - min) * 60);

                            return `${context.dataset.label}: ${min}:${sec.toString().padStart(2, '0')} min/km`;
                        }
                    }
                },
                legend: {
                    labels: {
                        filter: (item) =>
                            !item.text.includes('Q75') &&
                            !item.text.includes('range')
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Heart Rate (bpm)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Average Pace (min/km)'
                    }
                }
            }
        }
    });

    upsertChartInfo('pace-hr-curve-chart', {
        title: 'Speed–Heart Rate Curve',
        bodyHtml: `This chart compares your pace at similar heart rates between your early runs (first 33%) and late runs (last 33%).<br>
        The solid lines show the average pace for each 5 bpm heart rate bin.<br>
        If the late curve is below the early curve, you're running faster at the same heart rate - a sign of improved aerobic efficiency.`,
        accentColor: '#FC5200'
    });
}

export function renderConsistencyImprovementChart(runs) {
    const validRuns = runs.filter(
        r => r.average_heartrate && r.distance && r.moving_time
    );

    if (validRuns.length === 0) return;

    const calculateEfficiency = r => r.efficiency;

    // Group by month
    const monthlyData = {};

    validRuns.forEach(run => {
        const date = new Date(run.start_date_local);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = [];
        }

        monthlyData[monthKey].push(run);
    });

    // Sort months chronologically
    const sortedMonths = Object.entries(monthlyData)
        .sort((a, b) => new Date(a[0]) - new Date(b[0]));

    const monthlyStats = sortedMonths.map(([month, monthRuns]) => {
        const runsCount = monthRuns.length;

        const efficiencies = monthRuns.map(calculateEfficiency);

        const mean =
            efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length;

        const std = Math.sqrt(
            efficiencies
                .reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
            efficiencies.length
        );

        const cv = mean !== 0 ? std / mean : 0;

        return {
            month,
            runsCount,
            cv,
            meanEfficiency: mean
        };
    }).filter(stat => stat.runsCount >= 5);

    if (monthlyStats.length < 2) return;

    // Improvement vs previous month
    const improvementData = [];

    for (let i = 1; i < monthlyStats.length; i++) {
        const current = monthlyStats[i];
        const previous = monthlyStats[i - 1];

        const improvement =
            previous.meanEfficiency !== 0
                ? (previous.meanEfficiency - current.meanEfficiency) /
                  previous.meanEfficiency
                : 0;

        improvementData.push({
            x: current.cv,
            y: improvement * 100,
            month: current.month
        });
    }

    if (improvementData.length === 0) return;

    // Linear regression
    const n = improvementData.length;

    const sumX = improvementData.reduce((sum, d) => sum + d.x, 0);
    const sumY = improvementData.reduce((sum, d) => sum + d.y, 0);
    const sumXY = improvementData.reduce((sum, d) => sum + d.x * d.y, 0);
    const sumXX = improvementData.reduce((sum, d) => sum + d.x * d.x, 0);

    const slope =
        (n * sumXY - sumX * sumY) /
        (n * sumXX - sumX * sumX || 1);

    const intercept = (sumY - slope * sumX) / n;

    const minX = Math.min(...improvementData.map(d => d.x));
    const maxX = Math.max(...improvementData.map(d => d.x));

    const regressionLine = [
        { x: minX, y: slope * minX + intercept },
        { x: maxX, y: slope * maxX + intercept }
    ];

    const formatMonth = (m) => {
        const [y, mo] = m.split('-');
        return `${mo}/${y}`;
    };

    createChart('consistency-improvement-chart', {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Monthly data',
                    data: improvementData,
                    backgroundColor: 'rgba(252, 82, 0, 0.7)',
                    pointRadius: 6
                },
                {
                    label: `Trend line (slope: ${slope.toFixed(4)})`,
                    data: regressionLine,
                    borderColor: 'rgba(93, 22, 1, 1)',
                    backgroundColor: 'rgba(93, 22, 1, 0.1)',
                    type: 'line',
                    pointRadius: 0,
                    tension: 0
                }
            ]
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const point = context.raw;
                            const month = formatMonth(point.month);

                            return [
                                `Month: ${month}`,
                                `Consistency (CV): ${point.x.toFixed(3)}`,
                                `Efficiency change: ${point.y.toFixed(2)}%`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Monthly Consistency (CV)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Change in aerobic efficiency (%)'
                    }
                }
            }
        }
    });

    upsertChartInfo('consistency-improvement-chart', {
        title: 'Monthly Consistency vs Improvement',
        bodyHtml: `
        This chart shows how training consistency within each month relates to changes in aerobic efficiency over time.<br><br>

        Consistency (CV) measures how variable your runs are during a month. Lower values mean more stable training, while higher values indicate more variability.<br><br>

        The vertical axis shows the percentage change in aerobic efficiency compared to the previous month. Positive values indicate improvement, while negative values indicate decline.<br><br>

        This relationship is correlational and should be interpreted alongside training load, terrain, and intensity distribution.
        `,
        accentColor: '#FC5200'
    });
}

export function renderVolumeImprovementChart(runs) {
    const validRuns = runs.filter(r => r.average_heartrate && r.distance && r.moving_time);
    if (validRuns.length === 0) return;

    // Group by month and calculate volume and efficiency
    const monthlyData = {};
    validRuns.forEach(run => {
        const date = new Date(run.start_date_local);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = { runs: [], volume: 0 };
        }
        monthlyData[monthKey].runs.push(run);
        monthlyData[monthKey].volume += run.distance / 1000; // km
    });

    const calculateEfficiency = r => r.efficiency;

    const monthlyStats = Object.entries(monthlyData)
        .map(([month, data]) => {
            const efficiencies = data.runs.map(calculateEfficiency);
            const meanEfficiency = efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length;
            return { month, volume: data.volume, meanEfficiency };
        })
        .sort((a, b) => a.volume - b.volume);

    if (monthlyStats.length < 6) return; // Need enough months for quintiles

    // Divide into quintiles
    const quintileSize = Math.floor(monthlyStats.length / 5);
    const quintiles = [];
    for (let i = 0; i < 5; i++) {
        const start = i * quintileSize;
        const end = i === 4 ? monthlyStats.length : (i + 1) * quintileSize;
        quintiles.push(monthlyStats.slice(start, end));
    }

    // Calculate improvement percentage for each quintile
    const improvementRates = quintiles.map((quintile, idx) => {
        let improvementCount = 0;
        quintile.forEach(monthStat => {
            // Find previous month
            const monthIndex = monthlyStats.findIndex(m => m.month === monthStat.month);
            if (monthIndex > 0) {
                const prevEfficiency = monthlyStats[monthIndex - 1].meanEfficiency;
                const currentEfficiency = monthStat.meanEfficiency;
                if (currentEfficiency < prevEfficiency) { // Lower efficiency = better (faster)
                    improvementCount++;
                }
            }
        });

        const totalMonths = quintile.length;
        const improvementRate = totalMonths > 0 ? (improvementCount / totalMonths) * 100 : 0;

        return {
            quintile: `Q${idx + 1} (${quintile[0].volume.toFixed(1)}-${quintile[quintile.length - 1].volume.toFixed(1)} km)`,
            improvementRate,
            avgVolume: quintile.reduce((sum, m) => sum + m.volume, 0) / quintile.length
        };
    });

    createChart('volume-improvement-chart', {
        type: 'bar',
        data: {
            labels: improvementRates.map(d => d.quintile),
            datasets: [{
                label: 'Improvement Rate (%)',
                data: improvementRates.map(d => d.improvementRate),
                backgroundColor: 'rgba(252, 82, 0, 0.7)',
                borderColor: 'rgba(252, 82, 0, 1)',
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

    upsertChartInfo('volume-improvement-chart', {
        title: 'Monthly Volume vs Improvement Probability',
        bodyHtml: `Here you see how monthly training volume relates to the probability of improvement.<br>
        We group your months by volume (total distance or number of sessions) and calculate in what percentage of those months your performance at constant heart rate improved compared to the previous month.<br>
        Higher bars indicate that, in those volume ranges, it's more likely that your training translates into real improvement.`,
        accentColor: '#FC5200'
    });
}

export function renderEfficiencyEvolutionChart(runs) {
    const validRuns = runs.filter(
        r => r.average_heartrate && r.distance && r.moving_time
    );

    if (validRuns.length === 0) return;

    // Sort by date
    const sortedRuns = [...validRuns].sort(
        (a, b) => new Date(a.start_date_local) - new Date(b.start_date_local)
    );

    // Efficiency = pace / HR
    // Lower values are better, so we reverse the Y axis visually
    const calculateEfficiency = r => r.efficiency;

    const efficiencyData = sortedRuns.map((run, index) => {
        const pace = (run.moving_time / 60) / (run.distance / 1000);

        return {
            x: new Date(run.start_date_local),
            y: calculateEfficiency(run),
            date: run.start_date_local,
            name: run.name,
            distance: run.distance / 1000,
            hr: run.average_heartrate,
            pace,
            index
        };
    });

    // LOESS-style smoothing
    const smoothedData = [];
    const windowSize = Math.max(5, Math.floor(efficiencyData.length * 0.1));

    efficiencyData.forEach((point, i) => {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(
            efficiencyData.length,
            i + Math.floor(windowSize / 2) + 1
        );

        const window = efficiencyData.slice(start, end);

        let weightedSum = 0;
        let weightSum = 0;

        window.forEach(w => {
            const distance = Math.abs(w.index - i);
            const normalized = distance / (windowSize / 2);

            const weight = normalized >= 1
                ? 0
                : Math.pow(1 - Math.pow(normalized, 3), 3);

            weightedSum += w.y * weight;
            weightSum += weight;
        });

        smoothedData.push({
            x: point.x,
            y: weightSum > 0 ? weightedSum / weightSum : point.y
        });
    });

    createChart('efficiency-evolution-chart', {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Raw Efficiency',
                    data: efficiencyData,
                    backgroundColor: 'rgba(252, 82, 0, 0.25)',
                    borderColor: 'rgba(252, 82, 0, 0.45)',
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    tension: 0
                },
                {
                    label: 'Smoothed Trend',
                    data: smoothedData,
                    borderColor: 'rgba(93, 22, 1, 1)',
                    backgroundColor: 'rgba(93, 22, 1, 0.1)',
                    pointRadius: 0,
                    borderWidth: 2,
                    tension: 0.35
                }
            ]
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const point = context.raw;

                            if (!point.date) {
                                return `Efficiency: ${point.y.toFixed(4)}`;
                            }

                            const date = utils.formatDate(new Date(point.date));

                            const paceMinutes = Math.floor(point.pace);
                            const paceSeconds = Math.round(
                                (point.pace - paceMinutes) * 60
                            );

                            const formattedPace =
                                `${paceMinutes}:${paceSeconds.toString().padStart(2, '0')} /km`;

                            return [
                                `${point.name || 'Run'}`,
                                `Date: ${date}`,
                                `Pace: ${formattedPace}`,
                                `HR Avg: ${point.hr} bpm`,
                                `Distance: ${point.distance.toFixed(2)} km`,
                                `Efficiency: ${point.y.toFixed(4)}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    reverse: true,
                    title: {
                        display: true,
                        text: 'Aerobic Cost (pace / HR)'
                    }
                }
            }
        }
    });

    upsertChartInfo('efficiency-evolution-chart', {
        title: 'Aerobic Efficiency Evolution',
        bodyHtml: `
        This chart tracks how your aerobic efficiency changes over time.<br><br>

        Efficiency is calculated as pace divided by average heart rate. Lower values indicate better efficiency, meaning you are able to maintain faster paces with less cardiovascular effort.<br><br>

        The Y-axis is visually reversed so that improvements appear higher on the chart.<br><br>

        The raw points represent individual runs, while the smoothed trend line helps reveal long-term progression by reducing day-to-day variability.<br><br>

        An upward trend generally indicates improving aerobic fitness and running economy, while a downward trend may reflect fatigue, difficult conditions, or accumulated training stress.
        `,
        accentColor: '#FC5200'
    });
}

export function renderDistanceEfficiencyChart(runs) {
    const validRuns = runs.filter(r => r.average_heartrate && r.distance && r.moving_time);
    if (validRuns.length === 0) return;

    const calculateEfficiency = r => r.efficiency;

    const data = validRuns.map(r => ({
        x: r.distance / 1000,
        y: calculateEfficiency(r),
        date: r.start_date
    }));

    // Simple linear regression
    const n = data.length;
    const sumX = data.reduce((sum, d) => sum + d.x, 0);
    const sumY = data.reduce((sum, d) => sum + d.y, 0);
    const sumXY = data.reduce((sum, d) => sum + d.x * d.y, 0);
    const sumXX = data.reduce((sum, d) => sum + d.x * d.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const minX = Math.min(...data.map(d => d.x));
    const maxX = Math.max(...data.map(d => d.x));
    const regressionLine = [
        { x: minX, y: slope * minX + intercept },
        { x: maxX, y: slope * maxX + intercept }
    ];

    createChart('distance-efficiency-chart', {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Run Data',
                    data: data,
                    backgroundColor: 'rgba(252, 82, 0, 0.7)',
                    pointRadius: 4
                },
                {
                    label: `Regression (slope: ${slope.toFixed(4)})`,
                    data: regressionLine,
                    borderColor: 'rgba(93, 22, 1, 1)',
                    backgroundColor: 'rgba(93, 22, 1, 0.1)',
                    type: 'line',
                    pointRadius: 0,
                    tension: 0
                }
            ]
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const point = context.raw;

                            const date = utils.formatDate(new Date(point.date));

                            return [
                                `Date: ${date}`,
                                `Distance: ${point.x.toFixed(2)} km`,
                                `Efficiency: ${point.y.toFixed(4)}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Distance (km)' } },
                y: { title: { display: true, text: 'Efficiency (pace/HR)' } }
            }
        }
    });

    upsertChartInfo('distance-efficiency-chart', {
        title: 'Distance vs Efficiency',
        bodyHtml: `
        This chart shows how your running efficiency changes with distance.<br><br>

        The X-axis represents the distance of each run, while the Y-axis shows an efficiency score calculated as pace divided by average heart rate.<br><br>

        Lower values indicate better efficiency, meaning you are able to run faster with less cardiovascular effort.<br><br>

        The regression line helps identify how your efficiency changes in longer runs:
        <ul>
            <li>A downward slope suggests you maintain or improve efficiency over longer distances, which usually indicates good aerobic endurance.</li>
            <li>An upward slope may indicate increasing fatigue or difficulty sustaining effort during longer runs.</li>
        </ul>

        Keep in mind that hills, terrain, weather, and recovery level can also affect this metric.
        `,
        accentColor: '#FC5200'
    });
}

export function renderPaceHrEfficiencyChart(runs, mode = 'single') {
    const validRuns = runs.filter(r => r.average_heartrate && r.distance && r.moving_time);
    if (validRuns.length === 0) return;

    const calculatePace = r => (r.moving_time / 60) / (r.distance / 1000); // min/km

    const sortedRuns = [...validRuns].sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));

    const data = sortedRuns.map(r => ({
        x: r.average_heartrate,
        y: calculatePace(r)
    }));

    function calculateRegression(dataPoints) {
        const n = dataPoints.length;
        if (n < 2) return null;
        const sumX = dataPoints.reduce((sum, d) => sum + d.x, 0);
        const sumY = dataPoints.reduce((sum, d) => sum + d.y, 0);
        const sumXY = dataPoints.reduce((sum, d) => sum + d.x * d.y, 0);
        const sumXX = dataPoints.reduce((sum, d) => sum + d.x * d.x, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        const minX = Math.min(...dataPoints.map(d => d.x));
        const maxX = Math.max(...dataPoints.map(d => d.x));
        return {
            slope,
            intercept,
            line: [
                { x: minX, y: slope * minX + intercept },
                { x: maxX, y: slope * maxX + intercept }
            ]
        };
    }

    let datasets;
    let title;
    let bodyHtml;

    if (mode === 'single') {
        const regression = calculateRegression(data);
        datasets = [
            {
                label: 'Run Data',
                data: data,
                backgroundColor: 'rgba(252, 82, 0, 0.7)',
                pointRadius: 4
            },
            {
                label: `Regression (slope: ${regression.slope.toFixed(4)} min/km per bpm)`,
                data: regression.line,
                borderColor: 'rgba(93, 22, 1, 1)',
                backgroundColor: 'rgba(93, 22, 1, 0.1)',
                type: 'line',
                pointRadius: 0,
                tension: 0
            }
        ];
        title = 'Pace vs Heart Rate';
        bodyHtml = `
        <button class="toggle-regression-btn" style="margin-bottom: 10px;">Show Progress Regressions</button><br>
        This chart shows how your running pace changes relative to heart rate across different runs.<br><br>
        The X-axis represents average heart rate, while the Y-axis shows pace in minutes per kilometer.<br><br>
        In general, lower pace values (faster running) at the same heart rate indicate better aerobic efficiency and running economy.<br><br>
        The regression line highlights the overall relationship between heart rate and pace:
        <ul>
            <li>If higher heart rates correspond to much faster paces, it may indicate good aerobic responsiveness.</li>
            <li>If pace remains relatively slow despite higher heart rates, it may suggest fatigue, heat, elevation, or reduced efficiency.</li>
        </ul>
        `;
    } else {
        const third = Math.floor(sortedRuns.length / 3);
        const firstThird = sortedRuns.slice(0, third);
        const middleThird = sortedRuns.slice(third, 2 * third);
        const lastThird = sortedRuns.slice(2 * third);

        const firstData = firstThird.map(r => ({ x: r.average_heartrate, y: calculatePace(r) }));
        const middleData = middleThird.map(r => ({ x: r.average_heartrate, y: calculatePace(r) }));
        const lastData = lastThird.map(r => ({ x: r.average_heartrate, y: calculatePace(r) }));

        const firstReg = calculateRegression(firstData);
        const middleReg = calculateRegression(middleData);
        const lastReg = calculateRegression(lastData);

        datasets = [
            {
                label: 'First 33% runs',
                data: firstData,
                backgroundColor: 'rgba(252, 82, 0, 0.7)',
                pointRadius: 4
            },
            {
                label: 'Middle 33% runs',
                data: middleData,
                backgroundColor: 'rgba(255, 165, 0, 0.7)',
                pointRadius: 4
            },
            {
                label: 'Last 33% runs',
                data: lastData,
                backgroundColor: 'rgba(93, 22, 1, 0.7)',
                pointRadius: 4
            }
        ];

        if (firstReg) datasets.push({
            label: `First regression (slope: ${firstReg.slope.toFixed(4)})`,
            data: firstReg.line,
            borderColor: 'rgba(252, 82, 0, 1)',
            type: 'line',
            pointRadius: 0,
            tension: 0
        });

        if (middleReg) datasets.push({
            label: `Middle regression (slope: ${middleReg.slope.toFixed(4)})`,
            data: middleReg.line,
            borderColor: 'rgba(255, 165, 0, 1)',
            type: 'line',
            pointRadius: 0,
            tension: 0
        });

        if (lastReg) datasets.push({
            label: `Last regression (slope: ${lastReg.slope.toFixed(4)})`,
            data: lastReg.line,
            borderColor: 'rgba(93, 22, 1, 1)',
            type: 'line',
            pointRadius: 0,
            tension: 0
        });

        title = 'Pace vs Heart Rate Progress';
        bodyHtml = `
        <button class="toggle-regression-btn" style="margin-bottom: 10px;">Show Single Regression</button><br>
        This chart shows progress by splitting your runs into three periods: first 33%, middle 33%, and last 33%.<br><br>
        Each period has its own regression line, allowing you to see how your pace-HR relationship has evolved over time.<br><br>
        If the later regressions are below the earlier ones, it indicates improvement in aerobic efficiency.
        `;
    }

    createChart('pace-hr-efficiency-chart', {
        type: 'scatter',
        data: { datasets },
        options: {
            scales: {
                x: { title: { display: true, text: 'Heart Rate (bpm)' } },
                y: { title: { display: true, text: 'Pace (min/km)' } }
            }
        }
    });

    upsertChartInfo('pace-hr-efficiency-chart', {
        title,
        bodyHtml,
        accentColor: '#FC5200'
    });

    const contextOptions = {
        idPrefix: runRenderContext.idPrefix,
        root: runRenderContext.root
    };

    // Add event listener to the button
    setTimeout(() => {
        const scopedRoot = contextOptions.root && contextOptions.root !== document ? contextOptions.root : document;
        const button = scopedRoot.querySelector('.toggle-regression-btn');
        if (button) {
            button.addEventListener('click', () => {
                const newMode = mode === 'single' ? 'multiple' : 'single';
                withRunRenderContext(contextOptions, () => renderPaceHrEfficiencyChart(runs, newMode));
            });
        }
    }, 100);
}
