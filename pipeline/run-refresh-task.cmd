@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%~dp0'; .\refresh-and-push.ps1"
