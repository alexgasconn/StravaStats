/**
 * Demo Mode Controller
 * Handles loading and managing demo data in localStorage
 */

import {
    DEFAULT_DEMO_SEED,
    generateDemoData,
    generateDemoAthlete,
    generateDemoZones,
} from './generator.js';

export const DEMO_MODE_KEY = 'strava_demo_mode';
export const DEMO_TOKENS_KEY = 'strava_tokens_demo';

export function getDemoReferenceDate(now = new Date()) {
    const referenceDate = new Date(now);
    if (Number.isNaN(referenceDate.getTime())) {
        throw new TypeError('now must be a valid date value');
    }

    referenceDate.setUTCHours(12, 0, 0, 0);
    return referenceDate.toISOString();
}

export function isDemoMode() {
    return localStorage.getItem(DEMO_MODE_KEY) === 'true';
}

export function setDemoMode(enabled) {
    if (enabled) {
        localStorage.setItem(DEMO_MODE_KEY, 'true');
    } else {
        localStorage.removeItem(DEMO_MODE_KEY);
    }
}

/**
 * Load demo data into localStorage (mimics Strava API responses)
 */
export function loadDemoData({
    referenceDate = getDemoReferenceDate(),
} = {}) {
    // Generate all demo data
    const activities = generateDemoData({ referenceDate });
    const athlete = generateDemoAthlete(referenceDate);
    const zones = generateDemoZones();
    const gears = [...(athlete?.shoes || []), ...(athlete?.bikes || [])];

    // Store in localStorage (same structure as real API)
    localStorage.setItem('strava_demo_activities', JSON.stringify(activities));
    localStorage.setItem('strava_athlete_data', JSON.stringify(athlete));
    localStorage.setItem('strava_training_zones', JSON.stringify(zones));
    localStorage.setItem('strava_gears', JSON.stringify(gears));

    // Set timestamps to appear fresh
    const now = Date.now();
    localStorage.setItem('strava_athlete_data_timestamp', String(now));
    localStorage.setItem('strava_training_zones_timestamp', String(now));
    localStorage.setItem('strava_gears_timestamp', String(now));

    // Set demo token (fake but valid structure)
    const tokenSuffix = DEFAULT_DEMO_SEED.toString(36);
    const demoTokens = {
        access_token: `demo_token_${tokenSuffix}`,
        refresh_token: `demo_refresh_${tokenSuffix}`,
        expires_at: Math.floor(Date.now() / 1000) + 21600, // 6h from now
    };
    localStorage.setItem('strava_tokens', JSON.stringify(demoTokens));

    // Enable demo mode
    setDemoMode(true);

    return { activities, athlete, zones, gears };
}

/**
 * Clear demo data and exit demo mode
 */
export function clearDemoData() {
    localStorage.removeItem('strava_demo_mode');
    localStorage.removeItem('strava_demo_activities');
    localStorage.removeItem('strava_tokens');
    localStorage.removeItem('strava_athlete_data');
    localStorage.removeItem('strava_training_zones');
    localStorage.removeItem('strava_gears');
    localStorage.removeItem('strava_athlete_data_timestamp');
    localStorage.removeItem('strava_training_zones_timestamp');
    localStorage.removeItem('strava_gears_timestamp');
}

/**
 * Get activities from demo storage
 * (Used by api.js to return demo activities instead of calling real API)
 */
export function getDemoActivities() {
    const stored = localStorage.getItem('strava_demo_activities');
    if (!stored) {
        return [];
    }
    return JSON.parse(stored);
}

export function getDemoGears(athlete = null) {
    const cached = localStorage.getItem('strava_gears');
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch (_e) {
            // ignore malformed cache and fallback
        }
    }

    const srcAthlete = athlete || JSON.parse(localStorage.getItem('strava_athlete_data') || 'null');
    if (!srcAthlete) return [];

    return [...(srcAthlete.shoes || []), ...(srcAthlete.bikes || [])];
}

/**
 * Inject demo mode check into API calls
 * This is done in api.js by checking isDemoMode() before fetch
 */
export function setupDemoModeInterceptor() {
    // This is called from main.js after auth.js to setup demo mode if enabled
    return isDemoMode();
}
