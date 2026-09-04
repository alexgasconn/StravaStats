import * as utils from './utils.js';

let selectedRangeDays = 'alltime'; // default to All Time
let customDateFromIso = null;
let customDateToIso = null;
const dashboardMemo = new Map();
let lastActivitiesRef = null;
let tssUnit = 'tss'; // unit for TSS chart: 'tss', 'activities', or 'hours'
let acuteLoadBandMode = 'aggressive'; // always aggressive, no user selection
let readinessTimelineMetric = 'readiness';
const READINESS_HRV_STORAGE_KEY = 'dashboard_readiness_hrv';
let dashboardRenderContext = {
    allActivities: [],
    dateFilterFrom: null,
    dateFilterTo: null
};

const RANGE_OPTIONS = [
    { label: 'This Week', type: 'week' },
    { label: 'Last 7 Days', type: 'last7' },
    { label: 'This Month', type: 'month' },
    { label: 'Last 30 Days', type: 'last30' },
    { label: 'Last 3 Months', type: 'last3m' },
    { label: 'Last 6 Months', type: 'last6m' },
    { label: 'This Year', type: 'year' },
    { label: 'Last 365 Days', type: 'last365' },
    { label: 'All Time', type: 'alltime' }
];

function toLocalYMD(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeTextToken(value = '') {
    return value
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function splitCsvLine(line, delimiter) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        const next = line[index + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                index++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === delimiter && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    values.push(current.trim());
    return values;
}

function detectCsvDelimiter(line = '') {
    const candidates = [',', ';', '\t'];
    let best = ',';
    let bestCount = -1;

    candidates.forEach(delimiter => {
        const count = splitCsvLine(line, delimiter).length;
        if (count > bestCount) {
            best = delimiter;
            bestCount = count;
        }
    });

    return best;
}

function parseLooseNumber(value) {
    if (value == null) return null;
    const cleaned = String(value)
        .trim()
        .replace(/\s+/g, '')
        .replace(/[^\d,.-]/g, '');
    if (!cleaned) return null;

    const normalized = cleaned.includes(',') && cleaned.includes('.')
        ? cleaned.replace(/,/g, '')
        : cleaned.replace(',', '.');

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseHrvRange(value) {
    if (!value) return null;
    const matches = String(value).match(/-?\d+(?:[.,]\d+)?/g);
    if (!matches || matches.length < 2) return null;

    const low = parseLooseNumber(matches[0]);
    const high = parseLooseNumber(matches[1]);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

    return {
        low: Math.min(low, high),
        high: Math.max(low, high)
    };
}

function getHrvMonthIndex(token) {
    const normalized = normalizeTextToken(token).replace('.', '');
    const monthMap = {
        jan: 0, january: 0, enero: 0, ene: 0, janvier: 0, janv: 0, janeiro: 0, gennaio: 0,
        feb: 1, february: 1, febrero: 1, fevrier: 1, fevr: 1, fevereiro: 1, febbraio: 1,
        mar: 2, march: 2, marzo: 2, mars: 2,
        apr: 3, april: 3, abril: 3, avr: 3, avril: 3,
        may: 4, mayo: 4, mai: 4, maggio: 4,
        jun: 5, june: 5, junio: 5, juin: 5, giugno: 5,
        jul: 6, july: 6, julio: 6, juillet: 6, luglio: 6,
        aug: 7, august: 7, agosto: 7, aout: 7, ago: 7,
        sep: 8, sept: 8, september: 8, septiembre: 8, setembro: 8, septembre: 8, settembre: 8,
        oct: 9, october: 9, octubre: 9, outubro: 9, octobre: 9, ottobre: 9,
        nov: 10, november: 10, noviembre: 10, novembro: 10, novembre: 10,
        dec: 11, december: 11, diciembre: 11, dezembro: 11, decembre: 11, dicembre: 11
    };

    return Number.isInteger(monthMap[normalized]) ? monthMap[normalized] : null;
}

function resolvePartialHrvDate(monthIndex, day, year = null) {
    const now = new Date();
    const resolvedYear = Number.isFinite(year) ? year : now.getFullYear();
    let parsed = new Date(resolvedYear, monthIndex, day);

    if (!Number.isFinite(year)) {
        const futureGapDays = (parsed.getTime() - now.getTime()) / 86400000;
        if (futureGapDays > 30) {
            parsed = new Date(resolvedYear - 1, monthIndex, day);
        }
    }

    parsed.setHours(0, 0, 0, 0);
    return parsed;
}

function parseGarminHrvDate(value) {
    if (!value) return null;

    const normalized = String(value).replace(/\s+/g, ' ').trim();
    const isoLike = normalized.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (isoLike) {
        const parsed = new Date(Number(isoLike[1]), Number(isoLike[2]) - 1, Number(isoLike[3]));
        parsed.setHours(0, 0, 0, 0);
        return parsed;
    }

    const dayMonthYear = normalized.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (dayMonthYear) {
        const first = Number(dayMonthYear[1]);
        const second = Number(dayMonthYear[2]);
        const rawYear = Number(dayMonthYear[3]);
        const year = rawYear < 100 ? 2000 + rawYear : rawYear;
        const isMonthFirst = first <= 12 && second > 12;
        const day = isMonthFirst ? second : first;
        const month = isMonthFirst ? first : second;
        const parsed = new Date(year, month - 1, day);
        parsed.setHours(0, 0, 0, 0);
        return parsed;
    }

    const direct = parseDateInput(value);
    if (direct) {
        direct.setHours(0, 0, 0, 0);
        return direct;
    }

    const compact = normalizeTextToken(normalized);

    const monthFirst = compact.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i);
    if (monthFirst) {
        const monthIndex = getHrvMonthIndex(monthFirst[1]);
        const day = Number.parseInt(monthFirst[2], 10);
        const year = monthFirst[3] ? Number.parseInt(monthFirst[3], 10) : null;
        if (monthIndex != null && Number.isFinite(day)) {
            return resolvePartialHrvDate(monthIndex, day, year);
        }
    }

    const dayFirst = compact.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i);
    if (dayFirst) {
        const day = Number.parseInt(dayFirst[1], 10);
        const monthIndex = getHrvMonthIndex(dayFirst[2]);
        const year = dayFirst[3] ? Number.parseInt(dayFirst[3], 10) : null;
        if (monthIndex != null && Number.isFinite(day)) {
            return resolvePartialHrvDate(monthIndex, day, year);
        }
    }

    return null;
}

function fillMissingHrvDates(entries) {
    if (!entries.length) return [];

    const resolved = entries.map(entry => ({
        ...entry,
        parsedDate: entry.parsedDate instanceof Date ? new Date(entry.parsedDate) : null
    }));

    const firstKnownIndex = resolved.findIndex(entry => entry.parsedDate);
    if (firstKnownIndex === -1) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return resolved.map((entry, index) => ({
            ...entry,
            parsedDate: addDays(today, -index)
        }));
    }

    for (let index = firstKnownIndex - 1; index >= 0; index--) {
        resolved[index].parsedDate = addDays(resolved[index + 1].parsedDate, 1);
    }

    for (let index = firstKnownIndex + 1; index < resolved.length; index++) {
        if (!resolved[index].parsedDate) {
            resolved[index].parsedDate = addDays(resolved[index - 1].parsedDate, -1);
        }
    }

    return resolved;
}

function parseGarminHrvCsv(csvText) {
    const lines = String(csvText || '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length < 2) {
        throw new Error('CSV file is empty or missing data rows.');
    }

    const delimiter = detectCsvDelimiter(lines[0]);
    const header = splitCsvLine(lines[0], delimiter).map(normalizeTextToken);
    const dateIndex = header.findIndex(cell => /(^|\b)(fecha|date|datum|data|giorno|jour|dia|tag)(\b|$)/.test(cell));
    const nightlyIndex = header.findIndex(cell =>
        /(vfc|hrv)/.test(cell) && /(noche|night|overnight|nuit|notte|noite|nacht|soir|matin)?/.test(cell)
    );
    const referenceIndex = header.findIndex(cell => /(valor de referencia|reference|baseline|referencia|referenz|reference value|valeur de reference|valore di riferimento)/.test(cell));
    const avg7Index = header.findIndex(cell => /(7).*(average|avg|media|moyenne|promedio|durchschnitt|media móvil|media movel|rolling)/.test(cell));

    const indices = {
        date: dateIndex >= 0 ? dateIndex : 0,
        nightly: nightlyIndex >= 0 ? nightlyIndex : 1,
        reference: referenceIndex >= 0 ? referenceIndex : 2,
        avg7: avg7Index >= 0 ? avg7Index : 3
    };

    const rawEntries = [];
    lines.slice(1).forEach(line => {
        const cells = splitCsvLine(line, delimiter);
        const parsedDate = parseGarminHrvDate(cells[indices.date]);
        const nightly = parseLooseNumber(cells[indices.nightly]);
        const reference = parseHrvRange(cells[indices.reference]);
        const avg7 = parseLooseNumber(cells[indices.avg7]);

        if (!Number.isFinite(nightly) || !reference) return;

        rawEntries.push({
            parsedDate,
            nightly,
            referenceLow: reference.low,
            referenceHigh: reference.high,
            avg7: Number.isFinite(avg7) ? avg7 : nightly
        });
    });

    const entries = fillMissingHrvDates(rawEntries)
        .filter(entry => entry.parsedDate)
        .map(entry => ({
            date: toLocalYMD(entry.parsedDate),
            nightly: entry.nightly,
            referenceLow: entry.referenceLow,
            referenceHigh: entry.referenceHigh,
            avg7: entry.avg7
        }));

    if (!entries.length) {
        throw new Error('No Garmin HRV rows could be parsed from the CSV.');
    }

    const uniqueEntries = Array.from(new Map(entries.map(entry => [entry.date, entry])).values())
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        importedAt: Date.now(),
        rangeStart: uniqueEntries[0].date,
        rangeEnd: uniqueEntries[uniqueEntries.length - 1].date,
        entries: uniqueEntries
    };
}

function loadStoredHrvData() {
    try {
        const raw = localStorage.getItem(READINESS_HRV_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.entries) || !parsed.entries.length) return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveStoredHrvData(hrvData) {
    if (!hrvData || !Array.isArray(hrvData.entries) || !hrvData.entries.length) {
        localStorage.removeItem(READINESS_HRV_STORAGE_KEY);
        return;
    }
    localStorage.setItem(READINESS_HRV_STORAGE_KEY, JSON.stringify(hrvData));
}

function getHrvLookup() {
    const stored = loadStoredHrvData();
    if (!stored) return null;

    const byDate = new Map();
    stored.entries.forEach(entry => {
        if (entry?.date) {
            byDate.set(entry.date, entry);
        }
    });

    return {
        meta: stored,
        byDate
    };
}




function parseDateInput(value, endOfDay = false) {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function getEffectiveDashboardWindow(dateFilterFrom, dateFilterTo) {
    const now = new Date();
    if (selectedRangeDays === 'custom' && customDateFromIso && customDateToIso) {
        const customStart = parseDateInput(customDateFromIso);
        const customEnd = parseDateInput(customDateToIso, true);
        if (customStart && customEnd) {
            return { startDate: customStart, endDate: customEnd };
        }
    }
    const startDate = getRangeStartDate(selectedRangeDays);
    const minDate = parseDateInput(dateFilterFrom);
    const maxDate = parseDateInput(dateFilterTo, true);
    let effectiveStart = new Date(startDate);
    let effectiveEnd = new Date(now);

    effectiveStart.setHours(0, 0, 0, 0);

    if (minDate && minDate > effectiveStart) {
        effectiveStart = minDate;
    }

    if (maxDate && maxDate < effectiveEnd) {
        effectiveEnd = maxDate;
    }

    if (effectiveStart > effectiveEnd) {
        effectiveStart = new Date(effectiveEnd);
        effectiveStart.setHours(0, 0, 0, 0);
    }

    return { startDate: effectiveStart, endDate: effectiveEnd };
}

function getRangeStartDate(rangeType) {
    const now = new Date();
    let startDate;

    switch (rangeType) {
        case 'week': {
            const currentDay = now.getDay();
            const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
            startDate = new Date(now);
            startDate.setDate(now.getDate() + diffToMonday);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        case 'alltime': {
            const earliestActivity = (dashboardRenderContext.allActivities || [])
                .filter(activity => activity?.start_date_local)
                .sort((a, b) => new Date(a.start_date_local || 0) - new Date(b.start_date_local || 0))[0];
            startDate = earliestActivity
                ? new Date(earliestActivity.start_date_local)
                : new Date(now);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        case 'month': {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        case 'year': {
            startDate = new Date(now.getFullYear(), 0, 1);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        case 'last7': {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            break;
        }
        case 'last30': {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
            break;
        }
        case 'last3m': {
            startDate = new Date(now);
            startDate.setMonth(now.getMonth() - 3);
            break;
        }
        case 'last6m': {
            startDate = new Date(now);
            startDate.setMonth(now.getMonth() - 6);
            break;
        }
        case 'last365': {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 365);
            break;
        }
        default: {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
        }
    }

    return startDate;
}

function getRangeLabel(rangeType) {
    return RANGE_OPTIONS.find(r => r.type === rangeType)?.label || 'Last 30 Days';
}

function getSportKey(type = '') {
    if (type.includes('Run')) return 'Run';
    if (type.includes('Ride')) return 'Ride';
    if (type.includes('Swim')) return 'Swim';
    if (type.includes('WeightTraining') || type.includes('Workout')) return 'Gym';
    return 'Other';
}

function getValidLoadActivities(activities) {
    return activities
        .filter(activity =>
            activity.tss != null &&
            activity.atl != null &&
            activity.ctl != null &&
            activity.tsb != null &&
            activity.injuryRisk != null
        )
        .sort((a, b) => new Date(a.start_date_local || 0) - new Date(b.start_date_local || 0));
}

function toDisplayTsb(rawTsb) {
    return rawTsb || 0;
}

function percentileRank(values, value) {
    const filtered = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
    if (!filtered.length) return 0.5;
    let count = 0;
    for (const current of filtered) {
        if (current <= value) count += 1;
    }
    return count / filtered.length;
}

function getPmcProfile(loadActivities) {
    const counts = loadActivities.reduce((acc, activity) => {
        const key = getSportKey(activity.type || '');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const total = loadActivities.length || 1;
    const sports = ['Run', 'Ride', 'Swim', 'Gym'];
    const rankedSports = sports
        .map(name => ({ name, count: counts[name] || 0, share: (counts[name] || 0) / total }))
        .sort((a, b) => b.count - a.count);

    const activeSports = rankedSports.filter(sport => sport.share >= 0.15);
    const dominantSport = rankedSports[0]?.name || 'Run';
    const gymShare = rankedSports.find(sport => sport.name === 'Gym')?.share || 0;

    let label = `${dominantSport}-focused endurance`;
    let thresholds = { deepFatigue: -18, fatigue: -8, balanced: 6, fresh: 18 };

    if (activeSports.length >= 3) {
        label = 'multisport endurance';
        thresholds = { deepFatigue: -20, fatigue: -10, balanced: 6, fresh: 18 };
    } else if (gymShare >= 0.25 && activeSports.length >= 2) {
        label = 'hybrid endurance + gym';
        thresholds = { deepFatigue: -14, fatigue: -6, balanced: 6, fresh: 16 };
    } else if (dominantSport === 'Ride') {
        thresholds = { deepFatigue: -24, fatigue: -12, balanced: 6, fresh: 20 };
    } else if (dominantSport === 'Swim') {
        thresholds = { deepFatigue: -16, fatigue: -8, balanced: 7, fresh: 16 };
    } else if (dominantSport === 'Run') {
        thresholds = { deepFatigue: -18, fatigue: -8, balanced: 5, fresh: 18 };
    }

    return { label, thresholds, dominantSport, rankedSports };
}

function renderDashboardTopline(recentActivities) {
    const container = document.getElementById('dashboard-topline');
    if (!container) return;

    const totalDistanceKm = recentActivities.reduce((sum, a) => sum + ((a.distance || 0) / 1000), 0);
    const totalMovingTime = recentActivities.reduce((sum, a) => sum + (a.moving_time || 0), 0);
    const longestActivity = recentActivities.reduce((max, activity) => {
        const distanceKm = (activity.distance || 0) / 1000;
        return distanceKm > max.distanceKm
            ? { distanceKm, type: getSportKey(activity.type || ''), rawType: activity.type || 'Activity' }
            : max;
    }, { distanceKm: 0, type: 'Other', rawType: 'Activity' });

    const sportCounts = recentActivities.reduce((acc, a) => {
        const key = getSportKey(a.type || '');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const sportMixText = ['Run', 'Ride', 'Swim', 'Gym']
        .filter(key => sportCounts[key])
        .map(key => `${key}: ${sportCounts[key]}`)
        .join(' · ') || 'No recent activities in this period';

    container.innerHTML = `
        <div class="dashboard-mini-card">
            <p class="dashboard-mini-label">Activities</p>
            <p class="dashboard-mini-value">${recentActivities.length}</p>
        </div>
        <div class="dashboard-mini-card">
            <p class="dashboard-mini-label">Volume</p>
            <p class="dashboard-mini-value">${totalDistanceKm.toFixed(1)} km</p>
            <p class="dashboard-mini-subvalue">${utils.formatTime(totalMovingTime)}</p>
        </div>
        <div class="dashboard-mini-card">
            <p class="dashboard-mini-label">Longest Session</p>
            <p class="dashboard-mini-value">${longestActivity.distanceKm.toFixed(1)} km</p>
            <p class="dashboard-mini-subvalue">${longestActivity.type}</p>
        </div>
        <div class="dashboard-mini-card dashboard-mini-card-wide">
            <p class="dashboard-mini-label">Sport Mix</p>
            <p class="dashboard-mini-value dashboard-mini-value-small">${sportMixText}</p>
        </div>
    `;
}

function describeCtl(value, context) {
    if (context.ctlPercentile >= 0.85) return `High for your recent ${context.profile.label} baseline. You are near the top of your own rolling fitness range.`;
    if (context.ctlPercentile >= 0.6) return `Solid for your recent ${context.profile.label} baseline. You are carrying a meaningful amount of accumulated work.`;
    if (context.ctlPercentile >= 0.35) return `Moderate for your recent ${context.profile.label} baseline. Fitness is building, but not near your recent ceiling.`;
    return `Low versus your recent ${context.profile.label} history. This usually means rebuilding, recovery, or lower training consistency.`;
}

function describeAtl(value, ctlValue, context) {
    const delta = value - ctlValue;
    if (delta >= 18 || context.atlPercentile >= 0.9) return `Acute load is very high for your ${context.profile.label} pattern. Short-term fatigue should be expected.`;
    if (delta >= 8 || context.atlPercentile >= 0.7) return `Acute load is meaningfully above base. This looks like a hard week or overload block.`;
    if (delta > -4) return 'Acute load is close to your base. That usually means manageable fatigue and normal training continuity.';
    return 'Acute load is below base. You are probably freshening up, tapering, or just carrying a lighter few days.';
}

function describeTsb(value, context) {
    const { deepFatigue, fatigue, balanced, fresh } = context.profile.thresholds;
    if (value <= deepFatigue) return `Deep fatigue for a ${context.profile.label} profile. This can be useful briefly, but recovery cost and injury exposure rise here.`;
    if (value <= fatigue) return `You are carrying notable fatigue for a ${context.profile.label} profile. Good for load accumulation, not ideal for peak performance.`;
    if (value <= balanced) return `This is a productive training zone for your current ${context.profile.label} mix: enough stress to adapt without looking excessively buried.`;
    if (value <= fresh) return `Fresh and usable. For your current profile this is the range where testing, intensity or racing tends to feel better.`;
    return `Very fresh for your recent profile. If it persists, it may reflect under-loading rather than ideal tapering.`;
}

function describeInjuryRisk(value, context) {
    if (value >= 0.75 || context.riskPercentile >= 0.9) return 'Very high estimated risk relative to your recent training history. More load here should be a conscious decision, not background noise.';
    if (value >= 0.5 || context.riskPercentile >= 0.7) return 'Elevated estimated risk. Recovery quality, sleep and spacing of hard sessions matter more than usual.';
    if (value >= 0.25) return 'Moderate estimated risk. Load is present, but still short of the zone where the model becomes strongly defensive.';
    return 'Low estimated risk relative to your recent pattern. Current load balance looks broadly manageable.';
}

function describeRecoveryHours(value, tsbValue) {
    if (value <= 0) return 'Fully recovered! Your body has completed the recovery demand from today\'s activity.';
    if (value >= 72) return 'Extensive recovery needed (3+ days). This follows very hard training or accumulated fatigue. Prioritize sleep and light activity.';
    if (value >= 48) return 'Substantial recovery needed (2–3 days). Your system is heavily loaded. Consider spacing hard sessions or adding active recovery days.';
    if (value >= 24) return 'Moderate recovery needed (1–2 days). Allow rest or easy movement before the next hard effort.';
    if (value >= 12) return 'Light recovery needed (12–24 hours). Next session can be moderate, but avoid back-to-back hard efforts.';
    return 'Minimal recovery needed (< 12 hours). Your system recovered quickly from this session.';
}

function getCtlStatus(value, activities, profile) {
    const ctlValues = activities.map(activity => activity.ctl).filter(Number.isFinite);
    const ctlPercentile = percentileRank(ctlValues, value);

    if (ctlPercentile >= 0.9) {
        return { label: 'Peak fitness', color: '#1f9d55' };
    }
    if (ctlPercentile >= 0.7) {
        return { label: 'High fitness', color: '#27ae60' };
    }
    if (ctlPercentile >= 0.45) {
        return { label: 'Productive', color: '#0074D9' };
    }
    if (ctlPercentile >= 0.25) {
        return { label: 'Maintaining', color: '#f39c12' };
    }
    return { label: `Rebuilding (${profile.label})`, color: '#f39c12' };
}

function getAtlStatus(atlValue, ctlValue) {
    const delta = atlValue - ctlValue;

    if (delta >= 22) {
        return { label: 'Strained', color: '#e74c3c' };
    }
    if (delta >= 12) {
        return { label: 'Overload', color: '#FF851B' };
    }
    if (delta >= 4) {
        return { label: 'Build', color: '#f39c12' };
    }
    if (delta > -6) {
        return { label: 'Productive', color: '#27ae60' };
    }
    return { label: 'Recovery', color: '#0074D9' };
}

function getTsbStatus(tsbValue, profile) {
    const thresholds = profile.thresholds;

    if (tsbValue <= thresholds.deepFatigue) {
        return { label: 'Strained', color: '#e74c3c' };
    }
    if (tsbValue <= thresholds.fatigue) {
        return { label: 'Heavy load', color: '#FF851B' };
    }
    if (tsbValue <= thresholds.balanced) {
        return { label: 'Productive', color: '#27ae60' };
    }
    if (tsbValue <= thresholds.fresh) {
        return { label: 'Race-ready', color: '#0074D9' };
    }
    if (tsbValue <= thresholds.fresh + 8) {
        return { label: 'Recovery', color: '#6c757d' };
    }
    return { label: 'Underload', color: '#8e44ad' };
}

// Garmin-style acute load band:
// "Optimal" zone sits between ~80-120% of 42-day chronic weekly load.
// Conservative narrows the band; aggressive widens it.
function getAcuteLoadBand(profile, ctlValue, mode = acuteLoadBandMode) {
    const weeklyBase = Math.max(10, ctlValue * 7);

    // Garmin uses roughly 0.8×baseline – 1.3×baseline as the productive zone.
    // Conservative  →  0.85 – 1.10  (narrower, lower ceiling)
    // Aggressive    →  0.75 – 1.30  (wider, allows bigger overloads)
    const config = mode === 'aggressive'
        ? { lo: 0.75, hi: 1.30, minWidth: 30 }
        : { lo: 0.85, hi: 1.10, minWidth: 20 };

    let lower = weeklyBase * config.lo;
    let upper = weeklyBase * config.hi;

    // Guarantee a minimum visual width so the band doesn't collapse for low CTL
    if (upper - lower < config.minWidth) {
        const mid = (lower + upper) / 2;
        lower = mid - config.minWidth / 2;
        upper = mid + config.minWidth / 2;
    }
    lower = Math.max(0, lower);

    return {
        lower: +lower.toFixed(1),
        upper: +upper.toFixed(1)
    };
}

function getAcuteLoadStatus(loadValue, band) {
    const tolerance = Math.max(8, (band.upper - band.lower) * 0.08);

    if (loadValue < band.lower - tolerance) {
        return {
            label: 'Below range',
            color: '#0074D9',
            tone: 'low'
        };
    }

    if (loadValue > band.upper + tolerance) {
        return {
            label: 'Above range',
            color: '#e74c3c',
            tone: 'high'
        };
    }

    return {
        label: 'In range',
        color: '#1f9d55',
        tone: 'balanced'
    };
}

function describeAcuteLoadStatus(loadValue, band, profile, status) {
    if (status.tone === 'high') {
        return `Your rolling 7-day load is above the ideal band for a ${profile.label} profile. This is a legitimate overload block, but recovery cost will usually climb fast here.`;
    }

    if (status.tone === 'low') {
        return `Your rolling 7-day load is below the ideal band for a ${profile.label} profile. This normally reflects a recovery week, taper, or a lighter block than your current base could support.`;
    }

    return `Your rolling 7-day load is inside the ideal band for a ${profile.label} profile. This is the closest equivalent here to Garmin's productive acute-load zone.`;
}

function renderAcuteLoadModeSwitch() {
    // Mode is always aggressive, no user selection needed
    return;
}

function buildRollingSevenDayLoad(activities, rangeStart, rangeEnd) {
    const sorted = getValidLoadActivities(activities);
    if (!sorted.length) return null;

    const tssByDay = new Map();
    const metricsByDay = new Map();
    const recoveryByDay = new Map();

    sorted.forEach(activity => {
        const date = new Date(activity.start_date_local);
        const key = toLocalYMD(date);
        tssByDay.set(key, (tssByDay.get(key) || 0) + (activity.tss || 0));

        const existing = metricsByDay.get(key) || { ctlSum: 0, atlSum: 0, tsbSum: 0, riskSum: 0, count: 0 };
        existing.ctlSum += activity.ctl || 0;
        existing.atlSum += activity.atl || 0;
        existing.tsbSum += activity.tsb || 0;
        existing.riskSum += activity.injuryRisk || 0;
        existing.count += 1;
        metricsByDay.set(key, existing);

        // Calculate recovery hours for this day (max of all sessions + weighted sum of rest)
        if (!recoveryByDay.has(key)) {
            recoveryByDay.set(key, []);
        }
        const dayActivities = recoveryByDay.get(key);
        dayActivities.push(activity);
    });

    // Pre-calculate daily recovery hours for each day
    recoveryByDay.forEach((dayActivities, date) => {
        if (dayActivities.length === 1) {
            const recHours = dayActivities[0].recovery_hours ?? 4;
            recoveryByDay.set(date, recHours);
        } else {
            // Multiple sessions in same day: combine them
            const hours = dayActivities.map(a => a.recovery_hours ?? 4);
            const maxH = Math.max(...hours);
            const rest = hours.filter(h => h !== maxH);
            const combined = maxH * 0.7 + (rest.length > 0 ? rest.reduce((s, h) => s + h, 0) * 0.3 : 0);
            const penalty = 1.0 + (hours.length - 1) * 0.12;
            const final = Math.round(Math.min(combined * penalty, 96));
            recoveryByDay.set(date, final);
        }
    });

    const fullStart = new Date(sorted[0].start_date_local || new Date());
    const today = new Date();
    const visibleStart = new Date(rangeStart);
    const visibleEnd = new Date(rangeEnd);

    fullStart.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    visibleStart.setHours(0, 0, 0, 0);
    visibleEnd.setHours(0, 0, 0, 0);

    const labels = [];
    const ctlDaily = [];
    const atlDaily = [];
    const tsbDaily = [];
    const riskDaily = [];
    const recoveryDaily = [];
    const load7d = [];

    let cursor = new Date(fullStart);
    let lastCtl = sorted[0].ctl || 0;
    let lastAtl = sorted[0].atl || 0;
    let lastTsb = sorted[0].tsb || 0;
    let lastRisk = sorted[0].injuryRisk || 0;
    let lastRecovery = sorted[0].recovery_hours || 4;
    let rollingTssSum = 0;
    const rollingTssWindow = [];

    // Calculate from day 0 to TODAY, regardless of visible range
    while (cursor <= today) {
        const key = toLocalYMD(cursor);
        const entry = metricsByDay.get(key);
        const dayTss = tssByDay.get(key) || 0;

        rollingTssWindow.push(dayTss);
        rollingTssSum += dayTss;
        if (rollingTssWindow.length > 7) {
            rollingTssSum -= rollingTssWindow.shift();
        }

        if (entry && entry.count) {
            lastCtl = entry.ctlSum / entry.count;
            lastAtl = entry.atlSum / entry.count;
            lastTsb = entry.tsbSum / entry.count;
            lastRisk = entry.riskSum / entry.count;
        }

        if (recoveryByDay.has(key)) {
            lastRecovery = recoveryByDay.get(key);
        }

        // Always push to arrays so we have full history
        labels.push(key);
        ctlDaily.push(+lastCtl.toFixed(1));
        atlDaily.push(+lastAtl.toFixed(1));
        tsbDaily.push(+(toDisplayTsb(lastTsb)).toFixed(1));
        riskDaily.push(+lastRisk.toFixed(3));
        recoveryDaily.push(lastRecovery);
        load7d.push(+rollingTssSum.toFixed(1));

        cursor = addDays(cursor, 1);
    }

    // Return full series and visible range info
    return {
        labels, load7d, ctlDaily, atlDaily, tsbDaily, riskDaily, recoveryDaily, sorted,
        fullStart, today, visibleStart, visibleEnd
    };
}

function getPercentileValue(values, percentile) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * percentile)));
    return sorted[idx];
}

function formatSigned(value, digits = 1) {
    if (!Number.isFinite(value)) return 'N/A';
    if (value > 0) return `+${value.toFixed(digits)}`;
    if (value < 0) return `-${Math.abs(value).toFixed(digits)}`;
    return (0).toFixed(digits);
}

function isValueInBand(value, band) {
    const minOk = band.min == null ? true : value >= band.min;
    const maxOk = band.max == null ? true : value < band.max;
    return minOk && maxOk;
}

function renderBandRows(bands, currentValue, formatRange) {
    return bands.map(band => {
        const active = isValueInBand(currentValue, band);
        return `
            <div style="display:flex;align-items:flex-start;gap:.6rem;padding:.5rem .55rem;border-radius:8px;background:${active ? `${band.color}18` : '#fff'};border:1px solid ${active ? `${band.color}66` : '#e6e6e6'};margin-bottom:.4rem;">
                <span style="width:10px;height:10px;border-radius:50%;background:${band.color};margin-top:.35rem;flex:0 0 auto;"></span>
                <div style="display:flex;flex-direction:column;gap:.12rem;min-width:0;">
                    <div style="display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;">
                        <strong>${band.label}</strong>
                        <small style="opacity:.7;">${formatRange(band)}</small>
                        ${band.isIdeal ? '<small style="padding:.05rem .35rem;border-radius:999px;background:#1f9d5518;color:#1f9d55;border:1px solid #1f9d5540;">Ideal</small>' : ''}
                        ${active ? '<small style="padding:.05rem .35rem;border-radius:999px;background:#0074d918;color:#0074D9;border:1px solid #0074D940;">Current</small>' : ''}
                    </div>
                    <small style="opacity:.86;line-height:1.35;">${band.meaning}</small>
                </div>
            </div>
        `;
    }).join('');
}

function buildCtlBands(ctlValues) {
    const p25 = getPercentileValue(ctlValues, 0.25);
    const p45 = getPercentileValue(ctlValues, 0.45);
    const p70 = getPercentileValue(ctlValues, 0.70);
    const p90 = getPercentileValue(ctlValues, 0.90);

    return [
        {
            label: 'Rebuilding',
            min: null,
            max: p25,
            color: '#f39c12',
            isIdeal: false,
            meaning: 'Low chronic load for your own history. Typical during reset blocks, low consistency, or return-to-training phases.'
        },
        {
            label: 'Maintaining',
            min: p25,
            max: p45,
            color: '#6c757d',
            isIdeal: false,
            meaning: 'Stable but modest long-term load. Good for maintenance, but usually not enough to push fitness up quickly.'
        },
        {
            label: 'Productive',
            min: p45,
            max: p70,
            color: '#27ae60',
            isIdeal: true,
            meaning: 'Sustainable fitness-building territory with manageable fatigue for most training cycles.'
        },
        {
            label: 'High fitness',
            min: p70,
            max: p90,
            color: '#1f9d55',
            isIdeal: true,
            meaning: 'Strong chronic conditioning. Usually effective for race-specific phases if recovery habits stay consistent.'
        },
        {
            label: 'Peak fitness',
            min: p90,
            max: null,
            color: '#0074D9',
            isIdeal: false,
            meaning: 'Top end of your recent CTL distribution. Powerful but harder to sustain for long.'
        }
    ];
}

function buildAtlBands(currentCtl) {
    return [
        {
            label: 'Recovery',
            min: null,
            max: -6,
            color: '#0074D9',
            isIdeal: false,
            meaning: 'ATL well below CTL. Usually indicates tapering, deloading, or reduced short-term stress.'
        },
        {
            label: 'Productive',
            min: -6,
            max: 4,
            color: '#27ae60',
            isIdeal: true,
            meaning: 'Acute load close to base load. Good balance between stimulus and recoverability.'
        },
        {
            label: 'Build',
            min: 4,
            max: 12,
            color: '#f39c12',
            isIdeal: true,
            meaning: 'Short-term load above baseline. Useful for progression blocks when sleep and easy days are protected.'
        },
        {
            label: 'Overload',
            min: 12,
            max: 22,
            color: '#FF851B',
            isIdeal: false,
            meaning: 'High acute stress. Effective only in controlled blocks; fatigue and injury exposure increase.'
        },
        {
            label: 'Strained',
            min: 22,
            max: null,
            color: '#e74c3c',
            isIdeal: false,
            meaning: 'Very high acute load versus base. Keep this short and intentional, with recovery planned.'
        }
    ].map(band => ({
        ...band,
        absoluteMin: band.min == null ? null : currentCtl + band.min,
        absoluteMax: band.max == null ? null : currentCtl + band.max
    }));
}

function buildTsbBands(profile) {
    const t = profile.thresholds;
    return [
        {
            label: 'Strained',
            min: null,
            max: t.deepFatigue,
            color: '#e74c3c',
            isIdeal: false,
            meaning: 'Deep fatigue state. Useful only briefly in heavy blocks, then followed by recovery.'
        },
        {
            label: 'Heavy load',
            min: t.deepFatigue,
            max: t.fatigue,
            color: '#FF851B',
            isIdeal: false,
            meaning: 'Substantial fatigue. Strong training stress, but low freshness for quality performance.'
        },
        {
            label: 'Productive',
            min: t.fatigue,
            max: t.balanced,
            color: '#27ae60',
            isIdeal: true,
            meaning: 'Balanced training zone where adaptation often improves without excessive residual fatigue.'
        },
        {
            label: 'Race-ready',
            min: t.balanced,
            max: t.fresh,
            color: '#0074D9',
            isIdeal: true,
            meaning: 'Fresh enough for quality sessions, testing, or racing while keeping some fitness tension.'
        },
        {
            label: 'Recovery',
            min: t.fresh,
            max: t.fresh + 8,
            color: '#6c757d',
            isIdeal: false,
            meaning: 'Very fresh state. Good for regeneration, but prolonged time here can reduce training momentum.'
        },
        {
            label: 'Underload',
            min: t.fresh + 8,
            max: null,
            color: '#8e44ad',
            isIdeal: false,
            meaning: 'Too fresh for too long. Usually signals insufficient load to drive continued fitness gains.'
        }
    ];
}

function renderAcuteLoadExplanation(visibleActivities, historyActivities, profile, currentBand, currentStatus, currentLoad, currentCtl, currentAtl, currentTsb, currentRisk, currentRecovery = 4) {
    const container = document.getElementById('acute-load-explainer');
    if (!container) return;

    if (!historyActivities.length) {
        container.innerHTML = '';
        return;
    }

    const deltaToTop = currentBand.upper - currentLoad;
    const deltaToBottom = currentLoad - currentBand.lower;
    const gapText = currentStatus.tone === 'high'
        ? `${(currentLoad - currentBand.upper).toFixed(1)} above the band`
        : currentStatus.tone === 'low'
            ? `${(currentBand.lower - currentLoad).toFixed(1)} below the band`
            : `${Math.min(deltaToTop, deltaToBottom).toFixed(1)} from edge`;

    const ctlStatus = getCtlStatus(currentCtl, historyActivities, profile);
    const atlStatus = getAtlStatus(currentAtl, currentCtl);
    const tsbStatus = getTsbStatus(currentTsb, profile);
    const context = {
        profile,
        ctlPercentile: percentileRank(historyActivities.map(a => a.ctl), currentCtl),
        atlPercentile: percentileRank(historyActivities.map(a => a.atl), currentAtl),
        riskPercentile: percentileRank(historyActivities.map(a => a.injuryRisk), currentRisk)
    };

    // Total load in range
    const totalLoad = visibleActivities.reduce((s, a) => s + (a.tss || 0), 0).toFixed(0);

    // Weekly delta (last 14 days)
    const now = new Date();
    const recent14 = historyActivities.filter(a => (now - new Date(a.start_date_local)) / 86400000 <= 14);
    const week1Load = recent14.filter(a => (now - new Date(a.start_date_local)) / 86400000 <= 7).reduce((s, a) => s + (a.tss || 0), 0);
    const week2Load = recent14.filter(a => (now - new Date(a.start_date_local)) / 86400000 > 7).reduce((s, a) => s + (a.tss || 0), 0);
    const weekDeltaPct = week2Load > 0 ? ((week1Load - week2Load) / week2Load) * 100 : 0;
    const weekTrend = weekDeltaPct > 0 ? `▲ ${Math.abs(weekDeltaPct).toFixed(0)}%` : `▼ ${Math.abs(weekDeltaPct).toFixed(0)}%`;
    const weekTrendColor = getTrendColor(weekDeltaPct);

    // Ideal ranges
    const th = profile.thresholds;
    const ctlValues = historyActivities.map(a => a.ctl).filter(Number.isFinite);
    const ctlMax = Math.max(...ctlValues);
    const ctlIdealLow = (ctlMax * 0.6).toFixed(1);
    const ctlIdealHigh = ctlMax.toFixed(1);
    const atlIdealLow = (currentCtl * 0.8).toFixed(1);
    const atlIdealHigh = (currentCtl * 1.5).toFixed(1);
    const tsbIdealLow = th.fatigue.toFixed(0);
    const tsbIdealHigh = th.fresh.toFixed(0);
    const ctlBands = buildCtlBands(ctlValues);
    const atlBands = buildAtlBands(currentCtl);
    const tsbBands = buildTsbBands(profile);
    const atlDelta = currentAtl - currentCtl;

    const ctlBandsHtml = renderBandRows(ctlBands, currentCtl, band => {
        if (band.min == null) return `< ${band.max.toFixed(1)}`;
        if (band.max == null) return `>= ${band.min.toFixed(1)}`;
        return `${band.min.toFixed(1)} to ${band.max.toFixed(1)}`;
    });

    const atlBandsHtml = renderBandRows(atlBands, atlDelta, band => {
        const rel = band.min == null
            ? `< ${formatSigned(band.max, 1)} vs CTL`
            : band.max == null
                ? `>= ${formatSigned(band.min, 1)} vs CTL`
                : `${formatSigned(band.min, 1)} to ${formatSigned(band.max, 1)} vs CTL`;

        const abs = band.absoluteMin == null
            ? `< ${band.absoluteMax.toFixed(1)} ATL`
            : band.absoluteMax == null
                ? `>= ${band.absoluteMin.toFixed(1)} ATL`
                : `${band.absoluteMin.toFixed(1)} to ${band.absoluteMax.toFixed(1)} ATL`;

        return `${rel} (${abs})`;
    });

    const tsbBandsHtml = renderBandRows(tsbBands, currentTsb, band => {
        if (band.min == null) return `< ${band.max.toFixed(1)}`;
        if (band.max == null) return `>= ${band.min.toFixed(1)}`;
        return `${band.min.toFixed(1)} to ${band.max.toFixed(1)}`;
    });

    container.innerHTML = `
        <div class="acute-load-summary-card">
            <div class="acute-load-summary-topline">
                <span class="acute-load-kicker">7-day load</span>
                <span class="acute-load-status" style="color:${currentStatus.color};border-color:${currentStatus.color}33;background:${currentStatus.color}12;">${currentStatus.label}</span>
            </div>
            <div class="acute-load-summary-metrics">
                <div>
                    <strong>${currentLoad.toFixed(1)}</strong>
                    <span>7d TSS</span>
                </div>
                <div>
                    <strong>${currentBand.lower.toFixed(1)} – ${currentBand.upper.toFixed(1)}</strong>
                    <span>Ideal range (${acuteLoadBandMode === 'aggressive' ? 'aggr.' : 'cons.'})</span>
                </div>
                <div>
                    <strong>${gapText}</strong>
                    <span>Gap</span>
                </div>
                <div>
                    <strong>${totalLoad}</strong>
                    <span>Period TSS</span>
                </div>
                <div>
                    <strong style="color:${weekTrendColor}">${weekTrend}</strong>
                    <span>Week ?</span>
                </div>
            </div>
            <p style="margin-bottom:.3rem;">${describeAcuteLoadStatus(currentLoad, currentBand, profile, currentStatus)}</p>
        </div>
        <div class="pmc-explainer-card pmc-explainer-ctl">
            <div class="pmc-explainer-header">
                <span class="pmc-dot"></span>
                <strong>CTL</strong> <small style="opacity:.65;">Fitness · ~42d</small>
                <span class="pmc-explainer-value" style="color:${ctlStatus.color};">${currentCtl.toFixed(1)} · ${ctlStatus.label}</span>
            </div>
            <small><strong>CTL (Chronic Training Load / fitness)</strong> is the 42-day exponentially weighted average of your daily TSS. Higher values mean stronger long-term fitness capacity.</small>
            <small style="margin-top:.2rem;display:block;">${describeCtl(currentCtl, context)} <span style="opacity:.6;">Ideal: ${ctlIdealLow}–${ctlIdealHigh} (your recent range).</span></small>
            <details style="margin-top:.55rem;">
                <summary style="cursor:pointer;font-weight:600;color:#2f3b52;">Show CTL ranges</summary>
                <div style="margin-top:.55rem;">
                    ${ctlBandsHtml}
                </div>
            </details>
        </div>
        <div class="pmc-explainer-card pmc-explainer-atl">
            <div class="pmc-explainer-header">
                <span class="pmc-dot"></span>
                <strong>ATL</strong> <small style="opacity:.65;">Fatigue · ~7d</small>
                <span class="pmc-explainer-value" style="color:${atlStatus.color};">${currentAtl.toFixed(1)} · ${atlStatus.label}</span>
            </div>
            <small><strong>ATL (Acute Training Load / fatigue)</strong> is the 7-day exponentially weighted average of daily TSS. It rises quickly with hard training and drops quickly with recovery.</small>
            <small style="margin-top:.2rem;display:block;">${describeAtl(currentAtl, currentCtl, context)} <span style="opacity:.6;">Productive range: ${atlIdealLow}–${atlIdealHigh} (0.8–1.5× CTL).</span></small>
            <small style="margin-top:.2rem;display:block;opacity:.72;">Current ATL−CTL: ${formatSigned(atlDelta, 1)}</small>
            <details style="margin-top:.55rem;">
                <summary style="cursor:pointer;font-weight:600;color:#2f3b52;">Show ATL ranges</summary>
                <div style="margin-top:.55rem;">
                    ${atlBandsHtml}
                </div>
            </details>
        </div>
        <div class="pmc-explainer-card pmc-explainer-tsb">
            <div class="pmc-explainer-header">
                <span class="pmc-dot"></span>
                <strong>TSB</strong> <small style="opacity:.65;">Form · CTL−ATL</small>
                <span class="pmc-explainer-value" style="color:${tsbStatus.color};">${currentTsb.toFixed(1)} · ${tsbStatus.label}</span>
            </div>
            <small><strong>TSB (Training Stress Balance / form)</strong> is CTL − ATL. Positive values usually mean freshness, while negative values mean fatigue from load accumulation.</small>
            <small style="margin-top:.2rem;display:block;">${describeTsb(currentTsb, context)} <span style="opacity:.6;">Productive zone: ${tsbIdealLow} to ${tsbIdealHigh} for ${profile.label}.</span></small>
            <details style="margin-top:.55rem;">
                <summary style="cursor:pointer;font-weight:600;color:#2f3b52;">Show TSB ranges</summary>
                <div style="margin-top:.55rem;">
                    ${tsbBandsHtml}
                </div>
            </details>
        </div>
        <div class="pmc-explainer-card pmc-explainer-risk">
            <div class="pmc-explainer-header">
                <span class="pmc-dot"></span>
                <strong>Injury Risk</strong>
                <span class="pmc-explainer-value">${currentRisk.toFixed(3)}</span>
            </div>
            <small>${describeInjuryRisk(currentRisk, context)} <span style="opacity:.6;">Ideal &lt; 0.25.</span></small>
        </div>
        <div class="pmc-explainer-card pmc-explainer-recovery">
            <div class="pmc-explainer-header">
                <span class="pmc-dot"></span>
                <strong>Recovery Hours</strong> <small style="opacity:.65;">Est. needed today</small>
                <span class="pmc-explainer-value">${currentRecovery}h</span>
            </div>
            <small><strong>Recovery Hours</strong> is the estimated physical recovery time your body needs after today's training load, based on activity type, intensity, duration, and accumulated fatigue (TSB). Higher values indicate more recovery is needed.</small>
            <small style="margin-top:.2rem;display:block;">${describeRecoveryHours(currentRecovery, currentTsb)} <span style="opacity:.6;">Range: 4–96 hours.</span></small>
        </div>
    `;
}

/**
 * Calculate actual recovery hours remaining based on the most recent activity time today
 * If the activity was done many hours ago, recovery might already be complete
 */
function calculateRecoveryHoursRemaining(activitiesToday, recoveryHoursNeeded) {
    if (!activitiesToday || activitiesToday.length === 0) {
        return 0; // No activities today, fully recovered
    }

    // Find the most recent activity by timestamp
    const mostRecent = activitiesToday.reduce((latest, activity) => {
        const actTime = new Date(activity.start_date_local).getTime();
        const latestTime = new Date(latest.start_date_local).getTime();
        return actTime > latestTime ? activity : latest;
    });

    // Calculate hours elapsed since that activity
    const activityTime = new Date(mostRecent.start_date_local);
    const now = new Date();
    const elapsedMs = now.getTime() - activityTime.getTime();
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    // Calculate remaining recovery hours
    const remaining = Math.max(0, recoveryHoursNeeded - elapsedHours);

    return Math.round(remaining * 10) / 10; // Round to 1 decimal place
}

/**
 * Get today's activities from the sorted array
 */
function getTodaysActivities(sortedActivities) {
    const today = new Date();
    const todayStr = toLocalYMD(today);

    return sortedActivities.filter(activity => {
        const actDate = new Date(activity.start_date_local);
        const actDateStr = toLocalYMD(actDate);
        return actDateStr === todayStr;
    });
}

/**
 * Setup event listeners for TSS unit selector (only once)
 */
function setupTSSUnitSelector() {
    const selector = document.querySelector('.tss-unit-selector');
    if (!selector || selector.dataset.listenerReady) return;
    selector.dataset.listenerReady = '1';

    const radios = selector.querySelectorAll('input[name="tss-unit"]');
    radios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            tssUnit = e.target.value;
            renderTSSBarChart(dashboardRenderContext.allActivities, selectedRangeDays);
        });
    });
}

/**
 * Setup chart click handlers for fullscreen modal
 */
function setupChartClickHandlers() {
    const chartContainers = document.querySelectorAll('.chart-container');
    chartContainers.forEach(container => {
        const canvas = container.querySelector('canvas');
        const title = container.querySelector('h3');
        if (canvas && !canvas.dataset.modalReady) {
            canvas.dataset.modalReady = '1';
            canvas.style.cursor = 'pointer';
            canvas.addEventListener('click', () => {
                openChartModal(canvas, title ? title.textContent : 'Chart');
            });
        }
    });

    // Add modal close listeners (only once)
    const modal = document.getElementById('chart-modal');
    if (modal && !modal.dataset.listenersReady) {
        modal.dataset.listenersReady = '1';

        // Close when clicking outside the content
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeChartModal();
            }
        });

        // Close button
        const closeBtn = modal.querySelector('.chart-modal-close');
        if (closeBtn) {
            closeBtn.onclick = closeChartModal;
        }

        // Keyboard escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeChartModal();
            }
        });
    }
}

/**
 * Open chart in fullscreen modal
 */
function openChartModal(canvas, title) {
    const modal = document.getElementById('chart-modal');
    const container = document.getElementById('chart-modal-canvas-container');
    if (!modal || !container) return;

    // Convert canvas to image for display in modal
    const imageUrl = canvas.toDataURL('image/png');
    container.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:1rem;width:100%;height:100%;">
            <h2 style="margin:0;">${title}</h2>
            <img src="${imageUrl}" style="width:100%;height:auto;max-height:calc(95vh - 60px);object-fit:contain;" />
        </div>
    `;

    modal.classList.add('active');
}

/**
 * Close chart modal
 */
function closeChartModal() {
    const modal = document.getElementById('chart-modal');
    if (modal) {
        modal.classList.remove('active');
        document.getElementById('chart-modal-canvas-container').innerHTML = '';
    }
}

export function renderDashboardTab(allActivities, dateFilterFrom, dateFilterTo) {
    dashboardRenderContext = { allActivities, dateFilterFrom, dateFilterTo };
    const container = document.getElementById('dashboard-tab');
    if (container && !document.getElementById('range-selector')) {
        const rangeDiv = document.createElement('div');
        rangeDiv.id = 'range-selector';
        rangeDiv.style = 'display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap;';
        container.prepend(rangeDiv);
    }

    renderRangeSelector();
    renderDashboardContent(allActivities, dateFilterFrom, dateFilterTo);
}

function renderRangeSelector() {
    const container = document.getElementById('range-selector');
    if (!container) return;

    const fromDisplay = customDateFromIso ? utils.isoToDisplayDate(customDateFromIso) : '';
    const toDisplay = customDateToIso ? utils.isoToDisplayDate(customDateToIso) : '';

    container.innerHTML = RANGE_OPTIONS.map(r => `
        <button
            class="range-btn ${r.type === selectedRangeDays ? 'active' : ''}"
            data-type="${r.type}">
            ${r.label}
        </button>
    `).join('') + `
        <input type="text" id="dashboard-date-from" placeholder="DD/MM/YYYY" value="${fromDisplay}">
        <input type="text" id="dashboard-date-to" placeholder="DD/MM/YYYY" value="${toDisplay}">
        <button id="dashboard-date-apply">Apply</button>
    `;

    container.querySelectorAll('.range-btn').forEach(btn => {
        btn.onclick = () => {
            selectedRangeDays = btn.dataset.type;
            customDateFromIso = null;
            customDateToIso = null;
            const fromInput = document.getElementById('dashboard-date-from');
            const toInput = document.getElementById('dashboard-date-to');
            if (fromInput) fromInput.value = '';
            if (toInput) toInput.value = '';
            // Update active class immediately for snappy feedback
            container.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Defer heavy render to next frame
            requestAnimationFrame(() => {
                const ctx = dashboardRenderContext;
                renderDashboardContent(ctx.allActivities, ctx.dateFilterFrom, ctx.dateFilterTo);
            });
        };
    });

    const applyBtn = document.getElementById('dashboard-date-apply');
    if (applyBtn) {
        applyBtn.onclick = () => {
            const fromInput = document.getElementById('dashboard-date-from');
            const toInput = document.getElementById('dashboard-date-to');
            const fromIso = utils.parseDateInputToIso(fromInput ? fromInput.value : '');
            const toIso = utils.parseDateInputToIso(toInput ? toInput.value : '');
            if (!fromIso || !toIso) return;
            if (fromIso > toIso) return;
            customDateFromIso = fromIso;
            customDateToIso = toIso;
            selectedRangeDays = 'custom';
            container.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            requestAnimationFrame(() => {
                const ctx = dashboardRenderContext;
                renderDashboardContent(ctx.allActivities, ctx.dateFilterFrom, ctx.dateFilterTo);
            });
        };
    }
}


function renderDashboardContent(allActivities, dateFilterFrom, dateFilterTo) {
    dashboardRenderContext = { allActivities, dateFilterFrom, dateFilterTo };

    if (lastActivitiesRef !== allActivities) {
        dashboardMemo.clear();
        lastActivitiesRef = allActivities;
    }

    const { startDate, endDate } = getEffectiveDashboardWindow(dateFilterFrom, dateFilterTo);
    const memoKey = `${startDate.getTime()}|${endDate.getTime()}|${dateFilterFrom || ''}|${dateFilterTo || ''}`;

    let cached = dashboardMemo.get(memoKey);
    if (!cached) {
        const filteredActivities = utils.filterActivitiesByDate(allActivities, dateFilterFrom, dateFilterTo);
        const runs = filteredActivities
            .filter(a => a.type && a.type.includes('Run'))
            .sort((a, b) => new Date(a.start_date_local || 0) - new Date(b.start_date_local || 0));

        const windowMs = Math.max(24 * 3600 * 1000, endDate.getTime() - startDate.getTime());
        const previousStartDate = new Date(startDate.getTime() - windowMs);
        const previousEndDate = new Date(startDate.getTime() - 1);

        const recentRuns = runs.filter(r => {
            const d = new Date(r.start_date_local);
            return d >= startDate && d <= endDate;
        });

        const previousRuns = runs.filter(r => {
            const d = new Date(r.start_date_local);
            return d >= previousStartDate && d <= previousEndDate;
        });

        const recentActivities = filteredActivities.filter(activity => {
            const d = new Date(activity.start_date_local);
            return d >= startDate && d <= endDate;
        });

        const previousActivities = filteredActivities.filter(activity => {
            const d = new Date(activity.start_date_local);
            return d >= previousStartDate && d <= previousEndDate;
        });

        cached = { filteredActivities, runs, recentRuns, previousRuns, recentActivities, previousActivities };
        dashboardMemo.set(memoKey, cached);
    }

    const { recentRuns, previousRuns, recentActivities, previousActivities } = cached;

    renderDashboardTopline(recentActivities);
    renderDashboardSummary(recentActivities, previousActivities, recentRuns, previousRuns);

    // Render heavy charts in next frame to avoid blocking UI
    requestAnimationFrame(() => {
        renderTrainingReadiness(allActivities, startDate, endDate);
        renderAcuteLoadChart(allActivities, startDate, endDate);
        renderTSSBarChart(recentActivities, selectedRangeDays);
        setupTSSUnitSelector();
        renderGoalsSectionAdvanced(allActivities);
        setupChartClickHandlers();
    });
}


let dashboardCharts = {};
function createDashboardChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error(`Canvas with id ${canvasId} not found.`);
        return;
    }
    if (dashboardCharts[canvasId]) {
        dashboardCharts[canvasId].destroy();
    }
    dashboardCharts[canvasId] = new Chart(canvas, config);
}



function renderDashboardSummary(currentActivities, previousActivities, currentRuns, previousRuns) {
    const container = document.getElementById('dashboard-summary');
    if (!container) return;
    if (!currentActivities.length) {
        container.innerHTML = "<p>Not enough data.</p>";
        return;
    }

    const safeDistanceKm = activity => (activity.distance || 0) / 1000;
    const safeHours = activity => (activity.moving_time || 0) / 3600;
    const sum = (arr, fn) => arr.reduce((acc, item) => acc + fn(item), 0);
    const avg = values => values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : null;
    const numeric = values => values.filter(value => Number.isFinite(value));

    const calcChange = (current, previous) => {
        if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
        return ((current - previous) / previous) * 100;
    };

    const trendVisual = (metric, change) => {
        if (!Number.isFinite(change)) {
            return { icon: '•', color: '#888', label: 'N/A' };
        }

        // For metrics where less is better (HR, injury), invert the colors
        const lowerIsBetter = ['hr', 'injury'].includes(metric);
        const improved = lowerIsBetter ? change < 0 : change > 0;
        const icon = change === 0 ? '•' : (improved ? '▲' : '▼');
        const color = change === 0 ? '#888' : (improved ? '#27ae60' : '#e74c3c');
        return { icon, color, label: `${change > 0 ? '+' : ''}${change.toFixed(1)}%` };
    };

    const totalDistance = sum(currentActivities, safeDistanceKm);
    const totalTime = sum(currentActivities, safeHours);
    const totalElevation = sum(currentActivities, activity => activity.total_elevation_gain || 0);

    const prevDistance = sum(previousActivities, safeDistanceKm);
    const prevTime = sum(previousActivities, safeHours);
    const prevElevation = sum(previousActivities, activity => activity.total_elevation_gain || 0);

    const currentAvgHR = avg(numeric(currentActivities.map(activity => activity.average_heartrate)));
    const previousAvgHR = avg(numeric(previousActivities.map(activity => activity.average_heartrate)));

    const currentInjury = avg(numeric(currentActivities.map(activity => activity.injuryRisk)));
    const previousInjury = avg(numeric(previousActivities.map(activity => activity.injuryRisk)));

    const currentTotalTss = sum(currentActivities, activity => activity.tss ?? (activity.suffer_score ? activity.suffer_score * 1.05 : 0));
    const previousTotalTss = sum(previousActivities, activity => activity.tss ?? (activity.suffer_score ? activity.suffer_score * 1.05 : 0));

    const distChange = calcChange(totalDistance, prevDistance);
    const timeChange = calcChange(totalTime, prevTime);
    const elevChange = calcChange(totalElevation, prevElevation);
    const hrChange = calcChange(currentAvgHR, previousAvgHR);
    const injuryRiskChange = calcChange(currentInjury, previousInjury);
    const tssChange = calcChange(currentTotalTss, previousTotalTss);

    const distTrend = trendVisual('distance', distChange);
    const timeTrend = trendVisual('time', timeChange);
    const elevTrend = trendVisual('elevation', elevChange);
    const injuryTrend = trendVisual('injury', injuryRiskChange);
    const hrTrend = trendVisual('hr', hrChange);
    const tssTrend = trendVisual('load', tssChange);


    // --- Renderizado ---
    container.innerHTML = `
        <div class="card">
            <h3>Total Distance</h3>
            <p style="font-size:2rem;font-weight:bold;color:#0074D9;">${totalDistance.toFixed(1)} km</p>
            <small><span style="color:${distTrend.color};">${distTrend.icon} ${distTrend.label}</span></small>
        </div>

        <div class="card">
            <h3>Total Moving Time</h3>
            <p style="font-size:2rem;font-weight:bold;color:#B10DC9;">${totalTime.toFixed(1)} h</p>
            <small><span style="color:${timeTrend.color};">${timeTrend.icon} ${timeTrend.label}</span></small>
        </div>

        <div class="card">
            <h3>Total Elevation Gain</h3>
            <p style="font-size:2rem;font-weight:bold;color:#2ECC40;">${totalElevation.toFixed(0)} m</p>
            <small><span style="color:${elevTrend.color};">${elevTrend.icon} ${elevTrend.label}</span></small>
        </div>

        <div class="card">
            <h3>Injury Risk Index</h3>
            <p style="font-size:2rem;font-weight:bold;color:#FF4136;">${Number.isFinite(currentInjury) ? currentInjury.toFixed(3) : '–'}</p>
            <small><span style="color:${injuryTrend.color};">${injuryTrend.icon} ${injuryTrend.label}</span></small>
        </div>

        <div class="card">
            <h3>Average Heart Rate</h3>
            <p style="font-size:2rem;font-weight:bold;color:#FF4136;">${Number.isFinite(currentAvgHR) ? currentAvgHR.toFixed(0) : '–'} bpm</p>
            <small><span style="color:${hrTrend.color};">${hrTrend.icon} ${hrTrend.label}</span></small>
        </div>
        
    `;


}

/**
 * Renders Training Load Metrics (CTL, ATL, TSB, Injury Risk, Load)
 * Uses preprocessed activities with .tss, .atl, .ctl, .tsb, .injuryRisk
 */
// Helper
function getTrendColor(pct) {
    if (pct > 15) return '#e74c3c';
    if (pct > 5) return '#f39c12';
    if (pct < -10) return '#e74c3c';
    if (pct < -5) return '#f39c12';
    return '#27ae60';
}


// =================================================================
// TRAINING READINESS SCORE CALCULATION
// =================================================================

/**
 * Clamp any numeric value to [0, 1]
 */
function normalize01(value) {
    return Math.max(0, Math.min(1, value));
}

/**
 * TSB score aligned with the same freshness language used in Training Load & Performance.
 */
function getReadinessTsbScore(tsbValue, profile) {
    const t = profile.thresholds;
    if (tsbValue >= 15) return 1.0;
    if (tsbValue >= 5) return 0.92;
    if (tsbValue >= -5) return 0.74;
    if (tsbValue >= t.fatigue) return 0.56;
    if (tsbValue >= t.deepFatigue) return 0.36;
    return 0.16;
}

/**
 * CTL score using personal percentile context.
 */
function getReadinessCtlScore(ctlValue, ctlValues) {
    if (!ctlValues || ctlValues.length === 0) return 0.5;
    const ctlPercentile = percentileRank(ctlValues, ctlValue);
    return normalize01(0.25 + ctlPercentile * 0.9);
}

/**
 * ATL fatigue score (high = more fatigue) aligned with ATL-CTL interpretation.
 */
function getReadinessAtlFatigueScore(atlValue, ctlValue) {
    const delta = (atlValue || 0) - (ctlValue || 0);
    if (delta <= -6) return 0.22;
    if (delta <= 4) return 0.34;
    if (delta <= 12) return 0.56;
    if (delta <= 22) return 0.80;
    return 1.0;
}

function getReadinessInjuryScore(injuryRisk) {
    if (!Number.isFinite(injuryRisk)) return 0.5;
    return normalize01(1 - injuryRisk);
}

/**
 * ACWR-like load stability score from rolling 7d load vs 28d baseline.
 */
function getReadinessLoadStabilityScore(load7dSeries, index) {
    const load7d = load7dSeries[index] || 0;
    const start = Math.max(0, index - 27);
    const window = load7dSeries.slice(start, index + 1).filter(Number.isFinite);
    const baseline = window.length ? window.reduce((sum, value) => sum + value, 0) / window.length : load7d;
    if (!Number.isFinite(baseline) || baseline <= 0) return 0.65;

    const ratio = load7d / baseline;
    if (ratio >= 0.9 && ratio <= 1.3) return 1.0;
    if (ratio < 0.9) return Math.max(0.58, 0.88 - (0.9 - ratio) * 0.6);
    if (ratio > 1.4) return Math.max(0.0, 0.72 - (ratio - 1.4) * 0.9);
    return 0.82;
}

/**
 * Band-consistency score using the same acute load band logic.
 */
function getReadinessBandScore(load7d, band) {
    const width = Math.max(1, band.upper - band.lower);
    if (load7d >= band.lower && load7d <= band.upper) return 1.0;
    if (load7d < band.lower) {
        const gap = band.lower - load7d;
        return Math.max(0.28, 1 - gap / (width * 0.95 + 12));
    }
    const gap = load7d - band.upper;
    return Math.max(0.0, 1 - gap / (width * 0.7 + 10));
}

/**
 * Injury risk is kept as contextual information only.
 * It no longer affects the readiness score.
 */
function getReadinessInjuryPenalty(injuryRisk) {
    return 0;
}

function getReadinessHrvScore(hrvEntry) {
    if (!hrvEntry) return null;

    const width = Math.max(6, (hrvEntry.referenceHigh || 0) - (hrvEntry.referenceLow || 0));
    const nightly = hrvEntry.nightly;
    const avg7 = Number.isFinite(hrvEntry.avg7) ? hrvEntry.avg7 : nightly;

    const distanceToBand = value => {
        if (value < hrvEntry.referenceLow) return hrvEntry.referenceLow - value;
        if (value > hrvEntry.referenceHigh) return value - hrvEntry.referenceHigh;
        return 0;
    };

    const nightlyDistance = distanceToBand(nightly);
    const avgDistance = distanceToBand(avg7);
    const nightlyScore = nightlyDistance === 0 ? 1 : Math.max(0.1, 1 - nightlyDistance / (width * 0.75 + 6));
    const avgScore = avgDistance === 0 ? 1 : Math.max(0.1, 1 - avgDistance / (width * 0.9 + 8));
    const stabilityScore = Math.max(0.35, 1 - Math.abs(nightly - avg7) / (width + 10));

    return normalize01(avgScore * 0.5 + nightlyScore * 0.35 + stabilityScore * 0.15);
}

/**
 * Smooth readiness to prevent abrupt day-to-day spikes.
 */
function smoothReadinessSeries(values, window = 5, maxDailyDelta = 8) {
    const averaged = values.map((_, idx) => {
        const start = Math.max(0, idx - Math.floor(window / 2));
        const end = Math.min(values.length, idx + Math.ceil(window / 2));
        const section = values.slice(start, end).filter(Number.isFinite);
        if (!section.length) return null;
        return section.reduce((sum, value) => sum + value, 0) / section.length;
    });

    const smoothed = [];
    for (let i = 0; i < averaged.length; i++) {
        const current = averaged[i];
        if (!Number.isFinite(current)) {
            smoothed.push(null);
            continue;
        }

        if (smoothed.length === 0 || !Number.isFinite(smoothed[smoothed.length - 1])) {
            smoothed.push(current);
            continue;
        }

        const prev = smoothed[smoothed.length - 1];
        const delta = Math.max(-maxDailyDelta, Math.min(maxDailyDelta, current - prev));
        smoothed.push(prev + delta);
    }

    return smoothed;
}

/**
 * Build a daily readiness series from existing PMC/load series.
 * This keeps readiness coherent with the Training Load & Performance section.
 * ALWAYS calculates from day 0 to today, regardless of display filter.
 */
function buildTrainingReadinessSeries(activities, rangeStart, rangeEnd) {
    const series = buildRollingSevenDayLoad(activities, rangeStart, rangeEnd);
    if (!series || !series.sorted.length || !series.labels.length) {
        return null;
    }

    const profile = getPmcProfile(series.sorted);
    const ctlValues = series.ctlDaily.filter(Number.isFinite);
    const readinessRaw = [];
    const breakdown = [];
    const hrvLookup = getHrvLookup();

    for (let i = 0; i < series.labels.length; i++) {
        const label = series.labels[i];
        const ctl = series.ctlDaily[i] || 0;
        const atl = series.atlDaily[i] || 0;
        const tsb = series.tsbDaily[i] || 0;
        const injury = series.riskDaily[i] || 0;
        const load7d = series.load7d[i] || 0;
        const band = getAcuteLoadBand(profile, ctl, acuteLoadBandMode);
        const hrvEntry = hrvLookup?.byDate.get(label) || null;

        const tsbScore = getReadinessTsbScore(tsb, profile);
        const ctlScore = getReadinessCtlScore(ctl, ctlValues);
        const atlFatigueScore = getReadinessAtlFatigueScore(atl, ctl);
        const acwrScore = getReadinessLoadStabilityScore(series.load7d, i);
        const bandScore = getReadinessBandScore(load7d, band);
        const loadStabilityScore = normalize01(acwrScore * 0.65 + bandScore * 0.35);
        const injuryScore = getReadinessInjuryScore(injury);
        const hrvScore = getReadinessHrvScore(hrvEntry);
        const weights = hrvScore == null
            ? { tsb: 0.35, ctl: 0.25, atl: 0.20, load: 0.20, hrv: 0 }
            : { tsb: 0.30, ctl: 0.22, atl: 0.18, load: 0.15, hrv: 0.15 };

        // Default readiness uses TSB, CTL, ATL inverted, and load stability.
        // HRV is blended in only when the user imports Garmin nightly HRV data.
        const base01 =
            weights.tsb * tsbScore +
            weights.ctl * ctlScore +
            weights.atl * (1 - atlFatigueScore) +
            weights.load * loadStabilityScore +
            weights.hrv * (hrvScore ?? 0);

        const final01 = normalize01(base01);

        const tsbPts = weights.tsb * 100 * tsbScore;
        const ctlPts = weights.ctl * 100 * ctlScore;
        const atlPts = weights.atl * 100 * (1 - atlFatigueScore);
        const loadPts = weights.load * 100 * loadStabilityScore;
        const hrvPts = weights.hrv * 100 * (hrvScore ?? 0);
        const basePts = tsbPts + ctlPts + atlPts + loadPts + hrvPts;
        const injuryPenaltyPts = 0;

        readinessRaw.push(final01 * 100);
        breakdown.push({
            tsb: { value: tsb, score: tsbScore, points: tsbPts },
            ctl: { value: ctl, score: ctlScore, points: ctlPts },
            atl: { value: atl, delta: atl - ctl, fatigueScore: atlFatigueScore, points: atlPts },
            load: { value: load7d, acwrScore, bandScore, score: loadStabilityScore, points: loadPts },
            injury: { value: injury, score: injuryScore, penalty: 0, penaltyPoints: injuryPenaltyPts },
            hrv: hrvEntry ? { ...hrvEntry, score: hrvScore, points: hrvPts } : null,
            basePoints: basePts,
            weights,
            readiness: final01 * 100
        });
    }

    const readiness = smoothReadinessSeries(readinessRaw, 5, 8).map(value => {
        if (!Number.isFinite(value)) return null;
        return normalize01(value / 100) * 100;
    });

    return {
        labels: series.labels,
        readiness,
        readinessRaw,
        breakdown,
        profile,
        sortedActivities: series.sorted,
        ctlDaily: series.ctlDaily,
        atlDaily: series.atlDaily,
        tsbDaily: series.tsbDaily,
        riskDaily: series.riskDaily,
        recoveryDaily: series.recoveryDaily,
        hrvMeta: hrvLookup?.meta || null,
        fullStart: series.fullStart,
        today: series.today,
        visibleStart: series.visibleStart,
        visibleEnd: series.visibleEnd
    };
}

/**
 * Get readiness color based on score
 */
function getReadinessColor(score) {
    if (score >= 90) return '#27ae60';
    if (score >= 75) return '#2ecc71';
    if (score >= 60) return '#f1c40f';
    if (score >= 40) return '#f39c12';
    return '#e74c3c';
}

/**
 * Get readiness label
 */
function getReadinessLabel(score) {
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Very Good';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
}

function getReadinessMetricTone(score01) {
    const score100 = normalize01(score01 ?? 0.5) * 100;
    return {
        color: getReadinessColor(score100),
        score100
    };
}

function renderReadinessMetricItem(title, value, metaLine, score01, metricKey, isActive = false, isDisabled = false) {
    const tone = getReadinessMetricTone(score01);
    const stateClass = isActive ? ' readiness-metric-item--active' : '';
    const disabledClass = isDisabled ? ' readiness-metric-item--disabled' : '';
    const attr = isDisabled ? '' : ` data-readiness-metric="${metricKey}" role="button" tabindex="0"`;
    return `
        <div class="readiness-metric-item readiness-metric-item--switch${stateClass}${disabledClass}" style="border:1px solid ${tone.color}33;background:${tone.color}10;"${attr}>
            <div class="readiness-metric-label" style="color:${tone.color};">${title}</div>
            <div class="readiness-metric-value">${value}</div>
            <small style="color:${tone.color};">${metaLine}</small>
        </div>
    `;
}

/**
 * Combined HRV mini score + import/clear controls (6 mini scores total)
 */
function renderReadinessHrvItem(readinessData, hrvEntry) {
    const hasImportedHrv = Boolean(readinessData.hrvMeta?.entries?.length);
    const isActive = readinessTimelineMetric === 'hrv';
    const hrvLabel = hrvEntry ? `${hrvEntry.nightly.toFixed(0)} ms` : 'Not imported';
    const hrvMetaLine = hrvEntry
        ? `${hrvEntry.referenceLow.toFixed(0)}-${hrvEntry.referenceHigh.toFixed(0)} ref · +${hrvEntry.points.toFixed(1)} pts`
        : formatHrvImportSummary(readinessData.hrvMeta);
    const score01 = hrvEntry?.score ?? 0.5;
    const tone = getReadinessMetricTone(score01);
    const stateClass = isActive ? ' readiness-metric-item--active' : '';
    const disabledClass = hasImportedHrv ? '' : ' readiness-metric-item--disabled';
    const interactiveAttr = hasImportedHrv ? ' data-readiness-metric="hrv" role="button" tabindex="0"' : '';

    return `
        <div class="readiness-metric-item readiness-metric-item--switch${stateClass}${disabledClass}" style="border:1px solid ${tone.color}33;background:${tone.color}10;display:flex;flex-direction:column;gap:0.35rem;"${interactiveAttr}>
            <div class="readiness-metric-label" style="color:${tone.color};">HRV</div>
            <div class="readiness-metric-value">${hrvLabel}</div>
            <small style="color:${tone.color};">${hrvMetaLine}</small>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;margin-top:0.15rem;">
                <label style="display:inline-flex;align-items:center;justify-content:center;padding:0.35rem 0.55rem;border:1px solid #4f46e533;border-radius:999px;cursor:pointer;background:#fff;color:#2f3b52;font-size:0.7rem;font-weight:600;">
                    <span>Import CSV</span>
                    <input id="readiness-hrv-file" type="file" accept=".csv,text/csv" style="display:none;">
                </label>
                <button id="readiness-hrv-clear" type="button" style="padding:0.35rem 0.55rem;border:1px solid #d0d7e2;border-radius:999px;background:#fff;cursor:pointer;font-size:0.7rem;font-weight:600;${hasImportedHrv ? '' : 'display:none;'}">Clear</button>
            </div>
        </div>
    `;
}

function renderReadinessHrvControlCard(readinessData) {
    const hasImportedHrv = Boolean(readinessData.hrvMeta?.entries?.length);
    return `
        <div class="readiness-metric-item" style="border:1px solid #4f46e533;background:#4f46e510;display:flex;flex-direction:column;gap:0.45rem;">
            <div class="readiness-metric-label" style="color:#4f46e5;">Optional HRV Input</div>
            <small id="readiness-hrv-feedback" style="color:#4f46e5;line-height:1.35;">${formatHrvImportSummary(readinessData.hrvMeta)}</small>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
                <label style="display:inline-flex;align-items:center;justify-content:center;padding:0.45rem 0.65rem;border:1px solid #4f46e533;border-radius:999px;cursor:pointer;background:#fff;color:#2f3b52;font-size:0.74rem;font-weight:600;">
                    <span>Import CSV</span>
                    <input id="readiness-hrv-file" type="file" accept=".csv,text/csv" style="display:none;">
                </label>
                <button id="readiness-hrv-clear" type="button" style="padding:0.45rem 0.65rem;border:1px solid #d0d7e2;border-radius:999px;background:#fff;cursor:pointer;font-size:0.74rem;font-weight:600;${hasImportedHrv ? '' : 'display:none;'}">Clear</button>
            </div>
        </div>
    `;
}

function formatHrvImportSummary(hrvMeta) {
    if (!hrvMeta?.entries?.length) {
        return 'Optional: import Garmin nightly HRV CSV to blend HRV into readiness.';
    }

    return `HRV imported: ${hrvMeta.entries.length} nights · ${hrvMeta.rangeStart} to ${hrvMeta.rangeEnd}`;
}

function rerenderTrainingReadinessFromDashboardContext() {
    if (!dashboardRenderContext?.allActivities?.length) return;
    const { startDate, endDate } = getEffectiveDashboardWindow(
        dashboardRenderContext.dateFilterFrom,
        dashboardRenderContext.dateFilterTo
    );
    renderTrainingReadiness(dashboardRenderContext.allActivities, startDate, endDate);
}

function setupReadinessHrvControls() {
    const fileInput = document.getElementById('readiness-hrv-file');
    const clearButton = document.getElementById('readiness-hrv-clear');
    const feedback = document.getElementById('readiness-hrv-feedback');
    if (!fileInput || fileInput.dataset.listenerReady) return;

    fileInput.dataset.listenerReady = '1';
    fileInput.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = parseGarminHrvCsv(text);
            saveStoredHrvData(parsed);
            rerenderTrainingReadinessFromDashboardContext();
        } catch (error) {
            if (feedback) {
                feedback.textContent = error?.message || 'Could not parse Garmin HRV CSV.';
                feedback.style.color = '#e74c3c';
            }
        } finally {
            fileInput.value = '';
        }
    });

    if (clearButton) {
        clearButton.addEventListener('click', () => {
            saveStoredHrvData(null);
            rerenderTrainingReadinessFromDashboardContext();
        });
    }
}

function setupReadinessMetricSwitcher(readinessData) {
    const metricItems = Array.from(document.querySelectorAll('[data-readiness-metric]'));
    if (!metricItems.length) return;

    const hasHrv = readinessData.breakdown.some(part => part?.hrv);
    const allowed = new Set(['readiness', 'tsb', 'ctl', 'atl', 'injury', 'recovery']);
    if (hasHrv) {
        allowed.add('hrv');
    }
    if (!allowed.has(readinessTimelineMetric)) {
        readinessTimelineMetric = 'readiness';
    }

    const activateMetric = metric => {
        if (!allowed.has(metric)) return;
        readinessTimelineMetric = metric;
        renderReadinessGauge(
            readinessData.readiness[readinessData.labels.length - 1] ?? readinessData.readinessRaw[readinessData.labels.length - 1] ?? 0,
            readinessData
        );
        renderReadinessTimelineChart(readinessData);
    };

    metricItems.forEach(item => {
        if (item.dataset.listenerReady) return;
        item.dataset.listenerReady = '1';
        item.addEventListener('click', event => {
            const target = event.currentTarget;
            const metric = target?.dataset?.readinessMetric;
            if (!metric) return;
            activateMetric(metric);
        });
        item.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            const target = event.currentTarget;
            const metric = target?.dataset?.readinessMetric;
            if (!metric) return;
            activateMetric(metric);
        });
    });
}

/**
 * Render readiness card next to gauge.
 */
function renderReadinessGauge(score, readinessData) {
    const container = document.getElementById('readiness-explainer');
    if (!container) return;

    const lastIndex = readinessData.labels.length - 1;
    const ctl = readinessData.ctlDaily[lastIndex] || 0;
    const atl = readinessData.atlDaily[lastIndex] || 0;
    const tsb = readinessData.tsbDaily[lastIndex] || 0;
    const risk = readinessData.riskDaily[lastIndex] || 0;
    const recoveryNeeded = readinessData.recoveryDaily[lastIndex] || 4;

    // Calculate actual recovery hours remaining based on when the activity happened
    const todaysActivities = getTodaysActivities(readinessData.sortedActivities);
    const recovery = calculateRecoveryHoursRemaining(todaysActivities, recoveryNeeded);

    const parts = readinessData.breakdown[lastIndex];

    const label = getReadinessLabel(score);
    const color = getReadinessColor(score);
    const ctlStatus = getCtlStatus(ctl, readinessData.sortedActivities, readinessData.profile);
    const atlStatus = getAtlStatus(atl, ctl);
    const tsbStatus = getTsbStatus(tsb, readinessData.profile);
    const hrv = parts.hrv;
    const hrvLabel = hrv ? `${hrv.nightly.toFixed(0)} ms` : 'Not imported';
    const hrvMetaLine = hrv
        ? `${hrv.referenceLow.toFixed(0)}-${hrv.referenceHigh.toFixed(0)} ref · +${hrv.points.toFixed(1)} pts`
        : 'Optional Garmin CSV import';
    const hasHrvSeries = readinessData.breakdown.some(part => part?.hrv);
    if (readinessTimelineMetric === 'hrv' && !hasHrvSeries) {
        readinessTimelineMetric = 'readiness';
    }
    const injuryToneLabel = Number.isFinite(risk)
        ? `${risk <= 0.25 ? 'Low' : risk <= 0.5 ? 'Elevated' : 'High'} risk · ref only`
        : 'Reference only';

    let insight = '';
    if (score >= 75) {
        insight = 'High readiness: positive freshness and controlled fatigue with stable load.';
    } else if (score >= 60) {
        insight = 'Moderate-high readiness: good balance, but keep load progression smooth.';
    } else if (score >= 40) {
        insight = 'Low-moderate readiness: fatigue/load balance is limiting quality right now.';
    } else {
        insight = 'Low readiness: high fatigue and/or unstable load suggest a recovery focus.';
    }

    container.innerHTML = `
    <div class="readiness-top">
        <div class="readiness-score-display readiness-score-display--switch${readinessTimelineMetric === 'readiness' ? ' readiness-score-display--active' : ''}" data-readiness-metric="readiness" role="button" tabindex="0" aria-label="Show readiness score chart">
            <div class="readiness-score-value">
                <span class="score-number">${score.toFixed(0)}</span>
                <span class="score-unit">/100</span>
            </div>
            <div class="readiness-score-label" style="color: ${color};">${label}</div>
        </div>

        <div class="readiness-insights" style="border-left-color: ${color}; background: ${color}15;">
             ${insight}
        </div>
    </div>

    <div class="readiness-metrics">
        ${renderReadinessMetricItem('TSB (Freshness)', tsb.toFixed(1), `${tsbStatus.label} · +${parts.tsb.points.toFixed(1)} pts`, parts.tsb.score, 'tsb', readinessTimelineMetric === 'tsb')}
        ${renderReadinessMetricItem('CTL (Fitness)', ctl.toFixed(1), `${ctlStatus.label} · +${parts.ctl.points.toFixed(1)} pts`, parts.ctl.score, 'ctl', readinessTimelineMetric === 'ctl')}
        ${renderReadinessMetricItem('ATL (Fatigue)', atl.toFixed(1), `${atlStatus.label} · +${parts.atl.points.toFixed(1)} pts`, 1 - parts.atl.fatigueScore, 'atl', readinessTimelineMetric === 'atl')}
        ${renderReadinessMetricItem('Injury Risk', Number.isFinite(risk) ? risk.toFixed(3) : '–', injuryToneLabel, parts.injury.score, 'injury', readinessTimelineMetric === 'injury')}
        ${renderReadinessMetricItem('Recovery Hours', `${recovery}h`, `${describeRecoveryHours(recovery, tsb).split('.')[0]}.`, normalize01(1 - (recovery / 96)), 'recovery', readinessTimelineMetric === 'recovery')}
        ${renderReadinessHrvItem(readinessData, hrv)}
    </div>
`;

    setupReadinessMetricSwitcher(readinessData);
    setupReadinessHrvControls();
}

function getReadinessTimelineSpec(metricKey, data, visibleIndices) {
    const buildVisible = source => visibleIndices.map(index => source[index]);

    const getHrvSeries = extractor => visibleIndices.map(index => {
        const hrv = data.breakdown[index]?.hrv;
        return hrv ? extractor(hrv) : null;
    });

    const ctlValues = data.ctlDaily.filter(Number.isFinite);
    const ctlBands = buildCtlBands(ctlValues);

    if (metricKey === 'tsb') {
        const series = buildVisible(data.tsbDaily);
        const t = data.profile.thresholds;
        return {
            metricLabel: 'TSB',
            valueFormatter: value => `${value.toFixed(1)}`,
            primarySeries: series,
            primaryLabel: 'TSB',
            primaryColor: '#00a1d6',
            primaryFill: 'rgba(0, 161, 214, 0.12)',
            guides: {
                bands: [
                    { min: null, max: t.deepFatigue, color: 'rgba(231, 76, 60, 0.10)' },
                    { min: t.deepFatigue, max: t.fatigue, color: 'rgba(255, 133, 27, 0.09)' },
                    { min: t.fatigue, max: t.balanced, color: 'rgba(39, 174, 96, 0.09)' },
                    { min: t.balanced, max: t.fresh, color: 'rgba(0, 116, 217, 0.08)' },
                    { min: t.fresh, max: null, color: 'rgba(108, 117, 125, 0.07)' }
                ],
                lines: [
                    { value: t.fatigue, color: '#27ae60', dash: [6, 4], width: 1.2 },
                    { value: t.balanced, color: '#0074D9', dash: [6, 4], width: 1.1 },
                    { value: t.fresh, color: '#6c757d', dash: [6, 4], width: 1.1 }
                ]
            },
            yPaddingFactor: 0.4,
            yPaddingMin: 4,
            minSpan: 18,
            yStepSmall: 2,
            yStepLarge: 5
        };
    }

    if (metricKey === 'ctl') {
        const series = buildVisible(data.ctlDaily);
        const thresholds = {
            p25: ctlBands[0]?.max,
            p45: ctlBands[1]?.max,
            p70: ctlBands[2]?.max,
            p90: ctlBands[3]?.max,
        };
        return {
            metricLabel: 'CTL',
            valueFormatter: value => `${value.toFixed(1)}`,
            primarySeries: series,
            primaryLabel: 'CTL',
            primaryColor: '#5b6bd5',
            primaryFill: 'rgba(91, 107, 213, 0.12)',
            guides: {
                bands: [
                    { min: null, max: thresholds.p25, color: 'rgba(243, 156, 18, 0.08)' },
                    { min: thresholds.p25, max: thresholds.p45, color: 'rgba(108, 117, 125, 0.07)' },
                    { min: thresholds.p45, max: thresholds.p70, color: 'rgba(39, 174, 96, 0.08)' },
                    { min: thresholds.p70, max: thresholds.p90, color: 'rgba(31, 157, 85, 0.08)' },
                    { min: thresholds.p90, max: null, color: 'rgba(0, 116, 217, 0.07)' }
                ],
                lines: [
                    { value: thresholds.p45, color: '#27ae60', dash: [6, 4], width: 1.2 },
                    { value: thresholds.p70, color: '#1f9d55', dash: [6, 4], width: 1.1 },
                    { value: thresholds.p90, color: '#0074D9', dash: [6, 4], width: 1.1 }
                ]
            },
            yPaddingFactor: 0.3,
            yPaddingMin: 3,
            minSpan: 12,
            yStepSmall: 2,
            yStepLarge: 5
        };
    }

    if (metricKey === 'atl') {
        const series = buildVisible(data.atlDaily);
        const ctlVisible = buildVisible(data.ctlDaily);
        const productiveHigh = ctlVisible.map(v => Number.isFinite(v) ? v + 4 : null);
        const buildHigh = ctlVisible.map(v => Number.isFinite(v) ? v + 12 : null);
        const overloadHigh = ctlVisible.map(v => Number.isFinite(v) ? v + 22 : null);
        return {
            metricLabel: 'ATL',
            valueFormatter: value => `${value.toFixed(1)}`,
            primarySeries: series,
            primaryLabel: 'ATL',
            primaryColor: '#e67e22',
            primaryFill: 'rgba(230, 126, 34, 0.14)',
            guides: {
                lines: [
                    { value: ctlVisible, color: '#6c757d', dash: [6, 4], width: 1.1 },
                    { value: productiveHigh, color: '#27ae60', dash: [5, 4], width: 1.1 },
                    { value: buildHigh, color: '#f39c12', dash: [5, 4], width: 1.1 },
                    { value: overloadHigh, color: '#e74c3c', dash: [5, 4], width: 1.1 }
                ]
            },
            yPaddingFactor: 0.3,
            yPaddingMin: 3,
            minSpan: 12,
            yStepSmall: 2,
            yStepLarge: 5
        };
    }

    if (metricKey === 'injury') {
        const series = buildVisible(data.riskDaily);
        return {
            metricLabel: 'Injury Risk',
            valueFormatter: value => `${value.toFixed(3)}`,
            primarySeries: series,
            primaryLabel: 'Injury Risk',
            primaryColor: '#b5651d',
            primaryFill: 'rgba(181, 101, 29, 0.13)',
            guides: {
                bands: [
                    { min: 0, max: 0.25, color: 'rgba(39, 174, 96, 0.08)' },
                    { min: 0.25, max: 0.5, color: 'rgba(241, 196, 15, 0.08)' },
                    { min: 0.5, max: 0.75, color: 'rgba(243, 156, 18, 0.08)' },
                    { min: 0.75, max: 1, color: 'rgba(231, 76, 60, 0.09)' }
                ],
                lines: [
                    { value: 0.25, color: '#27ae60', dash: [6, 4], width: 1.1 },
                    { value: 0.5, color: '#f39c12', dash: [6, 4], width: 1.1 },
                    { value: 0.75, color: '#e74c3c', dash: [6, 4], width: 1.1 }
                ]
            },
            yPaddingFactor: 0.2,
            yPaddingMin: 0.06,
            minSpan: 0.35,
            yStepSmall: 0.1,
            yStepLarge: 0.2,
            clampMin: 0,
            clampMax: 1
        };
    }

    if (metricKey === 'recovery') {
        const series = buildVisible(data.recoveryDaily);
        return {
            metricLabel: 'Recovery Hours',
            valueFormatter: value => `${value.toFixed(1)} h`,
            primarySeries: series,
            primaryLabel: 'Recovery Hours',
            primaryColor: '#34495e',
            primaryFill: 'rgba(52, 73, 94, 0.12)',
            guides: {
                bands: [
                    { min: 0, max: 12, color: 'rgba(39, 174, 96, 0.08)' },
                    { min: 12, max: 24, color: 'rgba(241, 196, 15, 0.08)' },
                    { min: 24, max: 48, color: 'rgba(243, 156, 18, 0.08)' },
                    { min: 48, max: 72, color: 'rgba(231, 76, 60, 0.09)' },
                    { min: 72, max: 100, color: 'rgba(192, 57, 43, 0.10)' }
                ],
                lines: [
                    { value: 12, color: '#27ae60', dash: [6, 4], width: 1.1 },
                    { value: 24, color: '#f1c40f', dash: [6, 4], width: 1.1 },
                    { value: 48, color: '#f39c12', dash: [6, 4], width: 1.1 },
                    { value: 72, color: '#e74c3c', dash: [6, 4], width: 1.1 }
                ]
            },
            yPaddingFactor: 0.25,
            yPaddingMin: 4,
            minSpan: 20,
            yStepSmall: 4,
            yStepLarge: 8,
            clampMin: 0,
            clampMax: 100
        };
    }

    if (metricKey === 'hrv') {
        const nightly = getHrvSeries(hrv => hrv.nightly);
        const lowRef = getHrvSeries(hrv => hrv.referenceLow);
        const highRef = getHrvSeries(hrv => hrv.referenceHigh);
        const refLowValues = lowRef.filter(Number.isFinite);
        const refHighValues = highRef.filter(Number.isFinite);
        const median = values => {
            if (!values.length) return null;
            const sorted = [...values].sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        };
        const medianLow = median(refLowValues);
        const medianHigh = median(refHighValues);
        return {
            metricLabel: 'HRV',
            valueFormatter: value => `${value.toFixed(0)} ms`,
            primarySeries: nightly,
            primaryLabel: 'Nightly HRV',
            primaryColor: '#8e44ad',
            primaryFill: 'rgba(142, 68, 173, 0.13)',
            spanGaps: true,
            guides: {
                bands: Number.isFinite(medianLow) && Number.isFinite(medianHigh)
                    ? [{ min: Math.min(medianLow, medianHigh), max: Math.max(medianLow, medianHigh), color: 'rgba(79, 70, 229, 0.08)' }]
                    : [],
                lines: [
                    ...(Number.isFinite(medianLow) ? [{ value: medianLow, color: '#6c757d', dash: [6, 4], width: 1.1 }] : []),
                    ...(Number.isFinite(medianHigh) ? [{ value: medianHigh, color: '#4f46e5', dash: [6, 4], width: 1.1 }] : [])
                ]
            },
            yPaddingFactor: 0.35,
            yPaddingMin: 4,
            minSpan: 15,
            yStepSmall: 2,
            yStepLarge: 5
        };
    }

    const readinessSeries = buildVisible(data.readiness);
    return {
        metricLabel: 'Readiness Score',
        valueFormatter: value => `${value.toFixed(1)}`,
        primarySeries: readinessSeries,
        primaryLabel: 'Readiness Score',
        primaryColor: '#4f46e5',
        primaryFill: 'rgba(79, 70, 229, 0.12)',
        guides: {
            bands: [
                { min: 0, max: 40, color: 'rgba(231, 76, 60, 0.10)' },
                { min: 40, max: 75, color: 'rgba(243, 156, 18, 0.08)' },
                { min: 75, max: 100, color: 'rgba(46, 204, 113, 0.09)' }
            ],
            lines: [
                { value: 40, color: '#f39c12', dash: [6, 4], width: 1.1 },
                { value: 75, color: '#2ecc71', dash: [6, 4], width: 1.1 }
            ]
        },
        yPaddingFactor: 0.35,
        yPaddingMin: 6,
        minSpan: 20,
        yStepSmall: 5,
        yStepLarge: 10
    };
}

function buildReadinessPrimaryDataset(spec) {
    return {
        label: spec.primaryLabel || spec.metricLabel,
        data: spec.primarySeries,
        borderColor: spec.primaryColor || '#4f46e5',
        backgroundColor: spec.primaryFill || 'rgba(79, 70, 229, 0.12)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 12,
        spanGaps: Boolean(spec.spanGaps)
    };
}

function buildReadinessGuidePlugin(guides = {}) {
    const bands = Array.isArray(guides.bands) ? guides.bands : [];
    const lines = Array.isArray(guides.lines) ? guides.lines : [];

    return {
        id: 'readinessGuideLayer',
        beforeDatasetsDraw(chart) {
            const yScale = chart.scales?.y;
            const xScale = chart.scales?.x;
            if (!yScale || !xScale) return;

            const area = chart.chartArea;
            if (!area) return;

            const ctx = chart.ctx;
            const yMin = yScale.min;
            const yMax = yScale.max;

            const clamp = value => Math.max(yMin, Math.min(yMax, value));

            bands.forEach(band => {
                const min = Number.isFinite(band.min) ? clamp(band.min) : yMin;
                const max = Number.isFinite(band.max) ? clamp(band.max) : yMax;
                if (max <= min) return;
                const yTop = yScale.getPixelForValue(max);
                const yBottom = yScale.getPixelForValue(min);
                ctx.save();
                ctx.fillStyle = band.color || 'rgba(0,0,0,0.04)';
                ctx.fillRect(area.left, yTop, area.right - area.left, yBottom - yTop);
                ctx.restore();
            });

            lines.forEach(line => {
                const values = Array.isArray(line.value) ? line.value : null;
                const lineWidth = line.width || 1;
                const dash = line.dash || [6, 4];
                const color = line.color || '#999';

                if (!values) {
                    if (!Number.isFinite(line.value)) return;
                    const y = yScale.getPixelForValue(clamp(line.value));
                    ctx.save();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = lineWidth;
                    ctx.setLineDash(dash);
                    ctx.beginPath();
                    ctx.moveTo(area.left, y);
                    ctx.lineTo(area.right, y);
                    ctx.stroke();
                    ctx.restore();
                    return;
                }

                ctx.save();
                ctx.strokeStyle = color;
                ctx.lineWidth = lineWidth;
                ctx.setLineDash(dash);
                ctx.beginPath();
                let started = false;

                values.forEach((value, index) => {
                    if (!Number.isFinite(value)) {
                        started = false;
                        return;
                    }
                    const x = xScale.getPixelForValue(index);
                    const y = yScale.getPixelForValue(clamp(value));
                    if (!started) {
                        ctx.moveTo(x, y);
                        started = true;
                    } else {
                        ctx.lineTo(x, y);
                    }
                });

                ctx.stroke();
                ctx.restore();
            });
        }
    };
}

function getNiceAxisBounds(values, options = {}) {
    const finiteValues = values.filter(Number.isFinite);
    if (!finiteValues.length) {
        return { min: 0, max: 100, step: 10 };
    }

    const minRaw = Math.min(...finiteValues);
    const maxRaw = Math.max(...finiteValues);
    const spread = Math.max(options.minSpread ?? 8, maxRaw - minRaw);
    const padding = Math.max(options.paddingMin ?? 4, spread * (options.paddingFactor ?? 0.35));
    const stepSmall = options.yStepSmall ?? 5;
    const stepLarge = options.yStepLarge ?? 10;

    let min = minRaw - padding;
    let max = maxRaw + padding;

    if (Number.isFinite(options.clampMin)) {
        min = Math.max(options.clampMin, min);
    }
    if (Number.isFinite(options.clampMax)) {
        max = Math.min(options.clampMax, max);
    }

    if (max - min < (options.minSpan ?? 20)) {
        const center = (max + min) / 2;
        min = center - (options.minSpan ?? 20) / 2;
        max = center + (options.minSpan ?? 20) / 2;
        if (Number.isFinite(options.clampMin)) min = Math.max(options.clampMin, min);
        if (Number.isFinite(options.clampMax)) max = Math.min(options.clampMax, max);
    }

    const step = max - min <= (options.minSpan ?? 20) * 1.25 ? stepSmall : stepLarge;
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;

    if (Number.isFinite(options.clampMin)) min = Math.max(options.clampMin, min);
    if (Number.isFinite(options.clampMax)) max = Math.min(options.clampMax, max);
    if (max <= min) {
        max = min + step;
    }

    return { min, max, step };
}

/**
 * Render readiness timeline chart
 */
function renderReadinessTimelineChart(data) {
    const canvas = document.getElementById('readiness-timeline-chart');
    if (!canvas) return;

    if (dashboardCharts['readiness-timeline-chart']) {
        dashboardCharts['readiness-timeline-chart'].destroy();
    }

    const ctx = canvas.getContext('2d');

    // Filter data for visible range only
    const visibleIndices = data.labels.map((label, i) => {
        const date = new Date(`${label}T00:00:00`);
        return date >= data.visibleStart && date <= data.visibleEnd ? i : -1;
    }).filter(i => i !== -1);

    const visibleLabels = visibleIndices.map(i => data.labels[i]);
    const visibleReadiness = visibleIndices.map(i => data.readiness[i]);
    const visibleCtl = visibleIndices.map(i => data.ctlDaily[i]);
    const visibleAtl = visibleIndices.map(i => data.atlDaily[i]);
    const visibleTsb = visibleIndices.map(i => data.tsbDaily[i]);

    const hasHrvSeries = data.breakdown.some(part => part?.hrv);
    if (readinessTimelineMetric === 'hrv' && !hasHrvSeries) {
        readinessTimelineMetric = 'readiness';
    }

    const timelineSpec = getReadinessTimelineSpec(readinessTimelineMetric, data, visibleIndices);
    const guideValues = [
        ...(timelineSpec.guides?.lines || []).flatMap(line => Array.isArray(line.value) ? line.value : [line.value]),
        ...(timelineSpec.guides?.bands || []).flatMap(band => [band.min, band.max])
    ];
    const axisValues = [...timelineSpec.primarySeries, ...guideValues];
    const axis = getNiceAxisBounds(axisValues, {
        paddingFactor: timelineSpec.yPaddingFactor,
        paddingMin: timelineSpec.yPaddingMin,
        minSpread: timelineSpec.minSpan,
        yStepSmall: timelineSpec.yStepSmall,
        yStepLarge: timelineSpec.yStepLarge,
        minSpan: timelineSpec.minSpan,
        clampMin: timelineSpec.clampMin,
        clampMax: timelineSpec.clampMax
    });

    const timelineTitle = document.querySelector('.readiness-timeline-container h4');
    if (timelineTitle) {
        timelineTitle.textContent = `${timelineSpec.metricLabel} Over Time`;
    }

    const guideLayerPlugin = buildReadinessGuidePlugin(timelineSpec.guides);

    const config = {
        type: 'line',
        data: {
            labels: visibleLabels,
            datasets: [buildReadinessPrimaryDataset(timelineSpec)]
        },
        plugins: [guideLayerPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 280 },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        font: { size: 12, weight: '600' },
                        color: '#444',
                    },
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 10,
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 12 },
                    displayColors: false,
                    callbacks: {
                        title: function (items) {
                            const item = items && items[0];
                            if (!item) return '';
                            return item.label;
                        },
                        label: function () {
                            return null;
                        },
                        afterBody: function (items) {
                            const item = items && items[0];
                            if (!item) return [];
                            const index = item.dataIndex;
                            const readiness = visibleReadiness[index];
                            const atl = visibleAtl[index];
                            const ctl = visibleCtl[index];
                            const tsb = visibleTsb[index];

                            return [
                                `Readiness Score: ${Number.isFinite(readiness) ? readiness.toFixed(1) : '–'}`,
                                `ATL: ${Number.isFinite(atl) ? atl.toFixed(1) : '–'}`,
                                `CTL: ${Number.isFinite(ctl) ? ctl.toFixed(1) : '–'}`,
                                `TSB: ${Number.isFinite(tsb) ? tsb.toFixed(1) : '–'}`
                            ];
                        }
                    }
                },
            },
            scales: {
                y: {
                    type: 'linear',
                    min: axis.min,
                    max: axis.max,
                    ticks: {
                        stepSize: axis.step,
                        font: { size: 11 },
                        color: '#999',
                        callback: value => {
                            const n = Number(value);
                            if (!Number.isFinite(n)) return value;
                            if (readinessTimelineMetric === 'injury') return n.toFixed(2);
                            if (readinessTimelineMetric === 'recovery') return `${n.toFixed(0)}h`;
                            if (readinessTimelineMetric === 'hrv') return `${n.toFixed(0)}ms`;
                            return n.toFixed(0);
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                        drawBorder: false,
                    },
                },
                x: {
                    grid: {
                        display: false,
                        drawBorder: false,
                    },
                    ticks: {
                        font: { size: 10 },
                        color: '#999',
                        autoSkip: true,
                        maxTicksLimit: window.innerWidth <= 768 ? 8 : 14,
                        maxRotation: 45,
                        minRotation: 0,
                    },
                },
            },
        },
    };

    dashboardCharts['readiness-timeline-chart'] = new Chart(ctx, config);
}

/**
 * Draw a gauge chart using canvas
 */
function drawGaugeChart(canvas, score) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height * 0.65;
    const radius = Math.min(width, height) * 0.35;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Define gauge zones: 0-40 red, 40-60 orange, 60-75 yellow, 75-90 light green, 90-100 green
    const zones = [
        { start: 0, end: 40, color: '#e74c3c' },
        { start: 40, end: 60, color: '#f39c12' },
        { start: 60, end: 75, color: '#f1c40f' },
        { start: 75, end: 90, color: '#2ecc71' },
        { start: 90, end: 100, color: '#27ae60' },
    ];

    const startAngle = Math.PI;
    const endAngle = 0;
    const totalAngle = Math.PI;

    // Draw gauge background zones
    zones.forEach(zone => {
        const zoneStart = startAngle + (zone.start / 100) * totalAngle;
        const zoneEnd = startAngle + (zone.end / 100) * totalAngle;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, zoneStart, zoneEnd, false);
        ctx.strokeStyle = zone.color;
        ctx.lineWidth = 20;
        ctx.stroke();
    });

    // Draw outer ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw needle
    const needleAngle = startAngle + (Math.min(score, 100) / 100) * totalAngle;
    const needleLength = radius * 0.8;
    const needleX = centerX + Math.cos(needleAngle) * needleLength;
    const needleY = centerY + Math.sin(needleAngle) * needleLength;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(needleX, needleY);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw center circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#333';
    ctx.fill();

    // Draw tick marks and labels
    const ticks = [0, 20, 40, 60, 80, 100];
    ticks.forEach(tick => {
        const tickAngle = startAngle + (tick / 100) * totalAngle;
        const outerX = centerX + Math.cos(tickAngle) * radius;
        const outerY = centerY + Math.sin(tickAngle) * radius;
        const innerX = centerX + Math.cos(tickAngle) * (radius - 10);
        const innerY = centerY + Math.sin(tickAngle) * (radius - 10);

        ctx.beginPath();
        ctx.moveTo(outerX, outerY);
        ctx.lineTo(innerX, innerY);
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw label
        const labelRadius = radius + 25;
        const labelX = centerX + Math.cos(tickAngle) * labelRadius;
        const labelY = centerY + Math.sin(tickAngle) * labelRadius;

        ctx.fillStyle = '#666';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tick, labelX, labelY);
    });

    // Draw score value and label at bottom
    const readiness = Math.round(score);
    const label = getReadinessLabel(score);
    const color = getReadinessColor(score);

    ctx.fillStyle = color;
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(readiness, centerX, centerY + radius + 50);

    ctx.fillStyle = color;
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, centerX, centerY + radius + 72);
}

/**
 * Main rendering function for Training Readiness
 * Shows TODAY's readiness value, with timeline filtered to visible range
 */
function renderTrainingReadiness(allActivities, rangeStart, rangeEnd) {
    const readinessData = buildTrainingReadinessSeries(allActivities, rangeStart, rangeEnd);
    if (!readinessData) return;

    // ALWAYS show today's readiness (last index)
    const lastIndex = readinessData.labels.length - 1;
    const currentReadiness = readinessData.readiness[lastIndex] ?? readinessData.readinessRaw[lastIndex] ?? 0;

    // Draw gauge
    const canvas = document.getElementById('readiness-gauge-chart');
    if (canvas) {
        drawGaugeChart(canvas, currentReadiness);
    }

    // Render score display with today's metrics
    renderReadinessGauge(currentReadiness, readinessData);

    // Render timeline with visible range filter applied at display time
    renderReadinessTimelineChart(readinessData);
}


function renderAcuteLoadChart(activities, rangeStart, rangeEnd) {
    const canvas = document.getElementById('acute-load-chart');
    const explainer = document.getElementById('acute-load-explainer');
    if (!canvas) return;

    renderAcuteLoadModeSwitch();

    const ctx = canvas.getContext('2d');
    if (dashboardCharts['acute-load-chart']) {
        dashboardCharts['acute-load-chart'].destroy();
    }

    const series = buildRollingSevenDayLoad(activities, rangeStart, rangeEnd);
    if (!series || !series.sorted.length) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '16px sans-serif';
        ctx.fillStyle = '#999';
        ctx.textAlign = 'center';
        ctx.fillText('No load data to display', canvas.width / 2, canvas.height / 2);
        if (explainer) explainer.innerHTML = '';
        return;
    }

    const profile = getPmcProfile(series.sorted);

    // Filter series data for visible range ONLY AT DISPLAY TIME
    const visibleIndices = series.labels.map((label, i) => {
        const date = new Date(`${label}T00:00:00`);
        return date >= rangeStart && date <= rangeEnd ? i : -1;
    }).filter(i => i !== -1);

    const labels = series.labels
        .filter((_, i) => visibleIndices.includes(i))
        .map(label => {
            const date = new Date(`${label}T00:00:00`);
            return `${date.getMonth() + 1}/${date.getDate()}`;
        });

    const load7d = series.load7d.filter((_, i) => visibleIndices.includes(i));
    const ctl7dBase = series.ctlDaily.filter((_, i) => visibleIndices.includes(i)).map(value => +(value * 7).toFixed(1));
    const tsbData = series.tsbDaily.filter((_, i) => visibleIndices.includes(i));
    const ctlForBand = series.ctlDaily.filter((_, i) => visibleIndices.includes(i));
    const idealBand = ctlForBand.map(value => getAcuteLoadBand(profile, value, acuteLoadBandMode));
    const bandLower = idealBand.map(band => band.lower);
    const bandUpper = idealBand.map(band => band.upper);

    // ALWAYS use TODAY's values for display
    const lastBand = getAcuteLoadBand(profile, series.ctlDaily[series.ctlDaily.length - 1], acuteLoadBandMode);
    const lastLoad = series.load7d[series.load7d.length - 1] || 0;
    const lastCtl = series.ctlDaily[series.ctlDaily.length - 1] || 0;
    const lastAtl = series.atlDaily[series.atlDaily.length - 1] || 0;
    const lastTsb = series.tsbDaily[series.tsbDaily.length - 1] || 0;
    const lastRisk = series.riskDaily[series.riskDaily.length - 1] || 0;
    const lastRecovery = series.recoveryDaily[series.recoveryDaily.length - 1] || 4;
    const lastStatus = getAcuteLoadStatus(lastLoad, lastBand);
    const maxY = Math.max(...bandUpper, ...load7d, ...ctl7dBase, 10);
    const minTsb = Math.min(...tsbData, -10);
    const maxTsb = Math.max(...tsbData, 10);
    const tsbPadding = Math.max(6, Math.ceil((maxTsb - minTsb) * 0.12));
    const visibleActivities = series.sorted.filter(activity => {
        const date = new Date(activity.start_date_local);
        return date >= rangeStart && date <= rangeEnd;
    });

    renderAcuteLoadExplanation(visibleActivities, series.sorted, profile, lastBand, lastStatus, lastLoad, lastCtl, lastAtl, lastTsb, lastRisk, lastRecovery);

    dashboardCharts['acute-load-chart'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Ideal range floor',
                    data: bandLower,
                    borderColor: 'rgba(97, 181, 102, 0)',
                    backgroundColor: 'rgba(97, 181, 102, 0)',
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    borderWidth: 0,
                    fill: false,
                    tension: 0.28,
                    yAxisID: 'y'
                },
                {
                    label: 'Ideal acute load range',
                    data: bandUpper,
                    borderColor: 'rgba(49, 163, 84, 0.45)',
                    backgroundColor: 'rgba(76, 175, 80, 0.18)',
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    borderWidth: 1.5,
                    fill: '-1',
                    tension: 0.28,
                    yAxisID: 'y'
                },
                {
                    label: 'Base load (CTL × 7)',
                    data: ctl7dBase,
                    borderColor: 'rgba(0, 116, 217, 0.7)',
                    backgroundColor: 'rgba(0, 116, 217, 0)',
                    pointRadius: 0,
                    borderWidth: 1.75,
                    borderDash: [6, 4],
                    tension: 0.28,
                    fill: false,
                    yAxisID: 'y',
                    hidden: true
                },
                {
                    label: 'Rolling 7-day load',
                    data: load7d,
                    borderColor: '#fc5200',
                    backgroundColor: 'rgba(252, 82, 0, 0.12)',
                    pointRadius: 0,
                    borderWidth: 3,
                    tension: 0.28,
                    fill: false,
                    yAxisID: 'y'
                },
                {
                    label: 'TSB (Form)',
                    data: tsbData,
                    borderColor: '#2ECC40',
                    backgroundColor: 'rgba(46, 204, 64, 0.08)',
                    pointRadius: 0,
                    borderWidth: 2,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y1',
                    hidden: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 10,
                        padding: 16,
                        filter(item) {
                            return item.text !== 'Ideal range floor';
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label(context) {
                            if (context.dataset.label === 'Ideal range floor') {
                                return null;
                            }

                            if (context.dataset.label === 'Ideal acute load range') {
                                const lower = bandLower[context.dataIndex];
                                const upper = bandUpper[context.dataIndex];
                                return `Ideal range: ${lower.toFixed(1)} – ${upper.toFixed(1)}`;
                            }

                            return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Date' },
                    ticks: { maxTicksLimit: 10 },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    suggestedMax: Math.ceil(maxY * 1.12),
                    title: { display: true, text: 'Load (7-day TSS)' },
                    grid: { color: 'rgba(0, 0, 0, 0.06)' }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'TSB (Form)' },
                    grid: {
                        drawOnChartArea: true,
                        color(context) {
                            return context.tick.value === 0 ? 'rgba(46, 204, 64, 0.28)' : 'rgba(0,0,0,0)';
                        }
                    },
                    min: Math.floor(minTsb - tsbPadding),
                    max: Math.ceil(maxTsb + tsbPadding)
                }
            }
        }
    });
}






/**
 * Renderiza una gr→fica de barras: TSS por per→odo
 */
function renderTSSBarChart(activities, rangeType) {
    const canvas = document.getElementById('tss-bar-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (window.tssBarChart) window.tssBarChart.destroy();

    // Calcular las fechas de inicio y fin del per→odo seleccionado
    const now = new Date();
    let startDate;
    let endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    switch (rangeType) {
        case 'week': {
            const today = new Date();
            const day = today.getDay(); // 0 = domingo, 1 = lunes...
            const diffToMonday = day === 0 ? -6 : 1 - day; // si es domingo, retrocede 6
            startDate = new Date(today);
            startDate.setDate(today.getDate() + diffToMonday);
            startDate.setHours(0, 0, 0, 0);

            endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6); // lunes + 6 = domingo
            endDate.setHours(23, 59, 59, 999);
            break;
        }

        case 'month': {
            const today = new Date();
            startDate = new Date(today.getFullYear(), today.getMonth(), 1); // 1 del mes actual
            endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0); // →ltimo del mes actual
            endDate.setHours(23, 59, 59, 999);
            break;
        }


        case 'year': {
            startDate = new Date(now.getFullYear(), 0, 1);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        case 'last7': {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 6);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        case 'last30': {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 29);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        case 'last3m': {
            startDate = new Date(now);
            startDate.setMonth(now.getMonth() - 3);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        case 'last6m': {
            startDate = new Date(now);
            startDate.setMonth(now.getMonth() - 6);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        case 'last365': {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 364);
            startDate.setHours(0, 0, 0, 0);
            break;
        }
        default: {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
            startDate.setHours(0, 0, 0, 0);
        }
    }

    const { labels, datasets, yAxisTitle } = getTSSBarChartData(activities, rangeType, startDate, endDate, tssUnit);

    if (!labels.length || !datasets.length) {
        console.warn('No data to render');
        return;
    }

    window.tssBarChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: { mode: 'index', intersect: false },
                legend: { display: true, position: 'top' }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: yAxisTitle },
                    ticks: { precision: 0 }
                }
            }
        }
    });
}

/**
 * Helper function to get TSS/Activities/Hours data grouped by period
 */
function getTSSBarChartData(activities, rangeType, startDate, endDate, unit) {
    // For All Time, use quarterly aggregation
    if (rangeType === 'alltime') {
        return getTSSBarChartDataQuarterly(activities, unit);
    }

    const isDaily = rangeType === 'week' || rangeType === 'last7' || rangeType === 'month' || rangeType === 'last30';
    const isWeekly = rangeType === 'last3m' || rangeType === 'last6m';
    const isMonthly = rangeType === 'year' || rangeType === 'last365';

    const sports = ['Run', 'Ride', 'Swim', 'Gym'];
    const sportColors = {
        Run: '#ff7f50',
        Ride: '#20b2aa',
        Swim: '#1e90ff',
        Gym: '#9370db',
        Other: '#95a5a6'
    };

    let grouped = {};
    const minDate = new Date(startDate);
    const maxDate = new Date(endDate);
    let curr = new Date(minDate);

    // Crear todos los periodos del rango (incluso sin datos)
    let guard = 0;
    while (curr <= maxDate && guard++ < 2000) {
        let key;
        if (isDaily) {
            key = getPeriodKey(curr, 'daily');
            curr.setDate(curr.getDate() + 1);
        } else if (isWeekly) {
            key = getPeriodKey(curr, 'weekly');
            curr.setDate(curr.getDate() + 7);
        } else if (isMonthly) {
            key = getPeriodKey(curr, 'monthly');
            curr.setMonth(curr.getMonth() + 1);
        } else {
            key = getPeriodKey(curr, 'daily');
            curr.setDate(curr.getDate() + 1);
        }
        grouped[key] = {
            total: 0,
            Run: 0,
            Ride: 0,
            Swim: 0,
            Gym: 0,
            Other: 0
        };
    }

    // Agregar datos reales de actividades
    if (activities && activities.length > 0) {
        for (const a of activities) {
            if (!a.start_date_local) continue;
            const date = new Date(a.start_date_local);
            if (isNaN(date)) continue;

            if (!isDateWithinRange(date, minDate, maxDate)) continue;

            let key;
            if (isDaily) {
                key = getPeriodKey(date, 'daily');
            } else if (isWeekly) {
                key = getPeriodKey(date, 'weekly');
            } else if (isMonthly) {
                key = getPeriodKey(date, 'monthly');
            } else {
                key = getPeriodKey(date, 'daily');
            }

            if (grouped.hasOwnProperty(key)) {
                const sport = getSportKey(a.type || '');

                let value = 0;
                if (unit === 'tss') {
                    value = a.tss ?? (a.suffer_score ? a.suffer_score * 1.05 : 0);
                } else if (unit === 'activities') {
                    value = 1;
                } else if (unit === 'hours') {
                    value = (a.moving_time || 0) / 3600; // Convert seconds to hours
                }

                grouped[key].total += value;
                grouped[key][sport] = (grouped[key][sport] || 0) + value;
            }
        }
    }

    const sortedKeys = Object.keys(grouped).sort((a, b) => {
        if (isMonthly) {
            const [ya, ma] = a.split('-').map(Number);
            const [yb, mb] = b.split('-').map(Number);
            return new Date(ya, ma - 1, 1) - new Date(yb, mb - 1, 1);
        }
        return parseLocalYMD(a) - parseLocalYMD(b);
    });

    const labels = sortedKeys.map(key => {
        if (isDaily) {
            const d = parseLocalYMD(key);
            return d.toLocaleDateString('default', { day: '2-digit', month: 'short' });
        }
        if (isWeekly) {
            const d = parseLocalYMD(key);
            return `Week ${getWeekNumber(d)}`;
        }
        if (isMonthly) {
            const [y, m] = key.split('-');
            return `${new Date(y, m - 1).toLocaleString('default', { month: 'short' })} ${y.slice(2)}`;
        }
        return key;
    });

    let formatFn = v => Math.round(v);
    if (unit === 'hours') {
        formatFn = v => v.toFixed(1);
    }

    const datasets = sports
        .map(sport => ({
            label: sport,
            data: sortedKeys.map(k => formatFn(grouped[k][sport] || 0)),
            backgroundColor: sportColors[sport],
            borderColor: '#fff',
            borderWidth: 1,
            borderRadius: 3
        }))
        .filter(dataset => dataset.data.some(value => value > 0));

    let yAxisTitle = 'TSS';
    if (unit === 'activities') {
        yAxisTitle = 'Activities';
    } else if (unit === 'hours') {
        yAxisTitle = 'Hours';
    }

    return { labels, datasets, yAxisTitle };
}

/**
 * Get TSS bar chart data with QUARTERLY aggregation for All Time range
 */
function getTSSBarChartDataQuarterly(activities, unit) {
    const sports = ['Run', 'Ride', 'Swim', 'Gym'];
    const sportColors = {
        Run: '#ff7f50',
        Ride: '#20b2aa',
        Swim: '#1e90ff',
        Gym: '#9370db',
        Other: '#95a5a6'
    };

    const grouped = {};

    // Group by quarter: "2023-Q1", "2023-Q2", etc.
    if (activities && activities.length > 0) {
        for (const a of activities) {
            if (!a.start_date_local) continue;
            const date = new Date(a.start_date_local);
            if (isNaN(date)) continue;

            const year = date.getFullYear();
            const quarter = Math.floor(date.getMonth() / 3) + 1;
            const key = `${year}-Q${quarter}`;

            if (!grouped[key]) {
                grouped[key] = {
                    total: 0,
                    Run: 0,
                    Ride: 0,
                    Swim: 0,
                    Gym: 0,
                    Other: 0
                };
            }

            const sport = getSportKey(a.type || '');
            let value = 0;

            if (unit === 'tss') {
                value = a.tss ?? (a.suffer_score ? a.suffer_score * 1.05 : 0);
            } else if (unit === 'activities') {
                value = 1;
            } else if (unit === 'hours') {
                value = (a.moving_time || 0) / 3600;
            }

            grouped[key].total += value;
            grouped[key][sport] = (grouped[key][sport] || 0) + value;
        }
    }

    const sortedKeys = Object.keys(grouped).sort();

    const labels = sortedKeys.map(key => {
        // Format: "2023 Q1", "2023 Q2", etc.
        const [year, quarter] = key.split('-');
        return `${year} ${quarter}`;
    });

    let formatFn = v => Math.round(v);
    if (unit === 'hours') {
        formatFn = v => v.toFixed(1);
    }

    const datasets = sports
        .map(sport => ({
            label: sport,
            data: sortedKeys.map(k => formatFn(grouped[k][sport] || 0)),
            backgroundColor: sportColors[sport],
            borderColor: '#fff',
            borderWidth: 1,
            borderRadius: 3
        }))
        .filter(dataset => dataset.data.some(value => value > 0));

    let yAxisTitle = 'TSS';
    if (unit === 'activities') {
        yAxisTitle = 'Activities';
    } else if (unit === 'hours') {
        yAxisTitle = 'Hours';
    }

    return { labels, datasets, yAxisTitle };
}

/**
 * Obtiene el lunes de la semana para una fecha dada
 */
function getMondayOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 = domingo, 1 = lunes, ..., 6 = s→bado
    const diff = day === 0 ? -6 : 1 - day; // Si es domingo, ir al lunes anterior (retroceder 6)
    d.setDate(d.getDate() + diff);
    return d;
}

function parseLocalYMD(ymd) {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
}

function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getPeriodKey(date, mode) {
    if (mode === 'daily') return toLocalYMD(date);
    if (mode === 'weekly') return toLocalYMD(getMondayOfWeek(date));
    return getMonthKey(date);
}

function isDateWithinRange(date, minDate, maxDate) {
    const value = date.getTime();
    return value >= minDate.getTime() && value <= maxDate.getTime();
}

/**
 * Obtiene el n→mero de semana del a→o (ISO 8601)
 */
function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}


// ==============================================
// CUSTOMIZABLE RUNNING GOALS TRACKER
// ==============================================

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth();

const GOAL_SPORTS = [
    { label: 'All', value: 'all' },
    { label: '🏃 Run', value: 'Run' },
    { label: '🚴 Ride', value: 'Ride' },
    { label: '🏊 Swim', value: 'Swim' },
    { label: '💪 Gym', value: 'Workout' },
];

function filterActivitiesBySport(activities, sport) {
    if (!sport || sport === 'all') return activities;
    if (sport === 'Workout') return activities.filter(a => a.type && (a.type.includes('WeightTraining') || a.type.includes('Workout')));
    return activities.filter(a => a.type && a.type.includes(sport));
}

function loadGoals() {
    const saved = JSON.parse(localStorage.getItem('training_goals') || 'null');
    return saved || { km: { annual: 1000, monthly: 100 }, hours: { annual: 150, monthly: 15 }, activities: { annual: 200, monthly: 20 }, selectedMetric: 'km', selectedSport: 'all' };
}

function saveGoals(goals) {
    localStorage.setItem('training_goals', JSON.stringify(goals));
}

const metricConfig = {
    km: {
        label: 'Distance (km)',
        unit: 'km',
        extract: (a) => (a.distance || 0) / 1000,
    },
    hours: {
        label: 'Time (hours)',
        unit: 'h',
        extract: (a) => (a.moving_time || 0) / 3600,
    },
    activities: {
        label: 'Activities',
        unit: '',
        extract: () => 1,
    },
};

// ==============================================
// MAIN RENDER FUNCTION
// ==============================================

export function renderGoalsSectionAdvanced(allActivities) {
    const container = document.getElementById('dashboard-tab');
    if (!container) return;

    const goals = loadGoals();
    const metric = goals.selectedMetric || 'km';
    const sport = goals.selectedSport || 'all';
    const cfg = metricConfig[metric];
    const annualGoal = goals[metric]?.annual || 1000;
    const monthlyGoal = goals[metric]?.monthly || 100;

    if (!document.getElementById('goals-section')) {
        const goalsDiv = document.createElement('div');
        goalsDiv.id = 'goals-section';
        goalsDiv.style = 'margin-top:2rem;';
        container.appendChild(goalsDiv);
    }

    const div = document.getElementById('goals-section');
    div.innerHTML = `
    <!-- METRIC SELECTOR TABS -->
    <div id="goal-metric-tabs" style="display:flex;gap:0.5rem;margin-bottom:0.5rem;flex-wrap:wrap;">
        <button class="goal-metric-btn ${metric === 'km' ? 'active' : ''}" data-metric="km" style="padding:0.5rem 1rem;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:${metric === 'km' ? '#007bff' : '#fff'};color:${metric === 'km' ? '#fff' : '#333'};">Distance (km)</button>
        <button class="goal-metric-btn ${metric === 'hours' ? 'active' : ''}" data-metric="hours" style="padding:0.5rem 1rem;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:${metric === 'hours' ? '#007bff' : '#fff'};color:${metric === 'hours' ? '#fff' : '#333'};">Time (hours)</button>
        <button class="goal-metric-btn ${metric === 'activities' ? 'active' : ''}" data-metric="activities" style="padding:0.5rem 1rem;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:${metric === 'activities' ? '#007bff' : '#fff'};color:${metric === 'activities' ? '#fff' : '#333'};">Activities</button>
    </div>
    <!-- SPORT SELECTOR -->
    <div id="goal-sport-tabs" style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
        ${GOAL_SPORTS.map(s => `<button class="goal-sport-btn ${sport === s.value ? 'active' : ''}" data-sport="${s.value}" style="padding:0.4rem 0.9rem;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:${sport === s.value ? '#fc5200' : '#fff'};color:${sport === s.value ? '#fff' : '#333'};font-size:0.9em;">${s.label}</button>`).join('')}
    </div>

    <div style="display:flex;gap:2rem;flex-wrap:wrap;">
        <!-- YEARLY GOAL -->
        <div style="flex:1;min-width:300px;background:white;padding:1.5rem;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <h4 style="margin:0;">Annual Goal</h4>
                <div>
                    <input type="number" id="annual-goal" value="${annualGoal}" min="1"
                           style="width:100px;padding:0.5rem;border:1px solid #ddd;border-radius:4px;">
                    <span style="margin-left:0.5rem;">${cfg.unit}</span>
                    <button id="update-annual-btn" style="margin-left:1rem;padding:0.5rem 1rem;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;">
                        Update
                    </button>
                </div>
            </div>
            <div id="annual-stats" style="margin-bottom:1rem;padding:0.8rem;background:#f8f9fa;border-radius:4px;"></div>
            <canvas id="annual-goal-chart" style="max-height:300px;width:100%;"></canvas>
        </div>

        <!-- MONTHLY GOAL -->
        <div style="flex:1;min-width:300px;background:white;padding:1.5rem;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <h4 style="margin:0;">Monthly Goal - ${getMonthName(currentMonth)}</h4>
                <div>
                    <input type="number" id="monthly-goal" value="${monthlyGoal}" min="1"
                           style="width:100px;padding:0.5rem;border:1px solid #ddd;border-radius:4px;">
                    <span style="margin-left:0.5rem;">${cfg.unit}</span>
                    <button id="update-monthly-btn" style="margin-left:1rem;padding:0.5rem 1rem;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;">
                        Update
                    </button>
                </div>
            </div>
            <div id="monthly-stats" style="margin-bottom:1rem;padding:0.8rem;background:#f8f9fa;border-radius:4px;"></div>
            <canvas id="monthly-goal-chart" style="max-height:300px;width:100%;"></canvas>
        </div>
    </div>
`;

    // Metric tab listeners
    div.querySelectorAll('.goal-metric-btn').forEach(btn => {
        btn.onclick = () => {
            const g = loadGoals();
            g.selectedMetric = btn.dataset.metric;
            saveGoals(g);
            renderGoalsSectionAdvanced(allActivities);
        };
    });

    // Sport tab listeners
    div.querySelectorAll('.goal-sport-btn').forEach(btn => {
        btn.onclick = () => {
            const g = loadGoals();
            g.selectedSport = btn.dataset.sport;
            saveGoals(g);
            renderGoalsSectionAdvanced(allActivities);
        };
    });

    // Event listeners
    document.getElementById('update-annual-btn').onclick = () => {
        const g = loadGoals();
        const m = g.selectedMetric || 'km';
        g[m] = g[m] || {};
        g[m].annual = parseFloat(document.getElementById('annual-goal').value);
        saveGoals(g);
        renderGoalCharts(allActivities, g);
    };

    document.getElementById('update-monthly-btn').onclick = () => {
        const g = loadGoals();
        const m = g.selectedMetric || 'km';
        g[m] = g[m] || {};
        g[m].monthly = parseFloat(document.getElementById('monthly-goal').value);
        saveGoals(g);
        renderGoalCharts(allActivities, g);
    };

    renderGoalCharts(allActivities, goals);
}

function renderGoalCharts(allActivities, goals) {
    const metric = goals.selectedMetric || 'km';
    const sport = goals.selectedSport || 'all';
    const cfg = metricConfig[metric];
    const annualGoal = goals[metric]?.annual || 1000;
    const monthlyGoal = goals[metric]?.monthly || 100;
    const filteredActivities = filterActivitiesBySport(allActivities, sport);

    renderAnnualChart(filteredActivities, cfg, annualGoal, sport);
    renderMonthlyChart(filteredActivities, cfg, monthlyGoal, sport);
}

// ==============================================
// ANNUAL CHART
// ==============================================

function renderAnnualChart(allActivities, cfg, annualGoal, sport) {
    const sportLabel = GOAL_SPORTS.find(s => s.value === (sport || 'all'))?.label || 'All';

    const labels = [];
    const actualData = [];
    const plannedData = [];
    let cumulative = 0;

    for (let m = 0; m < 12; m++) {
        labels.push(getMonthName(m));

        const monthStart = new Date(currentYear, m, 1);
        const monthEnd = new Date(currentYear, m + 1, 0, 23, 59, 59);

        const monthActivities = allActivities.filter(a => {
            const d = new Date(a.start_date_local);
            return d >= monthStart && d <= monthEnd;
        });

        const monthVal = monthActivities.reduce((sum, a) => sum + cfg.extract(a), 0);
        cumulative += monthVal;
        actualData.push(parseFloat(cumulative.toFixed(2)));
        plannedData.push(parseFloat((annualGoal / 12 * (m + 1)).toFixed(2)));
    }

    const currentTotal = actualData[actualData.length - 1] || 0;
    const percentage = ((currentTotal / annualGoal) * 100).toFixed(1);
    const remaining = Math.max(0, annualGoal - currentTotal).toFixed(1);

    document.getElementById('annual-stats').innerHTML = `
        <strong>Sport:</strong> ${sportLabel}
        | <strong>Progress:</strong> ${currentTotal.toFixed(1)} / ${annualGoal} ${cfg.unit} (${percentage}%)
        | <strong>Remaining:</strong> ${remaining} ${cfg.unit}
    `;

    const config = {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Goal',
                    data: plannedData,
                    borderColor: '#28a745',
                    borderDash: [8, 4],
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    pointRadius: 3
                },
                {
                    label: 'Actual',
                    data: actualData,
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#007bff'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(1)} ${cfg.unit}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: `Cumulative ${cfg.label}` }
                }
            }
        }
    };

    createDashboardChart('annual-goal-chart', config);
}

// ==============================================
// MONTHLY CHART
// ==============================================

function renderMonthlyChart(allActivities, cfg, monthlyGoal, sport) {
    const sportLabel = GOAL_SPORTS.find(s => s.value === (sport || 'all'))?.label || 'All';

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const labels = [];
    const actualData = [];
    const plannedData = [];
    let cumulative = 0;

    for (let d = 1; d <= daysInMonth; d++) {
        labels.push(d);

        const dayStart = new Date(currentYear, currentMonth, d, 0, 0, 0);
        const dayEnd = new Date(currentYear, currentMonth, d, 23, 59, 59);

        const dayActivities = allActivities.filter(a => {
            const dt = new Date(a.start_date_local);
            return dt >= dayStart && dt <= dayEnd;
        });

        const dayVal = dayActivities.reduce((sum, a) => sum + cfg.extract(a), 0);
        cumulative += dayVal;
        actualData.push(parseFloat(cumulative.toFixed(2)));
        plannedData.push(parseFloat((monthlyGoal / daysInMonth * d).toFixed(2)));
    }

    const currentTotal = actualData[actualData.length - 1] || 0;
    const percentage = ((currentTotal / monthlyGoal) * 100).toFixed(1);
    const remaining = Math.max(0, monthlyGoal - currentTotal).toFixed(1);

    document.getElementById('monthly-stats').innerHTML = `
        <strong>Sport:</strong> ${sportLabel}
        | <strong>Progress:</strong> ${currentTotal.toFixed(1)} / ${monthlyGoal} ${cfg.unit} (${percentage}%)
        | <strong>Remaining:</strong> ${remaining} ${cfg.unit}
    `;

    const config = {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Goal',
                    data: plannedData,
                    borderColor: '#28a745',
                    borderDash: [8, 4],
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0
                },
                {
                    label: 'Actual',
                    data: actualData,
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    pointBackgroundColor: '#007bff'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(1)} ${cfg.unit}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: `Cumulative ${cfg.label}` }
                },
                x: {
                    title: { display: true, text: 'Day of Month' }
                }
            }
        }
    };

    createDashboardChart('monthly-goal-chart', config);
}

// ==============================================
// HELPER FUNCTION
// ==============================================

function getMonthName(monthIndex) {
    return new Date(2000, monthIndex, 1).toLocaleString('default', { month: 'short' });
}
