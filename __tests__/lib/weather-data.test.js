const {
  getWeatherForGames,
  lookupVenue,
  nearestHourIndex,
  buildWeatherRow,
  compassFromDegrees,
  venueKey,
} = require('../../lib/services/weather-data');

describe('venueKey and lookupVenue', () => {
  test('normalizes punctuation and case', () => {
    expect(venueKey('St. Louis Cardinals')).toBe('st louis cardinals');
    expect(lookupVenue('St. Louis Cardinals').stadium).toBe('Busch Stadium');
  });

  test('matches MLB and MLS teams', () => {
    expect(lookupVenue('Philadelphia Phillies').stadium).toBe('Citizens Bank Park');
    expect(lookupVenue('New England Revolution').stadium).toBe('Gillette Stadium');
  });

  test('returns null for unmapped teams', () => {
    expect(lookupVenue('Arsenal')).toBeNull();
    expect(lookupVenue(null)).toBeNull();
  });

  test('flags domes and retractables', () => {
    expect(lookupVenue('Tampa Bay Rays').roof).toBe('dome');
    expect(lookupVenue('Milwaukee Brewers').roof).toBe('retractable');
    expect(lookupVenue('Boston Red Sox').roof).toBe('none');
  });

  test('covers NFL venues for the 2026 season', () => {
    expect(lookupVenue('Green Bay Packers').stadium).toBe('Lambeau Field');
    expect(lookupVenue('Minnesota Vikings').roof).toBe('dome');
    expect(lookupVenue('Dallas Cowboys').roof).toBe('retractable');
    expect(lookupVenue('New York Jets').stadium).toBe('MetLife Stadium');
  });
});

describe('compassFromDegrees', () => {
  test('maps cardinal directions', () => {
    expect(compassFromDegrees(0)).toBe('N');
    expect(compassFromDegrees(90)).toBe('E');
    expect(compassFromDegrees(225)).toBe('SW');
    expect(compassFromDegrees(359)).toBe('N');
  });

  test('null on missing input', () => {
    expect(compassFromDegrees(null)).toBeNull();
    expect(compassFromDegrees('bad')).toBeNull();
  });
});

describe('nearestHourIndex', () => {
  const times = ['2026-08-05T18:00', '2026-08-05T19:00', '2026-08-05T20:00'];

  test('picks the closest hour', () => {
    expect(nearestHourIndex(times, '2026-08-05T19:10:00Z')).toBe(1);
    expect(nearestHourIndex(times, '2026-08-05T19:40:00Z')).toBe(2);
  });

  test('rejects game times outside the forecast window', () => {
    expect(nearestHourIndex(times, '2026-08-09T19:00:00Z')).toBe(-1);
  });

  test('handles empty or bad input', () => {
    expect(nearestHourIndex([], '2026-08-05T19:00:00Z')).toBe(-1);
    expect(nearestHourIndex(times, 'not-a-date')).toBe(-1);
  });
});

describe('buildWeatherRow', () => {
  const game = { home_team: 'Philadelphia Phillies', away_team: 'St. Louis Cardinals', game_date: '2026-08-05T23:05:00Z' };
  const hourly = {
    time: ['2026-08-05T23:00'],
    temperature_2m: [84.2],
    precipitation_probability: [45],
    wind_speed_10m: [12.4],
    wind_direction_10m: [225],
  };

  test('open-air park gets a full forecast row', () => {
    const venue = lookupVenue('Philadelphia Phillies');
    const row = buildWeatherRow(game, venue, hourly, 0);
    expect(row).toEqual({
      game: 'St. Louis Cardinals @ Philadelphia Phillies',
      stadium: 'Citizens Bank Park',
      roof: 'none',
      temp_f: 84,
      wind_mph: 12,
      wind_effect: 'unknown',
      precip_chance_pct: 45,
      note: 'Wind 12 mph from the SW. 45% precipitation chance at game time.',
      source: 'open-meteo',
    });
  });

  test('dome row has no forecast', () => {
    const venue = lookupVenue('Tampa Bay Rays');
    const row = buildWeatherRow({ ...game, home_team: 'Tampa Bay Rays' }, venue, null, -1);
    expect(row.roof).toBe('dome');
    expect(row.temp_f).toBeNull();
    expect(row.note).toMatch(/Fixed roof/);
  });

  test('light wind reads calm', () => {
    const venue = lookupVenue('Philadelphia Phillies');
    const calmHourly = { ...hourly, wind_speed_10m: [3.1], precipitation_probability: [5] };
    const row = buildWeatherRow(game, venue, calmHourly, 0);
    expect(row.wind_effect).toBe('calm');
    expect(row.precip_chance_pct).toBe(5);
  });

  test('null when forecast index is out of window', () => {
    const venue = lookupVenue('Philadelphia Phillies');
    expect(buildWeatherRow(game, venue, hourly, -1)).toBeNull();
  });
});

describe('getWeatherForGames', () => {
  const hourlyPayload = {
    hourly: {
      time: ['2026-08-05T23:00'],
      temperature_2m: [80],
      precipitation_probability: [10],
      wind_speed_10m: [8],
      wind_direction_10m: [90],
    },
  };

  test('fetches once per venue and skips unmapped teams', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => hourlyPayload });
    const games = [
      { home_team: 'Philadelphia Phillies', away_team: 'St. Louis Cardinals', game_date: '2026-08-05T23:05:00Z' },
      { home_team: 'Philadelphia Phillies', away_team: 'New York Mets', game_date: '2026-08-05T23:05:00Z' },
      { home_team: 'Jannik Sinner', away_team: 'Carlos Alcaraz', game_date: '2026-08-05T23:05:00Z' },
    ];
    const result = await getWeatherForGames(games, { fetchImpl });
    expect(result.weather).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.errors).toHaveLength(0);
  });

  test('domes produce a row without fetching', async () => {
    const fetchImpl = jest.fn();
    const games = [{ home_team: 'Tampa Bay Rays', away_team: 'Boston Red Sox', game_date: '2026-08-05T23:05:00Z' }];
    const result = await getWeatherForGames(games, { fetchImpl });
    expect(result.weather).toHaveLength(1);
    expect(result.weather[0].roof).toBe('dome');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a failing venue fails soft', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const games = [{ home_team: 'Boston Red Sox', away_team: 'New York Yankees', game_date: '2026-08-05T23:05:00Z' }];
    const result = await getWeatherForGames(games, { fetchImpl });
    expect(result.weather).toHaveLength(0);
    expect(result.errors[0]).toMatch(/Fenway Park: open-meteo 503/);
  });
});
