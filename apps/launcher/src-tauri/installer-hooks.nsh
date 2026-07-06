# HyeniMC NSIS 설치 훅 (M6) — 기존 Electron 판 자동 제거.
#
# 기존 Electron 판(electron-builder NSIS)이 남긴 언인스톨 레지스트리 키를 탐지해
# 설치 전 조용히 제거한다. 사용자 데이터(~/.hyenimc, %APPDATA%\hyenimc)는 건드리지 않는다.
#
# tauri.conf.json bundle.windows.nsis.installerHooks 로 연결.
# 전제: 기존 Electron 판 appId = me.devbug.hyeniworld.hyenimc (electron-builder는
#       HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<appId> 에 등록).

!macro NSIS_HOOK_PREINSTALL
  # 기존 Electron 판 언인스톨러 경로 조회 (per-user 설치 기준)
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\me.devbug.hyeniworld.hyenimc" "UninstallString"
  ${If} $0 != ""
    DetailPrint "기존 HyeniMC(Electron) 판을 제거합니다..."
    # electron-builder NSIS 언인스톨러 silent 실행 (데이터 보존)
    ExecWait '"$0" /S --keep-data'
  ${EndIf}

  # per-machine 설치분도 확인
  ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\me.devbug.hyeniworld.hyenimc" "UninstallString"
  ${If} $1 != ""
    DetailPrint "기존 HyeniMC(Electron, per-machine) 판을 제거합니다..."
    ExecWait '"$1" /S --keep-data'
  ${EndIf}
!macroend
