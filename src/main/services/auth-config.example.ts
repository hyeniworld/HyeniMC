/**
 * Microsoft Authentication Configuration (Example/Reference)
 * 
 * ⚠️ NOTE: This file is now AUTO-GENERATED from .env
 * 
 * 설정 방법:
 * 1. 프로젝트 루트의 .env.example을 .env로 복사
 * 2. .env 파일에 AZURE_CLIENT_ID 값 입력
 * 3. npm run generate:config 실행 (또는 npm run dev/build 시 자동 실행)
 * 4. auth-config.ts가 자동으로 생성됨
 * 
 * Azure Portal 설정:
 * 1. https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
 * 2. 새 등록 또는 기존 앱 선택
 * 3. 인증 → 플랫폼 추가 → 모바일 및 데스크톱 애플리케이션
 * 4. 리디렉션 URI 추가: http://localhost:53682/callback
 * 5. 개요에서 애플리케이션(클라이언트) ID 복사 → .env 파일에 입력
 */

export const AUTH_CONFIG = {
  // Azure Portal에서 복사한 Client ID (auto-generated from .env)
  AZURE_CLIENT_ID: 'YOUR_CLIENT_ID_HERE',
  
  // 리디렉션 URI - Azure Portal에도 이 주소를 등록해야 합니다!
  REDIRECT_URI: 'http://localhost:53682/callback',
};
