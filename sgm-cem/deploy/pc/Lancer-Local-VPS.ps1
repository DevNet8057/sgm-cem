[CmdletBinding()]
param(
    [string]$NodeExe = 'node',
    [string]$PnpmCli = 'pnpm',
    [string]$CacheDirectory = 'E:\sgm-cem-vps\cache',
    [ValidateRange(1024, 65535)][int]$WebPort = 3000
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$helpers = @()
$originalEnvironment = @{}
$environmentNames = @('PATH', 'TEMP', 'TMP', 'npm_config_cache', 'PNPM_HOME',
    'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_APP_URL', 'API_PROXY_URL', 'SGM_LOCAL_WEB_PORT')
foreach ($name in $environmentNames) { $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

function Assert-FreePort([int]$Port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Server.ExclusiveAddressUse = $true
    try { $listener.Start() }
    catch { throw "Port local $Port déjà occupé. Fermez le service concerné puis relancez ; aucun processus n'a été arrêté." }
    finally { $listener.Stop() }
}

function Wait-Port([int]$Port, [System.Diagnostics.Process]$Helper) {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $Helper.Refresh()
        if ($Helper.HasExited) { throw "Un assistant local s'est arrêté (port $Port). Vérifiez SSH et les journaux locaux." }
        $client = [System.Net.Sockets.TcpClient]::new()
        try {
            $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
            if ($pending.AsyncWaitHandle.WaitOne(200)) {
                $client.EndConnect($pending)
                return
            }
        } catch { }
        finally { $client.Dispose() }
        Start-Sleep -Milliseconds 250
    }
    throw "Le port local $Port n'est pas prêt après l'attente."
}

function Invoke-Pnpm([string[]]$Arguments) {
    if ($script:resolvedPnpm -match '\.(cjs|mjs|js)$') { & $script:resolvedNode $script:resolvedPnpm @Arguments }
    else { & $script:resolvedPnpm @Arguments }
    if ($LASTEXITCODE -ne 0) { throw "pnpm a échoué (code $LASTEXITCODE)." }
}

try {
    $portableNode = 'E:\sgm-cem-vps\outils\node-v22.23.5-win-x64\node.exe'
    $portablePnpm = 'E:\sgm-cem-vps\outils\pnpm\node_modules\pnpm\bin\pnpm.cjs'
    if (!$PSBoundParameters.ContainsKey('NodeExe') -and (Test-Path $portableNode)) { $NodeExe = $portableNode }
    if (!$PSBoundParameters.ContainsKey('PnpmCli') -and (Test-Path $portablePnpm)) { $PnpmCli = $portablePnpm }
    $script:resolvedNode = (Get-Command $NodeExe -ErrorAction Stop).Source
    $nodeVersion = & $script:resolvedNode --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') { throw 'Utilisez Node.js 22 ; passez -NodeExe avec le chemin de node.exe portable si nécessaire.' }
    $env:PATH = "$(Split-Path $script:resolvedNode -Parent);$env:PATH"
    $script:resolvedPnpm = (Get-Command $PnpmCli -ErrorAction Stop).Source
    if ($script:resolvedPnpm -match '\.(cjs|mjs|js)$') { $pnpmVersion = & $script:resolvedNode $script:resolvedPnpm --version }
    else { $pnpmVersion = & $script:resolvedPnpm --version }
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion.Trim() -ne '8.15.4') { throw 'Utilisez pnpm 8.15.4 ; passez -PnpmCli avec le chemin de pnpm.cjs ou pnpm.cmd.' }
    $sshExe = (Get-Command ssh -ErrorAction Stop).Source
    if ($WebPort -in @(13001, 13002)) { throw 'Le port frontend doit différer des ports de passerelle 13001 et 13002.' }
    foreach ($port in @($WebPort, 13001, 13002)) { Assert-FreePort $port }
    if (!(Test-Path (Join-Path $projectDirectory 'apps\web\node_modules\next\dist\bin\next'))) {
        throw 'Dépendances absentes. Avec Node 22 et pnpm 8.15.4, exécutez manuellement pnpm install --frozen-lockfile à la racine sgm-cem (stockage/cache sur E:), puis relancez. Aucune installation automatique.'
    }
    foreach ($folder in @('tmp', 'npm', 'pnpm', 'logs')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $CacheDirectory $folder) | Out-Null
    }
    $env:TEMP = Join-Path $CacheDirectory 'tmp'
    $env:TMP = $env:TEMP
    $env:npm_config_cache = Join-Path $CacheDirectory 'npm'
    $env:PNPM_HOME = Join-Path $CacheDirectory 'pnpm'
    $env:NEXT_PUBLIC_API_URL = 'http://localhost:13001'
    $env:NEXT_PUBLIC_APP_URL = "http://localhost:$WebPort"
    $env:API_PROXY_URL = 'http://127.0.0.1:13001'
    $env:SGM_LOCAL_WEB_PORT = [string]$WebPort
    $runId = [guid]::NewGuid().ToString('N')
    $logPrefix = Join-Path $CacheDirectory "logs\local-$runId"

    Write-Host 'Le frontend local utilise les données réelles du VPS. Les modifications métier sont enregistrées en production.' -ForegroundColor Yellow
    $sshArguments = @('-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
        '-L', '127.0.0.1:13002:127.0.0.1:3001', 'sgm-cem')
    $tunnel = Start-Process -FilePath $sshExe -ArgumentList $sshArguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$logPrefix-ssh.out.log" -RedirectStandardError "$logPrefix-ssh.err.log"
    $helpers += $tunnel
    Wait-Port 13002 $tunnel

    $gatewayPath = Join-Path $PSScriptRoot 'api-vps-gateway.cjs'
    $gateway = Start-Process -FilePath $script:resolvedNode -ArgumentList ('"' + $gatewayPath + '"') -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$logPrefix-gateway.out.log" -RedirectStandardError "$logPrefix-gateway.err.log"
    $helpers += $gateway
    Wait-Port 13001 $gateway
    $health = Invoke-WebRequest -Uri 'http://127.0.0.1:13001/api/health' -UseBasicParsing -TimeoutSec 20
    if ($health.StatusCode -ne 200) { throw 'La santé API distante ne répond pas HTTP 200.' }
    Write-Host "API VPS disponible. Journaux des assistants : $logPrefix-*.log"
    Push-Location $projectDirectory
    try {
        Invoke-Pnpm -Arguments @('--filter', '@sgm-cem/shared', 'build')
        Write-Host "Ouvrez http://localhost:$WebPort ; Ctrl+C arrête la session locale et son tunnel."
        Invoke-Pnpm -Arguments @('--filter', 'web', 'exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', [string]$WebPort)
    } finally { Pop-Location }
} finally {
    foreach ($helper in $helpers) {
        try {
            $helper.Refresh()
            if (!$helper.HasExited) { $helper.Kill(); $helper.WaitForExit(5000) | Out-Null }
        } catch { Write-Warning "Arrêt de l'assistant local à vérifier (PID $($helper.Id))." }
        finally { $helper.Dispose() }
    }
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process') }
}
