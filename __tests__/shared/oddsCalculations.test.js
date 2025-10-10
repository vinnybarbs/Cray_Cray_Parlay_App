const {
  americanToDecimal,
  decimalToAmerican,
  calculateParlay,
  impliedProbability
} = require('../../shared/oddsCalculations');

describe('Odds Calculations', () => {
  describe('americanToDecimal', () => {
    test('converts positive American odds correctly', () => {
      expect(americanToDecimal('+200')).toBe(3.0);
      expect(americanToDecimal('+150')).toBe(2.5);
      expect(americanToDecimal('+100')).toBe(2.0);
    });

    test('converts negative American odds correctly', () => {
      expect(americanToDecimal('-200')).toBe(1.5);
      expect(americanToDecimal('-110')).toBeCloseTo(1.909, 2);
      expect(americanToDecimal('-150')).toBeCloseTo(1.667, 2);
    });

    test('handles numeric input', () => {
      expect(americanToDecimal(200)).toBe(3.0);
      expect(americanToDecimal(-110)).toBeCloseTo(1.909, 2);
    });

    test('throws error for invalid input', () => {
      expect(() => americanToDecimal('invalid')).toThrow('Invalid American odds');
      expect(() => americanToDecimal(null)).toThrow('Invalid American odds');
    });
  });

  describe('decimalToAmerican', () => {
    test('converts decimal odds >= 2 correctly', () => {
      expect(decimalToAmerican(3.0)).toBe('+200');
      expect(decimalToAmerican(2.5)).toBe('+150');
      expect(decimalToAmerican(2.0)).toBe('+100');
    });

    test('converts decimal odds < 2 correctly', () => {
      expect(decimalToAmerican(1.5)).toBe('-200');
      expect(decimalToAmerican(1.909)).toBe('-110');
    });

    test('throws error for invalid input', () => {
      expect(() => decimalToAmerican(0.5)).toThrow('Invalid decimal odds');
      expect(() => decimalToAmerican(-1)).toThrow('Invalid decimal odds');
    });
  });

  describe('calculateParlay', () => {
    test('calculates 2-leg parlay correctly', () => {
      const result = calculateParlay(['+100', '-110']);
      expect(result.combinedOdds).toBeDefined();
      expect(result.payout).toBeGreaterThan(100);
      expect(result.profit).toBeGreaterThan(0);
    });

    test('calculates 3-leg parlay correctly', () => {
      const result = calculateParlay(['+150', '-110', '+200']);
      expect(result.combinedOdds).toBeDefined();
      expect(result.payout).toBeGreaterThan(100);
      expect(result.profit).toBeGreaterThan(0);
    });

    test('handles all favorites', () => {
      const result = calculateParlay(['-110', '-120', '-150']);
      expect(result.combinedOdds).toBeDefined();
      expect(result.payout).toBeGreaterThan(100);
    });

    test('handles all underdogs', () => {
      const result = calculateParlay(['+200', '+150', '+300']);
      expect(result.combinedOdds).toBeDefined();
      expect(result.payout).toBeGreaterThan(500);
    });

    test('throws error for empty array', () => {
      expect(() => calculateParlay([])).toThrow('must be a non-empty array');
    });

    test('throws error for non-array input', () => {
      expect(() => calculateParlay('+100')).toThrow('must be a non-empty array');
    });
  });

  describe('impliedProbability', () => {
    test('calculates probability for positive odds', () => {
      expect(impliedProbability('+100')).toBeCloseTo(50, 0);
      expect(impliedProbability('+200')).toBeCloseTo(33.33, 1);
      expect(impliedProbability('+300')).toBe(25);
    });

    test('calculates probability for negative odds', () => {
      expect(impliedProbability('-110')).toBeCloseTo(52.38, 1);
      expect(impliedProbability('-200')).toBeCloseTo(66.67, 1);
      expect(impliedProbability('-300')).toBe(75);
    });

    test('throws error for invalid input', () => {
      expect(() => impliedProbability('invalid')).toThrow('Invalid American odds');
    });
  });
});
