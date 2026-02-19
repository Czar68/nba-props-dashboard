# deploy-nba.ps1
# One-click Netlify deploy for NBA dashboard
# Usage: .\deploy-nba.ps1

param(
    [Parameter(Mandatory=$false)]
    [switch]$SkipBuild = $false
)

function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Warning { Write-Host $args -ForegroundColor Yellow }
function Write-Error { Write-Host $args -ForegroundColor Red }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Info "=========================================="
Write-Info "NBA Dashboard - Netlify Deploy"
Write-Info "=========================================="

# Step 1: Build if not skipped
if (-not $SkipBuild) {
    Write-Info "[1/3] Building dashboard..."
    Push-Location web-dashboard
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "Build failed"
        }
        Write-Success "✅ Dashboard built"
    } catch {
        Write-Error "❌ Build failed: $_"
        Pop-Location
        exit 1
    }
    Pop-Location
} else {
    Write-Info "[1/3] Skipping build (--SkipBuild)"
}

# Step 2: Verify dist exists
$distPath = "web-dashboard\dist"
if (-not (Test-Path $distPath)) {
    Write-Error "❌ Dashboard dist folder not found: $distPath"
    Write-Info "Run: .\run-nba.ps1 first, or cd web-dashboard && npm run build"
    exit 1
}

if (-not (Test-Path "$distPath\index.html")) {
    Write-Error "❌ dist\index.html not found"
    exit 1
}

Write-Success "✅ dist folder verified"

# Step 3: Deploy instructions
Write-Info ""
Write-Info "[2/3] Netlify Deploy Instructions"
Write-Info "=========================================="
Write-Info ""
Write-Info "OPTION A: Drag & Drop (Manual)"
Write-Info "  1. Open: https://app.netlify.com/drop"
Write-Info "  2. In Explorer, open: $((Resolve-Path $distPath).Path)"
Write-Info "  3. Drag the ENTIRE 'dist' folder to Netlify Drop"
Write-Info ""
Write-Info "OPTION B: Netlify CLI (if installed)"
Write-Info "  cd web-dashboard"
Write-Info "  netlify deploy --dir=dist --prod"
Write-Info ""
Write-Info "Site: dynamic-gingersnap-3ee837"
Write-Info "URL: https://dynamic-gingersnap-3ee837.netlify.app"
Write-Info ""

# Step 4: Verify env vars (reminder)
Write-Info "[3/3] Environment Variables Check"
Write-Info "=========================================="
Write-Info "Ensure Netlify has:"
Write-Info "  - GOOGLE_APPLICATION_CREDENTIALS (full SA JSON)"
Write-Info "  - TEST_SPREADSHEET_ID (optional, for testing)"
Write-Info ""
Write-Info "Check: https://app.netlify.com/sites/dynamic-gingersnap-3ee837/settings/env"
Write-Info ""

# Open dist folder in Explorer
Write-Info "Opening dist folder in Explorer..."
Start-Process explorer.exe -ArgumentList (Resolve-Path $distPath).Path

Write-Success ""
Write-Success "✅ Ready to deploy!"
Write-Info "Drag the dist folder to Netlify Drop, or use Netlify CLI"
