/**
 * 재시도 매니저
 * 
 * exponential backoff를 사용한 재시도 로직 제공
 */

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  onRetry?: (attempt: number, error: any) => void;
}

export class RetryManager {
  private readonly DEFAULT_OPTIONS: RetryOptions = {
    maxRetries: 3,
    initialDelayMs: 2000,
    maxDelayMs: 30000,
  };

  /**
   * exponential backoff를 사용한 재시도
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    context: string,
    options?: Partial<RetryOptions>
  ): Promise<T> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    let lastError: any;

    for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt < opts.maxRetries - 1) {
          const delay = Math.min(
            opts.initialDelayMs * Math.pow(2, attempt),
            opts.maxDelayMs
          );
          
          console.log(
            `[RetryManager] ${context} failed (attempt ${attempt + 1}/${opts.maxRetries}), ` +
            `retrying in ${delay}ms...`
          );
          
          opts.onRetry?.(attempt + 1, error);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const retryManager = new RetryManager();
