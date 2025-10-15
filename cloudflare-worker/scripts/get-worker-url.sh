#!/usr/bin/env bash
#
# Get Worker URL from wrangler.toml
#
# This script reads wrangler.toml and extracts the WORKER_URL.
# If WORKER_URL is not set, it generates a default URL based on the worker name.
#

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRANGLER_TOML="$SCRIPT_DIR/../wrangler.toml"

# Check if wrangler.toml exists
if [ ! -f "$WRANGLER_TOML" ]; then
    echo "Error: wrangler.toml not found: $WRANGLER_TOML" >&2
    exit 1
fi

# Try to extract WORKER_URL from [vars] section
WORKER_URL=$(awk '
    /^\[vars\]/ { in_vars=1; next }
    /^\[/ { in_vars=0 }
    in_vars && /^WORKER_URL/ {
        match($0, /"([^"]+)"/, arr)
        print arr[1]
        exit
    }
' "$WRANGLER_TOML")

if [ -n "$WORKER_URL" ]; then
    echo "$WORKER_URL"
    exit 0
fi

# If WORKER_URL not found, try to generate from worker name
WORKER_NAME=$(awk -F'=' '/^name[[:space:]]*=/ {
    gsub(/[[:space:]"]+/, "", $2)
    print $2
    exit
}' "$WRANGLER_TOML")

if [ -z "$WORKER_NAME" ]; then
    echo "Error: Cannot find 'name' or WORKER_URL in wrangler.toml" >&2
    exit 1
fi

# Try to get account name
ACCOUNT_NAME="${CLOUDFLARE_ACCOUNT_NAME}"

if [ -z "$ACCOUNT_NAME" ]; then
    # Try wrangler whoami
    if command -v wrangler &> /dev/null; then
        ACCOUNT_NAME=$(wrangler whoami 2>&1 | grep -oP 'Account Name:\s*\K.+' | xargs)
    fi
fi

if [ -z "$ACCOUNT_NAME" ]; then
    cat >&2 <<EOF
Error: WORKER_URL is not set in wrangler.toml

Please do one of the following:
1. Add WORKER_URL to wrangler.toml:
   [vars]
   WORKER_URL = "https://your-worker.your-account.workers.dev"

2. Set environment variable:
   export CLOUDFLARE_ACCOUNT_NAME="your-account"

3. Run: wrangler login
EOF
    exit 1
fi

# Generate default URL
DEFAULT_URL="https://$WORKER_NAME.$ACCOUNT_NAME.workers.dev"
echo "$DEFAULT_URL"
