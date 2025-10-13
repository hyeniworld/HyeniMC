#!/usr/bin/env pwsh
<#
.SYNOPSIS
    HyeniMC 모드 배포 자동화 스크립트 (PowerShell)

.DESCRIPTION
    JAR 파일들을 R2에 업로드하고 manifest를 생성합니다.

.PARAMETER ModId
    모드 ID (예: hyenihelper, hyenicore)

.PARAMETER Version
    버전 번호 (예: 1.0.1)

.PARAMETER GameVersion
    마인크래프트 버전 (예: 1.21.1)

.PARAMETER Changelog
    변경사항 설명

.PARAMETER Required
    필수 업데이트 여부 (기본값: false)

.PARAMETER JarFiles
    JAR 파일 경로 배열 (직접 지정)

.EXAMPLE
    .\deploy-mod.ps1 -ModId hyenihelper -Version 1.0.1 -GameVersion 1.21.1 -Changelog "버그 수정" -JarFiles @(".\hyenihelper-neoforge.jar", ".\hyenihelper-fabric.jar")
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ModId,
    
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [Parameter(Mandatory=$true)]
    [string]$GameVersion,
    
    [Parameter(Mandatory=$false)]
    [string]$Changelog = "",
    
    [Parameter(Mandatory=$false)]
    [bool]$Required = $false,
    
    [Parameter(Mandatory=$true)]
    [string[]]$JarFiles
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 HyeniMC 모드 배포 시작" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "📦 모드 ID: $ModId" -ForegroundColor White
Write-Host "🔢 버전: $Version" -ForegroundColor White
Write-Host "🎮 게임 버전: $GameVersion" -ForegroundColor White
Write-Host ""

# JAR 파일 확인 및 처리
$loaders = @{}
$processedFiles = @()

foreach ($jarPath in $JarFiles) {
    if (-not (Test-Path $jarPath)) {
        Write-Host "❌ 오류: 파일을 찾을 수 없습니다: $jarPath" -ForegroundColor Red
        exit 1
    }
    
    $jar = Get-Item $jarPath
    Write-Host "📝 처리 중: $($jar.Name)" -ForegroundColor Cyan
    
    # 로더 타입 추출 시도 (여러 패턴 지원)
    $loaderType = $null
    $fileName = $jar.Name
    
    # 패턴 1: *-fabric-*.jar 또는 *-neoforge-*.jar
    if ($fileName -match '-(fabric|neoforge|forge|quilt)-') {
        $loaderType = $matches[1]
    }
    # 패턴 2: *-fabric.jar 또는 *-neoforge.jar (끝에)
    elseif ($fileName -match '-(fabric|neoforge|forge|quilt)\.jar$') {
        $loaderType = $matches[1]
    }
    # 패턴 3: fabric-*.jar 또는 neoforge-*.jar (시작)
    elseif ($fileName -match '^(fabric|neoforge|forge|quilt)-') {
        $loaderType = $matches[1]
    }
    # 패턴 4: 파일명에 포함
    elseif ($fileName -match '(fabric|neoforge|forge|quilt)') {
        $loaderType = $matches[1]
    }
    else {
        Write-Host "   ⚠️  로더 타입을 자동으로 감지할 수 없습니다." -ForegroundColor Yellow
        Write-Host "   📝 파일명: $fileName" -ForegroundColor Gray
        Write-Host "   💡 로더 타입을 입력하세요 (fabric, neoforge, forge, quilt):" -ForegroundColor Cyan
        $loaderType = Read-Host "      로더 타입"
        
        if ([string]::IsNullOrWhiteSpace($loaderType)) {
            Write-Host "   ❌ 로더 타입이 필요합니다. 건너뜁니다." -ForegroundColor Red
            continue
        }
    }
    
    Write-Host "   🔍 로더: $loaderType" -ForegroundColor Gray
    
    # SHA256 계산
    Write-Host "   🔐 SHA256 계산 중..." -ForegroundColor Gray
    $hash = (Get-FileHash -Path $jar.FullName -Algorithm SHA256).Hash
    
    # 파일 크기
    $size = $jar.Length
    
    # 새 파일명 생성 (표준 형식)
    $standardFileName = "$ModId-$loaderType-$GameVersion-$Version.jar"
    
    $loaders[$loaderType] = @{
        fileName = $standardFileName
        sha256 = $hash
        size = $size
        downloadPath = "mods/$ModId/versions/$Version/$standardFileName"
        originalFile = $jar.FullName
    }
    
    $processedFiles += $jar
    
    Write-Host "   ✅ SHA256: $hash" -ForegroundColor Green
    Write-Host "   📦 표준명: $standardFileName" -ForegroundColor Green
}

Write-Host ""

if ($loaders.Count -eq 0) {
    Write-Host "❌ 오류: 처리된 JAR 파일이 없습니다." -ForegroundColor Red
    exit 1
}

Write-Host "✅ 처리된 파일: $($loaders.Count)개" -ForegroundColor Green
Write-Host ""

# manifest.json 생성
Write-Host "📄 manifest.json 생성 중..." -ForegroundColor Cyan

$manifest = @{
    version = $Version
    gameVersion = $GameVersion
    loaders = $loaders
    changelog = $Changelog
    releaseDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    required = $Required
} | ConvertTo-Json -Depth 10

$tempDir = Join-Path $env:TEMP "hyenimc-deploy"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

$manifestPath = Join-Path $tempDir "manifest.json"
$manifest | Set-Content -Path $manifestPath -Encoding UTF8

Write-Host "   ✅ 생성 완료" -ForegroundColor Green
Write-Host ""

# R2 업로드
Write-Host "☁️  R2 업로드 시작" -ForegroundColor Cyan
Write-Host ""

$uploadSuccess = $true

# JAR 파일 업로드
foreach ($loaderType in $loaders.Keys) {
    $info = $loaders[$loaderType]
    $r2Path = "hyenimc-releases/mods/$ModId/versions/$Version/$($info.fileName)"
    Write-Host "   📤 $($info.fileName) [$loaderType]" -ForegroundColor White
    
    try {
        wrangler r2 object put $r2Path --remote --file $info.originalFile 2>&1 | Out-Null
        Write-Host "      ✅ 업로드 완료" -ForegroundColor Green
    } catch {
        Write-Host "      ❌ 실패: $_" -ForegroundColor Red
        $uploadSuccess = $false
    }
}

# manifest.json 업로드
$manifestR2Path = "hyenimc-releases/mods/$ModId/versions/$Version/manifest.json"
Write-Host "   📤 manifest.json" -ForegroundColor White

try {
    wrangler r2 object put $manifestR2Path --remote --file $manifestPath 2>&1 | Out-Null
    Write-Host "      ✅ 업로드 완료" -ForegroundColor Green
} catch {
    Write-Host "      ❌ 실패: $_" -ForegroundColor Red
    $uploadSuccess = $false
}

Write-Host ""

if (-not $uploadSuccess) {
    Write-Host "❌ 일부 파일 업로드 실패" -ForegroundColor Red
    exit 1
}

# latest.json 업데이트
Write-Host "🔄 latest.json 업데이트" -ForegroundColor Cyan

$latest = @{
    version = $Version
    releaseDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    minLauncherVersion = "0.1.0"
    gameVersions = @($GameVersion)
    changelog = $Changelog
    loaders = $loaders
} | ConvertTo-Json -Depth 10

$latestPath = Join-Path $tempDir "latest.json"
$latest | Set-Content -Path $latestPath -Encoding UTF8

$latestR2Path = "hyenimc-releases/mods/$ModId/latest.json"

try {
    wrangler r2 object put $latestR2Path --remote --file $latestPath 2>&1 | Out-Null
    Write-Host "   ✅ 업데이트 완료" -ForegroundColor Green
} catch {
    Write-Host "   ❌ 실패: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "🎉 배포 완료!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 배포 정보:" -ForegroundColor White
Write-Host "   • 모드: $ModId" -ForegroundColor Gray
Write-Host "   • 버전: $Version" -ForegroundColor Gray
Write-Host "   • 로더: $($loaders.Keys -join ', ')" -ForegroundColor Gray
Write-Host "   • 파일 수: $($loaders.Count + 1) (JAR + manifest)" -ForegroundColor Gray
Write-Host ""
Write-Host "🔗 API 엔드포인트:" -ForegroundColor White
Write-Host "   https://hyenimc-worker.devbug.workers.dev/api/mods/$ModId/latest" -ForegroundColor Blue
Write-Host ""

# 임시 파일 정리
Remove-Item -Path $tempDir -Recurse -Force

exit 0
