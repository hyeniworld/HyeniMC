#!/usr/bin/env pwsh
<#
.SYNOPSIS
    wrangler.toml에서 Worker URL을 읽어옵니다.

.DESCRIPTION
    wrangler.toml의 [vars] 섹션에서 WORKER_URL을 파싱합니다.
    설정이 없으면 name 필드를 기반으로 기본 URL을 생성합니다.

.OUTPUTS
    Worker URL 문자열

.EXAMPLE
    $workerUrl = & "$PSScriptRoot\Get-WorkerUrl.ps1"
#>

$ErrorActionPreference = "Stop"

# wrangler.toml 파일 경로
$wranglerTomlPath = Join-Path $PSScriptRoot ".." "wrangler.toml"

if (-not (Test-Path $wranglerTomlPath)) {
    Write-Error "wrangler.toml 파일을 찾을 수 없습니다: $wranglerTomlPath"
    exit 1
}

# wrangler.toml 파일 읽기
$content = Get-Content -Path $wranglerTomlPath -Raw

# [vars] 섹션에서 WORKER_URL 찾기
if ($content -match '(?ms).*?WORKER_URL\s*=\s*"([^"]+)"') {
    $workerUrl = $matches[1]
    Write-Output $workerUrl
    exit 0
}

# WORKER_URL이 없으면 name 필드에서 기본 URL 생성
if ($content -match 'name\s*=\s*"([^"]+)"') {
    $workerName = $matches[1]
    
    # 계정명을 환경변수나 기본값에서 가져오기
    $accountName = $env:CLOUDFLARE_ACCOUNT_NAME
    if (-not $accountName) {
        # wrangler whoami로 계정 정보 가져오기 시도
        try {
            $whoamiOutput = wrangler whoami 2>&1 | Out-String
            if ($whoamiOutput -match 'Account Name:\s*(.+)') {
                $accountName = $matches[1].Trim()
            }
        } catch {
            # wrangler가 없거나 로그인 안 됨
        }
    }
    
    if (-not $accountName) {
        Write-Error @"
wrangler.toml에 WORKER_URL이 설정되지 않았습니다.

다음 중 하나를 수행하세요:
1. wrangler.toml에 WORKER_URL 추가:
   [vars]
   WORKER_URL = "https://your-worker.your-account.workers.dev"

2. 환경변수 설정:
   `$env:CLOUDFLARE_ACCOUNT_NAME = "your-account"

3. wrangler login 실행
"@
        exit 1
    }
    
    # 기본 URL 생성
    $defaultUrl = "https://$workerName.$accountName.workers.dev"
    Write-Output $defaultUrl
    exit 0
}

Write-Error "wrangler.toml에서 name 또는 WORKER_URL을 찾을 수 없습니다."
exit 1
