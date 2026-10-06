@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo Chua cai dat. Hay bam dup install.bat truoc.
  pause
  exit /b 1
)
start "" ".venv\Scripts\pythonw.exe" app.py
