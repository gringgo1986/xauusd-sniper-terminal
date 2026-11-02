# XAU/USD Smart Sniper Launcher
Set-Location $PSScriptRoot
Write-Host "========================================================" -ForegroundColor Yellow
Write-Host "       XAU/USD SMART SNIPER TRADING TERMINAL" -ForegroundColor Gold
Write-Host "    Institutional SMC & Liquidity Confluence Engine" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Membuka http://localhost:8000 di pelayar..." -ForegroundColor Green
Start-Process "http://localhost:8000"
& ".\.venv\Scripts\python.exe" main.py
