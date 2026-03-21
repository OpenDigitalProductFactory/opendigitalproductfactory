@echo off
REM Launcher for fresh-install.ps1 — bypasses execution policy.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fresh-install.ps1" %*
