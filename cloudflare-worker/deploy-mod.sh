#!/usr/bin/env bash
#
# HyeniMC Mod Deployment Script (Bash)
#
# Usage:
#   ./deploy-mod.sh -m MODULE_ID -v VERSION -g GAME_VERSION [-c CHANGELOG] [-r] JAR_FILES...
#
# Example:
#   ./deploy-mod.sh -m hyenihelper -v 1.0.1 -g 1.21.1 -c "Bug fixes" hyenihelper-neoforge.jar hyenihelper-fabric.jar
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# Variables
MOD_ID=""
VERSION=""
GAME_VERSION=""
CHANGELOG=""
REQUIRED=false
JAR_FILES=()

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mod-id)
            MOD_ID="$2"
            shift 2
            ;;
        -v|--version)
            VERSION="$2"
            shift 2
            ;;
        -g|--game-version)
            GAME_VERSION="$2"
            shift 2
            ;;
        -c|--changelog)
            CHANGELOG="$2"
            shift 2
            ;;
        -r|--required)
            REQUIRED=true
            shift
            ;;
        -h|--help)
            cat <<EOF
Usage: $0 -m MODULE_ID -v VERSION -g GAME_VERSION [-c CHANGELOG] [-r] JAR_FILES...

Options:
  -m, --mod-id         Mod ID (e.g., hyenihelper)
  -v, --version        Version number (e.g., 1.0.1)
  -g, --game-version   Minecraft version (e.g., 1.21.1)
  -c, --changelog      Changelog description (optional)
  -r, --required       Mark as required update (optional)
  -h, --help           Show this help message

Example:
  $0 -m hyenihelper -v 1.0.1 -g 1.21.1 -c "Bug fixes" \\
     hyenihelper-neoforge.jar hyenihelper-fabric.jar
EOF
            exit 0
            ;;
        *)
            JAR_FILES+=("$1")
            shift
            ;;
    esac
done

# Validate required parameters
if [ -z "$MOD_ID" ] || [ -z "$VERSION" ] || [ -z "$GAME_VERSION" ] || [ ${#JAR_FILES[@]} -eq 0 ]; then
    echo -e "${RED}Error: Missing required parameters${NC}" >&2
    echo "Run '$0 --help' for usage information" >&2
    exit 1
fi

echo -e "${CYAN}🚀 HyeniMC 모드 배포 시작${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${NC}📦 모드 ID: $MOD_ID${NC}"
echo -e "${NC}🔢 버전: $VERSION${NC}"
echo -e "${NC}🎮 게임 버전: $GAME_VERSION${NC}"
echo ""

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

# Process JAR files
declare -A LOADERS
PROCESSED_FILES=()

for JAR_PATH in "${JAR_FILES[@]}"; do
    if [ ! -f "$JAR_PATH" ]; then
        echo -e "${RED}❌ 오류: 파일을 찾을 수 없습니다: $JAR_PATH${NC}" >&2
        exit 1
    fi
    
    JAR_NAME=$(basename "$JAR_PATH")
    echo -e "${CYAN}📝 처리 중: $JAR_NAME${NC}"
    
    # Extract loader type
    LOADER_TYPE=""
    if [[ $JAR_NAME =~ -(fabric|neoforge|forge|quilt)- ]]; then
        LOADER_TYPE="${BASH_REMATCH[1]}"
    elif [[ $JAR_NAME =~ -(fabric|neoforge|forge|quilt)\.jar$ ]]; then
        LOADER_TYPE="${BASH_REMATCH[1]}"
    elif [[ $JAR_NAME =~ ^(fabric|neoforge|forge|quilt)- ]]; then
        LOADER_TYPE="${BASH_REMATCH[1]}"
    elif [[ $JAR_NAME =~ (fabric|neoforge|forge|quilt) ]]; then
        LOADER_TYPE="${BASH_REMATCH[1]}"
    else
        echo -e "${YELLOW}   ⚠️  로더 타입을 자동으로 감지할 수 없습니다.${NC}"
        echo -e "${GRAY}   📝 파일명: $JAR_NAME${NC}"
        echo -en "${CYAN}   💡 로더 타입을 입력하세요 (fabric, neoforge, forge, quilt): ${NC}"
        read -r LOADER_TYPE
        
        if [ -z "$LOADER_TYPE" ]; then
            echo -e "${RED}   ❌ 로더 타입이 필요합니다. 건너뜁니다.${NC}"
            continue
        fi
    fi
    
    LOADER_TYPE=$(echo "$LOADER_TYPE" | tr '[:upper:]' '[:lower:]')
    
    # Validate loader type
    if [[ ! "$LOADER_TYPE" =~ ^(fabric|neoforge|forge|quilt)$ ]]; then
        echo -e "${RED}   ❌ 잘못된 로더 타입: $LOADER_TYPE${NC}"
        continue
    fi
    
    echo -e "${GREEN}   ✅ 로더: $LOADER_TYPE${NC}"
    
    # Upload to R2
    R2_PATH="hyenimc-releases/mods/$MOD_ID/$VERSION/${MOD_ID}-${LOADER_TYPE}.jar"
    echo -e "${CYAN}   📤 업로드 중: $R2_PATH${NC}"
    
    if wrangler r2 object put "$R2_PATH" --remote --file "$JAR_PATH" 2>&1 | grep -q "error\|Error"; then
        echo -e "${RED}   ❌ 업로드 실패${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}   ✅ 업로드 완료${NC}"
    
    LOADERS["$LOADER_TYPE"]="${MOD_ID}-${LOADER_TYPE}.jar"
    PROCESSED_FILES+=("$JAR_NAME")
done

if [ ${#LOADERS[@]} -eq 0 ]; then
    echo -e "${RED}❌ 처리된 파일이 없습니다.${NC}"
    exit 1
fi

echo ""
echo -e "${CYAN}📝 manifest.json 생성 중...${NC}"

# Generate loaders JSON
LOADERS_JSON="{"
FIRST=true
for LOADER in "${!LOADERS[@]}"; do
    if [ "$FIRST" = false ]; then
        LOADERS_JSON+=","
    fi
    LOADERS_JSON+="\"$LOADER\":\"${LOADERS[$LOADER]}\""
    FIRST=false
done
LOADERS_JSON+="}"

# Create manifest.json
MANIFEST_PATH="$TEMP_DIR/manifest.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "version": "$VERSION",
  "gameVersions": ["$GAME_VERSION"],
  "loaders": $LOADERS_JSON,
  "changelog": "$CHANGELOG",
  "required": $REQUIRED,
  "releaseDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo -e "${GREEN}   ✅ 생성 완료${NC}"

# Upload manifest
echo -e "${CYAN}📤 manifest 업로드 중...${NC}"
MANIFEST_R2_PATH="hyenimc-releases/mods/$MOD_ID/$VERSION/manifest.json"

if ! wrangler r2 object put "$MANIFEST_R2_PATH" --remote --file "$MANIFEST_PATH" 2>&1 > /dev/null; then
    echo -e "${RED}   ❌ 실패${NC}"
    exit 1
fi

echo -e "${GREEN}   ✅ 업로드 완료${NC}"

# Update latest.json
echo ""
echo -e "${CYAN}🔄 latest.json 업데이트 중...${NC}"

LATEST_PATH="$TEMP_DIR/latest.json"
cp "$MANIFEST_PATH" "$LATEST_PATH"

LATEST_R2_PATH="hyenimc-releases/mods/$MOD_ID/latest.json"

if ! wrangler r2 object put "$LATEST_R2_PATH" --remote --file "$LATEST_PATH" 2>&1 > /dev/null; then
    echo -e "${RED}   ❌ 실패${NC}"
    exit 1
fi

echo -e "${GREEN}   ✅ 업데이트 완료${NC}"

# Get Worker URL
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_URL=$("$SCRIPT_DIR/scripts/get-worker-url.sh")

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 배포 완료!${NC}"
echo ""
echo -e "${NC}📊 배포 정보:${NC}"
echo -e "${GRAY}   • 모드: $MOD_ID${NC}"
echo -e "${GRAY}   • 버전: $VERSION${NC}"
echo -e "${GRAY}   • 로더: ${!LOADERS[@]}${NC}"
echo -e "${GRAY}   • 파일 수: $((${#LOADERS[@]} + 1)) (JAR + manifest)${NC}"
echo ""
echo -e "${NC}🔗 API 엔드포인트:${NC}"
echo -e "\033[0;34m   $WORKER_URL/api/mods/$MOD_ID/latest${NC}"
echo ""
