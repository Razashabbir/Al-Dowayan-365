@echo off
REM Step 6: scheduled by Windows Task Scheduler. Logs go to etl\logs\etl_YYYYMMDD.log
cd /d "%~dp0"
if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set D=%%i
call .venv\Scripts\activate.bat
python etl.py >> logs\etl_%D%.log 2>&1
exit /b %ERRORLEVEL%
