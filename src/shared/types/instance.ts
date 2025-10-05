/**
 * 게임 인스턴스 관련 타입 정의
 */

export type InstanceStatus = 'preparing' | 'launching' | 'running' | 'stopped' | 'crashed';

export interface GameInstance {
  profileId: string;
  processId?: number;
  
  status: InstanceStatus;
  
  startedAt: Date;
  stoppedAt?: Date;
  
  logs: GameLog[];
  
  crashReport?: string;
  exitCode?: number;
}

export interface GameLog {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}

export interface LaunchOptions {
  username?: string;
  uuid?: string;
  accessToken?: string;
  userType?: string;
  
  customJavaPath?: string;
  customJvmArgs?: string[];
  customGameArgs?: string[];
  
  serverAddress?: string;
  serverPort?: number;
  
  // 추후 추가
  hyeniAuth?: {
    token: string;
    refreshToken: string;
  };
  spaPacket?: string;
}
