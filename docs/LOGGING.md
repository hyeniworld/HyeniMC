# HyeniMC 로깅 시스템

## 개요
HyeniMC는 `electron-log`를 사용하여 모든 stdout/stderr 출력을 로그 파일에 저장합니다.

## 로그 파일 위치

### Windows
```
%USERPROFILE%\AppData\Roaming\HyeniMC\logs\main.log
```

### macOS
```
~/Library/Logs/HyeniMC/main.log
```

### 개발 모드
```
프로젝트_루트/logs/main.log
```

## 로그 설정

### 파일 크기 및 로테이션
- 최대 파일 크기: 10MB
- 파일이 최대 크기에 도달하면 자동으로 로테이션됩니다
- 이전 로그는 `main.old.log` 형식으로 저장됩니다

### 로그 레벨
- **파일**: info 레벨 이상 (info, warn, error)
- **콘솔**: debug 레벨 이상 (모든 로그)

### 로그 포맷
```
[YYYY-MM-DD HH:mm:ss.ms] [LEVEL] 메시지
```

## 로그 내용

### 애플리케이션 시작
- 앱 버전
- 실행 모드 (Development/Production)
- 플랫폼 정보
- Electron 및 Node.js 버전
- 로그 파일 경로

### 주요 이벤트
- 백엔드 서버 시작/종료
- 게임 실행/종료 (메타 정보만, 게임 출력은 제외)
- 모드/모드팩 설치
- 자바 감지 및 설정
- 업데이트 확인 및 다운로드
- 오류 및 예외

### 백엔드 프로세스 로그
백엔드 Go 프로세스의 모든 stdout/stderr도 자동으로 캡처되어 로그에 포함됩니다.

### 제외되는 로그
다음 로그는 UI에만 표시되고 파일에는 저장되지 않습니다:
- **마인크래프트 게임 프로세스 출력**: 게임 실행 중 마인크래프트가 출력하는 로그는 UI에만 표시됩니다. 게임 시작/종료/크래시 같은 메타 정보만 파일에 기록됩니다.

## IPC 핸들러

프론트엔드에서 로그 파일에 접근할 수 있는 IPC 핸들러:

### `launcher:get-log-path`
로그 파일의 전체 경로를 반환합니다.

```typescript
const result = await ipcRenderer.invoke('launcher:get-log-path');
console.log(result.path); // 로그 파일 경로
```

### `launcher:open-log-folder`
탐색기/Finder에서 로그 폴더를 엽니다.

```typescript
await ipcRenderer.invoke('launcher:open-log-folder');
```

## 트러블슈팅

### 로그가 기록되지 않는 경우
1. 로그 폴더에 쓰기 권한이 있는지 확인
2. 디스크 공간이 충분한지 확인
3. 개발 모드에서는 프로젝트 루트의 `logs` 폴더 확인

### 로그 파일이 너무 큰 경우
로그 파일은 10MB에 도달하면 자동으로 로테이션되므로, 수동으로 삭제하거나 이전 로그 파일(`*.old.log`)을 삭제할 수 있습니다.

## 디버깅 팁

릴리즈 후 사용자로부터 로그를 받으려면:
1. 사용자에게 `launcher:open-log-folder` 호출하는 UI 제공
2. 로그 파일(`main.log`)을 받아서 분석
3. 타임스탬프를 기준으로 문제 발생 시점의 로그 확인
