<#
Starts the Chat Backup Browser phone server at every Windows logon, with no
console window (conhost --headless). Output goes to
%LOCALAPPDATA%\ChatBackupBrowser\server.log.

  Install:    powershell -ExecutionPolicy Bypass -File server\install-autostart.ps1
  Remove:     powershell -ExecutionPolicy Bypass -File server\install-autostart.ps1 -Uninstall
#>
param([switch]$Uninstall)

$TaskName = 'Chat Backup Browser server'
# Names used before the rename; cleaned up on install and uninstall
$LegacyTaskName = 'WhatsApp Reader server'
$LegacyDir = Join-Path $env:LOCALAPPDATA 'WhatsReaderServer'

foreach ($name in @($LegacyTaskName) + $(if ($Uninstall) { @($TaskName) } else { @() })) {
	Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
	Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
if ($Uninstall) {
	Write-Host "Removed '$TaskName'."
	return
}

$repo = Split-Path -Parent $PSScriptRoot
Get-Command node -ErrorAction Stop | Out-Null
if (-not (Test-Path (Join-Path $repo 'build\index.html'))) {
	throw "The web app isn't built yet. Run 'npm run build' in $repo first."
}

$logDir = Join-Path $env:LOCALAPPDATA 'ChatBackupBrowser'
# Keep the already-extracted chats from the old folder instead of redoing them
if ((Test-Path $LegacyDir) -and -not (Test-Path $logDir)) {
	Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
		Where-Object { $_.CommandLine -like '*wa-server.mjs*' } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
	Start-Sleep -Seconds 1
	Move-Item -LiteralPath $LegacyDir -Destination $logDir
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# conhost --headless breaks on nested quotes, so it runs a wrapper that does
# the logging instead of an inline cmd.exe /c command.
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
	-Argument "--headless `"$repo\server\start-server.cmd`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
	-ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
	-MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Force `
	-Description 'Private chat-library server for Chat Backup Browser (127.0.0.1:8190, reached from the phone via tailscale serve).' `
	-Action $action -Trigger $trigger -Settings $settings | Out-Null

# Stop a copy started by hand so the task can take over port 8190
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
	Where-Object { $_.CommandLine -like '*wa-server.mjs*' } |
	ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed '$TaskName' and started it. Log: $logDir\server.log"
