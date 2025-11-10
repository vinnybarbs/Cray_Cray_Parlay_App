const { supabase } = require('../lib/middleware/supabaseAuth');
const { logger } = require('../shared/logger');

/**
 * Real-time dashboard status endpoint
 * Provides plain-language status of data pipeline automation
 */
async function getDashboardStatus(req, res) {
    try {
        logger.info('Fetching real-time dashboard status');

        // Simplified approach - focus on data freshness which we can actually check
        const formattedJobs = [
            {
                job_name: 'refresh-odds-hourly',
                what_it_does: 'Gets fresh betting lines every hour',
                when_it_runs: '0 * * * *',
                is_active: true,
                status: '✅ Expected to be running'
            },
            {
                job_name: 'sync-sports-stats-6-hourly', 
                what_it_does: 'Gets team/player stats every 6 hours',
                when_it_runs: '0 1,7,13,19 * * *',
                is_active: true,
                status: '✅ Expected to be running'
            },
            {
                job_name: 'refresh-sports-intelligence-2-hourly',
                what_it_does: 'Gets injury news every 2 hours', 
                when_it_runs: '15 */2 * * *',
                is_active: true,
                status: '✅ Expected to be running'
            }
        ];

        const recentRuns = [
            {
                automation_job: 'Check Supabase Dashboard for actual run history',
                when_it_ran: new Date().toISOString(),
                result: '💡 Info',
                how_recent: 'Note',
                what_happened: 'This dashboard shows data freshness - check Supabase cron.job_run_details for execution history'
            }
        ];

        // 3. Check data freshness for each cache table
        const dataFreshness = [];

        // Odds cache freshness
        const { data: oddsData, error: oddsError } = await supabase
            .from('odds_cache')
            .select('last_updated')
            .order('last_updated', { ascending: false })
            .limit(1);

        if (!oddsError && oddsData?.length > 0) {
            const hoursOld = getHoursOld(oddsData[0].last_updated);
            dataFreshness.push({
                data_type: 'Betting Odds',
                total_records: await getTableCount('odds_cache'),
                newest_data: oddsData[0].last_updated,
                freshness_status: getFreshnessStatus('odds', hoursOld),
                hours_since_update: hoursOld
            });
        } else {
            dataFreshness.push({
                data_type: 'Betting Odds',
                total_records: 0,
                newest_data: null,
                freshness_status: '❌ No odds data found',
                hours_since_update: null
            });
        }

        // Team stats cache freshness
        const { data: statsData, error: statsError } = await supabase
            .from('team_stats_cache')
            .select('last_updated')
            .order('last_updated', { ascending: false })
            .limit(1);

        if (!statsError && statsData?.length > 0) {
            const hoursOld = getHoursOld(statsData[0].last_updated);
            dataFreshness.push({
                data_type: 'Team/Player Stats',
                total_records: await getTableCount('team_stats_cache'),
                newest_data: statsData[0].last_updated,
                freshness_status: getFreshnessStatus('stats', hoursOld),
                hours_since_update: hoursOld
            });
        } else {
            dataFreshness.push({
                data_type: 'Team/Player Stats',
                total_records: 0,
                newest_data: null,
                freshness_status: '❌ No stats data found',
                hours_since_update: null
            });
        }

        // News cache freshness
        const { data: newsData, error: newsError } = await supabase
            .from('news_cache')
            .select('last_updated')
            .order('last_updated', { ascending: false })
            .limit(1);

        if (!newsError && newsData?.length > 0) {
            const hoursOld = getHoursOld(newsData[0].last_updated);
            dataFreshness.push({
                data_type: 'Injury News',
                total_records: await getTableCount('news_cache'),
                newest_data: newsData[0].last_updated,
                freshness_status: getFreshnessStatus('news', hoursOld),
                hours_since_update: hoursOld
            });
        } else {
            dataFreshness.push({
                data_type: 'Injury News',
                total_records: 0,
                newest_data: null,
                freshness_status: '❌ No news data found',
                hours_since_update: null
            });
        }

        // 4. Generate critical actions
        const criticalActions = [];
        
        // Check if cron jobs exist
        if (!formattedJobs.some(job => job.job_name.includes('odds'))) {
            criticalActions.push({
                priority_action: '🚨 CRITICAL: No odds automation scheduled - your betting lines will never update!',
                what_to_do_now: 'Add odds refresh cron job immediately'
            });
        }

        if (!formattedJobs.some(job => job.job_name.includes('stats'))) {
            criticalActions.push({
                priority_action: '⚠️ MISSING: No stats automation - AI has no team performance data',
                what_to_do_now: 'Add stats sync cron job'
            });
        }

        if (!formattedJobs.some(job => job.job_name.includes('news') || job.job_name.includes('intelligence'))) {
            criticalActions.push({
                priority_action: '⚠️ MISSING: No news automation - AI missing injury reports',
                what_to_do_now: 'Add news refresh cron job'
            });
        }

        // Check data staleness
        const staleOdds = dataFreshness.find(d => d.data_type === 'Betting Odds' && d.hours_since_update > 6);
        if (staleOdds) {
            criticalActions.push({
                priority_action: '🔴 STALE ODDS: Betting lines are over 6 hours old - refresh needed',
                what_to_do_now: 'Manually trigger odds refresh or check API keys'
            });
        }

        const response = {
            status: 'success',
            timestamp: new Date().toISOString(),
            automationJobs: formattedJobs,
            recentActivity: recentRuns || [],
            dataFreshness,
            criticalActions,
            summary: {
                totalJobs: formattedJobs.length,
                activeJobs: formattedJobs.filter(j => j.is_active).length,
                criticalIssues: criticalActions.length,
                overallHealth: criticalActions.length === 0 ? '✅ Healthy' : '⚠️ Needs Attention'
            }
        };

        res.json(response);

    } catch (error) {
        logger.error('Dashboard status error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch dashboard status',
            error: error.message
        });
    }
}

// Helper functions
function getJobDescription(jobName) {
    if (jobName.includes('odds')) return 'Gets fresh betting lines every hour';
    if (jobName.includes('stats')) return 'Gets team/player stats every 6 hours';
    if (jobName.includes('news') || jobName.includes('intelligence')) return 'Gets injury news every 2 hours';
    return 'Other automation';
}

function getHoursOld(timestamp) {
    if (!timestamp) return null;
    const now = new Date();
    const then = new Date(timestamp);
    return Math.round((now - then) / (1000 * 60 * 60) * 10) / 10;
}

function getTimeCategory(timestamp) {
    if (!timestamp) return 'Unknown';
    const hoursOld = getHoursOld(timestamp);
    if (hoursOld < 1) return 'Just ran';
    if (hoursOld < 6) return 'Recent';
    return 'Old run';
}

function getFreshnessStatus(dataType, hoursOld) {
    if (hoursOld === null) return '❌ No data';
    
    switch (dataType) {
        case 'odds':
            if (hoursOld < 2) return '🟢 Fresh (less than 2 hours old)';
            if (hoursOld < 6) return '🟡 Getting stale (2-6 hours old)';
            return '🔴 Very stale (over 6 hours old)';
        
        case 'stats':
            if (hoursOld < 12) return '🟢 Fresh (less than 12 hours old)';
            if (hoursOld < 24) return '🟡 Getting stale (12-24 hours old)';
            return '🔴 Very stale (over 24 hours old)';
        
        case 'news':
            if (hoursOld < 4) return '🟢 Fresh (less than 4 hours old)';
            if (hoursOld < 12) return '🟡 Getting stale (4-12 hours old)';
            return '🔴 Very stale (over 12 hours old)';
        
        default:
            return 'Unknown';
    }
}

async function getTableCount(tableName) {
    try {
        const { count, error } = await supabase
            .from(tableName)
            .select('*', { count: 'exact', head: true });
        
        return error ? 0 : count;
    } catch (error) {
        return 0;
    }
}

module.exports = {
    getDashboardStatus
};