/**
 * Shared team name matching utility.
 * Used by settlement, ATS tracker, and parlay outcome checker.
 *
 * Rules:
 * 1. Normalize: lowercase, expand abbreviations (St→State, Ft→Fort)
 * 2. Exact match after normalization
 * 3. Two-word minimum overlap (prevents "Utah Valley Wolverines" matching "Michigan Wolverines")
 * 4. City + mascot match (first words + last word)
 * 5. Manual alias fallback for known mismatches (LA Clippers vs Los Angeles Clippers)
 */

const ALIASES = {
  // NBA
  'la clippers': 'los angeles clippers',
  'la lakers': 'los angeles lakers',
  // MLB
  'athletics': 'oakland athletics',
  // NCAAB abbreviations
  'cal baptist': 'california baptist lancers',
  'cal baptist lancers': 'california baptist lancers',
  'cal state fullerton titans': 'csu fullerton titans',
  'miami (oh) redhawks': 'miami oh redhawks',
  'uc irvine anteaters': 'uci anteaters',
  'unc wilmington seahawks': 'wilmington seahawks',
};

function normalize(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\bst\b/g, 'state')
    .replace(/\bft\b/g, 'fort')
    .replace(/\bmt\b/g, 'mount')
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9' ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveAlias(normalized) {
  return ALIASES[normalized] || normalized;
}

/**
 * Check if two team names refer to the same team.
 * Returns true if they match, false otherwise.
 */
function teamsMatch(name1, name2) {
  if (!name1 || !name2) return false;

  let n1 = resolveAlias(normalize(name1));
  let n2 = resolveAlias(normalize(name2));

  // 1. Exact match after normalization + alias
  if (n1 === n2) return true;

  // 2. Split into words
  const words1 = n1.split(' ');
  const words2 = n2.split(' ');

  // 3. Last word (mascot) must match as baseline
  const mascot1 = words1[words1.length - 1];
  const mascot2 = words2[words2.length - 1];
  if (mascot1 !== mascot2) return false;

  // 4. Mascot matches — now require at least ONE more word overlap
  //    This prevents "Utah Valley Wolverines" matching "Michigan Wolverines"
  const nonMascot1 = new Set(words1.slice(0, -1));
  const nonMascot2 = new Set(words2.slice(0, -1));

  // If either team is just one word (mascot only like "Athletics"), mascot match is enough
  if (nonMascot1.size === 0 || nonMascot2.size === 0) return true;

  // Check for any overlapping non-mascot word
  for (const w of nonMascot1) {
    if (nonMascot2.has(w)) return true;
  }

  // 5. Check if shorter name is a prefix/suffix of longer
  //    Handles "Michigan" matching "Michigan Wolverines" or "Michigan State Spartans"
  //    But only if the shorter is at least 2 words
  const shorter = n1.length < n2.length ? n1 : n2;
  const longer = n1.length < n2.length ? n2 : n1;
  if (shorter.split(' ').length >= 2 && longer.includes(shorter)) return true;

  return false;
}

module.exports = { teamsMatch, normalize, resolveAlias };
