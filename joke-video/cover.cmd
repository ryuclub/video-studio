@echo off
rem ---------------------------------------------------------------
rem  Cover generator - Windows cmd launcher
rem    cover.cmd
rem    cover.cmd snake-poison "big text"
rem    cover.cmd snake-poison "big text" "series tag"
rem  Output: out\cover\<id>-9x16.png / -3x4.png / -safe-zone
rem  NOTE: this file is ASCII only on purpose. cmd mangles non-ASCII
rem        inside .cmd files; Chinese passed as ARGUMENTS is fine.
rem ---------------------------------------------------------------
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "JOKE=%~1"
set "BIGTEXT=%~2"
set "TAG=%~3"

if not defined JOKE set /p "JOKE=Joke id [snake-poison]: "
if not defined JOKE set "JOKE=snake-poison"

if not exist "jokes\%JOKE%.json" (
  echo.
  echo [x] jokes\%JOKE%.json not found. Available:
  dir /b jokes\*.json
  goto :end
)

if not defined BIGTEXT set /p "BIGTEXT=Cover text: "
if not defined BIGTEXT (
  echo [x] Cover text is required.
  goto :end
)

echo.
echo Rendering cover for %JOKE% ...
if defined TAG (
  call npm run cover -- "jokes/%JOKE%.json" "%BIGTEXT%" "%TAG%"
) else (
  call npm run cover -- "jokes/%JOKE%.json" "%BIGTEXT%"
)
if errorlevel 1 (
  echo.
  echo [x] Failed. Check: npm install done? ffmpeg on PATH?
  goto :end
)

echo.
echo Done. Opening out\cover ...
start "" "out\cover"

:end
echo.
pause
endlocal
