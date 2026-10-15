import { daysUntilGame, gameDayChip } from '../../src/lib/gameTime'

const TZ = 'America/Denver'
// Wed Oct 14 2026, 8:21 PM MDT, when the bug was reported.
const now = new Date('2026-10-15T02:21:00Z')

describe('gameDayChip', () => {
  test('a Saturday game seen Wednesday night is 3 days out, not tomorrow', () => {
    const sat = '2026-10-17T23:30:00Z' // Sat Oct 17, 5:30 PM MDT
    expect(daysUntilGame(sat, now, TZ)).toBe(3)
    expect(gameDayChip(sat, now, TZ)).toBe('In 3 days')
  })

  test('a Thursday game is tomorrow', () => {
    expect(gameDayChip('2026-10-16T00:15:00Z', now, TZ)).toBe('Tomorrow') // Thu 6:15 PM MDT
  })

  test('a late game tonight that is past midnight UTC gets no chip', () => {
    expect(gameDayChip('2026-10-15T04:00:00Z', now, TZ)).toBeNull() // Wed 10 PM MDT
  })

  test('past games and missing dates get no chip', () => {
    expect(gameDayChip('2026-10-13T23:00:00Z', now, TZ)).toBeNull()
    expect(gameDayChip(null, now, TZ)).toBeNull()
  })

  test('counts across a DST change and a month end', () => {
    const before = new Date('2026-10-31T18:00:00Z')
    expect(daysUntilGame('2026-11-02T01:00:00Z', before, TZ)).toBe(1) // Sun Nov 1 6 PM MST
  })
})
