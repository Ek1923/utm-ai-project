# Project NEXUS — Download Phi-3.5-mini base model (~2.2GB)

$ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"

Write-Host "NEXUS — Downloading phi3.5 base model" -ForegroundColor Cyan
Write-Host "Size: ~2.2GB. Do NOT close this window." -ForegroundColor Yellow
Write-Host ""

& $ollama pull phi3.5

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nDone! phi3.5 downloaded." -ForegroundColor Green
    Write-Host "Next: run scripts\create_models.ps1" -ForegroundColor Cyan
} else {
    Write-Host "`nFailed. Check your internet connection." -ForegroundColor Red
}
