/**
 * Ko-fi Support System
 * Handles voluntary support modal with smart visibility logic
 */

const KOFI_USER = 'alexgn';
const KOFI_URL = `https://ko-fi.com/${KOFI_USER}`;
const STORAGE_KEY = 'stravastats_kofi_last_seen';
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds
let modalShownThisSession = false;

/**
 * Check if Ko-fi modal should be shown
 */
export function shouldShowKofiModal() {
    // Only restriction: don't show more than once per session
    if (modalShownThisSession) return false;
    return true;
}

/**
 * Mark modal as shown in localStorage and session
 */
export function markKofiModalShown() {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    modalShownThisSession = true;
}

/**
 * Create and show Ko-fi modal
 */
export function showKofiModal() {
    if (!shouldShowKofiModal()) return;

    const modal = createKofiModal();
    document.body.appendChild(modal);

    // Handle close actions
    const closeBtn = modal.querySelector('.kofi-modal-close');
    const backdrop = modal.querySelector('.kofi-modal-backdrop');

    const closeModal = () => {
        markKofiModalShown();
        modal.remove();
    };

    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);

    // ESC key to close
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            document.removeEventListener('keydown', handleEsc);
            closeModal();
        }
    };
    document.addEventListener('keydown', handleEsc);
}

/**
 * Create Ko-fi modal DOM element
 */
function createKofiModal() {
    const div = document.createElement('div');
    div.className = 'kofi-modal-wrapper';
    div.innerHTML = `
    <div class="kofi-modal-backdrop"></div>
    <div class="kofi-modal-content">
      <button class="kofi-modal-close" aria-label="Close support modal">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      
      <div class="kofi-modal-header">
        <h2>Support StravaStats ☕</h2>
      </div>
      
      <div class="kofi-modal-body">
        <p class="kofi-critical-message">
          <strong>Strava just broke its API ecosystem.</strong>
        </p>
        
        <p class="kofi-main-message">
          As of June 2026, Strava implemented aggressive restrictions on its API:
        </p>

        <ul class="kofi-changes-list">
          <li><strong>Subscription requirement:</strong> All developers now need a Strava subscription to access the API</li>
          <li><strong>Limited tier access:</strong> Apps are restricted to "Standard Tier" (10 athletes max)</li>
          <li><strong>No more free development:</strong> What was free to build is now behind a paywall</li>
          <li><strong>Kill switch threats:</strong> Endpoints deprecated without notice (Segments, Club data)</li>
          <li><strong>Intermediary bans:</strong> Technical restrictions on app architecture</li>
        </ul>

        <p class="kofi-context-message">
          <strong>StravaStats was built entirely independent and free.</strong> 
          It processes your data locally in your browser—nothing sent to servers, 
          zero profit motive. Now maintaining it requires paying Strava for API access.
        </p>

        <p class="kofi-learn-more">
          📖 
          <a href="https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428" 
             target="_blank" rel="noreferrer noopener" class="kofi-link">
            Read Strava's official announcement
          </a>
          &nbsp;•&nbsp;
          <a href="https://www.reddit.com/r/selfhosted/comments/1ttve5y/stravas_new_developer_program_just_killed_every/" 
             target="_blank" rel="noreferrer noopener" class="kofi-link">
            See developer reactions
          </a>
        </p>

        <p class="kofi-support-message">
          If you find StravaStats useful and want to support independent development, 
          any contribution helps keep it alive.
        </p>
        
        <a 
          href="${KOFI_URL}" 
          target="_blank" 
          rel="noreferrer noopener"
          class="kofi-support-btn"
        >
          Support on Ko-fi ☕
        </a>

        <p class="kofi-disclaimer">
          <em>The app remains completely free and usable. Support is entirely optional.</em>
        </p>
      </div>
    </div>
  `;
    return div;
}

/**
 * Initialize Ko-fi system on page load
 * Call this from main.js after app is ready
 */
export function initKofiSystem() {
    // Show modal after a brief delay to ensure DOM is ready
    setTimeout(() => {
        if (shouldShowKofiModal()) {
            showKofiModal();
        }
    }, 500);
}
