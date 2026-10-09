# Installs the Overlay Bridge extension into Spicetify and applies it to Spotify.
# Run from the spotify-overlay folder:  powershell -ExecutionPolicy Bypass -File .\install-bridge.ps1

$ErrorActionPreference = "Stop"

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) {
    Write-Host "Spicetify isn't installed (or isn't on PATH). Install SpotX first, then Spicetify, then run this again." -ForegroundColor Red
    exit 1
}

$userData = (& spicetify path userdata 2>$null | Select-Object -Last 1)
if (-not $userData -or -not (Test-Path $userData)) { $userData = Join-Path $env:APPDATA "spicetify" }
$extDir = Join-Path $userData "Extensions"
New-Item -ItemType Directory -Force -Path $extDir | Out-Null

$src = Join-Path $PSScriptRoot "spicetify\overlay-bridge.js"
Copy-Item $src (Join-Path $extDir "overlay-bridge.js") -Force
Write-Host "Copied overlay-bridge.js to $extDir"

& spicetify config extensions overlay-bridge.js
& spicetify apply

Write-Host ""
Write-Host "Done. Restart Spotify if it didn't restart on its own, then start Mercify." -ForegroundColor Green
