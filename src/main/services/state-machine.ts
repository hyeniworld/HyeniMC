import { BrowserWindow } from 'electron';

/**
 * 게임 실행 상태 정의
 */
export enum GameLaunchState {
  IDLE = 'idle',
  VALIDATING = 'validating',
  DOWNLOADING = 'downloading',
  PREPARING = 'preparing',
  LAUNCHING = 'launching',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error',
}

/**
 * 상태 전환 정의
 */
interface StateTransition {
  from: GameLaunchState;
  to: GameLaunchState;
  event: string;
  guard?: () => boolean;
  onTransition?: (context?: any) => Promise<void>;
}

/**
 * 상태 변경 이벤트
 */
export interface StateChangeEvent {
  profileId?: string;
  from: GameLaunchState;
  to: GameLaunchState;
  timestamp: number;
  context?: any;
}

/**
 * 게임 실행 상태 머신
 * - 명확한 상태 전환 관리
 * - 잘못된 전환 방지
 * - 상태 변경 이벤트 발행
 */
export class GameLaunchStateMachine {
  private currentState: GameLaunchState = GameLaunchState.IDLE;
  private profileId?: string;
  private transitions: StateTransition[] = [
    // 정상 플로우
    { from: GameLaunchState.IDLE, to: GameLaunchState.VALIDATING, event: 'START' },
    { from: GameLaunchState.VALIDATING, to: GameLaunchState.DOWNLOADING, event: 'VALIDATED' },
    { from: GameLaunchState.DOWNLOADING, to: GameLaunchState.PREPARING, event: 'DOWNLOADED' },
    { from: GameLaunchState.PREPARING, to: GameLaunchState.LAUNCHING, event: 'PREPARED' },
    { from: GameLaunchState.LAUNCHING, to: GameLaunchState.RUNNING, event: 'STARTED' },
    { from: GameLaunchState.RUNNING, to: GameLaunchState.STOPPING, event: 'STOP' },
    { from: GameLaunchState.STOPPING, to: GameLaunchState.STOPPED, event: 'STOPPED' },
    { from: GameLaunchState.STOPPED, to: GameLaunchState.IDLE, event: 'RESET' },
    
    // 에러 전환 (모든 작업 상태에서 가능)
    { from: GameLaunchState.VALIDATING, to: GameLaunchState.ERROR, event: 'ERROR' },
    { from: GameLaunchState.DOWNLOADING, to: GameLaunchState.ERROR, event: 'ERROR' },
    { from: GameLaunchState.PREPARING, to: GameLaunchState.ERROR, event: 'ERROR' },
    { from: GameLaunchState.LAUNCHING, to: GameLaunchState.ERROR, event: 'ERROR' },
    { from: GameLaunchState.RUNNING, to: GameLaunchState.ERROR, event: 'CRASH' },
    
    // 에러에서 복구
    { from: GameLaunchState.ERROR, to: GameLaunchState.IDLE, event: 'RESET' },
    { from: GameLaunchState.ERROR, to: GameLaunchState.VALIDATING, event: 'RETRY' },
    
    // 다운로드/준비 중 취소
    { from: GameLaunchState.VALIDATING, to: GameLaunchState.IDLE, event: 'CANCEL' },
    { from: GameLaunchState.DOWNLOADING, to: GameLaunchState.IDLE, event: 'CANCEL' },
    { from: GameLaunchState.PREPARING, to: GameLaunchState.IDLE, event: 'CANCEL' },
  ];

  constructor(profileId?: string) {
    this.profileId = profileId;
  }

  /**
   * 상태 전환 시도
   */
  async transition(event: string, context?: any): Promise<boolean> {
    const validTransition = this.transitions.find(
      t => t.from === this.currentState && t.event === event && (!t.guard || t.guard())
    );

    if (!validTransition) {
      console.error(
        `[StateMachine] Invalid transition: ${this.currentState} -[${event}]-> (no valid transition)`
      );
      return false;
    }

    const previousState = this.currentState;
    const nextState = validTransition.to;

    console.log(`[StateMachine] Transition: ${previousState} -[${event}]-> ${nextState}`);

    try {
      // 전환 콜백 실행
      if (validTransition.onTransition) {
        await validTransition.onTransition(context);
      }

      // 상태 변경
      this.currentState = nextState;

      // 이벤트 발행
      this.emitStateChange(previousState, nextState, context);

      return true;
    } catch (error) {
      console.error(`[StateMachine] Transition callback failed:`, error);
      // 콜백 실패 시 상태 변경하지 않음
      return false;
    }
  }

  /**
   * 현재 상태 조회
   */
  getState(): GameLaunchState {
    return this.currentState;
  }

  /**
   * 특정 이벤트로 전환 가능한지 확인
   */
  canTransition(event: string): boolean {
    return this.transitions.some(
      t => t.from === this.currentState && t.event === event && (!t.guard || t.guard())
    );
  }

  /**
   * 상태 초기화
   */
  reset(): void {
    const previousState = this.currentState;
    this.currentState = GameLaunchState.IDLE;
    console.log(`[StateMachine] Reset: ${previousState} -> ${GameLaunchState.IDLE}`);
    this.emitStateChange(previousState, GameLaunchState.IDLE);
  }

  /**
   * 특정 상태인지 확인
   */
  is(state: GameLaunchState): boolean {
    return this.currentState === state;
  }

  /**
   * 여러 상태 중 하나인지 확인
   */
  isOneOf(...states: GameLaunchState[]): boolean {
    return states.includes(this.currentState);
  }

  /**
   * 실행 중인지 확인 (취소/중단 불가 상태)
   */
  isRunning(): boolean {
    return this.is(GameLaunchState.RUNNING);
  }

  /**
   * 작업 중인지 확인 (실행 불가 상태)
   */
  isBusy(): boolean {
    return this.isOneOf(
      GameLaunchState.VALIDATING,
      GameLaunchState.DOWNLOADING,
      GameLaunchState.PREPARING,
      GameLaunchState.LAUNCHING,
      GameLaunchState.RUNNING,
      GameLaunchState.STOPPING
    );
  }

  /**
   * 에러 상태인지 확인
   */
  isError(): boolean {
    return this.is(GameLaunchState.ERROR);
  }

  /**
   * 상태 변경 이벤트 발행
   */
  private emitStateChange(from: GameLaunchState, to: GameLaunchState, context?: any): void {
    const event: StateChangeEvent = {
      profileId: this.profileId,
      from,
      to,
      timestamp: Date.now(),
      context,
    };

    // 모든 윈도우에 브로드캐스트
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('game:state-change', event);
    });
  }

  /**
   * 프로필 ID 설정
   */
  setProfileId(profileId: string): void {
    this.profileId = profileId;
  }
}

/**
 * 프로필별 상태 머신 관리
 */
class StateMachineManager {
  private machines = new Map<string, GameLaunchStateMachine>();

  /**
   * 프로필의 상태 머신 가져오기 (없으면 생성)
   */
  get(profileId: string): GameLaunchStateMachine {
    if (!this.machines.has(profileId)) {
      this.machines.set(profileId, new GameLaunchStateMachine(profileId));
    }
    return this.machines.get(profileId)!;
  }

  /**
   * 프로필의 상태 머신 제거
   */
  remove(profileId: string): void {
    this.machines.delete(profileId);
  }

  /**
   * 모든 상태 머신 초기화
   */
  clear(): void {
    this.machines.clear();
  }
}

// 싱글톤 인스턴스
export const stateMachineManager = new StateMachineManager();
