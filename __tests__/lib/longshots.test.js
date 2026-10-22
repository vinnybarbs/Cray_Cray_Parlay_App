import { breakEvenHits, oneIn, profitFor, sumUnits, unitsFor } from '../../src/lib/longshots'

// Owner 2026-10-18: longshots are judged on units, never on the hit
// rate. "If we choose 8 TDs and 3 of them cover that's enough."
describe('longshots math', () => {
  it('turns an American price into profit on one unit', () => {
    expect(profitFor(700)).toBe(7)
    expect(profitFor(-150)).toBeCloseTo(0.667, 3)
    expect(profitFor(50)).toBeNull()
    expect(profitFor(null)).toBeNull()
  })

  it('counts units one unit each at the read price', () => {
    expect(unitsFor({ outcome: 'won', price: 700 })).toBe(7)
    expect(unitsFor({ outcome: 'lost', price: 700 })).toBe(-1)
    expect(unitsFor({ outcome: 'push', price: 700 })).toBe(0)
    expect(unitsFor({ outcome: 'void', price: 700 })).toBe(0)
    expect(unitsFor({ outcome: 'won', price: null })).toBe(0.909)
    expect(sumUnits([{ outcome: 'won', price: 700 }, { outcome: 'lost' }, { outcome: 'lost' }, { outcome: 'lost' }])).toBe(4)
  })

  it('says how many of a set need to score to break even', () => {
    const eight = (price) => Array.from({ length: 8 }, () => ({ price }))
    expect(breakEvenHits(eight(700))).toBe(1)
    expect(breakEvenHits(eight(300))).toBe(2)
    expect(breakEvenHits(eight(-110))).toBe(5)
    expect(breakEvenHits([])).toBe(0)
    expect(breakEvenHits([{ price: null }])).toBe(0)
  })

  it('reads an average price as one in N', () => {
    expect(oneIn(700)).toBe(8)
    expect(oneIn(758)).toBe(9)
    expect(oneIn(-110)).toBe(2)
    expect(oneIn(null)).toBeNull()
  })
})
