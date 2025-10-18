# 🎮 HyeniMC 사용 가이드

> 혜니데이 서버에 접속하기 위한 HyeniMC 런처 설치 및 사용 가이드입니다.

<img width="100%" alt="혜니월드 전용 런처" src="https://github.com/user-attachments/assets/57a5d8ae-ab9c-4c6a-acef-54b1068e2c5f" />

---

## 📑 목차

1. [모드팩 다운로드](#-1-모드팩-다운로드)
2. [런처 설치](#-2-런처-설치)
3. [Microsoft 계정 로그인](#-3-microsoft-계정-로그인)
4. [전역 설정 구성](#-4-전역-설정-구성)
5. [프로필 생성 및 게임 실행](#-5-프로필-생성-및-게임-실행)

---

## 📥 1. 모드팩 다운로드

디스코드를 통해 배포하는 **혜니데이 모드팩**을 다운로드 받으세요.

> **ℹ️ 참고사항**  
> 혜니데이 모드팩은 **NeoForge 1.21.1** 버전용입니다.  
> HyeniMC 또는 Modrinth 런처 외의 다른 런처를 사용하신다면 모드 로더 버전을 확인해주세요.

---

## 💾 2. 런처 설치

### 2-1. 최신 버전 다운로드

현재 최신 버전: **v0.3.0**

아래 링크에서 운영체제에 맞는 설치 파일을 다운로드하세요:

| 운영체제 | 다운로드 링크 |
|---------|-------------|
| 🪟 **Windows** | [HyeniMC-Setup-0.3.0.exe](https://github.com/hyeniworld/HyeniMC/releases/download/v0.3.0/HyeniMC-Setup-0.3.0.exe) |
| 🍎 **macOS (Apple Silicon)** | [HyeniMC-Setup-0.3.0-arm64.dmg](https://github.com/hyeniworld/HyeniMC/releases/download/v0.3.0/HyeniMC-Setup-0.3.0-arm64.dmg) |
| 🍏 **macOS (Intel)** | [HyeniMC-Setup-0.3.0-x64.dmg](https://github.com/hyeniworld/HyeniMC/releases/download/v0.3.0/HyeniMC-Setup-0.3.0-x64.dmg) |
| 🍎 **macOS (Universal)** | [HyeniMC-Setup-0.3.0-universal.dmg](https://github.com/hyeniworld/HyeniMC/releases/download/v0.3.0/HyeniMC-Setup-0.3.0-universal.dmg) |

> **💡 Tip**: 최신 버전은 항상 [GitHub Releases](https://github.com/hyeniworld/HyeniMC/releases/latest)에서 확인할 수 있습니다.

### 2-2. 설치 진행

다운로드한 설치 파일을 실행하여 HyeniMC를 설치합니다.

---

## 🔐 3. Microsoft 계정 로그인

### 3-1. 로그인 화면 접속

HyeniMC를 실행한 후, 우측 상단의 `계정 없음` 영역을 클릭합니다.

<img width="350" alt="계정 버튼" src="https://github.com/user-attachments/assets/27766a14-f095-4049-99af-d4f9092a14f8" />

### 3-2. Microsoft 로그인

`Microsoft 로그인` 버튼을 클릭합니다.  

<img width="510" alt="로그인 버튼" src="https://github.com/user-attachments/assets/41f1fe84-12f8-48dd-9cd5-7e6d9cd03a16" /><br />
<img width="692" alt="MS 로그인 화면" src="https://github.com/user-attachments/assets/07155a89-adc2-445c-a9c3-4537dec3d781" /><br />
<img width="536" alt="로그인 성공" src="https://github.com/user-attachments/assets/79a557bc-ca38-4f0f-a975-fbc066cf7d07" />

브라우저가 열리면 Microsoft 계정으로 로그인합니다.  

> **⚠️ 주의사항**  
> 마인크래프트 정품을 소유한 Microsoft 계정으로 로그인해야 멀티플레이가 가능합니다.

---

## ⚙️ 4. 전역 설정 구성

로그인 완료 후 우측 상단의 `설정` 버튼을 클릭합니다.

### 4-1. Java 버전 선택

<img width="100%" alt="전역 설정 Java 화면 1" src="https://github.com/user-attachments/assets/d23b086f-ccf6-461a-871e-9b427ac5ba8a" />

현재 감지된 Java 버전 중 **Java 21 이상**을 선택하세요.

> **💡 Tip**: Java가 설치되어 있지 않다면 [Adoptium](https://adoptium.net/)에서 Java 21을 다운로드하세요.

### 4-2. JVM 메모리 할당

<img width="100%" alt="전역 설정 Java 화면 2" src="https://github.com/user-attachments/assets/4233c6a6-24a3-43b3-9cea-9e706a66b473" />

컴퓨터 사양에 맞게 JVM 메모리를 설정합니다.

#### 권장 메모리 설정

| 시스템 RAM | 권장 할당 메모리 | 설정값 (MB) |
|-----------|----------------|------------|
| 8GB | 4GB | 4096 |
| 16GB | 6-8GB | 6144 - 8192 |
| 32GB | 8-12GB | 8192 - 12288 |
| 64GB 이상 | 16-32GB | 16384 - 32768 |

> **⚠️ 주의사항**  
> 메모리를 무조건 많이 할당한다고 성능이 좋아지는 것은 아닙니다.  
> 시스템 전체 메모리의 50-60%를 초과하지 않도록 설정하세요.

### 4-3. 해상도 설정

<img width="100%" alt="전역 설정 해상도 화면" src="https://github.com/user-attachments/assets/719c64d8-7499-4409-92df-a425ee75e13d" />

- **전체화면 모드**: `Fullscreen` 옵션을 켭니다.
- **창 모드**: `Width`와 `Height` 값을 원하는 해상도로 설정합니다.

#### 일반적인 해상도 예시
- **1920 × 1080** (Full HD)
- **2560 × 1440** (QHD)
- **3840 × 2160** (4K)

### 4-4. 설정 저장

<img width="422" alt="전역 설정 버튼들" src="https://github.com/user-attachments/assets/4201b2fd-cf27-44ab-8a09-7f83b5b3287f" />

우측 상단의 `저장` 버튼을 클릭한 후, `취소` 버튼을 눌러 메인 화면으로 돌아갑니다.

---

## 🎯 5. 프로필 생성 및 게임 실행

### 5-1. 프로필 추가

<img width="100%" alt="프로필 화면" src="https://github.com/user-attachments/assets/41ec969f-71f1-4ecd-acfd-22c57196cfbd" /><br />
<img width="663" alt="첫 프로필 만들기 버튼" src="https://github.com/user-attachments/assets/ded7e433-eae4-440c-80ed-0892fc3da2b7" /><br />
<img width="490" alt="새 프로필 버튼" src="https://github.com/user-attachments/assets/7c06016e-05b8-446a-b6a8-0ef37d2cbc04" />

프로필 추가 버튼을 클릭합니다.

### 5-2. 모드팩 가져오기

<img width="820" alt="새 프로필 만들기 화면의 파일 화면" src="https://github.com/user-attachments/assets/456e6edf-d51e-40ec-acb9-855e00a59e3a" />

다음 중 한 가지 방법으로 모드팩을 가져옵니다:

1. **파일 선택 버튼 클릭**: `파일 선택` 버튼을 눌러 다운로드한 혜니데이 모드팩을 선택
2. **드래그 앤 드롭**: 탐색기에서 모드팩 파일을 런처 화면으로 드래그

<img width="809" alt="모드팩 선택된 모습" src="https://github.com/user-attachments/assets/0acb8f95-1a6a-410f-ad2e-277cdde207dd" />

모드팩 파일이 선택되면 `모드팩 가져오기` 버튼을 클릭합니다.

> **⏱️ 잠시만 기다려주세요**  
> 모드팩 분석 및 프로필 생성에 몇 초 정도 소요됩니다.

### 5-3. 게임 실행

<img width="488" alt="프로필 리스트 화면" src="https://github.com/user-attachments/assets/40167430-1d5b-4c76-aee8-58cde66559ff" />

생성된 프로필의 `플레이` 버튼을 클릭합니다.

<img width="694" alt="게임 다운로드 화면 1" src="https://github.com/user-attachments/assets/9918f1e2-043b-4145-aff5-cd9bd68fe6dd" />
<img width="711" alt="게임 다운로드 화면 2" src="https://github.com/user-attachments/assets/928bc588-656e-42d7-b236-6568f95270a3" />

처음 실행 시 필요한 파일들을 자동으로 다운로드합니다.

> **⏱️ 다운로드 시간**  
> 인터넷 속도에 따라 5~15분 정도 소요될 수 있습니다.  
> HyeniMC는 병렬 다운로드를 지원하여 빠른 속도로 다운로드됩니다.

### 5-4. 서버 접속

다운로드가 완료되면 마인크래프트가 자동으로 실행됩니다.

<img width="858" alt="혜니 월드!" src="https://github.com/user-attachments/assets/baa7ee3d-093d-48bb-9aad-2f94083a5d90" /><br />

1. 게임 메인 화면에서 `멀티플레이` 버튼 클릭
2. 디스코드에서 서버 오픈 공지 확인
3. 서버 목록에서 `새로고침` 버튼 클릭
4. 혜니데이 서버가 나타나면 접속!

---

## 🎉 설치 완료!

이제 혜니데이 서버에서 즐거운 시간 보내세요! 🎮

### 문제가 발생했나요?

- 디스코드 커뮤니티에 문의해주세요
- [GitHub Issues](https://github.com/hyeniworld/HyeniMC/issues)에 버그를 제보할 수 있습니다

---

## 📌 FAQ

<details>
<summary><strong>Q. Java가 설치되어 있지 않아요</strong></summary>

**A.** [Adoptium](https://adoptium.net/)에서 Java 21 LTS 버전을 다운로드하여 설치하세요.
</details>

<details>
<summary><strong>Q. 게임이 실행되지 않아요</strong></summary>

**A.** 다음 사항을 확인해보세요:
- Java 21 이상이 설치되어 있는지 확인
- 메모리 할당량이 너무 크지 않은지 확인
- 안티바이러스 프로그램에서 HyeniMC를 허용했는지 확인
</details>

<details>
<summary><strong>Q. 모드팩을 업데이트하려면 어떻게 하나요?</strong></summary>

**A.** 새로운 모드팩 파일을 다운로드한 후, 같은 방법으로 프로필을 새로 만들면 됩니다. 기존 프로필은 삭제하셔도 됩니다.  
하지만 혜니월드 공식 배포의 경우 모드팩을 추가로 배포하지 않고 자체 업데이트를 지원할 예정입니다.  
필요하면 자체적으로 업데이트를 통해 진행될 예정이오니 HyeniMC 런처를 이용해 편하게 즐겨주세요.  
</details>

<details>
<summary><strong>Q. Windows에서 "이 앱을 실행하면 위험에 노출될 수 있다"고 나와요</strong></summary>

**A.** Windows의 보안 설정 때문입니다.  
<img width="403" alt="Windows 10 SmartScreen" src="https://github.com/user-attachments/assets/9655a650-808a-4a54-b616-785710987198" /><br />
Windows 10에서는 `실행` 버튼만 클릭하면 됩니다.  
  
<img width="532" alt="Windows 11 SmartScreen" src="https://github.com/user-attachments/assets/a258ec30-0c3b-4894-8f26-02c5802f8c94" /><br />
Windows 11에서는 `추가 정보`를 누르면 `실행` 버튼이 나타납니다.  
</details>

<details>
<summary><strong>Q. macOS에서 "손상된 앱"이라고 나와요</strong></summary>

**A.** macOS의 보안 설정 때문입니다. 터미널에서 다음 명령어를 실행하세요:
```bash
xattr -cr /Applications/HyeniMC.app
```
</details>

<details>
<summary><strong>Q. macOS에서 "악성 코드가 없음을 확인할 수 없다"고 나와요</strong></summary>

**A.** macOS의 보안 설정 때문입니다. 설정의 `개인정보 보호 및 보안`에서 HyeniMC 실행을 차단했다는 옆에 `그래도 열기` 버튼을 누른 뒤 계정 비밀번호를 입력해주세요.
</details>

---

<p align="center">
  Made with ❤️ for 혜니월드<br>
  <sub>이 프로젝트는 Mojang Studios와 공식적으로 연관되어 있지 않습니다.</sub>
</p>
