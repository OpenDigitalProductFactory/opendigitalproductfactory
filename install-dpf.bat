@echo off
REM Launcher for install-dpf.ps1 — bypasses execution policy so users
REM don't need to change system-wide settings.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-dpf.ps1" %*
