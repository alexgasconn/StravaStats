// js/preprocessing.js
import { rollingMean, calculateEnvironmentalDifficulty } from '../utils/index.js';

// ===================================================================
// CONFIGURACIÓN
// ===================================================================
const SUFFER_TO_TSS = 1;
const MAX_HR_DEFAULT = 190;

// Indoor swim correction for a known historical pool length misconfiguration
// (recorded as 25m, actual 20m) for a specific athlete and date window.
const INDOOR_SWIM_DISTANCE_CORRECTION = 20 / 25;
const INDOOR_SWIM_CORRECTION_TAG = 'piscina-20m';
const INDOOR_SWIM_CORRECTION_CUTOFF = '2025-08-19';
const TARGET_ATHLETE_ID = 66914681;

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function isTargetAthleteAlexGascon(userProfile = {}) {
    let profile = userProfile || {};

    // Fallback to cached athlete profile if API athlete fetch was unavailable.
    if ((!profile.firstname && !profile.lastname && !profile.username) && typeof localStorage !== 'undefined') {
        try {
            const cached = JSON.parse(localStorage.getItem('strava_athlete_data') || 'null');
            if (cached) profile = cached;
        } catch (_err) {
            // ignore malformed cache
        }
    }

    const first = normalizeText(profile.firstname);
    const last = normalizeText(profile.lastname);
    const fullName = `${first} ${last}`.trim();
    const username = normalizeText(profile.username);
    const athleteId = Number(profile.id);

    return athleteId === TARGET_ATHLETE_ID || fullName === 'alex gascon' || username === 'gascn_alex' || username === 'alexgasconn' || username === 'alexgascon';
}

function isDateOnOrBeforeCutoff(activity, cutoffIsoDate) {
    const datePart = String(activity?.start_date_local || activity?.start_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return false;
    return datePart <= cutoffIsoDate;
}

function isIndoorPoolSwim(activity) {
    const sportType = String(activity?.sport_type || activity?.type || '');
    if (!/swim/i.test(sportType) || /openwater/i.test(sportType)) return false;

    if (activity?.trainer === true) return true;

    const hasStartLatLng = Array.isArray(activity?.start_latlng) && activity.start_latlng.length === 2;
    return !hasStartLatLng;
}

function addTag(activity, tag) {
    if (!Array.isArray(activity.tags)) {
        activity.tags = [];
    }
    if (!activity.tags.includes(tag)) {
        activity.tags.push(tag);
    }
}

function applyIndoorSwimPool20mCorrection(activities, userProfile = {}) {
    if (!isTargetAthleteAlexGascon(userProfile)) {
        return;
    }

    activities.forEach(activity => {
        if (!isIndoorPoolSwim(activity)) return;
        if (!isDateOnOrBeforeCutoff(activity, INDOOR_SWIM_CORRECTION_CUTOFF)) return;

        const originalDistance = Number(activity.distance) || 0;
        const originalMovingTime = Number(activity.moving_time) || 0;

        if (originalDistance > 0) {
            activity.distance = Math.max(1, Math.round(originalDistance * INDOOR_SWIM_DISTANCE_CORRECTION));
        }

        if (originalMovingTime > 0 && activity.distance > 0) {
            // Recompute speed from corrected distance to keep pace coherent everywhere.
            activity.average_speed = activity.distance / originalMovingTime;
        } else if (Number(activity.average_speed) > 0) {
            activity.average_speed = Number(activity.average_speed) * INDOOR_SWIM_DISTANCE_CORRECTION;
        }

        if (Number(activity.max_speed) > 0) {
            activity.max_speed = Number(activity.max_speed) * INDOOR_SWIM_DISTANCE_CORRECTION;
        }

        activity.pool_length = 20;
        addTag(activity, INDOOR_SWIM_CORRECTION_TAG);
    });
}

// ===================================================================
// Pool length estimation for all swim activities
// ===================================================================
const STANDARD_POOL_LENGTHS = [20, 25, 50];

function estimatePoolLengths(activities) {
    const swims = activities.filter(a => {
        const t = (a.sport_type || a.type || '').toLowerCase();
        return t.includes('swim') && !t.includes('openwater');
    });
    if (!swims.length) return;

    // Build historical frequency of which pool lengths appear
    const historicalCounts = { 20: 0, 25: 0, 50: 0 };
    swims.forEach(a => {
        if (a.pool_length) { historicalCounts[a.pool_length] = (historicalCounts[a.pool_length] || 0) + 1; return; }
        if (!a.distance) return;
        const candidates = STANDARD_POOL_LENGTHS.filter(p => a.distance % p === 0);
        if (candidates.length === 1) historicalCounts[candidates[0]]++;
    });

    // Assign pool_length to swims that don't have it yet
    swims.forEach(a => {
        if (a.pool_length) return; // Already set (e.g. by 20m correction)
        if (!a.distance || !a.moving_time) return;

        const candidates = STANDARD_POOL_LENGTHS.filter(p => {
            if (a.distance % p !== 0) return false;
            const lengths = a.distance / p;
            const timePerLength = a.moving_time / lengths;
            // Realistic time per length: 15-120 seconds
            return timePerLength >= 15 && timePerLength <= 120;
        });

        if (candidates.length === 1) {
            a.pool_length = candidates[0];
        } else if (candidates.length > 1) {
            // Use historical frequency to pick most likely
            candidates.sort((x, y) => (historicalCounts[y] || 0) - (historicalCounts[x] || 0));
            a.pool_length = candidates[0];
        }
    });
}

// ===================================================================
// WEATHER API FUNCTION
// ===================================================================
function numericSafe(v) {
    return v === null || v === undefined || isNaN(v) ? 0 : Number(v);
}

const WEATHER_REQUEST_TIMEOUT_MS = 4000; // abort individual request after 4 s
const WEATHER_TOTAL_TIMEOUT_MS = 12000;  // stop fetching weather after 12 s total

function isDemoModeFromStorage() {
    try {
        if (typeof sessionStorage !== 'undefined') {
            return sessionStorage.getItem('strava_demo_mode') === 'true';
        }
    } catch (_e) {
        // ignore and fallback
    }
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('strava_demo_mode') === 'true';
}

async function getWeatherForRun(run) {
    if (!run.start_latlng || run.start_latlng.length < 2) {
        return null;
    }

    const [lat, lon] = run.start_latlng;
    const start = new Date(run.start_date_local);
    const dateStr = start.toISOString().split("T")[0];

    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,weathercode,cloudcover,surface_pressure,relativehumidity_2m&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`;

    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), WEATHER_REQUEST_TIMEOUT_MS);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timerId);
        if (!res.ok) throw new Error(`HTTP ${res.status} - ${res.statusText}`);
        const data = await res.json();

        if (!data.hourly || !data.hourly.time || !data.hourly.time.length) {
            return null;
        }

        const hour = start.getHours();
        let idx = data.hourly.time.findIndex(t => new Date(t).getHours() === hour);

        if (idx === -1) {
            idx = Math.min(hour, data.hourly.time.length - 1);
        }

        const weather = {
            temperature: numericSafe(data.hourly.temperature_2m[idx]),
            precipitation: numericSafe(data.hourly.precipitation[idx]),
            wind_speed: numericSafe(data.hourly.wind_speed_10m[idx]),
            wind_direction: numericSafe(data.hourly.wind_direction_10m[idx]),
            weather_code: data.hourly.weathercode ? data.hourly.weathercode[idx] : null,
            humidity: numericSafe(data.hourly.relativehumidity_2m ? data.hourly.relativehumidity_2m[idx] : null),
            cloudcover: numericSafe(data.hourly.cloudcover ? data.hourly.cloudcover[idx] : null),
            pressure: numericSafe(data.hourly.surface_pressure ? data.hourly.surface_pressure[idx] : null),
        };

        const difficulty = calculateEnvironmentalDifficulty({ weather });

        return { ...weather, difficulty };

    } catch (err) {
        clearTimeout(timerId);
        // AbortError means timeout — silent skip; log other errors
        if (err.name !== 'AbortError') {
            console.warn(`Weather fetch for ${run.name} (${dateStr}) failed:`, err);
        }
        return null;
    }
}

// ===================================================================
// 1. TSS: hrTSS = (minutes/60) × (avgHR/maxHR)² × 100 × sportMultiplier
// ===================================================================
//
// Sport hardness per minute at a given HR (from hardest to easiest):
//  1. HIIT           1.20  – extreme metabolic disruption, eccentric damage
//  2. Trail Running  1.12  – running + elevation + technical terrain
//  3. Running        1.08  – weight-bearing, high impact
//  4. Soccer         1.05  – running + agility + direction changes
//  5. Hiking         0.95  – weight-bearing sustained, elevation
//  6. Cycling/Ride   0.90  – non-weight-bearing, mechanically efficient
//  7. Gravel/MTB     0.92  – cycling + vibration + technical
//  8. Workout (gen)  0.78  – mixed moderate
//  9. Weight Train.  0.72  – intermittent, lots of recovery between sets
// 10. Swimming       0.65  – no impact, HR suppressed in water
// 11. Alpine Ski     0.62  – lots of lift time, intermittent
// 12. Walking        0.52  – low impact
// 13. Yoga           0.35  – minimal metabolic stress
//
const SPORT_TSS_MULTIPLIER = {
    // Runs
    Run: 1.07,
    VirtualRun: 1.05,
    TrailRun: 1.15,
    // Cycling
    Ride: 0.78,
    VirtualRide: 0.66,
    GravelRide: 0.80,
    MountainBikeRide: 0.85,
    EBikeRide: 0.71,
    // Water
    Swim: 0.75,
    PoolSwim: 0.75,
    OpenWaterSwim: 2.0, // Open water rule: final TSS multiplier ×2
    // Team/field
    Soccer: 1.05,
    // Hiking & walking
    Hike: 0.93,
    Walk: 0.52,
    // Gym & fitness
    WeightTraining: 0.73,
    Workout: 0.78,
    HIIT: 1.15,
    Crossfit: 1.10,
    Yoga: 0.35,
    // Winter
    AlpineSki: 0.62,
    NordicSki: 0.80,
    Snowboard: 0.58,
    // Other
    Rowing: 0.82,
    Kayaking: 0.70,
    IceSkate: 0.65,
};

function getSportMultiplier(activity) {
    const sportType = activity.sport_type || activity.type || '';
    return SPORT_TSS_MULTIPLIER[sportType] ?? 0.80;
}

// Zone-weighted intensity factor using athlete's actual HR zones from Strava.
// Each zone gets a physiological weight that reflects the exponential cost of
// training at higher %maxHR.  If the athlete's average HR sits inside zone N,
// the weight for that zone is used as the squared-IF equivalent.
//
// Strava zones format: [{min, max}, ...] (5 zones, zone 5 max = -1 meaning ∞)
//
// Zone weights (loosely mapped to TRIMP zone factors):
//   Z1  0.40   Recovery / very easy
//   Z2  0.55   Endurance / aerobic
//   Z3  0.72   Tempo
//   Z4  0.88   Threshold
//   Z5  1.05   VO2max / anaerobic
const ZONE_WEIGHTS = [0.40, 0.55, 0.72, 0.88, 1.05];

function hrZoneIntensity(avgHR, hrZones) {
    if (!hrZones || !hrZones.length || !avgHR) return null;

    for (let i = 0; i < hrZones.length; i++) {
        const zoneMax = hrZones[i].max === -1 ? Infinity : hrZones[i].max;
        if (avgHR >= hrZones[i].min && avgHR < zoneMax) {
            const weight = ZONE_WEIGHTS[i] ?? ZONE_WEIGHTS[ZONE_WEIGHTS.length - 1];
            // Interpolate within the zone for finer resolution
            const zoneRange = (zoneMax === Infinity) ? 20 : (zoneMax - hrZones[i].min);
            const posInZone = zoneRange > 0 ? (avgHR - hrZones[i].min) / zoneRange : 0.5;
            const nextWeight = ZONE_WEIGHTS[Math.min(i + 1, ZONE_WEIGHTS.length - 1)];
            return weight + posInZone * (nextWeight - weight);
        }
    }
    // Above all zones → cap at Z5 weight
    return ZONE_WEIGHTS[ZONE_WEIGHTS.length - 1];
}

function calculateTSS(activity, maxHr = MAX_HR_DEFAULT, hrZones = null) {
    const minutes = (activity.moving_time || 0) / 60;
    if (minutes <= 0) {
        activity.tss = 0;
        activity.tss_method = 'none';
        return 0;
    }

    const hours = minutes / 60;
    const sportMult = getSportMultiplier(activity);
    let tss = 0;
    let method = 'none';

    // --- Primary: power-based (NP if available) ---
    if (activity.average_watts > 0 && activity.ftp > 0) {
        const IF = activity.average_watts / activity.ftp;
        tss = hours * IF * IF * 100 * sportMult;
        method = 'power';
    }

    // --- Secondary: HR-based using athlete zones when available ---
    if (method === 'none' && activity.average_heartrate > 0) {
        const zoneIF = hrZoneIntensity(activity.average_heartrate, hrZones);
        if (zoneIF !== null) {
            // Zone-weighted: the zoneIF already represents an IF²-equivalent
            tss = hours * zoneIF * 100 * sportMult;
            method = 'heartrate_zones';
        } else {
            // Fallback: simple ratio² against maxHR
            const hrRatio = activity.average_heartrate / maxHr;
            tss = hours * hrRatio * hrRatio * 100 * sportMult;
            method = 'heartrate';
        }
    }

    // --- Tertiary: suffer_score ---
    if (method === 'none' && activity.suffer_score > 0) {
        tss = activity.suffer_score * SUFFER_TO_TSS * sportMult;
        method = 'suffer_score';
    }

    // --- Last resort: time-only estimate ---
    if (method === 'none') {
        tss = hours * 36 * sportMult;
        method = 'time';
    }

    // Long low-intensity correction: taper down beyond 4 h at low IF
    if (hours > 4 && activity.average_heartrate > 0) {
        const hrRatio = activity.average_heartrate / maxHr;
        if (hrRatio < 0.7) {
            tss *= Math.max(0.7, 1 - 0.05 * (hours - 4));
        }
    }

    if (isNaN(tss)) tss = 0;
    activity.tss = +tss.toFixed(2);
    activity.tss_method = method;
    return activity.tss;
}

// ===================================================================
// 2. VO₂max: solo running (ACSM + HR)
// ===================================================================
function computeVO2max(activity, maxHr = MAX_HR_DEFAULT) {
    if (activity.type !== 'Run' || !activity.distance || activity.moving_time < 600) {
        activity.vo2max = null;
        return;
    }

    const speedMperMin = (activity.distance / activity.moving_time) * 60;
    const vo2 = -4.60 + 0.182258 * speedMperMin + 0.000104 * speedMperMin ** 2;
    const hrFraction = activity.average_heartrate ? activity.average_heartrate / maxHr : 0.8;
    const vo2max = vo2 / hrFraction;

    activity.vo2max = (vo2max > 25 && vo2max < 90) ? +vo2max.toFixed(2) : null;
}

// ===================================================================
// 3. Agrupar por día (con weather para runs)
// ===================================================================
async function groupByDay(activities) {
    const daily = {};
    const runs = activities.filter(a => a.type === 'Run' && a.start_latlng);

    // Demo data already includes synthetic weather fields and should avoid network/weather logs.
    if (isDemoModeFromStorage()) {
        activities.forEach(a => {
            const date = a.start_date_local?.split('T')[0];
            if (!date) return;

            computeVO2max(a);

            if (!daily[date]) {
                daily[date] = { tss: 0, count: 0 };
            }
            daily[date].tss += a.tss;
            daily[date].count += 1;
        });
        return daily;
    }

    // Fetch weather in batches with a hard total-time cap
    const batches = 5;
    const weatherStart = Date.now();
    for (let i = 0; i < runs.length; i += batches) {
        if (Date.now() - weatherStart > WEATHER_TOTAL_TIMEOUT_MS) {
            console.warn(`[Weather] Total timeout reached after ${WEATHER_TOTAL_TIMEOUT_MS}ms — skipping remaining ${runs.length - i} runs`);
            break;
        }
        const batch = runs.slice(i, i + batches);
        const weatherPromises = batch.map(run => getWeatherForRun(run));
        const weatherResults = await Promise.all(weatherPromises);

        batch.forEach((run, idx) => {
            const weather = weatherResults[idx];
            if (weather) {
                run.weather = weather;
                run.difficulty = weather.difficulty;
            } else {
                run.difficulty = 0; // default
            }
        });

        // Sleep to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    activities.forEach(a => {
        const date = a.start_date_local?.split('T')[0];
        if (!date) return;

        computeVO2max(a);

        if (!daily[date]) {
            daily[date] = { tss: 0, count: 0 };
        }
        daily[date].tss += a.tss;
        daily[date].count += 1;
    });

    return daily;
}

// ===================================================================
// 4. Serie temporal
// ===================================================================
function getTimeSeries(daily) {
    const dates = Object.keys(daily).sort();
    const tssValues = dates.map(d => daily[d].tss);
    return { dates, tssValues };
}

// ===================================================================
// 5. PMC: ATL (7d), CTL (42d), TSB, Ramp Rate
// ===================================================================
function calculatePMC(tssSeries) {
    const atl = rollingMean(tssSeries, 7);
    const ctl = rollingMean(tssSeries, 42);
    const tsb = [];
    const rampRate = [0];

    for (let i = 0; i < tssSeries.length; i++) {
        const a = atl[i];
        const c = ctl[i];
        // Canonical TSB sign: form = CTL - ATL (negative means fatigue, positive means freshness)
        tsb.push(+(c - a).toFixed(1));

        if (i > 0) {
            rampRate.push(+(c - ctl[i - 1]).toFixed(1));
        }
    }

    return { atl, ctl, tsb, rampRate, tssSeries };
}

// ===================================================================
// 6. INJURY RISK (adaptive percentile-based)
// ===================================================================
function calculateInjuryRiskImproved(tsb, rampRate, atl, tssSeries) {
    const riskHistory = [];
    const len = tsb.length;

    // Helper: percentil relativo al historial
    const percentile = (arr, val) => {
        const filtered = arr.filter(x => !isNaN(x));
        if (!filtered.length) return 0.5;
        const sorted = filtered.sort((a, b) => a - b);
        let count = 0;
        for (const x of sorted) if (x <= val) count++;
        return count / sorted.length;
    }

    for (let i = 0; i < len; i++) {
        // --- 1. TSB relativo (fatiga) ---
        const tsbWindow = tsb.slice(Math.max(0, i - 42), i + 1);
        const tsbPerc = 1 - percentile(tsbWindow, tsb[i]); // más negativo → más riesgo
        let risk = 0.6 * Math.pow(tsbPerc, 1.5); // efecto no lineal

        // --- 2. Ramp Rate relativo ---
        const rrWindow = rampRate.slice(Math.max(0, i - 14), i + 1);
        const rrPerc = percentile(rrWindow, rampRate[i]);
        risk += 0.25 * Math.pow(rrPerc, 1.3) * tsbPerc; // interacción: ramp fuerte + fatiga

        // --- 3. ATL relativo (carga aguda) ---
        const atlWindow = atl.slice(Math.max(0, i - 7), i + 1);
        const atlPerc = percentile(atlWindow, atl[i]);
        risk += 0.15 * Math.pow(atlPerc, 1.2);

        // --- 4. Variabilidad reciente ---
        const recent = tssSeries.slice(Math.max(0, i - 6), i + 1);
        if (recent.length > 1) {
            const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
            if (!isNaN(mean) && mean > 0) {
                const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
                const cv = Math.sqrt(variance) / mean;
                risk *= 1 + Math.min(cv, 1) * 0.3; // hasta +30% si CV alto
            }
        }

        // --- Normalizar a [0,1] ---
        risk = Math.min(Math.max(risk, 0), 1);

        // --- Suavizado EWMA adaptativo ---
        if (i > 0) {
            const prev = riskHistory[i - 1];
            const alpha = 0.2 + 0.5 * Math.min(1, Math.abs(risk - prev));
            risk = prev * (1 - alpha) + risk * alpha;
        }

        if (isNaN(risk)) risk = 0;
        riskHistory.push(+risk.toFixed(3));
    }

    return riskHistory;
}

// ===================================================================
// 6b. RECOVERY HOURS (based on TSS, sport factor, HR zone, duration, TSB)
// ===================================================================
const RECOVERY_SPORT_FACTORS = {
    Run: 1.2,
    TrailRun: 1.5,
    Ride: 0.9,
    MountainBikeRide: 1.1,
    Swim: 0.7,
    WeightTraining: 1.0,
    Soccer: 1.1,
    Padel: 0.8,
    AlpineSki: 0.8,
    Hike: 0.7,
    Rowing: 1.0,
    Walk: 0.4,
    Workout: 0.8,
    VirtualRun: 1.1,
    VirtualRide: 0.85,
    GravelRide: 0.95,
    EBikeRide: 0.75,
};

const RECOVERY_HR_ZONE_MULTIPLIERS = {
    1: 0.60, // Z1: recovery
    2: 0.85, // Z2: aerobic easy
    3: 1.00, // Z3: aerobic base
    4: 1.25, // Z4: threshold
    5: 1.50, // Z5: max effort
};

function getRecoverySportFactor(activity) {
    const sport = activity.sport_type || activity.type || 'Run';
    return RECOVERY_SPORT_FACTORS[sport] ?? 1.0;
}

function getRecoveryHrZone(avgHr, maxHr) {
    if (!avgHr || !maxHr || avgHr <= 0 || maxHr <= 0) return 3; // default Z3
    const pct = avgHr / maxHr;
    if (pct < 0.60) return 1;
    if (pct < 0.70) return 2;
    if (pct < 0.80) return 3;
    if (pct < 0.90) return 4;
    return 5;
}

function calculateRecoveryHours(activity, maxHr = MAX_HR_DEFAULT) {
    if (!activity) return 4;

    const tss = activity.tss || 30; // fallback
    const durHours = (activity.moving_time || 3600) / 3600;
    const avgHr = activity.average_heartrate;
    const tsb = activity.tsb ?? null;

    const sf = getRecoverySportFactor(activity);
    const zone = getRecoveryHrZone(avgHr, maxHr);
    const hm = RECOVERY_HR_ZONE_MULTIPLIERS[zone];
    const df = Math.sqrt(durHours);

    let raw = (tss * sf * hm * df) / 10;

    // Ajuste por TSB acumulado
    if (typeof tsb === 'number' && !isNaN(tsb)) {
        if (tsb <= -20) raw += 24;
        else if (tsb <= -10) raw += 12;
    }

    return Math.round(Math.min(Math.max(raw, 4), 96));
}

function calculateDailyRecovery(activitiesArray) {
    if (!activitiesArray || !activitiesArray.length) return 0;
    if (activitiesArray.length === 1) return calculateRecoveryHours(activitiesArray[0]);

    const hours = activitiesArray.map(a => calculateRecoveryHours(a));
    const maxH = Math.max(...hours);
    const rest = hours.filter(h => h !== maxH);
    const combined = maxH * 0.7 + (rest.length > 0 ? rest.reduce((s, h) => s + h, 0) * 0.3 : 0);
    const penalty = 1.0 + (hours.length - 1) * 0.12;
    return Math.round(Math.min(combined * penalty, 96));
}

function calculateRecoveryHoursSeries(activities, dates) {
    const dailyMap = {};

    // Initialize daily buckets
    dates.forEach(date => {
        dailyMap[date] = [];
    });

    // Group activities by date
    activities.forEach(a => {
        const date = a.start_date_local?.split('T')[0];
        if (date && dailyMap[date]) {
            dailyMap[date].push(a);
        }
    });

    // Calculate daily recovery for each date
    const recoveryHours = dates.map(date => {
        return calculateDailyRecovery(dailyMap[date]);
    });

    return recoveryHours;
}

// ===================================================================
// 7. Asignar métricas
// ===================================================================
function getSportCategory(activity) {
    const sportType = activity.sport_type || activity.type || '';
    if (/Run/i.test(sportType)) return 'run';
    if (/Swim/i.test(sportType)) return 'swim';
    if (/Ride|Bike|Cycling/i.test(sportType)) return 'bike';
    return null;
}

function computeEfficiencyFields(activity) {
    const distance = Number(activity.distance) || 0;
    const movingTime = Number(activity.moving_time) || 0;
    const avgHr = Number(activity.average_heartrate) || 0;

    if (!avgHr || distance <= 0 || movingTime <= 0) {
        return { efficiency: null, method: null };
    }

    const category = getSportCategory(activity);
    if (category === 'run') {
        const paceMinPerKm = (movingTime / 60) / (distance / 1000);
        return { efficiency: paceMinPerKm / avgHr, method: 'pace_per_hr' };
    }
    if (category === 'swim') {
        const paceMinPer100m = (movingTime / 60) / (distance / 100);
        return { efficiency: paceMinPer100m / avgHr, method: 'pace100m_per_hr' };
    }
    if (category === 'bike') {
        const avgSpeedKmh = (distance / 1000) / (movingTime / 3600);
        return { efficiency: avgSpeedKmh / avgHr, method: 'speed_per_hr' };
    }
    return { efficiency: null, method: null };
}

function assignMetrics(activities, dates, pmc, injuryRisk, recoveryHours) {
    const map = Object.fromEntries(dates.map((d, i) => [d, i]));

    activities.forEach(a => {
        const date = a.start_date_local?.split('T')[0];
        const i = map[date];
        if (i !== undefined) {
            a.atl = +pmc.atl[i].toFixed(1);
            a.ctl = +pmc.ctl[i].toFixed(1);
            a.tsb = +pmc.tsb[i].toFixed(1);
            a.injuryRisk = +injuryRisk[i].toFixed(3); // 3 decimales para precisión
            a.recovery_hours = recoveryHours[i] ?? 4;
        } else {
            a.atl = a.ctl = a.tsb = a.injuryRisk = a.recovery_hours = null;
        }

        const elapsed = Number(a.elapsed_time) || 0;
        const moving = Number(a.moving_time) || 0;
        a.moving_ratio = elapsed > 0 ? moving / elapsed : null;

        const { efficiency, method } = computeEfficiencyFields(a);
        a.efficiency = efficiency;
        a.efficiency_method = method;
    });
}

// ===================================================================
// 8. Pipeline principal
// ===================================================================
export async function preprocessActivities(activities, userProfile = {}, zones = null, gears = null) {
    if (!activities?.length) return [];

    applyIndoorSwimPool20mCorrection(activities, userProfile);
    estimatePoolLengths(activities);

    // Derive maxHR from zones if available (last zone's max), fallback to profile, then default
    let maxHr = MAX_HR_DEFAULT;
    let hrZones = null;

    if (zones?.heart_rate?.zones) {
        hrZones = zones.heart_rate.zones;
        const lastZoneMax = hrZones[hrZones.length - 1]?.max;
        if (lastZoneMax && lastZoneMax > 0 && lastZoneMax !== -1) {
            maxHr = lastZoneMax;
        }
    }
    if (userProfile.max_hr) {
        maxHr = userProfile.max_hr;
    }

    activities.forEach(a => calculateTSS(a, maxHr, hrZones));

    const daily = await groupByDay(activities);
    const { dates, tssValues } = getTimeSeries(daily);
    const pmc = calculatePMC(tssValues);
    const injuryRisk = calculateInjuryRiskImproved(pmc.tsb, pmc.rampRate, pmc.atl, pmc.tssSeries);
    const recoveryHours = calculateRecoveryHoursSeries(activities, dates);

    assignMetrics(activities, dates, pmc, injuryRisk, recoveryHours);

    return activities;
}