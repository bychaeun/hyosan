@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unregister-ScheduledTask -TaskName 'HYOSAN Order Board Sync' -Confirm:$false -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'hyosan-board') -ErrorAction SilentlyContinue; Write-Host 'Removed: scheduled task and saved accounts on this PC.'"
pause
