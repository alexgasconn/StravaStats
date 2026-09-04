// js/ui.js
import * as utils from '../shared/utils/index.js';

// --- DOM REFERENCES  ---
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMessage = document.getElementById('loading-message');
const loadingProgressBar = document.getElementById('loading-progress-bar');
const athleteName = document.getElementById('athlete-name');
const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');
// Modal elements (may not exist in older builds)
const stravaErrorModal = document.getElementById('strava-error-modal');
const stravaErrorText = document.getElementById('strava-error-text');
const stravaModalDemoBtn = document.getElementById('strava-modal-demo');
const stravaModalKoFiBtn = document.getElementById('strava-modal-ko-fi');
const stravaModalBackBtn = document.getElementById('strava-modal-back');

let _lastProgress = 0;

function _pctColor(p) {
    // Interpolate: light orange (#ff9a5c) → Strava orange (#fc5200) as p goes 0→1
    const r = Math.round(255 - 3 * p);
    const g = Math.round(154 - 72 * p);
    const b = Math.round(92 - 92 * p);
    return `rgb(${r},${g},${b})`;
}

// --- UI HELPERS ---
export function showLoading(message, progress = null) {
    _lastProgress = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : _lastProgress;

    if (loadingOverlay) {
        loadingMessage.textContent = message;
        if (loadingProgressBar) {
            loadingProgressBar.style.width = `${_lastProgress}%`;
        }
        const pctEl = document.getElementById('loading-pct');
        if (pctEl) {
            pctEl.textContent = `${Math.round(_lastProgress)}%`;
            pctEl.style.color = _pctColor(_lastProgress / 100);
        }
        loadingOverlay.style.display = 'flex';
        loadingOverlay.classList.remove('hidden');
    }
}

export function hideLoading() {
    _lastProgress = 0;
    if (loadingOverlay) {
        if (loadingProgressBar) loadingProgressBar.style.width = '0%';
        const pctEl = document.getElementById('loading-pct');
        if (pctEl) pctEl.textContent = '';
        loadingOverlay.style.display = 'none';
        loadingOverlay.classList.add('hidden');
    }
}

export function handleError(message, error) {
    console.error(message, error);
    hideLoading();
    // Detect Strava forbidden API error and show a helpful Spanish popup
    const errMsg = (error && (error.message || error.toString())) || '';
    if (errMsg.includes('Strava API: Forbidden') || /forbidden|403/i.test(errMsg)) {
        const demoBtn = document.getElementById('demo-button');
        const koFiUrl = 'https://ko-fi.com/alexgn/goal?g=0';
        // If modal exists, use it
        if (stravaErrorModal && stravaErrorText && stravaModalDemoBtn && stravaModalKoFiBtn && stravaModalBackBtn) {
            stravaErrorText.textContent = 'Strava ha cambiado su API y ahora requiere Strava Premium. La app no funcionará con cuentas gratuitas.';
            stravaErrorModal.style.display = 'flex';
            stravaErrorModal.setAttribute('aria-hidden', 'false');

            // attach handlers (use once semantics)
            const closeModal = () => {
                stravaErrorModal.style.display = 'none';
                stravaErrorModal.setAttribute('aria-hidden', 'true');
            };

            const onDemo = () => { try { if (demoBtn) demoBtn.click(); } catch (e) { } closeModal(); };
            const onKoFi = () => { try { window.open(koFiUrl, '_blank'); } catch (e) { } };
            const onBack = () => { closeModal(); };

            // Remove previous listeners to avoid duplicates
            stravaModalDemoBtn.replaceWith(stravaModalDemoBtn.cloneNode(true));
            stravaModalKoFiBtn.replaceWith(stravaModalKoFiBtn.cloneNode(true));
            stravaModalBackBtn.replaceWith(stravaModalBackBtn.cloneNode(true));

            // re-query after replace
            const demoBtnNew = document.getElementById('strava-modal-demo');
            const koFiBtnNew = document.getElementById('strava-modal-ko-fi');
            const backBtnNew = document.getElementById('strava-modal-back');

            demoBtnNew.addEventListener('click', onDemo);
            koFiBtnNew.addEventListener('click', onKoFi);
            backBtnNew.addEventListener('click', onBack);
        } else {
            // Fallback to confirm dialogs
            const wantDemo = confirm('Strava ha cambiado su API y ahora requiere Strava Premium. La app no funcionará con cuentas gratuitas.\n\nPulsa "Aceptar" para ver la demo con mis datos antiguos, o "Cancelar" para ver opciones de ayuda.');
            if (wantDemo) {
                if (demoBtn) demoBtn.click();
            } else {
                const wantHelp = confirm('Si quieres apoyar la reactivación de la app puedes ayudar pagando Strava Premium mediante una donación (Ko-fi). ¿Abrir enlace de ayuda?');
                if (wantHelp) {
                    try { window.open(koFiUrl, '_blank'); } catch (e) { /* ignore */ }
                }
            }
        }
        return;
    }

    alert(`Error: ${message}. Check console for details.`);
}

export function setupDashboard(activities) {
    loginSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    athleteName.textContent = `StravaStats`;

    const dates = activities.map(a => a.start_date_local.substring(0, 10)).sort();
    if (dates.length > 0) {
        document.getElementById('date-from').min = dates[0];
        document.getElementById('date-from').max = dates[dates.length - 1];
        document.getElementById('date-to').min = dates[0];
        document.getElementById('date-to').max = dates[dates.length - 1];
    }
    setupExportButtons(activities);
}


// --- SECCIÓN DEL SELECTOR DE AÑO ---

export function setupYearlySelector(activities, onYearSelect) {
    const yearlyBtn = document.getElementById('yearly-btn');
    const yearList = document.getElementById('year-list');
    if (!yearlyBtn || !yearList) return;
    const years = Array.from(new Set(activities.map(a => new Date(a.start_date_local).getFullYear()))).sort((a, b) => b - a);
    yearList.innerHTML = years.map(year => `<button class="year-btn" data-year="${year}">${year}</button>`).join('');
    yearlyBtn.onclick = () => {
        yearList.style.display = yearList.style.display === 'none' ? 'flex' : 'none';
    };
    yearList.querySelectorAll('.year-btn').forEach(btn => {
        btn.onclick = () => {
            const year = btn.getAttribute('data-year');
            const from = `${year}-01-01`;
            const to = `${year}-12-31`;
            yearList.style.display = 'none';
            if (onYearSelect) {
                onYearSelect(from, to);
            }
        };
    });
}

// --- BOTONES DE EXPORTACIÓN ---
export function setupExportButtons(activities) {
    // CSV
    document.getElementById('download-csv-btn').onclick = () => {
        if (!activities || activities.length === 0) return alert('No data to export.');
        const headers = Object.keys(activities[0]);
        const csvRows = [
            headers.join(','),
            ...activities.map(act => headers.map(h => `"${(act[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
        ];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'strava_activities.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // PDF
    document.getElementById('download-pdf-btn').onclick = () => {
        window.print();
    };
}
