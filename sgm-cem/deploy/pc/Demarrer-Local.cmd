@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Lancer-Local-VPS.ps1" -WebPort 3005
if errorlevel 1 (
  echo.
  echo Le demarrage local a echoue. Consultez le message ci-dessus.
  pause
  exit /b 1
)
