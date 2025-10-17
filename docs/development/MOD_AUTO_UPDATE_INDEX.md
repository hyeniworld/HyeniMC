# 필수 모드 자동 업데이트 시스템 - 문서 인덱스

> **작성일**: 2025-10-16  
> **상태**: 계획 단계 (검토 대기)

---

## 📚 전체 문서 목록

이 시스템과 관련된 모든 문서를 한눈에 볼 수 있는 인덱스입니다.

### 1️⃣ 📋 **구현 요약** (빠른 참조용)
**파일**: [`MOD_AUTO_UPDATE_SUMMARY.md`](./MOD_AUTO_UPDATE_SUMMARY.md)

**내용**:
- 프로젝트 목표 및 핵심 아키텍처
- 5단계 구현 계획 요약
- 타입 정의 및 성공 기준
- 예상 일정 (3-4일)
- 빠르게 전체 그림을 파악할 수 있는 요약본

**대상**: 프로젝트 전체를 빠르게 이해하고 싶은 경우

---

### 2️⃣ 📖 **상세 구현 계획** (개발 가이드)
**파일**: [`MOD_AUTO_UPDATE_PLAN.md`](./MOD_AUTO_UPDATE_PLAN.md)

**내용**:
- Phase별 상세 구현 가이드
- 모든 메서드 시그니처 및 구현 예시
- Worker API 통신 프로토콜
- IPC 핸들러 설계
- UI 컴포넌트 구조
- 테스트 전략
- 에러 처리 및 엣지 케이스

**대상**: 실제로 코드를 작성할 개발자

---

### 3️⃣ 🔀 **서버 감지 전략 옵션** (설계 결정)
**파일**: [`../architecture/SERVER_DETECTION_OPTIONS.md`](../architecture/SERVER_DETECTION_OPTIONS.md)

**내용**:
- **Option A**: Hybrid (Profile + servers.dat) - **권장** ⭐
- **Option B**: Profile Only (UI 우선)
- **Option C**: servers.dat Only (완전 자동)
- 각 옵션별 상세 분석:
  - 사용자 시나리오 (5개)
  - 장단점 비교
  - 구현 복잡도
  - 테스트 계획
- 종합 비교표 (30점 만점 점수화)
- 권장 사항 및 이유

**대상**: 서버 감지 방법 결정을 위한 의사결정자

---

### 4️⃣ ✅ **Registry 확인 가이드** (운영 가이드)
**파일**: [`../guides/CHECK_REGISTRY.md`](../guides/CHECK_REGISTRY.md)

**내용**:
- Worker에 배포된 `registry.json` 확인 방법
- `curl` 명령어로 API 테스트
- `wrangler` CLI로 R2 직접 조회
- 예상 응답 구조
- 문제 해결 가이드

**대상**: 배포 후 레지스트리가 제대로 생성되었는지 확인하려는 경우

---

## 🗺️ 읽기 순서 권장

### 처음 시작하는 경우
```
1. MOD_AUTO_UPDATE_SUMMARY.md (10분) - 전체 그림 파악
2. SERVER_DETECTION_OPTIONS.md (15분) - 설계 옵션 검토
3. MOD_AUTO_UPDATE_PLAN.md (30분) - 상세 구현 계획
4. CHECK_REGISTRY.md (5분) - 배포 후 확인 방법
```

### 구현을 시작하는 경우
```
1. MOD_AUTO_UPDATE_PLAN.md - 구현 가이드 정독
2. SERVER_DETECTION_OPTIONS.md - 선택한 옵션 구현
3. CHECK_REGISTRY.md - 배포 후 테스트
```

### 의사결정만 필요한 경우
```
1. MOD_AUTO_UPDATE_SUMMARY.md - 프로젝트 이해
2. SERVER_DETECTION_OPTIONS.md - 옵션 선택
```

---

## 📊 프로젝트 현황

### ✅ 완료된 작업
- [x] Worker API 구조 파악
- [x] `update-registry.sh` 수정 (loaders, required, category 추가)
- [x] `update-registry.ps1` 수정 (loaders, required, category 추가)
- [x] 아키텍처 설계
- [x] 전체 구현 계획 수립
- [x] 서버 감지 옵션 분석

### ⏳ 다음 단계
1. **의사결정**: 서버 감지 옵션 선택 (Option A/B/C)
2. **배포 준비**: `registry.json` 재생성 (선택)
3. **구현 시작**: Step 1 (ModUpdater 서비스) 부터

### 🎯 핵심 의사결정 필요
> ⚠️ **서버 감지 방법 선택**
> 
> 3가지 옵션 중 하나를 선택해야 합니다:
> - **Option A (권장)**: Profile 설정 + servers.dat 자동 감지
> - **Option B**: Profile 설정만
> - **Option C**: servers.dat만
>
> 📄 상세 분석: [`SERVER_DETECTION_OPTIONS.md`](../architecture/SERVER_DETECTION_OPTIONS.md)

---

## 🏗️ 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────┐
│           사용자: "플레이" 버튼 클릭                │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────┐
    │ 1. Minecraft 다운로드   │
    └─────────┬───────────────┘
              │
              ▼
    ┌─────────────────────────┐
    │ 2. 로더 설치            │
    │   (Fabric/NeoForge)     │
    └─────────┬───────────────┘
              │
              ▼
    ┌─────────────────────────┐
    │ 3. 서버 주소 확인 🆕    │
    └─────────┬───────────────┘
              │
              ├─ *.hyeniworld.com?
              │
    ┌─────────┴─────────┬─────────────────────────┐
    │                   │                         │
    ▼ YES               │                         ▼ NO
┌───────────────┐       │               ┌──────────────────┐
│ Worker API    │       │               │ 모드 체크 스킵   │
│ 호출          │       │               └────────┬─────────┘
└───────┬───────┘       │                        │
        │               │                        │
        ▼               │                        │
┌───────────────┐       │                        │
│ 레지스트리    │       │                        │
│ 가져오기      │       │                        │
└───────┬───────┘       │                        │
        │               │                        │
        ▼               │                        │
┌───────────────┐       │                        │
│ 로컬 모드     │       │                        │
│ 버전 체크     │       │                        │
└───────┬───────┘       │                        │
        │               │                        │
        ▼               │                        │
┌───────────────┐       │                        │
│ 업데이트      │       │                        │
│ 필요한 모드   │       │                        │
│ 설치          │       │                        │
└───────┬───────┘       │                        │
        │               │                        │
        ▼               │                        │
┌───────────────┐       │                        │
│ 토큰 검증     │       │                        │
│ (없으면 차단) │       │                        │
└───────┬───────┘       │                        │
        │               │                        │
        └───────────────┴────────────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │ 4. 게임 실행    │
              └─────────────────┘
```

---

## 🔗 관련 문서

### 기존 시스템 참고
- [`ARCHITECTURE.md`](../architecture/ARCHITECTURE.md) - 전체 시스템 아키텍처
- [`AUTH_PROTOCOL.md`](../architecture/AUTH_PROTOCOL.md) - hyenimc://auth 프로토콜
- [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md) - 일반 구현 가이드

### 배포 관련
- [`../deployment/DEPLOYMENT_GUIDE.md`](../deployment/DEPLOYMENT_GUIDE.md) - 배포 가이드
- [`../../cloudflare-worker/DEPLOYMENT.md`](../../cloudflare-worker/DEPLOYMENT.md) - Worker 배포

### 가이드
- [`../guides/SETUP_GUIDE.md`](../guides/SETUP_GUIDE.md) - 초기 설정
- [`../guides/QUICKSTART.md`](../guides/QUICKSTART.md) - 빠른 시작

---

## 📞 문의 및 피드백

구현 중 질문이나 개선 사항이 있으면:
1. 이 문서들을 먼저 확인
2. 팀 채널에서 논의
3. 필요시 문서 업데이트

---

## 📝 변경 이력

| 날짜 | 변경 사항 | 작성자 |
|------|-----------|--------|
| 2025-10-16 | 초기 문서 작성 (4개) | Cascade AI |
| | - MOD_AUTO_UPDATE_SUMMARY.md | |
| | - MOD_AUTO_UPDATE_PLAN.md | |
| | - SERVER_DETECTION_OPTIONS.md | |
| | - CHECK_REGISTRY.md | |

---

**📖 이 인덱스는 4개 문서의 탐색을 돕기 위한 가이드입니다.**
