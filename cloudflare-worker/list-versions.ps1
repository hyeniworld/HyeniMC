#!/usr/bin/env pwsh
<#
.SYNOPSIS
    모드 버전 목록 조회 스크립트

.DESCRIPTION
    특정 모드의 모든 배포된 버전을 조회합니다.

.PARAMETER ModId
    모드 ID

.EXAMPLE
    .\list-versions.ps1 -ModId hyenihelper
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ModId
)

$ErrorActionPreference = "Stop"

Write-Host "📋 모드 버전 목록" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "📦 모드 ID: $ModId" -ForegroundColor White
Write-Host ""

# Worker URL 가져오기
$workerUrl = & "$PSScriptRoot\scripts\Get-WorkerUrl.ps1"

# 현재 latest 버전 확인
Write-Host "🔍 현재 버전 확인 중..." -ForegroundColor Cyan

$apiUrl = "$workerUrl/api/mods/$ModId/latest"

try {
    $currentLatest = Invoke-RestMethod -Uri $apiUrl -Method Get
    $currentVersion = $currentLatest.version
    Write-Host "   ✅ 현재 버전: $currentVersion" -ForegroundColor Green
} catch {
    Write-Host "   ⚠️  latest.json을 찾을 수 없습니다." -ForegroundColor Yellow
    $currentVersion = $null
}

Write-Host ""

# 모든 버전 조회
Write-Host "📡 모든 버전 조회 중..." -ForegroundColor Cyan

$versionsUrl = "$workerUrl/api/mods/$ModId/versions"

try {
    $versionsResponse = Invoke-RestMethod -Uri $versionsUrl -Method Get
    $versions = $versionsResponse.versions | Sort-Object -Property version -Descending
    
    if ($versions.Count -eq 0) {
        Write-Host "   ⚠️  배포된 버전이 없습니다." -ForegroundColor Yellow
        exit 0
    }
    
    Write-Host "   ✅ $($versions.Count)개 버전 발견" -ForegroundColor Green
    Write-Host ""
    
    # 버전 목록 표시
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    
    foreach ($v in $versions) {
        $isCurrent = $v.version -eq $currentVersion
        $marker = if ($isCurrent) { " ← 현재 배포 버전" } else { "" }
        $color = if ($isCurrent) { "Green" } else { "White" }
        
        Write-Host ""
        Write-Host "  📦 v$($v.version)$marker" -ForegroundColor $color
        Write-Host "     🎮 게임 버전: $($v.gameVersion)" -ForegroundColor Gray
        Write-Host "     📅 출시일: $($v.releaseDate)" -ForegroundColor Gray
        
        if ($v.loaders) {
            $loadersList = ($v.loaders.Keys | ForEach-Object { $_ }) -join ', '
            Write-Host "     🔧 로더: $loadersList" -ForegroundColor Gray
        }
        
        if ($v.changelog) {
            Write-Host "     📝 변경사항: $($v.changelog)" -ForegroundColor Gray
        }
        
        if ($v.required) {
            Write-Host "     ⚠️  필수 업데이트" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    Write-Host ""
    Write-Host "📊 요약:" -ForegroundColor White
    Write-Host "   • 총 버전 수: $($versions.Count)" -ForegroundColor Gray
    Write-Host "   • 현재 버전: v$currentVersion" -ForegroundColor Gray
    Write-Host "   • 최신 버전: v$($versions[0].version)" -ForegroundColor Gray
    
    if ($currentVersion -ne $versions[0].version) {
        Write-Host ""
        Write-Host "   ⚠️  현재 버전이 최신 버전이 아닙니다!" -ForegroundColor Yellow
        Write-Host "   💡 최신 버전으로 업데이트하려면:" -ForegroundColor Cyan
        Write-Host "      .\rollback-mod.ps1 -ModId $ModId -Version $($versions[0].version)" -ForegroundColor Blue
    }
    
    Write-Host ""
    
} catch {
    Write-Host "   ❌ 버전 목록을 가져올 수 없습니다." -ForegroundColor Red
    Write-Host "   오류: $_" -ForegroundColor Yellow
    exit 1
}

exit 0
