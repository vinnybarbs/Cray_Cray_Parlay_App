import { skipReason } from '../../src/lib/propSkip'

describe('skipReason', () => {
  it('names the lean and both numbers for a close read', () => {
    expect(skipReason({ market: 'player_receptions', side: 'over', line: 5.5, ourProb: 54.2, bookProb: 51.9 }))
      .toBe('Lean over 5.5, but book says 52% and we say 54%. Too close to bet.')
  })
  it('turns an anytime TD no lean into the yes chance', () => {
    expect(skipReason({ market: 'player_anytime_td', side: 'under', line: 0.5, ourProb: 78, bookProb: 70 }))
      .toBe('We give him a 22% chance to score, the book 30%. Books sell no "no", so no bet.')
  })
  it('still says something without probabilities', () => {
    expect(skipReason({ market: 'player_rush_yds', side: 'under', line: 44.5 })).toBe('Lean under 44.5, but under our 4 point bar.')
  })
})
