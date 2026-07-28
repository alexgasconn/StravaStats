# StravaStats Repository Instructions

These instructions apply to the entire repository. A nested `AGENTS.md` may add
more specific rules for its directory, but it must not weaken the safety rules
defined here.

## Project direction and facts

- StravaStats v2 is a local-first migration of the existing Strava-backed V1.
- Preserve the working V1 path until an approved migration and rollback path
  exists.
- Resolve conflicts in this order: accepted ADRs, product PRD, engineering
  plans and release gates, the current task brief, then implementation details.
- Proposed ADRs are not authorization to freeze an undecided contract.
- Historical conversations are context, not a durable source of truth.

## Data safety and privacy

- Never delete or overwrite Legacy IndexedDB or future V2 data as a migration
  shortcut.
- Disconnecting Strava and deleting local data must remain separate actions.
- Do not commit real FIT, TCX, GPX, Strava ZIP, GPS tracks, heart-rate, power,
  tokens, exports, screenshots, or other identifiable athlete data.
- Test fixtures must be synthetic and deterministic. Private fixtures belong
  only in `tests/fixtures/private/`, which is ignored and prohibited by the
  privacy guard.
- Do not log tokens, authorization headers, raw private activities, or precise
  location data.

## Git and worktrees

- Work only in the branch and worktree assigned by the active task brief.
- Do not directly modify `main`, `maintenance/v1`, or `integration/v2`.
- Do not rebase, amend, force-push, delete branches, or remove worktrees unless
  the user explicitly authorizes it.
- Stage only the task's allowed paths; do not use `git add .`.
- Keep unrelated user changes intact.

## Scope and architecture

- Keep PRs small and aligned with one task brief.
- Do not combine schema, storage, provider migration, analysis changes, and UI
  redesign in one PR.
- Default feature flags must preserve Legacy behavior.
- Data migrations must be additive, idempotent, observable, and recoverable.
- Repository boundaries must prevent pages and analysis modules from choosing
  persistence or source-specific behavior directly.

## Required verification

Run the checks required by the task brief. The repository minimum is:

```bash
npm ci
npm run check:syntax
npm run check:privacy
npm test
git diff --check
```

Tests must not require network access, Strava credentials, or private fixtures.
Do not claim a browser, migration, or CI check passed unless it actually ran.

## Completion report

Report:

- the behavior and files changed;
- tests and checks actually executed;
- migration, privacy, and rollback impact;
- known limitations or blocked verification;
- commit, PR, and CI status when applicable.
