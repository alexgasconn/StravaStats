// js/app/main.js
import '../shared/utils/speed-insights.js';
import { redirectToStrava, logout, handleAuth, loginWithDemo } from './auth.js';
import { setupDashboard, showLoading, hideLoading, handleError, } from './ui.js';
import {
    renderRunAnalysisTab,
    renderBikeAnalysisTab,
    renderSwimAnalysisTab,
    renderDashboardTab,
    renderTrendsTab,
    renderPlannerTab,
    renderGearTab,
    renderWeatherTab,
    renderActivitiesTab,
    renderCalendarTab,
    renderWrappedTab,
    renderMapTab,
    renderAIChatTab,
    renderRunPlusTab,
} from '../tabs/index.js';
import {
    fetchAllActivities,
    fetchAthleteData,
    fetchTrainingZones,
    fetchAllGears,
    setCachedGears,
    getCachedActivities,
    saveCachedActivities,
} from '../services/index.js';
import { preprocessActivities } from '../shared/preprocessing/index.js';
import { isDemoMode } from '../demo/index.js';

const CACHE_VERSION = 'v2-efficiency-moving-ratio';

document.addEventListener('DOMContentLoaded', () => {
    // --- STATE ---
    let allActivities = [];
    let dateFilterFrom = null;
    let dateFilterTo = null;
    let trendsSportFilter = 'all';
    let trendsDataType = 'time';
    let runGearFilter = 'all';
    let bikeGearFilter = 'all';
    let runRollingWindow = 26; // default 6 months (26 weeks)
    let bikeRollingWindow = 26;
    let swimRollingWindow = 26;

    // --- Tab rendering config: maps tab id → { render function, uses date filters } ---
    const tabConfig = {
        'dashboard-tab': { render: () => renderDashboardTab(allActivities, dateFilterFrom, dateFilterTo), usesFilters: true },
        'run-tab': { render: () => renderRunAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, runGearFilter, runRollingWindow), usesFilters: true },
        'run-plus-tab': { render: () => renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, runGearFilter, getRunPlusRenderOptions()), usesFilters: true },
        'bike-tab': { render: () => renderBikeAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, bikeGearFilter, bikeRollingWindow), usesFilters: true },
        'swim-tab': { render: () => renderSwimAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, swimRollingWindow), usesFilters: true },
        'trends-tab': { render: () => renderTrendsTab(allActivities, dateFilterFrom, dateFilterTo, trendsSportFilter, trendsDataType), usesFilters: true },
        'planner-tab': { render: () => renderPlannerTab(allActivities) },
        'gear-tab': { render: () => renderGearTab(allActivities) },
        'activities-tab': { render: () => renderActivitiesTab(allActivities) },
        'calendar-tab': { render: () => renderCalendarTab(allActivities) },
        'weather-tab': { render: () => renderWeatherTab(allActivities) },
        'map-tab': { render: () => renderMapTab(allActivities, dateFilterFrom, dateFilterTo), usesFilters: true },
        'wrapped-tab': { render: () => renderWrappedTab(allActivities) },
        'ai-chat-tab': { render: () => renderAIChatTab(allActivities) },
    };
    const renderedTabs = new Set();

    // --- DOM REFERENCES ---
    const loginButton = document.getElementById('login-button');
    const demoButton = document.getElementById('demo-button');
    const logoutButton = document.getElementById('logout-button');
    const refreshButton = document.getElementById('refresh-button');

    // Run Tab
    const applyFilterButton = document.getElementById('apply-date-filter');
    const resetFilterButton = document.getElementById('reset-date-filter');
    const dateFromEl = document.getElementById('date-from');
    const dateToEl = document.getElementById('date-to');
    const runGearFilterEl = document.getElementById('run-gear-filter');

    // Bike Tab
    const bikeApplyFilterButton = document.getElementById('bike-apply-date-filter');
    const bikeResetFilterButton = document.getElementById('bike-reset-date-filter');
    const bikeDateFromEl = document.getElementById('bike-date-from');
    const bikeDateToEl = document.getElementById('bike-date-to');
    const bikeGearFilterEl = document.getElementById('bike-gear-filter');

    // Swim Tab
    const swimApplyFilterButton = document.getElementById('swim-apply-date-filter');
    const swimResetFilterButton = document.getElementById('swim-reset-date-filter');
    const swimDateFromEl = document.getElementById('swim-date-from');
    const swimDateToEl = document.getElementById('swim-date-to');

    const settingsButton = document.getElementById('settings-button');
    const settingsPanel = document.getElementById('settings-panel');
    const closeSettings = document.getElementById('close-settings');

    const unitSelect = document.getElementById('units');
    const hrMaxInput = document.getElementById('hr-max');
    const ageInput = document.getElementById('age');
    const bgImagesToggle = document.getElementById('bg-images-toggle');
    const darkModeToggle = document.getElementById('dark-mode-toggle');

    // --- SETTINGS ---
    if (settingsButton && settingsPanel && closeSettings) {
        settingsButton.addEventListener('click', () => {
            settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
        });
        closeSettings.addEventListener('click', () => {
            settingsPanel.style.display = 'none';
        });
    }

    function applyBgImages(enabled) {
        document.documentElement.dataset.tabBackgroundImages = enabled ? 'on' : 'off';
        document.documentElement.style.setProperty(
            '--tab-bg-overlay',
            enabled ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 1)'
        );
    }

    function applyDarkMode(enabled) {
        document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
    }

    function loadSettings() {
        const saved = JSON.parse(localStorage.getItem('dashboard_settings') || '{}');
        if (saved.units && unitSelect) unitSelect.value = saved.units;
        if (saved.hrMax && hrMaxInput) hrMaxInput.value = saved.hrMax;
        if (saved.age && ageInput) ageInput.value = saved.age;
        const bgEnabled = saved.bgImages === true;
        if (bgImagesToggle) bgImagesToggle.checked = bgEnabled;
        applyBgImages(bgEnabled);
        const darkEnabled = saved.darkMode === true;
        if (darkModeToggle) darkModeToggle.checked = darkEnabled;
        applyDarkMode(darkEnabled);
    }

    function saveSettings() {
        const settings = {
            units: unitSelect?.value,
            hrMax: hrMaxInput?.value,
            age: ageInput?.value,
            bgImages: bgImagesToggle?.checked || false,
            darkMode: darkModeToggle?.checked || false
        };
        localStorage.setItem('dashboard_settings', JSON.stringify(settings));
        applyBgImages(settings.bgImages);
        applyDarkMode(settings.darkMode);
    }

    loadSettings();

    if (unitSelect) unitSelect.addEventListener('change', saveSettings);
    if (hrMaxInput) hrMaxInput.addEventListener('input', saveSettings);
    if (ageInput) ageInput.addEventListener('input', saveSettings);
    if (bgImagesToggle) bgImagesToggle.addEventListener('change', saveSettings);
    if (darkModeToggle) darkModeToggle.addEventListener('change', saveSettings);

    // --- TAB NAVIGATION ---
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const WIP_TABS = {
        'weather-tab': 'Weather is currently Work in Progress. Some metrics may be incomplete.\n\nDo you want to continue anyway?',
        'ai-chat-tab': 'AI Coach is currently Work in Progress. Responses and features may be unstable.\n\nDo you want to continue anyway?',

    };

    const routeToTab = {
        '/': 'dashboard-tab',
        '/run': 'run-tab',
        '/run-plus': 'run-plus-tab',
        '/dashboard': 'dashboard-tab',
        '/bike': 'bike-tab',
        '/swim': 'swim-tab',
        '/trends': 'trends-tab',
        '/planner': 'planner-tab',
        '/gear': 'gear-tab',
        '/activities': 'activities-tab',
        '/calendar': 'calendar-tab',
        '/weather': 'weather-tab',
        '/map': 'map-tab',
        '/wrapped': 'wrapped-tab',

        '/ai-coach': 'ai-chat-tab'
    };

    const tabToRoute = {
        'run-tab': '/run',
        'run-plus-tab': '/run-plus',
        'dashboard-tab': '/dashboard',
        'bike-tab': '/bike',
        'swim-tab': '/swim',
        'trends-tab': '/trends',
        'planner-tab': '/planner',
        'gear-tab': '/gear',
        'activities-tab': '/activities',
        'calendar-tab': '/calendar',
        'weather-tab': '/weather',
        'map-tab': '/map',
        'wrapped-tab': '/wrapped',

        'ai-chat-tab': '/ai-coach'
    };

    function normalizePath(pathname) {
        if (!pathname) return '/';
        return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
    }

    function getTabIdFromPath(pathname) {
        const normalized = normalizePath(pathname);
        return routeToTab[normalized] || 'dashboard-tab'; // Default to dashboard-tab
    }

    function setupWipTabIndicators() {
        Object.entries(WIP_TABS).forEach(([tabId]) => {
            const link = document.querySelector(`.tab-link[data-tab="${tabId}"]`);
            if (!link) return;
            link.classList.add('tab-link-wip');
            link.title = 'Work in Progress';
            link.setAttribute('aria-label', `${link.textContent.trim()} (Work in Progress)`);

            if (!link.querySelector('.tab-wip-badge')) {
                const badge = document.createElement('span');
                badge.className = 'tab-wip-badge';
                badge.textContent = 'WIP';
                badge.setAttribute('aria-hidden', 'true');
                link.appendChild(badge);
            }
        });
    }

    function syncDateInputs() {
        // Sync all date inputs with current filter state
        if (dateFromEl) dateFromEl.value = dateFilterFrom || '';
        if (dateToEl) dateToEl.value = dateFilterTo || '';
        if (bikeDateFromEl) bikeDateFromEl.value = dateFilterFrom || '';
        if (bikeDateToEl) bikeDateToEl.value = dateFilterTo || '';
        if (swimDateFromEl) swimDateFromEl.value = dateFilterFrom || '';
        if (swimDateToEl) swimDateToEl.value = dateFilterTo || '';
        if (runGearFilterEl) runGearFilterEl.value = runGearFilter || 'all';
        if (bikeGearFilterEl) bikeGearFilterEl.value = bikeGearFilter || 'all';
    }

    function getGearNameMap() {
        const gears = JSON.parse(localStorage.getItem('strava_gears') || '[]');
        return new Map(gears.map(gear => {
            const label = gear.name || [gear.brand_name, gear.model_name].filter(Boolean).join(' ') || gear.id;
            return [gear.id, label];
        }));
    }

    function populateGearFilters() {
        const gearNameMap = getGearNameMap();

        const buildOptions = (activities) => {
            const uniqueGearIds = [...new Set(
                activities
                    .map(activity => activity.gear_id)
                    .filter(Boolean)
            )];

            return [
                { value: 'all', label: 'All' },
                ...uniqueGearIds.map(gearId => ({ value: gearId, label: gearNameMap.get(gearId) || gearId }))
            ];
        };

        const runActivities = allActivities.filter(activity => activity.type && activity.type.includes('Run'));
        const bikeActivities = allActivities.filter(activity =>
            activity.type === 'Ride' ||
            activity.sport_type === 'Ride' ||
            activity.sport_type === 'MountainBikeRide'
        );

        const runOptions = buildOptions(runActivities);
        const bikeOptions = buildOptions(bikeActivities);

        const setOptions = (selectEl, options) => {
            if (!selectEl) return;
            selectEl.innerHTML = options
                .map(option => `<option value="${option.value}">${option.label}</option>`)
                .join('');
        };

        setOptions(runGearFilterEl, runOptions);
        setOptions(bikeGearFilterEl, bikeOptions);

        const runValues = new Set(runOptions.map(option => option.value));
        const bikeValues = new Set(bikeOptions.map(option => option.value));
        if (!runValues.has(runGearFilter)) runGearFilter = 'all';
        if (!bikeValues.has(bikeGearFilter)) bikeGearFilter = 'all';

        syncDateInputs();
    }

    let activeTabId = null;

    function getRunPlusRenderOptions() {
        return {
            onFiltersChange: handleRunPlusFiltersChange
        };
    }

    function handleRunPlusFiltersChange({ dateFilterFrom: newFrom = null, dateFilterTo: newTo = null, gearFilter: newGear = 'all' } = {}) {
        dateFilterFrom = newFrom || null;
        dateFilterTo = newTo || null;
        runGearFilter = newGear || 'all';

        if (dateFromEl) dateFromEl.value = dateFilterFrom || '';
        if (dateToEl) dateToEl.value = dateFilterTo || '';
        if (runGearFilterEl) runGearFilterEl.value = runGearFilter;
        document.querySelectorAll('#year-filter-buttons .year-btn').forEach(b => b.classList.remove('active'));

        if (dateFilterFrom && dateFilterTo && dateFilterFrom.slice(5) === '01-01' && dateFilterTo.slice(5) === '12-31') {
            const year = dateFilterFrom.slice(0, 4);
            document.querySelector(`#year-filter-buttons .year-btn[data-year="${year}"]`)?.classList.add('active');
        }

        saveFilterState();
        renderRunRelatedTabs();
    }

    function renderRunRelatedTabs() {
        renderRunAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, runGearFilter, runRollingWindow);
        if (renderedTabs.has('run-plus-tab') || activeTabId === 'run-plus-tab') {
            renderRunPlusTab(allActivities, dateFilterFrom, dateFilterTo, runGearFilter, getRunPlusRenderOptions());
            renderedTabs.add('run-plus-tab');
        }
    }

    function activateTab(tabId, { updateUrl = false, replaceUrl = false } = {}) {
        if (tabId === activeTabId) return; // skip if already active

        const link = document.querySelector(`.tab-link[data-tab="${tabId}"]`);
        const content = document.getElementById(tabId);
        if (!link || !content) return;

        // Deactivate previous tab directly instead of looping all
        if (activeTabId) {
            const prevLink = document.querySelector(`.tab-link[data-tab="${activeTabId}"]`);
            const prevContent = document.getElementById(activeTabId);
            if (prevLink) prevLink.classList.remove('active');
            if (prevContent) prevContent.classList.remove('active');
        } else {
            // First time - clean all (fallback for initial load)
            tabLinks.forEach(item => item.classList.remove('active'));
            tabContents.forEach(item => item.classList.remove('active'));
        }

        link.classList.add('active');
        content.classList.add('active');
        activeTabId = tabId;

        // Scroll active tab into view on mobile
        link.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

        // Sync date inputs when switching tabs
        syncDateInputs();

        // Lazy-render tabs on first visit (deferred to next frame)
        if (!renderedTabs.has(tabId) && tabConfig[tabId]) {
            renderedTabs.add(tabId);
            requestAnimationFrame(() => tabConfig[tabId].render());
        }

        if (updateUrl) {
            const route = tabToRoute[tabId] || '/run';
            const method = replaceUrl ? 'replaceState' : 'pushState';
            window.history[method]({ tabId }, '', route);
        }
    }

    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tabId = link.getAttribute('data-tab');
            const warningMessage = WIP_TABS[tabId];
            if (warningMessage) {
                const proceed = window.confirm(warningMessage);
                if (!proceed) return;
            }
            activateTab(tabId, { updateUrl: true });
        });
    });

    setupWipTabIndicators();

    window.addEventListener('popstate', () => {
        activateTab(getTabIdFromPath(window.location.pathname));
    });

    // --- FILTER STATE PERSISTENCE ---
    function saveFilterState() {
        localStorage.setItem('dashboard_filters', JSON.stringify({
            dateFilterFrom,
            dateFilterTo,
            trendsSportFilter,
            trendsDataType,
            runGearFilter,
            bikeGearFilter
        }));
    }

    function loadFilterState() {
        const saved = localStorage.getItem('dashboard_filters');
        let filters = {};
        if (saved) {
            try {
                filters = JSON.parse(saved) || {};
            } catch {
                filters = {};
            }
        }

        // Always start with no date filter on app load.
        dateFilterFrom = null;
        dateFilterTo = null;
        trendsSportFilter = filters.trendsSportFilter || filters.athleteSportFilter || 'all';
        trendsDataType = filters.trendsDataType || filters.athleteDataType || 'time';
        runGearFilter = filters.runGearFilter || 'all';
        bikeGearFilter = filters.bikeGearFilter || 'all';

        syncDateInputs();

        // Persist the reset so a hard refresh also starts unfiltered.
        localStorage.setItem('dashboard_filters', JSON.stringify({
            dateFilterFrom,
            dateFilterTo,
            trendsSportFilter,
            trendsDataType,
            runGearFilter,
            bikeGearFilter
        }));
    }

    // --- YEAR FILTER BUTTONS ---
    function setupYearlySelector() {
        const yearsToShow = 5;

        // Setup for Run Tab
        const runContainer = document.getElementById('year-filter-buttons');
        const bikeContainer = document.getElementById('bike-year-filter-buttons');
        const swimContainer = document.getElementById('swim-year-filter-buttons');

        if ((runContainer || bikeContainer || swimContainer) && allActivities.length === 0) return;

        const years = [...new Set(allActivities.map(a => a.start_date_local.substring(0, 4)))]
            .sort((a, b) => b - a);

        const yearButtonsHTML = years.slice(0, yearsToShow).map(year =>
            `<button class="year-btn" data-year="${year}">${year}</button>`
        ).join('');

        // Populate all three containers
        if (runContainer) runContainer.innerHTML = yearButtonsHTML;
        if (bikeContainer) bikeContainer.innerHTML = yearButtonsHTML;
        if (swimContainer) swimContainer.innerHTML = yearButtonsHTML;

        // Setup event listeners for Run Tab
        if (runContainer) {
            runContainer.querySelectorAll('.year-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    runContainer.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const year = btn.dataset.year;
                    dateFilterFrom = `${year}-01-01`;
                    dateFilterTo = `${year}-12-31`;

                    if (dateFromEl) dateFromEl.value = dateFilterFrom;
                    if (dateToEl) dateToEl.value = dateFilterTo;
                    runGearFilter = runGearFilterEl?.value || runGearFilter || 'all';
                    saveFilterState();

                    renderRunRelatedTabs();
                });
            });
        }

        // Setup event listeners for Bike Tab
        if (bikeContainer) {
            bikeContainer.querySelectorAll('.year-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    bikeContainer.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const year = btn.dataset.year;
                    dateFilterFrom = `${year}-01-01`;
                    dateFilterTo = `${year}-12-31`;

                    if (bikeDateFromEl) bikeDateFromEl.value = dateFilterFrom;
                    if (bikeDateToEl) bikeDateToEl.value = dateFilterTo;
                    bikeGearFilter = bikeGearFilterEl?.value || bikeGearFilter || 'all';
                    saveFilterState();

                    renderBikeAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, bikeGearFilter, bikeRollingWindow);
                });
            });
        }

        // Setup event listeners for Swim Tab
        if (swimContainer) {
            swimContainer.querySelectorAll('.year-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    swimContainer.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const year = btn.dataset.year;
                    dateFilterFrom = `${year}-01-01`;
                    dateFilterTo = `${year}-12-31`;

                    if (swimDateFromEl) swimDateFromEl.value = dateFilterFrom;
                    if (swimDateToEl) swimDateToEl.value = dateFilterTo;
                    saveFilterState();

                    renderSwimAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, swimRollingWindow);
                });
            });
        }
    }

    // --- INITIALIZATION ---
    async function initializeApp(tokenData) {
        const t0 = Date.now();
        const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s elapsed`;
        showLoading('Preparing dashboard...', 2, elapsed());
        let progress = 0;

        try {
            // Phase 1: Load activities (0% -> 40%)
            progress = 8;
            showLoading('Checking local cache...', progress, elapsed());

            const cachedActivities = await getCachedActivities({
                cacheVersion: CACHE_VERSION,
                maxAgeMs: 60 * 60 * 1000
            });

            let activities;
            if (cachedActivities?.activities?.length) {
                activities = cachedActivities.activities;
                progress = 40;
                showLoading(`Activities loaded from cache (${activities.length})`, progress, elapsed());
                if (!isDemoMode()) {
                    console.log(`[Strava] Activities loaded from cache (${activities.length}):`, activities);
                }
            } else {
                showLoading('Downloading activities from Strava...', 18, elapsed());
                activities = await fetchAllActivities();
                progress = 40;
                showLoading(`Activities downloaded (${activities.length})`, progress, elapsed());
                if (!isDemoMode()) {
                    console.log(`[Strava] Activities downloaded from API (${activities.length}):`, activities);
                }
                // Cache the raw Strava payload. Preprocessing mutates activity objects and runs on every load.
                await saveCachedActivities(activities, CACHE_VERSION);
            }

            // Phase 2: Load athlete, zones, and gears (40% -> 90%)
            // These are optional - if they fail, continue without them
            let athlete = null;
            let zones = null;
            let gears = [];

            progress = 52;
            showLoading('Loading athlete profile and zones...', progress, elapsed());

            try {
                // Use Promise.allSettled with timeout to prevent hanging
                const timeout = 8000; // 8 second timeout per request
                const athletePromise = Promise.race([
                    fetchAthleteData(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Athlete fetch timeout')), timeout))
                ]);
                const zonesPromise = Promise.race([
                    fetchTrainingZones(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Zones fetch timeout')), timeout))
                ]);

                const results = await Promise.allSettled([athletePromise, zonesPromise]);

                if (results[0].status === 'fulfilled') {
                    athlete = results[0].value;
                    if (!isDemoMode()) console.log('[Strava] Athlete data:', athlete);
                } else {
                    console.warn('Failed to load athlete data:', results[0].reason);
                }

                if (results[1].status === 'fulfilled') {
                    zones = results[1].value;
                    if (!isDemoMode()) console.log('[Strava] Training zones:', zones);
                } else {
                    console.warn('Failed to load zones data:', results[1].reason);
                }

                if (athlete || zones) {
                    progress = 65;
                    showLoading('Athlete profile and zones ready', progress, elapsed());
                } else {
                    showLoading('Athlete/zones unavailable (timeout or error), continuing...', 65, elapsed());
                }
            } catch (error) {
                console.warn('Failed to load athlete/zones data, continuing without:', error);
                athlete = null;
                zones = null;
                showLoading('Athlete/zones unavailable, continuing...', 65, elapsed());
            }

            // Try to load gears - also optional
            try {
                if (athlete) {
                    showLoading('Loading gear usage...', 72, elapsed());
                    gears = await fetchAllGears(athlete);
                    if (!isDemoMode()) console.log(`[Strava] Gears (${gears.length}):`, gears);
                    // Persist gears to cache with 24h TTL
                    setCachedGears(gears);
                }
            } catch (error) {
                console.warn('Failed to load gears, continuing without:', error);
                gears = [];
                showLoading('Gear unavailable, continuing...', 76, elapsed());
            }

            progress = 90;
            showLoading('Processing and enriching activities...', progress, elapsed());

            // Phase 3: Preprocess activities (90% -> 100%)
            const preprocessed = await preprocessActivities(activities, athlete, zones, gears);
            allActivities = preprocessed;
            if (!isDemoMode()) {
                console.log(`[Strava] Preprocessed activities (${allActivities.length}):`, allActivities);
                console.log('[Strava] Summary:', {
                    total: allActivities.length,
                    byType: allActivities.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {}),
                    dateRange: allActivities.length ? `${allActivities[allActivities.length - 1].start_date_local?.slice(0, 10)} → ${allActivities[0].start_date_local?.slice(0, 10)}` : 'N/A',
                    withHR: allActivities.filter(a => a.average_heartrate).length,
                    withTSS: allActivities.filter(a => a.tss).length,
                });
            }

            progress = 100;
            showLoading('Finalizing UI...', progress, elapsed());

            setupDashboard(allActivities);
            loadFilterState();
            populateGearFilters();
            renderRunAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, runGearFilter, runRollingWindow);
            renderedTabs.add('run-tab');
            setupYearlySelector();

            const initialTabId = getTabIdFromPath(window.location.pathname);
            activateTab(initialTabId, { updateUrl: true, replaceUrl: true });
        } catch (error) {
            handleError('Could not initialize the app', error);
        } finally {
            hideLoading();
        }
    }

    async function refreshActivities() {
        const t0 = Date.now();
        const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s elapsed`;
        showLoading('Refreshing activities from Strava...', 20, elapsed());
        try {
            const activities = await fetchAllActivities();
            const athlete = await fetchAthleteData();
            const zones = await fetchTrainingZones();
            let gears = [];

            try {
                gears = athlete ? await fetchAllGears(athlete) : [];
                setCachedGears(gears);
            } catch (error) {
                console.warn('Failed to load gears during refresh, continuing without:', error);
                gears = [];
            }

            // Cache the raw Strava payload before preprocessing mutates activity objects.
            await saveCachedActivities(activities, CACHE_VERSION);

            // Keep refresh aligned with initial load: preprocessing is rebuilt from raw activities.
            allActivities = await preprocessActivities(activities, athlete, zones, gears);
            showLoading(`Rebuilding views (${allActivities.length} activities)...`, 80, elapsed());

            // Reset rendered state so tabs re-render with fresh data
            renderedTabs.clear();
            loadFilterState();
            populateGearFilters();
            renderRunAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, runGearFilter, runRollingWindow);
            renderedTabs.add('run-tab');
            setupYearlySelector();
            activateTab(getTabIdFromPath(window.location.pathname));
            showLoading('Refresh completed', 100, elapsed());
        } catch (error) {
            handleError('Error refreshing activities', error);
        } finally {
            hideLoading();
        }
    }



    // --- EVENT LISTENERS ---
    if (loginButton) loginButton.addEventListener('click', redirectToStrava);
    if (demoButton) demoButton.addEventListener('click', () => {
        loginWithDemo(initializeApp);
    });
    if (logoutButton) logoutButton.addEventListener('click', logout);
    if (refreshButton) refreshButton.addEventListener('click', refreshActivities);

    // --- SERVICE WORKER REGISTRATION (PWA) ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(registration => {
                    console.log('Service Worker registrado exitosamente:', registration);
                })
                .catch(error => {
                    console.log('Error registrando Service Worker:', error);
                });
        });
    }

    // --- TRENDS FILTER LISTENERS (via custom event) ---
    document.addEventListener('trends-filters-changed', (e) => {
        const { dateFilterFrom: newFrom, dateFilterTo: newTo, sportFilter, dataType, allActivities: activities } = e.detail;
        trendsSportFilter = sportFilter;
        trendsDataType = dataType;
        dateFilterFrom = newFrom;
        dateFilterTo = newTo;
        saveFilterState();
        renderTrendsTab(activities, dateFilterFrom, dateFilterTo, trendsSportFilter, trendsDataType);
    });

    if (applyFilterButton) {
        applyFilterButton.addEventListener('click', () => {
            document.querySelectorAll('#year-filter-buttons .year-btn').forEach(b => b.classList.remove('active'));
            dateFilterFrom = dateFromEl?.value || null;
            dateFilterTo = dateToEl?.value || null;
            runGearFilter = runGearFilterEl?.value || 'all';
            saveFilterState();
            renderRunRelatedTabs();
        });
    }

    if (resetFilterButton) {
        resetFilterButton.addEventListener('click', () => {
            dateFilterFrom = null;
            dateFilterTo = null;
            if (dateFromEl) dateFromEl.value = '';
            if (dateToEl) dateToEl.value = '';
            runGearFilter = 'all';
            if (runGearFilterEl) runGearFilterEl.value = 'all';
            document.querySelectorAll('#year-filter-buttons .year-btn').forEach(b => b.classList.remove('active'));
            saveFilterState();
            renderRunRelatedTabs();
        });
    }

    if (runGearFilterEl) {
        runGearFilterEl.addEventListener('change', () => {
            runGearFilter = runGearFilterEl.value || 'all';
            saveFilterState();
            renderRunRelatedTabs();
        });
    }

    // Rolling mean window selector for Run Tab
    const runRollingWindowEl = document.getElementById('rolling-window-run');
    if (runRollingWindowEl) {
        runRollingWindow = parseInt(runRollingWindowEl.value) || 26;
        runRollingWindowEl.addEventListener('change', () => {
            runRollingWindow = parseInt(runRollingWindowEl.value) || 26;
            renderRunRelatedTabs();
        });
    }

    // Rolling mean window selector for Bike Tab
    const bikeRollingWindowEl = document.getElementById('rolling-window-bike');
    if (bikeRollingWindowEl) {
        bikeRollingWindow = parseInt(bikeRollingWindowEl.value) || 26;
        bikeRollingWindowEl.addEventListener('change', () => {
            bikeRollingWindow = parseInt(bikeRollingWindowEl.value) || 26;
            renderBikeAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, bikeGearFilter, bikeRollingWindow);
        });
    }

    // Rolling mean window selector for Swim Tab
    const swimRollingWindowEl = document.getElementById('rolling-window-swim');
    if (swimRollingWindowEl) {
        swimRollingWindow = parseInt(swimRollingWindowEl.value) || 26;
        swimRollingWindowEl.addEventListener('change', () => {
            swimRollingWindow = parseInt(swimRollingWindowEl.value) || 26;
            renderSwimAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, swimRollingWindow);
        });
    }

    // Bike Tab Filters
    if (bikeApplyFilterButton) {
        bikeApplyFilterButton.addEventListener('click', () => {
            document.querySelectorAll('#bike-year-filter-buttons .year-btn').forEach(b => b.classList.remove('active'));
            dateFilterFrom = bikeDateFromEl?.value || null;
            dateFilterTo = bikeDateToEl?.value || null;
            bikeGearFilter = bikeGearFilterEl?.value || 'all';
            saveFilterState();
            renderBikeAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, bikeGearFilter, bikeRollingWindow);
        });
    }

    if (bikeResetFilterButton) {
        bikeResetFilterButton.addEventListener('click', () => {
            dateFilterFrom = null;
            dateFilterTo = null;
            if (bikeDateFromEl) bikeDateFromEl.value = '';
            if (bikeDateToEl) bikeDateToEl.value = '';
            bikeGearFilter = 'all';
            if (bikeGearFilterEl) bikeGearFilterEl.value = 'all';
            document.querySelectorAll('#bike-year-filter-buttons .year-btn').forEach(b => b.classList.remove('active'));
            saveFilterState();
            renderBikeAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, bikeGearFilter, bikeRollingWindow);
        });
    }

    if (bikeGearFilterEl) {
        bikeGearFilterEl.addEventListener('change', () => {
            bikeGearFilter = bikeGearFilterEl.value || 'all';
            saveFilterState();
            renderBikeAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, bikeGearFilter, bikeRollingWindow);
        });
    }

    // Swim Tab Filters
    if (swimApplyFilterButton) {
        swimApplyFilterButton.addEventListener('click', () => {
            document.querySelectorAll('#swim-year-filter-buttons .year-btn').forEach(b => b.classList.remove('active'));
            dateFilterFrom = swimDateFromEl?.value || null;
            dateFilterTo = swimDateToEl?.value || null;
            saveFilterState();
            renderSwimAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, swimRollingWindow);
        });
    }

    if (swimResetFilterButton) {
        swimResetFilterButton.addEventListener('click', () => {
            dateFilterFrom = null;
            dateFilterTo = null;
            if (swimDateFromEl) swimDateFromEl.value = '';
            if (swimDateToEl) swimDateToEl.value = '';
            document.querySelectorAll('#swim-year-filter-buttons .year-btn').forEach(b => b.classList.remove('active'));
            saveFilterState();
            renderSwimAnalysisTab(allActivities, dateFilterFrom, dateFilterTo, swimRollingWindow);
        });
    }

    // --- APP ENTRY POINT ---
    handleAuth(initializeApp).catch(error => {
        console.error('App failed to start:', error);
        hideLoading();
    });
});
