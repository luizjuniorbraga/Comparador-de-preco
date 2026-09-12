@echo off
title Comparador de Precos
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js nao encontrado. Instale em https://nodejs.org
    pause
    exit /b 1
)

>nul 2>nul curl -s http://localhost:3000/health
if not errorlevel 1 (
    echo Servidor ja esta rodando. Abrindo o app...
    start "" http://localhost:3000
    exit /b 0
)

echo Iniciando servidor em http://localhost:3000 ...
start "Comparador de Precos - Servidor" cmd /k node server.js
timeout /t 3 /nobreak >nul
start "" http://localhost:3000