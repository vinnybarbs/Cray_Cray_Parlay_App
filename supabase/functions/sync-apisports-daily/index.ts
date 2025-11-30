import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Supabase Edge Function to sync API-Sports data daily
 * Triggered by pg_cron at 6 AM PT (14:00 UTC)
 */
serve(async (req) => {
  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Call your Railway backend sync endpoint
    const backendUrl = Deno.env.get('BACKEND_URL') || 'https://craycrayparlayapp-production.up.railway.app';
    const syncResponse = await fetch(`${backendUrl}/api/sync-apisports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const syncData = await syncResponse.json();

    console.log('✅ Daily API-Sports sync completed:', syncData);

    return new Response(JSON.stringify({
      success: true,
      message: 'Daily sync completed',
      data: syncData,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Daily sync failed:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
