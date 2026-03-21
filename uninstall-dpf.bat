@echo off
REM Launcher for uninstall-dpf.ps1 — bypasses execution policy so users
REM don't need to change system-wide settings.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-dpf.ps1" %*
