# HyeniMC 릴리즈 스크립트 (Windows)
# 사용법: .\scripts\release.ps1 [patch|minor|major] [message]

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('patch', 'minor', 'major')]
    [string]$VersionType,
    
    [Parameter(Mandatory=$false)]
    [string]$CommitMessage = ""
)

# 에러 발생 시 중단
$ErrorActionPreference = "Stop"

# 색상 함수
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

# 현재 버전 확인
$CurrentVersion = (Get-Content package.json | ConvertFrom-Json).version
Write-ColorOutput Yellow "📦 현재 버전: v$CurrentVersion"

# Git 상태 확인
$GitStatus = git status -s
if ($GitStatus) {
    Write-ColorOutput Red "❌ 커밋되지 않은 변경사항이 있습니다"
    Write-Output "먼저 변경사항을 커밋하거나 stash 해주세요."
    git status -s
    exit 1
}

# 메인 브랜치 확인
$CurrentBranch = git branch --show-current
if ($CurrentBranch -ne "main" -and $CurrentBranch -ne "master") {
    Write-ColorOutput Yellow "⚠️  현재 브랜치: $CurrentBranch"
    $Response = Read-Host "메인 브랜치가 아닙니다. 계속하시겠습니까? (y/N)"
    if ($Response -ne "y" -and $Response -ne "Y") {
        exit 1
    }
}

# 최신 상태 확인
Write-ColorOutput Yellow "🔄 원격 저장소 확인 중..."
git fetch origin

$Local = git rev-parse "@"
$Remote = git rev-parse "@{u}"

if ($Local -ne $Remote) {
    Write-ColorOutput Red "❌ 로컬과 원격 저장소가 동기화되지 않았습니다"
    Write-Output "git pull을 먼저 실행해주세요."
    exit 1
}

# 버전 업데이트
Write-ColorOutput Green "⬆️  버전 업데이트 중..."
if ($CommitMessage -eq "") {
    npm version $VersionType -m "chore: release v%s"
} else {
    npm version $VersionType -m "chore: release v%s - $CommitMessage"
}

# 새 버전 가져오기
$NewVersion = (Get-Content package.json | ConvertFrom-Json).version
Write-ColorOutput Green "✅ 새 버전: v$NewVersion"

# 태그 푸시
Write-ColorOutput Green "🚀 태그 푸시 중..."
git push origin $CurrentBranch
git push origin "v$NewVersion"

Write-Output ""
Write-ColorOutput Green "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-ColorOutput Green "✅ 릴리즈 v$NewVersion 시작됨!"
Write-ColorOutput Green "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Output ""
Write-Output "📦 GitHub Actions에서 빌드 중..."
Write-Output "🔗 진행 상황: https://github.com/devbug/HyeniMC/actions"
Write-Output "📋 릴리즈 페이지: https://github.com/devbug/HyeniMC/releases/tag/v$NewVersion"
Write-Output ""
Write-Output "빌드가 완료되면 자동으로 릴리즈가 생성되고,"
Write-Output "사용자들은 런처를 통해 자동 업데이트를 받게 됩니다."
Write-Output ""
