@echo off
cd /d "%~dp0"
echo Starting AI Quota Dashboard (v0.2.0)...
call npm.cmd run start:desktop
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to start AI Quota Dashboard. See error above.
  pause
)
