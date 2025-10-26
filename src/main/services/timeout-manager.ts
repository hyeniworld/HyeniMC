/**
 * 타임아웃 유형 정의 (밀리초)
 */
export enum TimeoutType {
  BACKEND_CONNECTION = 5000,      // 백엔드 연결: 5초
  GAME_VALIDATION = 10000,        // 게임 검증: 10초
  DOWNLOAD_START = 30000,         // 다운로드 시작: 30초
  GAME_LAUNCH = 60000,            // 게임 실행: 60초
  GRPC_STREAM_HEARTBEAT = 45000,  // gRPC 스트림 하트비트: 45초
  MOD_UPDATE = 120000,            // 모드 업데이트: 2분
}

/**
 * 타임아웃 콜백
 */
type TimeoutCallback = () => void;

/**
 * 타임아웃 정보
 */
interface TimeoutInfo {
  key: string;
  type: TimeoutType;
  timeout: NodeJS.Timeout;
  callback: TimeoutCallback;
  startTime: number;
}

/**
 * 타임아웃 관리자
 * - 작업별 타임아웃 설정
 * - 자동 타임아웃 감지 및 콜백 실행
 * - 타임아웃 연장 (heartbeat용)
 * - 타임아웃 취소
 */
export class TimeoutManager {
  private activeTimeouts = new Map<string, TimeoutInfo>();

  /**
   * 타임아웃 설정
   * @param key 고유 식별자
   * @param type 타임아웃 유형
   * @param callback 타임아웃 시 실행할 콜백
   */
  set(key: string, type: TimeoutType, callback: TimeoutCallback): void {
    // 기존 타임아웃이 있으면 먼저 제거
    this.clear(key);

    const timeout = setTimeout(() => {
      console.error(`[Timeout] ${key} exceeded ${type}ms`);
      this.activeTimeouts.delete(key);
      callback();
    }, type);

    this.activeTimeouts.set(key, {
      key,
      type,
      timeout,
      callback,
      startTime: Date.now(),
    });

    // GRPC 하트비트는 로그 생략 (너무 자주 발생)
    if (type !== TimeoutType.GRPC_STREAM_HEARTBEAT) {
      console.log(`[Timeout] Set: ${key} (${type}ms)`);
    }
  }

  /**
   * 타임아웃 취소
   * @param key 고유 식별자
   */
  clear(key: string): void {
    const info = this.activeTimeouts.get(key);
    if (info) {
      clearTimeout(info.timeout);
      this.activeTimeouts.delete(key);
      
      // GRPC 하트비트는 로그 생략
      if (info.type !== TimeoutType.GRPC_STREAM_HEARTBEAT) {
        const elapsed = Date.now() - info.startTime;
        console.log(`[Timeout] Cleared: ${key} (elapsed: ${elapsed}ms)`);
      }
    }
  }

  /**
   * 타임아웃 연장 (heartbeat 수신 시 사용)
   * @param key 고유 식별자
   * @param type 타임아웃 유형
   * @param callback 타임아웃 시 실행할 콜백
   */
  extend(key: string, type: TimeoutType, callback: TimeoutCallback): void {
    const wasActive = this.activeTimeouts.has(key);
    this.set(key, type, callback);
    
    // GRPC 하트비트는 로그 생략
    if (wasActive && type !== TimeoutType.GRPC_STREAM_HEARTBEAT) {
      console.log(`[Timeout] Extended: ${key}`);
    }
  }

  /**
   * 타임아웃이 활성화되어 있는지 확인
   * @param key 고유 식별자
   */
  has(key: string): boolean {
    return this.activeTimeouts.has(key);
  }

  /**
   * 경과 시간 조회
   * @param key 고유 식별자
   * @returns 경과 시간(ms) 또는 null
   */
  getElapsed(key: string): number | null {
    const info = this.activeTimeouts.get(key);
    if (info) {
      return Date.now() - info.startTime;
    }
    return null;
  }

  /**
   * 남은 시간 조회
   * @param key 고유 식별자
   * @returns 남은 시간(ms) 또는 null
   */
  getRemaining(key: string): number | null {
    const info = this.activeTimeouts.get(key);
    if (info) {
      const elapsed = Date.now() - info.startTime;
      return Math.max(0, info.type - elapsed);
    }
    return null;
  }

  /**
   * 모든 타임아웃 취소
   */
  clearAll(): void {
    console.log(`[Timeout] Clearing all timeouts (${this.activeTimeouts.size})`);
    this.activeTimeouts.forEach(info => clearTimeout(info.timeout));
    this.activeTimeouts.clear();
  }

  /**
   * 활성 타임아웃 개수 조회
   */
  getActiveCount(): number {
    return this.activeTimeouts.size;
  }

  /**
   * 활성 타임아웃 목록 조회
   */
  getActiveKeys(): string[] {
    return Array.from(this.activeTimeouts.keys());
  }

  /**
   * 디버그 정보 출력
   */
  debug(): void {
    console.log(`[Timeout] Active timeouts: ${this.activeTimeouts.size}`);
    this.activeTimeouts.forEach((info, key) => {
      const elapsed = Date.now() - info.startTime;
      const remaining = info.type - elapsed;
      console.log(`  - ${key}: ${elapsed}ms elapsed, ${remaining}ms remaining`);
    });
  }
}

// 싱글톤 인스턴스
export const timeoutManager = new TimeoutManager();
