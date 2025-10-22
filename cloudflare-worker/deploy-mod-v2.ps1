<#
.SYNOPSIS
    HyeniMC Mod Deployment Script v2.0 (PowerShell)

.DESCRIPTION
    Deploy mod files to Cloudflare R2 with v2 API structure

.PARAMETER ConfigFile
    Path to configuration JSON file

.EXAMPLE
    .\deploy-mod-v2.ps1 -ConfigFile deploy-config.json

.NOTES
    Requires: wrangler CLI, PowerShell 5.1+
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true, HelpMessage="Path to configuration JSON file")]
    [string]$ConfigFile
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

Write-ColorOutput "🚀 HyeniMC 모드 배포 v2.0" "Cyan"
Write-ColorOutput "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "Cyan"
Write-Host ""

# Validate config file
if (-not (Test-Path $ConfigFile)) {
    Write-ColorOutput "❌ Error: Config file not found: $ConfigFile" "Red"
    exit 1
}

# Check jq (or use PowerShell JSON parsing)
# We'll use PowerShell's built-in JSON support
try {
    $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
} catch {
    Write-ColorOutput "❌ Error: Failed to parse config file" "Red"
    Write-ColorOutput $_.Exception.Message "Red"
    exit 1
}

# Check wrangler
if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-ColorOutput "❌ Error: wrangler CLI is not installed" "Red"
    Write-ColorOutput "Install: npm install -g wrangler" "Gray"
    exit 1
}

# Parse config
$MOD_ID = $config.modId
$MOD_NAME = $config.name
$VERSION = $config.version
$CATEGORY = $config.category
$CHANGELOG = $config.changelog
$RELEASE_DATE = $config.releaseDate

Write-ColorOutput "📦 모드: $MOD_NAME ($MOD_ID)" "White"
Write-ColorOutput "🔢 버전: $VERSION" "White"
Write-ColorOutput "🏷️  카테고리: $CATEGORY" "White"
Write-Host ""

# Use current date if not specified
if ([string]::IsNullOrEmpty($RELEASE_DATE) -or $RELEASE_DATE -eq "null") {
    $RELEASE_DATE = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

# Create temp directory
$TEMP_DIR = New-Item -ItemType Directory -Path ([System.IO.Path]::GetTempPath()) -Name ("hyenimc_deploy_" + [guid]::NewGuid().ToString().Substring(0,8))
$TEMP_PATH = $TEMP_DIR.FullName

Write-ColorOutput "📁 처리할 파일: $($config.files.Count) 개" "Cyan"
Write-Host ""

# Upload each file
$fileIndex = 0
foreach ($fileConfig in $config.files) {
    $fileIndex++
    $LOADER = $fileConfig.loader
    $GAME_VERSION = $fileConfig.gameVersion
    $FILE_PATH = $fileConfig.file
    
    if (-not (Test-Path $FILE_PATH)) {
        Write-ColorOutput "❌ 파일 없음: $FILE_PATH" "Red"
        Remove-Item -Recurse -Force $TEMP_PATH
        exit 1
    }
    
    $FILE_NAME = Split-Path -Leaf $FILE_PATH
    
    Write-ColorOutput "[$fileIndex/$($config.files.Count)] $LOADER / MC $GAME_VERSION" "Cyan"
    Write-ColorOutput "   파일: $FILE_NAME" "Gray"
    
    # Calculate SHA256
    $SHA256 = (Get-FileHash -Path $FILE_PATH -Algorithm SHA256).Hash.ToLower()
    
    # Get file size
    $FILE_SIZE = (Get-Item $FILE_PATH).Length
    
    Write-ColorOutput "   SHA256: $($SHA256.Substring(0,16))..." "Gray"
    Write-ColorOutput "   크기: $([math]::Round($FILE_SIZE / 1KB)) KB" "Gray"
    
    # Upload to R2
    $R2_PATH = "hyenimc-releases/mods/$MOD_ID/versions/$VERSION/$LOADER/$GAME_VERSION/$FILE_NAME"
    Write-ColorOutput "   📤 업로드: $R2_PATH" "Cyan"
    
    $uploadResult = wrangler r2 object put $R2_PATH --remote --file $FILE_PATH 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-ColorOutput "   ❌ 업로드 실패" "Red"
        Remove-Item -Recurse -Force $TEMP_PATH
        exit 1
    }
    
    Write-ColorOutput "   ✅ 완료" "Green"
    Write-Host ""
}

Write-ColorOutput "📝 manifest.json 생성 중..." "Cyan"

# Build loaders object
$loadersObj = @{}

# Group files by loader
$loaderTypes = $config.files | Select-Object -ExpandProperty loader -Unique

foreach ($loaderType in $loaderTypes) {
    $gameVersionsObj = @{}
    
    foreach ($fileConfig in $config.files | Where-Object { $_.loader -eq $loaderType }) {
        $GAME_VERSION = $fileConfig.gameVersion
        $FILE_PATH = $fileConfig.file
        $FILE_NAME = Split-Path -Leaf $FILE_PATH
        $MIN_LOADER = $fileConfig.minLoaderVersion
        $MAX_LOADER = $fileConfig.maxLoaderVersion
        
        # Calculate SHA256 and size
        $SHA256 = (Get-FileHash -Path $FILE_PATH -Algorithm SHA256).Hash.ToLower()
        $FILE_SIZE = (Get-Item $FILE_PATH).Length
        
        $DOWNLOAD_PATH = "mods/$MOD_ID/versions/$VERSION/$loaderType/$GAME_VERSION/$FILE_NAME"
        
        $gameVersionsObj[$GAME_VERSION] = @{
            file = $FILE_NAME
            sha256 = $SHA256
            size = $FILE_SIZE
            minLoaderVersion = $MIN_LOADER
            maxLoaderVersion = $MAX_LOADER
            downloadPath = $DOWNLOAD_PATH
            dependencies = $fileConfig.dependencies
        }
    }
    
    $loadersObj[$loaderType] = @{
        gameVersions = $gameVersionsObj
    }
}

# Get all unique game versions
$allGameVersions = $config.files | Select-Object -ExpandProperty gameVersion -Unique

# Create manifest
$manifest = @{
    modId = $MOD_ID
    name = $MOD_NAME
    version = $VERSION
    releaseDate = $RELEASE_DATE
    changelog = $CHANGELOG
    gameVersions = @($allGameVersions)
    loaders = $loadersObj
    category = $CATEGORY
}

$MANIFEST_PATH = Join-Path $TEMP_PATH "manifest.json"
$manifest | ConvertTo-Json -Depth 10 | Set-Content $MANIFEST_PATH -Encoding UTF8

Write-ColorOutput "   ✅ 생성 완료" "Green"

# Upload manifest
Write-ColorOutput "📤 manifest 업로드 중..." "Cyan"
$MANIFEST_R2_PATH = "hyenimc-releases/mods/$MOD_ID/versions/$VERSION/manifest.json"

$uploadResult = wrangler r2 object put $MANIFEST_R2_PATH --remote --file $MANIFEST_PATH 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "   ❌ 실패" "Red"
    Remove-Item -Recurse -Force $TEMP_PATH
    exit 1
}

Write-ColorOutput "   ✅ 업로드 완료" "Green"

# Update latest.json
Write-Host ""
Write-ColorOutput "🔄 latest.json 업데이트 중..." "Cyan"

$LATEST_PATH = Join-Path $TEMP_PATH "latest.json"
Copy-Item $MANIFEST_PATH $LATEST_PATH

$LATEST_R2_PATH = "hyenimc-releases/mods/$MOD_ID/latest.json"

$uploadResult = wrangler r2 object put $LATEST_R2_PATH --remote --file $LATEST_PATH 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "   ❌ 실패" "Red"
    Remove-Item -Recurse -Force $TEMP_PATH
    exit 1
}

Write-ColorOutput "   ✅ 업데이트 완료" "Green"

# Cleanup
Remove-Item -Recurse -Force $TEMP_PATH

# Get Worker URL
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerUrlScript = Join-Path $SCRIPT_DIR "scripts\Get-WorkerUrl.ps1"
if (Test-Path $workerUrlScript) {
    $WORKER_URL = & $workerUrlScript
}

Write-Host ""
Write-ColorOutput "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "Cyan"
Write-ColorOutput "🎉 배포 완료!" "Green"
Write-Host ""
Write-ColorOutput "📊 배포 정보:" "White"
Write-ColorOutput "   • 모드: $MOD_NAME ($MOD_ID)" "Gray"
Write-ColorOutput "   • 버전: $VERSION" "Gray"
Write-ColorOutput "   • 카테고리: $CATEGORY" "Gray"
Write-ColorOutput "   • 파일 수: $($config.files.Count)" "Gray"
Write-Host ""
Write-ColorOutput "🔗 API 엔드포인트 (v2):" "White"
Write-Host "   $WORKER_URL/api/v2/mods/$MOD_ID/latest" -ForegroundColor Blue
Write-Host ""
Write-ColorOutput "💡 다음 단계: registry 업데이트" "Yellow"
Write-ColorOutput "   .\update-registry-v2.ps1 $MOD_ID" "Gray"
Write-Host ""
