import { execFileSync } from 'node:child_process';

const privatePathPatterns = [
  /^local-data\//,
  /^private-data\//,
  /^baseline-evidence\//,
  /^exports\/private\//,
  /^tests\/fixtures\/private\//,
  /(^|\/)\.env\.worktree$/,
  /(^|\/)worktree\.local\.json$/,
];

const privateEnvironmentPattern = /(^|\/)\.env(?:\.|$)/;
const allowedEnvironmentFiles = new Set(['.env.example']);
const sportsExportPattern = /\.(fit|tcx|gpx|zip)$/i;
const syntheticFixturePrefix = 'tests/fixtures/synthetic/';

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  return output.split('\0').filter(Boolean);
}

function findViolation(file) {
  if (privatePathPatterns.some(pattern => pattern.test(file))) {
    return 'private path must not be tracked';
  }

  if (privateEnvironmentPattern.test(file) && !allowedEnvironmentFiles.has(file)) {
    return 'environment file must not be tracked';
  }

  if (sportsExportPattern.test(file) && !file.startsWith(syntheticFixturePrefix)) {
    return 'sports export must be an explicitly synthetic test fixture';
  }

  return null;
}

const violations = listTrackedFiles()
  .map(file => ({ file, reason: findViolation(file) }))
  .filter(entry => entry.reason);

if (violations.length > 0) {
  console.error('Privacy check failed:');
  for (const { file, reason } of violations) {
    console.error(`- ${file}: ${reason}`);
  }
  process.exit(1);
}

console.log('Privacy check passed.');
