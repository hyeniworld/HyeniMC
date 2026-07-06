#!/usr/bin/env bash
#
# HyeniPack V2 Deployment Script
#
# Usage:
#   ./deploy-hyenipack.sh --pack path/to/MyPack-1.2.0.hyenipack
#
# latest.json은 팩 파일과 같은 폴더의 <이름>.latest.json을 자동 탐색한다
# (HyeniMC export가 함께 생성). 롤백: 이전 버전 파일 쌍으로 다시 실행하면 됨.

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
BUCKET="hyenimc-releases"

PACK_FILE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --pack) PACK_FILE="$2"; shift 2 ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo -e "${RED}Unknown argument: $1${NC}" >&2; exit 1 ;;
    esac
done

[ -z "$PACK_FILE" ] && { echo -e "${RED}Error: --pack is required${NC}" >&2; exit 1; }
[ -f "$PACK_FILE" ] || { echo -e "${RED}Error: pack file not found: $PACK_FILE${NC}" >&2; exit 1; }

LATEST_FILE="${PACK_FILE%.hyenipack}.latest.json"
[ -f "$LATEST_FILE" ] || { echo -e "${RED}Error: latest.json not found: $LATEST_FILE${NC}" >&2; exit 1; }

# latest.json에서 id/version/sha256 추출 (node 사용 — repo에 이미 필수)
read -r PACK_ID VERSION SHA256 <<< "$(node -e "
const j = require(require('path').resolve(process.argv[1]));
console.log(j.hyenipackId, j.version, j.sha256);
" "$LATEST_FILE")"

[[ "$PACK_ID" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] || { echo -e "${RED}Invalid hyenipackId: $PACK_ID${NC}" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo -e "${RED}Invalid version: $VERSION${NC}" >&2; exit 1; }

# sha256 대조 (업로드 전 무결성)
ACTUAL_SHA=$(shasum -a 256 "$PACK_FILE" | cut -d' ' -f1)
[ "$ACTUAL_SHA" = "$SHA256" ] || { echo -e "${RED}sha256 mismatch! latest.json=$SHA256 actual=$ACTUAL_SHA${NC}" >&2; exit 1; }

echo -e "${CYAN}Deploying ${PACK_ID} v${VERSION} ...${NC}"

wrangler r2 object put "$BUCKET/modpacks/$PACK_ID/versions/$VERSION/pack.hyenipack" \
    --remote --file "$PACK_FILE"
wrangler r2 object put "$BUCKET/modpacks/$PACK_ID/latest.json" \
    --remote --file "$LATEST_FILE" --content-type "application/json"

echo -e "${GREEN}Done. latest → v${VERSION}${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo -e "Verify: curl \$($SCRIPT_DIR/scripts/get-worker-url.sh)/api/v2/modpacks/$PACK_ID/latest"
