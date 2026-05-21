# ═══════════════════════════════════════════════════════════
#  Nexunova RMS (rms.nexunova.com) — one-click sync to GitHub
#  GitHub Pages auto-deploys on push.
# ═══════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Nexunova RMS  →  GitHub Pages  auto-sync      ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$status = git status --porcelain
if (-not $status) {
    Write-Host "[i] No changes to sync. RMS is already up to date." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 0
}

Write-Host "Changes detected:" -ForegroundColor Green
git status --short
Write-Host ""

git add -A

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$msg = "RMS update — $stamp"
git commit -m $msg | Out-Null
Write-Host "[OK] Committed: $msg" -ForegroundColor Green

Write-Host "[->] Pushing to GitHub..." -ForegroundColor Cyan
git push 2>&1 | ForEach-Object { Write-Host "    $_" }

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[OK] DONE - rms.nexunova.com live in 1-2 minutes." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[!] Push failed. See messages above." -ForegroundColor Red
}

Write-Host ""
Read-Host "Press Enter to close"
