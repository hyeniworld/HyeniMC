/**
 * Microsoft Authentication Configuration
 * 
 * 사용 방법:
 * 1. 이 파일을 auth-config.ts로 복사:
 *    cp auth-config.example.ts auth-config.ts
 * 
 * 2. Azure Portal에서 앱 등록 후 Client ID를 아래에 입력
 * 
 * 3. auth-config.ts는 .gitignore에 포함되어 있어 Git에 커밋되지 않습니다
 */

export const AUTH_CONFIG = {
  // Azure Portal에서 복사한 Client ID를 여기에 입력
  AZURE_CLIENT_ID: 'YOUR_CLIENT_ID_HERE',
  
  // 리디렉션 URI - Azure Portal에도 이 주소를 등록해야 합니다!
  REDIRECT_URI: 'http://localhost:53682/callback',
};
