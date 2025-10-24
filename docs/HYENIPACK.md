# 혜니팩 (HyeniPack)

HyeniMC 런처 전용 로컬 모드팩 시스템입니다.

## 📦 개요

혜니팩은 API 서버 없이 로컬 파일 기반으로 동작하는 모드팩 형식으로, 다음과 같은 특징이 있습니다:

- ✅ **로컬 전용**: 서버 없이 `.hyenipack` 파일만으로 동작
- ✅ **완전 자립**: 모든 모드 JAR 파일이 ZIP에 포함됨
- ✅ **쉬운 공유**: 하나의 파일로 모드팩 전체를 공유
- ✅ **무결성 검증**: SHA256으로 파일 손상 감지

---

## 📁 파일 구조

### .hyenipack 파일 (ZIP 형식)

```
mypack.hyenipack
├── hyenipack.json          # 모드팩 메타데이터
├── icon.png                # 모드팩 아이콘 (선택)
├── mods/                   # 모드 JAR 파일들
│   ├── sodium-0.6.13.jar
│   ├── iris-1.8.8.jar
│   └── lithium-0.11.2.jar
└── overrides/              # 덮어쓸 설정 파일들
    ├── config/
    │   ├── sodium-options.json
    │   └── iris.properties
    ├── options.txt
    └── servers.dat
```

### hyenipack.json 구조

```json
{
  "formatVersion": 1,
  "name": "혜니 서바이벌 팩",
  "version": "1.0.0",
  "author": "Yuri",
  "description": "내가 쓰는 서바이벌 모드 모음",
  
  "minecraft": {
    "version": "1.21.1",
    "loaderType": "neoforge",
    "loaderVersion": "21.1.77"
  },
  
  "mods": [
    {
      "fileName": "sodium-neoforge-0.6.13+mc1.21.1.jar",
      "metadata": {
        "version": "0.6.13",
        "source": "modrinth",
        "projectId": "AANobbMI"
      },
      "sha256": "abc123...",
      "size": 1048576
    }
  ],
  
  "createdAt": "2025-01-24T15:00:00Z",
  "exportedFrom": {
    "launcher": "HyeniMC",
    "version": "0.3.1",
    "profileName": "테스트"
  }
}
```

---

## 🚀 사용 방법

### 1. 혜니팩 내보내기 (Export)

현재 프로필을 혜니팩 파일로 변환합니다.

**단계**:
1. 프로필 우클릭 → "혜니팩으로 내보내기" (UI는 추후 구현)
2. 기본 정보 입력:
   - 모드팩 이름
   - 버전
   - 제작자
   - 설명 (선택)
3. 포함할 모드 선택 (체크박스)
4. 포함할 파일 선택:
   - `config/` 설정 파일
   - `resourcepacks/` 리소스팩
   - `shaderpacks/` 셰이더팩
   - `options.txt` 게임 옵션
   - `servers.dat` 서버 목록
5. "내보내기" 클릭
6. Downloads 폴더에 `.hyenipack` 파일 생성

**코드 예시** (IPC):
```typescript
const result = await window.electron.ipcRenderer.invoke(
  'hyenipack:export',
  profileId,
  {
    packName: '나의 모드팩',
    version: '1.0.0',
    author: 'Yuri',
    description: '설명',
    selectedMods: ['sodium.jar', 'iris.jar'],
    includeConfig: true,
    includeResourcePacks: false,
    includeShaderPacks: false,
    includeOptions: true,
    includeServers: false,
    customFiles: []
  }
);

if (result.success) {
  console.log('파일 생성:', result.filePath);
}
```

---

### 2. 혜니팩 가져오기 (Import)

혜니팩 파일을 가져와서 새 프로필을 생성합니다.

**단계**:
1. 프로필 목록 → "혜니팩 가져오기" (UI는 추후 구현)
2. `.hyenipack` 파일 선택
3. 모드팩 정보 미리보기:
   - 이름, 버전, 제작자
   - 포함된 모드 리스트
   - 마인크래프트 버전, 로더 타입
4. 프로필 이름 입력 (기본값: 모드팩 이름)
5. "가져오기" 클릭
6. 진행 상태 표시:
   - 압축 해제
   - 모드 설치 (SHA256 검증)
   - 설정 파일 적용
7. 완료 후 새 프로필로 자동 전환

**코드 예시** (미리보기):
```typescript
const result = await window.electron.ipcRenderer.invoke(
  'hyenipack:preview',
  packFilePath
);

if (result.success) {
  console.log('모드팩:', result.manifest.name);
  console.log('모드 개수:', result.manifest.mods.length);
}
```

**코드 예시** (가져오기):
```typescript
const result = await window.electron.ipcRenderer.invoke(
  'hyenipack:import',
  packFilePath,
  profileId,
  instanceDir
);

if (result.success) {
  console.log('설치된 모드:', result.installedMods);
}
```

---

## 🎯 특징

### 1. SHA256 무결성 검증

모든 모드 파일은 SHA256 해시로 검증됩니다:
- Export 시: 각 모드의 SHA256 계산 후 manifest에 기록
- Import 시: 설치된 모드의 SHA256을 manifest와 비교
- 손상된 파일 발견 시: 자동으로 설치 중단 및 에러 표시

### 2. 통합 메타데이터

설치된 모드팩은 `.hyenimc-metadata.json`에 기록됩니다:
```json
{
  "source": "hyenipack",
  "hyeniPack": {
    "name": "혜니 서바이벌 팩",
    "version": "1.0.0",
    "author": "Yuri"
  },
  "mods": {
    "sodium.jar": {
      "source": "modrinth",
      "installedFrom": "hyenipack",
      "hyeniPackName": "혜니 서바이벌 팩"
    }
  }
}
```

### 3. Overrides 시스템

`overrides/` 폴더의 내용은 프로필 디렉토리에 그대로 복사됩니다:
- `overrides/config/` → `instances/{profileId}/config/`
- `overrides/options.txt` → `instances/{profileId}/options.txt`

---

## 🛠️ 기술 스택

### 백엔드
- **HyeniPackExporter** (`src/main/services/hyenipack-exporter.ts`)
  - 프로필 → .hyenipack 변환
  - 모드 복사 + SHA256 계산
  - overrides 처리
  - ZIP 압축

- **HyeniPackImporter** (`src/main/services/hyenipack-importer.ts`)
  - .hyenipack 파싱
  - 압축 해제
  - 모드 설치 + SHA256 검증
  - overrides 적용
  - 메타데이터 생성

### IPC 핸들러
- `hyenipack:preview` - 미리보기
- `hyenipack:import` - 가져오기
- `hyenipack:export` - 내보내기

### 타입 정의
- `src/shared/types/hyenipack.ts`
  - `HyeniPackManifest`
  - `HyeniPackModEntry`
  - `HyeniPackExportOptions`
  - `HyeniPackImportProgress`

---

## 📝 개발 상태

### ✅ 완료
- [x] Phase 1: 타입 정의
- [x] Phase 2: Export 백엔드
- [x] Phase 3: Import 백엔드
- [x] IPC 핸들러 등록
- [x] modpack-manager 통합

### 🔜 향후 계획
- [ ] Export UI (다이얼로그)
- [ ] Import UI (다이얼로그)
- [ ] 드래그 앤 드롭 지원
- [ ] 혜니팩 배지 표시
- [ ] 파일 트리 선택기 (고급 Export)

---

## 🔧 개발자 가이드

### Export 예시

```typescript
import { hyeniPackExporter } from './services/hyenipack-exporter';

const profile = {
  id: 'abc-123',
  name: '테스트',
  gameVersion: '1.21.1',
  loaderType: 'neoforge' as const,
  loaderVersion: '21.1.77',
  gameDir: '/path/to/instance'
};

const options = {
  packName: '나의 모드팩',
  version: '1.0.0',
  author: 'Yuri',
  selectedMods: ['sodium.jar', 'iris.jar'],
  includeConfig: true,
  includeResourcePacks: false,
  includeShaderPacks: false,
  includeOptions: true,
  includeServers: false,
  customFiles: []
};

const filePath = await hyeniPackExporter.exportProfile(
  profile,
  options,
  '/path/to/output.hyenipack'
);

console.log('생성됨:', filePath);
```

### Import 예시

```typescript
import { hyeniPackImporter } from './services/hyenipack-importer';

const result = await hyeniPackImporter.importHyeniPack(
  '/path/to/pack.hyenipack',
  'profile-id',
  '/path/to/instance',
  (progress) => {
    console.log(progress.stage, progress.progress, progress.message);
  }
);

if (result.success) {
  console.log('설치 완료:', result.installedMods, '개 모드');
}
```

---

## 🐛 문제 해결

### Export 실패
- **증상**: 내보내기 중 에러 발생
- **원인**: 
  - 모드 파일 읽기 권한 부족
  - 디스크 공간 부족
  - 잘못된 파일 경로
- **해결**: 
  - 관리자 권한으로 실행
  - 디스크 공간 확인
  - 로그 확인 (`console.log`)

### Import 실패
- **증상**: 가져오기 중 체크섬 오류
- **원인**: 
  - 손상된 .hyenipack 파일
  - 네트워크 전송 중 파일 손상
- **해결**: 
  - 원본 파일 재다운로드
  - 파일 무결성 확인

### 모드 누락
- **증상**: Import 후 일부 모드가 없음
- **원인**: 
  - Export 시 모드 선택 해제
  - .hyenipack 파일 불완전
- **해결**: 
  - Export 시 모든 모드 선택 확인
  - manifest의 mods 배열 확인

---

## 📄 라이센스

이 기능은 HyeniMC 런처의 일부로 제공됩니다.
