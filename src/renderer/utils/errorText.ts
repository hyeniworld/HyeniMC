/**
 * 에러 객체에서 사용자용 메시지 추출.
 *
 * Tauri invoke는 실패 시 에러를 **문자열**로 reject하므로 `err instanceof Error`가
 * false가 되어 실제 사유가 유실된다(=generic 메시지). 문자열 케이스를 명시적으로 처리.
 */
export function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === 'string') return err || fallback;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}
