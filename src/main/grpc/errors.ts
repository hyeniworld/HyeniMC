export type NormalizedError = {
  code: string;
  message: string;
  details?: any;
};

// Map @grpc/grpc-js service error to a normalized form for IPC/UI
export function normalizeGrpcError(err: any, fallbackMessage?: string): NormalizedError {
  if (!err) return { code: 'UNKNOWN', message: fallbackMessage || '알 수 없는 오류가 발생했습니다.' };
  const codeNum = typeof err.code === 'number' ? err.code : undefined;
  const rawMsg = String(err.details || err.message || fallbackMessage || '요청 처리 중 오류가 발생했습니다.');
  // Basic code mapping from grpc status codes
  const codeMap: Record<number, string> = {
    3: 'INVALID_ARGUMENT',
    5: 'NOT_FOUND',
    7: 'PERMISSION_DENIED',
    9: 'FAILED_PRECONDITION',
    13: 'INTERNAL',
    14: 'UNAVAILABLE',
    12: 'UNIMPLEMENTED',
  };
  const code = codeNum != null ? (codeMap[codeNum] || `CODE_${codeNum}`) : 'UNKNOWN';

  // UX-friendly message per code
  const friendly = (() => {
    switch (code) {
      case 'INVALID_ARGUMENT':
        return '입력값이 올바르지 않습니다. 값을 확인하고 다시 시도해 주세요.';
      case 'NOT_FOUND':
        return '요청하신 항목을 찾을 수 없습니다.';
      case 'FAILED_PRECONDITION':
        return '현재 상태에서 수행할 수 없는 작업입니다.';
      case 'UNAVAILABLE':
        return '서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
      case 'UNIMPLEMENTED':
        return '아직 지원되지 않는 기능입니다.';
      case 'INTERNAL':
        return '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
      default:
        return rawMsg;
    }
  })();

  return { code, message: friendly, details: { raw: rawMsg } };
}
