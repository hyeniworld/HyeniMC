<#
.SYNOPSIS
  HyeniPack V2 Deployment Script (Windows)
.DESCRIPTION
  <pack>.hyenipack + <pack>.latest.json 쌍을 R2에 업로드한다.
  롤백: 이전 버전 파일 쌍으로 다시 실행하면 됨.
.EXAMPLE
  .\deploy-hyenipack.ps1 -Pack .\MyPack-1.2.0.hyenipack
#>
param(
    [Parameter(Mandatory=$true)][string]$Pack
)

$ErrorActionPreference = "Stop"
$Bucket = "hyenimc-releases"

if (-not (Test-Path $Pack)) { Write-Error "pack file not found: $Pack" }
$LatestFile = $Pack -replace '\.hyenipack$', '.latest.json'
if (-not (Test-Path $LatestFile)) { Write-Error "latest.json not found: $LatestFile" }

$json = Get-Content $LatestFile -Raw | ConvertFrom-Json
$PackId = $json.hyenipackId
$Version = $json.version
$Sha256 = $json.sha256

if ($PackId -notmatch '^[a-z0-9][a-z0-9-]{0,63}$') { Write-Error "Invalid hyenipackId: $PackId" }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Write-Error "Invalid version: $Version" }

$ActualSha = (Get-FileHash $Pack -Algorithm SHA256).Hash.ToLower()
if ($ActualSha -ne $Sha256) { Write-Error "sha256 mismatch! latest.json=$Sha256 actual=$ActualSha" }

Write-Host "Deploying $PackId v$Version ..." -ForegroundColor Cyan

wrangler r2 object put "$Bucket/modpacks/$PackId/versions/$Version/pack.hyenipack" --remote --file $Pack
if ($LASTEXITCODE -ne 0) { Write-Error "pack upload failed" }
wrangler r2 object put "$Bucket/modpacks/$PackId/latest.json" --remote --file $LatestFile --content-type "application/json"
if ($LASTEXITCODE -ne 0) { Write-Error "latest.json upload failed" }

Write-Host "Done. latest -> v$Version" -ForegroundColor Green
