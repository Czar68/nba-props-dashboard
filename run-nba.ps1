# run-nba.ps1
# One-click NBA pipeline: compile → optimize → sheets → dashboard
# Usage: .\run-nba.ps1 [-Sport NBA|NCAAB|All] [-Date YYYY-MM-DD] [-Games "HOU@CHA,BKN@CLE"]

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("NBA", "NCAAB", "All")]
    [string]$Sport = "NBA",
    
    [Parameter(Mandatory=$false)]
    [string]$Date = "",
    
    [Parameter(Mandatory=$false)]
    [string]$Games = ""
)

# Colors for logging
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Warning { Write-Host $args -ForegroundColor Yellow }
function Write-Error { Write-Host $args -ForegroundColor Red }

# Get script directory (project root)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Info "=========================================="
Write-Info "NBA Props Optimizer - One-Click Pipeline"
Write-Info "=========================================="
Write-Info "Sport: $Sport"
if ($Date) { Write-Info "Date: $Date" }
if ($Games) { Write-Info "Games: $Games" }
Write-Info ""

$ErrorActionPreference = "Stop"
$startTime = Get-Date
$errors = @()

# Step 1: Compile TypeScript
Write-Info "[1/4] Compiling TypeScript..."
try {
    $compileOutput = npx tsc -p . 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "TypeScript compilation failed: $compileOutput"
    }
    Write-Success "✅ TypeScript compiled successfully"
} catch {
    Write-Error "❌ Compilation failed: $_"
    $errors += "Compilation"
    exit 1
}

# Step 2: Run optimizer
Write-Info ""
Write-Info "[2/4] Running optimizer (Sport: $Sport)..."
try {
    $optimizerArgs = @("dist/run_optimizer.js", "--sports", $Sport)
    if ($Date) {
        # Note: Date filtering may need to be added to CLI args if not supported
        Write-Warning "Date filter not yet implemented in CLI - using today's slate"
    }
    
    $optimizerOutput = node $optimizerArgs 2>&1 | Tee-Object -Variable fullOutput
    
    if ($LASTEXITCODE -ne 0) {
        throw "Optimizer failed with exit code $LASTEXITCODE"
    }
    
    # Check for output CSVs
    $legsCsv = "prizepicks-legs.csv"
    $cardsCsv = "prizepicks-cards.csv"
    
    if (-not (Test-Path $legsCsv)) {
        throw "Output CSV not found: $legsCsv"
    }
    
    $legCount = (Import-Csv $legsCsv | Measure-Object).Count
    $cardCount = if (Test-Path $cardsCsv) { (Import-Csv $cardsCsv | Measure-Object).Count } else { 0 }
    
    Write-Success "✅ Optimizer completed"
    Write-Info "   Legs: $legCount | Cards: $cardCount"
    
    # Show sample games if CSV exists
    if ($legCount -gt 0) {
        $sampleLegs = Import-Csv $legsCsv | Select-Object -First 5
        $games = $sampleLegs | ForEach-Object { $_.gameId } | Select-Object -First 3
        Write-Info "   Sample games: $($games -join ', ')"
    }
} catch {
    Write-Error "❌ Optimizer failed: $_"
    $errors += "Optimizer"
    exit 1
}

# Step 3: Push to Sheets (optional - graceful if SA missing)
Write-Info ""
Write-Info "[3/4] Pushing to Google Sheets..."
$saPath = $env:GOOGLE_APPLICATION_CREDENTIALS
if (-not $saPath) {
    $saPath = ".\config\local-sa.json"
}

if (Test-Path $saPath) {
    try {
        $env:GOOGLE_APPLICATION_CREDENTIALS = $saPath
        $sheetsOutput = npm run test-sheets 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "✅ Sheets push completed"
        } else {
            Write-Warning "⚠️ Sheets push failed (non-critical): $sheetsOutput"
        }
    } catch {
        Write-Warning "⚠️ Sheets push error (non-critical): $_"
    }
} else {
    Write-Warning "⚠️ SA file not found at $saPath - skipping Sheets push"
    Write-Warning "   Set GOOGLE_APPLICATION_CREDENTIALS env var or place SA at .\config\local-sa.json"
}

# Step 4: Build dashboard
Write-Info ""
Write-Info "[4/4] Building dashboard..."
try {
    Push-Location web-dashboard
    $buildOutput = npm run build 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        throw "Dashboard build failed: $buildOutput"
    }
    
    if (-not (Test-Path "dist/index.html")) {
        throw "Dashboard dist/index.html not found after build"
    }
    
    Write-Success "✅ Dashboard built successfully"
    Write-Info "   Output: web-dashboard\dist\"
} catch {
    Write-Error "❌ Dashboard build failed: $_"
    $errors += "Dashboard"
    exit 1
} finally {
    Pop-Location
}

# Summary
$endTime = Get-Date
$duration = $endTime - $startTime

Write-Info ""
Write-Info "=========================================="
if ($errors.Count -eq 0) {
    Write-Success "✅ Pipeline completed successfully!"
    Write-Info "Duration: $($duration.TotalSeconds.ToString('F1'))s"
    Write-Info "Next: Deploy web-dashboard\dist\ to Netlify"
} else {
    Write-Error "❌ Pipeline completed with errors: $($errors -join ', ')"
    Write-Info "Duration: $($duration.TotalSeconds.ToString('F1'))s"
    exit 1
}
