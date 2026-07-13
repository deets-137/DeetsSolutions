# Register (or update) the nightly SOTD refresh as a Windows Scheduled Task.
#
# Creates a per-user task "DeetsOTD Nightly SOTD" that runs
# scripts/nightly-sotd.ps1 every evening. Re-running updates the existing
# task in place. Runs whether or not you're logged in is NOT set — this is
# a per-user interactive task so it uses your Discord token / git identity.
#
#   powershell -File scripts/register-nightly-sotd.ps1            # 21:00 default
#   powershell -File scripts/register-nightly-sotd.ps1 -At 22:30  # custom time
#
# Remove it later with:
#   Unregister-ScheduledTask -TaskName "DeetsOTD Nightly SOTD" -Confirm:$false

param(
    [string]$At = "21:00",
    [string]$TaskName = "DeetsOTD Nightly SOTD"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "nightly-sotd.ps1"
if (-not (Test-Path $script)) { throw "nightly-sotd.ps1 not found next to this file." }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# If the PC was asleep/off at trigger time, catch up on the next wake.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Nightly Song-of-the-Day pull + local commit for deets.solutions" `
    -Force | Out-Null

Write-Host "Registered '$TaskName' to run daily at $At."
Write-Host "Runs: $script"
Write-Host "Inspect: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
