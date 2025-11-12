// Enhanced timezone-aware API endpoint
// Add to your Express routes or create as new endpoint

const { MTTime } = require('../lib/enhanced-timezone-utils');

// GET /api/timezone-info - Show current timezone status and capabilities
app.get('/api/timezone-info', async (req, res) => {
  try {
    const currentMT = MTTime.now();
    const sampleGameDate = new Date('2025-11-16T20:30:00Z'); // Sample game
    
    const timezoneInfo = {
      current: {
        mountainTime: currentMT,
        utc: new Date().toISOString(),
        formatted: MTTime.formatMT(new Date()),
        isBusinessHours: MTTime.isBusinessHours(),
        timestamp: new Date().getTime()
      },
      
      capabilities: {
        formatGameTime: MTTime.formatGameTime(sampleGameDate),
        isPrimeTime: MTTime.isPrimeTime(sampleGameDate),
        isWeekend: MTTime.isWeekend(sampleGameDate),
        timeCategory: MTTime.categorizeGameTime(sampleGameDate)
      },
      
      examples: {
        'Database UTC to MT Display': MTTime.fromUTC('2025-11-16T20:30:00.000Z'),
        'Game Time Format': MTTime.formatGameTime('2025-11-16T20:30:00Z'),
        'Prime Time Check': MTTime.isPrimeTime('2025-11-16T20:30:00Z'),
        'Weekend Check': MTTime.isWeekend('2025-11-16T20:30:00Z')
      },
      
      gameTimeCategories: {
        morning: 'Games 10 AM - 1 PM MT',
        afternoon: 'Games 1 PM - 5 PM MT', 
        primeTime: 'Games 5 PM - 8 PM MT',
        night: 'Games 8 PM - 11 PM MT',
        lateNight: 'Games 11 PM - 10 AM MT'
      }
    };
    
    res.json({
      success: true,
      timezone: 'America/Denver (Mountain Time)',
      info: timezoneInfo
    });
    
  } catch (error) {
    console.error('Timezone info error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get timezone information' 
    });
  }
});

// GET /api/games/schedule-mt - Games with enhanced MT formatting  
app.get('/api/games/schedule-mt', async (req, res) => {
  try {
    const { sport = 'americanfootball_nfl', category = 'all' } = req.query;
    
    // Query games from database (using your existing connection)
    const { data: games, error } = await supabase
      .from('odds_cache')
      .select('home_team, away_team, commence_time, external_game_id')
      .eq('sport', sport)
      .gte('commence_time', new Date().toISOString())
      .order('commence_time')
      .limit(20);
    
    if (error) throw error;
    
    // Enhanced MT formatting for each game
    const enhancedGames = games.map(game => {
      const gameTime = new Date(game.commence_time);
      
      return {
        ...game,
        mountainTime: {
          formatted: MTTime.formatGameTime(game.commence_time),
          displayTime: MTTime.formatMT(game.commence_time, { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true 
          }),
          displayDate: MTTime.formatMT(game.commence_time, { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
          }),
          isPrimeTime: MTTime.isPrimeTime(game.commence_time),
          isWeekend: MTTime.isWeekend(game.commence_time),
          category: MTTime.categorizeGameTime(game.commence_time)
        }
      };
    });
    
    // Filter by category if specified
    let filteredGames = enhancedGames;
    if (category === 'primetime') {
      filteredGames = enhancedGames.filter(g => g.mountainTime.isPrimeTime);
    } else if (category === 'weekend') {
      filteredGames = enhancedGames.filter(g => g.mountainTime.isWeekend);
    }
    
    res.json({
      success: true,
      sport,
      category,
      currentMountainTime: MTTime.now(),
      totalGames: filteredGames.length,
      games: filteredGames
    });
    
  } catch (error) {
    console.error('Schedule MT error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get MT schedule' 
    });
  }
});

module.exports = { /* your existing exports */ };