#!/usr/bin/env pwsh
<#
.SYNOPSIS
    모드 레지스트리 업데이트 스크립트

.DESCRIPTION
    R2의 모든 모드를 스캔하여 registry.json을 생성합니다.

.EXAMPLE
    .\update-registry.ps1
#>

$ErrorActionPreference = "Stop"

Write-Host "🔍 모드 레지스트리 업데이트" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# R2 객체 목록 조회
Write-Host "📡 R2에서 모드 목록 조회 중..." -ForegroundColor Cyan

# wrangler r2 object list는 지원하지 않으므로 수동으로 모드 목록 입력
Write-Host ""
Write-Host "⚠️  현재 배포된 모드 ID를 입력하세요 (쉼표로 구분):" -ForegroundColor Yellow
Write-Host "   예: hyenihelper,hyenicore,hyeniutils" -ForegroundColor Gray
$modsInput = Read-Host "모드 목록"

if ([string]::IsNullOrWhiteSpace($modsInput)) {
    Write-Host "❌ 모드 목록이 비어있습니다." -ForegroundColor Red
    exit 1
}

$modIds = $modsInput -split ',' | ForEach-Object { $_.Trim() }

Write-Host ""
Write-Host "✅ 발견된 모드: $($modIds.Count)개" -ForegroundColor Green
Write-Host ""

# 각 모드의 latest.json 다운로드
$mods = @()

foreach ($modId in $modIds) {
    Write-Host "📦 $modId 정보 수집 중..." -ForegroundColor Cyan
    
    $apiUrl = "https://hyenimc-worker.devbug.workers.dev/api/mods/$modId/latest"
    
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Method Get
        
        $mods += @{
            id = $modId
            name = $modId.Substring(0,1).ToUpper() + $modId.Substring(1)  # 첫 글자 대문자
            description = "HyeniMC $modId mod"
            latestVersion = $response.version
            gameVersions = $response.gameVersions
            loaders = @($response.loaders.Keys)
            required = $response.required
            category = "gameplay"
        }
        
        Write-Host "   ✅ $($response.version)" -ForegroundColor Green
    } catch {
        Write-Host "   ⚠️  latest.json을 찾을 수 없습니다. 건너뜁니다." -ForegroundColor Yellow
    }
}

Write-Host ""

if ($mods.Count -eq 0) {
    Write-Host "❌ 유효한 모드를 찾을 수 없습니다." -ForegroundColor Red
    exit 1
}

# registry.json 생성
Write-Host "📄 registry.json 생성 중..." -ForegroundColor Cyan

$registry = @{
    version = "1.0"
    lastUpdated = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    mods = $mods
} | ConvertTo-Json -Depth 10

$tempDir = Join-Path $env:TEMP "hyenimc-deploy"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

$registryPath = Join-Path $tempDir "registry.json"
$registry | Set-Content -Path $registryPath -Encoding UTF8

Write-Host "   ✅ 생성 완료" -ForegroundColor Green
Write-Host ""

# R2 업로드
Write-Host "☁️  R2 업로드 중..." -ForegroundColor Cyan

try {
    wrangler r2 object put hyenimc-releases/mods/registry.json --remote --file $registryPath 2>&1 | Out-Null
    Write-Host "   ✅ 업로드 완료" -ForegroundColor Green
} catch {
    Write-Host "   ❌ 실패: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "🎉 레지스트리 업데이트 완료!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 등록된 모드: $($mods.Count)개" -ForegroundColor White
foreach ($mod in $mods) {
    Write-Host "   • $($mod.id) v$($mod.latestVersion)" -ForegroundColor Gray
}
Write-Host ""

# 임시 파일 정리
Remove-Item -Path $tempDir -Recurse -Force

exit 0
