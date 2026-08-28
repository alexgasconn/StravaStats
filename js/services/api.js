// js/api.js

// ===================================================================
// CACHE CONFIGURATION
// ===================================================================
import { isDemoMode, getDemoActivities, getDemoGears } from '../demo/index.js';
const CACHE_DURATIONS = {
    athlete: 24 * 60 * 60 * 1000,      // 24 hours
    zones: 24 * 60 * 60 * 1000,        // 24 hours
    gear: 24 * 60 * 60 * 1000,         // 24 hours
    activities: 60 * 60 * 1000         // 1 hour (default)
};

function getFromCache(key, ttlKey = 'activities') {
    const cached = localStorage.getItem(key);
    const timestamp = localStorage.getItem(`${key}_timestamp`);

    if (!cached || !timestamp) return null;

    const cacheDuration = CACHE_DURATIONS[ttlKey] || CACHE_DURATIONS.activities;
    const age = Date.now() - parseInt(timestamp);
    if (age > cacheDuration) {
        localStorage.removeItem(key);
        localStorage.removeItem(`${key}_timestamp`);
        return null;
    }

    try {
        return JSON.parse(cached);
    } catch (e) {
        console.warn(`Cache parse error for ${key}:`, e);
        return null;
    }
}

function saveToCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.setItem(`${key}_timestamp`, Date.now().toString());
    } catch (e) {
        console.warn(`Cache save error for ${key}:`, e);
    }
}

// ===================================================================
// AUTH & HELPERS
// ===================================================================
function getAuthPayload() {
    // Prefer sessionStorage tokens (used for demo mode) so demo tokens do not persist across sessions
    let tokenData = null;
    try {
        if (typeof sessionStorage !== 'undefined') {
            tokenData = sessionStorage.getItem('strava_tokens');
        }
    } catch (_e) {
        // ignore
    }
    if (!tokenData) {
        tokenData = localStorage.getItem('strava_tokens');
    }
    if (!tokenData) throw new Error('User not authenticated');
    return btoa(tokenData);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function handleApiResponse(response) {
    if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const result = await response.json();
            throw new Error(result.error || `API call failed (${response.status})`);
        }
        throw new Error(`API call failed (${response.status} ${response.statusText})`);
    }

    const result = await response.json();
    if (result.tokens) {
        localStorage.setItem('strava_tokens', JSON.stringify(result.tokens));
    }
    return result;
}

export async function fetchAllActivities() {
    // If in demo mode, return demo data
    if (isDemoMode()) {
        return getDemoActivities();
    }

    const response = await fetch('/api/strava-activities', {
        headers: {
            Authorization: `Bearer ${getAuthPayload()}`
        }
    });
    const result = await handleApiResponse(response);
    return result.activities;
}

export async function fetchGearById(gearId) {
    // Check cache first with 24h TTL
    const cacheKey = `strava_gear_${gearId}`;
    const cached = getFromCache(cacheKey, 'gear');
    if (cached) {
        return cached;
    }

    const response = await fetch(`/api/strava-gear?id=${encodeURIComponent(gearId)}`, {
        headers: {
            Authorization: `Bearer ${getAuthPayload()}`
        }
    });
    const result = await handleApiResponse(response);
    const gear = result.gear;

    saveToCache(cacheKey, gear);
    return gear;
}

export function renderAthleteProfile(athlete) {
    const container = document.getElementById('athlete-profile-card');
    const contentDiv = container.querySelector('.profile-content');
    if (!container || !contentDiv) return;

    contentDiv.innerHTML = `
        <img src="${escapeHtml(athlete.profile_medium)}" alt="Athlete profile picture">
        <div class="profile-details">
            <span class="name">${escapeHtml(athlete.firstname)} ${escapeHtml(athlete.lastname)}</span>
            <span class="location">${escapeHtml(athlete.city)}, ${escapeHtml(athlete.country)}</span>
            <span class="stats">Followers: ${Number(athlete.follower_count) || 0} | Friends: ${Number(athlete.friend_count) || 0}</span>
        </div>
    `;
}

export async function fetchAthleteData() {
    // Check cache first with 24h TTL
    const cacheKey = 'strava_athlete_data';
    const cached = getFromCache(cacheKey, 'athlete');
    if (cached) {
        if (!isDemoMode()) {
            console.log('[Athlete] cached profile', {
                id: cached?.id,
                name: `${cached?.firstname || ''} ${cached?.lastname || ''}`.trim(),
                username: cached?.username || null,
            });
        }
        return cached;
    }

    // If in demo mode, get from localStorage
    if (isDemoMode()) {
        const stored = localStorage.getItem('strava_athlete_data');
        if (stored) {
            return JSON.parse(stored);
        }
    }

    const response = await fetch('/api/strava-athlete', {
        headers: { Authorization: `Bearer ${getAuthPayload()}` }
    });
    const result = await handleApiResponse(response);
    const athlete = result.athlete;

    console.log('[Athlete] fetched profile', {
        id: athlete?.id,
        name: `${athlete?.firstname || ''} ${athlete?.lastname || ''}`.trim(),
        username: athlete?.username || null,
    });

    saveToCache(cacheKey, athlete);
    return athlete;
}

export async function fetchTrainingZones() {
    // Check cache first with 24h TTL
    const cacheKey = 'strava_training_zones';
    const cached = getFromCache(cacheKey, 'zones');
    if (cached) {
        return cached;
    }

    // If in demo mode, get from localStorage
    if (isDemoMode()) {
        const stored = localStorage.getItem('strava_training_zones');
        if (stored) {
            return JSON.parse(stored);
        }
    }

    const response = await fetch('/api/strava-zones', {
        headers: { Authorization: `Bearer ${getAuthPayload()}` }
    });
    const result = await handleApiResponse(response);
    const zones = result.zones;

    saveToCache(cacheKey, zones);
    return zones;
}

export async function fetchAllGears(athlete) {
    if (isDemoMode()) {
        return getDemoGears(athlete);
    }

    const rawGearIds = [...(athlete.shoes || []), ...(athlete.bikes || [])];
    const gearIds = rawGearIds.map(g => {
        if (typeof g === 'string') return g;
        if (g && typeof g === 'object' && g.id) return g.id;
        return null;
    }).filter(id => id);
    if (gearIds.length === 0) return [];

    // Use Promise.allSettled so failed gear fetches don't block others
    const results = await Promise.allSettled(gearIds.map(id => fetchGearById(id)));

    // Filter out rejected promises and return only successful gears
    return results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)
        .filter(g => g); // Remove null/undefined
}

export function getCachedGears() {
    // Try to read cached gears array with 24h TTL
    const cached = getFromCache('strava_gears', 'gear');
    if (cached) {
        return cached;
    }
    return null;
}

export function setCachedGears(gearsList) {
    // Save gears array to cache with 24h TTL
    saveToCache('strava_gears', gearsList);
}