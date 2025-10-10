const { validateParlayRequest, sanitizeInput } = require('../../../api/middleware/validation');

describe('Validation Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      body: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  describe('validateParlayRequest', () => {
    test('passes validation with valid input', () => {
      req.body = {
        selectedSports: ['NFL', 'NBA'],
        selectedBetTypes: ['Moneyline/Spread'],
        numLegs: 3,
        oddsPlatform: 'DraftKings',
        aiModel: 'openai',
        riskLevel: 'Medium',
        dateRange: 2
      };

      validateParlayRequest(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('fails validation with empty sports array', () => {
      req.body = {
        selectedSports: [],
        selectedBetTypes: ['Moneyline/Spread'],
        numLegs: 3,
        oddsPlatform: 'DraftKings',
        aiModel: 'openai',
        riskLevel: 'Medium',
        dateRange: 2
      };

      validateParlayRequest(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    test('fails validation with invalid sport', () => {
      req.body = {
        selectedSports: ['InvalidSport'],
        selectedBetTypes: ['Moneyline/Spread'],
        numLegs: 3,
        oddsPlatform: 'DraftKings',
        aiModel: 'openai',
        riskLevel: 'Medium',
        dateRange: 2
      };

      validateParlayRequest(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation failed',
          details: expect.arrayContaining([
            expect.stringContaining('Invalid sports')
          ])
        })
      );
    });

    test('fails validation with invalid numLegs', () => {
      req.body = {
        selectedSports: ['NFL'],
        selectedBetTypes: ['Moneyline/Spread'],
        numLegs: 15, // Too high
        oddsPlatform: 'DraftKings',
        aiModel: 'openai',
        riskLevel: 'Medium',
        dateRange: 2
      };

      validateParlayRequest(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('fails validation with invalid aiModel', () => {
      req.body = {
        selectedSports: ['NFL'],
        selectedBetTypes: ['Moneyline/Spread'],
        numLegs: 3,
        oddsPlatform: 'DraftKings',
        aiModel: 'invalid-model',
        riskLevel: 'Medium',
        dateRange: 2
      };

      validateParlayRequest(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('sanitizeInput', () => {
    test('sanitizes string arrays', () => {
      req.body = {
        selectedSports: ['  NFL  ', 'NBA'],
        selectedBetTypes: ['Moneyline/Spread  ']
      };

      sanitizeInput(req, res, next);
      expect(req.body.selectedSports).toEqual(['NFL', 'NBA']);
      expect(req.body.selectedBetTypes).toEqual(['Moneyline/Spread']);
      expect(next).toHaveBeenCalled();
    });

    test('limits string length', () => {
      const longString = 'a'.repeat(100);
      req.body = {
        oddsPlatform: longString
      };

      sanitizeInput(req, res, next);
      expect(req.body.oddsPlatform.length).toBeLessThanOrEqual(50);
      expect(next).toHaveBeenCalled();
    });
  });
});
