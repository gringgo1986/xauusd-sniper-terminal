@echo off
title XAU/USD Smart Sniper Terminal
echo ========================================================
echo        XAU/USD SMART SNIPER TRADING TERMINAL
echo      Institutional SMC & Liquidity Confluence Engine
echo ========================================================
echo.
cd /d "%~dp0"
echo Memulakan pelayan server pada http://localhost:8000 ...
start http://localhost:8000
.\.venv\Scripts\python.exe main.py
pause
