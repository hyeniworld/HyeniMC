# HyeniMC Worker

Cloudflare Worker providing two main services:
1. **CurseForge API Proxy**: Protects API key from client exposure
2. **Mod Distribution (R2)**: Serves custom mods (e.g., HyeniHelper) with token authentication

## Setup

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Configure wrangler.toml

```bash
# Copy example config
cp wrangler.toml.example wrangler.toml

# Edit wrangler.toml and update:
# 1. WORKER_URL - Your deployed worker URL
# 2. KV namespace ID (after creating in step 4)
# 3. account_id, zone_id, and worker_name in [worker] section
# 4. bucket_name in [bucket] section
```

**Important**: Update `WORKER_URL` in `[vars]` section to match your deployed worker URL.

### 4. Create KV Namespace

```bash
# Create KV namespace for rate limiting
wrangler kv:namespace create "RATE_LIMIT"

# Note the ID and update wrangler.toml
```

### 5. Create R2 Bucket (for mod distribution)

```bash
wrangler r2 bucket create hyenimc-releases
```

### 6. Set Secrets

```bash
# CurseForge API Key
wrangler secret put CURSEFORGE_API_KEY

# Token validation API URL
wrangler secret put TOKEN_CHECK_API_URL
```

See `ENV_SETUP.md` for detailed instructions.

### 7. Deploy

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

### CurseForge Proxy
All CurseForge API v1 endpoints are supported:

- `GET /mods/search` - Search mods
- `GET /mods/{modId}` - Get mod details
- `GET /mods/{modId}/files` - Get mod files
- And more...

### Mod Distribution (R2)

- `GET /api/mods` - List all available mods
- `GET /api/mods/{modId}/latest` - Get latest version info
- `GET /api/mods/{modId}/versions` - List all versions
- `GET /download/mods/{modId}/{version}/{file}?token=xxx` - Download mod file (requires token)

### Health Check

- `GET /health` - Service status

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
