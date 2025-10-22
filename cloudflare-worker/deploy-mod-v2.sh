#!/usr/bin/env bash
#
# HyeniMC Mod Deployment Script v2.0
#
# Usage:
#   ./deploy-mod-v2.sh --config deploy-config.json
#

set -e

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux"* ]]; then
    OS="linux"
else
    OS="unknown"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m'

# Parse arguments
CONFIG_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        -h|--help)
            cat <<EOF
Usage: $0 --config CONFIG_FILE

Options:
  --config FILE    Path to configuration JSON file
  -h, --help       Show this help message

Example:
  $0 --config deploy-config.json
EOF
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}" >&2
            exit 1
            ;;
    esac
done

# Validate
if [ -z "$CONFIG_FILE" ]; then
    echo -e "${RED}Error: --config is required${NC}" >&2
    exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Error: Config file not found: $CONFIG_FILE${NC}" >&2
    exit 1
fi

# Check jq
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed${NC}" >&2
    echo "Install: brew install jq" >&2
    exit 1
fi

echo -e "${CYAN}🚀 HyeniMC 모드 배포 v2.0${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Parse config
MOD_ID=$(jq -r '.modId' "$CONFIG_FILE")
MOD_NAME=$(jq -r '.name' "$CONFIG_FILE")
VERSION=$(jq -r '.version' "$CONFIG_FILE")
CATEGORY=$(jq -r '.category' "$CONFIG_FILE")
CHANGELOG=$(jq -r '.changelog' "$CONFIG_FILE")
RELEASE_DATE=$(jq -r '.releaseDate // empty' "$CONFIG_FILE")

echo -e "${NC}📦 모드: $MOD_NAME ($MOD_ID)${NC}"
echo -e "${NC}🔢 버전: $VERSION${NC}"
echo -e "${NC}🏷️  카테고리: $CATEGORY${NC}"
echo ""

# Use current date if not specified
if [ -z "$RELEASE_DATE" ] || [ "$RELEASE_DATE" = "null" ]; then
    if [[ "$OS" == "macos" ]]; then
        RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    else
        RELEASE_DATE=$(date -u --iso-8601=seconds | sed 's/+00:00/Z/')
    fi
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

# Process files
FILE_COUNT=$(jq '.files | length' "$CONFIG_FILE")
echo -e "${CYAN}📁 처리할 파일: $FILE_COUNT 개${NC}"
echo ""

# Upload each file
for ((i=0; i<$FILE_COUNT; i++)); do
    LOADER=$(jq -r ".files[$i].loader" "$CONFIG_FILE")
    GAME_VERSION=$(jq -r ".files[$i].gameVersion" "$CONFIG_FILE")
    FILE_PATH=$(jq -r ".files[$i].file" "$CONFIG_FILE")
    
    if [ ! -f "$FILE_PATH" ]; then
        echo -e "${RED}❌ 파일 없음: $FILE_PATH${NC}"
        exit 1
    fi
    
    FILE_NAME=$(basename "$FILE_PATH")
    
    echo -e "${CYAN}[$((i+1))/$FILE_COUNT] $LOADER / MC $GAME_VERSION${NC}"
    echo -e "${GRAY}   파일: $FILE_NAME${NC}"
    
    # Calculate SHA256
    if command -v sha256sum &> /dev/null; then
        SHA256=$(sha256sum "$FILE_PATH" | awk '{print $1}')
    else
        SHA256=$(shasum -a 256 "$FILE_PATH" | awk '{print $1}')
    fi
    
    # Get file size
    if [[ "$OS" == "macos" ]]; then
        FILE_SIZE=$(stat -f%z "$FILE_PATH")
    else
        FILE_SIZE=$(stat -c%s "$FILE_PATH")
    fi
    
    echo -e "${GRAY}   SHA256: ${SHA256:0:16}...${NC}"
    echo -e "${GRAY}   크기: $((FILE_SIZE / 1024)) KB${NC}"
    
    # Upload to R2
    R2_PATH="hyenimc-releases/mods/$MOD_ID/versions/$VERSION/$LOADER/$GAME_VERSION/$FILE_NAME"
    echo -e "${CYAN}   📤 업로드: $R2_PATH${NC}"
    
    if ! wrangler r2 object put "$R2_PATH" --remote --file "$FILE_PATH" 2>&1 > /dev/null; then
        echo -e "${RED}   ❌ 업로드 실패${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}   ✅ 완료${NC}"
    echo ""
done

echo -e "${CYAN}📝 manifest.json 생성 중...${NC}"

# Build loaders object
LOADERS_JSON="{"
FIRST_LOADER=true

# Group files by loader
for LOADER_TYPE in $(jq -r '.files[].loader' "$CONFIG_FILE" | sort -u); do
    if [ "$FIRST_LOADER" = false ]; then
        LOADERS_JSON+=","
    fi
    
    LOADERS_JSON+="\"$LOADER_TYPE\":{\"gameVersions\":{"
    
    FIRST_GAME_VERSION=true
    
    # Find all game versions for this loader
    for ((i=0; i<$FILE_COUNT; i++)); do
        LOADER=$(jq -r ".files[$i].loader" "$CONFIG_FILE")
        
        if [ "$LOADER" != "$LOADER_TYPE" ]; then
            continue
        fi
        
        if [ "$FIRST_GAME_VERSION" = false ]; then
            LOADERS_JSON+=","
        fi
        
        GAME_VERSION=$(jq -r ".files[$i].gameVersion" "$CONFIG_FILE")
        FILE_PATH=$(jq -r ".files[$i].file" "$CONFIG_FILE")
        FILE_NAME=$(basename "$FILE_PATH")
        MIN_LOADER=$(jq -r ".files[$i].minLoaderVersion" "$CONFIG_FILE")
        MAX_LOADER=$(jq -r ".files[$i].maxLoaderVersion // null" "$CONFIG_FILE")
        
        # Calculate SHA256 and size again
        if command -v sha256sum &> /dev/null; then
            SHA256=$(sha256sum "$FILE_PATH" | awk '{print $1}')
        else
            SHA256=$(shasum -a 256 "$FILE_PATH" | awk '{print $1}')
        fi
        if [[ "$OS" == "macos" ]]; then
            FILE_SIZE=$(stat -f%z "$FILE_PATH")
        else
            FILE_SIZE=$(stat -c%s "$FILE_PATH")
        fi
        
        # Get dependencies
        DEPS=$(jq -c ".files[$i].dependencies" "$CONFIG_FILE")
        
        DOWNLOAD_PATH="mods/$MOD_ID/versions/$VERSION/$LOADER/$GAME_VERSION/$FILE_NAME"
        
        LOADERS_JSON+="\"$GAME_VERSION\":{"
        LOADERS_JSON+="\"file\":\"$FILE_NAME\","
        LOADERS_JSON+="\"sha256\":\"$SHA256\","
        LOADERS_JSON+="\"size\":$FILE_SIZE,"
        LOADERS_JSON+="\"minLoaderVersion\":\"$MIN_LOADER\","
        LOADERS_JSON+="\"maxLoaderVersion\":$MAX_LOADER,"
        LOADERS_JSON+="\"downloadPath\":\"$DOWNLOAD_PATH\","
        LOADERS_JSON+="\"dependencies\":$DEPS"
        LOADERS_JSON+="}"
        
        FIRST_GAME_VERSION=false
    done
    
    LOADERS_JSON+="}}"
    FIRST_LOADER=false
done

LOADERS_JSON+="}"

# Get all unique game versions
GAME_VERSIONS_JSON=$(jq -c '[.files[].gameVersion] | unique' "$CONFIG_FILE")

# Create manifest.json
MANIFEST_PATH="$TEMP_DIR/manifest.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "modId": "$MOD_ID",
  "name": "$MOD_NAME",
  "version": "$VERSION",
  "releaseDate": "$RELEASE_DATE",
  "changelog": "$CHANGELOG",
  "gameVersions": $GAME_VERSIONS_JSON,
  "loaders": $LOADERS_JSON,
  "category": "$CATEGORY"
}
EOF

echo -e "${GREEN}   ✅ 생성 완료${NC}"

# Upload manifest
echo -e "${CYAN}📤 manifest 업로드 중...${NC}"
MANIFEST_R2_PATH="hyenimc-releases/mods/$MOD_ID/versions/$VERSION/manifest.json"

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
WORKER_URL=$("$SCRIPT_DIR/scripts/get-worker-url.sh" 2>/dev/null)

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 배포 완료!${NC}"
echo ""
echo -e "${NC}📊 배포 정보:${NC}"
echo -e "${GRAY}   • 모드: $MOD_NAME ($MOD_ID)${NC}"
echo -e "${GRAY}   • 버전: $VERSION${NC}"
echo -e "${GRAY}   • 카테고리: $CATEGORY${NC}"
echo -e "${GRAY}   • 파일 수: $FILE_COUNT${NC}"
echo ""
echo -e "${NC}🔗 API 엔드포인트 (v2):${NC}"
echo -e "\033[0;34m   $WORKER_URL/api/v2/mods/$MOD_ID/latest${NC}"
echo ""
echo -e "${YELLOW}💡 다음 단계: registry 업데이트${NC}"
echo -e "${GRAY}   ./update-registry-v2.sh $MOD_ID${NC}"
echo ""
