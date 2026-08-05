/**
 * Game-day weather from Open-Meteo, replacing the LLM weather scout.
 *
 * The old weather-scout sub-agent web-searched forecasts through Sonnet,
 * which billed the whole growing search conversation on every turn. A
 * forecast is not a judgment call: given stadium coordinates and a game
 * time, Open-Meteo returns the same wind/temp/precip numbers for free with
 * no model in the loop. The records verifier keeps its web search because
 * its value is independence from our own data sources. Weather has no such
 * requirement, the forecast IS the source.
 *
 * Coverage: MLB parks (weather moves baseball totals) and MLS grounds.
 * Coordinates are city/stadium level, which is all a game-time forecast
 * needs. Teams not in the table simply get no weather row, same as when
 * the scout skipped them. NFL stadiums land with the September work.
 *
 * Output rows match the exact payload shape the weather scout produced, so
 * agent_intel consumers (pre-analyze injection, admin intel feed) need no
 * changes: { game, stadium, roof, temp_f, wind_mph, wind_effect,
 * precip_chance_pct, note, source }.
 */

'use strict';

// roof: 'none' = open air, 'retractable' = forecast still fetched with a
// caveat note, 'dome' = fixed roof, no forecast (weather irrelevant).
const VENUES = {
  // MLB
  'arizona diamondbacks': { stadium: 'Chase Field', lat: 33.445, lon: -112.067, roof: 'retractable' },
  'atlanta braves': { stadium: 'Truist Park', lat: 33.891, lon: -84.468, roof: 'none' },
  'baltimore orioles': { stadium: 'Camden Yards', lat: 39.284, lon: -76.622, roof: 'none' },
  'boston red sox': { stadium: 'Fenway Park', lat: 42.346, lon: -71.097, roof: 'none' },
  'chicago cubs': { stadium: 'Wrigley Field', lat: 41.948, lon: -87.655, roof: 'none' },
  'chicago white sox': { stadium: 'Rate Field', lat: 41.830, lon: -87.634, roof: 'none' },
  'cincinnati reds': { stadium: 'Great American Ball Park', lat: 39.097, lon: -84.507, roof: 'none' },
  'cleveland guardians': { stadium: 'Progressive Field', lat: 41.496, lon: -81.685, roof: 'none' },
  'colorado rockies': { stadium: 'Coors Field', lat: 39.756, lon: -104.994, roof: 'none' },
  'detroit tigers': { stadium: 'Comerica Park', lat: 42.339, lon: -83.049, roof: 'none' },
  'houston astros': { stadium: 'Daikin Park', lat: 29.757, lon: -95.356, roof: 'retractable' },
  'kansas city royals': { stadium: 'Kauffman Stadium', lat: 39.051, lon: -94.480, roof: 'none' },
  'los angeles angels': { stadium: 'Angel Stadium', lat: 33.800, lon: -117.883, roof: 'none' },
  'los angeles dodgers': { stadium: 'Dodger Stadium', lat: 34.074, lon: -118.240, roof: 'none' },
  'miami marlins': { stadium: 'loanDepot park', lat: 25.778, lon: -80.220, roof: 'retractable' },
  'milwaukee brewers': { stadium: 'American Family Field', lat: 43.028, lon: -87.971, roof: 'retractable' },
  'minnesota twins': { stadium: 'Target Field', lat: 44.982, lon: -93.278, roof: 'none' },
  'new york mets': { stadium: 'Citi Field', lat: 40.757, lon: -73.846, roof: 'none' },
  'new york yankees': { stadium: 'Yankee Stadium', lat: 40.829, lon: -73.926, roof: 'none' },
  'athletics': { stadium: 'Sutter Health Park', lat: 38.580, lon: -121.513, roof: 'none' },
  'oakland athletics': { stadium: 'Sutter Health Park', lat: 38.580, lon: -121.513, roof: 'none' },
  'philadelphia phillies': { stadium: 'Citizens Bank Park', lat: 39.906, lon: -75.166, roof: 'none' },
  'pittsburgh pirates': { stadium: 'PNC Park', lat: 40.447, lon: -80.006, roof: 'none' },
  'san diego padres': { stadium: 'Petco Park', lat: 32.707, lon: -117.157, roof: 'none' },
  'san francisco giants': { stadium: 'Oracle Park', lat: 37.778, lon: -122.389, roof: 'none' },
  'seattle mariners': { stadium: 'T-Mobile Park', lat: 47.591, lon: -122.332, roof: 'retractable' },
  'st louis cardinals': { stadium: 'Busch Stadium', lat: 38.623, lon: -90.193, roof: 'none' },
  'tampa bay rays': { stadium: 'Tropicana Field', lat: 27.768, lon: -82.653, roof: 'dome' },
  'texas rangers': { stadium: 'Globe Life Field', lat: 32.747, lon: -97.084, roof: 'retractable' },
  'toronto blue jays': { stadium: 'Rogers Centre', lat: 43.641, lon: -79.389, roof: 'retractable' },
  'washington nationals': { stadium: 'Nationals Park', lat: 38.873, lon: -77.007, roof: 'none' },
  // MLS
  'atlanta united fc': { stadium: 'Mercedes-Benz Stadium', lat: 33.755, lon: -84.401, roof: 'retractable' },
  'atlanta united': { stadium: 'Mercedes-Benz Stadium', lat: 33.755, lon: -84.401, roof: 'retractable' },
  'austin fc': { stadium: 'Q2 Stadium', lat: 30.388, lon: -97.719, roof: 'none' },
  'charlotte fc': { stadium: 'Bank of America Stadium', lat: 35.226, lon: -80.853, roof: 'none' },
  'chicago fire fc': { stadium: 'Soldier Field', lat: 41.862, lon: -87.617, roof: 'none' },
  'chicago fire': { stadium: 'Soldier Field', lat: 41.862, lon: -87.617, roof: 'none' },
  'fc cincinnati': { stadium: 'TQL Stadium', lat: 39.111, lon: -84.522, roof: 'none' },
  'colorado rapids': { stadium: "Dick's Sporting Goods Park", lat: 39.806, lon: -104.892, roof: 'none' },
  'columbus crew': { stadium: 'Lower.com Field', lat: 39.968, lon: -83.017, roof: 'none' },
  'fc dallas': { stadium: 'Toyota Stadium', lat: 33.154, lon: -96.835, roof: 'none' },
  'dc united': { stadium: 'Audi Field', lat: 38.868, lon: -77.012, roof: 'none' },
  'houston dynamo fc': { stadium: 'Shell Energy Stadium', lat: 29.752, lon: -95.352, roof: 'none' },
  'houston dynamo': { stadium: 'Shell Energy Stadium', lat: 29.752, lon: -95.352, roof: 'none' },
  'sporting kansas city': { stadium: "Children's Mercy Park", lat: 39.121, lon: -94.824, roof: 'none' },
  'la galaxy': { stadium: 'Dignity Health Sports Park', lat: 33.864, lon: -118.261, roof: 'none' },
  'los angeles fc': { stadium: 'BMO Stadium', lat: 34.012, lon: -118.284, roof: 'none' },
  'lafc': { stadium: 'BMO Stadium', lat: 34.012, lon: -118.284, roof: 'none' },
  'inter miami cf': { stadium: 'Chase Stadium', lat: 26.193, lon: -80.161, roof: 'none' },
  'inter miami': { stadium: 'Chase Stadium', lat: 26.193, lon: -80.161, roof: 'none' },
  'minnesota united fc': { stadium: 'Allianz Field', lat: 44.953, lon: -93.165, roof: 'none' },
  'minnesota united': { stadium: 'Allianz Field', lat: 44.953, lon: -93.165, roof: 'none' },
  'cf montreal': { stadium: 'Saputo Stadium', lat: 45.563, lon: -73.552, roof: 'none' },
  'nashville sc': { stadium: 'Geodis Park', lat: 36.130, lon: -86.766, roof: 'none' },
  'new england revolution': { stadium: 'Gillette Stadium', lat: 42.091, lon: -71.264, roof: 'none' },
  'new york city fc': { stadium: 'Yankee Stadium', lat: 40.829, lon: -73.926, roof: 'none' },
  'new york red bulls': { stadium: 'Sports Illustrated Stadium', lat: 40.737, lon: -74.150, roof: 'none' },
  'orlando city sc': { stadium: 'Inter&Co Stadium', lat: 28.541, lon: -81.389, roof: 'none' },
  'orlando city': { stadium: 'Inter&Co Stadium', lat: 28.541, lon: -81.389, roof: 'none' },
  'philadelphia union': { stadium: 'Subaru Park', lat: 39.832, lon: -75.379, roof: 'none' },
  'portland timbers': { stadium: 'Providence Park', lat: 45.521, lon: -122.692, roof: 'none' },
  'real salt lake': { stadium: 'America First Field', lat: 40.583, lon: -111.893, roof: 'none' },
  'san diego fc': { stadium: 'Snapdragon Stadium', lat: 32.783, lon: -117.120, roof: 'none' },
  'san jose earthquakes': { stadium: 'PayPal Park', lat: 37.351, lon: -121.925, roof: 'none' },
  'seattle sounders fc': { stadium: 'Lumen Field', lat: 47.595, lon: -122.332, roof: 'none' },
  'seattle sounders': { stadium: 'Lumen Field', lat: 47.595, lon: -122.332, roof: 'none' },
  'st louis city sc': { stadium: 'Energizer Park', lat: 38.631, lon: -90.211, roof: 'none' },
  'toronto fc': { stadium: 'BMO Field', lat: 43.633, lon: -79.419, roof: 'none' },
  'vancouver whitecaps fc': { stadium: 'BC Place', lat: 49.277, lon: -123.112, roof: 'retractable' },
  'vancouver whitecaps': { stadium: 'BC Place', lat: 49.277, lon: -123.112, roof: 'retractable' },
};

function venueKey(teamName) {
  return String(teamName || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookupVenue(homeTeam) {
  return VENUES[venueKey(homeTeam)] || null;
}

function compassFromDegrees(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((Number(deg) % 360) / 45)) % 8];
}

// Index of the hourly slot closest to game time. Open-Meteo returns ISO
// strings without a zone suffix when timezone=UTC, so append Z.
function nearestHourIndex(hourlyTimes, gameDateIso) {
  if (!Array.isArray(hourlyTimes) || hourlyTimes.length === 0) return -1;
  const target = new Date(gameDateIso).getTime();
  if (Number.isNaN(target)) return -1;
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < hourlyTimes.length; i++) {
    const t = new Date(`${hourlyTimes[i]}Z`).getTime();
    const diff = Math.abs(t - target);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  // A forecast more than 2 hours from game time means the game is outside
  // the forecast window. No number beats a wrong number.
  return bestDiff <= 2 * 3600 * 1000 ? best : -1;
}

function buildWeatherRow(game, venue, hourly, idx) {
  const matchup = `${game.away_team} @ ${game.home_team}`;
  if (venue.roof === 'dome') {
    return {
      game: matchup, stadium: venue.stadium, roof: 'dome',
      temp_f: null, wind_mph: null, wind_effect: null, precip_chance_pct: null,
      note: 'Fixed roof, weather irrelevant.', source: 'open-meteo',
    };
  }
  if (idx < 0 || !hourly) return null;

  const temp = hourly.temperature_2m?.[idx];
  const wind = hourly.wind_speed_10m?.[idx];
  const windDir = hourly.wind_direction_10m?.[idx];
  const precip = hourly.precipitation_probability?.[idx];

  const windMph = wind != null ? Math.round(wind) : null;
  const noteBits = [];
  const compass = compassFromDegrees(windDir);
  if (windMph != null && compass) noteBits.push(`Wind ${windMph} mph from the ${compass}.`);
  if (precip != null && precip >= 30) noteBits.push(`${Math.round(precip)}% precipitation chance at game time.`);
  if (venue.roof === 'retractable') noteBits.push('Retractable roof, may be closed.');

  return {
    game: matchup,
    stadium: venue.stadium,
    roof: venue.roof === 'retractable' ? 'retractable' : 'none',
    temp_f: temp != null ? Math.round(temp) : null,
    wind_mph: windMph,
    wind_effect: windMph != null && windMph < 6 ? 'calm' : 'unknown',
    precip_chance_pct: precip != null ? Math.round(precip) : null,
    note: noteBits.join(' ') || null,
    source: 'open-meteo',
  };
}

async function fetchForecast(lat, lon, fetchImpl = fetch) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m'
    + '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=3';
  const resp = await fetchImpl(url);
  if (!resp.ok) throw new Error(`open-meteo ${resp.status}`);
  const body = await resp.json();
  return body?.hourly || null;
}

/**
 * Weather rows for a slate of games. One forecast fetch per unique venue,
 * failures per venue fail soft (the row is skipped, everything else lands).
 */
async function getWeatherForGames(games, { fetchImpl = fetch } = {}) {
  const rows = [];
  const errors = [];
  const forecastCache = new Map();

  for (const game of games || []) {
    const venue = lookupVenue(game.home_team);
    if (!venue) continue;

    let hourly = null;
    let idx = -1;
    if (venue.roof !== 'dome') {
      const cacheKey = `${venue.lat},${venue.lon}`;
      try {
        if (!forecastCache.has(cacheKey)) {
          forecastCache.set(cacheKey, await fetchForecast(venue.lat, venue.lon, fetchImpl));
        }
        hourly = forecastCache.get(cacheKey);
        idx = nearestHourIndex(hourly?.time, game.game_date);
      } catch (e) {
        errors.push(`${venue.stadium}: ${e.message}`);
        continue;
      }
    }

    const row = buildWeatherRow(game, venue, hourly, idx);
    if (row) rows.push(row);
  }

  return { weather: rows, errors };
}

module.exports = {
  getWeatherForGames,
  lookupVenue,
  nearestHourIndex,
  buildWeatherRow,
  compassFromDegrees,
  venueKey,
};
