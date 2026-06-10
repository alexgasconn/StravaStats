import * as utils from './utils.js';
import { getCachedGears } from './api.js';
import { renderRunAnalysisTab } from './run-analysis.js';

const PACE_FAST_LIMIT_SEC = 150;
const PACE_SLOW_LIMIT_SEC = 900;
const RUN_PLUS_ID_PREFIX = 'run-plus-';
const RUN_TYPE_RE = /run/i;
const RACE_NAME_RE = /马拉松|半马|半程|比赛|race|marathon|赛事|pb|5k|10k/i;
const CAPACITY_INPUTS_STORAGE_KEY = 'run_plus_capacity_inputs_v1';
const IMPACT_ATL_DAYS = 7;
const IMPACT_CTL_DAYS = 42;
let runPlusRollingWindow = 26;

const FIELD_GROUPS = [
    { key: 'core', label: 'Core activity fields', fields: ['ID', 'DT', 'TYPE', 'DIST', 'MT', 'PACE'], tier: 'MVP' },
    { key: 'load', label: 'Load and terrain context', fields: ['ELEV', 'HRa', 'TSS', 'CTL', 'ATL', 'TSB', 'GEAR'], tier: 'Plus' },
    { key: 'advanced', label: 'Activity-level depth', fields: ['STREAM', 'LAP', 'WEATHER', 'RACE', 'PROFILE'], tier: 'Advanced' }
];

const METRIC_CATALOG = [
    ['Data Quality Score', 'Can this report be trusted?', 'ID, DT, TYPE, DIST, MT', 'HRa, STREAM, WEATHER', 'MVP'],
    ['Field Availability Matrix', 'Which paid-report modules can be generated from this athlete?', 'ID, DT, TYPE, DIST, MT', 'HRa, ELEV, GEAR, WEATHER, STREAM', 'MVP'],
    ['Activity Anomaly Gate', 'Which runs should be excluded before interpretation?', 'ID, DT, DIST, MT', 'HRa, NAME, TYPE', 'MVP'],
    ['Duplicate Activity Gate', 'Are double uploads inflating mileage or frequency?', 'ID, DT, DIST, MT, NAME', 'device, source', 'MVP'],
    ['Weekly Distance + Rolling Mean', 'Is training load stable or changing?', 'DT, DIST', 'MT, HRa', 'MVP'],
    ['Consistency Grid', 'Where are the training gaps and blocks?', 'DT, DIST', 'HRa, ELEV', 'MVP'],
    ['Training Frequency', 'How often does the athlete create a run stimulus?', 'DT, TYPE', 'DIST, MT', 'MVP'],
    ['Rest Gap Pattern', 'Are there long breaks or dense blocks?', 'DT, TYPE', 'DIST, HRa', 'MVP'],
    ['Activities by Type', 'Does training structure match intent?', 'DIST, MT, TYPE', 'HRa, WT, RACE', 'MVP'],
    ['Pace vs Distance', 'How does pace scale with distance?', 'DIST, MT', 'RACE, ELEV', 'MVP'],
    ['Distance Distribution', 'Which distances dominate training habits?', 'DIST', 'NAME, WT', 'MVP'],
    ['Pace Distribution', 'Which intensity band dominates training?', 'DIST, MT', 'HRa, ZONE', 'MVP'],
    ['Elevation Distribution', 'How much hill stimulus exists?', 'ELEV', 'DIST, STREAM', 'MVP'],
    ['Long Run Inventory', 'How much marathon-relevant endurance exists?', 'DT, DIST', 'PACE, HRa, ELEV', 'MVP'],
    ['Long Run Ratio', 'Is the long run too dominant relative to weekly volume?', 'DT, DIST', 'HRa, fatigue', 'MVP'],
    ['Longest Runs', 'What is the single-run endurance ceiling?', 'ID, DT, DIST', 'PACE, HRa, ELEV', 'MVP'],
    ['Most Elevation', 'What is the largest terrain-load session?', 'ID, DT, ELEV', 'DIST, HRa, route', 'MVP'],
    ['Verified Fastest Races', 'What are credible race performances?', 'DIST, MT, NAME', 'official time, best efforts', 'MVP'],
    ['Race Credibility Score', 'Can fastest efforts be treated as race evidence?', 'DIST, MT, NAME, DT', 'official result, course, weather', 'MVP'],
    ['Daily Eddington', 'How repeatable is long-distance durability?', 'DT, DIST', 'RACE, NAME', 'MVP'],
    ['Weekly Eddington x3', 'How often can the athlete repeat 100km-class weeks?', 'DT, DIST', 'HRa, fatigue', 'MVP'],
    ['Volume Ramp Rate', 'Is mileage increasing faster than the athlete usually tolerates?', 'DT, DIST', 'HRa, injury history', 'MVP'],
    ['Monthly Volume Sweet Spot', 'Which monthly volume most often precedes improvement?', 'DT, DIST, MT, HRa', 'fatigue, race phase', 'Plus'],
    ['Monthly Consistency vs Improvement', 'Does stable training historically improve efficiency?', 'DT, DIST, MT, HRa', 'terrain, intensity', 'Plus'],
    ['Pace-HR Curve', 'Is the same HR producing faster running?', 'DIST, MT, HRa, DT', 'ELEV, WEATHER', 'Plus'],
    ['Aerobic Efficiency Evolution', 'Is aerobic cost improving over time?', 'DIST, MT, HRa, DT', 'WEATHER, ELEV', 'Plus'],
    ['Distance vs Efficiency', 'Does efficiency degrade in longer runs?', 'DIST, MT, HRa', 'ELEV, RACE', 'Plus'],
    ['Pace vs HR Efficiency Curve', 'Which pace range gives the best aerobic return?', 'DIST, MT, HRa', 'ELEV, WEATHER', 'Plus'],
    ['Easy-Run Discipline', 'Is easy running actually easy for this athlete?', 'DIST, MT, HRa', 'HR zones, RPE', 'Plus'],
    ['Intensity Distribution', 'Does the training mix look polarized, pyramidal, or threshold-heavy?', 'DIST, MT, HRa', 'ZONE, workout type', 'Plus'],
    ['CTL / ATL / TSB', 'What is the fitness-fatigue-readiness balance?', 'daily load', 'HR zones, power', 'Plus'],
    ['Musculoskeletal Impact Load', 'How much repetitive tissue impact did running create?', 'DT, DIST, MT, ELEV', 'CADENCE, GEAR, STREAM, surface', 'Plus'],
    ['Impact ATL / CTL / Buffer', 'Is tissue impact rising faster than historical tolerance?', 'daily impact load', 'pain, next-day response, strength, sleep', 'Plus'],
    ['Capacity Gate', 'Can the athlete absorb current impact without symptom escalation?', 'impact load, history', 'pain, soreness, HRV, energy availability', 'Plus'],
    ['Training Readiness', 'Is today a build, maintain, or absorb day?', 'CTL, ATL, TSB, recent load', 'sleep, soreness, HRV', 'Plus'],
    ['Freshness Score', 'Has acute fatigue dropped enough to run hard?', 'ATL, TSB, recent rest', 'sleep, HRV', 'Plus'],
    ['Fitness Score', 'Is chronic training capacity rising or falling?', 'CTL, daily load', 'race results', 'Plus'],
    ['Fatigue Score', 'How large is the recent load burden?', 'ATL, daily load', 'HRV, soreness', 'Plus'],
    ['Injury Risk Flag', 'Are load spikes, density, or long-run ratios risky?', 'DT, DIST, daily load', 'HRa, sleep, injury history', 'Plus'],
    ['Acute Chronic Ratio', 'Is recent load too high versus baseline?', 'daily load', 'HR zones, power', 'Plus'],
    ['Taper Detection', 'Is the athlete reducing load before a race?', 'DT, DIST, daily load', 'race date', 'Plus'],
    ['Shoe Load Context', 'Could gear mileage explain fatigue or injury risk?', 'GEAR, DIST, DT', 'shoe model, retirement mileage', 'Plus'],
    ['Terrain-Normalized Pace', 'Is pace change due to fitness or elevation?', 'DIST, MT, ELEV', 'grade-adjusted pace, route', 'Plus'],
    ['Weather-Normalized Performance', 'Is heat, cold, or wind distorting pace/HR?', 'DIST, MT, HRa, WEATHER', 'humidity, wind, dew point', 'Advanced'],
    ['Splits and HR Drift', 'Does fatigue appear inside long sessions?', 'STREAM or LAP', 'weather, terrain', 'Advanced'],
    ['Cadence and Stride Signal', 'Is form changing with pace or fatigue?', 'CADENCE', 'stride length, power, ground contact', 'Advanced'],
    ['Route Repeatability', 'Can repeated routes isolate true performance changes?', 'route/polyline, DT', 'weather, HRa, elevation', 'Advanced'],
    ['Goal-Specific Gap Analysis', 'What is missing for 5K, 10K, half, or marathon goals?', 'DIST, MT, DT', 'race goal, race history, HR zones', 'Advanced'],
    ['AI Report Narrative', 'What should the coach tell this athlete this week?', 'all MVP fields', 'Plus/Advanced fields, user notes', 'Advanced']
];

// ─── Utility functions ─────────────────────────────────

function esc(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
}

function runPlusId(id) {
    return `${RUN_PLUS_ID_PREFIX}${id}`;
}

function isRun(activity) {
    return RUN_TYPE_RE.test(activity?.type || '') || RUN_TYPE_RE.test(activity?.sport_type || '');
}

function dateKey(activity) {
    return String(activity?.start_date_local || activity?.start_date || '').slice(0, 10);
}

function km(activity) {
    return (Number(activity?.distance) || 0) / 1000;
}

function paceSec(activity) {
    const distanceKm = km(activity);
    const movingTime = Number(activity?.moving_time) || 0;
    return distanceKm > 0 ? movingTime / distanceKm : Infinity;
}

function paceLabel(seconds) {
    return Number.isFinite(seconds) ? utils.formatPaceRun(seconds) : '-';
}

function pct(value) {
    return `${Math.round(value * 100)}%`;
}

function formatSigned(value, digits = 1) {
    if (!Number.isFinite(value)) return '-';
    return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function sum(values) {
    return values.reduce((acc, value) => acc + value, 0);
}

function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function weekStart(dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return toLocalDateKey(date);
}

function monthKey(dateString) {
    return String(dateString || '').slice(0, 7);
}

function average(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? sum(clean) / clean.length : null;
}

function percentLabel(value, digits = 0) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '-';
}

function safeFixed(value, digits = 1, fallback = '-') {
    return Number.isFinite(value) ? value.toFixed(digits) : fallback;
}

function daysBetween(dateA, dateB) {
    const a = new Date(dateA);
    const b = new Date(dateB);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    a.setHours(0, 0, 0, 0);
    b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 86400000);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function addDays(dateString, days) {
    const [year, month, day] = String(dateString || '').split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, day || 1);
    if (Number.isNaN(date.getTime())) return null;
    date.setDate(date.getDate() + days);
    return toLocalDateKey(date);
}

function buildDateRange(startDate, endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) return [];
    const span = daysBetween(startDate, endDate);
    if (!Number.isFinite(span) || span < 0) return [];
    const dates = [];
    for (let offset = 0; offset <= span; offset += 1) {
        dates.push(addDays(startDate, offset));
    }
    return dates.filter(Boolean);
}

function percentile(values, p) {
    const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!clean.length) return null;
    const idx = (clean.length - 1) * clamp(p, 0, 1);
    const low = Math.floor(idx);
    const high = Math.ceil(idx);
    if (low === high) return clean[low];
    return clean[low] + (clean[high] - clean[low]) * (idx - low);
}

function rollingSum(values, windowSize) {
    const result = [];
    let running = 0;
    values.forEach((value, index) => {
        running += Number(value) || 0;
        if (index >= windowSize) running -= Number(values[index - windowSize]) || 0;
        result.push(running);
    });
    return result;
}

function exponentialMovingAverage(values, timeConstantDays) {
    const alpha = 1 / Math.max(1, timeConstantDays);
    const result = [];
    let previous = Number(values[0]) || 0;
    values.forEach((value, index) => {
        const current = Number(value) || 0;
        previous = index === 0 ? current : previous + alpha * (current - previous);
        result.push(previous);
    });
    return result;
}

function readCapacityInputs() {
    try {
        const raw = localStorage.getItem(CAPACITY_INPUTS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_err) {
        return {};
    }
}

function normalizeCapacityInputValue(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, min, max) : null;
}

function normalizeCapacityInputs(raw = {}) {
    return {
        painScore: normalizeCapacityInputValue(raw.painScore, 0, 10),
        nextDayScore: normalizeCapacityInputValue(raw.nextDayScore, 0, 10),
        sleepScore: normalizeCapacityInputValue(raw.sleepScore, 1, 5),
        energyScore: normalizeCapacityInputValue(raw.energyScore, 1, 5),
        strengthSessions: normalizeCapacityInputValue(raw.strengthSessions, 0, 7)
    };
}

function hasCapacityInputs(inputs) {
    return ['painScore', 'nextDayScore', 'sleepScore', 'energyScore', 'strengthSessions']
        .some(key => Number.isFinite(inputs[key]));
}

function capacityModifierFromInputs(inputs) {
    const normalized = normalizeCapacityInputs(inputs);
    let modifier = 1;
    const notes = [];

    if (Number.isFinite(normalized.painScore)) {
        const painPenalty = normalized.painScore >= 5 ? 0.28 : normalized.painScore >= 3 ? 0.14 : normalized.painScore * 0.025;
        modifier -= painPenalty;
        if (normalized.painScore >= 3) notes.push(`pain ${normalized.painScore}/10`);
    }
    if (Number.isFinite(normalized.nextDayScore)) {
        const responsePenalty = normalized.nextDayScore >= 5 ? 0.32 : normalized.nextDayScore >= 3 ? 0.18 : normalized.nextDayScore * 0.03;
        modifier -= responsePenalty;
        if (normalized.nextDayScore >= 3) notes.push(`next-day response ${normalized.nextDayScore}/10`);
    }
    if (Number.isFinite(normalized.sleepScore)) {
        modifier += (normalized.sleepScore - 3) * 0.045;
        if (normalized.sleepScore <= 2) notes.push('low sleep score');
    }
    if (Number.isFinite(normalized.energyScore)) {
        modifier += (normalized.energyScore - 3) * 0.045;
        if (normalized.energyScore <= 2) notes.push('low energy score');
    }
    if (Number.isFinite(normalized.strengthSessions)) {
        modifier += Math.min(0.10, normalized.strengthSessions * 0.025);
    }

    return {
        modifier: clamp(modifier, 0.45, 1.15),
        notes,
        inputs: normalized,
        hasInputs: hasCapacityInputs(normalized)
    };
}

// ─── Data builders ──────────────────────────────────────

function buildWeeklyTotals(runs) {
    const weekly = new Map();
    runs.forEach(run => {
        const week = weekStart(dateKey(run));
        if (!week) return;
        weekly.set(week, (weekly.get(week) || 0) + km(run));
    });
    return [...weekly.entries()]
        .map(([week, distance]) => ({ week, distance }))
        .sort((a, b) => a.week.localeCompare(b.week));
}

function buildMonthlyTotals(runs) {
    const monthly = new Map();
    runs.forEach(run => {
        const month = monthKey(dateKey(run));
        if (!month) return;
        const entry = monthly.get(month) || { month, distance: 0, runs: 0 };
        entry.distance += km(run);
        entry.runs += 1;
        monthly.set(month, entry);
    });
    return [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function buildEddington(values) {
    if (!values.length) return { current: 0, nextNeed: 0, qualifiersAtCurrent: 0 };
    const max = Math.floor(Math.max(...values));
    let current = 0;
    const counts = new Map();
    for (let threshold = 1; threshold <= max; threshold += 1) {
        const qualifiers = values.filter(value => Math.floor(value) >= threshold).length;
        counts.set(threshold, qualifiers);
        if (qualifiers >= threshold) current = threshold;
    }
    const next = current + 1;
    const nextQualifiers = counts.get(next) || values.filter(value => Math.floor(value) >= next).length;
    return {
        current,
        nextNeed: Math.max(0, next - nextQualifiers),
        qualifiersAtCurrent: counts.get(current) || 0
    };
}

function buildDailyTotals(runs) {
    const daily = new Map();
    runs.forEach(run => {
        const date = dateKey(run);
        if (!date) return;
        daily.set(date, (daily.get(date) || 0) + km(run));
    });
    return [...daily.entries()]
        .map(([date, distance]) => ({ date, distance }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

function getDataQuality(runs) {
    const total = runs.length || 1;
    const coverage = {
        id: runs.filter(run => run.id).length / total,
        date: runs.filter(run => dateKey(run)).length / total,
        distance: runs.filter(run => Number(run.distance) > 0).length / total,
        movingTime: runs.filter(run => Number(run.moving_time) > 0).length / total,
        elevation: runs.filter(run => run.total_elevation_gain !== undefined && run.total_elevation_gain !== null).length / total,
        heartRate: runs.filter(run => Number(run.average_heartrate) > 0).length / total,
        load: runs.filter(run => Number.isFinite(run.tss)).length / total,
        pmc: runs.filter(run => Number.isFinite(run.ctl) && Number.isFinite(run.atl) && Number.isFinite(run.tsb)).length / total,
        gear: runs.filter(run => run.gear_id).length / total,
        cadence: runs.filter(run => Number(run.average_cadence) > 0).length / total,
        weather: runs.filter(run => run.weather || run.temperature !== undefined).length / total,
        race: runs.filter(run => RACE_NAME_RE.test(run.name || '') || run.workout_type === 1).length / total
    };
    const core = (coverage.id + coverage.date + coverage.distance + coverage.movingTime) / 4;
    const physiology = coverage.heartRate;
    const loadModel = (coverage.load + coverage.pmc) / 2;
    const context = (coverage.elevation + coverage.gear + coverage.weather + coverage.race) / 4;
    const score = Math.round((core * 0.56 + physiology * 0.18 + loadModel * 0.14 + context * 0.12) * 100);

    return { coverage, score };
}

function getAnomalies(runs) {
    return runs
        .map(run => {
            const reasons = [];
            const distanceKm = km(run);
            const pace = paceSec(run);
            if (!dateKey(run)) reasons.push('missing date');
            if (distanceKm <= 0) reasons.push('zero distance');
            if (!Number(run.moving_time)) reasons.push('missing moving time');
            if (Number.isFinite(pace) && pace < PACE_FAST_LIMIT_SEC) reasons.push('unrealistic fast pace');
            if (Number.isFinite(pace) && pace > PACE_SLOW_LIMIT_SEC) reasons.push('very slow pace');
            return { run, reasons, distanceKm, pace };
        })
        .filter(item => item.reasons.length)
        .sort((a, b) => a.pace - b.pace);
}

function getDuplicateSuspects(runs) {
    const groups = new Map();
    runs.forEach(run => {
        const key = [
            dateKey(run),
            Math.round(km(run) * 100) / 100,
            Math.round(Number(run.moving_time) || 0),
            String(run.name || '').trim().toLowerCase()
        ].join('|');
        groups.set(key, [...(groups.get(key) || []), run]);
    });
    return [...groups.values()].filter(group => group.length > 1);
}

function getRaceLikeRuns(runs) {
    return runs
        .filter(run => RACE_NAME_RE.test(run.name || '') || run.workout_type === 1)
        .filter(run => km(run) >= 5)
        .filter(run => {
            const pace = paceSec(run);
            return Number.isFinite(pace) && pace >= PACE_FAST_LIMIT_SEC && pace <= PACE_SLOW_LIMIT_SEC;
        })
        .sort((a, b) => paceSec(a) - paceSec(b));
}

function bucketLongRuns(runs) {
    return {
        over16: runs.filter(run => km(run) >= 16).length,
        overHalf: runs.filter(run => km(run) >= 21.0975).length,
        over30: runs.filter(run => km(run) >= 30).length,
        overMarathon: runs.filter(run => km(run) >= 42).length
    };
}

function estimateRunSteps(run) {
    const distanceKm = km(run);
    const minutes = (Number(run?.moving_time) || 0) / 60;
    if (distanceKm <= 0 || minutes <= 0) return 0;

    const rawCadence = Number(run?.average_cadence);
    if (Number.isFinite(rawCadence) && rawCadence > 0) {
        // Strava/Garmin cadence can appear as total steps/min or one-leg cycles/min.
        const totalStepsPerMinute = rawCadence < 130 ? rawCadence * 2 : rawCadence;
        if (totalStepsPerMinute >= 120 && totalStepsPerMinute <= 230) {
            return totalStepsPerMinute * minutes;
        }
    }

    // Activity-summary fallback used when no cadence stream/summary is present.
    return distanceKm * 900;
}

function getRunSpeedFactor(run) {
    const paceMinutes = paceSec(run) / 60;
    if (!Number.isFinite(paceMinutes) || paceMinutes <= 0) return 1;
    return clamp(1 + (5.5 - paceMinutes) * 0.055, 0.82, 1.34);
}

function getRunTerrainFactor(run) {
    const distanceKm = km(run);
    if (distanceKm <= 0) return 1;
    const elevationPerKm = (Number(run?.total_elevation_gain) || 0) / distanceKm;
    const sportType = String(run?.sport_type || run?.type || '');
    const trailFactor = /trail/i.test(sportType) ? 1.08 : 1;
    return clamp((1 + Math.min(0.32, elevationPerKm / 800)) * trailFactor, 0.95, 1.42);
}

function getRunDurationFatigueFactor(run) {
    const minutes = (Number(run?.moving_time) || 0) / 60;
    if (!Number.isFinite(minutes) || minutes <= 0) return 1;
    return clamp(1 + Math.max(0, minutes - 90) / 450, 1, 1.32);
}

function getLongRunFactor(run) {
    const distanceKm = km(run);
    if (distanceKm < 16) return 1;
    return clamp(1 + (distanceKm - 16) / 100, 1.02, 1.28);
}

function getGearImpactModifier(run, gearNameMap) {
    const gearLabel = gearNameMap?.get(run?.gear_id) || run?.gear?.name || '';
    const normalized = String(gearLabel).toLowerCase();
    const carbonLike = /carbon|vaporfly|alphafly|metaspeed|adios\s*pro|prime\s*x|rocket\s*x|endorphin\s*pro|takumi|sc\s*elite|fast-r|cielo\s*x/.test(normalized);
    const minimalLike = /minimal|barefoot|fivefingers|merrell|vibram|zero\s*drop/.test(normalized);
    const modifier = carbonLike ? 1.08 : minimalLike ? 1.06 : 1;
    const note = carbonLike ? 'possible carbon/super-shoe load redistribution' : minimalLike ? 'possible low-cushion/minimal-shoe load shift' : null;
    return { modifier, note, gearLabel };
}

function calculateImpactLoadForRun(run, gearNameMap) {
    const steps = estimateRunSteps(run);
    const distanceKm = km(run);
    const speedFactor = getRunSpeedFactor(run);
    const terrainFactor = getRunTerrainFactor(run);
    const durationFactor = getRunDurationFatigueFactor(run);
    const longRunFactor = getLongRunFactor(run);
    const gear = getGearImpactModifier(run, gearNameMap);
    const impactPoints = (steps / 100) * speedFactor * terrainFactor * durationFactor * longRunFactor * gear.modifier;

    return {
        date: dateKey(run),
        distanceKm,
        steps,
        impactPoints: Number.isFinite(impactPoints) ? impactPoints : 0,
        speedFactor,
        terrainFactor,
        durationFactor,
        longRunFactor,
        shoeFactor: gear.modifier,
        shoeNote: gear.note,
        gearLabel: gear.gearLabel,
        elevationGain: Number(run?.total_elevation_gain) || 0,
        paceSeconds: paceSec(run),
        run
    };
}

function buildWeeklyImpactTotals(dailySeries) {
    const weekly = new Map();
    dailySeries.forEach(day => {
        const week = weekStart(day.date);
        if (!week) return;
        const entry = weekly.get(week) || { week, impactLoad: 0, distance: 0, steps: 0, days: 0 };
        entry.impactLoad += day.impactLoad;
        entry.distance += day.distance;
        entry.steps += day.steps;
        if (day.impactLoad > 0) entry.days += 1;
        weekly.set(week, entry);
    });
    return [...weekly.values()].sort((a, b) => a.week.localeCompare(b.week));
}

function getCapacityStatus(ratio, rampPct, longRunShare, inputsMeta) {
    const pain = inputsMeta?.inputs?.painScore;
    const nextDay = inputsMeta?.inputs?.nextDayScore;
    if ((Number.isFinite(pain) && pain >= 5) || (Number.isFinite(nextDay) && nextDay >= 5) || ratio >= 1.45 || rampPct >= 0.45 || longRunShare >= 0.55) {
        return {
            level: 'risk',
            label: 'Capacity exceeded',
            narrative: 'Current impact load is beyond the athlete\'s recent tolerance estimate or symptom response is high. Reduce mechanical stress before adding more volume, speed, downhills, or race shoes.'
        };
    }
    if ((Number.isFinite(pain) && pain >= 3) || (Number.isFinite(nextDay) && nextDay >= 3) || ratio >= 1.18 || rampPct >= 0.22 || longRunShare >= 0.42) {
        return {
            level: 'warn',
            label: 'Build with caution',
            narrative: 'The build may be productive, but impact progression, long-run dominance, or recovery inputs need a planned absorption week.'
        };
    }
    return {
        level: 'good',
        label: 'Impact within tolerance',
        narrative: 'Current impact load sits inside the athlete\'s recent tolerance estimate. Continue progressing only one mechanical variable at a time.'
    };
}

function buildImpactLoadModel(runs, gearNameMap, capacityInputs = readCapacityInputs()) {
    const perRun = runs
        .map(run => calculateImpactLoadForRun(run, gearNameMap))
        .filter(item => item.date && item.distanceKm > 0 && item.impactPoints >= 0)
        .sort((a, b) => a.date.localeCompare(b.date));

    const dates = perRun.length ? buildDateRange(perRun[0].date, perRun[perRun.length - 1].date) : [];
    const dailyMap = new Map();
    dates.forEach(date => dailyMap.set(date, { date, impactLoad: 0, distance: 0, steps: 0, runCount: 0, maxRunImpact: 0 }));

    perRun.forEach(item => {
        const entry = dailyMap.get(item.date) || { date: item.date, impactLoad: 0, distance: 0, steps: 0, runCount: 0, maxRunImpact: 0 };
        entry.impactLoad += item.impactPoints;
        entry.distance += item.distanceKm;
        entry.steps += item.steps;
        entry.runCount += 1;
        entry.maxRunImpact = Math.max(entry.maxRunImpact, item.impactPoints);
        dailyMap.set(item.date, entry);
    });

    const dailySeries = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const dailyValues = dailySeries.map(day => day.impactLoad);
    const atlSeries = exponentialMovingAverage(dailyValues, IMPACT_ATL_DAYS);
    const ctlSeries = exponentialMovingAverage(dailyValues, IMPACT_CTL_DAYS);
    const rolling7 = rollingSum(dailyValues, 7);
    const rolling28 = rollingSum(dailyValues, 28);
    dailySeries.forEach((day, index) => {
        day.impactAtl = atlSeries[index] || 0;
        day.impactCtl = ctlSeries[index] || 0;
        day.impactTsb = (ctlSeries[index] || 0) - (atlSeries[index] || 0);
        day.rolling7Impact = rolling7[index] || 0;
        day.rolling28Impact = rolling28[index] || 0;
    });

    const weeklyTotals = buildWeeklyImpactTotals(dailySeries);
    const weeklyLoads = weeklyTotals.map(week => week.impactLoad);
    const recent7Impact = dailySeries.length ? rolling7[rolling7.length - 1] || 0 : 0;
    const previous28Window = dailyValues.slice(Math.max(0, dailyValues.length - 35), Math.max(0, dailyValues.length - 7));
    const previous28WeeklyAvg = previous28Window.length ? sum(previous28Window) / previous28Window.length * 7 : 0;
    const current28WeeklyAvg = dailySeries.length ? (rolling28[rolling28.length - 1] || 0) / 4 : 0;
    const weeklyRampPct = previous28WeeklyAvg > 0 ? (recent7Impact - previous28WeeklyAvg) / previous28WeeklyAvg : null;
    const latest = dailySeries[dailySeries.length - 1] || null;
    const latestAtl = latest?.impactAtl || 0;
    const latestCtl = latest?.impactCtl || 0;
    const atlCtlRatio = latestCtl > 0 ? latestAtl / latestCtl : null;
    const latest7Days = dailySeries.slice(-7);
    const longestRecentRun = perRun
        .filter(item => latest7Days.some(day => day.date === item.date))
        .reduce((best, item) => item.impactPoints > (best?.impactPoints || 0) ? item : best, null);
    const longRunShare = recent7Impact > 0 && longestRecentRun ? longestRecentRun.impactPoints / recent7Impact : 0;

    const rolling4WeekAvg = [];
    for (let i = 3; i < weeklyLoads.length; i += 1) {
        rolling4WeekAvg.push(sum(weeklyLoads.slice(i - 3, i + 1)) / 4);
    }
    const baselineCapacity = percentile(rolling4WeekAvg.slice(0, -1), 0.75)
        ?? percentile(rolling4WeekAvg, 0.75)
        ?? percentile(weeklyLoads, 0.75)
        ?? current28WeeklyAvg
        ?? recent7Impact
        ?? 0;
    const capacityMeta = capacityModifierFromInputs(capacityInputs);
    const adjustedCapacity = baselineCapacity * capacityMeta.modifier;
    const capacityRatio = adjustedCapacity > 0 ? recent7Impact / adjustedCapacity : null;
    const status = getCapacityStatus(capacityRatio || 0, weeklyRampPct || 0, longRunShare || 0, capacityMeta);
    const shoeShiftRuns = perRun.filter(item => item.shoeNote).slice(-10);
    const validRunCount = Math.max(1, runs.length);
    const dataConfidence = Math.round(clamp(
        55
        + (runs.filter(run => Number(run.distance) > 0 && Number(run.moving_time) > 0).length / validRunCount) * 18
        + (runs.filter(run => run.total_elevation_gain !== undefined && run.total_elevation_gain !== null).length / validRunCount) * 10
        + (runs.filter(run => Number(run.average_cadence) > 0).length / validRunCount) * 9
        + (runs.filter(run => run.gear_id).length / validRunCount) * 8,
        0,
        100
    ));

    return {
        perRun,
        dailySeries,
        weeklyTotals,
        recent7Impact,
        current28WeeklyAvg,
        previous28WeeklyAvg,
        weeklyRampPct,
        latestAtl,
        latestCtl,
        latestTsb: latest ? latest.impactTsb : null,
        atlCtlRatio,
        baselineCapacity,
        adjustedCapacity,
        capacityRatio,
        longRunShare,
        longestRecentRun,
        status,
        capacityMeta,
        shoeShiftRuns,
        dataConfidence,
        totals: {
            impactLoad: sum(perRun.map(item => item.impactPoints)),
            steps: sum(perRun.map(item => item.steps)),
            distance: sum(perRun.map(item => item.distanceKm))
        }
    };
}

function buildModel(allActivities, dateFilterFrom, dateFilterTo, gearFilter = 'all') {
    const filteredActivities = utils.filterActivitiesByDate(allActivities || [], dateFilterFrom, dateFilterTo);
    const runs = filteredActivities
        .filter(isRun)
        .filter(run => gearFilter === 'all' || run.gear_id === gearFilter);

    const sorted = [...runs].sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
    const dailyTotals = buildDailyTotals(sorted);
    const weeklyTotals = buildWeeklyTotals(sorted);
    const monthlyTotals = buildMonthlyTotals(sorted);
    const quality = getDataQuality(sorted);
    const anomalies = getAnomalies(sorted);
    const duplicateSuspects = getDuplicateSuspects(sorted);
    const raceLike = getRaceLikeRuns(sorted);
    const hrRuns = sorted.filter(run => Number(run.average_heartrate) > 0 && Number(run.distance) > 0 && Number(run.moving_time) > 0);
    const pmcRuns = sorted.filter(run => Number.isFinite(run.ctl) && Number.isFinite(run.atl) && Number.isFinite(run.tsb));
    const efficiencyValues = hrRuns.map(run => (paceSec(run) / 60) / Number(run.average_heartrate)).filter(Number.isFinite);
    const weeklyDistances = weeklyTotals.map(item => item.distance);
    const recentWeeks = weeklyTotals.slice(-12);
    const previousWeeks = weeklyTotals.slice(-24, -12);
    const recentWeeklyAvg = recentWeeks.length ? sum(recentWeeks.map(item => item.distance)) / recentWeeks.length : 0;
    const previousWeeklyAvg = previousWeeks.length ? sum(previousWeeks.map(item => item.distance)) / previousWeeks.length : 0;
    const monthlyDistances = monthlyTotals.map(item => item.distance);
    const dailyE = buildEddington(dailyTotals.map(item => item.distance));
    const weeklyE3 = buildEddington(weeklyTotals.map(item => item.distance / 3));
    const longRuns = bucketLongRuns(sorted);
    const totalDistance = sum(sorted.map(km));
    const totalTimeHours = sum(sorted.map(run => Number(run.moving_time) || 0)) / 3600;
    const totalElevation = sum(sorted.map(run => Number(run.total_elevation_gain) || 0));
    const maxRun = sorted.reduce((best, run) => km(run) > km(best || {}) ? run : best, null);
    const maxElevationRun = sorted.reduce((best, run) => (Number(run.total_elevation_gain) || 0) > (Number(best?.total_elevation_gain) || 0) ? run : best, null);
    const bestRace = raceLike[0] || null;
    const impactLoad = buildImpactLoadModel(sorted, getGearNameMap(), readCapacityInputs());

    return {
        runs: sorted,
        dateRange: {
            start: sorted[0] ? dateKey(sorted[0]) : '-',
            end: sorted[sorted.length - 1] ? dateKey(sorted[sorted.length - 1]) : '-'
        },
        quality,
        anomalies,
        duplicateSuspects,
        raceLike,
        hrRuns,
        currentPmc: pmcRuns[pmcRuns.length - 1] || null,
        efficiencyMedian: median(efficiencyValues),
        weeklyTotals,
        monthlyTotals,
        recentWeeklyAvg,
        previousWeeklyAvg,
        weeklyMedian: median(weeklyDistances),
        monthlyMedian: median(monthlyDistances),
        dailyE,
        weeklyE3,
        longRuns,
        impactLoad,
        totals: {
            distance: totalDistance,
            timeHours: totalTimeHours,
            elevation: totalElevation,
            avgPace: totalDistance > 0 ? (sum(sorted.map(run => Number(run.moving_time) || 0)) / totalDistance) : Infinity
        },
        top: { maxRun, maxElevationRun, bestRace }
    };
}

// ─── Diagnostics engine ─────────────────────────────────

function getDateSpanDays(model) {
    if (!model.runs.length) return 0;
    const span = daysBetween(model.dateRange.start, model.dateRange.end);
    return Number.isFinite(span) ? Math.max(1, span + 1) : 1;
}

function getMaxInactiveGapDays(dailyTotals) {
    if (dailyTotals.length < 2) return 0;
    let maxGap = 0;
    for (let i = 1; i < dailyTotals.length; i += 1) {
        const gap = daysBetween(dailyTotals[i - 1].date, dailyTotals[i].date);
        if (Number.isFinite(gap)) maxGap = Math.max(maxGap, gap - 1);
    }
    return maxGap;
}

function getRecentWeeks(model, count = 12) {
    return model.weeklyTotals.slice(-count);
}

function getWeeklyRamp(model) {
    if (!model.previousWeeklyAvg) return null;
    return (model.recentWeeklyAvg - model.previousWeeklyAvg) / model.previousWeeklyAvg;
}

function getLongRunShare(model) {
    const recent = getRecentWeeks(model, 12);
    const recentTotal = sum(recent.map(item => item.distance));
    const recentLong = model.runs
        .filter(run => {
            const runDate = dateKey(run);
            if (!recent.length || !runDate) return false;
            return runDate >= recent[0].week;
        })
        .map(km)
        .filter(distance => distance >= 16);
    const longestRecent = recentLong.length ? Math.max(...recentLong) : 0;
    return recentTotal > 0 ? longestRecent / (recentTotal / Math.max(1, recent.length)) : null;
}

function getPaceDecay(model) {
    const valid = model.runs
        .filter(run => Number(run.distance) > 0 && Number(run.moving_time) > 0)
        .map(run => ({ distance: km(run), pace: paceSec(run) / 60 }))
        .filter(item => Number.isFinite(item.distance) && Number.isFinite(item.pace) && item.distance > 0);

    const short = valid.filter(item => item.distance >= 3 && item.distance < 8).map(item => item.pace);
    const long = valid.filter(item => item.distance >= 16).map(item => item.pace);
    const shortMedian = median(short);
    const longMedian = median(long);

    return {
        shortMedian,
        longMedian,
        ratio: shortMedian && longMedian ? (longMedian - shortMedian) / shortMedian : null,
        shortCount: short.length,
        longCount: long.length
    };
}

function getEfficiencyTrend(model) {
    const valid = [...model.hrRuns].sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
    if (valid.length < 8) {
        return { status: 'limited', early: null, late: null, improvementPct: null, validCount: valid.length };
    }

    const windowSize = Math.max(4, Math.floor(valid.length * 0.33));
    const earlyValues = valid.slice(0, windowSize).map(run => Number(run.efficiency)).filter(Number.isFinite);
    const lateValues = valid.slice(-windowSize).map(run => Number(run.efficiency)).filter(Number.isFinite);
    const early = median(earlyValues);
    const late = median(lateValues);
    const improvementPct = early ? (early - late) / early : null;

    let status = 'flat';
    if (Number.isFinite(improvementPct) && improvementPct >= 0.05) status = 'improving';
    if (Number.isFinite(improvementPct) && improvementPct <= -0.05) status = 'declining';

    return { status, early, late, improvementPct, validCount: valid.length };
}

function getDistanceEfficiencySlope(model) {
    const data = model.hrRuns
        .map(run => ({ x: km(run), y: Number(run.efficiency) }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x > 0);

    if (data.length < 6) return null;
    const n = data.length;
    const sumX = sum(data.map(point => point.x));
    const sumY = sum(data.map(point => point.y));
    const sumXY = sum(data.map(point => point.x * point.y));
    const sumXX = sum(data.map(point => point.x * point.x));
    const denominator = n * sumXX - sumX * sumX;
    if (!denominator) return null;
    return (n * sumXY - sumX * sumY) / denominator;
}

function getVolumeSweetSpot(model) {
    const byMonth = new Map();
    model.hrRuns.forEach(run => {
        const month = monthKey(dateKey(run));
        if (!month) return;
        const entry = byMonth.get(month) || { month, volume: 0, efficiencies: [] };
        entry.volume += km(run);
        if (Number.isFinite(Number(run.efficiency))) entry.efficiencies.push(Number(run.efficiency));
        byMonth.set(month, entry);
    });

    const months = [...byMonth.values()]
        .filter(item => item.efficiencies.length >= 3)
        .map(item => ({ ...item, meanEfficiency: average(item.efficiencies) }))
        .sort((a, b) => a.month.localeCompare(b.month));

    if (months.length < 6) {
        return { label: 'Insufficient monthly HR sample', confidence: 'low', months: months.length };
    }

    const sortedByVolume = [...months].sort((a, b) => a.volume - b.volume);
    const bucketSize = Math.max(1, Math.floor(sortedByVolume.length / 3));
    const buckets = ['lower', 'middle', 'higher'].map((name, index) => {
        const start = index * bucketSize;
        const end = index === 2 ? sortedByVolume.length : (index + 1) * bucketSize;
        const items = sortedByVolume.slice(start, end);
        let improved = 0;
        items.forEach(item => {
            const monthIndex = months.findIndex(month => month.month === item.month);
            if (monthIndex > 0 && item.meanEfficiency < months[monthIndex - 1].meanEfficiency) improved += 1;
        });
        const volumes = items.map(item => item.volume);
        return {
            name,
            low: Math.min(...volumes),
            high: Math.max(...volumes),
            rate: items.length ? improved / items.length : 0,
            count: items.length
        };
    });

    const best = buckets.reduce((candidate, item) => item.rate > candidate.rate ? item : candidate, buckets[0]);
    return {
        label: `${best.low.toFixed(0)}-${best.high.toFixed(0)} km/month`,
        confidence: months.length >= 12 ? 'medium' : 'low',
        months: months.length,
        buckets,
        best
    };
}

function classifyLoadReadiness(currentPmc) {
    if (!currentPmc) {
        return {
            status: 'limited',
            label: 'Load model unavailable',
            narrative: 'CTL/ATL/TSB cannot be interpreted because the local load model has too little valid input.'
        };
    }

    const ctl = Number(currentPmc.ctl);
    const atl = Number(currentPmc.atl);
    const tsb = Number(currentPmc.tsb);
    const atlDelta = atl - ctl;

    if (tsb <= -20 || atlDelta >= 18) {
        return {
            status: 'risk',
            label: 'High acute fatigue',
            narrative: `TSB ${formatSigned(tsb)} and ATL-CTL ${formatSigned(atlDelta)} suggest an overload or high-fatigue block.`
        };
    }
    if (tsb <= -8 || atlDelta >= 8) {
        return {
            status: 'build',
            label: 'Build phase',
            narrative: `ATL is above CTL and TSB is ${formatSigned(tsb)}, consistent with productive load if recovery is planned.`
        };
    }
    if (tsb >= 8) {
        return {
            status: 'fresh',
            label: 'Fresh or tapering',
            narrative: `TSB ${formatSigned(tsb)} indicates reduced acute fatigue; useful before testing or racing if fitness is adequate.`
        };
    }
    return {
        status: 'maintain',
        label: 'Balanced maintenance',
        narrative: `CTL ${safeFixed(ctl)}, ATL ${safeFixed(atl)}, and TSB ${formatSigned(tsb)} are in a relatively balanced range.`
    };
}

function summarizeImpactRun(item) {
    if (!item) return null;
    return {
        date: item.date,
        name: item.run?.name || 'Run',
        distanceKm: item.distanceKm,
        impactPoints: item.impactPoints,
        gearLabel: item.gearLabel || null,
        shoeNote: item.shoeNote || null,
        factors: {
            speed: item.speedFactor,
            terrain: item.terrainFactor,
            duration: item.durationFactor,
            longRun: item.longRunFactor,
            shoe: item.shoeFactor
        }
    };
}

function buildDiagnostics(model) {
    const spanDays = getDateSpanDays(model);
    const activeDays = model.weeklyTotals.length ? buildDailyTotals(model.runs).length : 0;
    const activeWeeks = model.weeklyTotals.filter(item => item.distance > 0).length;
    const maxGapDays = getMaxInactiveGapDays(buildDailyTotals(model.runs));
    const weeklyRamp = getWeeklyRamp(model);
    const hrCoverage = model.runs.length ? model.hrRuns.length / model.runs.length : 0;
    const efficiencyTrend = getEfficiencyTrend(model);
    const paceDecay = getPaceDecay(model);
    const distanceEfficiencySlope = getDistanceEfficiencySlope(model);
    const volumeSweetSpot = getVolumeSweetSpot(model);
    const loadState = classifyLoadReadiness(model.currentPmc);
    const longRunShare = getLongRunShare(model);
    const impact = model.impactLoad;
    const qualityRisk = model.quality.score < 55 || model.anomalies.length > Math.max(2, model.runs.length * 0.04);

    const consistencyProfile = {
        activeDays,
        activeWeeks,
        spanDays,
        runDensity: spanDays ? activeDays / spanDays : 0,
        maxGapDays,
        recentWeeklyAvg: model.recentWeeklyAvg,
        previousWeeklyAvg: model.previousWeeklyAvg,
        weeklyRamp,
        label: maxGapDays >= 21
            ? 'Interrupted'
            : weeklyRamp > 0.25
                ? 'Ramping'
                : weeklyRamp < -0.2
                    ? 'Backing off'
                    : 'Stable'
    };

    const aerobicEfficiency = {
        hrCoverage,
        validRuns: model.hrRuns.length,
        trend: efficiencyTrend,
        distanceEfficiencySlope,
        confidence: hrCoverage >= 0.75 ? 'high' : hrCoverage >= 0.45 ? 'medium' : 'low'
    };

    const durabilityProfile = {
        dailyE: model.dailyE,
        weeklyE3: model.weeklyE3,
        longRuns: model.longRuns,
        longRunShare,
        paceDecay,
        label: model.longRuns.over30 >= 4 || model.weeklyE3.current >= 10
            ? 'Marathon durability evidence'
            : model.longRuns.overHalf >= 4
                ? 'Half-marathon durability evidence'
                : 'Shorter-distance dominant'
    };

    const raceCredibility = {
        credibleCount: model.raceLike.length,
        anomalyCount: model.anomalies.length,
        duplicateGroups: model.duplicateSuspects.length,
        bestRace: model.top.bestRace,
        confidence: model.raceLike.length >= 3 && !qualityRisk
            ? 'medium'
            : model.raceLike.length >= 1
                ? 'low'
                : 'missing'
    };

    const tissueLoad = {
        status: impact.status,
        recent7Impact: impact.recent7Impact,
        current28WeeklyAvg: impact.current28WeeklyAvg,
        previous28WeeklyAvg: impact.previous28WeeklyAvg,
        weeklyRampPct: impact.weeklyRampPct,
        atl: impact.latestAtl,
        ctl: impact.latestCtl,
        tsb: impact.latestTsb,
        atlCtlRatio: impact.atlCtlRatio,
        baselineCapacity: impact.baselineCapacity,
        adjustedCapacity: impact.adjustedCapacity,
        capacityRatio: impact.capacityRatio,
        longRunShare: impact.longRunShare,
        longestRecentRun: summarizeImpactRun(impact.longestRecentRun),
        confidence: impact.dataConfidence >= 82 ? 'high' : impact.dataConfidence >= 65 ? 'medium' : 'low',
        dataConfidence: impact.dataConfidence,
        inputState: impact.capacityMeta,
        shoeShiftRuns: impact.shoeShiftRuns.length
    };

    const recommendedFocus = [];
    if (qualityRisk) recommendedFocus.push('Clean anomalies before ranking PBs or writing paid-report claims.');
    if (consistencyProfile.maxGapDays >= 14) recommendedFocus.push('Rebuild frequency first; the consistency grid shows material training breaks.');
    if (weeklyRamp > 0.3) recommendedFocus.push('Control load ramp and add recovery weeks before adding more volume.');
    if (tissueLoad.status.level === 'risk') recommendedFocus.push('Reduce mechanical impact load before adding speed, hills, long-run distance, or race-shoe exposure.');
    if (tissueLoad.status.level === 'warn') recommendedFocus.push('Hold impact load steady and schedule an absorption week if symptoms, sleep, or energy worsen.');
    if (aerobicEfficiency.confidence === 'low') recommendedFocus.push('Improve HR data coverage before making aerobic-efficiency claims.');
    if (efficiencyTrend.status === 'declining') recommendedFocus.push('Investigate fatigue, heat, hills, or intensity drift because HR-normalized efficiency is worsening.');
    if (durabilityProfile.label === 'Shorter-distance dominant') recommendedFocus.push('Add repeatable long-run exposure if the goal is half-marathon or marathon durability.');
    if (!recommendedFocus.length) recommendedFocus.push('Maintain current consistency while using long-run and HR-efficiency charts to choose the next build focus.');

    return {
        dataTrust: {
            score: model.quality.score,
            coverage: model.quality.coverage,
            anomalies: model.anomalies.length,
            duplicateSuspects: model.duplicateSuspects.length,
            confidence: model.quality.score >= 80 ? 'high' : model.quality.score >= 55 ? 'medium' : 'low'
        },
        consistencyProfile,
        volumeTrend: {
            recentWeeklyAvg: model.recentWeeklyAvg,
            previousWeeklyAvg: model.previousWeeklyAvg,
            weeklyRamp,
            monthlyMedian: model.monthlyMedian,
            sweetSpot: volumeSweetSpot
        },
        aerobicEfficiency,
        durabilityProfile,
        loadReadiness: {
            current: model.currentPmc,
            state: loadState,
            note: 'CTL, ATL, TSB, TSS and readiness are local algorithm outputs, not direct Strava fields.'
        },
        tissueLoad,
        raceCredibility,
        recommendedFocus
    };
}

// ─── Render helpers ─────────────────────────────────────

function confidenceClass(score) {
    if (score >= 80) return 'run-plus-pill--good';
    if (score >= 55) return 'run-plus-pill--warn';
    return 'run-plus-pill--risk';
}

function pillClassForConfidence(confidence) {
    if (confidence === 'high') return 'run-plus-pill--good';
    if (confidence === 'medium') return 'run-plus-pill--warn';
    if (confidence === 'missing') return 'run-plus-pill--muted';
    return 'run-plus-pill--risk';
}

function pillClassForImpactLevel(level) {
    if (level === 'good') return 'run-plus-pill--good';
    if (level === 'warn') return 'run-plus-pill--warn';
    if (level === 'risk') return 'run-plus-pill--risk';
    return 'run-plus-pill--muted';
}

function metricAvailability(metric, quality) {
    const required = metric[2];
    const bonus = metric[3];
    if (/STREAM|LAP|CADENCE|route|polyline/.test(required)) return ['Advanced data needed', 'run-plus-pill--muted'];
    if (/impact load|daily impact/i.test(required) && (quality.coverage.distance < 0.8 || quality.coverage.movingTime < 0.8)) return ['Needs core run fields', 'run-plus-pill--warn'];
    if (/impact load|daily impact/i.test(required) && quality.coverage.elevation < 0.5) return ['Ready; elevation weak', 'run-plus-pill--muted'];
    if (/CADENCE|GEAR/.test(bonus) && (quality.coverage.cadence < 0.3 || quality.coverage.gear < 0.3)) return ['Ready; impact proxy only', 'run-plus-pill--muted'];
    if (/daily load/.test(required) && quality.coverage.load < 0.5) return ['Needs load model', 'run-plus-pill--warn'];
    if (/CTL|ATL|TSB/.test(required) && quality.coverage.pmc < 0.5) return ['Needs PMC model', 'run-plus-pill--warn'];
    if (/HRa|ZONE/.test(required) && quality.coverage.heartRate < 0.5) return ['Limited by HR coverage', 'run-plus-pill--warn'];
    if (/WEATHER/.test(required) && quality.coverage.weather < 0.2) return ['Required context missing', 'run-plus-pill--warn'];
    if ((/HRa|ZONE/.test(bonus) && quality.coverage.heartRate < 0.5) || (/WEATHER/.test(bonus) && quality.coverage.weather < 0.2)) {
        return ['Ready; bonus missing', 'run-plus-pill--muted'];
    }
    return ['Ready', 'run-plus-pill--good'];
}

function getGearNameMap() {
    const cached = getCachedGears();
    const gears = cached || JSON.parse(localStorage.getItem('strava_gears') || '[]');
    return new Map(gears.map(gear => {
        const label = gear.name || [gear.brand_name, gear.model_name].filter(Boolean).join(' ') || gear.id;
        return [gear.id, label];
    }));
}

function getRunPlusGearOptions(allActivities) {
    const gearNameMap = getGearNameMap();
    const gearIds = [...new Set(
        (allActivities || [])
            .filter(isRun)
            .map(activity => activity.gear_id)
            .filter(Boolean)
    )].sort((a, b) => (gearNameMap.get(a) || a).localeCompare(gearNameMap.get(b) || b));

    return [
        { value: 'all', label: 'All shoes' },
        ...gearIds.map(gearId => ({ value: gearId, label: gearNameMap.get(gearId) || gearId }))
    ];
}

function getRunPlusYears(allActivities) {
    return [...new Set(
        (allActivities || [])
            .filter(isRun)
            .map(activity => dateKey(activity).slice(0, 4))
            .filter(year => /^\d{4}$/.test(year))
    )].sort((a, b) => b.localeCompare(a));
}

function renderRunPlusFilters(allActivities, dateFilterFrom, dateFilterTo, gearFilter) {
    const gearOptions = getRunPlusGearOptions(allActivities);
    const selectedGear = gearOptions.some(option => option.value === gearFilter) ? gearFilter : 'all';
    const years = getRunPlusYears(allActivities);
    const activeYear = dateFilterFrom && dateFilterTo && dateFilterFrom.slice(5) === '01-01' && dateFilterTo.slice(5) === '12-31'
        ? dateFilterFrom.slice(0, 4)
        : null;

    return `
        <section class="run-plus-filter-panel" aria-label="Run Plus filters">
            <div class="run-plus-filter-panel__main">
                <div class="run-plus-filter-field">
                    <label for="${runPlusId('date-from')}">From</label>
                    <input type="date" id="${runPlusId('date-from')}" value="${esc(dateFilterFrom || '')}">
                </div>
                <div class="run-plus-filter-field">
                    <label for="${runPlusId('date-to')}">To</label>
                    <input type="date" id="${runPlusId('date-to')}" value="${esc(dateFilterTo || '')}">
                </div>
                <div class="run-plus-filter-field">
                    <label for="${runPlusId('gear-filter')}">Gear</label>
                    <select id="${runPlusId('gear-filter')}">
                        ${gearOptions.map(option => `<option value="${esc(option.value)}" ${option.value === selectedGear ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
                    </select>
                </div>
                <div class="run-plus-filter-actions">
                    <button id="${runPlusId('apply-filter')}" type="button">Apply</button>
                    <button id="${runPlusId('reset-filter')}" type="button">Reset</button>
                </div>
            </div>
            <div class="run-plus-year-buttons" id="${runPlusId('year-filter-buttons')}">
                ${years.map(year => `<button class="year-btn ${activeYear === year ? 'active' : ''}" data-year="${year}" type="button">${year}</button>`).join('')}
            </div>
        </section>
    `;
}

function coverageText(model, keys) {
    const values = keys
        .map(key => model.quality.coverage[key])
        .filter(Number.isFinite);
    if (!values.length) return 'No direct field trust metric.';
    const min = Math.min(...values);
    return `${percentLabel(min)} minimum required-field coverage`;
}

// ─── Diagnosis overview (hero) ──────────────────────────

function renderDiagnosisOverview(model) {
    const diagnostics = model.diagnostics;
    const load = diagnostics.loadReadiness.state;
    const weeklyRamp = diagnostics.consistencyProfile.weeklyRamp;
    const aerobicTrend = diagnostics.aerobicEfficiency.trend;
    const race = diagnostics.raceCredibility;
    const tissue = diagnostics.tissueLoad;

    const strengths = [
        diagnostics.consistencyProfile.activeWeeks >= 12 ? `${diagnostics.consistencyProfile.activeWeeks} active training weeks in the filtered range.` : null,
        diagnostics.aerobicEfficiency.confidence !== 'low' ? `${percentLabel(diagnostics.aerobicEfficiency.hrCoverage)} HR coverage supports aerobic charts.` : null,
        diagnostics.durabilityProfile.longRuns.overHalf ? `${diagnostics.durabilityProfile.longRuns.overHalf} half-marathon-plus long runs.` : null,
        tissue.status.level === 'good' ? `Recent impact load is within the historical capacity estimate (${safeFixed(tissue.capacityRatio, 2)}x).` : null,
        race.credibleCount ? `${race.credibleCount} race-like activities available for performance interpretation.` : null
    ].filter(Boolean);

    const gaps = [
        diagnostics.dataTrust.confidence === 'low' ? 'Data trust is low; paid-report claims need stronger caveats.' : null,
        diagnostics.consistencyProfile.maxGapDays >= 14 ? `Largest inactive gap is ${diagnostics.consistencyProfile.maxGapDays} days.` : null,
        diagnostics.aerobicEfficiency.confidence === 'low' ? 'HR coverage is too thin for strong aerobic conclusions.' : null,
        tissue.status.level !== 'good' ? `${tissue.status.label}: ${tissue.status.narrative}` : null,
        diagnostics.durabilityProfile.longRuns.over30 === 0 ? 'No 30 km-plus runs in the active filter.' : null
    ].filter(Boolean);

    return `
        <section class="run-plus-diagnosis-overview">
            <div class="run-plus-overview-main">
                <span class="run-plus-kicker">Run Plus · Enhanced Analysis</span>
                <h2>Training Diagnosis</h2>
                <p>Run Plus renders the same real Strava/preprocessed charts as the Run tab, then adds training diagnosis, field trust, caveats, and report-ready interpretation for each module.</p>
                <div class="run-plus-overview-tags">
                    <span class="run-plus-pill ${pillClassForConfidence(diagnostics.dataTrust.confidence)}">📊 Data trust ${diagnostics.dataTrust.score}/100</span>
                    <span class="run-plus-pill run-plus-pill--muted">🧠 Rule-based live diagnostics</span>
                    <span class="run-plus-pill run-plus-pill--muted">⚙️ TSS/CTL/ATL/TSB are local algorithm outputs</span>
                    <span class="run-plus-pill ${pillClassForConfidence(diagnostics.aerobicEfficiency.confidence)}">❤️ HR coverage ${percentLabel(diagnostics.aerobicEfficiency.hrCoverage)}</span>
                    <span class="run-plus-pill ${pillClassForImpactLevel(tissue.status.level)}">🦴 Tissue load ${tissue.dataConfidence}/100</span>
                </div>
            </div>
            <div class="run-plus-overview-grid">
                <article class="run-plus-diagnosis-card">
                    <span>🏃 Training profile</span>
                    <strong>${esc(diagnostics.consistencyProfile.label)}</strong>
                    <p>${safeFixed(model.recentWeeklyAvg)} km/week recently${weeklyRamp == null ? '' : `, ${formatSigned(weeklyRamp * 100)}% vs prior 12 weeks`}.</p>
                </article>
                <article class="run-plus-diagnosis-card">
                    <span>⚡ Current load</span>
                    <strong>${esc(load.label)}</strong>
                    <p>${esc(load.narrative)}</p>
                </article>
                <article class="run-plus-diagnosis-card">
                    <span>🦴 Tissue impact</span>
                    <strong>${esc(tissue.status.label)}</strong>
                    <p>${safeFixed(tissue.recent7Impact, 0)} ILP this week; ${safeFixed(tissue.capacityRatio, 2)}x adjusted capacity.</p>
                </article>
                <article class="run-plus-diagnosis-card">
                    <span>❤️ Aerobic signal</span>
                    <strong>${esc(aerobicTrend.status)}</strong>
                    <p>${aerobicTrend.improvementPct == null ? 'Not enough HR-valid history for a trend.' : `${formatSigned(aerobicTrend.improvementPct * 100)}% change in HR-normalized efficiency.`}</p>
                </article>
                <article class="run-plus-diagnosis-card">
                    <span>🎯 Focus</span>
                    <strong>${esc(model.diagnostics.recommendedFocus[0])}</strong>
                </article>
            </div>
            <div class="run-plus-cross-grid">
                <article class="run-plus-cross-card">
                    <h3>✅ Main strengths</h3>
                    <ul>${(strengths.length ? strengths : ['No strong advantage can be stated from the active data filter.']).map(item => `<li>${esc(item)}</li>`).join('')}</ul>
                </article>
                <article class="run-plus-cross-card">
                    <h3>⚠️ Main limitations</h3>
                    <ul>${(gaps.length ? gaps : ['No critical data or training limitation was detected by the deterministic rules.']).map(item => `<li>${esc(item)}</li>`).join('')}</ul>
                </article>
                <article class="run-plus-cross-card">
                    <h3>🔗 Cross-chart read</h3>
                    <ul>
                        <li>Weekly volume + Consistency Grid: ${esc(diagnostics.consistencyProfile.label.toLowerCase())} training stability.</li>
                        <li>Pace-HR + Aerobic Efficiency: ${esc(aerobicTrend.status)} HR-normalized signal with ${diagnostics.aerobicEfficiency.confidence} confidence.</li>
                        <li>Impact ATL/CTL + Capacity Buffer: ${esc(tissue.status.label.toLowerCase())}; ATL/CTL ${safeFixed(tissue.atlCtlRatio, 2)}x.</li>
                        <li>Long runs + Eddington: ${esc(diagnostics.durabilityProfile.label.toLowerCase())}.</li>
                        <li>Fastest races + anomaly gate: ${esc(race.confidence)} race-performance confidence.</li>
                    </ul>
                </article>
            </div>
        </section>
    `;
}

// ─── Summary stat cards ─────────────────────────────────

function renderStatCards(model) {
    const hrCoverage = model.runs.length ? model.hrRuns.length / model.runs.length : 0;
    const pmc = model.currentPmc;
    const tissue = model.diagnostics.tissueLoad;
    const weeklyDelta = model.previousWeeklyAvg > 0
        ? ((model.recentWeeklyAvg - model.previousWeeklyAvg) / model.previousWeeklyAvg) * 100
        : null;

    return `
        <div class="run-plus-summary">
            <div class="run-plus-stat">
                <span>📊 Report confidence</span>
                <strong>${model.quality.score}</strong>
                <small>${pct(hrCoverage)} HR coverage</small>
            </div>
            <div class="run-plus-stat">
                <span>📅 Run history</span>
                <strong>${model.runs.length}</strong>
                <small>${esc(model.dateRange.start)} to ${esc(model.dateRange.end)}</small>
            </div>
            <div class="run-plus-stat">
                <span>🏃 Total training</span>
                <strong>${model.totals.distance.toFixed(0)} km</strong>
                <small>${model.totals.timeHours.toFixed(1)} h, ${Math.round(model.totals.elevation).toLocaleString()} m climb</small>
            </div>
            <div class="run-plus-stat">
                <span>📈 Weekly load</span>
                <strong>${model.recentWeeklyAvg.toFixed(1)} km</strong>
                <small>12-week avg${weeklyDelta === null ? '' : `, ${weeklyDelta >= 0 ? '+' : ''}${weeklyDelta.toFixed(1)}% vs prior`}</small>
            </div>
            <div class="run-plus-stat">
                <span>⚡ Load state</span>
                <strong>${pmc ? `TSB ${formatSigned(Number(pmc.tsb))}` : '-'}</strong>
                <small>${pmc ? `CTL ${Number(pmc.ctl).toFixed(1)}, ATL ${Number(pmc.atl).toFixed(1)}` : 'PMC unavailable'}</small>
            </div>
            <div class="run-plus-stat">
                <span>🦴 Impact load</span>
                <strong>${safeFixed(tissue.recent7Impact, 0)} ILP</strong>
                <small>7-day tissue-impact proxy; impact ATL/CTL ${safeFixed(tissue.atlCtlRatio, 2)}x</small>
            </div>
            <div class="run-plus-stat">
                <span>🛡 Capacity buffer</span>
                <strong>${tissue.capacityRatio == null ? '-' : `${safeFixed((1 - tissue.capacityRatio) * 100, 0)}%`}</strong>
                <small>${esc(tissue.status.label)} · adjusted capacity ${safeFixed(tissue.adjustedCapacity, 0)} ILP/wk</small>
            </div>
            <div class="run-plus-stat">
                <span>🎯 Durability</span>
                <strong>E${model.dailyE.current}</strong>
                <small>Daily Eddington, next needs ${model.dailyE.nextNeed}</small>
            </div>
            <div class="run-plus-stat">
                <span>💪 100K block proxy</span>
                <strong>E${model.weeklyE3.current}</strong>
                <small>Weekly x3, next needs ${model.weeklyE3.nextNeed}</small>
            </div>
        </div>
    `;
}

// ─── Module diagnosis copy ──────────────────────────────

function moduleDiagnosis(moduleKey, model) {
    const d = model.diagnostics;
    const paceDecay = d.durabilityProfile.paceDecay;
    const sweetSpot = d.volumeTrend.sweetSpot;
    const load = d.loadReadiness.state;

    const copy = {
        summary: {
            conclusion: `${model.runs.length} runs, ${model.totals.distance.toFixed(0)} km, average pace ${paceLabel(model.totals.avgPace)}.`,
            means: 'This anchors the active filter and should match the same population shown in every downstream chart.',
            risk: 'Summary cards do not show intensity, data gaps, terrain, or current fatigue.',
            fields: ['date', 'distance', 'movingTime'],
            next: 'Use the cards only as context; rely on the diagnostic modules below for interpretation.'
        },
        consistency: {
            conclusion: `${d.consistencyProfile.activeDays} active days over ${d.consistencyProfile.spanDays} days; largest gap ${d.consistencyProfile.maxGapDays} days.`,
            means: 'The heatmap shows training frequency, continuity, breaks, and distance density by day.',
            risk: 'Color intensity is mainly distance volume; it is not a direct measure of workout intensity or recovery cost.',
            fields: ['date', 'distance'],
            next: 'Combine it with weekly load and CTL/ATL/TSB before judging fatigue or readiness.'
        },
        type: {
            conclusion: `${model.raceLike.length} race-like runs and ${model.longRuns.over16} long-run entries detected by current rules.`,
            means: 'The type chart checks whether the training structure is mostly routine runs, races, long runs, trail, or high-load sessions.',
            risk: 'Workout type and names are imperfect. Strava activity labels can be missing or athlete-specific.',
            fields: ['distance', 'movingTime', 'load'],
            next: 'Use it to verify whether the structure matches the athlete goal before giving plan advice.'
        },
        monthlyDistance: {
            conclusion: `Median month ${safeFixed(model.monthlyMedian)} km; recent weekly average ${safeFixed(model.recentWeeklyAvg)} km.`,
            means: 'Monthly distance shows longer load blocks and whether volume is accumulating, maintaining, or declining.',
            risk: 'Month boundaries are arbitrary and can hide short overload spikes.',
            fields: ['date', 'distance'],
            next: `Personal improvement sweet spot estimate: ${esc(sweetSpot.label)} (${sweetSpot.confidence} confidence).`
        },
        paceDistance: {
            conclusion: paceDecay.ratio == null ? 'Not enough short and long runs to quantify pace decay.' : `Long-run median pace is ${formatSigned(paceDecay.ratio * 100)}% slower than short-run median pace.`,
            means: 'This reveals how speed changes as distance increases, separating short-distance ability from durability.',
            risk: 'Hills, trails, weather, recovery state, and non-race intent can distort the curve.',
            fields: ['distance', 'movingTime'],
            next: 'Compare race-like points against normal runs before calling a performance ceiling.'
        },
        elevationScatter: {
            conclusion: `Total elevation in filter is ${Math.round(model.totals.elevation).toLocaleString()} m.`,
            means: 'Distance vs elevation separates flat endurance work from terrain-heavy sessions.',
            risk: 'Elevation gain can explain slower pace and higher HR; do not compare hill runs directly to flat races.',
            fields: ['distance', 'elevation'],
            next: 'Use this chart as the terrain caveat for pace, HR, and fastest-race conclusions.'
        },
        distanceDistribution: {
            conclusion: `${model.longRuns.over16} runs are 16 km or longer; ${model.longRuns.over30} are 30 km or longer.`,
            means: 'Distance distribution shows the athlete\u2019s habitual session lengths and long-run exposure.',
            risk: 'One very long run does not prove repeatable endurance.',
            fields: ['distance'],
            next: 'Pair it with Eddington to separate one-off distance from repeatability.'
        },
        paceDistribution: {
            conclusion: `${model.runs.filter(run => Number(run.distance) > 0 && Number(run.moving_time) > 0).length} runs have pace-valid data.`,
            means: 'Pace distribution shows the typical speed bands used in training.',
            risk: 'Pace alone is not intensity. Easy trail runs and hard flat runs can overlap.',
            fields: ['distance', 'movingTime'],
            next: 'Use HR coverage and Pace-HR charts to decide whether the dominant pace band is truly easy or hard.'
        },
        elevationDistribution: {
            conclusion: `${percentLabel(model.quality.coverage.elevation)} of runs include elevation gain.`,
            means: 'Elevation distribution estimates how much hill stimulus exists in the training history.',
            risk: 'GPS/barometer differences can make elevation noisy across devices.',
            fields: ['elevation'],
            next: 'Flag hill-heavy outliers before interpreting pace or race rankings.'
        },
        paceHr: {
            conclusion: `${d.aerobicEfficiency.validRuns} HR-valid runs; trend is ${d.aerobicEfficiency.trend.status}.`,
            means: 'The curve asks whether the athlete runs faster at the same HR in later history.',
            risk: 'HR coverage, heat, hills, fatigue, and sensor errors can all shift the curve.',
            fields: ['heartRate', 'distance', 'movingTime'],
            next: 'Use only HR-valid samples and mark low confidence when HR coverage is thin.'
        },
        consistencyImprovement: {
            conclusion: `${d.aerobicEfficiency.trend.validCount} HR-valid runs feed efficiency-improvement analysis.`,
            means: 'This checks whether stable monthly training tends to precede better aerobic efficiency.',
            risk: 'It is correlation, not proof that consistency caused improvement.',
            fields: ['date', 'heartRate', 'distance', 'movingTime'],
            next: 'Read it beside monthly volume and terrain before changing training load.'
        },
        volumeImprovement: {
            conclusion: `Best historical monthly range estimate: ${esc(sweetSpot.label)}.`,
            means: 'This searches the athlete\u2019s own likely improvement range instead of applying generic mileage advice.',
            risk: `Confidence is ${sweetSpot.confidence}; fewer valid HR months means weaker inference.`,
            fields: ['date', 'heartRate', 'distance', 'movingTime'],
            next: 'Use as a range hypothesis, not a prescription, then check recovery and race phase.'
        },
        efficiencyEvolution: {
            conclusion: d.aerobicEfficiency.trend.improvementPct == null ? 'Insufficient HR-valid trend sample.' : `Efficiency changed ${formatSigned(d.aerobicEfficiency.trend.improvementPct * 100)}% from early to late history.`,
            means: 'Aerobic cost over time shows whether similar effort is producing faster running.',
            risk: 'Efficiency should be filtered for HR validity, extreme pace, terrain, and weather context.',
            fields: ['date', 'heartRate', 'distance', 'movingTime'],
            next: 'Segment by time block and exclude abnormal HR or route conditions for paid reports.'
        },
        distanceEfficiency: {
            conclusion: d.aerobicEfficiency.distanceEfficiencySlope == null ? 'Not enough HR-valid distance spread for a slope.' : `Efficiency-vs-distance slope is ${d.aerobicEfficiency.distanceEfficiencySlope.toFixed(5)}.`,
            means: 'This identifies whether longer runs create a clear aerobic-cost penalty.',
            risk: 'A positive slope may be fatigue, hills, heat, fueling, or non-easy long-run intent.',
            fields: ['heartRate', 'distance', 'movingTime'],
            next: 'Use it for marathon durability only after excluding terrain and race outliers.'
        },
        paceHrEfficiency: {
            conclusion: `${percentLabel(d.aerobicEfficiency.hrCoverage)} HR coverage; aerobic confidence is ${d.aerobicEfficiency.confidence}.`,
            means: 'This finds economical pace ranges, not just the fastest observed pace.',
            risk: 'The fastest point may be a race or sensor artifact; economy needs repeated samples.',
            fields: ['heartRate', 'distance', 'movingTime'],
            next: 'Look for dense pace/HR clusters before recommending training paces.'
        },
        tissueOverview: {
            conclusion: `${safeFixed(d.tissueLoad.recent7Impact, 0)} ILP in the last 7 days; capacity ratio ${safeFixed(d.tissueLoad.capacityRatio, 2)}x.`,
            means: 'This separates repetitive tissue impact from metabolic TSS so marathon load is not judged only by CTL/ATL/TSB.',
            risk: 'It is a field-data proxy, not injury diagnosis. Without pain, next-day response, surface, and stream-level cadence/grade, use it for trend direction rather than absolute risk.',
            fields: ['date', 'distance', 'movingTime', 'elevation', 'cadence', 'gear'],
            next: 'Use it as the musculoskeletal gate before adding long-run distance, speed work, downhills, or race shoes.'
        },
        mechanicalTimeline: {
            conclusion: `Impact ATL ${safeFixed(d.tissueLoad.atl, 1)}, CTL ${safeFixed(d.tissueLoad.ctl, 1)}, ratio ${safeFixed(d.tissueLoad.atlCtlRatio, 2)}x.`,
            means: 'This timeline asks whether recent impact exposure is rising faster than the athlete\'s longer impact baseline.',
            risk: 'During a normal marathon build, impact ATL can sit above impact CTL. It becomes meaningful when combined with ramp, long-run share, and capacity inputs.',
            fields: ['date', 'distance', 'movingTime', 'elevation'],
            next: 'Do not force ATL below CTL during build; keep the ratio and capacity buffer inside the athlete\'s tolerance band.'
        },
        capacityInputs: {
            conclusion: d.tissueLoad.inputState.hasInputs ? `Capacity modifier ${safeFixed(d.tissueLoad.inputState.modifier, 2)}x from athlete inputs.` : 'No subjective capacity inputs saved; capacity uses historical training only.',
            means: 'Pain, next-day response, sleep, energy, and strength exposure turn capacity from a pure history estimate into a current-state estimate.',
            risk: 'Self-reported inputs are noisy, but ignoring them makes the model overconfident when biological capacity is suppressed.',
            fields: ['distance', 'movingTime'],
            next: 'Update these inputs weekly or after any suspicious tissue response.'
        },
        atlCtlResolver: {
            conclusion: d.tissueLoad.status.label,
            means: 'This resolves the CTL/ATL contradiction by treating ATL>CTL as normal build unless mechanical progression and capacity response also deteriorate.',
            risk: 'A green metabolic TSB does not guarantee bone, tendon, or fascia tolerance; a red impact gate should override fitness ambition.',
            fields: ['load', 'distance', 'movingTime'],
            next: 'Use the three-gate decision: metabolic load, mechanical impact, and capacity response.'
        },
        accumulated: {
            conclusion: `Cumulative distance is ${model.totals.distance.toFixed(0)} km across the active range.`,
            means: 'Accumulated distance shows long-term training accumulation and long pauses.',
            risk: 'A smooth cumulative line can still hide abrupt weekly load spikes.',
            fields: ['date', 'distance'],
            next: 'Read it with weekly rolling mean for phase changes.'
        },
        weekly: {
            conclusion: `${safeFixed(model.recentWeeklyAvg)} km/week recently; load state is ${esc(load.label)}.`,
            means: 'Weekly distance plus rolling mean shows build, maintain, accumulation, and recovery phases.',
            risk: 'Distance ignores intensity; a low-volume week can still carry high TSS.',
            fields: ['date', 'distance'],
            next: 'Combine with CTL/ATL/TSB to decide whether the ramp is productive or risky.'
        },
        eddington: {
            conclusion: `Daily E${model.dailyE.current}, Weekly x3 E${model.weeklyE3.current}; next daily E needs ${model.dailyE.nextNeed} qualifying days.`,
            means: 'Eddington measures repeatable long-distance ability and endurance base.',
            risk: 'It is repeatability, not a PB, and it rewards frequency at a threshold.',
            fields: ['date', 'distance'],
            next: 'Use next-need counts to identify the cheapest durability improvement target.'
        },
        topRuns: {
            conclusion: `${model.anomalies.length} anomalies and ${model.duplicateSuspects.length} duplicate groups should gate PB-style claims.`,
            means: 'Top lists expose longest, hilliest, and fastest candidates for evidence review.',
            risk: 'Fastest rankings can include GPS errors, downhill routes, non-races, or non-full-effort activities.',
            fields: ['date', 'distance', 'movingTime', 'elevation'],
            next: 'Treat only race-like, anomaly-free entries as credible performance evidence.'
        },
        table: {
            conclusion: `${model.runs.length} rows in the current run activity table.`,
            means: 'The table is the audit layer behind every summary and chart.',
            risk: 'Sorting raw rows can overemphasize outliers without the quality gate.',
            fields: ['id', 'date', 'distance', 'movingTime'],
            next: 'Export filtered runs when preparing an external paid-report review.'
        }
    };

    return copy[moduleKey];
}

function renderModuleDiagnosis(moduleKey, model) {
    const diagnosis = moduleDiagnosis(moduleKey, model);
    if (!diagnosis) return '';
    const diagId = `run-plus-diag-${moduleKey}`;
    return `
        <button class="run-plus-diagnosis-toggle" data-diagnosis-target="${diagId}" type="button">
            <span class="run-plus-diagnosis-toggle__chevron">▶</span>
            <span class="run-plus-diagnosis-toggle__icon">💡</span>
            <span class="run-plus-diagnosis-toggle__label">Training diagnosis</span>
            <span class="run-plus-diagnosis-toggle__summary">${diagnosis.conclusion.substring(0, 60)}${diagnosis.conclusion.length > 60 ? '…' : ''}</span>
        </button>
        <aside class="run-plus-module-diagnosis" id="${diagId}">
            <h4>💡 Training Diagnosis</h4>
            <p><strong>Current read:</strong> ${diagnosis.conclusion}</p>
            <p><strong>What it explains:</strong> ${diagnosis.means}</p>
            <p><strong>Misread risk:</strong> ${diagnosis.risk}</p>
            <p><strong>Field quality:</strong> ${coverageText(model, diagnosis.fields)}</p>
            <p><strong>Next step:</strong> ${diagnosis.next}</p>
        </aside>
    `;
}

// ─── Chart module renderer ──────────────────────────────

function renderChartModule({ key, title, canvasId, bodyHtml = '', controlHtml = '', wide = false, panelOnly = false }, model) {
    const visualHtml = panelOnly
        ? `
            <div class="run-plus-module-panel">
                <h3>${esc(title)}</h3>
                ${bodyHtml}
            </div>
        `
        : `
            <div class="chart-container">
                ${controlHtml ? `
                    <div class="run-plus-chart-heading">
                        <h3>${esc(title)}</h3>
                        ${controlHtml}
                    </div>
                ` : `<h3>${esc(title)}</h3>`}
                ${bodyHtml || `<canvas id="${runPlusId(canvasId)}"></canvas>`}
            </div>
        `;

    return `
        <section class="run-plus-module ${wide ? 'run-plus-module--wide' : ''}" data-module="${esc(key)}">
            ${visualHtml}
            ${renderModuleDiagnosis(key, model)}
        </section>
    `;
}

// ─── Section group definitions ──────────────────────────

const SECTION_GROUPS = [
    {
        id: 'consistency',
        icon: '📅',
        title: 'Training Consistency',
        subtitle: 'Frequency, structure, and volume patterns',
        modules: ['summary', 'consistency', 'type', 'monthlyDistance']
    },
    {
        id: 'pace-distance',
        icon: '⚡',
        title: 'Speed & Distance',
        subtitle: 'Pace scaling, elevation, and distribution',
        modules: ['paceDistance', 'elevationScatter', 'distanceDistribution', 'paceDistribution', 'elevationDistribution']
    },
    {
        id: 'aerobic',
        icon: '❤️',
        title: 'Aerobic Efficiency',
        subtitle: 'Heart-rate normalized performance and trends',
        modules: ['paceHr', 'consistencyImprovement', 'volumeImprovement', 'efficiencyEvolution', 'distanceEfficiency', 'paceHrEfficiency']
    },
    {
        id: 'tissue-load',
        icon: '🦴',
        title: 'Tissue Load & Capacity',
        subtitle: 'Mechanical impact, musculoskeletal ATL/CTL, and capacity buffer',
        modules: ['tissueOverview', 'mechanicalTimeline', 'capacityInputs', 'atlCtlResolver']
    },
    {
        id: 'endurance',
        icon: '🏔️',
        title: 'Distance Accumulation & Endurance',
        subtitle: 'Weekly load, rolling trends, and Eddington durability',
        modules: ['accumulated', 'weekly', 'eddington']
    },
    {
        id: 'records',
        icon: '🏆',
        title: 'Performance Records',
        subtitle: 'Top runs, race credibility, and activity audit',
        modules: ['topRuns', 'table']
    }
];

function renderTissueMetricCard(label, value, detail, level = 'muted') {
    return `
        <article class="run-plus-tissue-card run-plus-tissue-card--${esc(level)}">
            <span>${esc(label)}</span>
            <strong>${esc(value)}</strong>
            <small>${esc(detail)}</small>
        </article>
    `;
}

function renderTissueOverviewPanel(model) {
    const tissue = model.diagnostics.tissueLoad;
    const impact = model.impactLoad;
    const bufferPct = tissue.capacityRatio == null ? null : (1 - tissue.capacityRatio) * 100;
    const last28Cutoff = impact.dailySeries.length ? impact.dailySeries[Math.max(0, impact.dailySeries.length - 28)]?.date : null;
    const topDrivers = impact.perRun
        .filter(item => !last28Cutoff || item.date >= last28Cutoff)
        .sort((a, b) => b.impactPoints - a.impactPoints)
        .slice(0, 5);
    const shoeNotes = impact.shoeShiftRuns.length
        ? impact.shoeShiftRuns.map(item => `${item.date}: ${item.gearLabel || 'gear'} (${item.shoeNote})`).slice(-3)
        : [];

    return `
        <div class="run-plus-tissue-panel">
            <div class="run-plus-tissue-lead">
                <span class="run-plus-pill ${pillClassForImpactLevel(tissue.status.level)}">${esc(tissue.status.label)}</span>
                <p>${esc(tissue.status.narrative)}</p>
            </div>
            <div class="run-plus-tissue-grid">
                ${renderTissueMetricCard('7-day impact load', `${safeFixed(tissue.recent7Impact, 0)} ILP`, 'Impact Load Points: estimated foot contacts x speed x terrain x duration x shoe modifiers.', tissue.status.level)}
                ${renderTissueMetricCard('Adjusted capacity', `${safeFixed(tissue.adjustedCapacity, 0)} ILP/wk`, `Historical baseline ${safeFixed(tissue.baselineCapacity, 0)} x current-state modifier ${safeFixed(tissue.inputState.modifier, 2)}.`, tissue.inputState.hasInputs ? 'good' : 'warn')}
                ${renderTissueMetricCard('Capacity buffer', bufferPct == null ? '-' : `${safeFixed(bufferPct, 0)}%`, 'Positive means current 7-day impact is below adjusted capacity; negative means over the modeled buffer.', bufferPct == null ? 'muted' : bufferPct >= 10 ? 'good' : bufferPct >= -10 ? 'warn' : 'risk')}
                ${renderTissueMetricCard('Mechanical ramp', tissue.weeklyRampPct == null ? '-' : `${formatSigned(tissue.weeklyRampPct * 100, 0)}%`, 'Current 7-day impact vs previous 28-day weekly average.', tissue.weeklyRampPct == null ? 'muted' : tissue.weeklyRampPct <= 0.18 ? 'good' : tissue.weeklyRampPct <= 0.35 ? 'warn' : 'risk')}
            </div>
            <div class="run-plus-tissue-split">
                <div>
                    <h4>Largest recent impact drivers</h4>
                    ${topDrivers.length ? `
                        <div class="run-plus-table-wrap">
                            <table class="compact-table run-plus-tissue-table">
                                <thead><tr><th>Date</th><th>Distance</th><th>ILP</th><th>Factors</th></tr></thead>
                                <tbody>
                                    ${topDrivers.map(item => `
                                        <tr>
                                            <td>${esc(item.date)}</td>
                                            <td>${safeFixed(item.distanceKm, 1)} km</td>
                                            <td>${safeFixed(item.impactPoints, 0)}</td>
                                            <td>speed ${safeFixed(item.speedFactor, 2)} · terrain ${safeFixed(item.terrainFactor, 2)} · duration ${safeFixed(item.durationFactor, 2)} · shoe ${safeFixed(item.shoeFactor, 2)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : '<p class="run-plus-empty">No recent runs available for impact-driver ranking.</p>'}
                </div>
                <div>
                    <h4>Model caveats</h4>
                    <ul class="run-plus-tissue-list">
                        <li>It estimates repetitive musculoskeletal exposure, not injury probability.</li>
                        <li>It is stronger for within-athlete trend monitoring than absolute comparison across athletes.</li>
                        <li>${shoeNotes.length ? `Shoe redistribution flags: ${esc(shoeNotes.join('; '))}.` : 'Shoe redistribution needs gear names; no carbon/minimal pattern was detected recently.'}</li>
                        <li>Surface, downhills, symptoms, and strength tests should be added when available.</li>
                    </ul>
                </div>
            </div>
        </div>
    `;
}

function renderMechanicalTimelineBody(prefix) {
    return `
        <canvas id="${prefix('mechanical-load-chart')}"></canvas>
        <div class="run-plus-chart-caption">
            Bars are daily Impact Load Points (ILP). Lines are 7-day musculoskeletal ATL, 42-day musculoskeletal CTL, and adjusted capacity converted to daily scale.
        </div>
    `;
}

function inputValue(value) {
    return Number.isFinite(value) ? String(value) : '';
}

function renderCapacityInputsPanel(model) {
    const tissue = model.diagnostics.tissueLoad;
    const inputs = tissue.inputState.inputs;
    const notes = tissue.inputState.notes.length ? tissue.inputState.notes.join(', ') : 'No negative capacity modifiers currently flagged.';
    return `
        <form class="run-plus-capacity-form" id="${runPlusId('capacity-input-form')}">
            <div class="run-plus-capacity-copy">
                <span class="run-plus-pill ${tissue.inputState.hasInputs ? 'run-plus-pill--good' : 'run-plus-pill--warn'}">
                    ${tissue.inputState.hasInputs ? 'Current-state inputs active' : 'History-only estimate'}
                </span>
                <p>Use these lightweight athlete inputs to adjust historical impact capacity. The goal is not diagnosis; it is to avoid treating CTL or mileage as capacity when pain, sleep, energy, or tissue response has changed.</p>
                <p><strong>Current modifier:</strong> ${safeFixed(tissue.inputState.modifier, 2)}x · <strong>Notes:</strong> ${esc(notes)}</p>
            </div>
            <div class="run-plus-capacity-input-grid">
                <label>
                    Pain during/after running <span>0-10</span>
                    <input name="painScore" type="number" min="0" max="10" step="1" value="${inputValue(inputs.painScore)}" placeholder="0">
                </label>
                <label>
                    Next-day escalation <span>0-10</span>
                    <input name="nextDayScore" type="number" min="0" max="10" step="1" value="${inputValue(inputs.nextDayScore)}" placeholder="0">
                </label>
                <label>
                    Sleep quality <span>1-5</span>
                    <input name="sleepScore" type="number" min="1" max="5" step="1" value="${inputValue(inputs.sleepScore)}" placeholder="3">
                </label>
                <label>
                    Energy / fueling state <span>1-5</span>
                    <input name="energyScore" type="number" min="1" max="5" step="1" value="${inputValue(inputs.energyScore)}" placeholder="3">
                </label>
                <label>
                    Strength sessions this week <span>0-7</span>
                    <input name="strengthSessions" type="number" min="0" max="7" step="1" value="${inputValue(inputs.strengthSessions)}" placeholder="0">
                </label>
            </div>
            <div class="run-plus-capacity-actions">
                <button type="submit">Save capacity inputs</button>
                <button type="button" id="${runPlusId('capacity-reset-btn')}">Clear inputs</button>
            </div>
        </form>
    `;
}

function renderAtlCtlResolverPanel(model) {
    const load = model.diagnostics.loadReadiness.state;
    const tissue = model.diagnostics.tissueLoad;
    const metabolicBuild = model.currentPmc ? Number(model.currentPmc.atl) > Number(model.currentPmc.ctl) : null;
    const mechanicalBuild = tissue.atlCtlRatio != null ? tissue.atlCtlRatio > 1 : null;
    const rows = [
        {
            gate: 'Metabolic fatigue gate',
            read: model.currentPmc ? `${esc(load.label)} · TSB ${formatSigned(Number(model.currentPmc.tsb), 1)}` : 'PMC unavailable',
            interpretation: metabolicBuild ? 'ATL above CTL is expected in a build block; do not treat it as automatically wrong.' : 'Metabolic load is not currently above the chronic baseline.'
        },
        {
            gate: 'Mechanical impact gate',
            read: `${safeFixed(tissue.recent7Impact, 0)} ILP/wk · impact ATL/CTL ${safeFixed(tissue.atlCtlRatio, 2)}x`,
            interpretation: mechanicalBuild ? 'Impact is also above baseline; inspect ramp, long-run share, shoes, and symptoms.' : 'Impact exposure is not acutely elevated relative to chronic impact baseline.'
        },
        {
            gate: 'Capacity response gate',
            read: `${esc(tissue.status.label)} · capacity ratio ${safeFixed(tissue.capacityRatio, 2)}x`,
            interpretation: tissue.status.narrative
        }
    ];

    return `
        <div class="run-plus-resolver-panel">
            <p>The product rule is: <strong>ATL &gt; CTL is allowed during marathon build</strong>. It becomes a warning only when mechanical impact is also ramping and the athlete's current capacity response is deteriorating.</p>
            <div class="run-plus-table-wrap">
                <table class="compact-table run-plus-resolver-table">
                    <thead><tr><th>Gate</th><th>Current read</th><th>Decision meaning</th></tr></thead>
                    <tbody>
                        ${rows.map(row => `
                            <tr>
                                <td>${esc(row.gate)}</td>
                                <td>${row.read}</td>
                                <td>${esc(row.interpretation)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="run-plus-decision-box run-plus-decision-box--${esc(tissue.status.level)}">
                <strong>Current product decision:</strong> ${esc(tissue.status.label)}. ${esc(tissue.status.narrative)}
            </div>
        </div>
    `;
}

function getModuleConfig(moduleKey) {
    const allModules = {
        summary: {
            key: 'summary',
            title: 'Summary Cards',
            bodyHtml: (prefix) => `<div id="${prefix('run-summary-cards')}" class="summary-grid"></div>`,
            wide: true,
            panelOnly: true
        },
        consistency: {
            key: 'consistency',
            title: 'Consistency Grid',
            bodyHtml: (prefix) => `<div id="${prefix('cal-heatmap-run')}"></div>`,
            wide: true
        },
        type: { key: 'type', title: 'Activities by Type', canvasId: 'activity-type-barchart' },
        monthlyDistance: { key: 'monthlyDistance', title: 'Monthly Distance', canvasId: 'monthly-distance-chart' },
        paceDistance: { key: 'paceDistance', title: 'Pace vs. Distance', canvasId: 'pace-vs-distance-chart' },
        elevationScatter: { key: 'elevationScatter', title: 'Distance vs Elevation Gain', canvasId: 'distance-vs-elevation-chart' },
        distanceDistribution: { key: 'distanceDistribution', title: 'Distance Distribution', canvasId: 'distance-histogram' },
        paceDistribution: { key: 'paceDistribution', title: 'Pace Distribution', canvasId: 'pace-histogram-chart' },
        elevationDistribution: { key: 'elevationDistribution', title: 'Elevation Distribution', canvasId: 'elevation-histogram' },
        paceHr: { key: 'paceHr', title: 'Pace-Heart Rate Curve', canvasId: 'pace-hr-curve-chart' },
        consistencyImprovement: { key: 'consistencyImprovement', title: 'Monthly Consistency vs Improvement', canvasId: 'consistency-improvement-chart' },
        volumeImprovement: { key: 'volumeImprovement', title: 'Monthly Volume vs Improvement Probability', canvasId: 'volume-improvement-chart' },
        efficiencyEvolution: { key: 'efficiencyEvolution', title: 'Aerobic Efficiency Evolution', canvasId: 'efficiency-evolution-chart' },
        distanceEfficiency: { key: 'distanceEfficiency', title: 'Distance vs Efficiency', canvasId: 'distance-efficiency-chart' },
        paceHrEfficiency: { key: 'paceHrEfficiency', title: 'Pace vs HR Efficiency Curve', canvasId: 'pace-hr-efficiency-chart' },
        tissueOverview: {
            key: 'tissueOverview',
            title: 'Tissue Impact & Capacity Overview',
            bodyHtml: (_prefix, model) => renderTissueOverviewPanel(model),
            wide: true,
            panelOnly: true
        },
        mechanicalTimeline: {
            key: 'mechanicalTimeline',
            title: 'Impact ATL / CTL Timeline',
            bodyHtml: (prefix) => renderMechanicalTimelineBody(prefix),
            wide: true
        },
        capacityInputs: {
            key: 'capacityInputs',
            title: 'Capacity Inputs',
            bodyHtml: (_prefix, model) => renderCapacityInputsPanel(model),
            wide: true,
            panelOnly: true
        },
        atlCtlResolver: {
            key: 'atlCtlResolver',
            title: 'CTL / ATL Contradiction Resolver',
            bodyHtml: (_prefix, model) => renderAtlCtlResolverPanel(model),
            wide: true,
            panelOnly: true
        },
        accumulated: { key: 'accumulated', title: 'Accumulated Distance vs Time', canvasId: 'accumulated-distance-chart' },
        weekly: {
            key: 'weekly',
            title: 'Weekly Distance + Rolling Mean',
            controlHtml: (prefix) => `
                <div class="eddington-mode-selector run-plus-rolling-selector" id="${prefix('rolling-window-selector')}" aria-label="Rolling mean window">
                    <button class="eddington-mode-btn${runPlusRollingWindow === 4 ? ' active' : ''}" data-rolling="4">1 month</button>
                    <button class="eddington-mode-btn${runPlusRollingWindow === 12 ? ' active' : ''}" data-rolling="12">3 months</button>
                    <button class="eddington-mode-btn${runPlusRollingWindow === 26 ? ' active' : ''}" data-rolling="26">6 months</button>
                    <button class="eddington-mode-btn${runPlusRollingWindow === 52 ? ' active' : ''}" data-rolling="52">1 year</button>
                </div>
            `,
            bodyHtml: (prefix) => `
                <canvas id="${prefix('rolling-mean-distance-chart')}"></canvas>
            `,
            panelOnly: false
        },
        eddington: {
            key: 'eddington',
            title: 'Eddington Distribution / Progression',
            bodyHtml: (prefix) => `
                <div class="eddington-mode-selector" id="${prefix('run-eddington-mode-selector')}">
                    <button class="eddington-mode-btn active" data-mode="daily">Daily</button>
                    <button class="eddington-mode-btn" data-mode="weekly-1">Weekly x1</button>
                    <button class="eddington-mode-btn" data-mode="weekly-3">Weekly x3</button>
                    <button class="eddington-mode-btn" data-mode="weekly-5">Weekly x5</button>
                </div>
                <div class="run-plus-chart-pair">
                    <div class="chart-container">
                        <h3>Eddington Distribution</h3>
                        <canvas id="${prefix('run-eddington-distribution-chart')}"></canvas>
                    </div>
                    <div class="chart-container">
                        <h3>Eddington Progression</h3>
                        <canvas id="${prefix('run-eddington-progression-chart')}"></canvas>
                    </div>
                </div>
            `,
            wide: true,
            panelOnly: true
        },
        topRuns: {
            key: 'topRuns',
            title: 'Longest Runs / Most Elevation / Fastest Races',
            bodyHtml: (prefix) => `<div id="${prefix('run-top')}"></div>`,
            wide: true,
            panelOnly: true
        },
        table: {
            key: 'table',
            title: 'Run Activities Table / Export',
            bodyHtml: (prefix) => `
                <div id="${prefix('run-activities-table')}"></div>
                <div class="run-plus-export-buttons">
                    <button id="${prefix('download-csv-btn')}" type="button">Download CSV</button>
                    <button id="${prefix('download-pdf-btn')}" type="button">Print Report</button>
                </div>
            `,
            wide: true,
            panelOnly: true
        }
    };

    return allModules[moduleKey] || null;
}

function renderSectionGroup(group, model) {
    const prefix = runPlusId;

    const moduleHtmlParts = group.modules.map(moduleKey => {
        const config = getModuleConfig(moduleKey);
        if (!config) return '';

        // Resolve bodyHtml if it's a function
        const resolvedConfig = { ...config };
        if (typeof config.bodyHtml === 'function') {
            resolvedConfig.bodyHtml = config.bodyHtml(prefix, model);
        }
        if (typeof config.controlHtml === 'function') {
            resolvedConfig.controlHtml = config.controlHtml(prefix);
        }

        return renderChartModule(resolvedConfig, model);
    });

    // Build grid: wide modules span full width, others pair up
    return `
        <details class="run-plus-section-group" open>
            <summary class="run-plus-section-group__header">
                <span class="run-plus-section-group__icon">${group.icon}</span>
                <span class="run-plus-section-group__title">${esc(group.title)}</span>
                <span class="run-plus-section-group__subtitle">${esc(group.subtitle)}</span>
            </summary>
            <div class="run-plus-section-group__grid">
                ${moduleHtmlParts.join('')}
            </div>
        </details>
    `;
}

// ─── Collapsible auxiliary sections ─────────────────────

function renderQualityCollapsible(model) {
    const rows = [
        ['Activity identity', model.quality.coverage.id],
        ['Local date', model.quality.coverage.date],
        ['Distance', model.quality.coverage.distance],
        ['Moving time', model.quality.coverage.movingTime],
        ['Elevation gain', model.quality.coverage.elevation],
        ['Average heart rate', model.quality.coverage.heartRate],
        ['TSS / daily load', model.quality.coverage.load],
        ['CTL / ATL / TSB', model.quality.coverage.pmc],
        ['Gear', model.quality.coverage.gear],
        ['Cadence', model.quality.coverage.cadence],
        ['Weather context', model.quality.coverage.weather],
        ['Race-like labels', model.quality.coverage.race]
    ];

    return `
        <details class="run-plus-collapsible">
            <summary>
                Data Quality & Field Availability
                <span class="run-plus-pill ${confidenceClass(model.quality.score)}">${model.quality.score}/100</span>
            </summary>
            <div class="run-plus-collapsible__body">
                <div class="run-plus-quality-grid">
                    ${rows.map(([label, value]) => `
                        <div class="run-plus-quality-row">
                            <span>${esc(label)}</span>
                            <div class="run-plus-meter"><i style="width:${Math.round(value * 100)}%"></i></div>
                            <strong>${pct(value)}</strong>
                        </div>
                    `).join('')}
                </div>
            </div>
        </details>
    `;
}

function renderEvidenceCollapsible(model) {
    const entries = [
        ['Longest single run', model.top.maxRun ? `${model.top.maxRun.name || 'Run'} · ${km(model.top.maxRun).toFixed(2)} km · ${dateKey(model.top.maxRun)}` : '-'],
        ['Most elevation', model.top.maxElevationRun ? `${model.top.maxElevationRun.name || 'Run'} · ${Math.round(Number(model.top.maxElevationRun.total_elevation_gain) || 0)} m · ${dateKey(model.top.maxElevationRun)}` : '-'],
        ['Credible fastest race-like run', model.top.bestRace ? `${model.top.bestRace.name || 'Run'} · ${paceLabel(paceSec(model.top.bestRace))} · ${dateKey(model.top.bestRace)}` : '-'],
        ['Long-run inventory', `${model.longRuns.over16} over 16 km · ${model.longRuns.overHalf} over half marathon · ${model.longRuns.over30} over 30 km`]
    ];

    return `
        <details class="run-plus-collapsible">
            <summary>Evidence Highlights</summary>
            <div class="run-plus-collapsible__body">
                <div class="run-plus-evidence-grid">
                    ${entries.map(([label, value]) => `
                        <article class="run-plus-evidence">
                            <span>${esc(label)}</span>
                            <strong>${esc(value)}</strong>
                        </article>
                    `).join('')}
                </div>
            </div>
        </details>
    `;
}

function renderAnomaliesCollapsible(model) {
    const topRows = model.anomalies.slice(0, 8);
    return `
        <details class="run-plus-collapsible">
            <summary>
                Anomaly Gate
                <span class="run-plus-pill ${model.anomalies.length > 0 ? 'run-plus-pill--warn' : 'run-plus-pill--good'}">${model.anomalies.length} anomalies, ${model.duplicateSuspects.length} duplicates</span>
            </summary>
            <div class="run-plus-collapsible__body">
                ${topRows.length ? `
                    <div class="run-plus-table-wrap">
                        <table class="compact-table">
                            <thead>
                                <tr><th>Date</th><th>Activity</th><th>Distance</th><th>Pace</th><th>Reason</th></tr>
                            </thead>
                            <tbody>
                                ${topRows.map(item => `
                                    <tr>
                                        <td>${esc(dateKey(item.run))}</td>
                                        <td>${esc(item.run.name || 'Run')}</td>
                                        <td>${item.distanceKm.toFixed(2)} km</td>
                                        <td>${paceLabel(item.pace)}</td>
                                        <td>${esc(item.reasons.join(', '))}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<p class="run-plus-empty">No high-priority anomalies in the active filter.</p>'}
            </div>
        </details>
    `;
}

function renderFieldGroupsCollapsible() {
    return `
        <details class="run-plus-collapsible">
            <summary>Field Dependency Map</summary>
            <div class="run-plus-collapsible__body">
                <div class="run-plus-field-groups">
                    ${FIELD_GROUPS.map(group => `
                        <article class="run-plus-field-group">
                            <span>${esc(group.tier)}</span>
                            <h4>${esc(group.label)}</h4>
                            <p>${group.fields.map(field => `<code>${field}</code>`).join(' ')}</p>
                        </article>
                    `).join('')}
                </div>
            </div>
        </details>
    `;
}

function renderMetricCatalogCollapsible(model) {
    return `
        <details class="run-plus-collapsible">
            <summary>
                Metric Catalogue
                <span class="run-plus-pill run-plus-pill--muted">${METRIC_CATALOG.length} dimensions</span>
            </summary>
            <div class="run-plus-collapsible__body">
                <div class="run-plus-table-wrap">
                    <table class="compact-table run-plus-metric-table">
                        <thead>
                            <tr>
                                <th>Tier</th>
                                <th>Dimension</th>
                                <th>Training question</th>
                                <th>Must-have fields</th>
                                <th>Bonus fields</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${METRIC_CATALOG.map(metric => {
                                const [status, cls] = metricAvailability(metric, model.quality);
                                return `
                                    <tr>
                                        <td>${esc(metric[4])}</td>
                                        <td>${esc(metric[0])}</td>
                                        <td>${esc(metric[1])}</td>
                                        <td>${esc(metric[2])}</td>
                                        <td>${esc(metric[3])}</td>
                                        <td><span class="run-plus-pill ${cls}">${esc(status)}</span></td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </details>
    `;
}

function getCssColor(varName, fallback) {
    if (typeof getComputedStyle !== 'function') return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
}

function destroyImpactLoadChart() {
    if (window.runPlusMechanicalLoadChart) {
        window.runPlusMechanicalLoadChart.destroy();
        window.runPlusMechanicalLoadChart = null;
    }
}

function renderImpactLoadChart(model) {
    const canvas = document.getElementById(runPlusId('mechanical-load-chart'));
    destroyImpactLoadChart();
    if (!canvas || typeof Chart === 'undefined') return;

    const series = model.impactLoad.dailySeries;
    if (!series.length) return;

    const runColor = getCssColor('--color-sport-run', '#fc5200');
    const textColor = getCssColor('--color-text-medium', '#667085');
    const borderColor = getCssColor('--color-border', '#e5e7eb');
    const capacityDaily = model.impactLoad.adjustedCapacity > 0 ? model.impactLoad.adjustedCapacity / 7 : null;

    window.runPlusMechanicalLoadChart = new Chart(canvas.getContext('2d'), {
        data: {
            labels: series.map(day => day.date),
            datasets: [
                {
                    type: 'bar',
                    label: 'Daily ILP',
                    data: series.map(day => +day.impactLoad.toFixed(1)),
                    backgroundColor: 'rgba(252, 82, 0, 0.22)',
                    borderColor: runColor,
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: 'Impact ATL 7d',
                    data: series.map(day => +day.impactAtl.toFixed(1)),
                    borderColor: '#d97706',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.22,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: 'Impact CTL 42d',
                    data: series.map(day => +day.impactCtl.toFixed(1)),
                    borderColor: '#2563eb',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.22,
                    yAxisID: 'y'
                },
                ...(capacityDaily ? [{
                    type: 'line',
                    label: 'Adjusted capacity / day',
                    data: series.map(() => +capacityDaily.toFixed(1)),
                    borderColor: '#16a34a',
                    backgroundColor: 'transparent',
                    borderDash: [6, 4],
                    borderWidth: 1.6,
                    pointRadius: 0,
                    yAxisID: 'y'
                }] : [])
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: textColor } },
                tooltip: {
                    callbacks: {
                        afterBody: (items) => {
                            const index = items?.[0]?.dataIndex;
                            const day = Number.isInteger(index) ? series[index] : null;
                            if (!day) return [];
                            return [
                                `Distance: ${day.distance.toFixed(1)} km`,
                                `Estimated contacts: ${Math.round(day.steps).toLocaleString()}`,
                                `Impact TSB: ${day.impactTsb.toFixed(1)}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: textColor, maxTicksLimit: 10 },
                    grid: { color: borderColor }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Impact Load Points', color: textColor },
                    ticks: { color: textColor },
                    grid: { color: borderColor }
                }
            }
        }
    });
}

// ─── Event binding ──────────────────────────────────────

function bindDiagnosisToggles(root) {
    const toggleButtons = root.querySelectorAll('.run-plus-diagnosis-toggle');
    toggleButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-diagnosis-target');
            const panel = root.querySelector(`#${targetId}`);
            if (!panel) return;
            const isExpanded = panel.classList.contains('expanded');
            panel.classList.toggle('expanded', !isExpanded);
            button.classList.toggle('expanded', !isExpanded);
        });
    });
}

function notifyRunPlusFilterChange(root, allActivities, nextFilters, options) {
    const normalized = {
        dateFilterFrom: nextFilters.dateFilterFrom || null,
        dateFilterTo: nextFilters.dateFilterTo || null,
        gearFilter: nextFilters.gearFilter || 'all'
    };

    if (typeof options.onFiltersChange === 'function') {
        options.onFiltersChange(normalized);
        return;
    }

    renderRunPlusTab(
        allActivities,
        normalized.dateFilterFrom,
        normalized.dateFilterTo,
        normalized.gearFilter,
        options
    );
}

function bindRunPlusFilterControls(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options) {
    const fromEl = root.querySelector(`#${runPlusId('date-from')}`);
    const toEl = root.querySelector(`#${runPlusId('date-to')}`);
    const gearEl = root.querySelector(`#${runPlusId('gear-filter')}`);
    const applyButton = root.querySelector(`#${runPlusId('apply-filter')}`);
    const resetButton = root.querySelector(`#${runPlusId('reset-filter')}`);
    const yearButtons = root.querySelectorAll(`#${runPlusId('year-filter-buttons')} .year-btn`);

    const applyCurrent = () => {
        notifyRunPlusFilterChange(root, allActivities, {
            dateFilterFrom: fromEl?.value || null,
            dateFilterTo: toEl?.value || null,
            gearFilter: gearEl?.value || 'all'
        }, options);
    };

    if (applyButton) {
        applyButton.addEventListener('click', applyCurrent);
    }

    if (resetButton) {
        resetButton.addEventListener('click', () => {
            notifyRunPlusFilterChange(root, allActivities, {
                dateFilterFrom: null,
                dateFilterTo: null,
                gearFilter: 'all'
            }, options);
        });
    }

    if (gearEl) {
        gearEl.addEventListener('change', applyCurrent);
    }

    yearButtons.forEach(button => {
        button.addEventListener('click', () => {
            const year = button.dataset.year;
            notifyRunPlusFilterChange(root, allActivities, {
                dateFilterFrom: `${year}-01-01`,
                dateFilterTo: `${year}-12-31`,
                gearFilter: gearEl?.value || gearFilter || 'all'
            }, options);
        });
    });
}

function bindCapacityInputs(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options) {
    const form = root.querySelector(`#${runPlusId('capacity-input-form')}`);
    const resetButton = root.querySelector(`#${runPlusId('capacity-reset-btn')}`);
    if (!form) return;

    form.addEventListener('submit', event => {
        event.preventDefault();
        const formData = new FormData(form);
        const rawPayload = {};
        ['painScore', 'nextDayScore', 'sleepScore', 'energyScore', 'strengthSessions'].forEach(key => {
            const raw = formData.get(key);
            if (raw !== null && String(raw).trim() !== '') rawPayload[key] = Number(raw);
        });
        const normalized = normalizeCapacityInputs(rawPayload);
        const payload = {};
        Object.entries(normalized).forEach(([key, value]) => {
            if (Number.isFinite(value)) payload[key] = value;
        });
        localStorage.setItem(CAPACITY_INPUTS_STORAGE_KEY, JSON.stringify(payload));
        renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
    });

    if (resetButton) {
        resetButton.addEventListener('click', () => {
            localStorage.removeItem(CAPACITY_INPUTS_STORAGE_KEY);
            renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        });
    }
}

function bindRunPlusControls(root, model, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options = {}) {
    bindRunPlusFilterControls(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
    bindCapacityInputs(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);

    const rollingSelector = root.querySelector(`#${runPlusId('rolling-window-selector')}`);
    if (rollingSelector) {
        rollingSelector.querySelectorAll('[data-rolling]').forEach(btn => {
            btn.addEventListener('click', () => {
                rollingSelector.querySelectorAll('.eddington-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                runPlusRollingWindow = parseInt(btn.dataset.rolling, 10) || 26;
                renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
            });
        });
    }

    const csvButton = root.querySelector(`#${runPlusId('download-csv-btn')}`);
    if (csvButton) {
        csvButton.addEventListener('click', () => {
            if (!model.runs.length) return;
            const headers = Object.keys(model.runs[0]);
            const csvRows = [
                headers.join(','),
                ...model.runs.map(run => headers.map(header => `"${(run[header] ?? '').toString().replace(/"/g, '""')}"`).join(','))
            ];
            const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'run-plus-filtered-runs.csv';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    }

    const pdfButton = root.querySelector(`#${runPlusId('download-pdf-btn')}`);
    if (pdfButton) {
        pdfButton.addEventListener('click', () => window.print());
    }

    bindDiagnosisToggles(root);
    publishRunPlusDiagnostics(root, model.diagnostics);
}

function publishRunPlusDiagnostics(root, diagnostics) {
    if (!root) return;
    root.runPlusDiagnostics = diagnostics;
    root.dataset.runPlusDiagnostics = JSON.stringify(diagnostics);
    window.runPlusDiagnostics = diagnostics;
}

// ─── Main render ────────────────────────────────────────

export function renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter = 'all', options = {}) {
    const root = document.getElementById('run-plus-tab');
    if (!root) return;

    const model = buildModel(allActivities, dateFilterFrom, dateFilterTo, gearFilter);
    model.diagnostics = buildDiagnostics(model);

    if (!model.runs.length) {
        destroyImpactLoadChart();
        publishRunPlusDiagnostics(root, model.diagnostics);
        root.innerHTML = `
            <div class="run-plus-shell">
                ${renderRunPlusFilters(allActivities, dateFilterFrom, dateFilterTo, gearFilter)}
                <section class="run-plus-diagnosis-overview">
                    <h2>Run Plus</h2>
                    <p>No run activities match the current filters.</p>
                </section>
            </div>
        `;
        bindRunPlusFilterControls(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        return;
    }

    // Build all section groups
    const sectionGroupsHtml = SECTION_GROUPS.map(group => renderSectionGroup(group, model)).join('');

    // Build collapsible auxiliary modules
    const auxiliaryHtml = `
        <div class="run-plus-collapsible-group">
            <div class="run-plus-collapsible-group__title">
                <span>📋</span> Data Quality & Auxiliary Modules
            </div>
            ${renderQualityCollapsible(model)}
            ${renderEvidenceCollapsible(model)}
            ${renderAnomaliesCollapsible(model)}
            ${renderFieldGroupsCollapsible()}
            ${renderMetricCatalogCollapsible(model)}
        </div>
    `;

    root.innerHTML = `
        <div class="run-plus-shell">
            ${renderRunPlusFilters(allActivities, dateFilterFrom, dateFilterTo, gearFilter)}
            ${renderDiagnosisOverview(model)}
            ${renderStatCards(model)}
            ${sectionGroupsHtml}
            ${auxiliaryHtml}
        </div>
    `;

    publishRunPlusDiagnostics(root, model.diagnostics);

    renderRunAnalysisTab(
        allActivities,
        dateFilterFrom,
        dateFilterTo,
        gearFilter,
        runPlusRollingWindow,
        { idPrefix: RUN_PLUS_ID_PREFIX, containerId: 'run-plus-tab' }
    );

    renderImpactLoadChart(model);
    bindRunPlusControls(root, model, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
}
