/**
 * Timezone tripwire.
 *
 * Company rule (2026-08-09): America/Denver is the only timezone that may
 * produce a calendar day anywhere in the pipeline — via shared/site-day.js
 * (or lib/services/sport-day.js, which delegates to it). Deriving a day
 * from UTC put wrong-day grades on months of picks; this test makes that
 * class of bug a build failure instead of a production incident.
 *
 * Existing offenders are grandfathered below so the suite stays green,
 * but the list is a ratchet: it may only shrink. Adding a UTC day
 * derivation to any new or currently-clean file fails this test. When a
 * grandfathered file gets cleaned up, remove it from the list so it can
 * never regress.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// Server-side code that stamps or matches days. src/ (frontend display)
// is exempt: user-facing rendering may localize however it likes.
const SCAN_DIRS = ['api', 'lib', 'shared', 'services'];
const SCAN_FILES = ['server.js'];

// UTC-day derivation patterns. Each of these takes an instant and slices
// a calendar day out of its UTC representation.
const BANNED = [
  { name: "toISOString().split('T')[0]", re: /toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/ },
  { name: 'toISOString().slice(0, 10)', re: /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/ },
  { name: 'toISOString().substring(0, 10)', re: /toISOString\(\)\s*\.\s*substring\(\s*0\s*,\s*10\s*\)/ },
];

// Legacy hits as of 2026-08-09, verified to be either non-grading
// (analytics windows, log fields, request-bucket selection guarded by
// instant matching) or scheduled for cleanup. Shrink only.
const GRANDFATHERED = new Set([
  'api/cron/fetch-espn-intelligence.js',
  'api/cron/sync-tennis-data.js',
  'api/cron/sync-ufc-data.js',
  'lib/agents/coordinator.js',
  'lib/services/ai-suggestion-outcome-checker.js',
  'lib/services/ats-tracker.js',
  'lib/services/espn-player-stats-boxscore.js',
  'lib/services/espn-results.js',
  'lib/services/tennis-data.js',
  'lib/services/ufc-data.js',
  'services/parlay-tracker.js',
]);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('timezone tripwire: no new UTC calendar-day derivations', () => {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full, files);
  }
  for (const f of SCAN_FILES) {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full)) files.push(full);
  }

  test('every UTC-day derivation is grandfathered (list may only shrink)', () => {
    const offenders = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const text = fs.readFileSync(file, 'utf8');
      for (const { name, re } of BANNED) {
        if (re.test(text) && !GRANDFATHERED.has(rel)) {
          offenders.push(`${rel}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('grandfathered files that got cleaned are removed from the list', () => {
    const stale = [];
    for (const rel of GRANDFATHERED) {
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) {
        stale.push(`${rel} (deleted — remove from GRANDFATHERED)`);
        continue;
      }
      const text = fs.readFileSync(full, 'utf8');
      if (!BANNED.some(({ re }) => re.test(text))) {
        stale.push(`${rel} (clean — remove from GRANDFATHERED so it cannot regress)`);
      }
    }
    expect(stale).toEqual([]);
  });
});
