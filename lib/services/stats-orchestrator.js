const TeamStatsSync = require('./team-stats-sync');
const PlayerStatsSync = require('./player-stats-sync');
const { createClient } = require('@supabase/supabase-js');

class StatsOrchestrator {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.teamSync = new TeamStatsSync();
    this.playerSync = new PlayerStatsSync();
  }

  /**
   * Run complete daily stats sync for all sports
   */
  async runDailySync() {
    const startTime = new Date();
    console.log(`🚀 Starting daily stats sync at ${startTime.toISOString()}`);

    const results = {
      start_time: startTime,
      end_time: null,
      duration_minutes: 0,
      team_stats: null,
      player_stats: null,
      overall_status: 'running',
      summary: {}
    };

    try {
      // 1. Sync team stats first
      console.log('\n📊 Phase 1: Team Stats Sync');
      results.team_stats = await this.teamSync.syncAllTeamStats();
      
      // 2. Then sync player stats
      console.log('\n👤 Phase 2: Player Stats Sync');
      results.player_stats = await this.playerSync.syncAllPlayerStats();
      
      // 3. Calculate final results
      results.end_time = new Date();
      results.duration_minutes = Math.round((results.end_time - results.start_time) / 60000);
      
      results.summary = {
        total_teams_processed: results.team_stats.total_processed,
        total_teams_updated: results.team_stats.total_updated,
        total_players_processed: results.player_stats.total_processed,
        total_players_updated: results.player_stats.total_updated,
        sports_completed: results.team_stats.sports_completed,
        total_errors: results.team_stats.errors.length + results.player_stats.errors.length
      };

      // Determine overall status
      if (results.summary.total_errors === 0) {
        results.overall_status = 'completed';
      } else if (results.summary.total_errors < 3) {
        results.overall_status = 'completed_with_warnings';
      } else {
        results.overall_status = 'partial_failure';
      }

      // 4. Log daily sync completion
      await this.logDailySync(results);

      console.log('\n🎉 Daily sync completed:', results.summary);
      console.log(`⏱️  Total duration: ${results.duration_minutes} minutes`);

      return results;

    } catch (error) {
      results.end_time = new Date();
      results.duration_minutes = Math.round((results.end_time - results.start_time) / 60000);
      results.overall_status = 'failed';
      results.error = error.message;

      console.error('❌ Daily sync failed:', error);
      
      await this.logDailySync(results);
      throw error;
    }
  }

  /**
   * Run team stats sync only
   */
  async runTeamStatsSync() {
    console.log('📊 Running team stats sync only...');
    const results = await this.teamSync.syncAllTeamStats();
    
    await this.supabase.from('stats_sync_log').insert({
      sync_type: 'team_stats_manual',
      sport: 'all',
      records_processed: results.total_processed,
      records_updated: results.total_updated,
      status: results.errors.length > 0 ? 'partial' : 'completed',
      end_time: new Date().toISOString()
    });

    return results;
  }

  /**
   * Run player stats sync only
   */
  async runPlayerStatsSync() {
    console.log('👤 Running player stats sync only...');
    const results = await this.playerSync.syncAllPlayerStats();
    
    await this.supabase.from('stats_sync_log').insert({
      sync_type: 'player_stats_manual',
      sport: 'all',
      records_processed: results.total_processed,
      records_updated: results.total_updated,
      status: results.errors.length > 0 ? 'partial' : 'completed',
      end_time: new Date().toISOString()
    });

    return results;
  }

  /**
   * Get sync status and health metrics
   */
  async getSyncStatus() {
    try {
      // Get latest sync logs
      const { data: recentSyncs, error } = await this.supabase
        .from('stats_sync_log')
        .select('*')
        .order('start_time', { ascending: false })
        .limit(10);

      if (error) throw error;

      // Get team and player counts by sport
      const { data: teamCounts } = await this.supabase
        .from('team_season_stats')
        .select('sport')
        .eq('season', new Date().getFullYear());

      const { data: playerCounts } = await this.supabase
        .from('player_season_stats')
        .select('sport')
        .eq('season', new Date().getFullYear());

      // Calculate stats by sport
      const sportStats = {};
      
      if (teamCounts) {
        teamCounts.forEach(record => {
          if (!sportStats[record.sport]) sportStats[record.sport] = { teams: 0, players: 0 };
          sportStats[record.sport].teams++;
        });
      }
      
      if (playerCounts) {
        playerCounts.forEach(record => {
          if (!sportStats[record.sport]) sportStats[record.sport] = { teams: 0, players: 0 };
          sportStats[record.sport].players++;
        });
      }

      // Get data freshness
      const { data: freshness } = await this.supabase
        .from('team_season_stats')
        .select('sport, last_updated')
        .order('last_updated', { ascending: false });

      const dataFreshness = {};
      if (freshness) {
        freshness.forEach(record => {
          if (!dataFreshness[record.sport]) {
            const hoursSinceUpdate = (Date.now() - new Date(record.last_updated)) / (1000 * 60 * 60);
            dataFreshness[record.sport] = {
              last_updated: record.last_updated,
              hours_since_update: Math.round(hoursSinceUpdate * 10) / 10
            };
          }
        });
      }

      return {
        recent_syncs: recentSyncs,
        sport_statistics: sportStats,
        data_freshness: dataFreshness,
        sync_health: this.calculateSyncHealth(recentSyncs),
        last_update: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error getting sync status:', error);
      throw error;
    }
  }

  /**
   * Calculate sync health based on recent sync performance
   */
  calculateSyncHealth(recentSyncs) {
    if (!recentSyncs || recentSyncs.length === 0) {
      return { status: 'unknown', score: 0, message: 'No sync history available' };
    }

    const last24Hours = recentSyncs.filter(sync => {
      const syncTime = new Date(sync.start_time);
      const hoursAgo = (Date.now() - syncTime) / (1000 * 60 * 60);
      return hoursAgo <= 24;
    });

    const successRate = last24Hours.length > 0 ? 
      last24Hours.filter(sync => sync.status === 'completed').length / last24Hours.length : 0;

    const avgDuration = last24Hours.length > 0 ?
      last24Hours.reduce((sum, sync) => sum + (sync.duration_seconds || 0), 0) / last24Hours.length : 0;

    let status = 'healthy';
    let score = 10;
    let message = 'All systems operational';

    if (successRate < 0.8) {
      status = 'degraded';
      score = 6;
      message = 'Recent sync failures detected';
    }

    if (successRate < 0.5) {
      status = 'unhealthy';
      score = 3;
      message = 'High sync failure rate';
    }

    if (avgDuration > 1800) { // 30 minutes
      status = 'slow';
      score = Math.min(score, 7);
      message = 'Sync performance degraded';
    }

    return {
      status,
      score,
      message,
      success_rate: Math.round(successRate * 100),
      avg_duration_minutes: Math.round(avgDuration / 60),
      syncs_24h: last24Hours.length
    };
  }

  /**
   * Log daily sync results
   */
  async logDailySync(results) {
    try {
      await this.supabase.from('stats_sync_log').insert({
        sync_type: 'daily_full_sync',
        sport: 'all',
        start_time: results.start_time.toISOString(),
        end_time: results.end_time.toISOString(),
        duration_seconds: results.duration_minutes * 60,
        records_processed: results.summary?.total_teams_processed + results.summary?.total_players_processed || 0,
        records_updated: results.summary?.total_teams_updated + results.summary?.total_players_updated || 0,
        records_failed: results.summary?.total_errors || 0,
        status: results.overall_status,
        error_message: results.error || null
      });
    } catch (error) {
      console.error('Error logging daily sync:', error);
    }
  }

  /**
   * Clean up old sync logs (keep last 30 days)
   */
  async cleanupOldLogs() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      const { data, error } = await this.supabase
        .from('stats_sync_log')
        .delete()
        .lt('start_time', thirtyDaysAgo.toISOString());

      if (error) throw error;

      console.log(`🧹 Cleaned up sync logs older than ${thirtyDaysAgo.toDateString()}`);
      return data;
    } catch (error) {
      console.error('Error cleaning up old logs:', error);
      throw error;
    }
  }
}

module.exports = StatsOrchestrator;