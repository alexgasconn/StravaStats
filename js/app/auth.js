// js/auth.js
import { showLoading, handleError, hideLoading } from './ui.js';
import { loadDemoData } from '../demo/index.js';
import { clearCachedActivities } from '../services/activity-cache.js';

const REDIRECT_URI = window.location.origin + window.location.pathname;

async function getStravaClientId() {
    const response = await fetch('/api/config');
    const data = await response.json();

    if (!response.ok || !data.stravaClientId) {
        throw new Error(data.error || 'Unable to load Strava client ID');
    }

    return data.stravaClientId;
}

export async function redirectToStrava() {
    try {
        const clientId = await getStravaClientId();
        const scope = 'read,activity:read_all,profile:read_all';
        const authUrl = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scope)}`;
        window.location.href = authUrl;
    } catch (error) {
        handleError('Could not start Strava login', error);
    }
}

export async function logout() {
    const tokenDataRaw = localStorage.getItem('strava_tokens');
    if (tokenDataRaw) {
        const tokenData = JSON.parse(tokenDataRaw);
        // Only try deauth if not a demo token
        if (!tokenData.access_token?.startsWith('demo_')) {
            try {
                await fetch('https://www.strava.com/oauth/deauthorize', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
                });
            } catch (error) {
                console.warn('Failed to deauthorize token:', error);
            }
        }
    }
    localStorage.removeItem('strava_tokens');
    await clearCachedActivities();
    localStorage.removeItem('strava_athlete_data');
    localStorage.removeItem('strava_athlete_data_timestamp');
    localStorage.removeItem('strava_training_zones');
    localStorage.removeItem('strava_training_zones_timestamp');
    localStorage.removeItem('strava_gears');
    localStorage.removeItem('strava_gears_timestamp');
    localStorage.removeItem('dashboard_filters');
    localStorage.removeItem('dashboard_readiness_hrv');
    // Also clear demo data
    try { sessionStorage.removeItem('strava_demo_mode'); } catch (_e) { }
    localStorage.removeItem('strava_demo_mode');
    localStorage.removeItem('strava_demo_activities');
    window.location.reload();
}

async function getTokensFromCode(code) {
    try {
        let response;
        try {
            response = await fetch('/api/strava-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
        } catch (networkErr) {
            throw new Error('Cannot reach /api/strava-auth. Run the app with "vercel dev" for local testing.');
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            // Endpoint returned HTML — likely a 404 (not running via vercel dev) or a Vercel error page
            const text = await response.text().catch(() => '');
            const hint = response.status === 404
                ? 'Endpoint not found — make sure you are running the app with "vercel dev".'
                : `Server returned HTTP ${response.status}. Check that STRAVA_CLIENT_SECRET is set in your Vercel environment variables.`;
            throw new Error(hint + (text ? `\n\nServer said: ${text.slice(0, 200)}` : ''));
        }

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Authentication failed');

        localStorage.setItem('strava_tokens', JSON.stringify({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at
        }));
        await clearCachedActivities();

        window.history.replaceState({}, '', window.location.pathname);
    } catch (error) {
        handleError('Authentication failed', error);
        throw error;
    }
}

export async function loginWithDemo(onAuthenticated) {
    try {
        showLoading('Loading demo data with cached activities...');
        await loadDemoData();

        // Fake token for demo mode
        const demoTokens = {
            access_token: 'demo_' + Math.random().toString(36),
            refresh_token: 'demo_refresh_' + Math.random().toString(36),
            expires_at: Math.floor(Date.now() / 1000) + 21600,
        };

        await onAuthenticated(demoTokens);
        hideLoading();
    } catch (error) {
        handleError('Demo mode failed', error);
        hideLoading();
    }
}

export async function handleAuth(onAuthenticated) {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
        showLoading('Authenticating...');
        await getTokensFromCode(code);
    }

    const tokenDataRaw = localStorage.getItem('strava_tokens');
    if (tokenDataRaw) {
        const tokenData = JSON.parse(tokenDataRaw);
        const now = Math.floor(Date.now() / 1000);

        if (tokenData.access_token && tokenData.expires_at > now) {
            await onAuthenticated(tokenData);
            return;
        } else {
            localStorage.removeItem('strava_tokens');
            await clearCachedActivities();
            localStorage.removeItem('strava_athlete_data');
            localStorage.removeItem('strava_athlete_data_timestamp');
            localStorage.removeItem('strava_training_zones');
            localStorage.removeItem('strava_training_zones_timestamp');
            localStorage.removeItem('strava_gears');
            localStorage.removeItem('strava_gears_timestamp');
            localStorage.removeItem('dashboard_filters');
            localStorage.removeItem('dashboard_readiness_hrv');
        }
    }

    hideLoading();
}
