/**
 * HyeniMC CurseForge API Proxy
 * 
 * This proxy protects the CurseForge API key and provides rate limiting.
 */

const CURSEFORGE_BASE_URL = 'https://api.curseforge.com/v1';
const RATE_LIMIT_PER_HOUR = 100;
const RATE_LIMIT_WINDOW = 3600; // 1 hour in seconds

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-launcher-id',
    };

    // Handle OPTIONS request (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    try {
      // Extract client ID for rate limiting
      const clientId = request.headers.get('x-launcher-id') || 'unknown';
      
      // Check rate limit
      const rateLimitKey = `rate:${clientId}`;
      const currentCount = await env.RATE_LIMIT.get(rateLimitKey);
      
      if (currentCount && parseInt(currentCount) >= RATE_LIMIT_PER_HOUR) {
        return new Response(
          JSON.stringify({
            error: 'Rate limit exceeded',
            message: 'Too many requests. Please try again later.',
            retryAfter: RATE_LIMIT_WINDOW,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      // Parse request URL
      const url = new URL(request.url);
      const path = url.pathname;
      const search = url.search;

      // Build CurseForge API URL
      const curseforgeUrl = `${CURSEFORGE_BASE_URL}${path}${search}`;

      console.log(`[Proxy] ${request.method} ${curseforgeUrl} (client: ${clientId})`);

      // Forward request to CurseForge API
      const cfResponse = await fetch(curseforgeUrl, {
        method: request.method,
        headers: {
          'x-api-key': env.CURSEFORGE_API_KEY,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: request.method !== 'GET' ? await request.text() : undefined,
      });

      // Update rate limit counter
      const newCount = currentCount ? parseInt(currentCount) + 1 : 1;
      await env.RATE_LIMIT.put(rateLimitKey, newCount.toString(), {
        expirationTtl: RATE_LIMIT_WINDOW,
      });

      // Return response
      const responseData = await cfResponse.text();
      
      return new Response(responseData, {
        status: cfResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });

    } catch (error) {
      console.error('[Proxy] Error:', error);
      
      return new Response(
        JSON.stringify({
          error: 'Proxy error',
          message: error.message,
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }
  },
};
