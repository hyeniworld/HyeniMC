import * as fs from 'fs/promises';
import * as path from 'path';

export interface CrashAnalysis {
  type: 'memory' | 'mod-conflict' | 'graphics' | 'file-corruption' | 'unknown';
  severity: 'critical' | 'high' | 'medium';
  title: string;
  message: string;
  causes: string[];
  fixes: CrashFix[];
  crashLog?: string;
}

export interface CrashFix {
  priority: number;
  title: string;
  description: string;
  automated: boolean;
  action?: string;
  metadata?: any;
}

export class CrashAnalyzer {
  
  /**
   * 최신 크래시 로그 찾기
   */
  async findLatestCrashLog(gameDir: string): Promise<string | null> {
    try {
      const crashReportsDir = path.join(gameDir, 'crash-reports');
      const files = await fs.readdir(crashReportsDir);
      
      // crash-*.txt 파일 찾기
      const crashFiles = files.filter(f => f.startsWith('crash-') && f.endsWith('.txt'));
      
      if (crashFiles.length === 0) {
        return null;
      }
      
      // 최신 파일 찾기 (파일명에 timestamp가 포함됨)
      crashFiles.sort().reverse();
      const latestCrash = path.join(crashReportsDir, crashFiles[0]);
      
      return latestCrash;
    } catch (error) {
      console.error('[CrashAnalyzer] Failed to find crash log:', error);
      return null;
    }
  }
  
  /**
   * 크래시 로그 분석
   */
  async analyzeCrashLog(crashLogPath: string): Promise<CrashAnalysis> {
    const log = await fs.readFile(crashLogPath, 'utf-8');
    
    // 1. OutOfMemoryError
    if (this.isMemoryCrash(log)) {
      return this.analyzeMemoryCrash(log);
    }
    
    // 2. ModConflict
    if (this.isModConflict(log)) {
      return this.analyzeModConflict(log);
    }
    
    // 3. Graphics Error
    if (this.isGraphicsError(log)) {
      return this.analyzeGraphicsError(log);
    }
    
    // 4. File Corruption
    if (this.isFileCorruption(log)) {
      return this.analyzeFileCorruption(log);
    }
    
    // 5. Unknown
    return this.analyzeUnknownCrash(log);
  }
  
  // ========================================
  // 패턴 감지
  // ========================================
  
  private isMemoryCrash(log: string): boolean {
    return log.includes('OutOfMemoryError') || 
           log.includes('Java heap space') ||
           log.includes('GC overhead limit');
  }
  
  private isModConflict(log: string): boolean {
    return log.includes('ModLoadingException') ||
           log.includes('NoClassDefFoundError') ||
           log.includes('ClassNotFoundException') ||
           log.includes('Duplicate');
  }
  
  private isGraphicsError(log: string): boolean {
    return log.includes('GLException') ||
           log.includes('OpenGL') ||
           log.includes('GPU') ||
           log.includes('graphics');
  }
  
  private isFileCorruption(log: string): boolean {
    return log.includes('ZipException') ||
           log.includes('invalid LOC header') ||
           log.includes('Corrupted');
  }
  
  // ========================================
  // 분석 함수들
  // ========================================
  
  private analyzeMemoryCrash(log: string): CrashAnalysis {
    const currentMemory = this.extractMemorySetting(log);
    const suggestedMemory = Math.min(Math.ceil(currentMemory * 1.5), 8192);
    
    return {
      type: 'memory',
      severity: 'high',
      title: '메모리 부족으로 게임이 종료되었습니다',
      message: `현재 ${currentMemory}MB가 할당되어 있지만 부족합니다.`,
      causes: [
        '설치된 모드가 많습니다',
        '큰 월드를 로드하고 있습니다',
        '메모리 할당량이 너무 적습니다'
      ],
      fixes: [
        {
          priority: 1,
          title: `메모리를 ${suggestedMemory}MB로 증가`,
          description: '프로필 설정에서 최대 메모리를 늘려보세요.',
          automated: false,
          action: 'increaseMemory',
          metadata: { suggested: suggestedMemory },
        },
        {
          priority: 2,
          title: '일부 모드 비활성화',
          description: '사용하지 않는 모드를 비활성화하세요.',
          automated: false,
        },
        {
          priority: 3,
          title: '백그라운드 프로그램 종료',
          description: '다른 프로그램을 종료하고 다시 시도하세요.',
          automated: false,
        }
      ],
      crashLog: log,
    };
  }
  
  private analyzeModConflict(log: string): CrashAnalysis {
    const problematicMods = this.extractProblematicMods(log);
    
    return {
      type: 'mod-conflict',
      severity: 'high',
      title: '모드 충돌로 게임이 종료되었습니다',
      message: problematicMods.length > 0
        ? `${problematicMods.join(', ')} 모드에서 문제가 발생했습니다.`
        : '모드 간 충돌이 발생했습니다.',
      causes: [
        '모드 버전이 게임 버전과 맞지 않습니다',
        '모드 간 충돌이 있습니다',
        '필수 의존성 모드가 없습니다'
      ],
      fixes: [
        {
          priority: 1,
          title: '문제 모드 비활성화',
          description: problematicMods.length > 0
            ? `${problematicMods.join(', ')} 모드를 비활성화합니다.`
            : '최근에 추가한 모드를 비활성화해보세요.',
          automated: false,
          metadata: { mods: problematicMods },
        },
        {
          priority: 2,
          title: '모드 업데이트',
          description: '최신 버전의 모드를 다운로드하세요.',
          automated: false,
        }
      ],
      crashLog: log,
    };
  }
  
  private analyzeGraphicsError(log: string): CrashAnalysis {
    return {
      type: 'graphics',
      severity: 'high',
      title: '그래픽 오류로 게임이 종료되었습니다',
      message: 'GPU 드라이버 또는 그래픽 설정에 문제가 있습니다.',
      causes: [
        'GPU 드라이버가 오래되었습니다',
        'OpenGL이 지원되지 않습니다',
        'VRAM이 부족합니다'
      ],
      fixes: [
        {
          priority: 1,
          title: 'GPU 드라이버 업데이트',
          description: '최신 그래픽 드라이버를 설치하세요.',
          automated: false,
        },
        {
          priority: 2,
          title: '그래픽 설정 낮추기',
          description: '게임 내 그래픽 설정을 낮춰보세요.',
          automated: false,
        }
      ],
      crashLog: log,
    };
  }
  
  private analyzeFileCorruption(log: string): CrashAnalysis {
    return {
      type: 'file-corruption',
      severity: 'high',
      title: '파일 손상으로 게임이 종료되었습니다',
      message: '게임 파일 또는 모드 파일이 손상되었습니다.',
      causes: [
        '다운로드 중 오류가 발생했습니다',
        '파일이 불완전합니다',
        '디스크 오류가 있습니다'
      ],
      fixes: [
        {
          priority: 1,
          title: '프로필 재생성',
          description: '프로필을 삭제하고 다시 생성해주세요.',
          automated: false,
        },
        {
          priority: 2,
          title: '모드 재다운로드',
          description: '최근에 추가한 모드를 삭제하고 다시 다운로드하세요.',
          automated: false,
        }
      ],
      crashLog: log,
    };
  }
  
  private analyzeUnknownCrash(log: string): CrashAnalysis {
    return {
      type: 'unknown',
      severity: 'medium',
      title: '알 수 없는 원인으로 게임이 종료되었습니다',
      message: '크래시 로그를 확인하여 자세한 정보를 파악하세요.',
      causes: [
        '로그 파일에서 원인을 확인하세요'
      ],
      fixes: [
        {
          priority: 1,
          title: '크래시 로그 확인',
          description: '상세 정보를 펼쳐서 로그를 확인하세요.',
          automated: false,
        },
        {
          priority: 2,
          title: '게임 재시작',
          description: '다시 시도해보세요.',
          automated: false,
        }
      ],
      crashLog: log,
    };
  }
  
  // ========================================
  // 헬퍼 함수들
  // ========================================
  
  private extractMemorySetting(log: string): number {
    // -Xmx4G 같은 패턴에서 메모리 추출
    const match = log.match(/-Xmx(\d+)([GM])/);
    if (!match) return 2048; // 기본값
    
    const value = parseInt(match[1]);
    const unit = match[2];
    return unit === 'G' ? value * 1024 : value;
  }
  
  private extractProblematicMods(log: string): string[] {
    const mods: string[] = [];
    
    // "at modname." 패턴에서 모드 이름 추출
    const modPattern = /at\s+([a-z_][a-z0-9_]*)\./gi;
    const matches = log.matchAll(modPattern);
    
    const seenMods = new Set<string>();
    for (const match of matches) {
      const modName = match[1];
      // 일반적인 Java 패키지는 제외
      if (modName !== 'java' && modName !== 'com' && modName !== 'net' && modName !== 'org') {
        if (!seenMods.has(modName)) {
          seenMods.add(modName);
          mods.push(modName);
        }
      }
    }
    
    return mods.slice(0, 3); // 상위 3개만
  }
}
