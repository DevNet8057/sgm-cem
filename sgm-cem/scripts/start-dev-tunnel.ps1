# Démarre l'API SGM-CEM + un tunnel Cloudflare, branche automatiquement
# l'URL publique dans apps/api/.env (YELII_WEBHOOK_URL), puis redémarre
# l'API pour que le webhook Yelii soit joignable depuis l'extérieur.
#
# Usage : powershell -File scripts\start-dev-tunnel.ps1
# Arrêt : Ctrl+C dans cette fenêtre (arrête aussi l'API et le tunnel)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$apiDir = Join-Path $root 'apps\api'
$envFile = Join-Path $apiDir '.env'
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$tunnelLog = Join-Path $env:TEMP 'cf_tunnel_err.log'
$apiLog = Join-Path $root 'api-dev.log'
$apiErrLog = Join-Path $root 'api-dev-err.log'

function Stop-PortListener($port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      taskkill /F /T /PID $_ 2>$null | Out-Null
    }
    Start-Sleep -Seconds 1
  }
}

function Wait-ForHealth($url, $timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod -Uri $url -TimeoutSec 3
      if ($r.status -eq 'ok') { return $r }
    } catch { Start-Sleep -Seconds 1 }
  }
  return $null
}

Write-Host "1/5 - Arret des anciens processus (port 3001, tunnel precedent)..."
Stop-PortListener 3001
Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "2/5 - Demarrage de l'API (sans YELII_WEBHOOK_URL pour l'instant)..."
Push-Location $apiDir
Start-Process -FilePath "npx" -ArgumentList "ts-node","src/index.ts" -NoNewWindow -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog
Pop-Location
if (-not (Wait-ForHealth "http://localhost:3001/api/health" 30)) {
  throw "L'API n'a pas demarre apres 30s. Voir $apiLog / $apiErrLog"
}

Write-Host "3/5 - Ouverture du tunnel Cloudflare (localhost:3001)..."
$tunnelOutLog = Join-Path $env:TEMP 'cf_tunnel_out.log'
Remove-Item $tunnelLog, $tunnelOutLog -ErrorAction SilentlyContinue
Start-Process -FilePath $cloudflared -ArgumentList "tunnel","--protocol","http2","--url","http://localhost:3001" -NoNewWindow -RedirectStandardOutput $tunnelOutLog -RedirectStandardError $tunnelLog

$tunnelUrl = $null
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $tunnelLog) {
    $match = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) { $tunnelUrl = $match.Matches[0].Value; break }
  }
}
if (-not $tunnelUrl) { throw "Impossible de recuperer l'URL du tunnel apres 20s. Voir $tunnelLog" }
Write-Host "    URL du tunnel : $tunnelUrl"

Write-Host "4/5 - Mise a jour de YELII_WEBHOOK_URL dans .env..."
$webhookUrl = "$tunnelUrl/webhooks/yelii"
$envContent = Get-Content $envFile -Raw -Encoding UTF8
if ($envContent -match '(?m)^YELII_WEBHOOK_URL="[^"]*"') {
  $envContent = $envContent -replace '(?m)^YELII_WEBHOOK_URL="[^"]*"', "YELII_WEBHOOK_URL=`"$webhookUrl`""
} else {
  $envContent += "`nYELII_WEBHOOK_URL=`"$webhookUrl`"`n"
}
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($envFile, $envContent, $utf8NoBom)

Write-Host "5/5 - Redemarrage de l'API pour prendre en compte la nouvelle URL..."
Stop-PortListener 3001
Push-Location $apiDir
Start-Process -FilePath "npx" -ArgumentList "ts-node","src/index.ts" -NoNewWindow -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog
Pop-Location

Write-Host ""
Write-Host "Verification :"
$localHealth = Wait-ForHealth "http://localhost:3001/api/health" 30
if ($localHealth) { Write-Host "  Local  : OK ($($localHealth.status))" }
else { Write-Host "  Local  : ECHEC - l'API n'a pas repondu apres 30s. Voir $apiLog / $apiErrLog" -ForegroundColor Red }

$tunnelHealth = Wait-ForHealth "$tunnelUrl/api/health" 20
if ($tunnelHealth) { Write-Host "  Tunnel : OK ($($tunnelHealth.status))" }
else { Write-Host "  Tunnel : ECHEC - pas de reponse apres 20s. Voir $tunnelLog" -ForegroundColor Red }

Write-Host ""
Write-Host "Pret. YELII_WEBHOOK_URL = $webhookUrl"
Write-Host "Rappel : cette URL change a chaque execution de ce script (tunnel Cloudflare sans compte)."
