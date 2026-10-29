# 수주현황판 자동 전송 설치 — 이 PC에 DB 읽기 계정·전송 키를 암호화 저장하고, 켜져 있는 동안 10분마다 실행되게 등록한다.
$ErrorActionPreference = 'Stop'
$taskName = 'HYOSAN Order Board Sync'
$dir = Join-Path $env:APPDATA 'hyosan-board'
$app = Join-Path $dir 'order-sync'
New-Item -ItemType Directory -Force $app | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'sync.ps1'), (Join-Path $PSScriptRoot 'run-hidden.vbs') $app -Force

Write-Host '== 효산 수주현황판 자동 전송 설치 ==' -ForegroundColor Cyan
$credPath = Join-Path $dir 'cred.json'
$reuse = $false
if (Test-Path $credPath) { $reuse = (Read-Host '이 PC에 저장된 DB 읽기 계정이 있습니다. 그대로 쓸까요? (Y/n)') -notmatch '^[nN]' }
if (-not $reuse) {
  $server = Read-Host '서버 주소 (그냥 Enter = Erp.shts.co.kr)'; if (-not $server) { $server = 'Erp.shts.co.kr' }
  $db = Read-Host 'DB 이름 (그냥 Enter = hyosanlpl)'; if (-not $db) { $db = 'hyosanlpl' }
  $user = Read-Host '읽기 전용 아이디'
  $pw = Read-Host '읽기 전용 비밀번호 (입력해도 화면에 안 보입니다)' -AsSecureString
  [pscustomobject]@{ server = $server; db = $db; user = $user; pw = ($pw | ConvertFrom-SecureString) } | ConvertTo-Json | Set-Content $credPath -Encoding UTF8
}
$key = Read-Host '수주 전송 키 (관리자에게 받은 값, 입력해도 화면에 안 보입니다)' -AsSecureString
[pscustomobject]@{ key = ($key | ConvertFrom-SecureString) } | ConvertTo-Json | Set-Content (Join-Path $dir 'push.json') -Encoding UTF8

Write-Host '첫 전송으로 연결을 확인하는 중…'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $app 'sync.ps1')
if ($LASTEXITCODE -ne 0) {
  Write-Host '첫 전송에 실패했습니다. 위의 "실패:" 문구를 관리자에게 알려주세요. 설치는 등록하지 않았습니다.' -ForegroundColor Red
  Read-Host 'Enter를 누르면 닫힙니다'; exit 1
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $app 'run-hidden.vbs') + '"')
$every10 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($every10, $logon) -Settings $settings -Description 'HYOSAN ERP order board -> web app, every 10 minutes (read-only)' -Force | Out-Null
Write-Host '설치 완료: 이 PC가 켜져 있는 동안 10분마다 자동으로 전송합니다. 창은 뜨지 않습니다.' -ForegroundColor Green
Write-Host "기록: $dir\sync.log"
Read-Host 'Enter를 누르면 닫힙니다'
