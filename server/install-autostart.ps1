<#
Starts the WhatsApp Reader chat server at every Windows logon, with no
console window (conhost --headless). Output goes to
%LOCALAPPDATA%\WhatsReaderServer\server.log.

  Install:    powershell -ExecutionPolicy Bypass -File server\install-autostart.ps1
  Remove:     powershell -ExecutionPolicy Bypass -File server\install-autostart.ps1 -Uninstall
#>
param([switch]$Uninstall)

$TaskName = 'WhatsApp Reader server'

if ($Uninstall) {
	Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
	Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
	Write-Host "Removed '$TaskName'."
	return
}

$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$logDir = Join-Path $env:LOCALAPPDATA 'WhatsReaderServer'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$inner = "`"`"$node`" `"$repo\server\wa-server.mjs`" >> `"$logDir\server.log`" 2>&1`""
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
	-Argument "--headless cmd.exe /d /c $inner" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
	-ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
	-MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Force `
	-Description 'Private chat-library server for WhatsApp Backup Reader (127.0.0.1:8190, reached from the phone via tailscale serve).' `
	-Action $action -Trigger $trigger -Settings $settings | Out-Null

# Stop a copy started by hand so the task can take over port 8190
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
	Where-Object { $_.CommandLine -like '*wa-server.mjs*' } |
	ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed '$TaskName' and started it. Log: $logDir\server.log"
