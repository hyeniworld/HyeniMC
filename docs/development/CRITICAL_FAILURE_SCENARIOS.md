# 크리티컬 장애 시나리오 분석

> **작성일**: 2025-10-17  
> **상태**: 추가 분석 (ERROR_RECOVERY_PLAN.md 보완)  
> **대상**: 마인크래프트 런처 특화 장애 시나리오

---

## 📋 개요

마인크래프트 런처의 특성상 발생할 수 있는 추가 장애:
- 🎮 게임 실행 관련 장애
- 📥 게임 파일 다운로드 장애
- 🔧 Java/JVM 관련 장애
- 🌐 네트워크 관련 장애
- 💾 저장소 관련 장애
- 🔐 인증 관련 장애

---

## 🎮 카테고리 1: 게임 실행 장애

### 1-1. 게임 실행 실패 (시작 전)

**증상**: `Failed to launch game`, `Process exited with code 1`

**원인**:
- Java 설치 안 됨 / 버전 불일치
- JVM 메모리 할당 실패
- 게임 파일 손상 (체크섬 불일치)
- 모드 충돌 / 의존성 누락
- 권한 문제

**복구 가능성**:
```
✅ Java 문제 → 자동 감지 + 버전 선택 UI
✅ 메모리 부족 → 자동 감지 + 메모리 조정 제안
✅ 파일 손상 → 자동 감지 + 재다운로드
✅ 모드 충돌 → 자동 감지 + 모드 비활성화 제안
⚠️ 권한 문제 → 수동 개입 필요
```

**구현 전략**:
```typescript
class GameLaunchValidator {
  async validateBeforeLaunch(profile: Profile): Promise<ValidationResult> {
    const checks = {
      java: await this.checkJavaInstallation(),
      javaVersion: await this.checkJavaVersion(profile.javaVersion),
      memory: await this.checkAvailableMemory(profile.memoryMax),
      gameFiles: await this.validateGameFiles(profile),
      mods: await this.validateModCompatibility(profile),
    };
    
    return {
      canLaunch: Object.values(checks).every(c => c.valid),
      issues: Object.entries(checks)
        .filter(([_, check]) => !check.valid)
        .map(([name, check]) => ({
          component: name,
          severity: check.severity,
          message: check.message,
          autoRecoverable: check.autoRecoverable,
          suggestedAction: check.suggestedAction,
        })),
    };
  }
}
```

---

### 1-2. 게임 크래시 (실행 중)

**증상**: `Game crashed`, `Exit code: 1`, `crash-YYYY-MM-DD_HH-MM-SS.txt`

**원인**:
- 메모리 부족 (OutOfMemoryError)
- 모드 충돌 (런타임)
- 그래픽 드라이버 문제
- 시스템 리소스 부족
- 게임 파일 손상

**복구 가능성**:
```
✅ 메모리 부족 → 자동 감지 + 메모리 증가 제안
✅ 모드 충돌 → 크래시 분석 + 모드 비활성화 제안
⚠️ 그래픽 문제 → 드라이버 업데이트 안내
⚠️ 시스템 리소스 → 백그라운드 프로세스 종료 안내
```

**구현 전략**:
```typescript
class CrashAnalyzer {
  async analyzeCrash(crashLogPath: string): Promise<CrashAnalysis> {
    const log = await fs.readFile(crashLogPath, 'utf-8');
    
    if (log.includes('OutOfMemoryError')) {
      return this.analyzeMemoryCrash(log);
    }
    if (log.includes('ModConflictException')) {
      return this.analyzeModConflict(log);
    }
    if (log.includes('GLException')) {
      return this.analyzeGraphicsError(log);
    }
    
    return this.analyzeUnknownCrash(log);
  }
  
  async suggestRecovery(analysis: CrashAnalysis): Promise<RecoveryOption[]> {
    const options: RecoveryOption[] = [];
    
    if (analysis.type === 'memory') {
      options.push({
        title: '메모리 증가',
        action: async () => await this.increaseMemory(),
      });
    }
    
    if (analysis.type === 'mod-conflict') {
      options.push({
        title: '충돌 모드 비활성화',
        action: async () => await this.disableProblematicMods(analysis.mods),
      });
    }
    
    return options;
  }
}

class GameProcessMonitor {
  async monitorGameProcess(processId: number): Promise<void> {
    const monitor = setInterval(async () => {
      const stats = await this.getProcessStats(processId);
      
      if (stats.memoryUsage > stats.memoryLimit * 0.9) {
        this.notifyUser('메모리 사용량이 높습니다. 게임이 종료될 수 있습니다.');
      }
      
      if (stats.cpuUsage > 95) {
        this.notifyUser('CPU 사용량이 높습니다. 백그라운드 앱을 종료해보세요.');
      }
    }, 5000);
  }
}
```

---

### 1-3. 게임 무한 로딩

**증상**: `Initializing game...` → 30분 이상 진행 없음

**원인**:
- 월드 손상 (청크 데이터)
- 모드 로딩 실패 / 순환 의존성
- 네트워크 문제 (멀티플레이)
- 디스크 I/O 병목
- 메모리 부족 (스왑 메모리 사용)

**복구 가능성**:
```
✅ 월드 손상 → 백업에서 복구
✅ 모드 문제 → 모드 비활성화 후 재시도
⚠️ 네트워크 → 연결 확인 후 재시도
⚠️ 디스크 문제 → 디스크 검사 안내
```

**구현 전략**:
```typescript
class GameLoadingMonitor {
  async monitorGameLoading(processId: number, timeoutSeconds: number = 300) {
    let lastLogTime = Date.now();
    let lastLogContent = '';
    
    const checkInterval = setInterval(async () => {
      const currentLog = await this.readGameLog();
      const elapsed = (Date.now() - lastLogTime) / 1000;
      
      if (currentLog === lastLogContent && elapsed > timeoutSeconds) {
        clearInterval(checkInterval);
        await this.handleLoadingTimeout(currentLog);
      }
      
      if (currentLog !== lastLogContent) {
        lastLogTime = Date.now();
        lastLogContent = currentLog;
      }
    }, 5000);
  }
  
  async handleLoadingTimeout(lastLog: string): Promise<void> {
    const suggestions: RecoveryOption[] = [];
    
    if (lastLog.includes('Corrupted')) {
      suggestions.push({
        title: '월드 복구',
        action: async () => await this.restoreWorldFromBackup(),
      });
    }
    
    if (lastLog.includes('Mod')) {
      suggestions.push({
        title: '모드 비활성화',
        action: async () => {
          await this.disableAllMods();
          await this.restartGame();
        },
      });
    }
    
    this.showLoadingTimeoutDialog(suggestions);
  }
}
```

---

## 📥 카테고리 2: 게임 파일 다운로드 장애

### 2-1. 다운로드 실패

**증상**: `Download failed`, `Connection timeout`, `404 Not Found`

**원인**:
- 네트워크 연결 끊김
- 다운로드 서버 다운 / 파일 삭제
- 저장소 부족
- 파일 손상 (체크섬 불일치)

**복구 가능성**:
```
✅ 네트워크 → 자동 재시도 + 대체 서버
✅ 서버 문제 → 대체 미러 서버 사용
✅ 저장소 부족 → 자동 감지 + 정리 제안
✅ 파일 손상 → 자동 재다운로드
```

**구현 전략**:
```typescript
class GameFileDownloader {
  async downloadWithRetry(
    fileUrl: string,
    destination: string,
    maxRetries: number = 3
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.validateStorageSpace(destination);
        await this.download(fileUrl, destination);
        await this.validateChecksum(destination);
        return;
      } catch (error) {
        if (error instanceof StorageError) {
          await this.suggestStorageCleanup();
          throw error;
        }
        
        if (error instanceof ChecksumError && attempt < maxRetries) {
          await fs.unlink(destination);
          await this.delay(1000 * attempt);
          continue;
        }
        
        if (attempt === maxRetries) throw error;
        await this.delay(1000 * attempt);
      }
    }
  }
  
  async downloadWithMirror(
    fileUrl: string,
    mirrors: string[],
    destination: string
  ): Promise<void> {
    const urls = [fileUrl, ...mirrors];
    
    for (const url of urls) {
      try {
        await this.downloadWithRetry(url, destination, 2);
        return;
      } catch (error) {
        logger.warn(`Mirror ${url} failed, trying next...`);
      }
    }
    
    throw new DownloadFailedError('All mirrors failed');
  }
}
```

### 2-2. 다운로드 중단

**증상**: `Downloaded: 45% (2.3GB / 5.1GB)` → 멈춤

**원인**: 네트워크 끊김, 사용자 일시 중지, 서버 문제

**복구 가능성**: ✅ 모두 복구 가능 (재개 기능)

**구현 전략**:
```typescript
class ResumableDownloader {
  async downloadWithResume(fileUrl: string, destination: string) {
    const partialPath = destination + '.partial';
    const downloaded = (await fs.exists(partialPath)) 
      ? (await fs.stat(partialPath)).size 
      : 0;
    
    try {
      await this.download(fileUrl, destination, { start: downloaded });
    } catch (error) {
      if (error instanceof NetworkError) {
        throw new PausedDownloadError('Download paused. Resume available.');
      }
      throw error;
    }
  }
  
  async resumeDownload(fileUrl: string): Promise<void> {
    // 이전 상태에서 재개
  }
}
```

---

## 🔧 카테고리 3: Java/JVM 관련 장애

### 3-1. Java 설치 안 됨

**증상**: `java: command not found`

**원인**: Java 미설치, PATH 설정 안 됨, 제거됨

**복구 가능성**: ✅ 자동 감지 + 설치 안내 / 번들 Java 제공

**구현 전략**:
```typescript
class JavaManager {
  async findJavaInstallations(): Promise<JavaInstallation[]> {
    const installations: JavaInstallation[] = [];
    
    // 1. PATH에서 찾기
    const pathJava = await this.findInPath();
    if (pathJava) installations.push(pathJava);
    
    // 2. 일반 설치 위치에서 찾기
    const commonLocations = [
      '/usr/lib/jvm',
      '/Library/Java/JavaVirtualMachines',
      'C:\\Program Files\\Java',
    ];
    
    for (const location of commonLocations) {
      installations.push(...await this.findInDirectory(location));
    }
    
    return installations;
  }
  
  async suggestJavaInstallation(): Promise<JavaInstallationGuide> {
    return {
      downloadUrl: this.getJavaDownloadUrl(process.platform),
      installationSteps: this.getInstallationSteps(process.platform),
      bundledJavaAvailable: true,
      bundledJavaUrl: 'https://...',
    };
  }
}
```

### 3-2. JVM 메모리 부족

**증상**: `java.lang.OutOfMemoryError: Java heap space`

**원인**: 메모리 설정 낮음, 시스템 메모리 부족, 메모리 누수

**복구 가능성**: ✅ 메모리 증가, 모드 비활성화, 시스템 정리

---

## 🌐 카테고리 4: 네트워크 관련 장애

### 4-1. 인터넷 연결 끊김

**증상**: `Connection timeout`, `Network unreachable`

**원인**: WiFi 끊김, 인터넷 불안정, 방화벽 차단

**복구 가능성**: ✅ 자동 감지 + 재연결 안내, 오프라인 모드

### 4-2. 멀티플레이 연결 실패

**증상**: `Failed to connect to server`, `Connection refused`

**원인**: 서버 다운, 서버 주소 오류, 포트 차단

**복구 가능성**: ⚠️ 서버 상태 확인 필요, 포트 포워딩 설정 필요

---

## 💾 카테고리 5: 저장소 관련 장애

### 5-1. 디스크 공간 부족

**증상**: `No space left on device`, `Failed to save world`

**원인**: 저장소 가득 참, 임시 파일 누적

**복구 가능성**: ✅ 자동 감지 + 정리 제안

**구현 전략**:
```typescript
class StorageManager {
  async checkStorageSpace(): Promise<StorageStatus> {
    const available = await this.getAvailableSpace();
    const required = 50 * 1024 * 1024 * 1024;  // 50GB
    
    if (available < required) {
      return {
        status: 'critical',
        available,
        required,
        suggestions: await this.suggestCleanup(),
      };
    }
    
    return { status: 'ok', available };
  }
  
  async suggestCleanup(): Promise<CleanupSuggestion[]> {
    return [
      {
        type: 'cache',
        size: await this.calculateCacheSize(),
        action: async () => await this.clearCache(),
      },
      {
        type: 'old-versions',
        size: await this.calculateOldVersionsSize(),
        action: async () => await this.removeOldVersions(),
      },
      {
        type: 'crash-logs',
        size: await this.calculateCrashLogsSize(),
        action: async () => await this.removeCrashLogs(),
      },
    ];
  }
}
```

---

## 🔐 카테고리 6: 인증 관련 장애

### 6-1. Microsoft 계정 로그인 실패

**증상**: `Authentication failed`, `Invalid credentials`

**원인**: 네트워크 문제, 계정 정보 오류, 토큰 만료

**복구 가능성**: ✅ 자동 감지 + 재로그인 안내

### 6-2. 토큰 만료

**증상**: `Token expired`, `Unauthorized`

**원인**: 토큰 유효 기간 만료

**복구 가능성**: ✅ 자동 갱신 또는 재로그인

---

## 📊 크리티컬 장애 우선순위 매트릭스

| 장애 | 발생 확률 | 심각도 | 복구 가능 | 우선순위 |
|------|---------|--------|---------|---------|
| 게임 실행 실패 | 높음 | 🔴 높음 | ✅ | 🔴 P0 |
| 게임 크래시 | 높음 | 🔴 높음 | ✅ | 🔴 P0 |
| 무한 로딩 | 중간 | 🟡 중간 | ✅ | 🟡 P1 |
| 다운로드 실패 | 높음 | 🟡 중간 | ✅ | 🟡 P1 |
| Java 문제 | 중간 | 🔴 높음 | ✅ | 🔴 P0 |
| 메모리 부족 | 높음 | 🟡 중간 | ✅ | 🟡 P1 |
| 네트워크 끊김 | 중간 | 🟡 중간 | ✅ | 🟡 P1 |
| 저장소 부족 | 중간 | 🟡 중간 | ✅ | 🟡 P1 |
| 인증 실패 | 낮음 | 🔴 높음 | ✅ | 🔴 P0 |

---

## 🎯 구현 로드맵

### Phase 1: 게임 실행 안정성 (1주)
- [ ] 게임 실행 전 검증
- [ ] 크래시 분석 및 제안
- [ ] 무한 로딩 감지 및 복구

### Phase 2: 다운로드 안정성 (1주)
- [ ] 재시도 로직
- [ ] 미러 서버 지원
- [ ] 재개 기능

### Phase 3: 시스템 리소스 관리 (1주)
- [ ] Java 자동 감지
- [ ] 메모리 모니터링
- [ ] 저장소 관리

### Phase 4: 네트워크 복구력 (1주)
- [ ] 연결 상태 모니터링
- [ ] 자동 재연결
- [ ] 오프라인 모드

---

## 💡 결론

**현재 상황**: 게임 실행 관련 장애 대응 거의 없음

**개선 후**: 
- 대부분의 장애 자동 감지 및 복구
- 사용자에게 명확한 안내 제공
- 게임 안정성 대폭 향상

**투자 대비 효과**: 4주 개발 → 사용자 만족도 크게 향상
