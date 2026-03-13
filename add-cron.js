// add-cron.js
// One-off script to register the refresh_player_recent_form_concurrent() cron job
// Run with: SUPABASE_DB_URL=... node add-cron.js

// For this one-off local script, disable TLS cert verification so that Supabase's
// self-signed certificate does not cause failures. This only affects this process.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Client } = require('pg');

async function addCronJobPg() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('SUPABASE_DB_URL is not set. Export it in your shell before running this script.');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    // Supabase Postgres requires SSL; for this one-off local script, accept the
    // self-signed certificate instead of failing with "self-signed certificate".
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to Postgres. Inserting cron job...');

    const schedule = '*/15 * * * *';
    const command = 'SELECT public.refresh_player_recent_form_concurrent();';
    const jobname = 'refresh_player_recent_form';

    // Use cron.schedule(jobname, schedule, command) – this matches the pg_cron
    // usage in your existing SQL migration files.
    const sql = 'SELECT cron.schedule($1, $2, $3);';
    const res = await client.query(sql, [jobname, schedule, command]);

    console.log('PG RPC result:', res.rows);
    console.log('Cron job registration complete.');
  } catch (err) {
    console.error('Error inserting cron job:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

addCronJobPg();
