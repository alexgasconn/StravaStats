/**
 * Demo Mode Controller
 * Handles loading and managing demo data in localStorage
 */

import { getCachedActivities } from '../services/activity-cache.js';

export const DEMO_MODE_KEY = 'strava_demo_mode';
export const DEMO_TOKENS_KEY = 'strava_tokens_demo';

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
export async function loadDemoData() {
    // Try to use the user's cached Strava activities (IndexedDB/localStorage)
    let activities = null;
    try {
        const cached = await getCachedActivities({ cacheVersion: null, maxAgeMs: Infinity });
        if (cached && Array.isArray(cached.activities) && cached.activities.length) {
            activities = cached.activities;
        }
    } catch (err) {
        // If cache access fails, fallback to generator below
        console.warn('Could not read cached activities for demo mode:', err);
    }

    // Fallback to a bundled sample activities file (for reproducible demo across users)
    if (!activities) {
        try {
            const resp = await fetch('/js/demo/sample-activities.json', { cache: 'no-store' });
            if (resp.ok) {
                const parsed = await resp.json();
                if (Array.isArray(parsed) && parsed.length) {
                    activities = parsed;
                }
            }
        } catch (err) {
            console.warn('No bundled sample activities found:', err);
        }
    }

    // If still no activities, use empty array — generator removed by request
    if (!activities) activities = [];

    // Prefer existing cached athlete/zones/gears in localStorage if present
    const storedAthlete = JSON.parse(localStorage.getItem('strava_athlete_data') || 'null');
    const athlete = storedAthlete || {
        id: null,
        username: 'demo_user',
        firstname: 'Demo',
        lastname: 'User',
        profile_medium: '',
        city: '',
        country: ''
    };
    const storedZones = JSON.parse(localStorage.getItem('strava_training_zones') || 'null');
    const zones = storedZones || [];
    const gears = [...(athlete?.shoes || []), ...(athlete?.bikes || [])];

    // Store demo data in localStorage (api.js reads these keys when isDemoMode())
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
    const demoTokens = {
        access_token: 'demo_token_' + Math.random().toString(36),
        refresh_token: 'demo_refresh_' + Math.random().toString(36),
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
