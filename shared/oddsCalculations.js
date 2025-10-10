/**
 * Odds Calculation Utilities
 * Shared functions for converting and calculating parlay odds
 */

/**
 * Convert American odds to decimal format
 * @param {string|number} americanOdds - American odds (e.g., "+200" or "-110")
 * @returns {number} Decimal odds
 */
function americanToDecimal(americanOdds) {
  const odds = parseInt(americanOdds);
  if (isNaN(odds)) {
    throw new Error(`Invalid American odds: ${americanOdds}`);
  }
  
  if (odds > 0) {
    return (odds / 100) + 1;
  } else {
    return (100 / Math.abs(odds)) + 1;
  }
}

/**
 * Convert decimal odds to American format
 * @param {number} decimalOdds - Decimal odds (e.g., 2.5)
 * @returns {string} American odds with + or - prefix
 */
function decimalToAmerican(decimalOdds) {
  if (decimalOdds < 1) {
    throw new Error(`Invalid decimal odds: ${decimalOdds}`);
  }
  
  if (decimalOdds >= 2) {
    return '+' + Math.round((decimalOdds - 1) * 100);
  } else {
    return '-' + Math.round(100 / (decimalOdds - 1));
  }
}

/**
 * Calculate combined parlay odds and payout
 * @param {Array<string|number>} oddsArray - Array of American odds
 * @returns {Object} Combined odds, payout, and profit
 */
function calculateParlay(oddsArray) {
  if (!Array.isArray(oddsArray) || oddsArray.length === 0) {
    throw new Error('oddsArray must be a non-empty array');
  }
  
  // Convert all odds to decimal and multiply
  const decimalOdds = oddsArray.map(odds => americanToDecimal(odds));
  const combinedDecimal = decimalOdds.reduce((acc, curr) => acc * curr, 1);
  
  // Convert back to American odds
  const combinedAmerican = decimalToAmerican(combinedDecimal);
  
  // Calculate payout on $100
  const profit = Math.round((combinedDecimal - 1) * 100);
  const payout = Math.round(combinedDecimal * 100); // total return on $100
  
  return {
    combinedOdds: combinedAmerican,
    payout: payout,
    profit
  };
}

/**
 * Calculate implied probability from American odds
 * @param {string|number} americanOdds - American odds
 * @returns {number} Implied probability as percentage (0-100)
 */
function impliedProbability(americanOdds) {
  const odds = parseInt(americanOdds);
  if (isNaN(odds)) {
    throw new Error(`Invalid American odds: ${americanOdds}`);
  }
  
  if (odds > 0) {
    return (100 / (odds + 100)) * 100;
  } else {
    return (Math.abs(odds) / (Math.abs(odds) + 100)) * 100;
  }
}

module.exports = {
  americanToDecimal,
  decimalToAmerican,
  calculateParlay,
  impliedProbability
};
