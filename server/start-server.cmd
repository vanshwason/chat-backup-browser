@echo off
rem Launched by the "Chat Backup Browser server" logon task (install-autostart.ps1).
rem conhost --headless mangles nested quotes, so the log redirect lives here.
set "LOGDIR=%LOCALAPPDATA%\ChatBackupBrowser"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
cd /d "%~dp0.."
node server\wa-server.mjs >> "%LOGDIR%\server.log" 2>&1
