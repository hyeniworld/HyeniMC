#!/bin/bash

# Microsoft Authentication Setup Script
# 이 스크립트는 auth-config.ts 파일을 생성합니다

CONFIG_DIR="src/main/services"
CONFIG_FILE="$CONFIG_DIR/auth-config.ts"
EXAMPLE_FILE="$CONFIG_DIR/auth-config.example.ts"

echo "🔐 Microsoft 인증 설정"
echo ""

# Check if auth-config.ts already exists
if [ -f "$CONFIG_FILE" ]; then
  echo "⚠️  auth-config.ts 파일이 이미 존재합니다."
  read -p "덮어쓰시겠습니까? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 취소되었습니다."
    exit 0
  fi
fi

# Copy example file
if [ ! -f "$EXAMPLE_FILE" ]; then
  echo "❌ auth-config.example.ts 파일을 찾을 수 없습니다."
  exit 1
fi

cp "$EXAMPLE_FILE" "$CONFIG_FILE"
echo "✅ auth-config.ts 파일이 생성되었습니다."
echo ""

# Prompt for Client ID
echo "📝 Azure Portal에서 복사한 Client ID를 입력하세요:"
echo "   (나중에 수정: $CONFIG_FILE)"
read -p "Client ID: " CLIENT_ID

if [ -n "$CLIENT_ID" ]; then
  # Replace placeholder with actual Client ID
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/YOUR_CLIENT_ID_HERE/$CLIENT_ID/" "$CONFIG_FILE"
  else
    # Linux
    sed -i "s/YOUR_CLIENT_ID_HERE/$CLIENT_ID/" "$CONFIG_FILE"
  fi
  echo "✅ Client ID가 설정되었습니다!"
else
  echo "⚠️  Client ID를 입력하지 않았습니다."
  echo "   $CONFIG_FILE 파일을 수동으로 수정해주세요."
fi

echo ""
echo "🎉 설정 완료!"
echo ""
echo "다음 단계:"
echo "1. npm run dev 로 개발 서버 실행"
echo "2. 헤더에서 'Microsoft 로그인' 테스트"
