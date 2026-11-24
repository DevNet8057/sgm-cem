[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 15432)
$listener.Server.ExclusiveAddressUse = $true
try { $listener.Start() }
catch { throw 'Le port 15432 est déjà utilisé. Vérifiez votre tunnel existant ; aucun processus ne sera arrêté.' }
finally { $listener.Stop() }

Write-Host 'Tunnel PostgreSQL : 127.0.0.1:15432, base sgm_cem. Gardez cette fenêtre ouverte.'
Write-Host "Utilisez le rôle de lecture seule fourni séparément ; aucun mot de passe n'est stocké ici."
Write-Host 'Ctrl+C ferme le tunnel. La base PostgreSQL du PC sur 5432 reste indépendante.'
& ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 sgm-cem-db
if ($LASTEXITCODE -ne 0) { throw "SSH s'est arrêté avec le code $LASTEXITCODE. Vérifiez l'alias sgm-cem-db dans votre configuration SSH personnelle." }
