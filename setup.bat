@echo off
setlocal
:: Project NEXUS - one-shot setup for Windows.
:: This is a thin wrapper: the real work is nexus\scripts\setup.ps1, which ships
:: with the project and is called unchanged.

echo.
echo === Project NEXUS setup ===
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [X] node not found on PATH. Node 20 or newer is required - the Dockerfile
    echo     builds on node:20-alpine.
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo [ok] node %%v

where npm >nul 2>nul
if errorlevel 1 ( echo [X] npm not found on PATH. & exit /b 1 )
echo [ok] npm found

where ollama >nul 2>nul
if errorlevel 1 (
    echo [!] ollama not found on PATH. setup.ps1 will skip the model step.
    echo     Install it from https://ollama.com and re-run this script.
) else (
    echo [ok] ollama found
)

where python >nul 2>nul
if errorlevel 1 (
    echo [!] python not found on PATH. The LoRA training deps will be skipped;
    echo     the server and UI do not need Python.
) else (
    echo [ok] python found
)

echo.
echo Running nexus\scripts\setup.ps1
echo   - npm install for the server and the client
echo   - pip install -r training\lora\requirements.txt
echo   - ollama pull phi3.5  (~2.2 GB)
echo   - ollama create for the 8 agent models
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0nexus\scripts\setup.ps1"
if errorlevel 1 (
    echo.
    echo [X] setup.ps1 reported a failure. See the output above.
    exit /b 1
)

echo.
echo === Start it ===
echo   1. ollama serve                  (if it is not already running)
echo   2. cd nexus ^&^& npm run dev:server    -^> http://127.0.0.1:3001
echo   3. cd nexus ^&^& npm run dev:client    -^> http://localhost:5173
echo.
echo Or the whole stack in Docker:  cd nexus ^&^& docker compose up
echo.
