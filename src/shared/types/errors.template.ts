/**
 * Error Types for HyeniMC
 * 
 * 사용자 친화적인 에러 처리를 위한 타입 정의
 */

// ============================================================================
// User-Friendly Error
// ============================================================================

/**
 * 사용자에게 표시될 에러 정보
 */
export interface UserFriendlyError {
  /** 에러 제목 (예: "Java를 찾을 수 없습니다") */
  title: string;
  
  /** 상세 메시지 */
  message: string;
  
  /** 기술적 상세 정보 (선택적, details 섹션에 표시) */
  details?: string;
  
  /** 해결 방법 제안 목록 */
  suggestions?: string[];
  
  /** 사용자가 수행할 수 있는 액션들 */
  actions: ErrorAction[];
  
  /** 에러 심각도 */
  severity: ErrorSeverity;
  
  /** 모달을 닫을 수 있는지 여부 */
  canClose: boolean;
  
  /** 자동 재시도 카운트다운 (초 단위, 선택적) */
  autoRetryIn?: number;
}

/**
 * 에러 액션 (버튼)
 */
export interface ErrorAction {
  /** 버튼 텍스트 */
  label: string;
  
  /** 액션 타입 */
  type: 'retry' | 'cancel' | 'configure' | 'external' | 'report';
  
  /** 주요 액션인지 여부 (primary 버튼 스타일) */
  isPrimary?: boolean;
  
  /** 액션 핸들러 (옵션) */
  handler?: () => void | Promise<void>;
  
  /** 외부 링크 URL (type이 'external'일 때) */
  externalUrl?: string;
}

/**
 * 에러 심각도
 */
export enum ErrorSeverity {
  /** 정보성 메시지 */
  INFO = 'info',
  
  /** 경고 (작업 계속 가능) */
  WARNING = 'warning',
  
  /** 에러 (작업 실패, 복구 가능) */
  ERROR = 'error',
  
  /** 치명적 에러 (복구 불가) */
  FATAL = 'fatal',
}

// ============================================================================
// Error Categories
// ============================================================================

/**
 * 에러 카테고리
 */
export enum ErrorCategory {
  NETWORK = 'network',
  JAVA = 'java',
  DOWNLOAD = 'download',
  STORAGE = 'storage',
  PERMISSION = 'permission',
  MOD = 'mod',
  LOADER = 'loader',
  AUTH = 'auth',
  UNKNOWN = 'unknown',
}

/**
 * 에러 코드
 */
export enum ErrorCode {
  // Network
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  NETWORK_DISCONNECTED = 'NETWORK_DISCONNECTED',
  NETWORK_DNS_FAILED = 'NETWORK_DNS_FAILED',
  
  // Java
  JAVA_NOT_FOUND = 'JAVA_NOT_FOUND',
  JAVA_VERSION_MISMATCH = 'JAVA_VERSION_MISMATCH',
  JAVA_MEMORY_ERROR = 'JAVA_MEMORY_ERROR',
  
  // Download
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  FILE_CORRUPTED = 'FILE_CORRUPTED',
  
  // Storage
  DISK_FULL = 'DISK_FULL',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PATH_TOO_LONG = 'PATH_TOO_LONG',
  
  // Mod
  MOD_UPDATE_FAILED = 'MOD_UPDATE_FAILED',
  MOD_AUTH_REQUIRED = 'MOD_AUTH_REQUIRED',
  MOD_INCOMPATIBLE = 'MOD_INCOMPATIBLE',
  
  // Loader
  LOADER_INSTALL_FAILED = 'LOADER_INSTALL_FAILED',
  LOADER_VERSION_NOT_FOUND = 'LOADER_VERSION_NOT_FOUND',
  
  // Auth
  AUTH_FAILED = 'AUTH_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // Unknown
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// ============================================================================
// Error Context
// ============================================================================

/**
 * 에러 발생 컨텍스트
 */
export interface ErrorContext {
  /** 컴포넌트 이름 */
  component: string;
  
  /** 수행 중이던 작업 */
  operation: string;
  
  /** 프로필 ID (선택적) */
  profileId?: string;
  
  /** 프로필 이름 (선택적) */
  profileName?: string;
  
  /** 게임 버전 (선택적) */
  gameVersion?: string;
  
  /** 로더 타입 (선택적) */
  loaderType?: string;
  
  /** 추가 정보 */
  additionalInfo?: Record<string, any>;
}

// ============================================================================
// Examples (주석으로 사용 예시)
// ============================================================================

/**
 * 사용 예시 1: Java 에러
 * 
 * const javaError: UserFriendlyError = {
 *   title: 'Java를 찾을 수 없습니다',
 *   message: '마인크래프트를 실행하려면 Java 17 이상이 필요합니다.',
 *   suggestions: [
 *     'Java 17 이상을 설치하세요',
 *     '설치 후 런처를 재시작하세요'
 *   ],
 *   actions: [
 *     {
 *       label: 'Java 다운로드',
 *       type: 'external',
 *       isPrimary: true,
 *       externalUrl: 'https://adoptium.net/temurin/releases/?version=17'
 *     },
 *     {
 *       label: '취소',
 *       type: 'cancel'
 *     }
 *   ],
 *   severity: ErrorSeverity.ERROR,
 *   canClose: true
 * };
 */

/**
 * 사용 예시 2: 네트워크 에러 (자동 재시도)
 * 
 * const networkError: UserFriendlyError = {
 *   title: '네트워크 연결 오류',
 *   message: '인터넷 연결을 확인할 수 없습니다.',
 *   suggestions: [
 *     '인터넷 연결 상태를 확인하세요',
 *     'Wi-Fi 또는 이더넷 케이블을 확인하세요'
 *   ],
 *   actions: [
 *     {
 *       label: '재시도',
 *       type: 'retry',
 *       isPrimary: true
 *     },
 *     {
 *       label: '취소',
 *       type: 'cancel'
 *     }
 *   ],
 *   severity: ErrorSeverity.ERROR,
 *   canClose: true,
 *   autoRetryIn: 5  // 5초 후 자동 재시도
 * };
 */
