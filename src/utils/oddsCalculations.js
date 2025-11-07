/**
 * Odds Calculation Utilities (Frontend ES6 version)
 * Shared functions for converting and calculating parlay odds
 */

/**
 * Convert American odds to decimal format
 * @param {string|number} americanOdds - American odds (e.g., "+200" or "-110")
 * @returns {number} Decimal odds
 */
export function americanToDecimal(americanOdds) {
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
export function decimalToAmerican(decimalOdds) {
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
 * @param {number} betAmount - Bet amount (default 100)
 * @returns {Object} Combined odds, payout, and profit
 */
export function calculateParlay(oddsArray, betAmount = 100) {
  if (!Array.isArray(oddsArray) || oddsArray.length === 0) {
    throw new Error('oddsArray must be a non-empty array');
  }
  
  // Convert all odds to decimal and multiply
  const decimalOdds = oddsArray.map(americanToDecimal);
  const combinedDecimal = decimalOdds.reduce((acc, odds) => acc * odds, 1);
  
  // Calculate payout
  const payout = betAmount * combinedDecimal;
  const profit = payout - betAmount;
  
  // Convert back to American odds
  const combinedOdds = decimalToAmerican(combinedDecimal);
  
  return {
    combinedOdds,
    combinedDecimal,
    payout,
    profit,
    betAmount
  };
}

/**
 * Calculate implied probability from American odds
 * @param {string|number} americanOdds - American odds
 * @returns {number} Implied probability as percentage
 */
export function impliedProbability(americanOdds) {
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
