/**
 * HyeniMC Cloudflare Worker
 * 
 * Features:
 * - CurseForge API Proxy (with API key protection & rate limiting)
 * - Releases API (HyeniHelper mod distribution)
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-launcher-id',
    };

    // Handle OPTIONS request (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Route: Releases API
      if (path.startsWith('/api/hyenihelper/') || path.startsWith('/download/hyenihelper/')) {
        return await handleReleasesAPI(request, env, corsHeaders);
      }

      // Route: Health check
      if (path === '/health') {
        return new Response(JSON.stringify({ 
          status: 'ok', 
          timestamp: Date.now(),
          services: {
            curseforge: 'proxy',
            releases: 'enabled'
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Default: CurseForge Proxy
      return await handleCurseForgeProxy(request, env, corsHeaders);

    } catch (error) {
      console.error('[Worker] Error:', error);
      
      return new Response(
        JSON.stringify({
          error: 'Worker error',
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

/**
 * Handle CurseForge API Proxy
 */
async function handleCurseForgeProxy(request, env, corsHeaders) {
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

  console.log(`[CurseForge Proxy] ${request.method} ${curseforgeUrl} (client: ${clientId})`);

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
}

/**
 * Handle Releases API
 */
async function handleReleasesAPI(request, env, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname;

  // GET /api/hyenihelper/latest
  if (path === '/api/hyenihelper/latest') {
    return await getLatestRelease(env, corsHeaders);
  }

  // GET /api/hyenihelper/versions
  if (path === '/api/hyenihelper/versions') {
    return await getVersionsList(env, corsHeaders);
  }

  // GET /download/hyenihelper/{version}/{file}
  if (path.startsWith('/download/hyenihelper/')) {
    return await downloadFile(request, env, corsHeaders);
  }

  // 404 Not Found
  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Get latest HyeniHelper release
 */
async function getLatestRelease(env, corsHeaders) {
  if (!env.RELEASES) {
    return new Response(JSON.stringify({ 
      error: 'R2 bucket not configured' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const latest = await env.RELEASES.get('hyenihelper/latest.json');
  
  if (!latest) {
    return new Response(JSON.stringify({ 
      error: 'Latest version not found',
      message: 'Release information not available yet.'
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  const data = JSON.parse(await latest.text());
  
  // Add full download URLs
  if (data.loaders) {
    for (const [loader, info] of Object.entries(data.loaders)) {
      info.downloadUrl = `/download/${info.downloadPath}`;
    }
  }
  
  console.log(`[Releases API] Latest version: ${data.version}`);
  
  return new Response(JSON.stringify(data), {
    headers: { 
      ...corsHeaders, 
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300' // 5분 캐시
    }
  });
}

/**
 * Get all versions list
 */
async function getVersionsList(env, corsHeaders) {
  if (!env.RELEASES) {
    return new Response(JSON.stringify({ 
      error: 'R2 bucket not configured' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // R2 list objects in hyenihelper/ prefix
  const list = await env.RELEASES.list({ prefix: 'hyenihelper/' });
  
  // Extract versions from paths
  const versions = new Set();
  for (const obj of list.objects) {
    const match = obj.key.match(/hyenihelper\/(\d+\.\d+\.\d+)\//);
    if (match) {
      versions.add(match[1]);
    }
  }
  
  // Fetch manifest for each version
  const versionList = [];
  for (const version of versions) {
    const manifestPath = `hyenihelper/${version}/manifest.json`;
    const manifest = await env.RELEASES.get(manifestPath);
    
    if (manifest) {
      try {
        const data = JSON.parse(await manifest.text());
        versionList.push({
          version: data.version,
          releaseDate: data.releaseDate || null,
          gameVersion: data.gameVersion,
          changelog: data.changelog || '',
          required: data.required || false
        });
      } catch (e) {
        console.error(`Failed to parse manifest for ${version}:`, e);
      }
    }
  }
  
  // Sort by version (descending)
  versionList.sort((a, b) => compareVersions(b.version, a.version));
  
  console.log(`[Releases API] Found ${versionList.length} versions`);
  
  return new Response(JSON.stringify({ versions: versionList }), {
    headers: { 
      ...corsHeaders, 
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600' // 10분 캐시
    }
  });
}

/**
 * Download file (authentication required)
 */
async function downloadFile(request, env, corsHeaders) {
  if (!env.RELEASES) {
    return new Response(JSON.stringify({ 
      error: 'R2 bucket not configured' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace('/download/', '');
  
  // Get token from query or header
  const token = url.searchParams.get('token') || 
                request.headers.get('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return new Response(JSON.stringify({ 
      error: 'Unauthorized',
      message: '토큰이 필요합니다. Discord에서 /auth 명령어로 인증하세요.' 
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Validate token
  if (!isValidToken(token)) {
    return new Response(JSON.stringify({ 
      error: 'Unauthorized',
      message: '유효하지 않은 토큰입니다.' 
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Get file from R2
  const file = await env.RELEASES.get(path);
  
  if (!file) {
    return new Response(JSON.stringify({ 
      error: 'Not Found',
      message: '파일을 찾을 수 없습니다.' 
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Return file with proper headers
  const fileName = path.split('/').pop();
  
  console.log(`[Releases API] Download: ${fileName} (token: ${token.substring(0, 8)}...)`);
  
  return new Response(file.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/java-archive',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': file.size,
      'Cache-Control': 'private, max-age=3600', // 1시간 캐시
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

/**
 * Validate token
 * TODO: Enhance with actual verification (Discord API, DB, etc.)
 */
function isValidToken(token) {
  // Basic validation
  if (!token || token.length < 10) {
    return false;
  }
  
  // Accept alphanumeric tokens
  const tokenPattern = /^[a-zA-Z0-9_-]+$/;
  return tokenPattern.test(token);
}

/**
 * Compare semantic versions
 */
function compareVersions(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    
    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }
  
  return 0;
}
