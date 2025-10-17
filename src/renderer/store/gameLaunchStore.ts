import create from 'zustand';

/**
 * 게임 실행 상태
 */
export type GameLaunchState = 
  | 'idle' 
  | 'validating' 
  | 'downloading' 
  | 'preparing' 
  | 'launching' 
  | 'running' 
  | 'stopping' 
  | 'stopped' 
  | 'error';

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
 * 게임 실행 상태 스토어
 */
interface GameLaunchStore {
  // 상태
  profileId?: string;
  state: GameLaunchState;
  error?: string;
  
  // 상태 설정
  setState: (state: GameLaunchState, profileId?: string, error?: string) => void;
  
  // 상태 확인
  canLaunch: () => boolean;
  canStop: () => boolean;
  canRetry: () => boolean;
  canCancel: () => boolean;
  isBusy: () => boolean;
  
  // 액션
  reset: () => void;
  handleStateChange: (event: StateChangeEvent) => void;
}

export const useGameLaunchStore = create<GameLaunchStore>((set, get) => ({
  state: 'idle',
  
  setState: (state, profileId, error) => set({ state, profileId, error }),
  
  canLaunch: () => {
    const { state } = get();
    return state === 'idle' || state === 'stopped';
  },
  
  canStop: () => {
    const { state } = get();
    return state === 'running';
  },
  
  canRetry: () => {
    const { state } = get();
    return state === 'error';
  },
  
  canCancel: () => {
    const { state } = get();
    return state === 'validating' || state === 'downloading' || state === 'preparing';
  },
  
  isBusy: () => {
    const { state } = get();
    return state !== 'idle' && state !== 'stopped' && state !== 'error';
  },
  
  reset: () => set({ state: 'idle', error: undefined, profileId: undefined }),
  
  handleStateChange: (event) => {
    set({ 
      state: event.to,
      profileId: event.profileId,
      error: event.context?.message || event.context?.error,
    });
    
    // 에러 상태가 아니면 에러 메시지 제거
    if (event.to !== 'error') {
      set({ error: undefined });
    }
  },
}));
