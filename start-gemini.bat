@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\agy\bin;%PATH%"
wt.exe -d . cmd /k "chcp 65001 >nul && echo 啟動 Antigravity CLI (使用 dong1121.ai@gmail.com Pro 額度) ... && agy"