// Directive 27 (owner 2026-10-01): no sportsbook affiliation, ever. This
// test is the enforcement a cloud routine can trust: it fails the suite
// on any link to a sportsbook domain or any affiliate style parameter in
// the site, the API or the server source. The Odds API bookmaker keys
// (draftkings, fanduel as plain words) are data, not links, and pass.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN = ['src', 'public', 'api', 'lib', 'shared', 'index.html', 'server.js'];
const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.md', '.json']);
const SPORTSBOOK_HOST = /https?:\/\/(?:[a-z0-9-]+\.)*(?:draftkings|fanduel|betmgm|caesars|espnbet|pointsbet|bet365|hardrock(?:bet)?|betrivers|fanatics|bovada|betonline|mybookie|unibet|williamhill|pinnacle|bet99|prizepicks|underdogfantasy)\.[a-z.]+/i;
const AFFILIATE_PARAM = /https?:\/\/[^\s"'`)]*[?&](?:ref|refid|aff|affid|affiliate|btag|promo|promocode|clickid|wm|siteid)=/i;

function walk(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    if (path.basename(p) === 'node_modules' || path.basename(p) === 'dist') return;
    for (const f of fs.readdirSync(p)) walk(path.join(p, f), out);
  } else if (EXT.has(path.extname(p))) {
    out.push(p);
  }
}

test('no sportsbook link and no affiliate parameter anywhere in the shipped source (directive 27)', () => {
  const files = [];
  for (const s of SCAN) {
    const p = path.join(ROOT, s);
    if (fs.existsSync(p)) walk(p, files);
  }
  expect(files.length).toBeGreaterThan(50);
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (SPORTSBOOK_HOST.test(line) || AFFILIATE_PARAM.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  expect(hits).toEqual([]);
});

test('the patterns catch what they are meant to catch', () => {
  expect(SPORTSBOOK_HOST.test('href="https://sportsbook.draftkings.com/r/abc"')).toBe(true);
  expect(SPORTSBOOK_HOST.test('https://www.fanduel.com/?promo=TRAP')).toBe(true);
  expect(AFFILIATE_PARAM.test('https://example.com/signup?ref=traphawk')).toBe(true);
  expect(SPORTSBOOK_HOST.test("bookmakers=draftkings&apiKey=")).toBe(false);
  expect(AFFILIATE_PARAM.test('https://api.the-odds-api.com/v4/sports?regions=us')).toBe(false);
});
