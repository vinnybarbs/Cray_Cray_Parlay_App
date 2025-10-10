/**
 * Request Validation Middleware
 * Validates incoming requests for the parlay generation endpoint
 */

const { SPORT_SLUGS, BOOKMAKER_MAPPING, RISK_LEVEL_DEFINITIONS } = require('../../shared/constants');

/**
 * Validate parlay generation request
 */
function validateParlayRequest(req, res, next) {
  const {
    selectedSports,
    selectedBetTypes,
    numLegs,
    oddsPlatform,
    aiModel,
    riskLevel,
    dateRange
  } = req.body;

  const errors = [];

  // Validate selectedSports
  if (!Array.isArray(selectedSports) || selectedSports.length === 0) {
    errors.push('selectedSports must be a non-empty array');
  } else {
    const validSports = Object.keys(SPORT_SLUGS);
    const invalidSports = selectedSports.filter(sport => !validSports.includes(sport));
    if (invalidSports.length > 0) {
      errors.push(`Invalid sports: ${invalidSports.join(', ')}`);
    }
  }

  // Validate selectedBetTypes
  if (!Array.isArray(selectedBetTypes) || selectedBetTypes.length === 0) {
    errors.push('selectedBetTypes must be a non-empty array');
  } else {
    const validBetTypes = ['Moneyline/Spread', 'Player Props', 'TD Props', 'Totals (O/U)', 'Team Props'];
    const invalidBetTypes = selectedBetTypes.filter(type => !validBetTypes.includes(type));
    if (invalidBetTypes.length > 0) {
      errors.push(`Invalid bet types: ${invalidBetTypes.join(', ')}`);
    }
  }

  // Validate numLegs
  if (typeof numLegs !== 'number' || numLegs < 1 || numLegs > 10) {
    errors.push('numLegs must be a number between 1 and 10');
  }

  // Validate oddsPlatform
  const validPlatforms = Object.keys(BOOKMAKER_MAPPING);
  if (!validPlatforms.includes(oddsPlatform)) {
    errors.push(`oddsPlatform must be one of: ${validPlatforms.join(', ')}`);
  }

  // Validate aiModel
  if (!['openai', 'gemini'].includes(aiModel)) {
    errors.push('aiModel must be either "openai" or "gemini"');
  }

  // Validate riskLevel
  const validRiskLevels = Object.keys(RISK_LEVEL_DEFINITIONS);
  if (!validRiskLevels.includes(riskLevel)) {
    errors.push(`riskLevel must be one of: ${validRiskLevels.join(', ')}`);
  }

  // Validate dateRange
  if (typeof dateRange !== 'number' || dateRange < 1 || dateRange > 7) {
    errors.push('dateRange must be a number between 1 and 7');
  }

  // Return errors if any
  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
  }

  next();
}

/**
 * Sanitize user input to prevent injection attacks
 */
function sanitizeInput(req, res, next) {
  // Ensure arrays don't contain malicious content
  if (req.body.selectedSports) {
    req.body.selectedSports = req.body.selectedSports.map(sport => 
      String(sport).trim().slice(0, 50)
    );
  }

  if (req.body.selectedBetTypes) {
    req.body.selectedBetTypes = req.body.selectedBetTypes.map(type => 
      String(type).trim().slice(0, 50)
    );
  }

  // Sanitize string inputs
  if (req.body.oddsPlatform) {
    req.body.oddsPlatform = String(req.body.oddsPlatform).trim().slice(0, 50);
  }

  if (req.body.aiModel) {
    req.body.aiModel = String(req.body.aiModel).trim().slice(0, 20);
  }

  if (req.body.riskLevel) {
    req.body.riskLevel = String(req.body.riskLevel).trim().slice(0, 20);
  }

  next();
}

module.exports = {
  validateParlayRequest,
  sanitizeInput
};
