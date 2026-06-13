import * as utils from './utils.js';
import { getCachedGears } from './api.js';
import { renderRunAnalysisTab } from './run-analysis.js';

const PACE_FAST_LIMIT_SEC = 150;
const PACE_SLOW_LIMIT_SEC = 900;
const RUN_PLUS_ID_PREFIX = 'run-plus-';
const RUN_TYPE_RE = /run/i;
const RACE_NAME_RE = /马拉松|半马|半程|比赛|race|marathon|赛事|pb|5k|10k/i;
const CAPACITY_INPUTS_STORAGE_KEY = 'run_plus_capacity_inputs_v1';
const NSM_SETTINGS_STORAGE_KEY = 'run_plus_nsm_settings_v1';
const NSM_ACTIVITY_TAGS_STORAGE_KEY = 'run_plus_nsm_activity_tags_v1';
const NSM_SESSION_INPUTS_STORAGE_KEY = 'run_plus_nsm_session_inputs_v1';
const NSM_TESTS_STORAGE_KEY = 'run_plus_nsm_tests_v1';
const NSM_INTERVAL_ANALYSIS_STORAGE_KEY = 'run_plus_nsm_interval_analysis_v1';
const NSM_INTERVAL_ANALYZER_VERSION = 4;
const IMPACT_ATL_DAYS = 7;
const IMPACT_CTL_DAYS = 42;
const NSM_THRESHOLD_RE = /threshold|tempo|subt|sub-threshold|nsm|umbral|terskel| cruise /i;
const NSM_EASY_RE = /easy|recovery|recover|suave|regenerativo|aerobic|z2/i;
const NSM_LONG_RE = /long run|longrun|tirada|fondo|long/i;
const NSM_RACE_TEST_RE = /race|比赛|赛事|pb|time trial|tt|test|5k|10k|half|hm|marathon|半马|半程|马拉松/i;
const NSM_SUBT_TAGS = new Set(['subt_short', 'subt_medium', 'subt_long']);
const NSM_DEFAULT_SETTINGS = {
    easyHrCapPct: 70,
    thresholdHrPct: 87,
    currentBlockStart: '',
    currentBlockEnd: '',
    targetRace: '',
    weeklyTemplate: 'standard'
};
const NSM_WEEKLY_TARGETS = {
    subThresholdSessions: 3,
    easySessions: 3,
    longRuns: 1,
    subThresholdShareLow: 0.20,
    subThresholdShareHigh: 0.25
};
const NSM_TAG_OPTIONS = [
    ['auto', 'Auto'],
    ['easy', 'Easy'],
    ['subt_short', 'SubT short'],
    ['subt_medium', 'SubT medium'],
    ['subt_long', 'SubT long'],
    ['long', 'Long run'],
    ['race_test', 'Race / test'],
    ['other', 'Other'],
    ['excluded', 'Exclude']
];
const NSM_TEMPLATE_OPTIONS = [
    ['auto', 'Auto'],
    ['8x3', '8 x 3 min'],
    ['10x3', '10 x 3 min'],
    ['8x4', '8 x 4 min'],
    ['6x6', '6 x 6 min'],
    ['4x8', '4 x 8 min'],
    ['3x10', '3 x 10 min'],
    ['3x12', '3 x 12 min'],
    ['custom', 'Custom']
];
const NSM_TEMPLATE_DEFINITIONS = {
    '8x3': { reps: 8, workSec: 180, recoverySec: 60, family: '8x3' },
    '10x3': { reps: 10, workSec: 180, recoverySec: 60, family: '10x3' },
    '8x4': { reps: 8, workSec: 240, recoverySec: 75, family: '8x4' },
    '6x6': { reps: 6, workSec: 360, recoverySec: 90, family: '6x6' },
    '4x8': { reps: 4, workSec: 480, recoverySec: 120, family: '4x8' },
    '3x10': { reps: 3, workSec: 600, recoverySec: 180, family: '3x10' },
    '3x12': { reps: 3, workSec: 720, recoverySec: 180, family: '3x12' }
};
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

function nsmHrPercentLabel(value) {
    return percentLabel(value, 1);
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

function readJsonStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
    } catch (_err) {
        return fallback;
    }
}

function writeJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function parseNsmNumber(value, min, max, fallback = null) {
    if (value === '' || value === null || value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return clamp(number, min, max);
}

function normalizeNsmSettings(raw = {}) {
    const settings = { ...NSM_DEFAULT_SETTINGS, ...(raw || {}) };
    const easyHrCapPct = parseNsmNumber(settings.easyHrCapPct, 50, 85, NSM_DEFAULT_SETTINGS.easyHrCapPct);
    const thresholdHrCapPct = Math.max(
        easyHrCapPct + 1,
        parseNsmNumber(settings.thresholdHrPct, 75, 95, NSM_DEFAULT_SETTINGS.thresholdHrPct)
    );
    return {
        easyHrCapPct,
        thresholdHrPct: clamp(thresholdHrCapPct, 75, 95),
        currentBlockStart: /^\d{4}-\d{2}-\d{2}$/.test(settings.currentBlockStart || '') ? settings.currentBlockStart : '',
        currentBlockEnd: /^\d{4}-\d{2}-\d{2}$/.test(settings.currentBlockEnd || '') ? settings.currentBlockEnd : '',
        targetRace: String(settings.targetRace || '').slice(0, 80),
        weeklyTemplate: ['standard', 'intro', 'marathon'].includes(settings.weeklyTemplate) ? settings.weeklyTemplate : 'standard'
    };
}

function readNsmSettings() {
    return normalizeNsmSettings(readJsonStorage(NSM_SETTINGS_STORAGE_KEY, {}));
}

function readNsmActivityTags() {
    const raw = readJsonStorage(NSM_ACTIVITY_TAGS_STORAGE_KEY, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function readNsmSessionInputs() {
    const raw = readJsonStorage(NSM_SESSION_INPUTS_STORAGE_KEY, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function readNsmTests() {
    const raw = readJsonStorage(NSM_TESTS_STORAGE_KEY, []);
    return Array.isArray(raw) ? raw.map(normalizeNsmTest).filter(Boolean) : [];
}

function getActivityKey(run) {
    return String(run?.id || [dateKey(run), run?.name || 'Run', Math.round(km(run) * 1000), Number(run?.moving_time) || 0].join('|'));
}

function normalizeNsmTag(value) {
    return NSM_TAG_OPTIONS.some(option => option[0] === value) ? value : 'auto';
}

function normalizeNsmTemplate(value) {
    return NSM_TEMPLATE_OPTIONS.some(option => option[0] === value) ? value : 'auto';
}

function normalizeNsmActivityTag(raw = {}) {
    const tag = normalizeNsmTag(raw.tag);
    return {
        tag,
        includeInNsm: raw.includeInNsm === false ? false : tag !== 'excluded',
        updatedAt: raw.updatedAt || new Date().toISOString()
    };
}

function parsePaceInput(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (/^\d+(\.\d+)?$/.test(text)) {
        const number = Number(text);
        if (!Number.isFinite(number) || number <= 0) return null;
        return number < 30 ? Math.round(number * 60) : Math.round(number);
    }
    const parts = text.split(':').map(part => Number(part));
    if (parts.length !== 2 || parts.some(part => !Number.isFinite(part) || part < 0)) return null;
    return Math.round(parts[0] * 60 + parts[1]);
}

function formatPaceInput(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function normalizeNsmSessionInput(raw = {}) {
    return {
        template: normalizeNsmTemplate(raw.template),
        workPaceSec: parseNsmNumber(raw.workPaceSec ?? parsePaceInput(raw.workPace), PACE_FAST_LIMIT_SEC, PACE_SLOW_LIMIT_SEC, null),
        workHr: parseNsmNumber(raw.workHr, 60, 230, null),
        workMinutes: parseNsmNumber(raw.workMinutes, 1, 240, null),
        rpe: parseNsmNumber(raw.rpe, 0, 10, null),
        lactate: parseNsmNumber(raw.lactate, 0, 12, null),
        painScore: parseNsmNumber(raw.painScore, 0, 10, null),
        nextDayScore: parseNsmNumber(raw.nextDayScore, 0, 10, null),
        notes: String(raw.notes || '').slice(0, 240)
    };
}

function hasNsmSessionInput(input = {}) {
    return input.template !== 'auto'
        || Number.isFinite(input.workPaceSec)
        || Number.isFinite(input.workHr)
        || Number.isFinite(input.workMinutes)
        || Number.isFinite(input.rpe)
        || Number.isFinite(input.lactate)
        || Number.isFinite(input.painScore)
        || Number.isFinite(input.nextDayScore)
        || Boolean(input.notes);
}

function parseDurationInput(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text));
    const parts = text.split(':').map(part => Number(part));
    if (parts.some(part => !Number.isFinite(part) || part < 0)) return null;
    if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
    if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    return null;
}

function formatDurationInput(seconds) {
    const total = Math.round(Number(seconds) || 0);
    if (!total) return '-';
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function normalizeNsmTest(raw = {}) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') ? raw.date : '';
    const distanceKm = parseNsmNumber(raw.distanceKm, 0.4, 100, null);
    const timeSec = parseNsmNumber(raw.timeSec ?? parseDurationInput(raw.time), 30, 86400, null);
    if (!date || !Number.isFinite(distanceKm) || !Number.isFinite(timeSec)) return null;
    return {
        id: String(raw.id || `${date}-${raw.type || 'test'}-${distanceKm}-${timeSec}`),
        date,
        type: String(raw.type || 'TT').slice(0, 24),
        distanceKm,
        timeSec,
        sourceActivityId: raw.sourceActivityId ? String(raw.sourceActivityId) : '',
        notes: String(raw.notes || '').slice(0, 160)
    };
}

function getNsmTemplateDefinition(input = {}) {
    return NSM_TEMPLATE_DEFINITIONS[normalizeNsmTemplate(input.template)] || null;
}

function hasNsmManualWorkOverride(input = {}) {
    return Number.isFinite(input.workPaceSec)
        || Number.isFinite(input.workHr)
        || Number.isFinite(input.workMinutes);
}

function getNsmActivityFingerprint(run) {
    return [
        dateKey(run),
        run?.start_date || '',
        run?.start_date_local || '',
        Math.round(Number(run?.distance) || 0),
        Math.round(Number(run?.moving_time) || 0)
    ].join('|');
}

function readNsmIntervalAnalysisCache() {
    const raw = readJsonStorage(NSM_INTERVAL_ANALYSIS_STORAGE_KEY, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function writeNsmIntervalAnalysisCache(cache) {
    try {
        writeJsonStorage(NSM_INTERVAL_ANALYSIS_STORAGE_KEY, cache);
    } catch (_err) {
        const compact = Object.fromEntries(Object.entries(cache).slice(-80));
        writeJsonStorage(NSM_INTERVAL_ANALYSIS_STORAGE_KEY, compact);
    }
}

function nsmFiniteOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalizeNsmHrOverlay(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw.source === 'streams' ? 'streams' : '';
    if (!source) return null;
    const hrConfidence = ['high', 'medium', 'low', 'unavailable'].includes(raw.hrConfidence)
        ? raw.hrConfidence
        : ['high', 'medium', 'low'].includes(raw.confidence)
            ? raw.confidence
            : 'low';
    return {
        source,
        confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : hrConfidence === 'unavailable' ? 'low' : hrConfidence,
        hrConfidence,
        hrResponse: nsmFiniteOrNull(raw.hrResponse),
        hrMetricUsed: raw.hrMetricUsed || '',
        earlyRepRange: raw.earlyRepRange || '',
        lateRepRange: raw.lateRepRange || '',
        earlyHrMetric: nsmFiniteOrNull(raw.earlyHrMetric),
        lateHrMetric: nsmFiniteOrNull(raw.lateHrMetric),
        lateEndHr: nsmFiniteOrNull(raw.lateEndHr),
        lateSurge: nsmFiniteOrNull(raw.lateSurge),
        recoveryHrDrop: nsmFiniteOrNull(raw.recoveryHrDrop),
        avgWorkHr: nsmFiniteOrNull(raw.avgWorkHr),
        avgEndHr: nsmFiniteOrNull(raw.avgEndHr),
        avgLast60Hr: nsmFiniteOrNull(raw.avgLast60Hr),
        avgLast120Hr: nsmFiniteOrNull(raw.avgLast120Hr),
        avgFinalThirdHr: nsmFiniteOrNull(raw.avgFinalThirdHr),
        avgHrRiseWithinRep: nsmFiniteOrNull(raw.avgHrRiseWithinRep),
        warnings: Array.isArray(raw.warnings) ? raw.warnings : []
    };
}

function nsmHrConfidenceRank(value) {
    if (value === 'high') return 3;
    if (value === 'medium') return 2;
    if (value === 'low') return 1;
    return 0;
}

function chooseNsmHrOverlay(existingOverlay, nextOverlay) {
    const existing = normalizeNsmHrOverlay(existingOverlay);
    const next = normalizeNsmHrOverlay(nextOverlay);
    if (!existing) return next;
    if (!next) return existing;
    const existingRank = nsmHrConfidenceRank(existing.hrConfidence);
    const nextRank = nsmHrConfidenceRank(next.hrConfidence);
    if (nextRank > existingRank) return next;
    if (nextRank < existingRank) return existing;
    const existingHasResponse = Number.isFinite(existing.hrResponse);
    const nextHasResponse = Number.isFinite(next.hrResponse);
    if (nextHasResponse && !existingHasResponse) return next;
    if (!nextHasResponse && existingHasResponse) return existing;
    return next;
}

function buildNsmHrOverlayFromAnalysis(analysis) {
    if (!analysis || analysis.source !== 'streams') return null;
    const summary = analysis.summary || {};
    const structuralConfidence = ['high', 'medium', 'low'].includes(analysis.confidence) ? analysis.confidence : 'low';
    const rawHrConfidence = summary.hrConfidence || (Number.isFinite(summary.hrResponse) ? structuralConfidence : 'unavailable');
    return normalizeNsmHrOverlay({
        source: 'streams',
        confidence: structuralConfidence,
        hrConfidence: rawHrConfidence,
        hrResponse: summary.hrResponse,
        hrMetricUsed: summary.hrMetricUsed,
        earlyRepRange: summary.earlyRepRange,
        lateRepRange: summary.lateRepRange,
        earlyHrMetric: summary.earlyHrMetric,
        lateHrMetric: summary.lateHrMetric,
        lateEndHr: summary.lateEndHr,
        lateSurge: summary.lateSurge,
        recoveryHrDrop: summary.recoveryHrDrop,
        avgWorkHr: summary.avgWorkHr,
        avgEndHr: summary.avgEndHr,
        avgLast60Hr: summary.avgLast60Hr,
        avgLast120Hr: summary.avgLast120Hr,
        avgFinalThirdHr: summary.avgFinalThirdHr,
        avgHrRiseWithinRep: summary.avgHrRiseWithinRep,
        warnings: analysis.warnings
    });
}

function getNsmHrOverlay(analysis) {
    const explicit = normalizeNsmHrOverlay(analysis?.hrOverlay);
    if (explicit) return explicit;
    if (analysis?.source === 'streams') return buildNsmHrOverlayFromAnalysis(analysis);
    return null;
}

function mergeNsmHrOverlay(baseAnalysis, streamAnalysis, run, input, tag) {
    const overlay = chooseNsmHrOverlay(getNsmHrOverlay(baseAnalysis), buildNsmHrOverlayFromAnalysis(streamAnalysis));
    if (!overlay) return baseAnalysis || streamAnalysis;
    const base = baseAnalysis || buildNsmActivityAverageAnalysis(run, input, tag);
    if (['manual', 'laps'].includes(base.source)) {
        return {
            ...base,
            hrOverlay: overlay,
            warnings: [...(base.warnings || []), ...(overlay.warnings || [])]
        };
    }
    return {
        ...streamAnalysis,
        hrOverlay: overlay
    };
}

function normalizeNsmIntervalAnalysis(raw, run) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.analyzerVersion !== NSM_INTERVAL_ANALYZER_VERSION) return null;
    if (raw.fingerprint !== getNsmActivityFingerprint(run)) return null;
    const summary = raw.summary && typeof raw.summary === 'object' ? raw.summary : {};
    const source = ['manual', 'laps', 'streams', 'activity_average'].includes(raw.source) ? raw.source : 'activity_average';
    const confidence = ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low';
    return {
        ...raw,
        source,
        confidence,
        summary: {
            ...summary,
            workMinutes: Number(summary.workMinutes) || 0,
            workSegments: Number(summary.workSegments) || 0,
            recoverySegments: Number(summary.recoverySegments) || 0,
            avgWorkPaceSec: nsmFiniteOrNull(summary.avgWorkPaceSec),
            avgWorkHr: nsmFiniteOrNull(summary.avgWorkHr),
            avgEndHr: nsmFiniteOrNull(summary.avgEndHr),
            avgLast60Hr: nsmFiniteOrNull(summary.avgLast60Hr),
            avgLast120Hr: nsmFiniteOrNull(summary.avgLast120Hr),
            avgFinalThirdHr: nsmFiniteOrNull(summary.avgFinalThirdHr),
            avgHrRiseWithinRep: nsmFiniteOrNull(summary.avgHrRiseWithinRep),
            paceCv: nsmFiniteOrNull(summary.paceCv),
            paceFadePct: nsmFiniteOrNull(summary.paceFadePct),
            hrDrift: nsmFiniteOrNull(summary.hrDrift),
            hrResponse: nsmFiniteOrNull(summary.hrResponse),
            earlyHrMetric: nsmFiniteOrNull(summary.earlyHrMetric),
            lateHrMetric: nsmFiniteOrNull(summary.lateHrMetric),
            lateEndHr: nsmFiniteOrNull(summary.lateEndHr),
            lateSurge: nsmFiniteOrNull(summary.lateSurge),
            recoveryHrDrop: nsmFiniteOrNull(summary.recoveryHrDrop),
            hrMetricUsed: summary.hrMetricUsed || '',
            hrConfidence: summary.hrConfidence || (source === 'streams' ? 'low' : source === 'laps' ? 'proxy' : 'unavailable'),
            earlyRepRange: summary.earlyRepRange || '',
            lateRepRange: summary.lateRepRange || '',
            workoutFamily: summary.workoutFamily || ''
        },
        hrOverlay: normalizeNsmHrOverlay(raw.hrOverlay),
        segments: Array.isArray(raw.segments) ? raw.segments : [],
        warnings: Array.isArray(raw.warnings) ? raw.warnings : []
    };
}

function getCachedNsmIntervalAnalysis(activityId, run) {
    const cache = readNsmIntervalAnalysisCache();
    return normalizeNsmIntervalAnalysis(cache[activityId], run);
}

function saveNsmIntervalAnalysis(activityId, run, analysis) {
    if (!activityId || !analysis) return;
    const cache = readNsmIntervalAnalysisCache();
    cache[activityId] = {
        ...analysis,
        activityId,
        analyzerVersion: NSM_INTERVAL_ANALYZER_VERSION,
        fingerprint: getNsmActivityFingerprint(run),
        generatedAt: new Date().toISOString()
    };
    writeNsmIntervalAnalysisCache(cache);
}

function estimateNsmFallbackWorkMinutes(run, tag, input = {}) {
    if (Number.isFinite(input.workMinutes)) return input.workMinutes;
    const template = getNsmTemplateDefinition(input);
    if (template) return Math.min(runMinutes(run), template.reps * template.workSec / 60);
    const minutes = runMinutes(run);
    const caps = { subt_short: 30, subt_medium: 45, subt_long: 70 };
    return clamp(minutes * 0.48, Math.min(minutes, 8), Math.min(minutes, caps[tag] || 45));
}

function nsmWeightedAverage(items, valueKey, weightKey = 'duration') {
    const weighted = items
        .map(item => {
            const rawValue = item[valueKey];
            const value = rawValue === null || rawValue === undefined || rawValue === '' ? NaN : Number(rawValue);
            return { value, weight: Number(item[weightKey]) || 0 };
        })
        .filter(item => Number.isFinite(item.value) && item.weight > 0);
    const totalWeight = sum(weighted.map(item => item.weight));
    return totalWeight > 0 ? sum(weighted.map(item => item.value * item.weight)) / totalWeight : null;
}

function nsmCoefficientOfVariation(values) {
    const clean = values.filter(value => Number.isFinite(value) && value > 0);
    if (clean.length < 2) return null;
    const mean = average(clean);
    if (!mean) return null;
    const variance = average(clean.map(value => Math.pow(value - mean, 2)));
    return variance == null ? null : Math.sqrt(variance) / mean;
}

function nsmRepRangeLabel(startIndex, endIndex) {
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return '';
    const start = startIndex + 1;
    const end = endIndex + 1;
    return start === end ? `${start}` : `${start}-${end}`;
}

function getNsmHrComparisonWindows(work) {
    const count = work.length;
    if (count < 2) return null;
    if (count === 2) {
        return { earlyStart: 0, earlyEnd: 0, lateStart: 1, lateEnd: 1 };
    }
    if (count <= 4) {
        return { earlyStart: 1, earlyEnd: 1, lateStart: count - 1, lateEnd: count - 1 };
    }
    if (count <= 7) {
        return { earlyStart: 1, earlyEnd: 2, lateStart: count - 2, lateEnd: count - 1 };
    }
    return { earlyStart: 2, earlyEnd: 3, lateStart: count - 2, lateEnd: count - 1 };
}

function getNsmHrMetricConfig(work) {
    const averageDuration = average(work.map(segment => segment.duration).filter(Number.isFinite));
    if (!Number.isFinite(averageDuration) || averageDuration <= 240) {
        return { key: 'last60Hr', label: 'last60 HR' };
    }
    if (averageDuration <= 480) {
        return { key: 'last120Hr', label: 'last120 HR' };
    }
    return { key: 'finalThirdHr', label: 'final-third HR' };
}

function getNsmSegmentHrMetric(segment, key) {
    const fallbackKeys = key === 'finalThirdHr'
        ? ['finalThirdHr', 'last120Hr', 'last60Hr', 'endHr', 'avgHr']
        : key === 'last120Hr'
            ? ['last120Hr', 'last60Hr', 'endHr', 'avgHr']
            : ['last60Hr', 'endHr', 'avgHr'];
    for (const candidate of fallbackKeys) {
        const value = nsmFiniteOrNull(segment?.[candidate]);
        if (Number.isFinite(value)) return value;
    }
    return null;
}

function summarizeNsmHrResponse(work, source) {
    const hasAnyHr = work.some(segment => ['avgHr', 'endHr', 'last60Hr', 'last120Hr', 'finalThirdHr']
        .some(key => Number.isFinite(nsmFiniteOrNull(segment?.[key]))));
    if (source !== 'streams') {
        return {
            hrResponse: null,
            hrDrift: null,
            earlyHrMetric: null,
            lateHrMetric: null,
            lateEndHr: null,
            lateSurge: null,
            hrMetricUsed: '',
            hrConfidence: source === 'laps' ? 'proxy' : source === 'manual' ? 'proxy' : 'unavailable',
            earlyRepRange: '',
            lateRepRange: ''
        };
    }
    const windows = getNsmHrComparisonWindows(work);
    if (!windows || !hasAnyHr) {
        return {
            hrResponse: null,
            hrDrift: null,
            earlyHrMetric: null,
            lateHrMetric: null,
            lateEndHr: null,
            lateSurge: null,
            hrMetricUsed: '',
            hrConfidence: hasAnyHr ? 'low' : 'unavailable',
            earlyRepRange: '',
            lateRepRange: ''
        };
    }

    const metric = getNsmHrMetricConfig(work);
    const early = work.slice(windows.earlyStart, windows.earlyEnd + 1)
        .map(segment => ({ ...segment, hrMetric: getNsmSegmentHrMetric(segment, metric.key) }));
    const late = work.slice(windows.lateStart, windows.lateEnd + 1)
        .map(segment => ({ ...segment, hrMetric: getNsmSegmentHrMetric(segment, metric.key) }));
    const earlyHrMetric = nsmWeightedAverage(early, 'hrMetric', 'duration');
    const lateHrMetric = nsmWeightedAverage(late, 'hrMetric', 'duration');
    const lateEndHr = nsmWeightedAverage(late, 'endHr', 'duration');
    const hrResponse = Number.isFinite(earlyHrMetric) && Number.isFinite(lateHrMetric)
        ? lateHrMetric - earlyHrMetric
        : null;
    const lateSurge = Number.isFinite(lateEndHr) && Number.isFinite(lateHrMetric)
        ? lateEndHr - lateHrMetric
        : null;

    return {
        hrResponse,
        hrDrift: hrResponse,
        earlyHrMetric,
        lateHrMetric,
        lateEndHr,
        lateSurge,
        hrMetricUsed: metric.label,
        hrConfidence: Number.isFinite(hrResponse) ? 'high' : 'low',
        earlyRepRange: nsmRepRangeLabel(windows.earlyStart, windows.earlyEnd),
        lateRepRange: nsmRepRangeLabel(windows.lateStart, windows.lateEnd)
    };
}

function summarizeNsmIntervalSegments(segments, input = {}, source = 'activity_average') {
    const work = segments.filter(segment => segment.type === 'work');
    const recovery = segments.filter(segment => segment.type === 'recovery');
    const workMinutes = sum(work.map(segment => segment.duration)) / 60;
    const avgWorkSpeed = nsmWeightedAverage(work, 'avgSpeed', 'duration');
    const avgWorkPaceSec = avgWorkSpeed && avgWorkSpeed > 0 ? 1000 / avgWorkSpeed : null;
    const firstHalf = work.slice(0, Math.ceil(work.length / 2));
    const secondHalf = work.slice(Math.floor(work.length / 2));
    const firstPace = nsmWeightedAverage(firstHalf, 'avgPaceSec', 'duration');
    const secondPace = nsmWeightedAverage(secondHalf, 'avgPaceSec', 'duration');
    const hrResponse = summarizeNsmHrResponse(work, source);
    const recoveryDrops = recovery
        .map(segment => Number(segment.startHr) - Number(segment.endHr))
        .filter(Number.isFinite);

    return {
        workSegments: work.length,
        recoverySegments: recovery.length,
        workMinutes,
        avgWorkPaceSec,
        avgWorkHr: nsmWeightedAverage(work, 'avgHr', 'duration'),
        avgEndHr: nsmWeightedAverage(work, 'endHr', 'duration'),
        avgLast60Hr: nsmWeightedAverage(work, 'last60Hr', 'duration'),
        avgLast120Hr: nsmWeightedAverage(work, 'last120Hr', 'duration'),
        avgFinalThirdHr: nsmWeightedAverage(work, 'finalThirdHr', 'duration'),
        avgHrRiseWithinRep: nsmWeightedAverage(work, 'hrRiseWithinRep', 'duration'),
        paceCv: nsmCoefficientOfVariation(work.map(segment => segment.avgPaceSec)),
        paceFadePct: Number.isFinite(firstPace) && firstPace > 0 && Number.isFinite(secondPace) ? (secondPace - firstPace) / firstPace : null,
        ...hrResponse,
        recoveryHrDrop: recoveryDrops.length ? average(recoveryDrops) : null,
        workoutFamily: getNsmTemplateDefinition(input)?.family || normalizeNsmTemplate(input.template)
    };
}

function makeNsmIntervalAnalysis(source, confidence, run, input, segments = [], warnings = []) {
    const summary = summarizeNsmIntervalSegments(segments, input, source);
    return {
        source,
        confidence,
        summary,
        segments: segments.map(segment => ({
            type: segment.type,
            index: segment.index,
            startSec: Math.round(segment.startSec),
            endSec: Math.round(segment.endSec),
            duration: Math.round(segment.duration),
            distance: Math.round(segment.distance),
            avgPaceSec: Number.isFinite(segment.avgPaceSec) ? Math.round(segment.avgPaceSec) : null,
            avgHr: Number.isFinite(segment.avgHr) ? Math.round(segment.avgHr) : null,
            endHr: Number.isFinite(segment.endHr) ? Math.round(segment.endHr) : null,
            last60Hr: Number.isFinite(segment.last60Hr) ? Math.round(segment.last60Hr) : null,
            last120Hr: Number.isFinite(segment.last120Hr) ? Math.round(segment.last120Hr) : null,
            finalThirdHr: Number.isFinite(segment.finalThirdHr) ? Math.round(segment.finalThirdHr) : null,
            hrRiseWithinRep: Number.isFinite(segment.hrRiseWithinRep) ? Math.round(segment.hrRiseWithinRep) : null,
            elevationGain: Number.isFinite(segment.elevationGain) ? Math.round(segment.elevationGain) : null
        })),
        warnings
    };
}

function buildNsmManualIntervalAnalysis(run, input = {}, tag = 'subt_medium') {
    const workMinutes = estimateNsmFallbackWorkMinutes(run, tag, input);
    const avgSpeed = Number.isFinite(input.workPaceSec) && input.workPaceSec > 0 ? 1000 / input.workPaceSec : null;
    const distance = avgSpeed ? avgSpeed * workMinutes * 60 : 0;
    const segment = {
        type: 'work',
        index: 1,
        startSec: 0,
        endSec: workMinutes * 60,
        duration: workMinutes * 60,
        distance,
        avgSpeed,
        avgPaceSec: Number.isFinite(input.workPaceSec) ? input.workPaceSec : null,
        avgHr: Number.isFinite(input.workHr) ? input.workHr : null,
        endHr: Number.isFinite(input.workHr) ? input.workHr : null,
        last60Hr: Number.isFinite(input.workHr) ? input.workHr : null,
        elevationGain: null
    };
    const confidence = hasNsmManualWorkOverride(input) ? 'high' : 'medium';
    return makeNsmIntervalAnalysis('manual', confidence, run, input, [segment], ['Manual or template proxy; not parsed from activity streams.']);
}

function buildNsmActivityAverageAnalysis(run, input = {}, tag = 'subt_medium') {
    const workMinutes = estimateNsmFallbackWorkMinutes(run, tag, input);
    const avgPaceSec = paceSec(run);
    const avgSpeed = Number.isFinite(avgPaceSec) && avgPaceSec > 0 ? 1000 / avgPaceSec : null;
    const avgHr = Number(run.average_heartrate);
    const segment = {
        type: 'work',
        index: 1,
        startSec: 0,
        endSec: workMinutes * 60,
        duration: workMinutes * 60,
        distance: avgSpeed ? avgSpeed * workMinutes * 60 : 0,
        avgSpeed,
        avgPaceSec: Number.isFinite(avgPaceSec) ? avgPaceSec : null,
        avgHr: Number.isFinite(avgHr) ? avgHr : null,
        endHr: Number.isFinite(avgHr) ? avgHr : null,
        last60Hr: Number.isFinite(avgHr) ? avgHr : null,
        elevationGain: null
    };
    return makeNsmIntervalAnalysis('activity_average', 'low', run, input, [segment], ['Activity-average proxy; warmup, recovery, and cooldown may dilute SubT work.']);
}

function normalizeNsmLap(lap, index) {
    const duration = Number(lap?.moving_time || lap?.elapsed_time) || 0;
    const distance = Number(lap?.distance) || 0;
    const avgSpeed = Number(lap?.average_speed) || (duration > 0 ? distance / duration : 0);
    if (duration < 20 || distance <= 0 || avgSpeed <= 0) return null;
    const avgHr = Number(lap?.average_heartrate);
    return {
        raw: lap,
        index: index + 1,
        startSec: null,
        endSec: duration,
        duration,
        distance,
        avgSpeed,
        avgPaceSec: 1000 / avgSpeed,
        avgHr: Number.isFinite(avgHr) ? avgHr : null,
        endHr: Number.isFinite(avgHr) ? avgHr : null,
        last60Hr: Number.isFinite(avgHr) ? avgHr : null,
        elevationGain: Number.isFinite(Number(lap?.total_elevation_gain)) ? Number(lap.total_elevation_gain) : null
    };
}

function getNsmLapWorkBounds(input = {}) {
    const template = getNsmTemplateDefinition(input);
    return {
        template,
        minWorkSec: template ? Math.max(50, template.workSec * 0.45) : 75,
        maxWorkSec: template ? template.workSec * 1.85 : 1800,
        minRecoverySec: template ? Math.max(20, template.recoverySec * 0.35) : 25
    };
}

function getNsmAlternatingLapSegments(laps, input = {}) {
    const { template, minWorkSec, maxWorkSec, minRecoverySec } = getNsmLapWorkBounds(input);
    const workIds = new Set();
    const recoveryIds = new Set();
    const speedRatioFloor = template ? 1.18 : 1.30;

    // Manual interval laps often alternate work/recovery exactly; prefer that structure before using percentile thresholds.
    for (let index = 0; index < laps.length - 1; index += 1) {
        const a = laps[index];
        const b = laps[index + 1];
        const faster = a.avgSpeed >= b.avgSpeed ? a : b;
        const slower = faster === a ? b : a;
        if (faster.duration < minWorkSec || faster.duration > maxWorkSec) continue;
        if (slower.duration < minRecoverySec) continue;
        if (slower.avgSpeed <= 0 || faster.avgSpeed / slower.avgSpeed < speedRatioFloor) continue;
        if (template && Math.abs(faster.duration - template.workSec) > template.workSec * 0.45) continue;
        workIds.add(faster.index);
        recoveryIds.add(slower.index);
    }

    if (workIds.size < 2) return null;
    const segments = [];
    let workIndex = 0;
    let recoveryIndex = 0;
    laps.forEach(lap => {
        if (workIds.has(lap.index)) {
            workIndex += 1;
            segments.push({ ...lap, type: 'work', index: workIndex });
        } else if (segments.length && recoveryIds.has(lap.index)) {
            recoveryIndex += 1;
            segments.push({
                ...lap,
                type: 'recovery',
                index: recoveryIndex,
                startHr: lap.avgHr,
                endHr: lap.avgHr
            });
        }
    });

    return workIndex >= 2 ? segments : null;
}

function getNsmLapSegments(activity, input = {}) {
    const laps = Array.isArray(activity?.laps) ? activity.laps.map(normalizeNsmLap).filter(Boolean) : [];
    if (laps.length < 3) return null;
    let cursor = 0;
    laps.forEach(lap => {
        lap.startSec = cursor;
        lap.endSec = cursor + lap.duration;
        cursor = lap.endSec;
    });

    const alternatingSegments = getNsmAlternatingLapSegments(laps, input);
    if (alternatingSegments) return alternatingSegments;

    const speeds = laps.map(lap => lap.avgSpeed).filter(Number.isFinite);
    const speedMedian = median(speeds);
    if (!speedMedian) return null;
    const speedP65 = percentile(speeds, 0.65) || speedMedian;
    const { template, minWorkSec, maxWorkSec } = getNsmLapWorkBounds(input);
    const speedThreshold = template ? Math.max(speedMedian * 1.04, speedP65 * 0.98) : Math.max(speedMedian * 1.07, speedP65);
    const workLaps = laps.filter(lap => lap.duration >= minWorkSec && lap.duration <= maxWorkSec && lap.avgSpeed >= speedThreshold);
    if (!workLaps.length) return null;

    const selectedWork = template && workLaps.length > template.reps
        ? workLaps
            .map(lap => ({
                lap,
                score: Math.abs(lap.duration - template.workSec) / template.workSec - (lap.avgSpeed / speedThreshold) * 0.2
            }))
            .sort((a, b) => a.score - b.score)
            .slice(0, template.reps)
            .map(item => item.lap)
            .sort((a, b) => a.startSec - b.startSec)
        : workLaps;
    const workIds = new Set(selectedWork.map(lap => lap.index));
    const segments = [];
    let workIndex = 0;
    let recoveryIndex = 0;
    laps.forEach(lap => {
        if (workIds.has(lap.index)) {
            workIndex += 1;
            segments.push({ ...lap, type: 'work', index: workIndex });
        } else if (segments.length && lap.duration >= 30 && lap.avgSpeed < speedThreshold) {
            recoveryIndex += 1;
            segments.push({
                ...lap,
                type: 'recovery',
                index: recoveryIndex,
                startHr: lap.avgHr,
                endHr: lap.avgHr
            });
        }
    });
    return segments.filter(segment => segment.type === 'work').length ? segments : null;
}

function analyzeNsmLaps(activity, run, input = {}) {
    const segments = getNsmLapSegments(activity, input);
    if (!segments) return null;
    const workCount = segments.filter(segment => segment.type === 'work').length;
    const template = getNsmTemplateDefinition(input);
    const confidence = workCount >= 2 && (!template || Math.abs(workCount - template.reps) <= 1) ? 'high' : 'medium';
    return makeNsmIntervalAnalysis('laps', confidence, run, input, segments, []);
}

function getNsmStreamArray(streams, key) {
    const value = streams?.[key];
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    return [];
}

function smoothNsmValues(values, windowSize = 7) {
    const result = [];
    const radius = Math.max(1, Math.floor(windowSize / 2));
    values.forEach((_value, index) => {
        const slice = values.slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1))
            .filter(Number.isFinite);
        result.push(slice.length ? average(slice) : null);
    });
    return result;
}

function buildNsmStreamPoints(streams) {
    const time = getNsmStreamArray(streams, 'time');
    const distance = getNsmStreamArray(streams, 'distance');
    const velocity = getNsmStreamArray(streams, 'velocity_smooth');
    const heartrate = getNsmStreamArray(streams, 'heartrate');
    const altitude = getNsmStreamArray(streams, 'altitude');
    const length = Math.max(time.length, distance.length, velocity.length, heartrate.length, altitude.length);
    if (length < 30) return [];

    const rawSpeeds = Array.from({ length }, (_unused, index) => {
        const speed = Number(velocity[index]);
        if (Number.isFinite(speed) && speed > 0) return speed;
        const dt = Number(time[index]) - Number(time[index - 1]);
        const dd = Number(distance[index]) - Number(distance[index - 1]);
        return dt > 0 && dd >= 0 ? dd / dt : null;
    });
    const smoothSpeeds = smoothNsmValues(rawSpeeds, 9);
    const points = [];
    for (let index = 0; index < length; index += 1) {
        const t = Number(time[index]);
        const d = Number(distance[index]);
        const speed = Number(smoothSpeeds[index]);
        if (!Number.isFinite(t) || !Number.isFinite(speed) || speed <= 0.5 || speed > 9) continue;
        points.push({
            index,
            time: t,
            distance: Number.isFinite(d) ? d : null,
            speed,
            hr: Number.isFinite(Number(heartrate[index])) ? Number(heartrate[index]) : null,
            altitude: Number.isFinite(Number(altitude[index])) ? Number(altitude[index]) : null
        });
    }
    return points.filter((point, index, array) => index === 0 || point.time > array[index - 1].time);
}

function getNsmPointSegment(points, startIndex, endIndex, type, index) {
    const slice = points.slice(startIndex, endIndex + 1);
    if (slice.length < 2) return null;
    const first = slice[0];
    const last = slice[slice.length - 1];
    const duration = last.time - first.time;
    if (duration <= 0) return null;
    const distance = Number.isFinite(first.distance) && Number.isFinite(last.distance)
        ? Math.max(0, last.distance - first.distance)
        : sum(slice.slice(1).map((point, pointIndex) => Math.max(0, (point.time - slice[pointIndex].time) * point.speed)));
    const avgSpeed = distance > 0 ? distance / duration : average(slice.map(point => point.speed));
    const hrs = slice.map(point => point.hr).filter(Number.isFinite);
    const start30End = first.time + 30;
    const start30Hrs = slice.filter(point => point.time <= start30End).map(point => point.hr).filter(Number.isFinite);
    const end30Start = last.time - 30;
    const end30Hrs = slice.filter(point => point.time >= end30Start).map(point => point.hr).filter(Number.isFinite);
    const last60Start = last.time - 60;
    const last60Hrs = slice.filter(point => point.time >= last60Start).map(point => point.hr).filter(Number.isFinite);
    const last120Start = last.time - 120;
    const last120Hrs = slice.filter(point => point.time >= last120Start).map(point => point.hr).filter(Number.isFinite);
    const finalThirdStart = first.time + duration * 2 / 3;
    const finalThirdHrs = slice.filter(point => point.time >= finalThirdStart).map(point => point.hr).filter(Number.isFinite);
    const startHr = start30Hrs.length ? average(start30Hrs) : Number.isFinite(first.hr) ? first.hr : null;
    const endHr = end30Hrs.length ? average(end30Hrs) : Number.isFinite(last.hr) ? last.hr : null;
    const altitudes = slice.map(point => point.altitude).filter(Number.isFinite);
    let elevationGain = null;
    if (altitudes.length >= 2) {
        elevationGain = 0;
        for (let i = 1; i < altitudes.length; i += 1) {
            elevationGain += Math.max(0, altitudes[i] - altitudes[i - 1]);
        }
    }
    return {
        type,
        index,
        startSec: first.time,
        endSec: last.time,
        duration,
        distance,
        avgSpeed,
        avgPaceSec: avgSpeed > 0 ? 1000 / avgSpeed : null,
        avgHr: hrs.length ? average(hrs) : null,
        startHr,
        endHr,
        last60Hr: last60Hrs.length ? average(last60Hrs) : null,
        last120Hr: last120Hrs.length ? average(last120Hrs) : null,
        finalThirdHr: finalThirdHrs.length ? average(finalThirdHrs) : null,
        hrRiseWithinRep: Number.isFinite(startHr) && Number.isFinite(endHr) ? endHr - startHr : null,
        elevationGain
    };
}

function getNsmPointRangeByTime(points, startSec, endSec) {
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
    const startWindow = startSec - 2;
    const endWindow = endSec + 2;
    let startIndex = -1;
    let endIndex = -1;
    points.forEach((point, index) => {
        if (point.time < startWindow || point.time > endWindow) return;
        if (startIndex < 0) startIndex = index;
        endIndex = index;
    });
    return startIndex >= 0 && endIndex > startIndex ? [startIndex, endIndex] : null;
}

function analyzeNsmStreamsAgainstStructure(streams, run, input = {}, structureAnalysis = null) {
    if (structureAnalysis?.source !== 'laps' || !Array.isArray(structureAnalysis.segments)) return null;
    const points = buildNsmStreamPoints(streams);
    if (points.length < 30) return null;
    const structureSegments = structureAnalysis.segments.filter(segment => ['work', 'recovery'].includes(segment?.type));
    const structureWorkCount = structureSegments.filter(segment => segment.type === 'work').length;
    if (structureWorkCount < 2) return null;

    const segments = [];
    let workIndex = 0;
    let recoveryIndex = 0;
    structureSegments.forEach(segment => {
        const range = getNsmPointRangeByTime(points, Number(segment.startSec), Number(segment.endSec));
        if (!range) return;
        const type = segment.type;
        const nextIndex = type === 'work' ? workIndex + 1 : recoveryIndex + 1;
        const pointSegment = getNsmPointSegment(points, range[0], range[1], type, nextIndex);
        if (!pointSegment) return;
        if (type === 'work') {
            workIndex += 1;
            segments.push({ ...pointSegment, index: workIndex });
        } else if (pointSegment.duration >= 20) {
            recoveryIndex += 1;
            segments.push({ ...pointSegment, index: recoveryIndex });
        }
    });

    const workCount = segments.filter(segment => segment.type === 'work').length;
    if (workCount < 2) return null;
    const hasHr = segments.some(segment => Number.isFinite(segment.avgHr));
    const matchRatio = structureWorkCount ? workCount / structureWorkCount : 0;
    let confidence = 'low';
    if (hasHr && matchRatio >= 0.9) confidence = 'high';
    else if (hasHr && matchRatio >= 0.6) confidence = 'medium';
    const warnings = ['Streams HR aligned to existing laps structure.'];
    if (!hasHr) warnings.push('No HR stream; pace/time-only stream overlay.');
    if (workCount !== structureWorkCount) warnings.push(`Matched ${workCount}/${structureWorkCount} lap work reps to stream points.`);
    return makeNsmIntervalAnalysis('streams', confidence, run, input, segments, warnings);
}

function detectNsmStreamWorkRanges(points, input = {}) {
    const speeds = points.map(point => point.speed).filter(Number.isFinite);
    const speedMedian = median(speeds);
    if (!speedMedian) return [];
    const template = getNsmTemplateDefinition(input);
    const threshold = template
        ? Math.max(speedMedian * 1.04, percentile(speeds, 0.60) || speedMedian)
        : Math.max(speedMedian * 1.08, percentile(speeds, 0.70) || speedMedian);
    const minWorkSec = template ? Math.max(60, template.workSec * 0.45) : 120;
    const maxWorkSec = template ? template.workSec * 1.9 : 1800;
    const rawRanges = [];
    let start = null;
    points.forEach((point, index) => {
        if (point.speed >= threshold && start === null) start = index;
        if ((point.speed < threshold || index === points.length - 1) && start !== null) {
            const end = point.speed < threshold ? index - 1 : index;
            rawRanges.push([start, end]);
            start = null;
        }
    });

    const merged = [];
    rawRanges.forEach(range => {
        const previous = merged[merged.length - 1];
        if (previous && points[range[0]].time - points[previous[1]].time <= 25) previous[1] = range[1];
        else merged.push([...range]);
    });

    let ranges = merged.filter(([startIndex, endIndex]) => {
        const duration = points[endIndex].time - points[startIndex].time;
        return duration >= minWorkSec && duration <= maxWorkSec;
    });

    if (template && ranges.length > template.reps) {
        ranges = ranges
            .map(range => {
                const duration = points[range[1]].time - points[range[0]].time;
                const avgSpeed = average(points.slice(range[0], range[1] + 1).map(point => point.speed));
                const durationPenalty = Math.abs(duration - template.workSec) / template.workSec;
                return { range, score: durationPenalty - ((avgSpeed || 0) / threshold) * 0.18 };
            })
            .sort((a, b) => a.score - b.score)
            .slice(0, template.reps)
            .map(item => item.range)
            .sort((a, b) => a[0] - b[0]);
    }

    return ranges;
}

function analyzeNsmStreams(streams, run, input = {}) {
    const points = buildNsmStreamPoints(streams);
    if (points.length < 30) return null;
    const workRanges = detectNsmStreamWorkRanges(points, input);
    if (!workRanges.length) return null;
    const segments = [];
    workRanges.forEach((range, rangeIndex) => {
        const work = getNsmPointSegment(points, range[0], range[1], 'work', rangeIndex + 1);
        if (work) segments.push(work);
        const nextRange = workRanges[rangeIndex + 1];
        if (nextRange && nextRange[0] - range[1] > 3) {
            const recovery = getNsmPointSegment(points, range[1] + 1, nextRange[0] - 1, 'recovery', rangeIndex + 1);
            if (recovery && recovery.duration >= 30) segments.push(recovery);
        }
    });
    const workCount = segments.filter(segment => segment.type === 'work').length;
    if (workCount < 2) return null;
    const template = getNsmTemplateDefinition(input);
    if (template && workCount < Math.max(2, Math.ceil(template.reps * 0.5))) return null;
    const hasHr = segments.some(segment => Number.isFinite(segment.avgHr));
    let confidence = 'low';
    if (hasHr && template) {
        confidence = workCount === template.reps ? 'high' : Math.abs(workCount - template.reps) <= 1 ? 'medium' : 'low';
    } else if (hasHr) {
        confidence = workCount >= 4 ? 'high' : 'medium';
    }
    const warnings = [];
    if (!hasHr) warnings.push('No HR stream; pace/time-only interval analysis.');
    if (template && workCount !== template.reps) warnings.push(`Detected ${workCount}/${template.reps} expected reps from streams; structure is a fallback.`);
    return makeNsmIntervalAnalysis('streams', confidence, run, input, segments, warnings);
}

function getNsmIntervalAnalysisForRow(run, activityId, input, tag) {
    if (hasNsmManualWorkOverride(input)) return buildNsmManualIntervalAnalysis(run, input, tag);
    const cached = getCachedNsmIntervalAnalysis(activityId, run);
    if (cached) return cached;
    return buildNsmActivityAverageAnalysis(run, input, tag);
}

function getDashboardHrMax() {
    const settings = readJsonStorage('dashboard_settings', {});
    const hrMax = Number(settings?.hrMax);
    return Number.isFinite(hrMax) && hrMax >= 120 && hrMax <= 230 ? hrMax : null;
}

function estimateNsmHrMax(runs) {
    const saved = getDashboardHrMax();
    if (saved) return { value: saved, source: 'dashboard setting' };
    const observed = Math.max(
        0,
        ...runs.map(run => Number(run.max_heartrate) || 0),
        ...runs.map(run => Number(run.average_heartrate) || 0)
    );
    if (observed >= 120) return { value: observed, source: 'observed max HR' };
    return { value: 190, source: 'default fallback' };
}

function runMinutes(run) {
    return (Number(run?.moving_time) || 0) / 60;
}

function getWeekContext(runs) {
    const byWeek = new Map();
    runs.forEach(run => {
        const week = weekStart(dateKey(run));
        if (!week) return;
        const entry = byWeek.get(week) || { week, runs: [], totalDistance: 0 };
        entry.runs.push(run);
        entry.totalDistance += km(run);
        byWeek.set(week, entry);
    });

    byWeek.forEach(entry => {
        entry.avgRunDistance = entry.runs.length ? entry.totalDistance / entry.runs.length : 0;
        entry.longestRunKey = entry.runs.reduce((best, run) => km(run) > km(best || {}) ? run : best, null);
    });
    return byWeek;
}

function getAutoSubThresholdTag(run) {
    const minutes = runMinutes(run);
    const name = String(run?.name || '');
    if (/120|long|30k|marathon|mp/i.test(name) || minutes >= 80) return 'subt_long';
    if (/90|medium|6x|8x|hm|half/i.test(name) || minutes >= 55) return 'subt_medium';
    return 'subt_short';
}

function classifyNsmRun(run, context) {
    const activityId = getActivityKey(run);
    const manual = normalizeNsmActivityTag(context.manualTags[activityId] || {});
    if (manual.tag !== 'auto' || manual.includeInNsm === false) {
        return {
            tag: manual.includeInNsm === false ? 'excluded' : manual.tag,
            autoTag: 'auto',
            manualTag: manual.tag,
            includeInNsm: manual.includeInNsm !== false,
            source: 'manual'
        };
    }

    const name = String(run?.name || '');
    const distanceKm = km(run);
    const week = weekStart(dateKey(run));
    const weekInfo = context.weekContext.get(week);
    const isLongestThisWeek = weekInfo?.longestRunKey && getActivityKey(weekInfo.longestRunKey) === activityId;
    const longByShape = distanceKm >= 16 || (isLongestThisWeek && distanceKm >= Math.max(12, (weekInfo?.avgRunDistance || 0) * 1.45));
    const avgHr = Number(run.average_heartrate);
    const easyByHr = Number.isFinite(avgHr) && avgHr > 0 && avgHr <= context.easyHrCap + 3;
    const classified = typeof window !== 'undefined' && typeof window.classifyRun === 'function'
        ? window.classifyRun(run, run.streams || {})
        : null;
    const classifierLabel = classified?.type || classified?.label || classified?.bestType || '';

    let autoTag = 'other';
    if (RACE_NAME_RE.test(name) || NSM_RACE_TEST_RE.test(name) || run.workout_type === 1) autoTag = 'race_test';
    else if (NSM_THRESHOLD_RE.test(name) || (run.workout_type === 3 && Number.isFinite(avgHr) && avgHr >= context.easyHrCap && avgHr <= context.thresholdHrCap + 5)) autoTag = getAutoSubThresholdTag(run);
    else if (NSM_LONG_RE.test(name) || run.workout_type === 2 || longByShape) autoTag = 'long';
    else if (NSM_EASY_RE.test(name) || /Easy\/Recovery/i.test(classifierLabel) || easyByHr) autoTag = 'easy';

    return { tag: autoTag, autoTag, manualTag: 'auto', includeInNsm: true, source: 'auto' };
}

function summarizePeriod(rows, startDate, endDate) {
    const scoped = rows.filter(row => row.date >= startDate && row.date <= endDate && row.includeInNsm);
    const totalMinutes = sum(scoped.map(row => row.minutes));
    const subThresholdMinutes = sum(scoped.filter(row => row.isSubThreshold).map(row => row.subThresholdWorkMinutes ?? row.minutes));
    const easyRuns = scoped.filter(row => row.isEasy);
    return {
        runs: scoped.length,
        totalMinutes,
        totalDistance: sum(scoped.map(row => row.distanceKm)),
        subThresholdSessions: scoped.filter(row => row.isSubThreshold).length,
        subThresholdMinutes,
        subThresholdShare: totalMinutes > 0 ? subThresholdMinutes / totalMinutes : 0,
        easyRuns: easyRuns.length,
        easyOverCap: easyRuns.filter(row => row.easyOverCap).length,
        longRuns: scoped.filter(row => row.isLong).length
    };
}

function scoreNsmWeek(weekRows, weekStartDate) {
    const included = weekRows.filter(row => row.includeInNsm);
    const totalMinutes = sum(included.map(row => row.minutes));
    const subThreshold = included.filter(row => row.isSubThreshold);
    const easy = included.filter(row => row.isEasy);
    const longRuns = included.filter(row => row.isLong);
    const subThresholdMinutes = sum(subThreshold.map(row => row.subThresholdWorkMinutes ?? row.minutes));
    const subThresholdShare = totalMinutes > 0 ? subThresholdMinutes / totalMinutes : 0;
    const easyOverCap = easy.filter(row => row.easyOverCap).length;
    const easyDiscipline = easy.length ? 1 - (easyOverCap / easy.length) : 0;
    const target = NSM_WEEKLY_TARGETS;
    const shareMid = (target.subThresholdShareLow + target.subThresholdShareHigh) / 2;
    const shareDistance = Math.abs(subThresholdShare - shareMid);
    const shareScore = totalMinutes > 0 ? clamp(1 - (shareDistance / 0.18), 0, 1) : 0;
    const score = Math.round(
        clamp(subThreshold.length / target.subThresholdSessions, 0, 1) * 30
        + clamp(easy.length / target.easySessions, 0, 1) * 25
        + clamp(longRuns.length / target.longRuns, 0, 1) * 20
        + shareScore * 15
        + easyDiscipline * 10
    );

    let label = 'Needs structure';
    if (score >= 82) label = 'NSM aligned';
    else if (score >= 65) label = 'Close';
    else if (score >= 45) label = 'Partial';

    return {
        week: weekStartDate,
        score,
        label,
        runCount: included.length,
        totalMinutes,
        totalDistance: sum(included.map(row => row.distanceKm)),
        subThresholdSessions: subThreshold.length,
        subThresholdMinutes,
        subThresholdShare,
        easySessions: easy.length,
        easyOverCap,
        easyDiscipline,
        longRuns: longRuns.length,
        raceTests: included.filter(row => row.isRaceTest).length
    };
}

function buildNsmEasyDiscipline(easyRows, easyHrCap, hrMaxValue) {
    const validHrRows = easyRows
        .filter(row => Number.isFinite(row.avgHr) && row.avgHr > 0)
        .map(row => ({
            activityId: row.activityId,
            date: row.date,
            week: row.week,
            name: row.name,
            distanceKm: row.distanceKm,
            pace: row.pace,
            avgHr: row.avgHr,
            easyHrMargin: row.avgHr - easyHrCap,
            easyHrPctMax: hrMaxValue > 0 ? row.avgHr / hrMaxValue : null,
            easyOverCap: row.easyOverCap
        }));
    const hrPcts = validHrRows.map(row => row.easyHrPctMax).filter(Number.isFinite);
    const paces = easyRows.map(row => row.pace).filter(Number.isFinite);
    const weeklyMap = new Map();
    easyRows.forEach(row => {
        if (!row.week) return;
        const entry = weeklyMap.get(row.week) || { week: row.week, total: 0, underCap: 0, overCap: 0, unknownHr: 0 };
        entry.total += 1;
        if (!Number.isFinite(row.avgHr) || row.avgHr <= 0) entry.unknownHr += 1;
        else if (row.easyOverCap) entry.overCap += 1;
        else entry.underCap += 1;
        weeklyMap.set(row.week, entry);
    });

    return {
        runs: easyRows.length,
        overCap: easyRows.filter(row => row.easyOverCap).length,
        overCapRate: easyRows.length ? easyRows.filter(row => row.easyOverCap).length / easyRows.length : null,
        capBpm: easyHrCap,
        hrValidRuns: validHrRows.length,
        avgHr: average(validHrRows.map(row => row.avgHr)),
        avgHrPctMax: hrMaxValue > 0 ? average(validHrRows.map(row => row.avgHr / hrMaxValue)) : null,
        hrPctP25: percentile(hrPcts, 0.25),
        hrPctP50: percentile(hrPcts, 0.50),
        hrPctP75: percentile(hrPcts, 0.75),
        medianPace: median(paces),
        chartRows: validHrRows,
        weeklyCompliance: [...weeklyMap.values()].sort((a, b) => a.week.localeCompare(b.week))
    };
}

function estimateTimedRacePace(anchor, minutes) {
    if (!anchor || !Number.isFinite(anchor.timeSec) || !Number.isFinite(anchor.distanceKm)) return null;
    const targetSeconds = minutes * 60;
    const estimatedDistance = anchor.distanceKm * Math.pow(targetSeconds / anchor.timeSec, 1 / 1.06);
    return estimatedDistance > 0 ? targetSeconds / estimatedDistance : null;
}

function buildNsmSubThresholdControl(intervalAnalysis, intervalSummary = {}, input = {}, thresholdHrCap = null, isSubThreshold = false, avgHr = null) {
    if (!isSubThreshold) {
        return { status: 'controlled', flags: [], watchFlags: [], proxyOnly: false };
    }

    const source = intervalAnalysis?.source || 'activity_average';
    const hrOverlay = getNsmHrOverlay(intervalAnalysis);
    const hasStreamsHr = hrOverlay?.source === 'streams' && hrOverlay.hrConfidence === 'high';
    const flags = [];
    const watchFlags = [];
    const subjectiveFlags = [];
    const paceCv = Number.isFinite(intervalSummary.paceCv) ? intervalSummary.paceCv : null;
    const paceFadePct = Number.isFinite(intervalSummary.paceFadePct) ? intervalSummary.paceFadePct : null;
    const hrResponse = Number.isFinite(hrOverlay?.hrResponse) ? hrOverlay.hrResponse : null;
    const lateHrMetric = Number.isFinite(hrOverlay?.lateHrMetric) ? hrOverlay.lateHrMetric : null;
    const lateEndHr = Number.isFinite(hrOverlay?.lateEndHr) ? hrOverlay.lateEndHr : null;
    const lateSurge = Number.isFinite(hrOverlay?.lateSurge) ? hrOverlay.lateSurge : null;
    const lateHrForCap = Math.max(
        Number.isFinite(lateHrMetric) ? lateHrMetric : -Infinity,
        Number.isFinite(lateEndHr) ? lateEndHr : -Infinity
    );

    const paceUneven = Number.isFinite(paceCv) && paceCv > 0.06;
    if (paceUneven) watchFlags.push('pace CV high');
    const paceFade = Number.isFinite(paceFadePct) && paceFadePct > 0.035;
    if (paceFade) watchFlags.push('pace fade');

    if (Number.isFinite(input.nextDayScore) && input.nextDayScore >= 6) subjectiveFlags.push('next-day response high');
    if (Number.isFinite(input.rpe) && input.rpe >= 8) subjectiveFlags.push('RPE high');
    if (Number.isFinite(input.lactate) && input.lactate >= 4) subjectiveFlags.push('lactate high');
    if (Number.isFinite(input.painScore) && input.painScore >= 5) subjectiveFlags.push('pain high');

    let thresholdRisk = false;
    let hrRiseRisk = false;
    let lateSurgeRisk = false;
    if (hasStreamsHr) {
        thresholdRisk = Number.isFinite(thresholdHrCap) && Number.isFinite(lateHrForCap) && lateHrForCap > thresholdHrCap;
        hrRiseRisk = Number.isFinite(hrResponse) && hrResponse >= 6;
        lateSurgeRisk = Number.isFinite(lateSurge) && lateSurge >= 4;
        if (thresholdRisk) flags.push('late HR above threshold cap');
        if (hrRiseRisk) watchFlags.push('HR response high');
        if (lateSurgeRisk) watchFlags.push('late HR still rising');
    } else if (!intervalAnalysis && Number.isFinite(avgHr) && Number.isFinite(thresholdHrCap) && avgHr > thresholdHrCap) {
        watchFlags.push('activity HR proxy above cap');
    }

    subjectiveFlags.forEach(flag => watchFlags.push(flag));
    const combinedFlags = [...new Set([...flags, ...watchFlags])];
    const riskSignalCount = [
        thresholdRisk,
        hrRiseRisk,
        lateSurgeRisk,
        paceUneven,
        paceFade,
        ...subjectiveFlags.map(() => true)
    ].filter(Boolean).length;
    const overcooked = (thresholdRisk && riskSignalCount >= 2)
        || (hasStreamsHr && paceFade && hrRiseRisk)
        || subjectiveFlags.length >= 2
        || (subjectiveFlags.length >= 1 && (paceUneven || hrRiseRisk || thresholdRisk));

    if (overcooked) return { status: 'overcooked', flags: combinedFlags, watchFlags, proxyOnly: false };
    if (combinedFlags.length) return { status: 'watch', flags: combinedFlags, watchFlags, proxyOnly: false };

    const proxyOnly = !hasStreamsHr;
    return {
        status: proxyOnly ? 'proxy_only' : 'controlled',
        flags: proxyOnly ? ['HR proxy only'] : [],
        watchFlags: [],
        proxyOnly
    };
}

function buildNsmModel(model) {
    const settings = readNsmSettings();
    const manualTags = readNsmActivityTags();
    const sessionInputs = readNsmSessionInputs();
    const tests = readNsmTests().sort((a, b) => b.date.localeCompare(a.date));
    const hrMax = estimateNsmHrMax(model.runs);
    const easyHrCap = hrMax.value * settings.easyHrCapPct / 100;
    const thresholdHrCap = hrMax.value * settings.thresholdHrPct / 100;
    const weekContext = getWeekContext(model.runs);
    const context = { manualTags, weekContext, easyHrCap, thresholdHrCap };

    const rows = model.runs.map(run => {
        const activityId = getActivityKey(run);
        const classification = classifyNsmRun(run, context);
        const input = normalizeNsmSessionInput(sessionInputs[activityId] || {});
        const avgHr = Number(run.average_heartrate);
        const tag = classification.tag;
        const isSubThreshold = NSM_SUBT_TAGS.has(tag);
        const isEasy = tag === 'easy';
        const isLong = tag === 'long';
        const isRaceTest = tag === 'race_test';
        const easyOverCap = isEasy && Number.isFinite(avgHr) && avgHr > easyHrCap;
        const intervalAnalysis = isSubThreshold
            ? getNsmIntervalAnalysisForRow(run, activityId, input, tag)
            : null;
        const intervalSummary = intervalAnalysis?.summary || {};
        const hrOverlay = getNsmHrOverlay(intervalAnalysis);
        const subThresholdWorkMinutes = isSubThreshold
            ? (Number(intervalSummary.workMinutes) || estimateNsmFallbackWorkMinutes(run, tag, input))
            : 0;
        const control = buildNsmSubThresholdControl(intervalAnalysis, intervalSummary, input, thresholdHrCap, isSubThreshold, avgHr);
        const confidence = classification.source === 'manual'
            ? 'high'
            : isSubThreshold && intervalAnalysis
                ? intervalAnalysis.confidence
            : Number.isFinite(avgHr) && avgHr > 0
                ? 'medium'
                : 'low';
        return {
            activityId,
            run,
            date: dateKey(run),
            week: weekStart(dateKey(run)),
            name: run.name || 'Run',
            distanceKm: km(run),
            minutes: runMinutes(run),
            pace: paceSec(run),
            avgHr,
            easyHrMargin: isEasy && Number.isFinite(avgHr) ? avgHr - easyHrCap : null,
            easyHrPctMax: isEasy && Number.isFinite(avgHr) && hrMax.value > 0 ? avgHr / hrMax.value : null,
            subThresholdWorkMinutes,
            tag,
            autoTag: classification.autoTag,
            manualTag: classification.manualTag,
            includeInNsm: classification.includeInNsm,
            source: classification.source,
            confidence,
            input,
            intervalAnalysis,
            hrOverlay,
            isSubThreshold,
            isEasy,
            isLong,
            isRaceTest,
            easyOverCap,
            controlStatus: control.status,
            controlFlags: control.flags,
            overcookFlags: control.status === 'proxy_only' ? [] : control.flags
        };
    }).sort((a, b) => b.date.localeCompare(a.date));

    const weeklyMap = new Map();
    rows.forEach(row => {
        if (!row.week) return;
        weeklyMap.set(row.week, [...(weeklyMap.get(row.week) || []), row]);
    });
    const weekly = [...weeklyMap.entries()]
        .map(([week, weekRows]) => scoreNsmWeek(weekRows, week))
        .sort((a, b) => a.week.localeCompare(b.week));

    const lastDate = model.dateRange.end && model.dateRange.end !== '-' ? model.dateRange.end : rows[0]?.date;
    const recent7Start = lastDate ? addDays(lastDate, -6) : null;
    const recent28Start = lastDate ? addDays(lastDate, -27) : null;
    const blockStart = settings.currentBlockStart || model.dateRange.start;
    const blockEnd = settings.currentBlockEnd || model.dateRange.end;
    const recent7 = recent7Start && lastDate ? summarizePeriod(rows, recent7Start, lastDate) : summarizePeriod([], '', '');
    const recent28 = recent28Start && lastDate ? summarizePeriod(rows, recent28Start, lastDate) : summarizePeriod([], '', '');
    const block = blockStart && blockEnd && blockStart !== '-' && blockEnd !== '-' ? summarizePeriod(rows, blockStart, blockEnd) : summarizePeriod(rows, '', '9999-12-31');
    const latestWeek = weekly[weekly.length - 1] || null;
    const easyRows = rows.filter(row => row.includeInNsm && row.isEasy);
    const subThresholdRows = rows.filter(row => row.includeInNsm && row.isSubThreshold);
    const overcookedSubThreshold = subThresholdRows.filter(row => row.controlStatus === 'overcooked');
    const easyDiscipline = buildNsmEasyDiscipline(easyRows, easyHrCap, hrMax.value);
    const raceAnchors = [
        ...tests,
        ...model.raceLike.slice(0, 8).map(run => ({
            id: `activity-${getActivityKey(run)}`,
            date: dateKey(run),
            type: 'Activity',
            distanceKm: km(run),
            timeSec: Number(run.moving_time) || 0,
            sourceActivityId: getActivityKey(run),
            notes: run.name || 'Race-like activity'
        }))
    ].filter(anchor => Number.isFinite(anchor.distanceKm) && Number.isFinite(anchor.timeSec) && anchor.distanceKm > 0 && anchor.timeSec > 0)
        .sort((a, b) => b.date.localeCompare(a.date));
    const primaryAnchor = raceAnchors[0] || null;
    const timedAnchors = [60, 90, 120].map(minutes => ({
        minutes,
        paceSec: estimateTimedRacePace(primaryAnchor, minutes)
    }));

    const recommendations = [];
    if (model.diagnostics.tissueLoad.status.level === 'risk') recommendations.push('Reduce impact load before adding another NSM quality session.');
    if (recent7.subThresholdShare > NSM_WEEKLY_TARGETS.subThresholdShareHigh + 0.05) recommendations.push('Sub-threshold share is high; protect easy volume and recovery.');
    if (easyRows.length && easyRows.filter(row => row.easyOverCap).length / easyRows.length > 0.25) recommendations.push('Easy days are drifting above the easy HR cap.');
    if (overcookedSubThreshold.length) recommendations.push('Review overcooked sub-threshold sessions before raising pace anchors.');
    if (latestWeek && latestWeek.subThresholdSessions < 2) recommendations.push('Add repeatable sub-threshold exposure only if easy discipline and tissue load are stable.');
    if (!recommendations.length) recommendations.push('Hold the current NSM rhythm and use the next TT/race to update pace anchors.');

    return {
        settings,
        hrMax,
        easyHrCap,
        thresholdHrCap,
        rows,
        weekly,
        latestWeek,
        recent7,
        recent28,
        block,
        easyDiscipline,
        subThreshold: {
            sessions: subThresholdRows.length,
            overcooked: overcookedSubThreshold.length,
            rows: subThresholdRows,
            share: block.totalMinutes > 0 ? block.subThresholdMinutes / block.totalMinutes : 0
        },
        tests,
        raceAnchors,
        primaryAnchor,
        timedAnchors,
        recommendations,
        dataTrust: {
            hrCoverage: model.runs.length ? model.hrRuns.length / model.runs.length : 0,
            manualTagged: rows.filter(row => row.source === 'manual').length,
            intervalAnalyzed: subThresholdRows.filter(row => ['laps', 'streams'].includes(row.intervalAnalysis?.source)).length,
            totalRows: rows.length
        }
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
    if (confidence === 'missing' || confidence === 'proxy' || confidence === 'unavailable') return 'run-plus-pill--muted';
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

function getRunPlusSubview() {
    const path = typeof window !== 'undefined' ? window.location.pathname.replace(/\/$/, '') : '/run-plus';
    return path === '/run-plus/nsm' ? 'nsm' : 'overview';
}

function renderRunPlusSubviewNav(activeSubview) {
    const items = [
        ['overview', 'Overview', '/run-plus'],
        ['nsm', 'NSM', '/run-plus/nsm']
    ];
    return `
        <nav class="run-plus-subnav" aria-label="Run Plus views">
            ${items.map(([key, label, href]) => `
                <button class="run-plus-subnav__item ${activeSubview === key ? 'active' : ''}" data-run-plus-subview="${key}" data-href="${href}" type="button">
                    ${esc(label)}
                </button>
            `).join('')}
        </nav>
    `;
}

function formatNsmHours(minutes) {
    const value = Number(minutes) || 0;
    if (value > 0 && value < 6) return `${Math.round(value)} min`;
    return `${(value / 60).toFixed(1)} h`;
}

function formatNsmDistance(kilometers) {
    return `${safeFixed(kilometers, 1)} km`;
}

function nsmTagLabel(tag) {
    return (NSM_TAG_OPTIONS.find(option => option[0] === tag) || ['other', 'Other'])[1];
}

function nsmTemplateLabel(template) {
    return (NSM_TEMPLATE_OPTIONS.find(option => option[0] === template) || ['auto', 'Auto'])[1];
}

function nsmIntervalSourceLabel(source) {
    if (source === 'manual') return 'Manual';
    if (source === 'laps') return 'Laps';
    if (source === 'streams') return 'Streams structure';
    return 'Activity avg';
}

function nsmTagPillClass(tag) {
    if (NSM_SUBT_TAGS.has(tag)) return 'run-plus-pill--warn';
    if (tag === 'easy') return 'run-plus-pill--good';
    if (tag === 'long' || tag === 'race_test') return 'run-plus-pill--muted';
    if (tag === 'excluded') return 'run-plus-pill--risk';
    return 'run-plus-pill--muted';
}

function nsmScorePillClass(score) {
    if (score >= 82) return 'run-plus-pill--good';
    if (score >= 55) return 'run-plus-pill--warn';
    return 'run-plus-pill--risk';
}

function nsmIntervalSourcePillClass(source) {
    if (source === 'laps' || source === 'streams') return 'run-plus-pill--good';
    if (source === 'manual') return 'run-plus-pill--warn';
    return 'run-plus-pill--muted';
}

function nsmControlLabel(status) {
    if (status === 'overcooked') return 'overcooked';
    if (status === 'watch') return 'watch';
    if (status === 'proxy_only') return 'proxy only';
    return 'controlled';
}

function nsmControlPillClass(status) {
    if (status === 'overcooked') return 'run-plus-pill--risk';
    if (status === 'watch') return 'run-plus-pill--warn';
    if (status === 'proxy_only') return 'run-plus-pill--muted';
    return 'run-plus-pill--good';
}

function getNsmRowHrOverlay(row) {
    return row?.hrOverlay || getNsmHrOverlay(row?.intervalAnalysis);
}

function formatNsmHrSource(row) {
    if (!row?.isSubThreshold) {
        return Number.isFinite(row?.avgHr) ? 'Activity HR' : 'No HR';
    }
    const overlay = getNsmRowHrOverlay(row);
    if (overlay?.source === 'streams') {
        return overlay.hrConfidence === 'high' ? 'streams HR' : `streams HR ${overlay.hrConfidence}`;
    }
    if (row?.intervalAnalysis?.source === 'manual') return 'manual proxy';
    return 'needs streams';
}

function formatNsmHrResponse(row) {
    const overlay = getNsmRowHrOverlay(row);
    if (overlay?.source === 'streams') {
        return Number.isFinite(overlay.hrResponse) ? `${formatSigned(overlay.hrResponse, 1)} bpm` : 'unavailable';
    }
    return 'needs streams';
}

function formatNsmHrMetric(row) {
    const overlay = getNsmRowHrOverlay(row);
    if (overlay?.source !== 'streams') return 'needs streams';
    if (!overlay.hrMetricUsed) return 'unavailable';
    const range = overlay.earlyRepRange && overlay.lateRepRange
        ? ` · reps ${overlay.earlyRepRange}→${overlay.lateRepRange}`
        : '';
    return `${overlay.hrMetricUsed}${range}`;
}

function formatNsmRecoveryDrop(row) {
    const overlay = getNsmRowHrOverlay(row);
    if (overlay?.source !== 'streams') return 'needs streams';
    const value = overlay.recoveryHrDrop;
    return Number.isFinite(value) ? `${value.toFixed(1)} bpm` : '-';
}

function formatNsmCombinedIntervalSource(row) {
    const structureSource = nsmIntervalSourceLabel(row?.intervalAnalysis?.source);
    const overlay = getNsmRowHrOverlay(row);
    if (overlay?.source === 'streams' && row?.intervalAnalysis?.source !== 'streams') return `${structureSource} / HR streams`;
    return structureSource;
}

function hasNsmNoUsableLapsWarning(row) {
    return row?.intervalAnalysis?.warnings?.some(warning => /No usable laps/i.test(warning));
}

function renderNsmRegistryAnalysisCell(row) {
    if (!row.isSubThreshold) {
        const hasHr = Number.isFinite(row.avgHr);
        return `
            <div class="run-plus-nsm-analysis-cell">
                <span class="run-plus-pill ${hasHr ? 'run-plus-pill--good' : 'run-plus-pill--muted'}">${hasHr ? 'Activity HR' : 'No HR'}</span>
                ${hasHr ? `<span class="run-plus-pill run-plus-pill--muted">${Math.round(row.avgHr)} bpm</span>` : ''}
                <span class="run-plus-pill run-plus-pill--muted">Not interval</span>
            </div>
        `;
    }

    const overlay = getNsmRowHrOverlay(row);
    const hrConfidence = overlay?.hrConfidence || 'unavailable';
    return `
        <div class="run-plus-nsm-analysis-cell">
            <span class="run-plus-pill ${nsmIntervalSourcePillClass(row.intervalAnalysis?.source)}">${esc(nsmIntervalSourceLabel(row.intervalAnalysis?.source))}</span>
            <span class="run-plus-pill ${pillClassForConfidence(row.intervalAnalysis?.confidence || row.confidence)}">${esc(row.intervalAnalysis?.confidence || row.confidence)}</span>
            <span class="run-plus-pill ${pillClassForConfidence(hrConfidence)}">HR ${esc(hrConfidence)}</span>
            ${hasNsmNoUsableLapsWarning(row) ? '<span class="run-plus-pill run-plus-pill--muted">No usable laps</span>' : ''}
            ${row.run?.id ? `<button type="button" class="run-plus-nsm-link-button" data-nsm-analyze-intervals="${esc(row.activityId)}">Analyze intervals</button>` : ''}
            ${row.run?.id ? `<button type="button" class="run-plus-nsm-link-button" data-nsm-analyze-streams="${esc(row.activityId)}">Deep HR analysis</button>` : ''}
        </div>
    `;
}

function renderNsmMetric(label, value, detail, level = 'muted') {
    return `
        <article class="run-plus-nsm-metric run-plus-tissue-card--${esc(level)}">
            <span>${esc(label)}</span>
            <strong>${esc(value)}</strong>
            <small>${esc(detail)}</small>
        </article>
    `;
}

function renderNsmSettingsForm(nsm) {
    const easyPct = clamp(Number(nsm.settings.easyHrCapPct) || NSM_DEFAULT_SETTINGS.easyHrCapPct, 50, 85);
    const thresholdPct = clamp(Math.max(easyPct + 1, Number(nsm.settings.thresholdHrPct) || NSM_DEFAULT_SETTINGS.thresholdHrPct), 75, 95);
    const hardPct = Math.max(0, 100 - thresholdPct);
    const subtPct = Math.max(1, thresholdPct - easyPct);
    return `
        <form class="run-plus-nsm-settings" id="${runPlusId('nsm-settings-form')}">
            <div class="nsm-settings-groups">
                <div class="nsm-settings-group">
                    <div class="nsm-settings-group__header">
                        <span class="nsm-settings-group__icon">🫀</span>
                        <span class="nsm-settings-group__title">Heart Rate Zones</span>
                    </div>
                    <div class="nsm-settings-group__fields">
                        <label>
                            <span>Easy HR cap (%)</span>
                            <input name="easyHrCapPct" type="number" min="50" max="85" step="1" value="${esc(nsm.settings.easyHrCapPct)}">
                        </label>
                        <label>
                            <span>Threshold HR cap (%)</span>
                            <input name="thresholdHrPct" type="number" min="75" max="95" step="1" value="${esc(nsm.settings.thresholdHrPct)}">
                        </label>
                        <div class="nsm-hr-zone-preview" title="HR zone distribution based on current settings">
                            <div class="nsm-hr-zone-preview__segment nsm-hr-zone-preview__segment--easy" style="flex:${easyPct}">Easy ≤${easyPct}%</div>
                            <div class="nsm-hr-zone-preview__segment nsm-hr-zone-preview__segment--subt" style="flex:${subtPct}">SubT ${easyPct}–${thresholdPct}%</div>
                            <div class="nsm-hr-zone-preview__segment nsm-hr-zone-preview__segment--hard" style="flex:${hardPct}">${thresholdPct}%+</div>
                        </div>
                    </div>
                </div>
                <div class="nsm-settings-group">
                    <div class="nsm-settings-group__header">
                        <span class="nsm-settings-group__icon">📅</span>
                        <span class="nsm-settings-group__title">Training Block</span>
                    </div>
                    <div class="nsm-settings-group__fields">
                        <label>
                            <span>Block start</span>
                            <input name="currentBlockStart" type="date" value="${esc(nsm.settings.currentBlockStart)}">
                        </label>
                        <label>
                            <span>Block end</span>
                            <input name="currentBlockEnd" type="date" value="${esc(nsm.settings.currentBlockEnd)}">
                        </label>
                        <label>
                            <span>Target race</span>
                            <input name="targetRace" type="text" maxlength="80" value="${esc(nsm.settings.targetRace)}" placeholder="Optional">
                        </label>
                    </div>
                </div>
                <div class="nsm-settings-group">
                    <div class="nsm-settings-group__header">
                        <span class="nsm-settings-group__icon">📋</span>
                        <span class="nsm-settings-group__title">Session Config</span>
                    </div>
                    <div class="nsm-settings-group__fields">
                        <label>
                            <span>Weekly template</span>
                            <select name="weeklyTemplate">
                                <option value="standard" ${nsm.settings.weeklyTemplate === 'standard' ? 'selected' : ''}>Standard</option>
                                <option value="intro" ${nsm.settings.weeklyTemplate === 'intro' ? 'selected' : ''}>Intro</option>
                                <option value="marathon" ${nsm.settings.weeklyTemplate === 'marathon' ? 'selected' : ''}>Marathon</option>
                            </select>
                        </label>
                    </div>
                </div>
            </div>
            <div class="run-plus-nsm-actions">
                <button type="submit">Save settings</button>
                <button type="button" id="${runPlusId('nsm-settings-reset')}">Reset</button>
            </div>
        </form>
    `;
}

function nsmScoreColor(score) {
    if (score >= 82) return '#16a34a';
    if (score >= 55) return '#f59e0b';
    return '#dc2626';
}

function nsmScoreLevel(score) {
    if (score >= 82) return 'good';
    if (score >= 55) return 'warn';
    return 'risk';
}

function nsmHeroRingSvg(score) {
    const r = 45;
    const circumference = 2 * Math.PI * r;
    const offset = circumference - (Math.min(score, 100) / 100) * circumference;
    const color = nsmScoreColor(score);
    return `
        <div class="nsm-hero-ring">
            <svg viewBox="0 0 100 100">
                <circle class="nsm-hero-ring__track" cx="50" cy="50" r="${r}" />
                <circle class="nsm-hero-ring__fill" cx="50" cy="50" r="${r}"
                    stroke="${color}"
                    stroke-dasharray="${circumference}"
                    style="--nsm-ring-circumference:${circumference};--nsm-ring-target:${offset}" />
            </svg>
            <div class="nsm-hero-ring__label">
                <span class="nsm-hero-ring__score">${score}</span>
                <span class="nsm-hero-ring__sub" style="color:${color}">/100</span>
            </div>
        </div>
    `;
}

function formatNsmRangeLabel(startDate, endDate) {
    if (!startDate || !endDate || startDate === '-' || endDate === '-') return 'active range';
    return startDate === endDate ? startDate : `${startDate} to ${endDate}`;
}

function renderNsmCommandCenter(model) {
    const nsm = model.nsm;
    const latestScore = nsm.latestWeek?.score ?? 0;
    const latestLevel = nsmScoreLevel(latestScore);
    const latestLabel = nsm.latestWeek?.label || 'No data';
    const easyLevel = nsm.easyDiscipline.overCapRate == null ? 'muted' : nsm.easyDiscipline.overCapRate <= 0.12 ? 'good' : nsm.easyDiscipline.overCapRate <= 0.25 ? 'warn' : 'risk';
    const subTLevel = nsm.recent7.subThresholdShare <= NSM_WEEKLY_TARGETS.subThresholdShareHigh + 0.05 ? 'good' : 'warn';
    const tissueLevel = model.diagnostics.tissueLoad.status.level;
    const activeRange = formatNsmRangeLabel(model.dateRange.start, model.dateRange.end);
    const latestDate = model.dateRange.end && model.dateRange.end !== '-' ? model.dateRange.end : '';
    const recent7Range = latestDate ? formatNsmRangeLabel(addDays(latestDate, -6), latestDate) : activeRange;
    const blockStart = nsm.settings.currentBlockStart || model.dateRange.start;
    const blockEnd = nsm.settings.currentBlockEnd || model.dateRange.end;
    const blockRange = formatNsmRangeLabel(blockStart, blockEnd);

    return `
        <section class="nsm-hero-section">
            <div class="nsm-hero-top">
                <div class="nsm-hero-ring-wrap">
                    ${nsmHeroRingSvg(latestScore)}
                </div>
                <div class="nsm-hero-info">
                    <span class="run-plus-kicker">Run Plus · Norwegian Singles Method</span>
                    <h2 style="margin:0.3rem 0 0.5rem;color:var(--color-text-dark);font-size:1.65rem;line-height:1.15">NSM Training Control</h2>
                    <p style="margin:0;color:var(--color-text-medium);line-height:1.55;max-width:760px">Tracks whether the active run history is matching a repeatable sub-threshold rhythm: controlled quality work, truly easy recovery, sustainable impact load, and measurable progress.</p>
                    <div class="nsm-verdict nsm-verdict--${latestLevel}">
                        ${latestLevel === 'good' ? '✅' : latestLevel === 'warn' ? '⚠️' : '🔴'} ${esc(latestLabel)}
                    </div>
                </div>
            </div>
            <div class="nsm-stat-strip">
                <div class="nsm-stat-primary nsm-stat-primary--subt">
                    <span class="nsm-stat-primary__label"><span class="nsm-tooltip" data-tooltip="Sub-threshold sessions in the last 7 days (${esc(recent7Range)})">SubT Sessions · Last 7d</span></span>
                    <span class="nsm-stat-primary__value">${nsm.recent7.subThresholdSessions} SubT / ${nsm.recent7.easyRuns} easy</span>
                    <span class="nsm-stat-primary__detail">${formatNsmHours(nsm.recent7.totalMinutes)} total · work share ${percentLabel(nsm.recent7.subThresholdShare)}</span>
                </div>
                <div class="nsm-stat-primary nsm-stat-primary--easy">
                    <span class="nsm-stat-primary__label"><span class="nsm-tooltip" data-tooltip="Percentage of easy runs exceeding the HR cap in the current filtered range (${esc(activeRange)})">Easy Discipline · Filtered</span></span>
                    <span class="nsm-stat-primary__value">${nsm.easyDiscipline.overCapRate == null ? '-' : `${percentLabel(nsm.easyDiscipline.overCapRate)} over cap`}</span>
                    <span class="nsm-stat-primary__detail">Cap ${Math.round(nsm.easyDiscipline.capBpm)} bpm · ${nsm.easyDiscipline.runs} easy runs</span>
                </div>
                <div class="nsm-stat-primary nsm-stat-primary--load">
                    <span class="nsm-stat-primary__label"><span class="nsm-tooltip" data-tooltip="Sub-threshold sessions flagged as overcooked in the current filtered range (${esc(activeRange)})">SubT Control · Filtered</span></span>
                    <span class="nsm-stat-primary__value">${nsm.subThreshold.overcooked} overcooked</span>
                    <span class="nsm-stat-primary__detail">${nsm.dataTrust.intervalAnalyzed}/${nsm.subThreshold.sessions} parsed from laps/streams</span>
                </div>
                <div class="nsm-stat-primary nsm-stat-primary--quality">
                    <span class="nsm-stat-primary__label"><span class="nsm-tooltip" data-tooltip="Share of total training hours that is sub-threshold quality work in the current block (${esc(blockRange)})">Block Quality · Block</span></span>
                    <span class="nsm-stat-primary__value">${percentLabel(nsm.block.subThresholdShare)} quality</span>
                    <span class="nsm-stat-primary__detail">${formatNsmHours(nsm.block.subThresholdMinutes)} / ${formatNsmHours(nsm.block.totalMinutes)} · ${nsm.block.runs} runs</span>
                </div>
            </div>
            <div class="nsm-stat-secondary-row">
                <span class="nsm-stat-secondary">📊 <strong>${formatNsmHours(nsm.recent28.subThresholdMinutes)}</strong> SubT work (28d)</span>
                <span class="nsm-stat-secondary">🏃 <strong>${nsm.recent28.longRuns}</strong> long runs (28d)</span>
                <span class="nsm-stat-secondary">⏱ <strong>${formatNsmHours(nsm.recent28.totalMinutes)}</strong> total (28d)</span>
                <span class="nsm-stat-secondary ${pillClassForConfidence(model.diagnostics.aerobicEfficiency.confidence)}">💓 HR coverage ${percentLabel(nsm.dataTrust.hrCoverage)}</span>
                <span class="nsm-stat-secondary">HRmax <strong>${Math.round(nsm.hrMax.value)}</strong> bpm · ${esc(nsm.hrMax.source)}</span>
                <span class="nsm-stat-secondary">🎯 ${esc(nsm.recommendations[0])}</span>
            </div>
            <details class="run-plus-nsm-config">
                <summary>⚙️ NSM local settings</summary>
                ${renderNsmSettingsForm(nsm)}
            </details>
        </section>
    `;
}

function renderNsmWeeklyScore(model) {
    const rows = model.nsm.weekly.slice(-16).reverse();
    const currentWeek = rows.length ? rows[0].week : null;
    return `
        <section class="run-plus-module run-plus-module--wide nsm-section-animated">
            <div class="run-plus-module-panel">
                <h3>Weekly Method Score</h3>
                <p class="run-plus-chart-caption">Quality share uses parsed SubT work minutes when available. Activity-average rows are low-confidence proxies and no longer count the full workout as SubT work.</p>
                <div class="nsm-weekly-chart-card">
                    <h4>Score & Volume Trend</h4>
                    <canvas id="${runPlusId('nsm-weekly-score-chart')}"></canvas>
                </div>
                <div class="run-plus-table-wrap">
                    <table class="compact-table run-plus-nsm-table">
                        <thead>
                            <tr>
                                <th>Week</th><th>Score</th><th>Total hours</th><th>SubT</th><th>SubT work</th><th>Easy</th><th>Long</th><th>Quality share</th><th>Easy cap</th><th>Volume</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr class="${row.week === currentWeek ? 'nsm-week-row--current' : ''}">
                                    <td>${esc(row.week)}</td>
                                    <td><span class="run-plus-pill ${nsmScorePillClass(row.score)}">${row.score} · ${esc(row.label)}</span></td>
                                    <td>${formatNsmHours(row.totalMinutes)}</td>
                                    <td>${row.subThresholdSessions}</td>
                                    <td>${formatNsmHours(row.subThresholdMinutes)}</td>
                                    <td>${row.easySessions}</td>
                                    <td>${row.longRuns}</td>
                                    <td>${percentLabel(row.subThresholdShare)}</td>
                                    <td>${row.easySessions ? `${row.easyOverCap}/${row.easySessions} over` : '-'}</td>
                                    <td>${formatNsmDistance(row.totalDistance)}</td>
                                </tr>
                            `).join('') || '<tr><td colspan="10"><div class="nsm-empty-state"><span class="nsm-empty-state__icon">📊</span><span class="nsm-empty-state__title">No weekly data</span><span class="nsm-empty-state__text">No weekly runs in the active filter.</span></div></td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    `;
}

function renderNsmSubthresholdWorkbench(model) {
    const rows = model.nsm.subThreshold.rows.slice(0, 24);
    const controlBadge = (status, flags) => {
        const icon = status === 'overcooked' ? '🔴' : status === 'watch' ? '⚠️' : status === 'proxy_only' ? '📊' : '✅';
        const cls = status === 'overcooked' ? 'overcooked' : status === 'watch' ? 'watch' : status === 'proxy_only' ? 'proxy' : 'controlled';
        return `<span class="nsm-control-badge nsm-control-badge--${cls}" title="${esc(flags.join(', '))}">${icon} ${esc(nsmControlLabel(status))}</span>`;
    };
    return `
        <section class="run-plus-module run-plus-module--wide nsm-section-animated">
            <div class="run-plus-module-panel">
                <h3>Subthreshold Workbench</h3>
                <p class="run-plus-chart-caption">Unless manual work metrics are entered, SubT rows use Strava laps first for reps, work time, work pace, and pace consistency. Deep HR analysis adds on-demand streams for HR response and recovery; activity-average proxies are last-resort fallbacks.</p>
                <div class="nsm-subt-charts">
                    <article class="nsm-subt-chart-card">
                        <h4>SubT Work Pace Trend</h4>
                        <p>Work-rep pace per parsed SubT session. Lower min/km is faster; compare similar workout families and read it alongside HR response.</p>
                        <canvas id="${runPlusId('nsm-subt-pace-chart')}"></canvas>
                    </article>
                    <article class="nsm-subt-chart-card">
                        <h4>HR Response Trend</h4>
                        <p>Early-to-late rep HR response from Deep HR analysis. Below +6 bpm is controlled; rising trend suggests accumulating fatigue.</p>
                        <canvas id="${runPlusId('nsm-subt-hr-response-chart')}"></canvas>
                    </article>
                </div>
                <div class="run-plus-table-wrap">
                    <table class="compact-table run-plus-nsm-table">
                        <thead>
                            <tr><th>Date</th><th>Activity</th><th>Type</th><th>Source</th><th>Work</th><th>Work pace</th><th>Work HR</th><th>Pace consistency</th><th>HR source</th><th>RPE</th><th>Lactate</th><th>Control</th></tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => {
                                const overcookedCallout = row.controlStatus === 'overcooked' && row.controlFlags.length
                                    ? `</tr><tr><td colspan="12"><div class="nsm-overcooked-callout"><strong>⚠ Overcooked flags:</strong> ${esc(row.controlFlags.join(' · '))}</div></td>`
                                    : '';
                                return `
                                <tr class="nsm-row--subt">
                                    <td>${esc(row.date)}</td>
                                    <td>${row.run?.id ? `<a href="/html/activity-router.html?id=${encodeURIComponent(row.run.id)}" target="_blank" rel="noopener noreferrer">${esc(row.name)}</a>` : esc(row.name)}</td>
                                    <td><span class="run-plus-pill ${nsmTagPillClass(row.tag)}">${esc(nsmTagLabel(row.tag))}</span></td>
                                    <td>
                                        <span class="run-plus-pill ${nsmIntervalSourcePillClass(row.intervalAnalysis?.source)}">${esc(formatNsmCombinedIntervalSource(row))}</span>
                                        <span class="run-plus-pill ${pillClassForConfidence(row.intervalAnalysis?.confidence || row.confidence)}">${esc(row.intervalAnalysis?.confidence || row.confidence)}</span>
                                    </td>
                                    <td>${formatNsmHours(row.subThresholdWorkMinutes)}</td>
                                    <td>${row.intervalAnalysis?.summary?.avgWorkPaceSec ? paceLabel(row.intervalAnalysis.summary.avgWorkPaceSec) : paceLabel(row.pace)}</td>
                                    <td>${Number.isFinite(row.intervalAnalysis?.summary?.avgWorkHr) ? `${Math.round(row.intervalAnalysis.summary.avgWorkHr)} bpm` : Number.isFinite(row.avgHr) ? `${Math.round(row.avgHr)} bpm` : '-'}</td>
                                    <td>${Number.isFinite(row.intervalAnalysis?.summary?.paceCv) ? `${(row.intervalAnalysis.summary.paceCv * 100).toFixed(1)}% CV` : '-'}</td>
                                    <td>${esc(formatNsmHrSource(row))}</td>
                                    <td>${Number.isFinite(row.input.rpe) ? row.input.rpe : '-'}</td>
                                    <td>${Number.isFinite(row.input.lactate) ? row.input.lactate.toFixed(1) : '-'}</td>
                                    <td>${controlBadge(row.controlStatus, row.controlFlags)}</td>
                                ${overcookedCallout}</tr>
                            `}).join('') || '<tr><td colspan="12"><div class="nsm-empty-state"><span class="nsm-empty-state__icon">🏃‍♂️</span><span class="nsm-empty-state__title">No sub-threshold sessions</span><span class="nsm-empty-state__text">No sub-threshold sessions detected. Use the registry below to tag NSM workouts.</span></div></td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    `;
}

function renderNsmIntervalAnalysis(model) {
    const rows = model.nsm.subThreshold.rows
        .filter(row => row.intervalAnalysis && row.intervalAnalysis.source !== 'activity_average')
        .slice(0, 12);

    const hrGauge = (value) => {
        if (!Number.isFinite(value)) return '<span style="color:var(--color-text-light)">needs streams</span>';
        const absVal = Math.abs(value);
        const level = absVal <= 5 ? 'good' : absVal <= 8 ? 'warn' : 'risk';
        const pct = Math.min(absVal / 12 * 100, 100);
        return `<div class="nsm-hr-gauge"><div class="nsm-hr-gauge__bar"><div class="nsm-hr-gauge__fill nsm-hr-gauge__fill--${level}" style="width:${pct}%"></div></div><span class="nsm-hr-gauge__value">${formatSigned(value, 1)}</span></div>`;
    };

    const confidenceDots = (level) => {
        const map = { high: 4, medium: 3, low: 2, unavailable: 0 };
        const filled = map[level] || 0;
        return `<span class="nsm-confidence-dots">${Array.from({length: 4}, (_, i) => `<span class="nsm-confidence-dot ${i < filled ? 'nsm-confidence-dot--filled' : ''}"></span>`).join('')}</span>`;
    };

    return `
        <section class="run-plus-module run-plus-module--wide nsm-section-animated">
            <div class="run-plus-module-panel">
                <h3>SubT Interval Analysis</h3>
                <p class="run-plus-chart-caption">Parsed work reps are used for SubT progress and cost checks. Recovery and warmup/cooldown remain part of total load, but not SubT work minutes.</p>
                <div class="run-plus-table-wrap">
                    <table class="compact-table run-plus-nsm-table">
                        <thead>
                            <tr><th>Date</th><th>Workout</th><th>Source</th><th>Reps</th><th>Work time</th><th>Work pace</th><th>Work HR</th><th>HR response</th><th>HR metric</th><th>Recovery drop</th><th>Confidence</th><th>Notes</th></tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => {
                                const summary = row.intervalAnalysis.summary || {};
                                const overlay = getNsmRowHrOverlay(row);
                                const hrResponse = overlay?.source === 'streams' && Number.isFinite(overlay.hrResponse) ? overlay.hrResponse : null;
                                const recoveryDrop = formatNsmRecoveryDrop(row);
                                const recoveryArrow = recoveryDrop !== 'needs streams' && recoveryDrop !== '-'
                                    ? (parseFloat(recoveryDrop) >= 10 ? '<span style="color:#16a34a">↓</span>' : '<span style="color:#dc2626">↑</span>')
                                    : '';
                                return `
                                    <tr class="nsm-row--subt">
                                        <td>${esc(row.date)}</td>
                                        <td>${row.run?.id ? `<a href="/html/activity-router.html?id=${encodeURIComponent(row.run.id)}" target="_blank" rel="noopener noreferrer">${esc(row.name)}</a>` : esc(row.name)}</td>
                                        <td><span class="run-plus-pill ${nsmIntervalSourcePillClass(row.intervalAnalysis.source)}">${esc(formatNsmCombinedIntervalSource(row))}</span></td>
                                        <td>${summary.workSegments || '-'}</td>
                                        <td>${formatNsmHours(summary.workMinutes)}</td>
                                        <td>${summary.avgWorkPaceSec ? paceLabel(summary.avgWorkPaceSec) : '-'}</td>
                                        <td>${Number.isFinite(summary.avgWorkHr) ? `${Math.round(summary.avgWorkHr)} bpm` : '-'}</td>
                                        <td>${hrGauge(hrResponse)}</td>
                                        <td>${esc(formatNsmHrMetric(row))}</td>
                                        <td>${recoveryArrow} ${esc(recoveryDrop)}</td>
                                        <td>${confidenceDots(overlay?.hrConfidence || summary.hrConfidence || 'unavailable')}</td>
                                        <td>${row.intervalAnalysis.warnings?.length ? esc(row.intervalAnalysis.warnings.join('; ')) : esc(nsmTemplateLabel(row.input.template))}</td>
                                    </tr>
                                `;
                            }).join('') || '<tr><td colspan="12"><div class="nsm-empty-state"><span class="nsm-empty-state__icon">🔬</span><span class="nsm-empty-state__title">No interval analysis</span><span class="nsm-empty-state__text">No interval-level SubT analysis yet. Use Analyze intervals in the Session Registry.</span></div></td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    `;
}

function renderNsmEasyDiscipline(model) {
    const easyRows = model.nsm.rows.filter(row => row.includeInNsm && row.isEasy).slice(0, 24);
    const easy = model.nsm.easyDiscipline;
    return `
        <section class="run-plus-module run-plus-module--wide nsm-section-animated">
            <div class="run-plus-module-panel">
                <h3>Easy Discipline</h3>
                <div class="run-plus-nsm-split">
                    <div>
                        <p class="run-plus-chart-caption">Easy cap is ${Math.round(model.nsm.easyHrCap)} bpm (${model.nsm.settings.easyHrCapPct}% of HRmax). Runs above that cap are not automatically bad, but they weaken the repeatable NSM rhythm when they become common.</p>
                        <div class="run-plus-nsm-mini-grid">
                            ${renderNsmMetric('Easy runs', `${easy.runs}`, `${easy.overCap} over cap · ${easy.hrValidRuns} HR-valid`, easy.overCap ? 'warn' : 'good')}
                            ${renderNsmMetric('Avg easy HR', Number.isFinite(easy.avgHr) ? `${Math.round(easy.avgHr)} bpm` : '-', Number.isFinite(easy.avgHrPctMax) ? `${nsmHrPercentLabel(easy.avgHrPctMax)} of HRmax` : 'Needs HR data', Number.isFinite(easy.avgHrPctMax) && easy.avgHrPctMax <= model.nsm.settings.easyHrCapPct / 100 ? 'good' : 'warn')}
                            ${renderNsmMetric('HR% distribution', Number.isFinite(easy.hrPctP50) ? `P50 ${nsmHrPercentLabel(easy.hrPctP50)}` : '-', Number.isFinite(easy.hrPctP25) ? `P25 ${nsmHrPercentLabel(easy.hrPctP25)} · P75 ${nsmHrPercentLabel(easy.hrPctP75)}` : 'No HR distribution', 'muted')}
                            ${renderNsmMetric('Median easy pace', Number.isFinite(easy.medianPace) ? paceLabel(easy.medianPace) : '-', `Cap source ${Math.round(model.nsm.hrMax.value)} bpm · ${model.nsm.hrMax.source}`, 'muted')}
                        </div>
                    </div>
                    <div class="run-plus-table-wrap nsm-easy-runs-table-wrap">
                        <table class="compact-table run-plus-nsm-table nsm-easy-runs-table">
                            <thead><tr><th>Date</th><th>Activity</th><th>Distance</th><th>Pace</th><th>HR</th><th>HR%max</th><th>Status</th></tr></thead>
                            <tbody>
                                ${easyRows.map(row => `
                                    <tr class="nsm-row--easy">
                                        <td>${esc(row.date)}</td>
                                        <td>${esc(row.name)}</td>
                                        <td>${formatNsmDistance(row.distanceKm)}</td>
                                        <td>${paceLabel(row.pace)}</td>
                                        <td>${Number.isFinite(row.avgHr) ? `${Math.round(row.avgHr)} bpm` : '-'}</td>
                                        <td>${Number.isFinite(row.easyHrPctMax) ? nsmHrPercentLabel(row.easyHrPctMax) : '-'}</td>
                                        <td>${row.easyOverCap ? '<span class="run-plus-pill run-plus-pill--warn">over cap</span>' : '<span class="run-plus-pill run-plus-pill--good">easy</span>'}</td>
                                    </tr>
                                `).join('') || '<tr><td colspan="7"><div class="nsm-empty-state"><span class="nsm-empty-state__icon">🏃</span><span class="nsm-empty-state__title">No easy runs</span><span class="nsm-empty-state__text">No easy runs detected in the active filter.</span></div></td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="run-plus-nsm-chart-grid">
                    <article class="run-plus-nsm-chart-card">
                        <h4>Easy HR Margin Trend</h4>
                        <p>Average HR minus easy cap. Above zero means the easy day crossed the cap.</p>
                        <canvas id="${runPlusId('nsm-easy-margin-chart')}"></canvas>
                    </article>
                    <article class="run-plus-nsm-chart-card">
                        <h4>Weekly Easy Compliance</h4>
                        <p>Easy runs grouped by week, split into under-cap and over-cap days.</p>
                        <canvas id="${runPlusId('nsm-easy-weekly-chart')}"></canvas>
                    </article>
                    <article class="run-plus-nsm-chart-card run-plus-nsm-chart-card--wide">
                        <h4>Easy HR vs Pace Scatter</h4>
                        <p>Each point is one easy run. Lines mark average easy HR and HR%max percentiles.</p>
                        <canvas id="${runPlusId('nsm-easy-scatter-chart')}"></canvas>
                    </article>
                </div>
            </div>
        </section>
    `;
}

function renderNsmTestsAndAnchors(model) {
    const nsm = model.nsm;
    return `
        <section class="run-plus-module run-plus-module--wide nsm-section-animated">
            <div class="run-plus-module-panel">
                <h3>Test & Pace Anchors</h3>
                <div class="run-plus-nsm-split">
                    <form class="run-plus-nsm-test-form" id="${runPlusId('nsm-test-form')}">
                        <label><span>Date</span><input name="date" type="date" required></label>
                        <label><span>Type</span><select name="type"><option>TT</option><option>5K</option><option>10K</option><option>HM</option><option>Race</option></select></label>
                        <label><span>Distance km</span><input name="distanceKm" type="number" min="0.4" max="100" step="0.01" required></label>
                        <label><span>Time</span><input name="time" type="text" placeholder="25:30 or 1:24:00" required></label>
                        <label><span>Notes</span><input name="notes" type="text" maxlength="160" placeholder="Optional"></label>
                        <div class="run-plus-nsm-actions"><button type="submit">Add test</button></div>
                    </form>
                    <div>
                        <div class="run-plus-nsm-mini-grid">
                            ${nsm.timedAnchors.map(anchor => renderNsmMetric(`${anchor.minutes} min effort`, anchor.paceSec ? paceLabel(anchor.paceSec) : '-', nsm.primaryAnchor ? `From ${nsm.primaryAnchor.date} ${nsm.primaryAnchor.type}` : 'Add a TT/race anchor', anchor.paceSec ? 'good' : 'muted')).join('')}
                        </div>
                        <div class="run-plus-table-wrap">
                            <table class="compact-table run-plus-nsm-table">
                                <thead><tr><th>Date</th><th>Type</th><th>Distance</th><th>Time</th><th>Pace</th><th></th></tr></thead>
                                <tbody>
                                    ${nsm.tests.map(test => `
                                        <tr class="nsm-row--race">
                                            <td>${esc(test.date)}</td>
                                            <td>${esc(test.type)}</td>
                                            <td>${formatNsmDistance(test.distanceKm)}</td>
                                            <td>${formatDurationInput(test.timeSec)}</td>
                                            <td>${paceLabel(test.timeSec / test.distanceKm)}</td>
                                            <td><button type="button" class="run-plus-nsm-link-button" data-remove-nsm-test="${esc(test.id)}">Remove</button></td>
                                        </tr>
                                    `).join('') || '<tr><td colspan="6"><div class="nsm-empty-state"><span class="nsm-empty-state__icon">🏁</span><span class="nsm-empty-state__title">No tests</span><span class="nsm-empty-state__text">No manual tests saved. Race-like Strava activities are still used as weak anchors.</span></div></td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function getNsmProgressCostStatus(model) {
    const tissueLevel = model.diagnostics.tissueLoad.status.level;
    const loadStatus = model.diagnostics.loadReadiness.state.status;
    const aerobicStatus = model.diagnostics.aerobicEfficiency.trend.status;
    const subTShare = model.nsm.block.subThresholdShare;

    if (tissueLevel === 'risk' || loadStatus === 'risk') {
        return {
            level: 'overcooked',
            icon: '🔴',
            label: 'Cost constrained',
            detail: tissueLevel === 'risk'
                ? 'Tissue capacity is the limiting signal. Reduce impact load before adding more quality.'
                : 'Acute fatigue is high. Keep quality conservative until recovery improves.'
        };
    }
    if (tissueLevel === 'warn' || loadStatus === 'build' || aerobicStatus === 'declining' || subTShare > 0.30) {
        return {
            level: 'watch',
            icon: '⚠️',
            label: 'Cost watch',
            detail: 'Progress can continue, but keep easy discipline and tissue load stable before adding another quality session.'
        };
    }
    return {
        level: 'controlled',
        icon: '✅',
        label: aerobicStatus === 'improving' ? 'Clean progress' : 'Cost controlled',
        detail: 'Progress and cost signals are currently compatible with repeatable NSM work.'
    };
}

function renderNsmProgressCost(model) {
    const d = model.diagnostics;
    const nsm = model.nsm;
    const costStatus = getNsmProgressCostStatus(model);
    return `
        <section class="run-plus-module run-plus-module--wide nsm-section-animated">
            <div class="run-plus-module-panel">
                <h3>Progress vs Cost</h3>
                <div class="run-plus-nsm-mini-grid">
                    ${renderNsmMetric('Aerobic trend', d.aerobicEfficiency.trend.status, d.aerobicEfficiency.trend.improvementPct == null ? 'Not enough HR-valid data' : `${formatSigned(d.aerobicEfficiency.trend.improvementPct * 100)}% HR-normalized change`, d.aerobicEfficiency.trend.status === 'improving' ? 'good' : d.aerobicEfficiency.trend.status === 'declining' ? 'warn' : 'muted')}
                    ${renderNsmMetric('Metabolic load', d.loadReadiness.state.label, d.loadReadiness.state.narrative, d.loadReadiness.state.status === 'risk' ? 'risk' : d.loadReadiness.state.status === 'build' ? 'warn' : 'good')}
                    ${renderNsmMetric('Tissue cost', d.tissueLoad.status.label, `${safeFixed(d.tissueLoad.recent7Impact, 0)} ILP · ${safeFixed(d.tissueLoad.capacityRatio, 2)}x capacity`, d.tissueLoad.status.level)}
                    ${renderNsmMetric('NSM block quality', `${percentLabel(nsm.block.subThresholdShare)} SubT work`, `${formatNsmHours(nsm.block.subThresholdMinutes)} / ${formatNsmHours(nsm.block.totalMinutes)} total · ${nsm.block.easyRuns} easy · ${nsm.block.longRuns} long`, nsm.block.subThresholdShare <= 0.30 ? 'good' : 'warn')}
                </div>
                <div class="run-plus-resolver-panel">
                    <div class="nsm-progress-status-row">
                        <span class="nsm-control-badge nsm-control-badge--${esc(costStatus.level)}">${esc(costStatus.icon)} ${esc(costStatus.label)}</span>
                        <span class="nsm-progress-status-copy">${esc(costStatus.detail)}</span>
                    </div>
                    <p><strong>Current decision:</strong> ${esc(nsm.recommendations[0])}</p>
                    <p>This module intentionally pairs progress signals with cost signals. NSM should make sub-threshold work repeatable; if aerobic trend improves while easy discipline and tissue capacity deteriorate, the build is not clean.</p>
                </div>
            </div>
        </section>
    `;
}

function renderNsmSessionRegistry(model) {
    const rows = model.nsm.rows;
    const tagClass = (tag) => {
        const map = { easy: 'nsm-row--easy', subt_short: 'nsm-row--subt', subt_medium: 'nsm-row--subt', subt_long: 'nsm-row--subt', long: 'nsm-row--long', race: 'nsm-row--race', other: 'nsm-row--other', excluded: 'nsm-row--excluded' };
        return map[tag] || '';
    };
    return `
        <section class="run-plus-module run-plus-module--wide nsm-section-animated">
            <div class="run-plus-module-panel">
                <h3>NSM Session Registry</h3>
                <div class="run-plus-export-buttons" style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
                    <button id="${runPlusId('nsm-registry-save')}" type="button">Save registry</button>
                    <span class="nsm-unsaved-badge nsm-unsaved-badge--hidden" id="${runPlusId('nsm-unsaved-badge')}">● Unsaved changes</span>
                    <button id="${runPlusId('nsm-export-csv')}" type="button">Export NSM CSV</button>
                    <button id="${runPlusId('nsm-export-json')}" type="button">Export NSM JSON</button>
                </div>
                <div class="run-plus-table-wrap">
                    <table class="compact-table run-plus-nsm-registry-table">
                        <thead class="nsm-sticky-thead">
                            <tr>
                                <th>Include</th><th>Date</th><th>Activity</th><th>Auto guess</th><th>Tag</th><th>Template</th><th>Work pace</th><th>Work HR</th><th>Work min</th><th>Analysis</th><th>RPE</th><th>Lactate</th><th>Pain</th><th>Next day</th><th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `
                                <tr class="run-plus-nsm-registry-row ${tagClass(row.tag)}" data-activity-id="${esc(row.activityId)}" data-auto-tag="${esc(row.autoTag)}" data-is-subthreshold="${row.isSubThreshold ? 'true' : 'false'}">
                                    <td><input type="checkbox" data-nsm-field="includeInNsm" ${row.includeInNsm ? 'checked' : ''}></td>
                                    <td>${esc(row.date)}</td>
                                    <td>${row.run?.id ? `<a href="/html/activity-router.html?id=${encodeURIComponent(row.run.id)}" target="_blank" rel="noopener noreferrer">${esc(row.name)}</a>` : esc(row.name)}</td>
                                    <td><span class="run-plus-pill ${nsmTagPillClass(row.autoTag)}">${esc(nsmTagLabel(row.autoTag))}</span></td>
                                    <td>
                                        <select data-nsm-field="tag">
                                            ${NSM_TAG_OPTIONS.map(([value, label]) => `<option value="${esc(value)}" ${row.source === 'manual' && row.manualTag === value ? 'selected' : row.source === 'auto' && value === 'auto' ? 'selected' : ''}>${esc(label)}</option>`).join('')}
                                        </select>
                                    </td>
                                    <td>
                                        <select data-nsm-field="template">
                                            ${NSM_TEMPLATE_OPTIONS.map(([value, label]) => `<option value="${esc(value)}" ${row.input.template === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}
                                        </select>
                                    </td>
                                    <td><input data-nsm-field="workPace" type="text" inputmode="numeric" maxlength="8" placeholder="5:00" value="${esc(formatPaceInput(row.input.workPaceSec))}"></td>
                                    <td><input data-nsm-field="workHr" type="number" min="60" max="230" step="1" value="${Number.isFinite(row.input.workHr) ? esc(row.input.workHr) : ''}"></td>
                                    <td><input data-nsm-field="workMinutes" type="number" min="1" max="240" step="1" value="${Number.isFinite(row.input.workMinutes) ? esc(row.input.workMinutes) : ''}"></td>
                                    <td>
                                        ${renderNsmRegistryAnalysisCell(row)}
                                    </td>
                                    <td><input data-nsm-field="rpe" type="number" min="0" max="10" step="0.5" value="${Number.isFinite(row.input.rpe) ? esc(row.input.rpe) : ''}"></td>
                                    <td><input data-nsm-field="lactate" type="number" min="0" max="12" step="0.1" value="${Number.isFinite(row.input.lactate) ? esc(row.input.lactate) : ''}"></td>
                                    <td><input data-nsm-field="painScore" type="number" min="0" max="10" step="1" value="${Number.isFinite(row.input.painScore) ? esc(row.input.painScore) : ''}"></td>
                                    <td><input data-nsm-field="nextDayScore" type="number" min="0" max="10" step="1" value="${Number.isFinite(row.input.nextDayScore) ? esc(row.input.nextDayScore) : ''}"></td>
                                    <td><input data-nsm-field="notes" type="text" maxlength="240" value="${esc(row.input.notes)}"></td>
                                </tr>
                            `).join('') || '<tr><td colspan="15"><div class="nsm-empty-state"><span class="nsm-empty-state__icon">📝</span><span class="nsm-empty-state__title">No sessions</span><span class="nsm-empty-state__text">No runs in the active filter.</span></div></td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    `;
}

function renderNsmRulesTrust(model) {
    const nsm = model.nsm;
    return `
        <section class="run-plus-collapsible-group">
            <div class="run-plus-collapsible-group__title">
                <span>NSM</span> Rules & Data Trust
            </div>
            <details class="run-plus-collapsible" open>
                <summary>
                    Classification rules
                    <span class="run-plus-pill run-plus-pill--muted">${nsm.dataTrust.manualTagged} manual tags</span>
                </summary>
                <div class="run-plus-collapsible__body">
                    <div class="run-plus-field-groups">
                        <article class="run-plus-field-group"><span>SubT</span><h4>Sub-threshold</h4><p>Manual tag first, then name cues such as threshold/tempo/subT/NSM/umbral, or Strava workout signal when activity-level HR sits near the local threshold range. Short/medium/long is inferred from duration/name, or set directly by manual tag.</p></article>
                        <article class="run-plus-field-group"><span>Easy</span><h4>Easy discipline</h4><p>Manual tag first, then Easy/Recovery classifier, name cues, or activity-level average HR below the local easy cap.</p></article>
                        <article class="run-plus-field-group"><span>Long</span><h4>Long run</h4><p>Manual tag, name cue, Strava long-run signal, distance >= 16 km, or a clearly longest weekly run.</p></article>
                        <article class="run-plus-field-group"><span>Trust</span><h4>Confidence</h4><p>SubT structure uses manual work overrides, Strava laps, or activity-average fallback. Deep HR analysis adds a separate streams overlay for HR response and recovery. Activity-average SubT rows are low confidence.</p></article>
                    </div>
                </div>
            </details>
            <details class="run-plus-collapsible">
                <summary>
                    Field trust
                    <span class="run-plus-pill ${pillClassForConfidence(model.diagnostics.aerobicEfficiency.confidence)}">${percentLabel(nsm.dataTrust.hrCoverage)} HR coverage</span>
                    <span class="run-plus-pill run-plus-pill--muted">${nsm.dataTrust.intervalAnalyzed} interval parsed</span>
                </summary>
                <div class="run-plus-collapsible__body">
                    <p class="run-plus-chart-caption">NSM interval analysis is local and on demand. Laps provide the default reps and pace structure; Deep HR analysis uses streams for HR response and recovery drop. Easy and long runs still use activity-level summaries.</p>
                </div>
            </details>
        </section>
    `;
}

function renderNsmPage(model) {
    return `
        ${renderNsmCommandCenter(model)}
        <div class="run-plus-section-group__grid">
            ${renderNsmWeeklyScore(model)}
            ${renderNsmSubthresholdWorkbench(model)}
            ${renderNsmIntervalAnalysis(model)}
            ${renderNsmEasyDiscipline(model)}
            ${renderNsmTestsAndAnchors(model)}
            ${renderNsmProgressCost(model)}
            ${renderNsmSessionRegistry(model)}
        </div>
        ${renderNsmRulesTrust(model)}
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

function destroyNsmEasyCharts() {
    if (!Array.isArray(window.runPlusNsmEasyCharts)) {
        window.runPlusNsmEasyCharts = [];
        return;
    }
    window.runPlusNsmEasyCharts.forEach(chart => {
        try {
            chart.destroy();
        } catch (_err) {
            // Ignore stale Chart.js instances after route-level rerenders.
        }
    });
    window.runPlusNsmEasyCharts = [];
}

function registerNsmEasyChart(chart) {
    if (!chart) return;
    if (!Array.isArray(window.runPlusNsmEasyCharts)) window.runPlusNsmEasyCharts = [];
    window.runPlusNsmEasyCharts.push(chart);
}

function renderNsmEasyCharts(model) {
    destroyNsmEasyCharts();
    if (typeof Chart === 'undefined') return;

    const easy = model?.nsm?.easyDiscipline;
    if (!easy) return;

    const runColor = getCssColor('--color-sport-run', '#fc5200');
    const textColor = getCssColor('--color-text-medium', '#667085');
    const borderColor = getCssColor('--color-border', '#e5e7eb');
    const goodColor = '#16a34a';
    const warnColor = '#f59e0b';
    const mutedColor = '#94a3b8';
    const riskColor = '#dc2626';
    const chartRows = [...(easy.chartRows || [])].sort((a, b) => a.date.localeCompare(b.date));

    const baseOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: textColor, boxWidth: 10 } }
        },
        scales: {
            x: { ticks: { color: textColor }, grid: { color: borderColor } },
            y: { ticks: { color: textColor }, grid: { color: borderColor } }
        }
    };

    const marginCanvas = document.getElementById(runPlusId('nsm-easy-margin-chart'));
    if (marginCanvas && chartRows.length) {
        registerNsmEasyChart(new Chart(marginCanvas.getContext('2d'), {
            data: {
                labels: chartRows.map(row => row.date),
                datasets: [
                    {
                        type: 'bar',
                        label: 'HR margin vs cap',
                        data: chartRows.map(row => +row.easyHrMargin.toFixed(1)),
                        backgroundColor: chartRows.map(row => row.easyHrMargin > 0 ? 'rgba(245, 158, 11, 0.42)' : 'rgba(22, 163, 74, 0.34)'),
                        borderColor: chartRows.map(row => row.easyHrMargin > 0 ? warnColor : goodColor),
                        borderWidth: 1
                    },
                    {
                        type: 'line',
                        label: 'Easy cap',
                        data: chartRows.map(() => 0),
                        borderColor: riskColor,
                        borderDash: [6, 4],
                        pointRadius: 0,
                        borderWidth: 1.5
                    }
                ]
            },
            options: {
                ...baseOptions,
                plugins: {
                    ...baseOptions.plugins,
                    tooltip: {
                        callbacks: {
                            label: context => `${context.dataset.label}: ${formatSigned(Number(context.raw), 1)} bpm`
                        }
                    }
                },
                scales: {
                    ...baseOptions.scales,
                    y: {
                        ...baseOptions.scales.y,
                        title: { display: true, text: 'bpm vs easy cap', color: textColor }
                    }
                }
            }
        }));
    }

    const weeklyCanvas = document.getElementById(runPlusId('nsm-easy-weekly-chart'));
    const weeklyRows = easy.weeklyCompliance || [];
    if (weeklyCanvas && weeklyRows.length) {
        registerNsmEasyChart(new Chart(weeklyCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: weeklyRows.map(row => row.week),
                datasets: [
                    {
                        label: 'Under cap',
                        data: weeklyRows.map(row => row.underCap),
                        backgroundColor: 'rgba(22, 163, 74, 0.55)',
                        borderColor: goodColor,
                        borderWidth: 1,
                        stack: 'easy'
                    },
                    {
                        label: 'Over cap',
                        data: weeklyRows.map(row => row.overCap),
                        backgroundColor: 'rgba(245, 158, 11, 0.55)',
                        borderColor: warnColor,
                        borderWidth: 1,
                        stack: 'easy'
                    },
                    {
                        label: 'No HR',
                        data: weeklyRows.map(row => row.unknownHr),
                        backgroundColor: 'rgba(148, 163, 184, 0.42)',
                        borderColor: mutedColor,
                        borderWidth: 1,
                        stack: 'easy'
                    }
                ]
            },
            options: {
                ...baseOptions,
                scales: {
                    x: { ...baseOptions.scales.x, stacked: true },
                    y: {
                        ...baseOptions.scales.y,
                        stacked: true,
                        beginAtZero: true,
                        ticks: { ...baseOptions.scales.y.ticks, precision: 0 },
                        title: { display: true, text: 'easy runs', color: textColor }
                    }
                }
            }
        }));
    }

    const scatterCanvas = document.getElementById(runPlusId('nsm-easy-scatter-chart'));
    const scatterRows = chartRows.filter(row => Number.isFinite(row.pace) && Number.isFinite(row.avgHr));
    if (scatterCanvas && scatterRows.length) {
        const points = scatterRows.map(row => ({
            x: row.pace / 60,
            y: row.avgHr,
            row
        }));
        const xValues = points.map(point => point.x);
        const xMin = Math.min(...xValues);
        const xMax = Math.max(...xValues);
        const xPad = xMin === xMax ? 0.15 : (xMax - xMin) * 0.06;
        const xStart = Math.max(0, xMin - xPad);
        const xEnd = xMax + xPad;
        const lineData = value => Number.isFinite(value) ? [{ x: xStart, y: value }, { x: xEnd, y: value }] : [];
        const percentileLine = (label, pct, color) => ({
            type: 'line',
            label: Number.isFinite(pct) ? `${label} ${nsmHrPercentLabel(pct)}` : label,
            data: lineData(Number.isFinite(pct) ? pct * model.nsm.hrMax.value : null),
            borderColor: color,
            borderDash: [5, 5],
            borderWidth: 1,
            pointRadius: 0,
            showLine: true
        });

        registerNsmEasyChart(new Chart(scatterCanvas.getContext('2d'), {
            data: {
                datasets: [
                    {
                        type: 'scatter',
                        label: 'Easy runs',
                        data: points,
                        backgroundColor: points.map(point => point.row.easyOverCap ? 'rgba(245, 158, 11, 0.72)' : 'rgba(22, 163, 74, 0.62)'),
                        borderColor: points.map(point => point.row.easyOverCap ? warnColor : goodColor),
                        pointRadius: 4,
                        pointHoverRadius: 6
                    },
                    {
                        type: 'line',
                        label: Number.isFinite(easy.avgHrPctMax) ? `Avg HR ${nsmHrPercentLabel(easy.avgHrPctMax)} HRmax` : 'Avg HR',
                        data: lineData(easy.avgHr),
                        borderColor: runColor,
                        borderWidth: 2,
                        pointRadius: 0,
                        showLine: true
                    },
                    percentileLine('P25 HR%max', easy.hrPctP25, mutedColor),
                    percentileLine('P50 HR%max', easy.hrPctP50, '#64748b'),
                    percentileLine('P75 HR%max', easy.hrPctP75, riskColor)
                ]
            },
            options: {
                ...baseOptions,
                parsing: false,
                plugins: {
                    ...baseOptions.plugins,
                    tooltip: {
                        callbacks: {
                            label: context => {
                                const raw = context.raw;
                                if (!raw?.row) return `${context.dataset.label}: ${Math.round(raw?.y || 0)} bpm`;
                                return `${raw.row.date} · ${raw.row.name}: ${paceLabel(raw.row.pace)}, ${Math.round(raw.row.avgHr)} bpm (${nsmHrPercentLabel(raw.row.easyHrPctMax)})${raw.row.easyOverCap ? ' · over cap' : ''}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ...baseOptions.scales.x,
                        min: xStart,
                        max: xEnd,
                        title: { display: true, text: 'pace min/km', color: textColor },
                        ticks: {
                            color: textColor,
                            callback: value => paceLabel(Number(value) * 60)
                        }
                    },
                    y: {
                        ...baseOptions.scales.y,
                        title: { display: true, text: 'average HR bpm', color: textColor }
                    }
                }
            }
        }));
    }
}

function destroyNsmWeeklyScoreChart() {
    if (window.runPlusNsmWeeklyScoreChart) {
        try { window.runPlusNsmWeeklyScoreChart.destroy(); } catch (_e) { /* */ }
        window.runPlusNsmWeeklyScoreChart = null;
    }
}

function renderNsmWeeklyScoreChart(model) {
    destroyNsmWeeklyScoreChart();
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById(runPlusId('nsm-weekly-score-chart'));
    if (!canvas) return;

    const rows = [...(model.nsm.weekly || [])].slice(-16);
    if (!rows.length) return;

    const textColor = getCssColor('--color-text-medium', '#667085');
    const borderColor = getCssColor('--color-border', '#e5e7eb');
    const runColor = getCssColor('--color-sport-run', '#fc5200');

    window.runPlusNsmWeeklyScoreChart = new Chart(canvas.getContext('2d'), {
        data: {
            labels: rows.map(r => r.week),
            datasets: [
                {
                    type: 'bar',
                    label: 'Total hours',
                    data: rows.map(r => +(r.totalMinutes / 60).toFixed(2)),
                    backgroundColor: 'rgba(252, 82, 0, 0.15)',
                    borderColor: 'rgba(252, 82, 0, 0.35)',
                    borderWidth: 1,
                    yAxisID: 'y1',
                    order: 2
                },
                {
                    type: 'line',
                    label: 'Method Score',
                    data: rows.map(r => r.score),
                    borderColor: runColor,
                    backgroundColor: 'rgba(252, 82, 0, 0.08)',
                    fill: true,
                    borderWidth: 2.5,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.2,
                    yAxisID: 'y',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: textColor, boxWidth: 10 } },
                tooltip: {
                    callbacks: {
                        afterBody: (items) => {
                            const idx = items?.[0]?.dataIndex;
                            const row = Number.isInteger(idx) ? rows[idx] : null;
                            if (!row) return [];
                            return [
                                `Label: ${row.label}`,
                                `SubT: ${row.subThresholdSessions} · Easy: ${row.easySessions}`,
                                `Quality share: ${percentLabel(row.subThresholdShare)}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { color: textColor }, grid: { color: borderColor } },
                y: {
                    type: 'linear',
                    position: 'left',
                    min: 0,
                    max: 100,
                    ticks: { color: textColor },
                    grid: { color: borderColor },
                    title: { display: true, text: 'Score', color: textColor }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    ticks: { color: textColor },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Hours', color: textColor }
                }
            }
        }
    });
}

function destroyNsmSubtCharts() {
    ['runPlusNsmSubtPaceChart', 'runPlusNsmSubtHrChart'].forEach(key => {
        if (window[key]) {
            try { window[key].destroy(); } catch (_e) { /* */ }
            window[key] = null;
        }
    });
}

function renderNsmSubtCharts(model) {
    destroyNsmSubtCharts();
    if (typeof Chart === 'undefined') return;

    const subtRows = model.nsm.subThreshold.rows
        .filter(r => r.intervalAnalysis && r.intervalAnalysis.source !== 'activity_average')
        .sort((a, b) => a.date.localeCompare(b.date));
    if (!subtRows.length) return;

    const textColor = getCssColor('--color-text-medium', '#667085');
    const borderColor = getCssColor('--color-border', '#e5e7eb');
    const runColor = getCssColor('--color-sport-run', '#fc5200');

    // SubT Pace Trend
    const paceCanvas = document.getElementById(runPlusId('nsm-subt-pace-chart'));
    const paceRows = subtRows.filter(r => r.intervalAnalysis?.summary?.avgWorkPaceSec > 0);
    if (paceCanvas && paceRows.length) {
        window.runPlusNsmSubtPaceChart = new Chart(paceCanvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: paceRows.map(r => r.date),
                datasets: [{
                    label: 'Work pace (min/km)',
                    data: paceRows.map(r => +(r.intervalAnalysis.summary.avgWorkPaceSec / 60).toFixed(3)),
                    borderColor: runColor,
                    backgroundColor: 'rgba(252, 82, 0, 0.08)',
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: textColor, boxWidth: 10 } },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${paceLabel(Number(ctx.raw) * 60)}`,
                            afterBody: items => {
                                const idx = items?.[0]?.dataIndex;
                                const r = Number.isInteger(idx) ? paceRows[idx] : null;
                                if (!r) return [];
                                return [`${r.name}`, `HR: ${Number.isFinite(r.intervalAnalysis?.summary?.avgWorkHr) ? Math.round(r.intervalAnalysis.summary.avgWorkHr) + ' bpm' : '-'}`];
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: textColor, maxTicksLimit: 8 }, grid: { color: borderColor } },
                    y: {
                        reverse: true,
                        ticks: { color: textColor, callback: v => paceLabel(Number(v) * 60) },
                        grid: { color: borderColor },
                        title: { display: true, text: 'min/km', color: textColor }
                    }
                }
            }
        });
    }

    // HR Response Trend
    const hrCanvas = document.getElementById(runPlusId('nsm-subt-hr-response-chart'));
    const hrRows = subtRows.filter(r => {
        const overlay = getNsmRowHrOverlay(r);
        return overlay?.source === 'streams' && Number.isFinite(overlay.hrResponse);
    });
    if (hrCanvas && hrRows.length) {
        const hrData = hrRows.map(r => {
            const overlay = getNsmRowHrOverlay(r);
            return { date: r.date, name: r.name, value: +overlay.hrResponse.toFixed(1) };
        });
        window.runPlusNsmSubtHrChart = new Chart(hrCanvas.getContext('2d'), {
            data: {
                labels: hrData.map(d => d.date),
                datasets: [
                    {
                        type: 'bar',
                        label: 'HR response (bpm)',
                        data: hrData.map(d => d.value),
                        backgroundColor: hrData.map(d => d.value <= 5 ? 'rgba(22, 163, 74, 0.35)' : d.value <= 8 ? 'rgba(245, 158, 11, 0.4)' : 'rgba(220, 38, 38, 0.35)'),
                        borderColor: hrData.map(d => d.value <= 5 ? '#16a34a' : d.value <= 8 ? '#f59e0b' : '#dc2626'),
                        borderWidth: 1
                    },
                    {
                        type: 'line',
                        label: 'Controlled threshold (+6)',
                        data: hrData.map(() => 6),
                        borderColor: '#f59e0b',
                        borderDash: [5, 5],
                        borderWidth: 1.5,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: textColor, boxWidth: 10 } },
                    tooltip: {
                        callbacks: {
                            afterBody: items => {
                                const idx = items?.[0]?.dataIndex;
                                return Number.isInteger(idx) ? [hrData[idx].name] : [];
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: textColor, maxTicksLimit: 8 }, grid: { color: borderColor } },
                    y: {
                        beginAtZero: true,
                        ticks: { color: textColor },
                        grid: { color: borderColor },
                        title: { display: true, text: 'HR response (early to late bpm)', color: textColor }
                    }
                }
            }
        });
    }
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

function bindRunPlusSubviewNav(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options) {
    root.querySelectorAll('[data-run-plus-subview]').forEach(button => {
        button.addEventListener('click', () => {
            const href = button.dataset.href || '/run-plus';
            if (window.location.pathname !== href) {
                window.history.pushState({ tabId: 'run-plus-tab', subview: button.dataset.runPlusSubview }, '', href);
            }
            renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        });
    });
}

function bindNsmSettings(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options) {
    const form = root.querySelector(`#${runPlusId('nsm-settings-form')}`);
    const resetButton = root.querySelector(`#${runPlusId('nsm-settings-reset')}`);
    if (form) {
        form.addEventListener('submit', event => {
            event.preventDefault();
            const data = new FormData(form);
            const settings = normalizeNsmSettings({
                easyHrCapPct: data.get('easyHrCapPct'),
                thresholdHrPct: data.get('thresholdHrPct'),
                currentBlockStart: data.get('currentBlockStart'),
                currentBlockEnd: data.get('currentBlockEnd'),
                targetRace: data.get('targetRace'),
                weeklyTemplate: data.get('weeklyTemplate')
            });
            writeJsonStorage(NSM_SETTINGS_STORAGE_KEY, settings);
            renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        });
    }
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            localStorage.removeItem(NSM_SETTINGS_STORAGE_KEY);
            renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        });
    }
}

function bindNsmTestControls(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options) {
    const form = root.querySelector(`#${runPlusId('nsm-test-form')}`);
    if (form) {
        form.addEventListener('submit', event => {
            event.preventDefault();
            const data = new FormData(form);
            const test = normalizeNsmTest({
                date: data.get('date'),
                type: data.get('type'),
                distanceKm: data.get('distanceKm'),
                time: data.get('time'),
                notes: data.get('notes')
            });
            if (!test) return;
            const tests = readNsmTests();
            tests.push({ ...test, id: `${test.date}-${test.type}-${test.distanceKm}-${test.timeSec}-${Date.now()}` });
            writeJsonStorage(NSM_TESTS_STORAGE_KEY, tests);
            renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        });
    }

    root.querySelectorAll('[data-remove-nsm-test]').forEach(button => {
        button.addEventListener('click', () => {
            const removeId = button.dataset.removeNsmTest;
            const tests = readNsmTests().filter(test => test.id !== removeId);
            writeJsonStorage(NSM_TESTS_STORAGE_KEY, tests);
            renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        });
    });
}

function collectNsmRegistryPayload(root) {
    const tags = readNsmActivityTags();
    const inputs = readNsmSessionInputs();

    root.querySelectorAll('.run-plus-nsm-registry-row').forEach(row => {
        const activityId = row.dataset.activityId;
        if (!activityId) return;
        const includeInNsm = row.querySelector('[data-nsm-field="includeInNsm"]')?.checked !== false;
        const tag = normalizeNsmTag(row.querySelector('[data-nsm-field="tag"]')?.value || 'auto');
        if (tag === 'auto' && includeInNsm) {
            delete tags[activityId];
        } else {
            tags[activityId] = normalizeNsmActivityTag({
                tag: includeInNsm ? tag : 'excluded',
                includeInNsm,
                updatedAt: new Date().toISOString()
            });
        }

        const input = normalizeNsmSessionInput({
            template: row.querySelector('[data-nsm-field="template"]')?.value,
            workPace: row.querySelector('[data-nsm-field="workPace"]')?.value,
            workHr: row.querySelector('[data-nsm-field="workHr"]')?.value,
            workMinutes: row.querySelector('[data-nsm-field="workMinutes"]')?.value,
            rpe: row.querySelector('[data-nsm-field="rpe"]')?.value,
            lactate: row.querySelector('[data-nsm-field="lactate"]')?.value,
            painScore: row.querySelector('[data-nsm-field="painScore"]')?.value,
            nextDayScore: row.querySelector('[data-nsm-field="nextDayScore"]')?.value,
            notes: row.querySelector('[data-nsm-field="notes"]')?.value
        });
        if (hasNsmSessionInput(input)) inputs[activityId] = input;
        else delete inputs[activityId];
    });

    return { tags, inputs };
}

function nsmExportRows(model) {
    return model.nsm.rows.map(row => {
        const overlay = getNsmRowHrOverlay(row);
        return {
        activityId: row.activityId,
        date: row.date,
        name: row.name,
        tag: row.tag,
        autoTag: row.autoTag,
        source: row.source,
        structureSource: row.isSubThreshold ? row.intervalAnalysis?.source || '' : '',
        structureConfidence: row.isSubThreshold ? row.intervalAnalysis?.confidence || row.confidence : '',
        hrSource: overlay?.source || '',
        hrConfidence: overlay?.hrConfidence || '',
        intervalSource: row.isSubThreshold ? row.intervalAnalysis?.source || '' : '',
        intervalConfidence: row.isSubThreshold ? row.intervalAnalysis?.confidence || row.confidence : '',
        intervalTemplate: row.isSubThreshold ? row.intervalAnalysis?.summary?.workoutFamily || row.input.template : '',
        subThresholdWorkMinutes: row.isSubThreshold ? +row.subThresholdWorkMinutes.toFixed(1) : '',
        workPace: row.intervalAnalysis?.summary?.avgWorkPaceSec ? paceLabel(row.intervalAnalysis.summary.avgWorkPaceSec) : '',
        workHr: Number.isFinite(row.intervalAnalysis?.summary?.avgWorkHr) ? Math.round(row.intervalAnalysis.summary.avgWorkHr) : '',
        workRepCount: Number.isFinite(row.intervalAnalysis?.summary?.workSegments) ? row.intervalAnalysis.summary.workSegments : '',
        workPaceCv: Number.isFinite(row.intervalAnalysis?.summary?.paceCv) ? +(row.intervalAnalysis.summary.paceCv * 100).toFixed(1) : '',
        hrMetricUsed: overlay?.hrMetricUsed || '',
        hrResponse: overlay?.source === 'streams' && Number.isFinite(overlay.hrResponse) ? +overlay.hrResponse.toFixed(1) : '',
        earlyRepRange: overlay?.earlyRepRange || '',
        lateRepRange: overlay?.lateRepRange || '',
        controlStatus: row.controlStatus || '',
        hrDrift: overlay?.source === 'streams' && Number.isFinite(overlay.hrResponse) ? +overlay.hrResponse.toFixed(1) : '',
        recoveryHrDrop: overlay?.source === 'streams' && Number.isFinite(overlay.recoveryHrDrop) ? +overlay.recoveryHrDrop.toFixed(1) : '',
        recoveryHrDropSource: overlay?.source === 'streams' ? 'streams' : row.intervalAnalysis?.source === 'laps' ? 'needs streams' : '',
        includeInNsm: row.includeInNsm,
        distanceKm: +row.distanceKm.toFixed(3),
        movingMinutes: +row.minutes.toFixed(1),
        pace: paceLabel(row.pace),
        averageHr: Number.isFinite(row.avgHr) ? Math.round(row.avgHr) : '',
        template: row.input.template,
        manualWorkPace: Number.isFinite(row.input.workPaceSec) ? paceLabel(row.input.workPaceSec) : '',
        manualWorkHr: Number.isFinite(row.input.workHr) ? row.input.workHr : '',
        manualWorkMinutes: Number.isFinite(row.input.workMinutes) ? row.input.workMinutes : '',
        rpe: Number.isFinite(row.input.rpe) ? row.input.rpe : '',
        lactate: Number.isFinite(row.input.lactate) ? row.input.lactate : '',
        painScore: Number.isFinite(row.input.painScore) ? row.input.painScore : '',
        nextDayScore: Number.isFinite(row.input.nextDayScore) ? row.input.nextDayScore : '',
        notes: row.input.notes,
        overcookFlags: row.overcookFlags.join('; ')
        };
    });
}

function downloadRunPlusText(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function getRunPlusAuthPayload() {
    const tokenString = localStorage.getItem('strava_tokens');
    return tokenString ? btoa(tokenString) : null;
}

async function fetchRunPlusApi(url) {
    const authPayload = getRunPlusAuthPayload();
    const response = await fetch(url, {
        headers: authPayload ? { Authorization: `Bearer ${authPayload}` } : {}
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    const result = await response.json();
    if (result.tokens) localStorage.setItem('strava_tokens', JSON.stringify(result.tokens));
    return result;
}

async function fetchNsmActivityDetails(activityId) {
    const result = await fetchRunPlusApi(`/api/strava-activity?id=${encodeURIComponent(activityId)}`);
    return result.activity;
}

async function fetchNsmActivityStreams(activityId) {
    const streamTypes = 'time,distance,velocity_smooth,heartrate,cadence,altitude';
    const result = await fetchRunPlusApi(`/api/strava-streams?id=${encodeURIComponent(activityId)}&type=${encodeURIComponent(streamTypes)}`);
    return result.streams;
}

async function analyzeNsmIntervals(row) {
    if (!row?.run?.id) throw new Error('Activity ID is required for interval analysis.');
    if (hasNsmManualWorkOverride(row.input)) return buildNsmManualIntervalAnalysis(row.run, row.input, row.tag);

    const localLapAnalysis = analyzeNsmLaps(row.run, row.run, row.input);
    if (localLapAnalysis) return localLapAnalysis;

    let detailError = null;
    try {
        const activity = await fetchNsmActivityDetails(row.run.id);
        const lapAnalysis = analyzeNsmLaps(activity, row.run, row.input);
        if (lapAnalysis) return lapAnalysis;
    } catch (err) {
        detailError = err;
    }

    return {
        ...buildNsmActivityAverageAnalysis(row.run, row.input, row.tag),
        warnings: [detailError ? `No usable laps detected (${detailError.message}); kept activity-average proxy.` : 'No usable laps detected; kept activity-average proxy. Use Deep HR analysis for streams.']
    };
}

async function analyzeNsmDeepHr(row) {
    if (!row?.run?.id) throw new Error('Activity ID is required for deep HR analysis.');

    const analyzeStreamsForRow = streams => analyzeNsmStreamsAgainstStructure(streams, row.run, row.input, row.intervalAnalysis)
        || analyzeNsmStreams(streams, row.run, row.input);
    const localStreams = row.run?.streams;
    const localStreamAnalysis = localStreams ? analyzeStreamsForRow(localStreams) : null;
    if (localStreamAnalysis) return mergeNsmHrOverlay(row.intervalAnalysis, localStreamAnalysis, row.run, row.input, row.tag);

    const streams = await fetchNsmActivityStreams(row.run.id);
    const streamAnalysis = analyzeStreamsForRow(streams);
    if (streamAnalysis) return mergeNsmHrOverlay(row.intervalAnalysis, streamAnalysis, row.run, row.input, row.tag);
    throw new Error('No usable stream HR points matched the interval structure. Keep the laps proxy or check Strava streams for this activity.');
}

function bindNsmRegistry(root, model, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options) {
    const saveButton = root.querySelector(`#${runPlusId('nsm-registry-save')}`);
    if (saveButton) {
        saveButton.addEventListener('click', () => {
            const { tags, inputs } = collectNsmRegistryPayload(root);
            writeJsonStorage(NSM_ACTIVITY_TAGS_STORAGE_KEY, tags);
            writeJsonStorage(NSM_SESSION_INPUTS_STORAGE_KEY, inputs);
            renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        });
    }

    const csvButton = root.querySelector(`#${runPlusId('nsm-export-csv')}`);
    if (csvButton) {
        csvButton.addEventListener('click', () => {
            const rows = nsmExportRows(model);
            if (!rows.length) return;
            const headers = Object.keys(rows[0]);
            const csv = [
                headers.join(','),
                ...rows.map(row => headers.map(header => `"${String(row[header] ?? '').replace(/"/g, '""')}"`).join(','))
            ].join('\n');
            downloadRunPlusText('run-plus-nsm-sessions.csv', csv, 'text/csv');
        });
    }

    const jsonButton = root.querySelector(`#${runPlusId('nsm-export-json')}`);
    if (jsonButton) {
        jsonButton.addEventListener('click', () => {
            const payload = {
                settings: model.nsm.settings,
                weekly: model.nsm.weekly,
                rows: nsmExportRows(model),
                tests: model.nsm.tests
            };
            downloadRunPlusText('run-plus-nsm-sessions.json', JSON.stringify(payload, null, 2), 'application/json');
        });
    }

    const handleAnalysisClick = async (button, analyzer, loadingLabel, failedLabel) => {
        const activityId = button.dataset.nsmAnalyzeIntervals || button.dataset.nsmAnalyzeStreams;
        const row = model.nsm.rows.find(item => item.activityId === activityId);
        if (!row) return;
        const { tags, inputs } = collectNsmRegistryPayload(root);
        writeJsonStorage(NSM_ACTIVITY_TAGS_STORAGE_KEY, tags);
        writeJsonStorage(NSM_SESSION_INPUTS_STORAGE_KEY, inputs);
        row.input = normalizeNsmSessionInput(inputs[activityId] || {});
        button.disabled = true;
        button.textContent = loadingLabel;
        try {
            let analysis = await analyzer(row);
            if (button.dataset.nsmAnalyzeIntervals) {
                if (analysis.source === 'activity_average' && row.intervalAnalysis?.source === 'streams') {
                    analysis = {
                        ...row.intervalAnalysis,
                        warnings: [...new Set([...(row.intervalAnalysis.warnings || []), ...(analysis.warnings || [])])]
                    };
                } else if (row.hrOverlay) {
                    analysis = { ...analysis, hrOverlay: row.hrOverlay };
                }
            }
            saveNsmIntervalAnalysis(activityId, row.run, analysis);
            renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        } catch (err) {
            console.error('NSM interval analysis failed:', err);
            button.disabled = false;
            button.textContent = failedLabel;
            button.title = err.message || 'Unable to analyze intervals';
        }
    };

    root.querySelectorAll('[data-nsm-analyze-intervals]').forEach(button => {
        button.addEventListener('click', async () => {
            await handleAnalysisClick(button, analyzeNsmIntervals, 'Analyzing...', 'Analyze failed');
        });
    });

    root.querySelectorAll('[data-nsm-analyze-streams]').forEach(button => {
        button.addEventListener('click', async () => {
            await handleAnalysisClick(button, analyzeNsmDeepHr, 'Deep analyzing...', 'Deep HR failed');
        });
    });
}

function bindNsmControls(root, model, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options) {
    bindNsmSettings(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
    bindNsmTestControls(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
    bindNsmRegistry(root, model, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);

    // Unsaved changes indicator
    const badge = root.querySelector(`#${runPlusId('nsm-unsaved-badge')}`);
    if (badge) {
        const showBadge = () => badge.classList.remove('nsm-unsaved-badge--hidden');
        root.querySelectorAll('.run-plus-nsm-registry-row input, .run-plus-nsm-registry-row select').forEach(el => {
            el.addEventListener('change', showBadge);
            el.addEventListener('input', showBadge);
        });
    }
}

function bindRunPlusControls(root, model, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options = {}) {
    bindRunPlusFilterControls(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
    bindCapacityInputs(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
    bindRunPlusSubviewNav(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
    if (model.nsm && getRunPlusSubview() === 'nsm') {
        bindNsmControls(root, model, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
    }

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

function publishRunPlusNsm(root, nsm) {
    if (!root || !nsm) return;
    const summary = {
        settings: nsm.settings,
        latestWeek: nsm.latestWeek,
        recent7: nsm.recent7,
        recent28: nsm.recent28,
        block: nsm.block,
        easyDiscipline: nsm.easyDiscipline,
        subThreshold: {
            sessions: nsm.subThreshold.sessions,
            overcooked: nsm.subThreshold.overcooked,
            share: nsm.subThreshold.share
        },
        tests: nsm.tests,
        recommendations: nsm.recommendations,
        dataTrust: nsm.dataTrust
    };
    root.runPlusNsm = summary;
    root.dataset.runPlusNsm = JSON.stringify(summary);
    window.runPlusNsm = summary;
}

// ─── Main render ────────────────────────────────────────

export function renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, gearFilter = 'all', options = {}) {
    const root = document.getElementById('run-plus-tab');
    if (!root) return;

    const subview = getRunPlusSubview();
    const nsmSettings = subview === 'nsm' ? readNsmSettings() : null;
    const effectiveDateFilterFrom = subview === 'nsm' && !dateFilterFrom && nsmSettings?.currentBlockStart
        ? nsmSettings.currentBlockStart
        : dateFilterFrom;
    const effectiveDateFilterTo = dateFilterTo;
    const model = buildModel(allActivities, effectiveDateFilterFrom, effectiveDateFilterTo, gearFilter);
    model.diagnostics = buildDiagnostics(model);
    model.nsm = buildNsmModel(model);

    if (!model.runs.length) {
        destroyImpactLoadChart();
        destroyNsmEasyCharts();
        destroyNsmWeeklyScoreChart();
        destroyNsmSubtCharts();
        publishRunPlusDiagnostics(root, model.diagnostics);
        publishRunPlusNsm(root, model.nsm);
        root.innerHTML = `
            <div class="run-plus-shell">
                ${renderRunPlusFilters(allActivities, effectiveDateFilterFrom, effectiveDateFilterTo, gearFilter)}
                ${renderRunPlusSubviewNav(subview)}
                <section class="run-plus-diagnosis-overview">
                    <h2>${subview === 'nsm' ? 'NSM Training Control' : 'Run Plus'}</h2>
                    <p>No run activities match the current filters.</p>
                </section>
            </div>
        `;
        bindRunPlusFilterControls(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        bindRunPlusSubviewNav(root, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        if (subview === 'nsm') bindNsmControls(root, model, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        return;
    }

    if (subview === 'nsm') {
        destroyImpactLoadChart();
        destroyNsmEasyCharts();
        destroyNsmWeeklyScoreChart();
        destroyNsmSubtCharts();
        root.innerHTML = `
            <div class="run-plus-shell">
                ${renderRunPlusFilters(allActivities, effectiveDateFilterFrom, effectiveDateFilterTo, gearFilter)}
                ${renderRunPlusSubviewNav(subview)}
                ${renderNsmPage(model)}
            </div>
        `;
        publishRunPlusDiagnostics(root, model.diagnostics);
        publishRunPlusNsm(root, model.nsm);
        bindRunPlusControls(root, model, allActivities, dateFilterFrom, dateFilterTo, gearFilter, options);
        renderNsmEasyCharts(model);
        renderNsmWeeklyScoreChart(model);
        renderNsmSubtCharts(model);
        return;
    }

    destroyNsmEasyCharts();
    destroyNsmWeeklyScoreChart();
    destroyNsmSubtCharts();

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
            ${renderRunPlusSubviewNav(subview)}
            ${renderDiagnosisOverview(model)}
            ${renderStatCards(model)}
            ${sectionGroupsHtml}
            ${auxiliaryHtml}
        </div>
    `;

    publishRunPlusDiagnostics(root, model.diagnostics);
    publishRunPlusNsm(root, model.nsm);

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
