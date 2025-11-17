/**
 * 타임아웃 매니저
 * 
 * 전역 타임아웃 및 stuck 상태 감지
 */

export interface TimeoutConfig {
  globalTimeoutMs: number;
  stuckThresholdMs: number;
}

export class TimeoutManager {
  private readonly config: TimeoutConfig;
  private startTime: number = 0;
  private lastProgressTime: number = 0;
  private isActive: boolean = false;

  constructor(config: TimeoutConfig) {
    this.config = config;
  }

  /**
   * 타임아웃 추적 시작
   */
  start() {
    this.startTime = Date.now();
    this.lastProgressTime = Date.now();
    this.isActive = true;
  }

  /**
   * 진행 상태 업데이트
   */
  updateProgress() {
    if (this.isActive) {
      this.lastProgressTime = Date.now();
    }
  }

  /**
   * 전역 타임아웃 초과 여부
   */
  isGlobalTimeout(): boolean {
    if (!this.isActive) return false;
    return Date.now() - this.startTime > this.config.globalTimeoutMs;
  }

  /**
   * Stuck 상태 (일정 시간 진행 없음)
   */
  isStuck(): boolean {
    if (!this.isActive) return false;
    return Date.now() - this.lastProgressTime > this.config.stuckThresholdMs;
  }

  /**
   * 남은 시간 (밀리초)
   */
  getRemainingTime(): number {
    if (!this.isActive) return this.config.globalTimeoutMs;
    return Math.max(0, this.config.globalTimeoutMs - (Date.now() - this.startTime));
  }

  /**
   * 경과 시간 (밀리초)
   */
  getElapsedTime(): number {
    if (!this.isActive) return 0;
    return Date.now() - this.startTime;
  }

  /**
   * 타임아웃 추적 중지
   */
  stop() {
    this.isActive = false;
  }

  /**
   * 타임아웃 상태 리셋
   */
  reset() {
    this.stop();
    this.start();
  }
}

/**
 * Promise에 타임아웃 추가
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
