/**
 * User-friendly error messages for common errors
 */

export interface UserFriendlyError {
  title: string;
  message: string;
  solution?: string;
  technicalDetails?: string;
}

export class GameLaunchError extends Error {
  public readonly userFriendly: UserFriendlyError;

  constructor(userFriendly: UserFriendlyError, technicalError?: Error) {
    super(userFriendly.message);
    this.name = 'GameLaunchError';
    this.userFriendly = userFriendly;
    
    if (technicalError) {
      this.userFriendly.technicalDetails = technicalError.message;
      this.stack = technicalError.stack;
    }
  }
}

/**
 * Convert technical errors to user-friendly messages
 */
export function createUserFriendlyError(error: Error): UserFriendlyError {
  const errorMessage = error.message.toLowerCase();

  // Java not found
  if (errorMessage.includes('java') && errorMessage.includes('not found')) {
    return {
      title: 'Java를 찾을 수 없습니다',
      message: 'Minecraft를 실행하려면 Java가 필요합니다.',
      solution: 'Java를 설치하거나 Java 경로를 수동으로 설정해주세요.',
      technicalDetails: error.message,
    };
  }

  // ClassNotFoundException
  if (errorMessage.includes('classnotfoundexception')) {
    const className = error.message.match(/ClassNotFoundException: (.+)/)?.[1];
    return {
      title: '로더 파일이 손상되었습니다',
      message: `필요한 파일을 찾을 수 없습니다${className ? `: ${className}` : ''}.`,
      solution: '프로필을 삭제하고 다시 생성해주세요.',
      technicalDetails: error.message,
    };
  }

  // Module resolution error
  if (errorMessage.includes('resolutionexception') || errorMessage.includes('duplicate')) {
    return {
      title: '모듈 충돌이 발생했습니다',
      message: '로더 파일이 중복되거나 충돌하고 있습니다.',
      solution: '프로필을 삭제하고 다시 생성해주세요.',
      technicalDetails: error.message,
    };
  }

  // File not found
  if (errorMessage.includes('enoent') || errorMessage.includes('no such file')) {
    return {
      title: '파일을 찾을 수 없습니다',
      message: '필요한 파일이 누락되었습니다.',
      solution: '프로필을 다시 생성하거나 파일을 복구해주세요.',
      technicalDetails: error.message,
    };
  }

  // Permission denied
  if (errorMessage.includes('eacces') || errorMessage.includes('permission denied')) {
    return {
      title: '권한이 거부되었습니다',
      message: '파일에 접근할 수 없습니다.',
      solution: 'HyeniMC를 관리자 권한으로 실행하거나 파일 권한을 확인해주세요.',
      technicalDetails: error.message,
    };
  }

  // Network error
  if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('enotfound')) {
    return {
      title: '네트워크 연결 오류',
      message: '파일을 다운로드할 수 없습니다.',
      solution: '인터넷 연결을 확인하거나 나중에 다시 시도해주세요.',
      technicalDetails: error.message,
    };
  }

  // Insufficient memory
  if (errorMessage.includes('outofmemoryerror') || errorMessage.includes('heap')) {
    return {
      title: '메모리 부족',
      message: 'Java에 할당된 메모리가 부족합니다.',
      solution: '프로필 설정에서 메모리 할당량을 늘려주세요.',
      technicalDetails: error.message,
    };
  }

  // Default error
  return {
    title: '알 수 없는 오류가 발생했습니다',
    message: error.message || '오류가 발생했습니다.',
    solution: '다시 시도하거나 로그를 확인해주세요.',
    technicalDetails: error.message,
  };
}

/**
 * Format error for display
 */
export function formatErrorForDisplay(error: UserFriendlyError): string {
  let formatted = `❌ ${error.title}\n\n${error.message}`;
  
  if (error.solution) {
    formatted += `\n\n💡 해결 방법:\n${error.solution}`;
  }
  
  if (error.technicalDetails) {
    formatted += `\n\n🔍 상세 정보:\n${error.technicalDetails}`;
  }
  
  return formatted;
}
