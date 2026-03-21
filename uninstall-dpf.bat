@echo off
REM Launcher for uninstall-dpf.ps1 -- auto-elevates to Administrator
REM and bypasses execution policy.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell.exe -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\" %*\"' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-dpf.ps1" %*
pause
