# Test Directory Instructions

These rules extend the repository-level `AGENTS.md` for all files under
`tests/`.

- Use the built-in `node:test` runner unless an accepted task explicitly
  approves another runner.
- Tests must be deterministic, isolated, and runnable without network access,
  Strava credentials, browser profiles, or private files.
- Store committed sports-data fixtures only under `tests/fixtures/synthetic/`.
- Never read, enumerate, copy, or commit `tests/fixtures/private/`.
- Synthetic fixtures must not be derived from a real athlete export.
- Prefer small contract fixtures over full activity archives.
- Restore mutated globals, clocks, environment variables, and storage mocks.
- A test command must fail when no tests are discovered or an assertion fails.
