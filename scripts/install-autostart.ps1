# Creates (or replaces) the "Ciara Assistant" scheduled task, which runs
# scripts/serve.mjs when Windows starts, before anyone logs in.
# Run it from an administrator PowerShell window.
#
#   Install:  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#   Remove:   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
#
# -UserId sets the account that runs the app. It defaults to whoever runs this
# script. Pass it if the administrator window belongs to a different account.

param(
    [switch]$Remove,
    [string]$UserId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
)

$ErrorActionPreference = 'Stop'
$taskName = 'Ciara Assistant'

$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an administrator PowerShell window.'
}

if ($Remove) {
    Stop-ScheduledTask -TaskName $taskName
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed the '$taskName' task."
    return
}

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe).Source

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\scripts\serve.mjs`"" -WorkingDirectory $root

# At boot, plus a check every minute that starts the app again if it stopped.
# The check does nothing while the app is running (MultipleInstances IgnoreNew).
$boot = New-ScheduledTaskTrigger -AtStartup
$boot.Delay = 'PT20S'
$check = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)

# S4U: runs whether or not the user is logged in, with no stored password.
# Limited: the app itself gets no administrator rights.
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Force -Action $action -Trigger $boot, $check `
    -Principal $principal -Settings $settings `
    -Description 'Runs Ciara Assistant (web app on port 5174, API on port 3001).' | Out-Null

Write-Host "Created the '$taskName' task for $UserId. It starts within a minute, once ports 3001 and 5174 are free."
