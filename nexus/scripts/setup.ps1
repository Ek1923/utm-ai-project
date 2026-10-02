# Project NEXUS — One-shot setup script for Windows
# Run from the nexus/ directory: .\scripts\setup.ps1

$Root = Split-Path $PSScriptRoot -Parent

Write-Host "`nPROJECT NEXUS — Setup Starting" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan

# Step 1: Install root (server) dependencies
Write-Host "`n[1/5] Installing server dependencies..." -ForegroundColor Yellow
Set-Location $Root
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "ERR: npm install failed" -ForegroundColor Red; exit 1 }

# Step 2: Install client dependencies
Write-Host "`n[2/5] Installing client dependencies..." -ForegroundColor Yellow
Set-Location "$Root\client"
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "ERR: Client npm install failed" -ForegroundColor Red; exit 1 }
Set-Location $Root

# Step 3: Python / LoRA training dependencies
Write-Host "`n[3/5] Installing Python dependencies..." -ForegroundColor Yellow
$req = "$Root\..\training\lora\requirements.txt"
if (Test-Path $req) {
    pip install -r $req
    if ($LASTEXITCODE -ne 0) { Write-Host "WARN: Some Python deps failed — check manually" -ForegroundColor Yellow }
} else {
    Write-Host "WARN: requirements.txt not found at $req" -ForegroundColor Yellow
}

# Step 4: Check Ollama
Write-Host "`n[4/5] Checking Ollama..." -ForegroundColor Yellow
$ollamaCheck = ollama --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "OK Ollama: $ollamaCheck" -ForegroundColor Green
    Write-Host "   Pulling phi3.5..." -ForegroundColor Yellow
    ollama pull phi3.5
} else {
    Write-Host "WARN: Ollama not found. Install from https://ollama.ai" -ForegroundColor Yellow
}

# Step 5: Create Ollama agent models from Modelfiles
Write-Host "`n[5/5] Creating Ollama agent models..." -ForegroundColor Yellow
$agents = @("APEX1","APEX2","FORGE","SPARK","ATLAS","TACTIX","VEGA","NEXUS_UI")
foreach ($agent in $agents) {
    $mf = "$Root\ollama\modelfiles\$agent.Modelfile"
    $name = $agent.ToLower().Replace("_", "")
    if (Test-Path $mf) {
        Write-Host "   Creating $name..." -NoNewline
        ollama create $name -f $mf 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host " OK" -ForegroundColor Green }
        else { Write-Host " WARN (start ollama serve first)" -ForegroundColor Yellow }
    }
}

Write-Host "`nSetup complete!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. Start backend:  cd nexus && npm run dev"
Write-Host "  2. Open UI:        http://localhost:5173"
Write-Host ""
