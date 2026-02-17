#!/usr/bin/env pwsh
# Underdog-only run: build, optimize, push to Sheets
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
    Write-Host "=== Building TypeScript ===" -ForegroundColor Cyan
    npx tsc -p .

    Write-Host "=== Running Underdog Optimizer ===" -ForegroundColor Cyan
    node dist/run_underdog_optimizer.js

    Write-Host "=== Pushing UD-Legs to Sheets ===" -ForegroundColor Cyan
    python sheets_push_underdog_legs.py

    Write-Host "=== Pushing Cards to Sheets ===" -ForegroundColor Cyan
    python sheets_push_cards.py

    Write-Host "`n=== Underdog run complete ===" -ForegroundColor Green
} finally {
    Pop-Location
}
