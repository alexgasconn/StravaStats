import * as utils from './utils.js';

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);
const SWIM_TYPES = new Set(['Swim', 'OpenWaterSwim']);
const BIKE_TYPES = new Set(['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide']);

function sportEmoji(type) { return utils.sportEmoji(type); }
function getType(a) { return (a.sport_type || a.type || 'Unknown').trim(); }

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtPaceSpeed(act) {
    if (!act.distance || !act.moving_time) return '–';
    const type = getType(act);
    if (SWIM_TYPES.has(type)) {
        const s = (act.moving_time / act.distance) * 100;
        return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}<small>/100m</small>`;
    }
    if (RUN_TYPES.has(type)) {
        const s = act.moving_time / (act.distance / 1000);
        return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}<small>/km</small>`;
    }
    // bike or other → speed in km/h
    const kmh = (act.distance / act.moving_time) * 3.6;
    return `${kmh.toFixed(1)}<small> km/h</small>`;
}

function fmtCadence(v, act) {
    if (typeof v !== 'number') return '–';
    const type = getType(act);
    const unit = RUN_TYPES.has(type) ? 'spm' : 'rpm';
    return `${Math.round(v)}<small> ${unit}</small>`;
}

function fmtKcal(v, act) {
    if (typeof act.calories === 'number' && act.calories > 0) return `${Math.round(act.calories)}<small> kcal</small>`;
    if (typeof v === 'number' && v > 0) return `${Math.round(v * 0.239)}<small> kcal</small>`;
    return '–';
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function prettifyKey(key) {
    return String(key)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function fmtGeneric(v) {
    if (v === null || v === undefined || v === '') return '–';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return escapeHtml(String(v));
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[,"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function buildActivitiesCsv(activities, columns, cellValueGetter) {
    const headers = columns.map(c => c.label);
    const rows = activities.map(a => columns.map(col => {
        const raw = cellValueGetter
            ? cellValueGetter(a, col)
            : (col.csv
                ? col.csv(a[col.key], a)
                : String(col.format(a[col.key], a)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
        return raw === '–' ? '' : raw;
    }));
    return [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
}

function downloadTextFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

const GROUP_BY_OPTIONS = ['none', 'day', 'week', 'month', 'year'];
const METRIC_MODE_OPTIONS = ['auto', 'sum', 'avg'];
const TEXT_MODE_OPTIONS = ['frequent', 'mixed'];
const AGG_SUM_KEYS = new Set(['distance', 'moving_time', 'total_elevation_gain', 'tss', 'kilojoules', 'calories']);
const AGG_AVG_KEYS = new Set(['average_heartrate', 'max_heartrate', 'average_cadence', 'average_watts', 'start_hour']);

function parseLocalDate(dateLike) {
    const datePart = String(dateLike || '').slice(0, 10);
    const [y, m, d] = datePart.split('-').map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toLocalDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toLocalMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function weekStartMonday(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    d.setHours(0, 0, 0, 0);
    return d;
}

function metricModeForKey(key, mode) {
    if (mode !== 'auto') return mode;
    if (AGG_SUM_KEYS.has(key)) return 'sum';
    if (AGG_AVG_KEYS.has(key)) return 'avg';
    return 'avg';
}

function addNumericStat(target, key, value) {
    if (!Number.isFinite(value)) return;
    if (!target[key]) {
        target[key] = { sum: 0, count: 0, min: value, max: value };
    }
    const stat = target[key];
    stat.sum += value;
    stat.count += 1;
    if (value < stat.min) stat.min = value;
    if (value > stat.max) stat.max = value;
}

function aggregateStat(stat, mode) {
    if (!stat || !stat.count) return null;
    if (mode === 'sum') return stat.sum;
    return stat.sum / stat.count;
}

function activityGroupMeta(activity, groupBy) {
    const date = parseLocalDate(activity.start_date_local || activity.start_date);
    if (!date) return null;

    if (groupBy === 'day') {
        const key = toLocalDateKey(date);
        return { key, label: key, sortValue: date.getTime(), dateKey: key };
    }

    if (groupBy === 'week') {
        const monday = weekStartMonday(date);
        const key = toLocalDateKey(monday);
        const weekNumber = utils.getISOWeek(monday);
        const label = `${monday.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
        return { key, label, sortValue: monday.getTime(), dateKey: key };
    }

    if (groupBy === 'month') {
        const key = toLocalMonthKey(date);
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        return { key, label: key, sortValue: monthStart.getTime(), dateKey: `${key}-01` };
    }

    const key = String(date.getFullYear());
    const yearStart = new Date(date.getFullYear(), 0, 1);
    return { key, label: key, sortValue: yearStart.getTime(), dateKey: `${key}-01-01` };
}

function aggregateByPeriod(activities, groupBy) {
    if (groupBy === 'none') return activities;

    const groups = new Map();

    activities.forEach(activity => {
        const meta = activityGroupMeta(activity, groupBy);
        if (!meta) return;

        let g = groups.get(meta.key);
        if (!g) {
            g = {
                key: meta.key,
                label: meta.label,
                sortValue: meta.sortValue,
                dateKey: meta.dateKey,
                count: 0,
                typeCounts: {},
                numericStats: {},
                textStats: {},
                sumDistance: 0,
                sumMovingTime: 0,
                firstId: activity.id
            };
            groups.set(meta.key, g);
        }

        g.count += 1;
        const t = getType(activity);
        g.typeCounts[t] = (g.typeCounts[t] || 0) + 1;

        if (Number.isFinite(activity.distance)) g.sumDistance += activity.distance;
        if (Number.isFinite(activity.moving_time)) g.sumMovingTime += activity.moving_time;

        // Derived metric: elevation per km (m/km)
        try {
            const elev = Number(activity.total_elevation_gain || 0);
            const km = Number(activity.distance || 0) / 1000;
            if (km > 0 && Number.isFinite(elev)) {
                addNumericStat(g.numericStats, 'elev_per_km', elev / km);
            }
        } catch (_e) {
            // ignore
        }

        if (activity.start_date_local) {
            const hm = activity.start_date_local.split('T')[1]?.slice(0, 5);
            if (hm) {
                const [h, m] = hm.split(':').map(Number);
                if (Number.isFinite(h) && Number.isFinite(m)) {
                    addNumericStat(g.numericStats, 'start_hour', h * 60 + m);
                }
            }
        }

        Object.entries(activity || {}).forEach(([key, value]) => {
            if (value === null || value === undefined) return;
            if (Array.isArray(value) || typeof value === 'object') return;

            if (typeof value === 'number' && Number.isFinite(value)) {
                addNumericStat(g.numericStats, key, value);
                return;
            }

            const textValue = String(value);
            if (!g.textStats[key]) g.textStats[key] = {};
            g.textStats[key][textValue] = (g.textStats[key][textValue] || 0) + 1;
        });
    });

    return Array.from(groups.values()).map(g => {
        const sortedTypes = Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1]);
        const dominantType = sortedTypes[0]?.[0] || 'Unknown';
        const isMixedType = sortedTypes.length > 1;

        return {
            __isGroup: true,
            __groupLabel: g.label,
            __groupSortValue: g.sortValue,
            __groupCount: g.count,
            __groupMixedType: isMixedType,
            __groupDominantType: dominantType,
            __numericStats: g.numericStats,
            __textStats: g.textStats,
            __summaryActivity: {
                id: g.firstId,
                start_date_local: g.dateKey,
                type: dominantType,
                sport_type: dominantType,
                distance: g.sumDistance,
                moving_time: g.sumMovingTime,
                name: `${g.count} activities`
            }
        };
    });
}

function groupedCellValue(row, col, metricMode, textMode) {
    if (!row.__isGroup) {
        return String(col.format(row[col.key], row));
    }

    const key = col.key;
    const summary = row.__summaryActivity;

    if (key === 'start_date_local') {
        return `${escapeHtml(row.__groupLabel)} <small>(${row.__groupCount} act.)</small>`;
    }

    if (key === 'name') {
        return `${row.__groupCount} activities`;
    }

    if (key === 'type') {
        if (row.__groupMixedType) {
            return `🔀 <small>Mixed (${escapeHtml(row.__groupDominantType)})</small>`;
        }
        return `${sportEmoji(row.__groupDominantType)} <small>${escapeHtml(row.__groupDominantType)}</small>`;
    }

    if (key === 'pace_speed') {
        return fmtPaceSpeed(summary);
    }

    if (key === 'start_hour') {
        const stat = row.__numericStats.start_hour;
        const avgMinutes = aggregateStat(stat, 'avg');
        if (!Number.isFinite(avgMinutes)) return '–';
        const h = Math.floor(avgMinutes / 60);
        const m = Math.round(avgMinutes % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    const numStat = row.__numericStats[key];
    if (numStat && numStat.count > 0) {
        const value = aggregateStat(numStat, metricModeForKey(key, metricMode));
        return col.format(value, summary);
    }

    const textCounts = row.__textStats[key];
    if (textCounts) {
        const entries = Object.entries(textCounts).sort((a, b) => b[1] - a[1]);
        if (textMode === 'mixed') {
            return entries.length === 1
                ? escapeHtml(entries[0][0])
                : `<small>Mixed (${entries.length})</small>`;
        }

        const [winner, count] = entries[0] || ['', 0];
        const tie = entries.length > 1 && entries[1][1] === count;
        if (!winner) return '–';
        if (tie) return `<small>Mixed (tie)</small>`;
        const suffix = entries.length > 1 ? ` <small>(${count}/${row.__groupCount})</small>` : '';
        return `${escapeHtml(winner)}${suffix}`;
    }

    return '–';
}

function groupedSortValue(row, col, metricMode) {
    if (!row.__isGroup) return sortVal(row, col);
    if (col === 'start_date_local') return row.__groupSortValue;
    if (col === 'name') return row.__groupCount;
    if (col === 'type') return row.__groupDominantType;
    if (col === 'pace_speed') return sortVal(row.__summaryActivity, 'pace_speed');
    if (col === 'start_hour') {
        return aggregateStat(row.__numericStats.start_hour, 'avg') ?? -Infinity;
    }

    const stat = row.__numericStats[col];
    if (stat && stat.count > 0) {
        return aggregateStat(stat, metricModeForKey(col, metricMode));
    }

    const textCounts = row.__textStats[col];
    if (textCounts) {
        return Object.entries(textCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    }

    return -Infinity;
}

function groupedCellText(row, col, metricMode, textMode) {
    return String(groupedCellValue(row, col, metricMode, textMode)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ─── Sort value extractor ─────────────────────────────────────────────────────
function sortVal(act, col) {
    if (col === 'start_hour') {
        if (!act.start_date_local) return -Infinity;
        const time = act.start_date_local?.split('T')[1];
        if (!time) return -Infinity;

        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }
    if (col === 'type') return getType(act);
    if (col === 'pace_speed') {
        if (!act.distance || !act.moving_time) return Infinity;
        const type = getType(act);
        if (SWIM_TYPES.has(type)) return (act.moving_time / act.distance) * 100;
        if (RUN_TYPES.has(type)) return act.moving_time / (act.distance / 1000);
        return -((act.distance / act.moving_time) * 3.6);
    }
    if (col === 'elev_per_km') {
        const elev = Number(act.total_elevation_gain || 0);
        const km = Number(act.distance || 0) / 1000;
        if (!km || !isFinite(elev)) return -Infinity;
        return elev / km;
    }
    const v = act[col];
    return v === undefined || v === null ? -Infinity : v;
}

// ─── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
    {
        key: 'start_date_local', label: 'Date',
        format: (v) => {
            if (!v) return '–';
            const d = new Date(v);
            return utils.formatDate(d);
        },
        csv: (v) => (v || '').slice(0, 10)
    },
    {
        key: 'start_hour', label: 'Hour',
        format: (v, a) => {
            if (!a.start_date_local) return '–';
            const time = a.start_date_local?.split('T')[1]?.slice(0, 5);
            return time || '–';
        },
        csv: (v, a) => a.start_date_local?.split('T')[1]?.slice(0, 5) || ''
    },
    {
        key: 'type', label: 'Sport',
        format: (v, a) => { const t = getType(a); return `${sportEmoji(t)} <small>${t}</small>`; },
        csv: (v, a) => getType(a)
    },
    {
        key: 'name', label: 'Name',
        format: (v, a) => `<a class="act-name-link" href="html/activity-router.html?id=${a.id}" target="_blank">${v || '—'}</a>`,
        csv: (v) => v || ''
    },
    {
        key: 'distance', label: 'Distance',
        format: v => typeof v === 'number' && v > 0 ? `${(v / 1000).toFixed(2)}<small> km</small>` : '–',
        csv: v => typeof v === 'number' && v > 0 ? (v / 1000).toFixed(3) : ''
    },
    {
        key: 'moving_time', label: 'Duration',
        format: v => typeof v === 'number' ? utils.formatTime(v) : '–',
        csv: v => typeof v === 'number' ? v : ''
    },
    {
        key: 'pace_speed', label: 'Pace / Speed',
        format: (v, a) => fmtPaceSpeed(a),
        csv: (v, a) => fmtPaceSpeed(a).replace(/<[^>]+>/g, '')
    },
    {
        key: 'average_heartrate', label: 'Avg HR',
        format: v => typeof v === 'number' ? `${Math.round(v)}<small> bpm</small>` : '–',
        csv: v => typeof v === 'number' ? Math.round(v) : ''
    },
    {
        key: 'max_heartrate', label: 'Max HR',
        format: v => typeof v === 'number' ? `${Math.round(v)}<small> bpm</small>` : '–',
        csv: v => typeof v === 'number' ? Math.round(v) : ''
    },
    {
        key: 'total_elevation_gain', label: 'D+',
        format: v => typeof v === 'number' ? `${v.toFixed(0)}<small> m</small>` : '–',
        csv: v => typeof v === 'number' ? Math.round(v) : ''
    },
    {
        key: 'elev_per_km', label: 'm/km',
        // derived metric: total_elevation_gain divided by distance in km
        defaultHidden: true,
        format: (v, a) => {
            const elev = Number(a.total_elevation_gain || 0);
            const km = (a.distance || 0) / 1000;
            if (!km || !isFinite(elev)) return '–';
            const val = elev / km;
            return `${val.toFixed(1)}<small> m/km</small>`;
        },
        csv: (v, a) => {
            const elev = Number(a.total_elevation_gain || 0);
            const km = (a.distance || 0) / 1000;
            if (!km || !isFinite(elev)) return '';
            return (elev / km).toFixed(2);
        }
    },
    {
        key: 'average_cadence', label: 'Cadence',
        format: (v, a) => fmtCadence(v, a),
        csv: v => typeof v === 'number' ? Math.round(v) : ''
    },
    {
        key: 'average_watts', label: 'Power',
        format: v => typeof v === 'number' && v > 0 ? `${Math.round(v)}<small> W</small>` : '–',
        csv: v => typeof v === 'number' && v > 0 ? Math.round(v) : ''
    },
    {
        key: 'tss', label: 'TSS',
        format: v => typeof v === 'number' ? Math.round(v) : '–',
        csv: v => typeof v === 'number' ? Math.round(v) : ''
    },
];

function inferExtraColumns(activities) {
    const baseKeys = new Set(COLUMNS.map(c => c.key));
    const extraKeys = new Set();

    activities.forEach(a => {
        Object.entries(a || {}).forEach(([key, value]) => {
            if (baseKeys.has(key)) return;
            if (value === null || value === undefined) return;
            if (Array.isArray(value)) return;
            if (typeof value === 'object') return;
            extraKeys.add(key);
        });
    });

    return Array.from(extraKeys)
        .sort((a, b) => a.localeCompare(b))
        .map(key => ({
            key,
            label: prettifyKey(key),
            format: v => fmtGeneric(v),
            csv: v => (v == null ? '' : v)
        }));
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function renderActivitiesTab(allActivities) {
    const tableEl = document.getElementById('activities-table');
    const filterEl = document.getElementById('activity-filters');
    const counterEl = document.getElementById('act-counter');

    if (!tableEl) return;

    if (!allActivities || allActivities.length === 0) {
        tableEl.innerHTML = `<thead><tr><th>No Activities</th></tr></thead>
            <tbody><tr><td>No activity data available.</td></tr></tbody>`;
        return;
    }

    // ── Persistent state (survive re-renders) ──
    if (!tableEl._actState) {
        tableEl._actState = {
            sortCol: 'start_date_local',
            sortDir: 'desc',
            visibleActivities: [],
            selectedCols: COLUMNS.filter(c => !c.defaultHidden).map(c => c.key),
            groupBy: 'none',
            metricMode: 'auto',
            textMode: 'frequent',
            filters: {
                type: [], name: '', dateFrom: '', dateTo: '',
                distMin: '', distMax: '', durMin: '', durMax: '',
                hrMin: '', hrMax: '', elevMin: '', elevMax: '',
                powerMin: '', powerMax: '', tssMin: '', tssMax: ''
            }
        };
    }
    const state = tableEl._actState;
    const allColumns = [...COLUMNS, ...inferExtraColumns(allActivities)];

    // ── Build filter UI once ──────────────────────────────────────────────────
    if (filterEl && !filterEl._built) {
        filterEl._built = true;

        const typeCounts = allActivities.reduce((acc, a) => {
            const t = getType(a);
            acc[t] = (acc[t] || 0) + 1;
            return acc;
        }, {});
        const types = Object.entries(typeCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([type]) => type);
        const dists = allActivities.map(a => a.distance).filter(Boolean);
        const durs = allActivities.map(a => a.moving_time).filter(Boolean);
        const hrs = allActivities.map(a => a.average_heartrate).filter(Boolean);
        const elevations = allActivities.map(a => a.total_elevation_gain).filter(v => typeof v === 'number' && v >= 0);
        const powers = allActivities.map(a => a.average_watts).filter(v => typeof v === 'number' && v > 0);
        const tssList = allActivities.map(a => a.tss).filter(v => v != null && v >= 0);

        const maxDist = dists.length ? Math.ceil(Math.max(...dists) / 1000) : 200;
        const maxDur = durs.length ? Math.ceil(Math.max(...durs) / 60) : 600;
        const maxHR = hrs.length ? Math.ceil(Math.max(...hrs)) : 220;
        const minHR = hrs.length ? Math.floor(Math.min(...hrs)) : 40;
        const maxElev = elevations.length ? Math.ceil(Math.max(...elevations)) : 3000;
        const maxPower = powers.length ? Math.ceil(Math.max(...powers)) : 500;
        const maxTSS = tssList.length ? Math.ceil(Math.max(...tssList)) : 300;

        filterEl.innerHTML = `
        <div class="act-filters">
            <div class="act-filter-row">
                <label class="act-filter-label">
                    Sport
                    <select id="flt-type" multiple size="${Math.min(8, Math.max(4, types.length))}">
                        ${types.map(t => `<option value="${t}">${sportEmoji(t)} ${t} (${typeCounts[t]})</option>`).join('')}
                    </select>
                </label>
                <label class="act-filter-label">
                    Name
                    <input id="flt-name" type="text" placeholder="Search…">
                </label>
                <label class="act-filter-label">
                    Date from
                    <input id="flt-date-from" type="text" inputmode="numeric" placeholder="dd/mm/yyyy" title="Format: dd/mm/yyyy">
                </label>
                <label class="act-filter-label">
                    Date to
                    <input id="flt-date-to" type="text" inputmode="numeric" placeholder="dd/mm/yyyy" title="Format: dd/mm/yyyy">
                </label>
                <label class="act-filter-label">
                    Group by
                    <select id="flt-group-by">
                        <option value="none">None</option>
                        <option value="day">Day</option>
                        <option value="week">Week</option>
                        <option value="month">Month</option>
                        <option value="year">Year</option>
                    </select>
                </label>
                <label class="act-filter-label">
                    Numeric metric
                    <select id="flt-metric-mode">
                        <option value="auto">Auto (smart)</option>
                        <option value="sum">Total / Sum</option>
                        <option value="avg">Average</option>
                    </select>
                </label>
                <label class="act-filter-label">
                    Text metric
                    <select id="flt-text-mode">
                        <option value="frequent">Most frequent</option>
                        <option value="mixed">Mixed</option>
                    </select>
                </label>
                <div class="act-filter-actions">
                    <button id="flt-reset" class="act-reset-btn" title="Clear all filters" type="button">✕ Reset</button>
                    <button id="act-edit-cols" class="act-edit-btn" type="button">Edit table</button>
                </div>
            </div>
            <div class="act-filter-row">
                <label class="act-filter-label">
                    Distance (km)
                    <span class="act-range-pair">
                        <input id="flt-dist-min" type="number" min="0" max="${maxDist}" placeholder="Min">
                        <span>–</span>
                        <input id="flt-dist-max" type="number" min="0" max="${maxDist}" placeholder="Max">
                    </span>
                </label>
                <label class="act-filter-label">
                    Duration (min)
                    <span class="act-range-pair">
                        <input id="flt-dur-min" type="number" min="0" max="${maxDur}" placeholder="Min">
                        <span>–</span>
                        <input id="flt-dur-max" type="number" min="0" max="${maxDur}" placeholder="Max">
                    </span>
                </label>
                <label class="act-filter-label">
                    Avg HR (bpm)
                    <span class="act-range-pair">
                        <input id="flt-hr-min" type="number" min="${minHR}" max="${maxHR}" placeholder="Min">
                        <span>–</span>
                        <input id="flt-hr-max" type="number" min="${minHR}" max="${maxHR}" placeholder="Max">
                    </span>
                </label>
                <label class="act-filter-label">
                    D+ (m)
                    <span class="act-range-pair">
                        <input id="flt-elev-min" type="number" min="0" max="${maxElev}" placeholder="Min">
                        <span>–</span>
                        <input id="flt-elev-max" type="number" min="0" max="${maxElev}" placeholder="Max">
                    </span>
                </label>
                <label class="act-filter-label">
                    Power (W)
                    <span class="act-range-pair">
                        <input id="flt-power-min" type="number" min="0" max="${maxPower}" placeholder="Min">
                        <span>–</span>
                        <input id="flt-power-max" type="number" min="0" max="${maxPower}" placeholder="Max">
                    </span>
                </label>
                <label class="act-filter-label">
                    TSS
                    <span class="act-range-pair">
                        <input id="flt-tss-min" type="number" min="0" max="${maxTSS}" placeholder="Min">
                        <span>–</span>
                        <input id="flt-tss-max" type="number" min="0" max="${maxTSS}" placeholder="Max">
                    </span>
                </label>
            </div>
            <div id="act-col-editor" class="act-col-editor" hidden></div>
        </div>`;

        const IDS = ['flt-type', 'flt-name', 'flt-date-from', 'flt-date-to', 'flt-group-by', 'flt-metric-mode', 'flt-text-mode',
            'flt-dist-min', 'flt-dist-max', 'flt-dur-min', 'flt-dur-max',
            'flt-hr-min', 'flt-hr-max', 'flt-elev-min', 'flt-elev-max',
            'flt-power-min', 'flt-power-max', 'flt-tss-min', 'flt-tss-max'];

        const typeSelect = document.getElementById('flt-type');
        Array.from(typeSelect.options).forEach(opt => { opt.selected = true; });

        function readAndRender() {
            const f = state.filters;
            f.type = Array.from(document.getElementById('flt-type').selectedOptions || []).map(opt => opt.value);
            f.name = document.getElementById('flt-name').value.trim().toLowerCase();
            f.dateFrom = utils.parseDateInputToIso(document.getElementById('flt-date-from').value);
            f.dateTo = utils.parseDateInputToIso(document.getElementById('flt-date-to').value);
            const groupBy = document.getElementById('flt-group-by').value;
            const metricMode = document.getElementById('flt-metric-mode').value;
            const textMode = document.getElementById('flt-text-mode').value;
            state.groupBy = GROUP_BY_OPTIONS.includes(groupBy) ? groupBy : 'none';
            state.metricMode = METRIC_MODE_OPTIONS.includes(metricMode) ? metricMode : 'auto';
            state.textMode = TEXT_MODE_OPTIONS.includes(textMode) ? textMode : 'frequent';
            f.distMin = document.getElementById('flt-dist-min').value;
            f.distMax = document.getElementById('flt-dist-max').value;
            f.durMin = document.getElementById('flt-dur-min').value;
            f.durMax = document.getElementById('flt-dur-max').value;
            f.hrMin = document.getElementById('flt-hr-min').value;
            f.hrMax = document.getElementById('flt-hr-max').value;
            f.elevMin = document.getElementById('flt-elev-min').value;
            f.elevMax = document.getElementById('flt-elev-max').value;
            f.powerMin = document.getElementById('flt-power-min').value;
            f.powerMax = document.getElementById('flt-power-max').value;
            f.tssMin = document.getElementById('flt-tss-min').value;
            f.tssMax = document.getElementById('flt-tss-max').value;
            render();
        }

        IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', readAndRender);
        });

        document.getElementById('flt-reset').addEventListener('click', () => {
            const typeEl = document.getElementById('flt-type');
            Array.from(typeEl.options).forEach(opt => { opt.selected = true; });
            ['flt-name', 'flt-date-from', 'flt-date-to',
                'flt-dist-min', 'flt-dist-max', 'flt-dur-min', 'flt-dur-max',
                'flt-hr-min', 'flt-hr-max', 'flt-elev-min', 'flt-elev-max',
                'flt-power-min', 'flt-power-max', 'flt-tss-min', 'flt-tss-max'
            ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            const groupByEl = document.getElementById('flt-group-by');
            const metricModeEl = document.getElementById('flt-metric-mode');
            const textModeEl = document.getElementById('flt-text-mode');
            if (groupByEl) groupByEl.value = 'none';
            if (metricModeEl) metricModeEl.value = 'auto';
            if (textModeEl) textModeEl.value = 'frequent';
            const f = state.filters;
            Object.keys(f).forEach(k => f[k] = k === 'type' ? types.slice() : '');
            state.groupBy = 'none';
            state.metricMode = 'auto';
            state.textMode = 'frequent';
            render();
        });

        function ensureValidSelection() {
            const selected = new Set(state.selectedCols || []);
            const known = allColumns.filter(c => selected.has(c.key)).map(c => c.key);
            if (known.length === 0) return [COLUMNS[0].key];
            return known;
        }

        function renderColumnEditor() {
            const panel = document.getElementById('act-col-editor');
            if (!panel) return;
            const selected = new Set(ensureValidSelection());
            panel.innerHTML = `
                <div class="act-col-editor-grid">
                    ${allColumns.map(col => `
                        <label class="act-col-option">
                            <input type="checkbox" data-col-key="${col.key}" ${selected.has(col.key) ? 'checked' : ''}>
                            <span>${col.label}</span>
                        </label>
                    `).join('')}
                </div>
            `;
        }

        const editBtn = document.getElementById('act-edit-cols');
        const panel = document.getElementById('act-col-editor');
        if (editBtn && panel) {
            editBtn.addEventListener('click', () => {
                const isHidden = panel.hasAttribute('hidden');
                if (isHidden) {
                    renderColumnEditor();
                    panel.removeAttribute('hidden');
                } else {
                    panel.setAttribute('hidden', 'hidden');
                }
            });

            panel.addEventListener('change', (e) => {
                const input = e.target;
                if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return;
                const keys = Array.from(panel.querySelectorAll('input[data-col-key]:checked')).map(el => el.dataset.colKey);
                state.selectedCols = keys.length ? keys : [COLUMNS[0].key];
                if (!state.selectedCols.includes(state.sortCol)) {
                    state.sortCol = state.selectedCols[0];
                    state.sortDir = 'desc';
                }
                renderColumnEditor();
                render();
            });
        }

        state.filters.type = types.slice();
        state.selectedCols = COLUMNS.filter(c => !c.defaultHidden).map(c => c.key);
    }

    // ── Filter logic ──────────────────────────────────────────────────────────
    function applyFilters(acts) {
        const f = state.filters;
        return acts.filter(a => {
            if (Array.isArray(f.type) && f.type.length > 0 && !f.type.includes(getType(a))) return false;
            if (f.name && !(a.name || '').toLowerCase().includes(f.name)) return false;
            const date = (a.start_date_local || '').slice(0, 10);
            if (f.dateFrom && date < f.dateFrom) return false;
            if (f.dateTo && date > f.dateTo) return false;
            const km = (a.distance || 0) / 1000;
            if (f.distMin !== '' && km < +f.distMin) return false;
            if (f.distMax !== '' && km > +f.distMax) return false;
            const durMin = (a.moving_time || 0) / 60;
            if (f.durMin !== '' && durMin < +f.durMin) return false;
            if (f.durMax !== '' && durMin > +f.durMax) return false;
            const hr = a.average_heartrate;
            if (f.hrMin !== '' && (hr == null || hr < +f.hrMin)) return false;
            if (f.hrMax !== '' && (hr == null || hr > +f.hrMax)) return false;
            const elev = a.total_elevation_gain;
            if (f.elevMin !== '' && (elev == null || elev < +f.elevMin)) return false;
            if (f.elevMax !== '' && (elev == null || elev > +f.elevMax)) return false;
            const power = a.average_watts;
            if (f.powerMin !== '' && (power == null || power < +f.powerMin)) return false;
            if (f.powerMax !== '' && (power == null || power > +f.powerMax)) return false;
            const tss = a.tss;
            if (f.tssMin !== '' && (tss == null || tss < +f.tssMin)) return false;
            if (f.tssMax !== '' && (tss == null || tss > +f.tssMax)) return false;
            return true;
        });
    }

    // ── Sort logic ────────────────────────────────────────────────────────────
    function applySort(acts, grouped) {
        const { sortCol, sortDir } = state;
        const factor = sortDir === 'desc' ? -1 : 1;
        return acts.slice().sort((a, b) => {
            const va = grouped ? groupedSortValue(a, sortCol, state.metricMode) : sortVal(a, sortCol);
            const vb = grouped ? groupedSortValue(b, sortCol, state.metricMode) : sortVal(b, sortCol);
            if (!grouped && sortCol === 'start_date_local')
                return ((new Date(a.start_date_local || 0)) - (new Date(b.start_date_local || 0))) * factor;
            if (typeof va === 'number' && typeof vb === 'number')
                return (va - vb) * factor;
            return String(va || '').localeCompare(String(vb || '')) * factor;
        });
    }

    // ── Render table ──────────────────────────────────────────────────────────
    function render() {
        const filtered = applyFilters(allActivities);
        const groupedRows = aggregateByPeriod(filtered, state.groupBy);
        const grouped = state.groupBy !== 'none';
        const sorted = applySort(groupedRows, grouped);
        state.visibleActivities = sorted;
        const selectedCols = new Set(state.selectedCols && state.selectedCols.length ? state.selectedCols : COLUMNS.map(c => c.key));
        const visibleColumns = allColumns.filter(c => selectedCols.has(c.key));
        if (visibleColumns.length === 0) visibleColumns.push(COLUMNS[0]);
        if (!visibleColumns.some(c => c.key === state.sortCol)) {
            state.sortCol = visibleColumns[0].key;
        }
        const { sortCol, sortDir } = state;

        const theadHtml = `<thead><tr>
            ${visibleColumns.map(c => {
            const active = sortCol === c.key;
            const arrow = active ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
            return `<th class="sortable${active ? ' act-sort-active' : ''}" data-col="${c.key}">${c.label}${arrow}</th>`;
        }).join('')}
        </tr></thead>`;

        const emptyRow = `<tr><td colspan="${visibleColumns.length}" class="act-empty">
            ${grouped ? 'No grouped periods match the current filters' : 'No activities match the current filters'}</td></tr>`;

        const tbodyHtml = `<tbody>${sorted.length === 0 ? emptyRow : sorted.map(act => `
            <tr>
                ${visibleColumns.map(col => `<td>${groupedCellValue(act, col, state.metricMode, state.textMode)}</td>`).join('')}
            </tr>`).join('')}
        </tbody>`;

        tableEl.innerHTML = theadHtml + tbodyHtml;

        // Sort click handlers
        tableEl.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.col;
                state.sortDir = (state.sortCol === col && state.sortDir === 'desc') ? 'asc' : 'desc';
                state.sortCol = col;
                render();
            });
        });

        // Row counter
        if (counterEl) {
            counterEl.innerHTML = `
                <span>${grouped
                    ? `${sorted.length} groups / ${filtered.length} activities`
                    : `${sorted.length} / ${allActivities.length} activities`}</span>
                <button id="act-export-csv" class="act-export-btn" type="button">Download CSV</button>
            `;

            const exportBtn = document.getElementById('act-export-csv');
            if (exportBtn) {
                exportBtn.addEventListener('click', () => {
                    const visible = state.visibleActivities || [];
                    const csv = buildActivitiesCsv(visible, visibleColumns, (row, col) => {
                        return grouped
                            ? groupedCellText(row, col, state.metricMode, state.textMode)
                            : (col.csv
                                ? col.csv(row[col.key], row)
                                : groupedCellText(row, col, state.metricMode, state.textMode));
                    });
                    const now = new Date();
                    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
                    downloadTextFile(csv, `activities_filtered_${stamp}.csv`, 'text/csv;charset=utf-8;');
                });
            }
        }
    }

    render();
}
