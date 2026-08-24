@echo off
setlocal

set "APP_PORT=5173"
set "APP_DIR=%~dp0"

title LAB 7

echo ==========================================
echo LAB 7
echo ==========================================
echo.

netstat -ano | find ":%APP_PORT%" | find "LISTENING" >nul
if %errorlevel%==0 (
    echo [INFO] Server already running on port %APP_PORT%.
) else (
    echo [INFO] Starting local server in "%APP_DIR%"...
    where node >nul 2>&1
    if %errorlevel%==0 (
        start "Lab7Server" /min cmd /c "cd /d "%APP_DIR%" && set PORT=%APP_PORT% && node "%APP_DIR%server.js""
    ) else (
        echo [WARN] Node not found. Falling back to npx serve.
        start "Lab7Server" /min cmd /c "cd /d "%APP_DIR%" && npx --yes serve -l %APP_PORT% ."
    )
    echo [INFO] Waiting for server...
    timeout /t 2 /nobreak >nul
)

set "GAME_URL=http://localhost:%APP_PORT%/"
echo [INFO] Opening game: %GAME_URL%
start "" "%GAME_URL%"

echo.
echo [INFO] Do not open index.html via file:// double-click.
echo [INFO] Close the "Lab7Server" window to stop the server.
endlocal
exit /b 0
