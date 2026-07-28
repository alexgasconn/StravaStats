/**
 * Demo Data Generator
 * Generates 250 realistic fictional Strava activities with polylines, streams, and weather data
 */

import { DEMO_POLYLINES } from './polylines.js';

export const DEFAULT_DEMO_SEED = 20260728;
export const DEFAULT_DEMO_REFERENCE_DATE = '2026-07-28T12:00:00.000Z';

function createSeededRandom(seed) {
    let state = Number(seed) >>> 0;
    if (state === 0) state = DEFAULT_DEMO_SEED;

    return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

let demoRandom = createSeededRandom(DEFAULT_DEMO_SEED);

const ACTIVITY_TYPES = [
    // MUCHO
    { type: 'Run', sport: 'Run', ratio: 0.18, distRange: [3, 25], speedRange: [10, 16] },
    { type: 'WeightTraining', sport: 'WeightTraining', ratio: 0.15, distRange: [0, 1], speedRange: [0, 2] },
    { type: 'Swim', sport: 'Swim', ratio: 0.15, distRange: [1, 5], speedRange: [1.5, 3] },
    { type: 'Ride', sport: 'Ride', ratio: 0.15, distRange: [15, 120], speedRange: [18, 35] },
    // MEDIO
    { type: 'MountainBikeRide', sport: 'MountainBikeRide', ratio: 0.08, distRange: [10, 80], speedRange: [12, 28] },
    { type: 'Hike', sport: 'Hike', ratio: 0.08, distRange: [5, 30], speedRange: [3, 6] },
    // POCO
    { type: 'TrailRun', sport: 'TrailRun', ratio: 0.04, distRange: [5, 30], speedRange: [8, 14] },
    { type: 'Padel', sport: 'Padel', ratio: 0.04, distRange: [1, 2], speedRange: [1, 2] },
    { type: 'Soccer', sport: 'Soccer', ratio: 0.04, distRange: [5, 12], speedRange: [8, 12] },
    { type: 'AlpineSki', sport: 'AlpineSki', ratio: 0.04, distRange: [10, 60], speedRange: [20, 40] },
    { type: 'Walk', sport: 'Walk', ratio: 0.05, distRange: [2, 15], speedRange: [3, 5] },
];

// Centralized statistical profiles (easy to tweak per sport)
const ACTIVITY_STAT_MODELS = {
    Run: {
        distanceKm: { mean: 11, stdDev: 10, min: 2, max: 42 },
        speedKmh: { mean: 12.4, stdDev: 1.4, min: 9, max: 18 },
        elevationMeters: { mean: 120, stdDev: 90, min: 0, max: 700 },
        avgHr: { mean: 151, stdDev: 8, min: 128, max: 175 },
        maxHr: { mean: 182, stdDev: 6, min: 165, max: 198 },
    },
    WeightTraining: {
        distanceKm: { mean: 0, stdDev: 0, min: 0, max: 0 },
        durationMin: { mean: 62, stdDev: 18, min: 25, max: 130 },
        avgHr: { mean: 122, stdDev: 10, min: 95, max: 145 },
        maxHr: { mean: 161, stdDev: 10, min: 130, max: 190 },
    },
    Swim: {
        distanceKm: { mean: 2.4, stdDev: 0.95, min: 1, max: 5 },
        // 1:50-2:30 per 100m => approx 3.27-2.40 km/h
        speedKmh: { mean: 2.85, stdDev: 0.2, min: 2.4, max: 3.27 },
        avgHr: { mean: 143, stdDev: 9, min: 118, max: 170 },
        maxHr: { mean: 173, stdDev: 8, min: 150, max: 196 },
    },
    Ride: {
        distanceKm: { mean: 58, stdDev: 22, min: 15, max: 140 },
        speedKmh: { mean: 27, stdDev: 3.5, min: 17, max: 42 },
        elevationMeters: { mean: 620, stdDev: 280, min: 90, max: 2200 },
        avgHr: { mean: 142, stdDev: 10, min: 110, max: 172 },
        maxHr: { mean: 176, stdDev: 8, min: 150, max: 198 },
        avgWatts: { mean: 230, stdDev: 45, min: 120, max: 380 },
        weightedWatts: { mean: 248, stdDev: 45, min: 130, max: 420 },
        maxWatts: { mean: 640, stdDev: 110, min: 300, max: 1100 },
    },
    MountainBikeRide: {
        distanceKm: { mean: 33, stdDev: 14, min: 8, max: 95 },
        speedKmh: { mean: 18, stdDev: 3.2, min: 10, max: 30 },
        elevationMeters: { mean: 710, stdDev: 340, min: 120, max: 2400 },
        avgHr: { mean: 149, stdDev: 10, min: 118, max: 178 },
        maxHr: { mean: 184, stdDev: 8, min: 155, max: 199 },
        avgWatts: { mean: 215, stdDev: 42, min: 110, max: 360 },
        weightedWatts: { mean: 233, stdDev: 42, min: 120, max: 390 },
        maxWatts: { mean: 610, stdDev: 100, min: 290, max: 980 },
    },
    Hike: {
        distanceKm: { mean: 14, stdDev: 6, min: 4, max: 35 },
        speedKmh: { mean: 4.7, stdDev: 0.9, min: 2.6, max: 7.5 },
        elevationMeters: { mean: 420, stdDev: 230, min: 20, max: 1700 },
        avgHr: { mean: 127, stdDev: 10, min: 95, max: 158 },
        maxHr: { mean: 162, stdDev: 9, min: 132, max: 190 },
    },
    TrailRun: {
        distanceKm: { mean: 13, stdDev: 5.5, min: 5, max: 35 },
        speedKmh: { mean: 10.2, stdDev: 1.7, min: 6.5, max: 16 },
        elevationMeters: { mean: 520, stdDev: 280, min: 60, max: 1800 },
        avgHr: { mean: 152, stdDev: 8, min: 126, max: 178 },
        maxHr: { mean: 186, stdDev: 7, min: 160, max: 199 },
    },
    Padel: {
        distanceKm: { mean: 1.2, stdDev: 0.3, min: 0.5, max: 2.5 },
        speedKmh: { mean: 1.8, stdDev: 0.4, min: 0.8, max: 3.4 },
        durationMin: { mean: 82, stdDev: 18, min: 40, max: 150 },
        avgHr: { mean: 132, stdDev: 10, min: 100, max: 165 },
        maxHr: { mean: 170, stdDev: 10, min: 136, max: 197 },
    },
    Soccer: {
        distanceKm: { mean: 4, stdDev: 1.5, min: 2.5, max: 6 },
        speedKmh: { mean: 9.8, stdDev: 1.6, min: 6, max: 14.5 },
        durationMin: { mean: 78, stdDev: 15, min: 40, max: 120 },
        avgHr: { mean: 147, stdDev: 9, min: 120, max: 175 },
        maxHr: { mean: 186, stdDev: 8, min: 158, max: 199 },
    },
    AlpineSki: {
        distanceKm: { mean: 27, stdDev: 13, min: 8, max: 75 },
        durationMin: { mean: 300, stdDev: 100, min: 150, max: 450 },
        speedKmh: { mean: 31, stdDev: 5, min: 18, max: 52 },
        elevationMeters: { mean: 1050, stdDev: 420, min: 160, max: 2600 },
        avgHr: { mean: 136, stdDev: 10, min: 104, max: 168 },
        maxHr: { mean: 171, stdDev: 8, min: 144, max: 197 },
    },
    Walk: {
        distanceKm: { mean: 7.2, stdDev: 2.8, min: 2, max: 18 },
        speedKmh: { mean: 4.7, stdDev: 0.6, min: 3, max: 6.8 },
        elevationMeters: { mean: 80, stdDev: 60, min: 0, max: 350 },
        avgHr: { mean: 108, stdDev: 10, min: 82, max: 145 },
        maxHr: { mean: 138, stdDev: 10, min: 100, max: 178 },
    },
};

const GEAR_LIST = [
    { id: 'shoe_1', name: 'Nike Vaporfly', type: 'Shoes', brand: 'Nike' },
    { id: 'shoe_2', name: 'ASICS Gel Kayano', type: 'Shoes', brand: 'ASICS' },
    { id: 'bike_1', name: 'Trek Madone', type: 'Bike', brand: 'Trek' },
    { id: 'bike_2', name: 'Canyon Gravel', type: 'Bike', brand: 'Canyon' },
];

const WEATHER_CONDITIONS = [
    'Clear', 'Partly cloudy', 'Mostly cloudy', 'Overcast',
    'Light rain', 'Moderate rain', 'Heavy rain', 'Thunderstorm'
];

const SPANISH_CITIES = [
    { name: 'Madrid', lat: 40.4168, lng: -3.7038 },
    { name: 'Barcelona', lat: 41.3851, lng: 2.1734 },
    { name: 'Valencia', lat: 39.4699, lng: -0.3763 },
    { name: 'Sevilla', lat: 37.3886, lng: -5.9823 },
    { name: 'Bilbao', lat: 43.2627, lng: -2.9253 },
    { name: 'Malaga', lat: 36.7213, lng: -4.4214 },
    { name: 'Alicante', lat: 38.3452, lng: -0.4810 },
    { name: 'Granada', lat: 37.1882, lng: -3.6385 },
];

const SWIM_POOL_LENGTHS_METERS = [20, 25, 50];

function randomBetween(min, max) {
    return demoRandom() * (max - min) + min;
}

function randomInt(min, max) {
    return Math.floor(demoRandom() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function sampleNormal(mean, stdDev) {
    // Box-Muller transform
    let u = 0;
    let v = 0;
    while (u === 0) u = demoRandom();
    while (v === 0) v = demoRandom();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleStat(statDef, fallbackMin, fallbackMax) {
    if (!statDef) {
        return randomBetween(fallbackMin, fallbackMax);
    }
    const sampled = sampleNormal(statDef.mean, statDef.stdDev);
    return clamp(sampled, statDef.min, statDef.max);
}

function getRandomCity() {
    return SPANISH_CITIES[Math.floor(demoRandom() * SPANISH_CITIES.length)];
}

function getRandomGear(type) {
    // Indoor activities without gear
    if (['WeightTraining', 'Padel', 'Soccer'].includes(type)) {
        return null;
    }
    // Cycling-related
    if (['Ride', 'MountainBikeRide', 'AlpineSki'].includes(type)) {
        return GEAR_LIST.find(g => g.type === 'Bike') || null;
    }
    // Running/walking/hiking
    return GEAR_LIST.find(g => g.type === 'Shoes') || null;
}

function generateDate(daysAgo, referenceDate) {
    const d = new Date(referenceDate);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    d.setUTCHours(randomInt(6, 20), randomInt(0, 59), 0, 0);
    return d;
}

function generatePolyline(activityType) {
    // Indoor/court activities without GPS tracking
    if (['WeightTraining', 'Padel', 'Soccer'].includes(activityType)) {
        return null;
    }

    // Determine which polyline category to use
    let category = 'Run';
    if (['Ride', 'MountainBikeRide', 'AlpineSki'].includes(activityType)) {
        category = 'Ride';
    } else if (activityType === 'Swim') {
        category = 'Swim';
    }

    const candidates = DEMO_POLYLINES[category] || DEMO_POLYLINES.Run;
    return candidates[Math.floor(demoRandom() * candidates.length)];
}

function generateWeatherData(dateObj) {
    const month = dateObj.getMonth();
    // Rough seasonal patterns for Spain
    let tempBase = 15;
    if (month >= 5 && month <= 8) tempBase = 28;
    else if (month >= 2 && month <= 4) tempBase = 18;
    else if (month >= 9 && month <= 10) tempBase = 22;

    const temp = Math.round(tempBase + randomBetween(-5, 5));
    const humidity = randomInt(30, 85);
    const windSpeed = randomBetween(0, 20);
    const rainfall = demoRandom() > 0.8 ? randomBetween(0.5, 10) : 0;
    const pressure = randomBetween(1010, 1030);
    const cloudCover = randomInt(0, 100);
    const condition = rainfall > 2 ? 'Rain' : cloudCover > 70 ? 'Overcast' : 'Clear';

    return {
        temperature: temp,
        humidity,
        wind_speed: windSpeed,
        precipitation: Math.round(rainfall * 10) / 10,
        pressure: Math.round(pressure * 10) / 10,
        cloud_cover: cloudCover,
        condition,
    };
}

function generateDistanceKm(activityConfig, statModel) {
    const baseDistance = sampleStat(
        statModel?.distanceKm,
        activityConfig.distRange[0],
        activityConfig.distRange[1]
    );

    // Si no es natación → devolver tal cual
    if (activityConfig.type !== 'Swim') {
        return baseDistance;
    }

    // 10% → distancia random sin ajustar
    const randomSwim = demoRandom() < 0.10;
    if (randomSwim) {
        return baseDistance;
    }

    // 90% → piscina realista
    const poolLength = SWIM_POOL_LENGTHS_METERS[
        randomInt(0, SWIM_POOL_LENGTHS_METERS.length - 1)
    ];

    const baseMeters = Math.round(baseDistance * 1000);

    // Redondear al múltiplo más cercano del largo de piscina
    const finalMeters = Math.max(
        poolLength,
        Math.round(baseMeters / poolLength) * poolLength
    );

    return finalMeters / 1000;
}


function generateElevationGain(activityType, statModel) {
    if (statModel?.elevationMeters) {
        return Math.round(sampleStat(statModel.elevationMeters, 0, 1000));
    }
    if (['Ride', 'MountainBikeRide', 'AlpineSki'].includes(activityType)) return randomInt(100, 1500);
    if (['Run', 'TrailRun', 'Hike', 'Walk'].includes(activityType)) return randomInt(0, 500);
    return 0;
}

function generateMovingTimeSeconds(activityType, distanceKm, speedKmh, statModel) {
    if (statModel?.durationMin && ['WeightTraining', 'Padel', 'Soccer'].includes(activityType)) {
        return Math.round(sampleStat(statModel.durationMin, 30, 120) * 60);
    }
    return Math.round((distanceKm / Math.max(0.3, speedKmh)) * 3600);
}

function formatActivityName(activityType, distanceKm) {
    const decimals = distanceKm < 10 ? 2 : 1;
    return `${activityType} - ${distanceKm.toFixed(decimals)}km`;
}

function generateStreams(distance, movingTime, elevation) {
    // Generate realistic point-by-point data (reduced for localStorage efficiency)
    const pointCount = Math.max(5, Math.min(100, Math.floor(movingTime / 5)));
    const streams = {
        distance: { data: [] },
        time: { data: [] },
        altitude: { data: [] },
        velocity_smooth: { data: [] },
        heartrate: { data: [] },
    };

    const timeStep = movingTime / pointCount;
    const distStep = distance / pointCount;
    const elevStep = elevation / pointCount;

    for (let i = 0; i < pointCount; i++) {
        const t = i * timeStep;
        const d = i * distStep;
        const el = Math.max(0, (i * elevStep) + randomBetween(-10, 10));
        const speedVar = randomBetween(0.8, 1.2);

        streams.time.data.push(Math.round(t));
        streams.distance.data.push(Math.round(d * 100) / 100);
        streams.altitude.data.push(Math.round(el));
        streams.velocity_smooth.data.push(Math.round(distStep / timeStep * speedVar * 100) / 100);
        streams.heartrate.data.push(randomInt(120, 180));
    }

    return streams;
}

export function generateDemoData({
    seed = DEFAULT_DEMO_SEED,
    referenceDate = DEFAULT_DEMO_REFERENCE_DATE,
} = {}) {
    demoRandom = createSeededRandom(seed);
    const referenceTimestamp = new Date(referenceDate);
    if (Number.isNaN(referenceTimestamp.getTime())) {
        throw new TypeError('referenceDate must be a valid date value');
    }

    const activities = [];
    const totalActivities = 500;
    const daysSpan = 730; // ~2 years of data

    for (let i = 0; i < totalActivities; i++) {
        const daysAgo = randomInt(0, daysSpan);
        const dateObj = generateDate(daysAgo, referenceTimestamp);
        const dateStr = dateObj.toISOString();
        const dateLocal = dateObj.toISOString().split('T')[0] + 'T' +
            String(dateObj.getUTCHours()).padStart(2, '0') + ':' +
            String(dateObj.getUTCMinutes()).padStart(2, '0') + ':00';

        // Pick activity type based on ratio
        let actType = 'Run';
        const r = demoRandom();
        let cumRatio = 0;
        for (const at of ACTIVITY_TYPES) {
            cumRatio += at.ratio;
            if (r < cumRatio) {
                actType = at.type;
                break;
            }
        }

        const actConfig = ACTIVITY_TYPES.find(a => a.type === actType);
        const statModel = ACTIVITY_STAT_MODELS[actType] || null;
        const distance = generateDistanceKm(actConfig, statModel);
        const speed = sampleStat(statModel?.speedKmh, actConfig.speedRange[0], actConfig.speedRange[1]);
        const movingTime = generateMovingTimeSeconds(actType, distance, speed, statModel);
        const elevation = generateElevationGain(actType, statModel);

        const gear = getRandomGear(actType);
        const city = getRandomCity();
        const weather = generateWeatherData(dateObj);
        const polylineData = generatePolyline(actType);
        const streams = generateStreams(distance, movingTime, elevation);

        const activity = {
            id: 1000000 + i,
            resource_state: 2,
            external_id: `demo_${i}`,
            upload_id: 10000000 + i,
            athlete: { id: 66914681, resource_state: 1 },
            name: formatActivityName(actType, distance),
            description: `Demo activity ${i + 1}`,
            distance: Math.round(distance * 1000),
            moving_time: movingTime,
            elapsed_time: Math.round(movingTime * 1.15),
            total_elevation_gain: elevation,
            elev_high: elevation,
            elev_low: 0,
            type: actType,
            sport_type: actType,
            start_date: dateStr,
            start_date_local: dateLocal,
            timezone: '(GMT+01:00) Europe/Madrid',
            utc_offset: 3600,
            location_city: city.name,
            location_state: 'Spain',
            location_country: 'Spain',
            start_latitude: city.lat + randomBetween(-0.1, 0.1),
            start_longitude: city.lng + randomBetween(-0.1, 0.1),
            end_latitude: city.lat + randomBetween(-0.1, 0.1),
            end_longitude: city.lng + randomBetween(-0.1, 0.1),
            start_latlng: [city.lat + randomBetween(-0.1, 0.1), city.lng + randomBetween(-0.1, 0.1)],
            end_latlng: [city.lat + randomBetween(-0.1, 0.1), city.lng + randomBetween(-0.1, 0.1)],
            average_speed: speed / 3.6, // m/s
            max_speed: (speed * 1.3) / 3.6,
            average_heartrate: Math.round(sampleStat(statModel?.avgHr, 130, 160)),
            max_heartrate: Math.round(sampleStat(statModel?.maxHr, 175, 195)),
            average_cadence: randomInt(170, 185),
            average_temp: weather.temperature,
            gear_id: gear?.id || null,
            kilojoules: Math.round(movingTime * (1.5 + demoRandom())),
            suffer_score: randomInt(50, 300),

            // Map and polyline data
            map: {
                id: `e${1000000 + i}`,
                summary_polyline: polylineData,
                resource_state: 2,
            },
            summary_polyline: polylineData,

            // Streams (for detailed analysis)
            streams,

            // Weather association
            weather,

            // Trainer/indoor
            trainer: ['WeightTraining', 'Padel', 'Soccer'].includes(actType),
            commute: false,
            manual: false,
            private: false,
            flagged: false,
            gear: gear ? {
                id: gear.id,
                resource_state: 2,
                name: gear.name,
                distance: Math.round(distance * 1000),
            } : null,
            from_accepted_tag: false,
            upload_id: null,
            average_watts: ['Ride', 'MountainBikeRide', 'WeightTraining'].includes(actType)
                ? Math.round(sampleStat(statModel?.avgWatts, 120, 340))
                : null,
            weighted_average_watts: ['Ride', 'MountainBikeRide', 'WeightTraining'].includes(actType)
                ? Math.round(sampleStat(statModel?.weightedWatts, 130, 360))
                : null,
            device_watts: ['Ride', 'MountainBikeRide', 'WeightTraining'].includes(actType) ? demoRandom() > 0.5 : false,
            max_watts: ['Ride', 'MountainBikeRide', 'WeightTraining'].includes(actType)
                ? Math.round(sampleStat(statModel?.maxWatts, 280, 900))
                : null,
            calories: Math.round(movingTime * 8 + demoRandom() * 200),
            has_kudos: demoRandom() > 0.7,
            kudos_count: randomInt(0, 20),
            comment_count: randomInt(0, 5),
            athlete_count: randomInt(1, 5),
            photo_count: randomInt(0, 3),
            total_photo_count: randomInt(0, 5),
            has_polyline: Boolean(polylineData),
            city: city.name,
            state: 'Spain',
            country: 'Spain',
            tags: [],
        };

        activities.push(activity);
    }

    return activities;
}

export function generateDemoAthlete(referenceDate = DEFAULT_DEMO_REFERENCE_DATE) {
    const updatedAt = new Date(referenceDate);
    if (Number.isNaN(updatedAt.getTime())) {
        throw new TypeError('referenceDate must be a valid date value');
    }

    return {
        id: 66914681,
        username: 'demo_user',
        firstname: 'Demo',
        lastname: 'Runner',
        city: 'Madrid',
        state: 'Madrid',
        country: 'Spain',
        sex: 'M',
        summit: false,
        created_at: '2015-01-01T00:00:00Z',
        updated_at: updatedAt.toISOString(),
        badge_type_id: 1,
        weight: 70,
        profile_medium: 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/big.jpg',
        profile: 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/large.jpg',
        friend: null,
        follower: null,
        follower_count: 125,
        friend_count: 89,
        mutual_friend_count: 5,
        athlete_type: 1,
        date_preference: '%m/%d/%Y',
        measurement_preference: 'meters',
        shoes: [
            { id: 'shoe_1', name: 'Nike Vaporfly', brand: 'Nike', resource_state: 2 },
            { id: 'shoe_2', name: 'ASICS Gel Kayano', brand: 'ASICS', resource_state: 2 },
        ],
        bikes: [
            { id: 'bike_1', name: 'Trek Madone', brand: 'Trek', resource_state: 2 },
            { id: 'bike_2', name: 'Canyon Gravel', brand: 'Canyon', resource_state: 2 },
        ],
    };
}

export function generateDemoZones() {
    return {
        heartrate: [
            {
                min: 0,
                max: 142,
                type: 'custom_zone_1',
            },
            {
                min: 142,
                max: 152,
                type: 'custom_zone_2',
            },
            {
                min: 152,
                max: 167,
                type: 'custom_zone_3',
            },
            {
                min: 167,
                max: 177,
                type: 'custom_zone_4',
            },
            {
                min: 177,
                max: null,
                type: 'custom_zone_5',
            },
        ],
        power: [
            {
                min: 0,
                max: 140,
                type: 'custom_zone_1',
            },
            {
                min: 140,
                max: 200,
                type: 'custom_zone_2',
            },
            {
                min: 200,
                max: 280,
                type: 'custom_zone_3',
            },
            {
                min: 280,
                max: 340,
                type: 'custom_zone_4',
            },
            {
                min: 340,
                max: null,
                type: 'custom_zone_5',
            },
        ],
    };
}
