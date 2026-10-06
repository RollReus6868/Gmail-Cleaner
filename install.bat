@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "LOG=%~dp0install.log"
echo Gmail Cleaner - cai dat > "%LOG%"

call :findpy
if not defined PY goto :nopy
echo Dung Python: %PY%
echo Python: %PY% >> "%LOG%"

rem Moi truong .venv hong tu lan chay truoc thi xoa di tao lai
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys" >nul 2>&1 || rmdir /s /q ".venv"
)
if not exist ".venv\Scripts\python.exe" (
  echo Dang tao moi truong rieng .venv ...
  %PY% -m venv .venv >> "%LOG%" 2>&1 || goto :fail
)
echo Dang tai thu vien, mat vai phut ...
".venv\Scripts\python.exe" -m pip install --upgrade pip >> "%LOG%" 2>&1
".venv\Scripts\python.exe" -m pip install -r requirements.txt >> "%LOG%" 2>&1 || goto :fail
".venv\Scripts\python.exe" -c "import playwright" >> "%LOG%" 2>&1 || goto :fail

echo.
echo XONG. Bam dup run.bat de mo Gmail Cleaner.
if not "%~1"=="nopause" pause
exit /b 0

:nopy
echo.
echo KHONG TIM THAY PYTHON. Chon mot trong hai cach:
echo  1. Cai Python tu https://www.python.org/downloads/ va nho tich
echo     "Add python.exe to PATH" o man hinh dau tien.
echo  2. Neu da cai roi: vao Settings ^> Apps ^> Advanced app settings ^>
echo     App execution aliases, tat 2 muc "python.exe" va "python3.exe".
echo Sau do chay lai install.bat.
if not "%~1"=="nopause" pause
exit /b 1

:fail
echo.
echo CAI DAT LOI. 25 dong cuoi cua install.log:
powershell -NoProfile -Command "Get-Content -Tail 25 '%LOG%'"
echo.
echo Hay gui file install.log de duoc ho tro.
if not "%~1"=="nopause" pause
exit /b 1

rem ---- Tim Python bang cach CHAY THU, khong tin "where python" (Windows co
rem ---- file gia python.exe chi in "Python was not found") ----
:findpy
set "PY="
for %%C in ("py -3" "python" "python3") do if not defined PY call :trypy %%~C
exit /b

:trypy
set "OUT="
for /f "delims=" %%L in ('%* --version 2^>^&1') do if not defined OUT set "OUT=%%L"
echo %OUT% | findstr /i /c:"was not found" >nul && exit /b
echo %OUT% | findstr /r /c:"^Python [0-9]" >nul || exit /b
set "PY=%*"
exit /b
