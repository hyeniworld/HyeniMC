/**
 * 앱 설정 관련 타입 정의
 */

export interface AppConfig {
  // 일반 설정
  language: string;
  theme: 'light' | 'dark' | 'system';
  
  // 경로 설정
  dataDirectory: string;
  defaultGameDirectory: string;
  
  // Java 설정
  autoDetectJava: boolean;
  javaExecutables: JavaInstallation[];
  
  // 다운로드 설정
  maxConcurrentDownloads: number;
  downloadThreads: number;
  
  // 모드 업데이트 설정
  autoCheckUpdates: boolean;
  autoUpdateRequired: boolean;
  updateCheckInterval: number;
  
  // 네트워크 설정
  useProxy: boolean;
  proxyHost?: string;
  proxyPort?: number;
  
  // 고급 설정
  keepLauncherOpen: boolean;
  showConsole: boolean;
  enableAnalytics: boolean;
  
  // 추후 추가
  hyeniAuthEnabled?: boolean;
  spaEnabled?: boolean;
}

export interface JavaInstallation {
  path: string;
  version: string;
  architecture: 'x64' | 'arm64';
  vendor: string;
  isDefault: boolean;
}
