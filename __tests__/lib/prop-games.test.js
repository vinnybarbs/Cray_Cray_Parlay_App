import { groupByGame, gameState, sortProps } from '../../src/lib/propGames'

const now = new Date('2026-10-18T20:00:00Z').getTime()
const read = (away, home, iso, extra = {}) => ({ away_team: away, home_team: home, awayAbbr: away, homeAbbr: home, commence_time: iso, text: `${away}-${home}`, ...extra })

describe('groupByGame', () => {
  test('in progress first, then upcoming by kickoff, then finished newest first', () => {
    const props = [
      read('BUF', 'LA', '2026-10-19T00:20:00Z'), // upcoming, later
      read('KC', 'DEN', '2026-10-18T13:00:00Z'), // 7h ago, ungraded, final
      read('NE', 'NYJ', '2026-10-18T17:00:00Z'), // 3h ago, live
      read('SF', 'SEA', '2026-10-18T20:25:00Z'), // upcoming, sooner
      read('DAL', 'PHI', '2026-10-18T17:05:00Z', { outcome: 'won' }), // started, all graded
      read('NE', 'NYJ', '2026-10-18T17:00:00Z'),
    ]
    const games = groupByGame(props, now)
    expect(games.map(g => `${g.away}-${g.state}`)).toEqual([
      'NE-live', 'SF-upcoming', 'BUF-upcoming', 'DAL-final', 'KC-final',
    ])
    expect(games[0].props).toHaveLength(2)
  })

  test('a started game with one ungraded read is still in progress', () => {
    const list = [read('A', 'B', '2026-10-18T18:00:00Z', { outcome: 'won' }), read('A', 'B', '2026-10-18T18:00:00Z')]
    expect(gameState(list, now)).toBe('live')
  })

  test('empty input gives no games', () => {
    expect(groupByGame(undefined, now)).toEqual([])
  })
})

describe('sortProps', () => {
  const p = (text, ourProb, bookProb) => ({ text, ourProb, bookProb })
  const list = [p('a', 60, 55), p('b', 52, 40), p('c', 70, 64), p('d', null, null)]

  test('our % highest first, missing numbers last', () => {
    expect(sortProps(list).map(x => x.text)).toEqual(['c', 'a', 'b', 'd'])
  })

  test('does not reorder the input', () => {
    sortProps(list)
    expect(list.map(x => x.text)).toEqual(['a', 'b', 'c', 'd'])
  })
})

// Owner 2026-10-18: a finished game in Recent results reads Final even
// when a player never recorded a stat.
describe('gameState with no stats reads', () => {
  test('a game whose reads are graded or no stats is final', () => {
    const list = [
      read('HOU', 'JAX', '2026-10-18T18:30:00Z', { outcome: 'won' }),
      read('HOU', 'JAX', '2026-10-18T18:30:00Z', { outcome: 'no_stats' }),
    ]
    expect(gameState(list, now)).toBe('final')
  })
})
