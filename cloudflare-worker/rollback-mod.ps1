#!/usr/bin/env pwsh
<#
.SYNOPSIS
    모드 버전 롤백 스크립트

.DESCRIPTION
    문제가 있는 버전을 빠르게 이전 버전으로 롤백합니다.
    latest.json을 특정 버전으로 변경합니다.

.PARAMETER ModId
    모드 ID

.PARAMETER Version
    롤백할 버전 번호 (없으면 목록에서 선택)

.EXAMPLE
    .\rollback-mod.ps1 -ModId hyenihelper -Version 1.0.1
    
.EXAMPLE
    .\rollback-mod.ps1 -ModId hyenihelper
    # 대화형으로 버전 선택
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ModId,
    
    [Parameter(Mandatory=$false)]
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"

Write-Host "🔄 모드 버전 롤백" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "📦 모드 ID: $ModId" -ForegroundColor White
Write-Host ""

# 현재 latest.json 확인
Write-Host "📡 현재 버전 확인 중..." -ForegroundColor Cyan

$apiUrl = "https://hyenimc-worker.devbug.workers.dev/api/mods/$ModId/latest"

try {
    $currentLatest = Invoke-RestMethod -Uri $apiUrl -Method Get
    Write-Host "   ✅ 현재 버전: $($currentLatest.version)" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "   ❌ 현재 버전 정보를 가져올 수 없습니다." -ForegroundColor Red
    Write-Host "   오류: $_" -ForegroundColor Yellow
    exit 1
}

# 사용 가능한 버전 목록 조회
Write-Host "📋 사용 가능한 버전 목록 조회 중..." -ForegroundColor Cyan

$versionsUrl = "https://hyenimc-worker.devbug.workers.dev/api/mods/$ModId/versions"

try {
    $versionsResponse = Invoke-RestMethod -Uri $versionsUrl -Method Get
    $versions = $versionsResponse.versions | Sort-Object -Property version -Descending
    
    if ($versions.Count -eq 0) {
        Write-Host "   ❌ 사용 가능한 버전이 없습니다." -ForegroundColor Red
        exit 1
    }
    
    Write-Host "   ✅ $($versions.Count)개 버전 발견" -ForegroundColor Green
    Write-Host ""
    
    # 버전 목록 표시
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    for ($i = 0; $i -lt $versions.Count; $i++) {
        $v = $versions[$i]
        $isCurrent = if ($v.version -eq $currentLatest.version) { " ← 현재" } else { "" }
        Write-Host "  [$($i+1)] v$($v.version)$isCurrent" -ForegroundColor $(if ($isCurrent) { "Yellow" } else { "White" })
        Write-Host "      📅 $($v.releaseDate)" -ForegroundColor Gray
        if ($v.changelog) {
            Write-Host "      📝 $($v.changelog)" -ForegroundColor Gray
        }
        Write-Host ""
    }
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    Write-Host ""
    
} catch {
    Write-Host "   ❌ 버전 목록을 가져올 수 없습니다." -ForegroundColor Red
    Write-Host "   오류: $_" -ForegroundColor Yellow
    exit 1
}

# 롤백할 버전 선택
if ([string]::IsNullOrWhiteSpace($Version)) {
    Write-Host "🔢 롤백할 버전을 선택하세요:" -ForegroundColor Cyan
    Write-Host "   번호 입력 (1-$($versions.Count)) 또는 버전 번호 (예: 1.0.1):" -ForegroundColor Gray
    $userInput = Read-Host "   선택"
    
    if ([string]::IsNullOrWhiteSpace($userInput)) {
        Write-Host "❌ 취소되었습니다." -ForegroundColor Red
        exit 0
    }
    
    # 번호로 입력했는지 확인
    if ($userInput -match '^\d+$') {
        $index = [int]$userInput - 1
        if ($index -lt 0 -or $index -ge $versions.Count) {
            Write-Host "❌ 잘못된 번호입니다." -ForegroundColor Red
            exit 1
        }
        $Version = $versions[$index].version
    } else {
        $Version = $userInput
    }
}

Write-Host ""

# 선택한 버전이 현재 버전과 같은지 확인
if ($Version -eq $currentLatest.version) {
    Write-Host "⚠️  선택한 버전이 현재 버전과 동일합니다." -ForegroundColor Yellow
    Write-Host "   롤백할 필요가 없습니다." -ForegroundColor Yellow
    exit 0
}

# 선택한 버전의 manifest 확인
Write-Host "📄 버전 $Version 정보 확인 중..." -ForegroundColor Cyan

$tempDir = Join-Path $env:TEMP "hyenimc-rollback"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

# R2에서 manifest.json 다운로드 시도
$manifestR2Path = "hyenimc-releases/mods/$ModId/versions/$Version/manifest.json"
$manifestLocalPath = Join-Path $tempDir "manifest.json"

try {
    # wrangler r2 object get 사용
    wrangler r2 object get $manifestR2Path --file $manifestLocalPath 2>&1 | Out-Null
    
    if (-not (Test-Path $manifestLocalPath)) {
        throw "manifest.json 파일을 찾을 수 없습니다."
    }
    
    $manifest = Get-Content $manifestLocalPath -Raw | ConvertFrom-Json
    
    Write-Host "   ✅ 버전: $($manifest.version)" -ForegroundColor Green
    Write-Host "   🎮 게임 버전: $($manifest.gameVersion)" -ForegroundColor Green
    Write-Host "   🔧 로더: $($manifest.loaders.Keys -join ', ')" -ForegroundColor Green
    if ($manifest.changelog) {
        Write-Host "   📝 변경사항: $($manifest.changelog)" -ForegroundColor Green
    }
    Write-Host ""
    
} catch {
    Write-Host "   ❌ 버전 $Version 의 manifest를 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "   오류: $_" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   💡 힌트: 버전이 R2에 존재하는지 확인하세요." -ForegroundColor Yellow
    exit 1
}

# 확인 프롬프트
Write-Host "⚠️  경고: 다음 작업을 수행합니다:" -ForegroundColor Yellow
Write-Host "   • 현재 버전: $($currentLatest.version) → $Version" -ForegroundColor White
Write-Host "   • latest.json이 업데이트됩니다." -ForegroundColor White
Write-Host "   • 모든 사용자가 v$Version 으로 다운로드합니다." -ForegroundColor White
Write-Host ""
Write-Host "계속하시겠습니까? (y/n): " -ForegroundColor Cyan -NoNewline
$confirm = Read-Host

if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "❌ 취소되었습니다." -ForegroundColor Red
    Remove-Item -Path $tempDir -Recurse -Force
    exit 0
}

Write-Host ""

# latest.json 생성
Write-Host "📄 latest.json 생성 중..." -ForegroundColor Cyan

$latest = @{
    version = $manifest.version
    releaseDate = $manifest.releaseDate
    minLauncherVersion = "0.1.0"
    gameVersions = @($manifest.gameVersion)
    changelog = $manifest.changelog
    loaders = $manifest.loaders
} | ConvertTo-Json -Depth 10

$latestPath = Join-Path $tempDir "latest.json"
$latest | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "   ✅ 생성 완료" -ForegroundColor Green
Write-Host ""

# R2 업로드
Write-Host "☁️  latest.json 업로드 중..." -ForegroundColor Cyan

$latestR2Path = "hyenimc-releases/mods/$ModId/latest.json"

try {
    wrangler r2 object put $latestR2Path --remote --file $latestPath 2>&1 | Out-Null
    Write-Host "   ✅ 업로드 완료" -ForegroundColor Green
} catch {
    Write-Host "   ❌ 업로드 실패: $_" -ForegroundColor Red
    Remove-Item -Path $tempDir -Recurse -Force
    exit 1
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "✅ 롤백 완료!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 변경 사항:" -ForegroundColor White
Write-Host "   • 모드: $ModId" -ForegroundColor Gray
Write-Host "   • 이전: v$($currentLatest.version)" -ForegroundColor Gray
Write-Host "   • 현재: v$Version" -ForegroundColor Gray
Write-Host ""
Write-Host "🔗 확인:" -ForegroundColor White
Write-Host "   curl https://hyenimc-worker.devbug.workers.dev/api/mods/$ModId/latest" -ForegroundColor Blue
Write-Host ""
Write-Host "💡 런처 사용자들은 자동으로 v$Version 로 업데이트됩니다." -ForegroundColor Yellow
Write-Host ""

# 임시 파일 정리
Remove-Item -Path $tempDir -Recurse -Force

exit 0
