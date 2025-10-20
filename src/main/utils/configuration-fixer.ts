import { ValidationIssue } from '../services/game-launch-validator';
import { detectJavaInstallations } from '../services/java-detector';

/**
 * 설정 오류 자동 수정
 */
export class ConfigurationFixer {
  
  /**
   * 검증 이슈를 자동으로 수정 시도
   */
  async tryAutoFix(issue: ValidationIssue, profile: any): Promise<{ fixed: boolean; newValue?: any }> {
    console.log(`[ConfigFixer] Attempting to fix: ${issue.component}`);
    
    switch (issue.action) {
      case 'fixJavaVersion':
        return await this.fixJavaVersion(profile, issue.metadata);
      
      case 'fixDangerousMemory':
        return await this.fixDangerousMemory(profile, issue.metadata);
      
      case 'reduceMinMemory':
        return await this.reduceMinMemory(profile, issue.metadata);
      
      case 'reduceMaxMemory':
        return await this.reduceMaxMemory(profile, issue.metadata);
      
      case 'adjustMemory':
        return await this.adjustMemory(profile, issue.metadata);
      
      case 'resetJavaPath':
        return await this.resetJavaPath(profile);
      
      default:
        console.log(`[ConfigFixer] No auto-fix available for: ${issue.action}`);
        return { fixed: false };
    }
  }
  
  /**
   * Java 버전 자동 수정
   */
  private async fixJavaVersion(profile: any, metadata: any): Promise<{ fixed: boolean; newValue?: any }> {
    if (!metadata.suggested) {
      console.log('[ConfigFixer] No suggested Java found');
      return { fixed: false };
    }
    
    console.log(`[ConfigFixer] Fixing Java: ${metadata.current} → ${metadata.suggested.majorVersion}`);
    
    return {
      fixed: true,
      newValue: {
        javaPath: metadata.suggested.path,
      },
    };
  }
  
  /**
   * 위험한 메모리 설정 수정
   */
  private async fixDangerousMemory(profile: any, metadata: any): Promise<{ fixed: boolean; newValue?: any }> {
    console.log(`[ConfigFixer] Fixing dangerous memory: ${metadata.current}MB → Min:${metadata.suggested.min}MB / Max:${metadata.suggested.max}MB`);
    
    return {
      fixed: true,
      newValue: {
        memory: metadata.suggested,
      },
    };
  }
  
  /**
   * 최소 메모리 감소
   */
  private async reduceMinMemory(profile: any, metadata: any): Promise<{ fixed: boolean; newValue?: any }> {
    console.log(`[ConfigFixer] Reducing min memory: ${metadata.current}MB → ${metadata.suggested}MB`);
    
    return {
      fixed: true,
      newValue: {
        memory: {
          min: metadata.suggested,
          max: profile.memory?.max || 2048,
        },
      },
    };
  }
  
  /**
   * 최대 메모리 감소
   */
  private async reduceMaxMemory(profile: any, metadata: any): Promise<{ fixed: boolean; newValue?: any }> {
    console.log(`[ConfigFixer] Reducing max memory: ${metadata.current}MB → ${metadata.suggested}MB`);
    
    return {
      fixed: true,
      newValue: {
        memory: {
          min: profile.memory?.min || 512,
          max: metadata.suggested,
        },
      },
    };
  }
  
  /**
   * 메모리 조정
   */
  private async adjustMemory(profile: any, metadata: any): Promise<{ fixed: boolean; newValue?: any }> {
    console.log(`[ConfigFixer] Adjusting memory to: ${metadata.suggestedMemory}MB`);
    
    return {
      fixed: true,
      newValue: {
        memory: {
          min: Math.floor(metadata.suggestedMemory * 0.5),
          max: metadata.suggestedMemory,
        },
      },
    };
  }
  
  /**
   * Java 경로 초기화 (자동 선택)
   */
  private async resetJavaPath(profile: any): Promise<{ fixed: boolean; newValue?: any }> {
    console.log('[ConfigFixer] Resetting Java path to auto-select');
    
    // 자동 선택 모드로 변경
    return {
      fixed: true,
      newValue: {
        javaPath: '', // 빈 문자열 = 자동 선택
      },
    };
  }
}
