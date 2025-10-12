# HyeniMC CurseForge Proxy

This Cloudflare Worker acts as a proxy for CurseForge API requests to protect the API key.

## Setup

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Create KV Namespace

```bash
# Create KV namespace for rate limiting
wrangler kv:namespace create "RATE_LIMIT"

# Note the ID and update wrangler.toml
```

### 4. Set API Key Secret

```bash
wrangler secret put CURSEFORGE_API_KEY
# Enter your CurseForge API key when prompted
```

### 5. Deploy

```bash
wrangler publish
```

## Testing

```bash
# Test the proxy
curl -H "x-launcher-id: test-client" \
  https://hyenimc-cf-proxy.workers.dev/mods/search?gameId=432&searchFilter=sodium

# Check rate limiting
for i in {1..110}; do
  curl -H "x-launcher-id: test-client" \
    https://hyenimc-cf-proxy.workers.dev/mods/search?gameId=432
done
```

## Rate Limiting

- **Limit**: 100 requests per hour per client
- **Client ID**: Identified by `x-launcher-id` header
- **Response**: HTTP 429 when limit exceeded

## Endpoints

All CurseForge API v1 endpoints are supported:

- `GET /mods/search` - Search mods
- `GET /mods/{modId}` - Get mod details
- `GET /mods/{modId}/files` - Get mod files
- And more...

## Monitoring

View logs and metrics in Cloudflare Dashboard:
https://dash.cloudflare.com/

## Cost

Cloudflare Workers Free Tier:
- **100,000 requests/day** (FREE)
- **10ms CPU time per request**

Expected usage with 1000 users:
- ~50,000 requests/month
- **Cost: $0** (within free tier)
