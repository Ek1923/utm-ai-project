# Project NEXUS — Create/refresh all Ollama agent models
# Run after: ollama serve

$ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
$nexus  = Split-Path $PSScriptRoot -Parent

Write-Host "NEXUS — Creating agents in Ollama..." -ForegroundColor Cyan

$models = @(
    @{ name = "apex1";   file = "$nexus\ollama\modelfiles\APEX1.Modelfile" },
    @{ name = "apex2";   file = "$nexus\ollama\modelfiles\APEX2.Modelfile" },
    @{ name = "forge";   file = "$nexus\ollama\modelfiles\FORGE.Modelfile" },
    @{ name = "spark";   file = "$nexus\ollama\modelfiles\SPARK.Modelfile" },
    @{ name = "atlas";   file = "$nexus\ollama\modelfiles\ATLAS.Modelfile" },
    @{ name = "tactix";  file = "$nexus\ollama\modelfiles\TACTIX.Modelfile" },
    @{ name = "vega";    file = "$nexus\ollama\modelfiles\VEGA.Modelfile" },
    @{ name = "nexusui"; file = "$nexus\ollama\modelfiles\NEXUS_UI.Modelfile" }
)

foreach ($model in $models) {
    Write-Host "  $($model.name)..." -NoNewline
    & $ollama create $($model.name) -f $($model.file) 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host " OK" -ForegroundColor Green }
    else { Write-Host " FAILED" -ForegroundColor Red }
}

Write-Host "`nDone. Check with: ollama list" -ForegroundColor Green
