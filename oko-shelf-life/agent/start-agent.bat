@echo off
cd /d "%~dp0"
echo Starting KitchenDesk print agent...
node print-agent.js --install-autostart
if errorlevel 1 (
  echo.
  echo ERROR: could not run node. Is Node.js installed?
  pause
  exit /b 1
)
wscript "KitchenDeskPrintAgent.vbs"
echo.
echo Done. The agent is now running in the background and will start
echo automatically every time this computer turns on.
echo A test receipt should print in a few seconds - check the printer.
echo You can close this window now.
pause ^>nul
