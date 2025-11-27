// Minimal test to verify Edge Function infrastructure works
export default async function handler(req: Request) {
  console.log('[test-rss] Function invoked');
  
  try {
    // Test RSS fetching only
    const testUrl = 'https://www.espn.com/espn/rss/news';
    console.log('[test-rss] Fetching:', testUrl);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const resp = await fetch(testUrl, {
      headers: { 'User-Agent': 'CrayCrayTest/1.0' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    console.log('[test-rss] Response status:', resp.status);
    
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          message: `ESPN returned ${resp.status}` 
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const text = await resp.text();
    console.log('[test-rss] Received', text.length, 'bytes');
    
    // Quick regex test
    const itemMatches = text.match(/<item[^>]*>/gi);
    const itemCount = itemMatches ? itemMatches.length : 0;
    
    console.log('[test-rss] Found', itemCount, 'items');
    
    return new Response(
      JSON.stringify({
        status: 'ok',
        rss_bytes: text.length,
        items_found: itemCount,
        sample: text.substring(0, 500)
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[test-rss] Error:', errMsg);
    
    return new Response(
      JSON.stringify({ status: 'error', message: errMsg }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
