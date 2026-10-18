import { findByMatchup, liveNowItems } from '../../src/lib/liveNow'

const feed = {
  g1: { sport: 'NFL', home_team: 'Chicago Bears', away_team: 'Detroit Lions', game_date: '2026-10-18T17:00:00Z', final: false, home: { score: 7 }, away: { score: 3 }, pick: { status: 'ahead' } },
  g2: { sport: 'NFL', home_team: 'Denver Broncos', away_team: 'Seattle Seahawks', game_date: '2026-10-18T17:00:00Z', final: true, home: { score: 20 }, away: { score: 17 } },
  g3: { sport: 'NFL', home_team: 'Miami Dolphins', away_team: 'Buffalo Bills', game_date: '2026-10-18T20:25:00Z', final: false, home: { score: 0 }, away: { score: 0 } },
}

describe('liveNowItems', () => {
  test('one chip per game, games on first, finals last, unknown keys dropped', () => {
    const items = liveNowItems(feed, ['g2', 'g3', 'g1', 'g1', 'nope'])
    expect(items.map(i => i.key)).toEqual(['g1', 'g3', 'g2'])
    expect(items[0]).toMatchObject({ key: 'g1', sport: 'NFL' })
  })
  test('an empty feed is an empty strip', () => {
    expect(liveNowItems(null, ['g1'])).toEqual([])
  })
})

describe('findByMatchup', () => {
  test('matches team names and kickoff, not the other way round', () => {
    expect(findByMatchup(feed, { home_team: 'Chicago Bears', away_team: 'Detroit Lions', at: '2026-10-18T17:00:00Z' })[0]).toBe('g1')
    expect(findByMatchup(feed, { home_team: 'Detroit Lions', away_team: 'Chicago Bears', at: '2026-10-18T17:00:00Z' })).toBeNull()
  })
  test('a kickoff more than 12 hours off is another game', () => {
    expect(findByMatchup(feed, { home_team: 'Chicago Bears', away_team: 'Detroit Lions', at: '2026-10-25T17:00:00Z' })).toBeNull()
  })
})
