# Register (or update) the DeetsRadio token re-sign as a Windows Scheduled Task.
#
# Creates a per-user task "DeetsRadio Token Re-sign" that runs
# scripts/radio-token.ps1 every evening. The script itself is expiry-gated
# (re-signs only within 30 days of expiry), so the nightly run is a no-op
# most of the year. Re-running this registrar updates the task in place.
#
#   powershell -File scripts/register-nightly-radio-token.ps1             # 21:15 default
#   powershell -File scripts/register-nightly-radio-token.ps1 -At 22:45   # custom time
#
# Remove it later with:
#   Unregister-ScheduledTask -TaskName "DeetsRadio Token Re-sign" -Confirm:$false

param(
    [string]$At = "21:15",
    [string]$TaskName = "DeetsRadio Token Re-sign"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "radio-token.ps1"
if (-not (Test-Path $script)) { throw "radio-token.ps1 not found next to this file." }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# If the PC was asleep/off at trigger time, catch up on the next wake.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Re-sign the DeetsRadio Apple Music developer token when near expiry" `
    -Force | Out-Null

Write-Host "Registered '$TaskName' to run daily at $At."
Write-Host "Runs: $script"
Write-Host "Inspect: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
