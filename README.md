# Strava Dashboard

Strava Dashboard is a privacy-oriented sports analytics web application for athletes who want more control, transparency, and technical depth than the default Strava experience provides. The application connects directly to a user's Strava account, retrieves activity history, enriches it with derived metrics, and renders a multi-tab analysis workspace for running, cycling, swimming, planning, weather, route mapping, gear lifecycle tracking, annual reporting, and browser-side AI-assisted coaching.

The project is designed for self-coached athletes, endurance amateurs, data-oriented hobbyists, and engineers interested in training analytics. It solves a common gap in consumer fitness products: raw workout history is easy to collect, but difficult to transform into an interpretable model of consistency, training load, performance trends, equipment wear, and sport-specific patterns. This application addresses that gap by combining Strava data retrieval, client-side preprocessing, derived feature engineering, interactive visualizations, and sport-specific heuristics in a single progressive web app.

The application is deployed as a static frontend plus Vercel serverless API layer. Authentication and token refresh are handled through serverless proxies, while the majority of transformation and visualization logic executes in the browser. No application database is used.

## Documentation Map

### StravaStats v2

- [V2 documentation index](./docs/README.md)
- [V2 product requirements](./docs/product/stravastats-v2-prd.md)
- [V2 development plan](./docs/engineering/v2-development-plan.md)
- [V2 architecture overview](./docs/architecture/overview.md)
- [V2 release gates](./docs/engineering/release-gates.md)
- [V2 migration and rollback](./docs/migrations/rollback-plan.md)

### Current V1 implementation

- [Technical guide](./TECHNICAL_GUIDE.md)
- [Local setup](./LOCAL_SETUP.md)
- [PWA guide](./PWA_GUIA.md)

## Project Overview

### What the application does

At a high level, the application:

- Authenticates a user with Strava using OAuth 2.0.
- Downloads complete activity history through paginated Strava API requests.
- Caches athlete, zone, gear, and activity data locally with different TTL policies.
- Computes global and sport-specific summaries such as distance, duration, elevation, pace, speed, cadence, HR-derived load, and trend metrics.
- Organizes the experience into specialized tabs for dashboarding, per-sport analysis, athlete profiling, predictions, gear lifecycle tracking, activity search, calendar consistency, weather correlation, geographic visualization, annual reporting, and AI-based question answering.
- Provides deeper activity-level analysis through dedicated detail pages that ingest Strava streams and run a point-level preprocessing and analysis pipeline.

### Intended users

This project is for:

- Runners who want better control over pace, consistency, PB tracking, and prediction models.
- Cyclists who want distance, elevation, power, cadence, bike-type segmentation, and route-level analysis.
- Swimmers who need pool versus open-water separation, pace-per-100m metrics, and pool-length estimation.
- Multi-sport athletes who want one consolidated training data surface.
- Engineers and analysts who prefer transparent, inspectable heuristics over opaque product metrics.

### Problem solved

Most training platforms expose activity history, but not a production-quality analytical workflow. Athletes often need to piece together spreadsheets, exported files, or third-party dashboards to answer routine questions such as:

- Is my training load trending productively or dangerously?
- What are my real patterns by weekday, hour, or season?
- Which shoes are near replacement?
- How does weather affect my running pace?
- What can my recent race history plausibly predict for the next distance?
- Where do my routes cluster geographically?
- What happened inside a given activity at the stream level?

Strava Dashboard answers those questions in a single system with explicit data flow and reproducible calculations.

## Data Sources

The application combines several classes of data:

- Strava athlete metadata via `/api/strava-athlete`
- Strava activity history via `/api/strava-activities`
- Strava activity detail metadata via `/api/strava-activity`
- Strava training zones via `/api/strava-zones`
- Strava gear metadata via `/api/strava-gear`
- Strava activity streams via `/api/strava-streams`
- Local browser persistence via `localStorage` and IndexedDB (activity payload cache)
- Historical weather enrichment from Open-Meteo archive endpoints for geolocated runs
- Derived outputs exported as GPX, CSV, and JSON from the advanced activity analysis flow

### File and payload types involved

- JSON: all API payloads, cached objects, derived analysis artifacts
- GPX: reconstructed export of analyzed activities
- CSV: tabular export of processed track points
- Encoded polylines: route rendering for the Map tab and detail pages
- Browser storage keys and stores: authentication tokens, filters, gear settings, athlete profile, zones, activity-cache metadata (`localStorage`) plus activity payloads in IndexedDB (`strava-dashboard-cache`), and AI conversation state

## Key Features

The SPA exposes thirteen main tabs and several dedicated detail pages. Each tab is implemented as a renderer in `js/tabs/<name>.js`.

### Dashboard (`js/tabs/dashboard.js`)

Training-load and consistency overview. Computes daily TSS, 7-day ATL, 42-day CTL, TSB, and a 7-day rolling load over a user-selected window. Renders KPI cards, an acute-load chart, a consistency heatmap, and goal progress (km, hours, or activity count). Range selector offers nine presets (This Week, Last 7 Days, This Month, Last 30 Days, Last 3 Months, Last 6 Months, This Year, Last 365 Days, All Time) plus a custom DD/MM/YYYY From/To pair with an Apply button. The acute-load band mode is hardcoded to `'aggressive'`. Derived per-window slices are memoized in a module-local `dashboardMemo` Map.

### Run Analysis (`js/tabs/run-analysis.js`)

Running-only subset with date and shoe (gear) filters. Summary cards, run-type chart, monthly distance and frequency, pace-vs-distance scatter, distance and elevation histograms, accumulated distance, weekly rolling-mean trend, consistency heatmap, run heatmap map, top runs, Eddington section, monthly shoe-usage Gantt, and a sortable activity table.

### Bike Analysis (`js/tabs/bike-analysis.js`)

Cycling subset segmented by bike type (road, MTB, gravel, indoor, electric) and bike gear. Summary cards, bike-type pie, distance and elevation histograms, speed-vs-distance, distance-vs-elevation, elevation-ratio, power-vs-speed scatters, accumulated distance, weekly trend, consistency heatmap, Eddington distribution and progression, top rides, and a sortable activities table.

### Swim Analysis (`js/tabs/swim-analysis.js`)

Pool vs open-water separation, pace per 100 m, pool-length estimation against common metric and imperial pool lengths. Summary cards, pool/open-water comparison, distance and pace histograms, pace-vs-distance scatter, pace/HR curve, volume improvement, efficiency evolution, accumulated distance, weekly trend, consistency heatmap, pool-length chart, Eddington section, top swims, and a sortable swims table.

### Athlete (`js/tabs/athlete.js`)

Profile and behavior lens. Athlete card, all-time totals, records, training zones (HR and power), duration and start-time histograms, group-size histogram by metric type, activity-frequency histogram (daily/weekly/monthly), yearly comparison bars, weekly and monthly mix views, and several interactive matrix heatmaps with selectable axes and data type (time, count, distance).

### Planner / Predictor (`js/tabs/planner.js`)

Race-time prediction blending Riegel scaling, VDOT-style transfer, direct PB matching, and personal curve fitting with user-adjustable weights and conservative/moderate/aggressive scenarios. Personal-bests table, prediction table, prediction-evolution chart, training readiness section.

### Gear (`js/tabs/gear.js`)

Gear lifecycle tracking. Per-item distance, usage count, first/last-use dates, average distance per use, average pace (for run gear), health percentage versus configurable expected durability, sortable gear list, distance-by-gear chart, monthly usage Gantt, and per-gear detail page.

### Activities (`js/tabs/activities.js`)

Universal query layer over the preprocessed activity catalog with multi-select sport, name search, date range, distance range, duration range, HR range, and TSS range filters. Sortable table with sport-aware pace/speed formatting.

### Calendar (`js/tabs/calendar.js`)

Week, month, and year views with type filtering. Day and week streaks, activities per day, total distance, hours, active days, TSS. Click a day for the detailed activity list.

### Weather (`js/tabs/weather.js`)

Open-Meteo archive enrichment for runs with start coordinates. Summary cards, monthly multi-variable overview, weather-conditions pie, temperature-vs-pace scatter, configurable histogram (temperature, rain, wind, humidity, clouds, pressure), and a weather-per-activity table.

### Maps (`js/tabs/maps.js`)

Leaflet visualization with route-polyline and density-heatmap modes, sport filter, date range, multiple tile providers, heatmap intensity/radius/blur sliders, and color-by-sport toggle. Polylines are decoded client-side from the Strava `map.summary_polyline` field.

### Wrapped / Report (`js/tabs/wrapped.js`)

Year-in-sport retrospective with distance, time, elevation, activities, active days, longest activity, average distance, most active month, year-over-year deltas, monthly volume, sport-distribution pie, year comparison, top weeks, and monthly heatmap.

### AI Chat / Coach (`js/tabs/ai-chat.js`)

Browser-side conversational assistant. Uses a user-supplied Gemini API key persisted to localStorage, assembles a context block from totals, sport breakdown, PB-like stats, gear summaries, and recent monthly volume, then calls Gemini Flash directly from the browser. Persistent chat history with starter suggestions.

### Activity-level advanced analysis (`js/pages/activity/`)

Dedicated per-activity pages fetch metadata and streams from Strava, reconstruct a structured `ActivityTrack` with `TrackPoint`s, run the preprocessing and detection pipeline in `js/analysis/`, render stream charts and split tables, and support GPX, CSV, and JSON export.

## Per-Activity Derived Fields

`preprocessActivities` in `js/shared/preprocessing/core.js` enriches each activity object with derived metrics. The current cache schema version is `'v2-efficiency-moving-ratio'` and the following fields are added in addition to the existing TSS, CTL, ATL, TSB, weather, and VO2max fields:

- `efficiency` (number | null) — sport-aware aerobic efficiency:
  - Run: `pace_min_per_km / avgHR` (units: min/km/bpm; lower is better).
  - Swim: `pace_min_per_100m / avgHR` (units: min/100m/bpm; lower is better).
  - Bike / Ride / Cycling: `avg_speed_kmh / avgHR` (units: km/h/bpm; higher is better).
  - Null when `avgHR`, `distance`, or `moving_time` are missing or non-positive.
- `efficiency_method` (string | null) — one of `'pace_per_hr'`, `'pace100m_per_hr'`, `'speed_per_hr'`, or `null`.
- `moving_ratio` (number | null) — `moving_time / elapsed_time`, decimal 0–1; null when `elapsed_time <= 0`.

## Cache Versioning

`js/app/main.js` defines `CACHE_VERSION = 'v2-efficiency-moving-ratio'` and validates it through `js/services/activity-cache.js`.

- Activity payloads are persisted in IndexedDB (`strava-dashboard-cache`, store `entries`, key `strava_activities`).
- Metadata such as `strava_cache_version` and timestamps is kept in `localStorage`.
- On boot, `getCachedActivities({ cacheVersion, maxAgeMs })` only accepts cache entries that match the current schema version and TTL.
- On miss, the app fetches from Strava and writes through `saveCachedActivities(...)`.
- If IndexedDB is unavailable, the service transparently falls back to `localStorage`.

Bumping `CACHE_VERSION` whenever preprocessing semantics change ensures stale payloads are ignored and regenerated.

## Architecture And System Design

### High-level architecture

The application uses a hybrid architecture:

- Frontend: static HTML plus native ES modules served directly in the browser
- Backend: Vercel serverless functions that proxy Strava API requests and handle secure OAuth token exchange and refresh
- Storage: browser `localStorage` for session/UI metadata plus IndexedDB for large cached activity payloads
- Visualization: Chart.js, `chartjs-chart-matrix`, D3, Cal-Heatmap, Leaflet, and Leaflet.heat
- Deployment: Vercel rewrites route tab paths to the SPA entrypoint

The main architectural separation is between:

- Tab-level product analytics for the multi-tab dashboard experience
- Stream-level detailed analysis for individual activities

### Data flow

The primary dashboard flow is:

1. The user authenticates with Strava.
2. The frontend exchanges the authorization code through `/api/strava-auth`.
3. Tokens are stored in `localStorage` and encoded into an Authorization header for subsequent backend calls.
4. The frontend requests athlete metadata, training zones, complete paginated activity history, and gear metadata.
5. `preprocessActivities` enriches the activity collection with derived fields such as training stress and contextual metrics.
6. Tab renderers consume the processed activities and apply tab-specific filters and aggregations.
7. Charts, tables, heatmaps, and map layers are rendered lazily when tabs are first opened.

The activity-detail flow is more granular:

1. A selected activity ID is read from the detail-page URL.
2. The frontend requests activity metadata and the required Strava streams.
3. Stream data is converted into a structured track model.
4. The preprocessing pipeline removes anomalies and smooths noisy series.
5. Detection, segmentation, sport-specific analyzers, and advanced engines compute insights.
6. The UI renders charts, splits, climb summaries, HR analysis, and export actions.

### ETL pipeline

The project contains a clear ETL-style processing path.

#### Ingestion

Data ingestion occurs through the Vercel API layer. Activity history is fetched from Strava using page size 100 and repeated until an empty page is returned. Athlete profile, training zones, gear metadata, individual activity metadata, and activity streams are retrieved through dedicated endpoints.

#### Cleaning

The cleaning stage includes:

- JSON cache validation and TTL expiry checks
- Swim distance correction for a known athlete-specific historical pool misconfiguration
- GPS spike interpolation on point-level tracks
- Hampel-filter-based altitude anomaly replacement
- Speed spike reduction

#### Transformation

Transformations include:

- Pace, speed, cadence, elevation-ratio, and time-normalized metric derivation
- HR-zone-aware TSS estimation with fallbacks to simpler methods when data is incomplete
- Calendar and weekly bucketing for trend views
- Gear aggregation and name mapping
- Weather enrichment for geolocated runs
- Polyline decoding for geographic visualization

#### Feature extraction

Feature extraction includes:

- CTL, ATL, TSB, and injury-risk style heuristics
- Run and bike activity classifications
- Swim type identification and pool-length inference
- Terrain, climb, stop, and segment detection on detailed activities
- Fatigue, physiological, and aero-derived indicators on stream-based analysis
- Predictor-model features derived from PBs and race-distance matching

#### Visualization

The visualization stage renders transformed data into summary cards, tables, histograms, scatter plots, line charts, pie charts, matrix heatmaps, and map layers.

### State management

There is no framework-managed application store. State is handled through module-level variables in `js/app/main.js`, DOM-driven controls, and persisted browser state.

Key state classes include:

- Loaded activities
- Global date filters
- Per-tab gear filters
- Athlete tab sport and data-type selectors
- User settings such as unit system, age, and max HR
- Cached API payloads and timestamps
- AI chat history and Gemini API key

Tabs are lazily rendered and tracked through a `renderedTabs` set so initial load cost remains bounded.

### Filtering model

Filtering operates in three layers:

- Global tab-local date filters shared across several tabs
- Domain filters such as gear, sport, chart variable, or year selectors
- Table-level query filters such as name and numeric ranges

Most filters are applied in memory to the already-loaded activity array. This keeps the interface responsive once data is fetched, but it means the browser owns the analysis workload.

### Chart generation

Charts are generated on the client and depend on per-tab aggregation logic. The system primarily uses:

- Chart.js for line, bar, pie, scatter, and histogram-style views
- Chart.js matrix plugin for dense matrix heatmaps
- Cal-Heatmap for GitHub-style calendar consistency views
- Leaflet and Leaflet.heat for map rendering
- D3 as a supporting visualization dependency

### Authentication, token refresh, and API behavior

Authentication uses Strava OAuth 2.0. Tokens are stored locally and refreshed server-side when they are about to expire. Each API request sends a base64-encoded token payload in the Authorization header to the Vercel backend, where the token is decoded and validated.

Important operational details:

- Activity pagination fetches all pages until exhaustion.
- Athlete, zones, and gear are cached for 24 hours.
- Activities are cached for 1 hour.
- Updated tokens are returned by backend endpoints and written back to `localStorage`.
- The current implementation does not include a server-side database or queue.

### Routing and deployment design

The app is a path-routed SPA. Vercel rewrites route segments such as `/run`, `/dashboard`, `/bike`, `/weather`, and `/ai-coach` to `/index.html`, while static asset paths and `/api/*` remain directly addressable.

## Technical Stack

### Frontend

- HTML5
- CSS
- Vanilla JavaScript using native ES modules
- Chart.js
- `chartjs-chart-matrix`
- D3.js
- Cal-Heatmap
- Leaflet
- Leaflet.heat

### Backend

- Vercel serverless functions
- Node.js runtime
- `node-fetch`

### Analytics and runtime services

- Strava API v3
- Open-Meteo historical archive API
- Gemini Flash preview endpoint for AI Coach
- Vercel Speed Insights

### Deployment

- Vercel
- PWA manifest and service worker for installability and static-asset caching

## How To Run The Project

### Prerequisites

- Node.js 18+
- A Strava account
- A registered Strava developer application
- The included local Node.js dev server

### Required environment variables

Configure these server-side variables for local development and deployment:

- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`

The AI Coach feature does not require a server environment variable. The user supplies a Gemini API key inside the UI, and the key is stored only in the browser under `localStorage`.

### Installation

```bash
npm install
```

### Local development

Create local environment variables, install dependencies, and run the local dev server:

```bash
cp .env.example .env.local
npm install
npm run dev
```

`npm run dev` runs `scripts/local-dev-server.mjs`, a small Node `http` server that serves the static frontend and dynamically imports the matching file in `api/` for any request to `/api/*`. The default port is `3001` (override with `PORT`). Required env vars: `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` from `.env.example`.

Then open the local URL printed by the dev server and authenticate with Strava. To browse without a Strava account, click the demo button in the connect screen (`js/demo/index.js` sets `localStorage('strava_demo_mode')='true'` and generates ~250 synthetic activities). See [LOCAL_SETUP.md](LOCAL_SETUP.md) for the full Strava OAuth setup and troubleshooting checklist.

### Recommended local setup sequence

1. Create or configure your Strava developer application with the correct redirect URL.
2. Copy `.env.example` to `.env.local` and set `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`.
3. Install dependencies with `npm install`.
4. Run `npm run dev`.
5. Open the app and connect with Strava.
6. If you want AI Coach, paste your Gemini API key into the AI tab after the app loads.

### Deployment notes

For production deployment on Vercel:

1. Import the repository into Vercel.
2. Configure the same Strava environment variables.
3. Ensure the Strava redirect URI matches the deployed domain.
4. Deploy and validate OAuth login, token refresh, and route rewrites.

## Data Engineering Details

### Cleaning and data quality handling

The project contains explicit data-quality logic rather than assuming raw API cleanliness.

- Missing fields are handled with fallbacks in most summary calculations.
- Cached JSON is guarded against parse errors.
- Altitude outliers are replaced using a Hampel-style filter.
- GPS spikes are interpolated based on neighboring points.
- Speed anomalies are smoothed to prevent visually unstable stream charts.
- Swim records without GPS are treated as indoor/pool candidates.
- Historical swim distance correction is applied for a known athlete-specific case.

### Outliers, noise, and smoothing

The detailed analysis pipeline performs several denoising steps:

- GPS jitter mitigation through spike interpolation
- Altitude smoothing through moving windows after anomaly correction
- Grade smoothing
- Speed smoothing only on moving segments
- Derived-metric recomputation after cleaning

These steps improve downstream climb detection, fatigue heuristics, and chart readability.

### Aggregations and rolling windows

Across the app, the codebase uses:

- Daily bucketing for calendars and TSS distributions
- ISO-style weekly aggregation for trend charts and streak logic
- Monthly aggregation for seasonal and annual views
- Rolling means such as 5-week run and bike volume trends
- Exponential moving averages for ATL and CTL

### Domain-specific metrics

Notable domain metrics include:

- Pace in min/km for running
- Pace per 100 m for swimming
- Speed in km/h for cycling and general movement sports
- Elevation ratio in m/km
- TSS with power, HR-zone, HR-ratio, suffer-score, and time-only fallback modes
- VO2max estimate for qualifying runs
- CTL, ATL, TSB, and injury-risk proxies
- HR zone time distribution
- Pool-length estimation for swims
- VAM and climb segmentation for analyzed activities
- Fatigue onset and severity heuristics
- Environmental difficulty scoring for weather-enriched runs

## Machine Learning And Analytics

This application is analytics-heavy but intentionally lightweight on opaque machine learning. Most models are deterministic, interpretable, and built for personal training analytics rather than offline supervised training.

### Models and heuristics used

- Riegel prediction formula for endurance race-time scaling
- VDOT-style prediction logic for running performance transfer
- Personal curve fitting in the Predictor tab
- Heuristic run classification
- Heuristic bike classification
- HR-zone-based load estimation
- Fatigue onset heuristics on stream windows
- Environmental difficulty scoring

### Why these methods were chosen

These methods are appropriate for a browser-first product because they:

- Are explainable to end users
- Require no external model-serving layer
- Degrade gracefully when data is incomplete
- Fit the personal analytics use case better than heavyweight generalized models

### Evaluation and interpretation

The codebase does not expose a formal offline evaluation suite for prediction accuracy or classifier benchmarking. Instead, it favors transparent formulas whose failure modes are understandable. In practical terms, the quality of outputs depends on:

- Coverage of heart rate, cadence, and power streams
- Correctness of Strava metadata
- Availability of race-like efforts in personal history
- GPS quality and route geometry

## Visualizations

The project uses a broad visualization set, each chosen for a specific analytical role.

- Summary cards communicate scalar KPIs quickly.
- Line charts show progression and rolling behavior over time.
- Scatter plots reveal pace-distance, power-speed, and temperature-performance relationships.
- Histograms show distributions and variability.
- Pie charts expose composition, such as bike-type or sport-share splits.
- Calendar heatmaps communicate consistency and streak behavior.
- Matrix heatmaps reveal temporal patterns across combinations like hour by weekday or year by month.
- Leaflet route maps and density heatmaps provide geographic context.

Interactivity includes:

- Tab-level lazy rendering
- Sortable tables
- Gear, date, year, sport, and variable selectors
- Route mode versus heatmap mode on maps
- Sliders and scenario selectors in the Predictor tab
- AI-chat prompt entry and persisted conversation history

## Performance Considerations

- All dashboard analytics execute in the browser after data fetch.
- Detailed activity analysis also runs on the main thread, so large activities may temporarily block the UI.
- Activity history pagination can trigger many Strava calls for long-tenure athletes.
- Weather enrichment increases network cost for runs with GPS coordinates.
- `localStorage` is simple and privacy-friendly, but not ideal for large structured datasets.
- Lazy tab rendering reduces first-paint cost by deferring chart generation.

## Limitations

- No database means no long-term server-side persistence, offline sync, or multi-device shared state.
- Strava rate limits remain a practical constraint for large activity histories and repeated refreshes.
- Some analytics depend on HR, cadence, power, or GPS streams that may be absent.
- Swim distance correction includes a hardcoded athlete-specific rule and is not generalized.
- Detailed analysis is richer than the tab-level summaries, which means some metrics exist only on activity pages.
- The project currently relies on local browser storage for tokens and preferences.

## Known Issues And Caveats

- The local development workflow depends on the included Node.js dev server so API routes work during Strava OAuth.
- The predictor and classification layers are heuristic and should be treated as decision support, not ground truth.
- Weather enrichment is approximate and based on hourly historical data, not exact on-route microclimate.
- GPX export is reconstructed from processed streams rather than original device files.

## Future Improvements

- Introduce Web Workers for heavy stream analysis.
- Add IndexedDB for larger local caches and better offline behavior.
- Generalize athlete-specific correction logic into configurable user settings.
- Add formal test coverage for predictor outputs and classification heuristics.
- Expand sport-specific models for trail running, open-water swimming, and structured cycling sessions.
- Introduce server-side aggregation or snapshot caching to reduce repeated Strava fetch pressure.

## Repository Structure

```text
api/                              Vercel serverless functions (Strava OAuth proxy and endpoints)
  _shared.js                      shared header/token helpers
  config.js                       Strava client id / secret bridge
  strava-auth.js                  OAuth code exchange + refresh
  strava-activities.js            paginated activity history
  strava-activity.js              single activity metadata
  strava-athlete.js               athlete profile
  strava-gear.js                  gear metadata
  strava-streams.js               Strava activity streams
  strava-zones.js                 training zones (HR + power)
html/                             Dedicated detail-page HTML shells
  activity-router.html, activity.html, run.html, bike.html, swim.html, gear.html, wrapped.html
media/                            Per-tab background images (see media/README.md)
scripts/
  local-dev-server.mjs            Node dev server used by `npm run dev`
js/
  main.js                         Re-exports from js/app/main.js for direct script loading
  app/                            App bootstrap, OAuth, navigation, shared UI orchestration
    main.js, auth.js, ui.js
  tabs/                           Renderer modules for the thirteen main SPA tabs
    dashboard.js, run-analysis.js, bike-analysis.js, swim-analysis.js,
    athlete.js, planner.js, gear.js, activities.js, calendar.js,
    weather.js, maps.js, wrapped.js, ai-chat.js
    index.js, utils.js, api.js    barrel and tab-local helpers
  pages/                          Controllers for dedicated detail pages
    activity/                     activity.js, advanced-analysis.js, analysis-ui-components.js
    run/, bike/, swim/, gear/     per-sport detail pages
  shared/
    preprocessing/                core.js — preprocessActivities and derived fields
    utils/                        core.js — formatters, math, helpers; weather-analysis.js; speed-insights.js
  analysis/                       Stream-level activity analysis pipeline
    config.js, index.js, preprocessing.js, virtual-gpx.js
    analyzers/                    base-analyzer, running, trail-run, cycling, gravel-mtb, hiking
    detection/                    climbs, stops
    engines/                      fatigue, aero, physiology, insights-generator
    segmentation/                 distance/time/terrain segmentation
    export/                       gpx, csv, json
  services/                       API clients and browser cache layer
    api.js, index.js
  demo/                           Offline demo-data generator and gating
    index.js, generator.js, polylines.js
  models/                         Analysis-domain typed objects
    activity-track.js, track-point.js, segment.js, climb.js, analysis-result.js
styles/
  style.css                       single global stylesheet, includes sport CSS variables
index.html                        SPA entrypoint
sw.js                             Service worker (PWA, static-asset caching)
manifest.json                     PWA manifest
vercel.json                       Route rewrites
classifyRun.js, classifyBike.js   Standalone classification heuristics
```

## Sport Theming

`styles/style.css` defines four sport color CSS variables on `:root`:

- `--sport-default-color: #fc4c02` (Strava orange, used as the global accent)
- `--sport-run-color: #2e7d32`
- `--sport-bike-color: #1565c0`
- `--sport-swim-color: #00838f`

The Run Analysis (`#run-tab`), Bike Analysis (`#bike-tab`), and Swim Analysis (`#swim-tab`) containers override `.chart-container` `border-top-color` and `h3` `color` to the matching sport color so charts inside those tabs are visually grouped. Background images per tab follow the mapping in `media/README.md`.

## Additional Reading

The full engineering-oriented breakdown of tabs, ETL stages, visualizations, analytics logic, and implementation caveats is documented in [TECHNICAL_GUIDE.md](./TECHNICAL_GUIDE.md).
