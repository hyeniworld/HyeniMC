/**
 * Cloudflare Worker - HyeniMC Releases API
 * 
 * Endpoints:
 * - GET /api/hyenihelper/latest - Get latest version info
 * - GET /api/hyenihelper/versions - Get all versions
 * - GET /download/hyenihelper/{version}/{file}?token={TOKEN} - Download file (auth required)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      // Route: GET /api/hyenihelper/latest
      if (url.pathname === '/api/hyenihelper/latest') {
        return await handleGetLatest(env, corsHeaders);
      }
      
      // Route: GET /api/hyenihelper/versions
      if (url.pathname === '/api/hyenihelper/versions') {
        return await handleGetVersions(env, corsHeaders);
      }
      
      // Route: GET /download/hyenihelper/{version}/{file}
      if (url.pathname.startsWith('/download/hyenihelper/')) {
        return await handleDownload(request, env, corsHeaders);
      }
      
      // Route: GET /health
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 404 Not Found
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal Server Error',
        message: error.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Get latest version info
 */
async function handleGetLatest(env, corsHeaders) {
  const latest = await env.RELEASES.get('hyenihelper/latest.json');
  
  if (!latest) {
    return new Response(JSON.stringify({ 
      error: 'Latest version not found' 
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
async function handleGetVersions(env, corsHeaders) {
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
async function handleDownload(request, env, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/download/', '');
  
  // Get token from query or header
  const token = url.searchParams.get('token') || 
                request.headers.get('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return new Response(JSON.stringify({ 
      error: 'Unauthorized',
      message: '토큰이 필요합니다. /인증 명령어로 인증하세요.' 
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Validate token (basic validation - you can enhance this)
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
  
  return new Response(file.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/java-archive',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': file.size,
      'Cache-Control': 'private, max-age=3600', // 1시간 캐시 (private)
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

/**
 * Validate token (basic validation)
 * TODO: Enhance with actual token verification (DB, JWT, etc.)
 */
function isValidToken(token) {
  // Basic validation: token should be alphanumeric and at least 10 chars
  if (!token || token.length < 10) {
    return false;
  }
  
  // Check if it matches expected format
  // For now, accept any token that looks valid
  // In production, verify against Discord API or your DB
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
