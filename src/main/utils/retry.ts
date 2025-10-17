/**
 * 재시도 옵션
 */
export interface RetryOptions {
  /** 최대 시도 횟수 */
  maxAttempts: number;
  /** 초기 대기 시간 (ms) */
  delayMs: number;
  /** 백오프 배수 */
  backoffMultiplier: number;
  /** 최대 대기 시간 (ms) */
  maxDelayMs: number;
  /** 재시도 가능한 에러인지 판단하는 함수 */
  retryableErrors?: (error: Error) => boolean;
  /** 재시도 시 실행할 콜백 */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  /** 재시도 전 실행할 콜백 (cleanup 등) */
  beforeRetry?: (attempt: number) => Promise<void>;
}

/**
 * 기본 재시도 옵션
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  retryableErrors: (error) => {
    const message = error.message.toLowerCase();
    // 네트워크 에러는 재시도 가능
    return (
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('enetunreach') ||
      message.includes('enotfound') ||
      message.includes('network') ||
      message.includes('fetch failed') ||
      message.includes('timeout')
    );
  },
};

/**
 * 재시도 로직을 포함한 함수 실행
 * @param fn 실행할 함수
 * @param options 재시도 옵션
 * @returns 함수 실행 결과
 * @throws 최대 시도 횟수 초과 시 마지막 에러
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error;
  let delay = opts.delayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // 재시도 불가능한 에러면 즉시 throw
      if (opts.retryableErrors && !opts.retryableErrors(lastError)) {
        console.error(`[Retry] Non-retryable error:`, lastError.message);
        throw lastError;
      }

      // 마지막 시도였으면 throw
      if (attempt === opts.maxAttempts) {
        console.error(
          `[Retry] Max attempts (${opts.maxAttempts}) reached, giving up:`,
          lastError.message
        );
        throw lastError;
      }

      // 재시도 콜백 실행
      if (opts.onRetry) {
        opts.onRetry(attempt, lastError, delay);
      }

      console.warn(
        `[Retry] Attempt ${attempt}/${opts.maxAttempts} failed: ${lastError.message}`
      );
      console.log(`[Retry] Waiting ${delay}ms before retry...`);

      // 대기
      await new Promise(resolve => setTimeout(resolve, delay));

      // cleanup 콜백 실행
      if (opts.beforeRetry) {
        try {
          await opts.beforeRetry(attempt + 1);
        } catch (cleanupError) {
          console.warn('[Retry] Cleanup failed:', cleanupError);
        }
      }

      // 지수 백오프
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError!;
}

/**
 * 조건이 참이 될 때까지 재시도
 * @param condition 확인할 조건 함수
 * @param options 재시도 옵션
 * @returns 조건이 참이 되면 true
 * @throws 최대 시도 횟수 초과 시 에러
 */
export async function retryUntil(
  condition: () => Promise<boolean>,
  options: Partial<RetryOptions> = {}
): Promise<boolean> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let delay = opts.delayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await condition();
      if (result) {
        return true;
      }

      if (attempt === opts.maxAttempts) {
        throw new Error(`Condition not met after ${opts.maxAttempts} attempts`);
      }

      console.log(
        `[RetryUntil] Attempt ${attempt}/${opts.maxAttempts} - condition false, waiting ${delay}ms`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    } catch (error) {
      console.error(`[RetryUntil] Error in condition check:`, error);
      throw error;
    }
  }

  throw new Error(`Condition not met after ${opts.maxAttempts} attempts`);
}

/**
 * 여러 함수를 순차적으로 재시도
 * @param fns 실행할 함수 배열
 * @param options 재시도 옵션
 * @returns 모든 함수 실행 결과 배열
 */
export async function retryAll<T>(
  fns: Array<() => Promise<T>>,
  options: Partial<RetryOptions> = {}
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < fns.length; i++) {
    try {
      const result = await retry(fns[i], options);
      results.push(result);
    } catch (error) {
      console.error(`[RetryAll] Failed at index ${i}:`, error);
      throw error;
    }
  }

  return results;
}

/**
 * 여러 함수를 병렬로 재시도
 * @param fns 실행할 함수 배열
 * @param options 재시도 옵션
 * @returns 모든 함수 실행 결과 배열
 */
export async function retryAllParallel<T>(
  fns: Array<() => Promise<T>>,
  options: Partial<RetryOptions> = {}
): Promise<T[]> {
  const promises = fns.map(fn => retry(fn, options));
  return Promise.all(promises);
}
