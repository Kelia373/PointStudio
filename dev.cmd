@echo off
rem Double-click entry point: start the desktop app in development mode.
rem -ExecutionPolicy Bypass applies to this one call only; it does not change
rem the machine-wide PowerShell policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev.ps1" %*
if errorlevel 1 pause
