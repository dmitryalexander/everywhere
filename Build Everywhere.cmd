@echo off
rem Builds Everywhere; the full output is also saved in build-log.txt.
powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0Build.ps1' *>&1 | Tee-Object -FilePath '%~dp0build-log.txt'"
pause
