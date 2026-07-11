# HyeniMC NSIS 설치 훅 (M6) — 기존 Electron 판 자동 제거.
#
# 기존 Electron 판(electron-builder NSIS)의 언인스톨러를 설치 전 조용히 실행해 제거한다.
# 사용자 데이터(~/.hyenimc, %APPDATA%\hyenimc)는 보존 — electron-builder 언인스톨러는
# 기본(silent 포함)이 데이터 유지이고, Tauri 판은 같은 legacy 데이터 경로를 in-place로 쓴다.
#
# tauri.conf.json bundle.windows.nsis.installerHooks 로 연결.
#
# ⚠️ 핵심: electron-builder는 Uninstall 레지스트리 키를 appId 문자열이 아니라 appId에서
#          계산한 **GUID**로 등록한다(UUID v5, 결정적 — appId가 같은 모든 사용자 동일).
#          실측: appId me.devbug.hyeniworld.hyenimc → 85ce1611-b419-5d15-b605-9c0419f97ab5
#          (초기 훅이 appId 문자열 키를 읽어 못 찾고 Electron 판이 남던 버그를 수정).
#          Tauri 판은 키 이름이 "HyeniMC"라 이 GUID와 절대 겹치지 않는다 → 자기 자신을
#          지울 위험 없음.
#
# UninstallString 예: "…\Uninstall HyeniMC.exe" /currentuser  → /S(silent)만 부가.
#   $N에 이미 따옴표로 감싼 경로가 들어있으므로 추가 따옴표 없이 실행한다.

!define ELECTRON_UNINSTALL_GUID "85ce1611-b419-5d15-b605-9c0419f97ab5"

!macro NSIS_HOOK_PREINSTALL
  # per-user (electron-builder 기본 설치 형태)
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${ELECTRON_UNINSTALL_GUID}" "UninstallString"
  ${If} $0 != ""
    DetailPrint "기존 HyeniMC(Electron) 판을 제거합니다..."
    ExecWait '$0 /S'
  ${EndIf}

  # per-machine
  ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${ELECTRON_UNINSTALL_GUID}" "UninstallString"
  ${If} $1 != ""
    DetailPrint "기존 HyeniMC(Electron, per-machine) 판을 제거합니다..."
    ExecWait '$1 /S'
  ${EndIf}

  # 32-bit on 64-bit
  ReadRegStr $2 HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\${ELECTRON_UNINSTALL_GUID}" "UninstallString"
  ${If} $2 != ""
    DetailPrint "기존 HyeniMC(Electron, WOW6432) 판을 제거합니다..."
    ExecWait '$2 /S'
  ${EndIf}
!macroend
