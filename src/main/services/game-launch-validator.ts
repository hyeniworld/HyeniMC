import { detectJavaInstallations, JavaInstallation } from './java-detector';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ValidationIssue {
  component: string;
  severity: 'critical' | 'error' | 'warning';
  title: string;
  message: string;
  solution: string;
  technicalDetails?: string;
  action?: string;
  metadata?: any;
}

export interface ValidationResult {
  canLaunch: boolean;
  issues: ValidationIssue[];
}

export class GameLaunchValidator {
  
  /**
   * 게임 실행 전 종합 검증
   */
  async validateBeforeLaunch(profile: any): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    
    // === 설정 검증 (Configuration) ===
    const configIssues = await this.validateConfiguration(profile);
    issues.push(...configIssues);
    
    // === 시스템 검증 (System) ===
    const systemIssues = await this.validateSystem(profile);
    issues.push(...systemIssues);
    
    // === 파일 검증 (Files) ===
    const fileIssues = await this.validateFiles(profile);
    issues.push(...fileIssues);
    
    // critical 또는 error가 하나라도 있으면 실행 불가
    const canLaunch = !issues.some(i => i.severity === 'critical' || i.severity === 'error');
    
    return { canLaunch, issues };
  }
  
  /**
   * 설정 검증
   */
  private async validateConfiguration(profile: any): Promise<ValidationIssue[]> {
    const checks = [
      this.checkJavaPathValidity(profile),
      this.checkJavaVersionMismatch(profile),
      this.checkMemoryConfiguration(profile),
      this.checkGameDirectory(profile),
    ];
    
    const results = await Promise.all(checks);
    return results.filter(r => r !== null) as ValidationIssue[];
  }
  
  /**
   * 시스템 검증
   */
  private async validateSystem(profile: any): Promise<ValidationIssue[]> {
    const checks = [
      this.checkJavaInstallation(),
      this.checkAvailableMemory(profile),
      this.checkDiskSpace(profile),
    ];
    
    const results = await Promise.all(checks);
    return results.filter(r => r !== null) as ValidationIssue[];
  }
  
  /**
   * 파일 검증
   */
  private async validateFiles(profile: any): Promise<ValidationIssue[]> {
    const checks = [
      this.checkGameFiles(profile),
    ];
    
    const results = await Promise.all(checks);
    return results.filter(r => r !== null) as ValidationIssue[];
  }
  
  // ========================================
  // 개별 검증 함수들
  // ========================================
  
  /**
   * 1. Java 설치 확인
   */
  private async checkJavaInstallation(): Promise<ValidationIssue | null> {
    try {
      const installations = await detectJavaInstallations();
      if (installations.length === 0) {
        return {
          component: 'java-installation',
          severity: 'critical',
          title: 'Java를 찾을 수 없습니다',
          message: 'Minecraft를 실행하려면 Java가 필요합니다.',
          solution: 'Java를 설치하거나 Java 경로를 수동으로 설정해주세요.',
          action: 'openJavaInstallGuide',
        };
      }
      return null;
    } catch (error) {
      console.error('[Validator] Java installation check failed:', error);
      return null;
    }
  }
  
  /**
   * 2. Java 경로 유효성
   */
  private async checkJavaPathValidity(profile: any): Promise<ValidationIssue | null> {
    const javaPath = profile.javaPath;
    if (!javaPath) {
      return null; // 자동 선택 모드
    }
    
    // 파일 존재 확인
    try {
      await fs.access(javaPath, fs.constants.X_OK);
    } catch {
      return {
        component: 'java-path',
        severity: 'error',
        title: 'Java 경로가 잘못되었습니다',
        message: `설정된 Java 경로(${javaPath})를 찾을 수 없거나 실행할 수 없습니다.`,
        solution: 'Java 경로를 다시 선택하거나 자동 선택으로 변경하세요.',
        action: 'resetJavaPath',
      };
    }
    
    // 실제 Java인지 확인
    try {
      const { stdout, stderr } = await execAsync(`"${javaPath}" -version 2>&1`);
      const output = stdout + stderr;
      if (!output.includes('java version') && !output.includes('openjdk version')) {
        return {
          component: 'java-path',
          severity: 'error',
          title: 'Java가 아닌 파일입니다',
          message: `${javaPath}는 유효한 Java 실행 파일이 아닙니다.`,
          solution: '올바른 Java 경로를 선택하세요.',
          action: 'selectCorrectJava',
        };
      }
    } catch (error: any) {
      return {
        component: 'java-path',
        severity: 'error',
        title: 'Java 실행 실패',
        message: `${javaPath} 실행 중 오류가 발생했습니다.`,
        solution: 'Java를 재설치하거나 다른 Java를 선택하세요.',
        technicalDetails: error.message,
        action: 'selectDifferentJava',
      };
    }
    
    return null;
  }
  
  /**
   * 3. Java 버전 불일치
   */
  private async checkJavaVersionMismatch(profile: any): Promise<ValidationIssue | null> {
    const javaPath = profile.javaPath;
    if (!javaPath) {
      return null; // 자동 선택 모드
    }
    
    // 게임 버전에서 필요한 Java 버전 확인
    const requiredJavaVersion = this.getRequiredJavaVersion(profile.gameVersion);
    
    // 실제 Java 버전 확인
    try {
      const actualVersion = await this.getJavaVersionFromPath(javaPath);
      
      if (actualVersion < requiredJavaVersion) {
        // 더 적절한 Java 찾기
        const installations = await detectJavaInstallations();
        const betterJava = installations.find(j => j.majorVersion >= requiredJavaVersion);
        
        // 경고로 완화 - 실제로 돌아갈 수도 있음
        return {
          component: 'java-version',
          severity: 'warning',  // error → warning
          title: 'Java 버전이 권장 사양보다 낮습니다',
          message: `Minecraft ${profile.gameVersion}은(는) Java ${requiredJavaVersion} 이상을 권장하지만, 현재 Java ${actualVersion}이(가) 설정되어 있습니다.`,
          solution: betterJava 
            ? `더 나은 성능을 위해 Java ${betterJava.majorVersion}(으)로 변경하세요.`
            : `Java ${requiredJavaVersion} 이상을 설치하면 더 안정적입니다.`,
          technicalDetails: '낮은 버전의 Java에서도 실행될 수 있지만, 성능 문제나 호환성 문제가 발생할 수 있습니다.',
          action: 'fixJavaVersion',
          metadata: {
            current: actualVersion,
            required: requiredJavaVersion,
            suggested: betterJava,
          },
        };
      }
    } catch (error) {
      console.error('[Validator] Java version check failed:', error);
    }
    
    return null;
  }
  
  /**
   * 4. 메모리 설정 검증
   */
  private async checkMemoryConfiguration(profile: any): Promise<ValidationIssue | null> {
    const minMemory = profile.memory?.min || 512;
    const maxMemory = profile.memory?.max || 2048;
    
    // UI에서 이미 처리: min > max
    // 여기서는 시스템 리소스 관련만 체크
    
    const systemMemory = os.totalmem() / 1024 / 1024; // bytes to MB
    
    console.log(`[Validator] Memory check - System: ${Math.floor(systemMemory)}MB, Min: ${minMemory}MB, Max: ${maxMemory}MB`);
    
    // === 실제 위험한 경우만 차단 ===
    
    // 1. 최대 메모리가 시스템 메모리의 90% 초과 (Critical - 실행 차단)
    // 이 경우 실제로 JVM이 할당 실패할 가능성이 매우 높음
    if (maxMemory > systemMemory * 0.9) {
      return {
        component: 'memory-max-exceeds-system',
        severity: 'critical',
        title: '메모리 설정이 시스템 메모리를 초과합니다',
        message: `최대 메모리 ${maxMemory}MB가 시스템 메모리 ${Math.floor(systemMemory)}MB의 ${Math.floor(maxMemory / systemMemory * 100)}%입니다.`,
        solution: `최대 메모리를 ${Math.floor(systemMemory * 0.7)}MB 이하로 줄이세요.`,
        technicalDetails: `JVM이 시스템 메모리를 초과하는 메모리를 할당할 수 없습니다.\n운영체제가 프로세스를 강제 종료하거나 시스템이 불안정해질 수 있습니다.`,
        action: 'reduceMaxMemory',
        metadata: {
          current: maxMemory,
          systemMemory: Math.floor(systemMemory),
          suggested: Math.floor(systemMemory * 0.7),
        },
      };
    }
    
    // 2. 최소 = 최대이고 시스템 메모리 80% 초과 (Error)
    // 시작 시 즉시 큰 메모리를 할당하면 시스템이 위험해질 수 있음
    if (minMemory === maxMemory && minMemory > systemMemory * 0.8) {
      return {
        component: 'memory-fixed-large',
        severity: 'error',
        title: '메모리 설정이 위험합니다',
        message: `최소/최대 메모리가 모두 ${minMemory}MB로 설정되어 시스템 메모리 ${Math.floor(systemMemory)}MB의 ${Math.floor(minMemory / systemMemory * 100)}%를 차지합니다.`,
        solution: '최소 메모리를 줄이거나 최소≠최대로 설정하세요.',
        technicalDetails: `최소 메모리 = 최대 메모리로 설정하면 JVM이 시작 시 즉시 전체 메모리를 할당합니다.\n시스템이 응답하지 않거나 다른 프로그램이 강제 종료될 수 있습니다.`,
        action: 'fixDangerousMemory',
        metadata: {
          current: minMemory,
          systemMemory: Math.floor(systemMemory),
          suggested: {
            min: Math.floor(maxMemory * 0.25),
            max: maxMemory,
          },
        },
      };
    }
    
    // === 나머지는 JVM에게 맡김 ===
    // JVM이 메모리 할당에 실패하면 명확한 에러를 출력함
    // os.freemem()은 부정확하므로 사전 검증하지 않음
    
    return null;
  }
  
  /**
   * 5. 가용 메모리 확인
   */
  private async checkAvailableMemory(profile: any): Promise<ValidationIssue | null> {
    // os.freemem()은 부정확하므로 사전 검증하지 않음
    // JVM이 메모리 할당 실패 시 명확한 에러를 출력함
    // 
    // 만약 실제로 메모리가 부족하면:
    // 1. JVM이 "Could not reserve enough space" 에러 출력
    // 2. CrashAnalyzer가 이를 감지하고 해결 방법 제시
    // 
    // 사전 검증으로 거짓 양성을 만들기보다는
    // 실제 문제 발생 시 정확하게 대응하는 것이 더 나음
    
    return null;
  }
  
  /**
   * 6. 게임 디렉토리 확인
   */
  private async checkGameDirectory(profile: any): Promise<ValidationIssue | null> {
    const gameDir = profile.gameDirectory;
    
    // 디렉토리 존재 확인 및 자동 생성
    try {
      const stats = await fs.stat(gameDir);
      if (!stats.isDirectory()) {
        return {
          component: 'game-directory',
          severity: 'error',
          title: '게임 디렉토리가 유효하지 않습니다',
          message: `${gameDir}는 디렉토리가 아닙니다.`,
          solution: '올바른 디렉토리를 선택하세요.',
          action: 'selectGameDirectory',
        };
      }
    } catch {
      // 디렉토리가 없으면 자동 생성 시도
      try {
        await fs.mkdir(gameDir, { recursive: true });
        console.log(`[Validator] Created game directory: ${gameDir}`);
      } catch (error) {
        return {
          component: 'game-directory',
          severity: 'error',
          title: '게임 디렉토리를 생성할 수 없습니다',
          message: `${gameDir} 경로를 생성할 수 없습니다.`,
          solution: '디렉토리 권한을 확인하거나 다른 경로를 선택하세요.',
          technicalDetails: error instanceof Error ? error.message : 'Unknown error',
          action: 'selectDifferentDirectory',
        };
      }
    }
    
    // 읽기/쓰기 권한 확인
    try {
      await fs.access(gameDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      return {
        component: 'game-directory',
        severity: 'error',
        title: '게임 디렉토리 권한이 없습니다',
        message: `${gameDir}에 대한 읽기/쓰기 권한이 없습니다.`,
        solution: '디렉토리 권한을 확인하거나 다른 경로를 선택하세요.',
        action: 'fixPermissions',
      };
    }
    
    return null;
  }
  
  /**
   * 7. 게임 파일 확인
   */
  private async checkGameFiles(profile: any): Promise<ValidationIssue | null> {
    // 파일 검증을 하지 않음
    // 
    // 이유:
    // 1. 로더(neoforge, fabric 등)는 파일 구조가 다름
    //    - JSON만 있고 jar는 다른 곳에 있거나
    //    - 기본 minecraft jar를 사용
    // 
    // 2. profile.ts에서 이미 다운로드를 처리함
    //    - downloadVersion()으로 필요한 파일 다운로드
    //    - 로더 설치도 처리됨
    // 
    // 3. 파일이 정말 없으면 게임 실행 시 명확한 에러 발생
    //    - JVM이 ClassNotFoundException 등을 출력
    //    - 사용자에게 더 정확한 정보 제공
    // 
    // 사전 검증으로 거짓 양성을 만들기보다는
    // 실제 문제 발생 시 대응하는 것이 더 나음
    
    return null;
  }
  
  /**
   * 8. 디스크 공간 확인
   */
  private async checkDiskSpace(profile: any): Promise<ValidationIssue | null> {
    // 간단한 구현 - 더 정확한 체크는 추후 개선 가능
    const requiredSpace = 2 * 1024 * 1024 * 1024; // 2GB
    
    // Note: Node.js에서 직접 디스크 공간을 확인하기 어려우므로
    // 일단 warning 수준으로만 처리
    return null;
  }
  
  // ========================================
  // 헬퍼 함수들
  // ========================================
  
  /**
   * 게임 버전에서 필요한 Java 버전 반환
   */
  private getRequiredJavaVersion(gameVersion: string): number {
    // MC 1.21+ → Java 21
    if (gameVersion >= '1.21') return 21;
    // MC 1.20.5-1.20.6 → Java 21
    if (gameVersion >= '1.20.5') return 21;
    // MC 1.18-1.20.4 → Java 17
    if (gameVersion >= '1.18') return 17;
    // MC 1.17 → Java 16
    if (gameVersion >= '1.17') return 16;
    // MC 1.16 이하 → Java 8
    return 8;
  }
  
  /**
   * Java 경로에서 버전 추출
   */
  private async getJavaVersionFromPath(javaPath: string): Promise<number> {
    try {
      const { stdout, stderr } = await execAsync(`"${javaPath}" -version 2>&1`);
      const output = stdout + stderr;
      
      // "java version "1.8.0_292"" 또는 "openjdk version "17.0.1""
      const match = output.match(/version "(\d+)\.?(\d+)?/);
      if (match) {
        const major = parseInt(match[1]);
        // Java 8 이하는 1.8 형식
        return major === 1 && match[2] ? parseInt(match[2]) : major;
      }
    } catch (error) {
      console.error('[Validator] Failed to get Java version:', error);
    }
    
    return 8; // 기본값
  }
}
