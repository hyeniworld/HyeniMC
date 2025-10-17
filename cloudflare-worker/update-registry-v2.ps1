<#
.SYNOPSIS
    Update mod registry v2 from deployed mods (PowerShell)

.DESCRIPTION
    Fetch mod information from Worker API and update registry.json

.PARAMETER ModIds
    Array of mod IDs to include in registry

.EXAMPLE
    .\update-registry-v2.ps1 -ModIds @("hyenihelper", "hyenicore")

.EXAMPLE
    .\update-registry-v2.ps1 hyenihelper

.NOTES
    Requires: wrangler CLI, PowerShell 5.1+
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true, Position=0, ValueFromRemainingArguments=$true)]
    [string[]]$ModIds
)

$ErrorActionPreference = "Stop"

# Colors
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    
    $colorMap = @{
        "Red" = "Red"
        "Green" = "Green"
        "Yellow" = "Yellow"
        "Cyan" = "Cyan"
        "Gray" = "DarkGray"
        "White" = "White"
    }
    
    Write-Host $Message -ForegroundColor $colorMap[$Color]
}

# Check wrangler
if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-ColorOutput "❌ Error: wrangler CLI is not installed" "Red"
    Write-ColorOutput "Install: npm install -g wrangler" "Gray"
    exit 1
}

# Get Worker URL
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerUrlScript = Join-Path $SCRIPT_DIR "scripts\Get-WorkerUrl.ps1"
if (Test-Path $workerUrlScript) {
    $WORKER_URL = & $workerUrlScript
}

Write-ColorOutput "📝 모드 레지스트리 업데이트 v2.0" "Cyan"
Write-ColorOutput "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "Cyan"
Write-Host ""
Write-ColorOutput "✅ 발견된 모드: $($ModIds.Count) 개" "Green"
Write-Host ""

# Collect mod information
$modsList = @()

foreach ($MOD_ID in $ModIds) {
    Write-ColorOutput "📦 $MOD_ID 정보 수집 중..." "Cyan"
    
    $API_URL = "$WORKER_URL/api/v2/mods/$MOD_ID/latest"
    
    try {
        $response = Invoke-RestMethod -Uri $API_URL -Method Get -ErrorAction Stop
    } catch {
        Write-ColorOutput "   ❌ 실패: 정보를 가져올 수 없습니다." "Red"
        continue
    }
    
    # Parse response
    $VERSION = $response.version
    $NAME = $response.name
    $GAME_VERSIONS = $response.gameVersions
    $LOADERS = $response.loaders
    
    if ([string]::IsNullOrEmpty($VERSION)) {
        Write-ColorOutput "   ❌ 실패: 버전 정보를 찾을 수 없습니다." "Red"
        continue
    }
    
    # Build loaders compatibility array
    $loadersArray = @()
    
    foreach ($loaderType in $LOADERS.PSObject.Properties.Name) {
        $loaderData = $LOADERS.$loaderType
        
        # Get game versions for this loader
        $loaderGameVersions = @($loaderData.gameVersions.PSObject.Properties.Name)
        
        # Get min loader version (from first game version)
        $firstGameVer = $loaderGameVersions[0]
        $firstGameVerData = $loaderData.gameVersions.$firstGameVer
        $MIN_LOADER_VER = $firstGameVerData.minLoaderVersion
        if ([string]::IsNullOrEmpty($MIN_LOADER_VER)) {
            $MIN_LOADER_VER = "0.0.0"
        }
        
        $MAX_LOADER_VER = $firstGameVerData.maxLoaderVersion
        if ([string]::IsNullOrEmpty($MAX_LOADER_VER) -or $MAX_LOADER_VER -eq "null") {
            $MAX_LOADER_VER = $null
        }
        
        $loadersArray += @{
            type = $loaderType
            minVersion = $MIN_LOADER_VER
            maxVersion = $MAX_LOADER_VER
            supportedGameVersions = $loaderGameVersions
        }
    }
    
    # Determine category (default: optional)
    $CATEGORY = "optional"
    
    # Add to list
    $modsList += @{
        id = $MOD_ID
        name = $NAME
        description = "HyeniMC $MOD_ID mod"
        latestVersion = $VERSION
        category = $CATEGORY
        gameVersions = $GAME_VERSIONS
        loaders = $loadersArray
        dependencies = @{
            required = @()
            optional = @()
        }
    }
    
    Write-ColorOutput "   ✅ 수집 완료: v$VERSION" "Green"
}

if ($modsList.Count -eq 0) {
    Write-Host ""
    Write-ColorOutput "❌ 수집된 모드 정보가 없습니다." "Red"
    exit 1
}

Write-Host ""
Write-ColorOutput "📝 registry.json 생성 중..." "Cyan"

# Create temp directory
$TEMP_DIR = New-Item -ItemType Directory -Path ([System.IO.Path]::GetTempPath()) -Name ("hyenimc_registry_" + [guid]::NewGuid().ToString().Substring(0,8))
$TEMP_PATH = $TEMP_DIR.FullName

# Create registry
$registry = @{
    version = "2.0"
    lastUpdated = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    mods = $modsList
}

$REGISTRY_PATH = Join-Path $TEMP_PATH "registry.json"
$registry | ConvertTo-Json -Depth 10 | Set-Content $REGISTRY_PATH -Encoding UTF8

# Validate JSON
try {
    $null = Get-Content $REGISTRY_PATH -Raw | ConvertFrom-Json
} catch {
    Write-ColorOutput "   ❌ 생성된 JSON이 유효하지 않습니다" "Red"
    Remove-Item -Recurse -Force $TEMP_PATH
    exit 1
}

Write-ColorOutput "   ✅ 생성 완료" "Green"

# Upload to R2
Write-ColorOutput "📤 R2에 업로드 중..." "Cyan"

$uploadResult = wrangler r2 object put "hyenimc-releases/mods/registry.json" --remote --file $REGISTRY_PATH 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "   ❌ 업로드 실패" "Red"
    Remove-Item -Recurse -Force $TEMP_PATH
    exit 1
}

Write-ColorOutput "   ✅ 업로드 완료" "Green"

# Cleanup
Remove-Item -Recurse -Force $TEMP_PATH

Write-Host ""
Write-ColorOutput "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "Cyan"
Write-ColorOutput "✅ 레지스트리 업데이트 완료!" "Green"
Write-Host ""
Write-ColorOutput "📊 업데이트된 모드: $($ModIds.Count) 개" "White"
Write-Host ""
Write-ColorOutput "🔗 확인 (v2):" "White"
Write-Host "   $WORKER_URL/api/v2/mods" -ForegroundColor Blue
Write-Host ""
