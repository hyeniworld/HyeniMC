/**
 * 실패 분류 및 처리 유틸리티
 */

import type { HyeniPackImportResult } from '../../shared/types/hyenipack';

export enum FailureType {
  FATAL = 'fatal',           // ZIP 손상, manifest 오류 등 → 프로필 삭제
  PARTIAL = 'partial',       // 일부 모드 실패 → 프로필 유지 + 경고
  TIMEOUT = 'timeout',       // 타임아웃 → 재시도 옵션
  CANCELLED = 'cancelled',   // 사용자 취소 → 프로필 삭제
}

export interface ImportFailure {
  type: FailureType;
  message: string;
  recoverable: boolean;
  canRetry: boolean;
  shouldDeleteProfile: boolean;
}

/**
 * 실패 유형 분류
 */
export function classifyFailure(
  error: any,
  result?: Partial<HyeniPackImportResult>
): ImportFailure {
  // ZIP 파싱 실패
  if (error.message?.includes('Invalid hyenipack') || 
      error.message?.includes('ZIP') ||
      error.message?.includes('missing hyenipack.json')) {
    return {
      type: FailureType.FATAL,
      message: 'ZIP 파일이 손상되었거나 유효하지 않습니다',
      recoverable: false,
      canRetry: false,
      shouldDeleteProfile: true,
    };
  }
  
  // 타임아웃
  if (error.message?.includes('timeout') || 
      error.message?.includes('시간 초과') ||
      error.message?.includes('stuck')) {
    return {
      type: FailureType.TIMEOUT,
      message: '설치 시간이 초과되었습니다. 네트워크 연결을 확인하세요.',
      recoverable: true,
      canRetry: true,
      shouldDeleteProfile: false,
    };
  }
  
  // 사용자 취소
  if (error.message?.includes('cancelled') || error.message?.includes('취소')) {
    return {
      type: FailureType.CANCELLED,
      message: '사용자가 설치를 취소했습니다',
      recoverable: false,
      canRetry: false,
      shouldDeleteProfile: true,
    };
  }
  
  // 부분 성공
  if (result?.partialSuccess) {
    return {
      type: FailureType.PARTIAL,
      message: `${result.failedMods?.length || 0}개 모드 설치 실패`,
      recoverable: true,
      canRetry: true,
      shouldDeleteProfile: false,
    };
  }
  
  // 기타 치명적 실패
  return {
    type: FailureType.FATAL,
    message: error.message || '알 수 없는 오류가 발생했습니다',
    recoverable: false,
    canRetry: false,
    shouldDeleteProfile: true,
  };
}
