<#
  Sauvegarde de la base PostgreSQL du conteneur Docker SGM-CEM (Windows).
  À lancer AVANT toute mise à jour de l'application :
    powershell -ExecutionPolicy Bypass -File .\scripts\backup-db.ps1
  Produit backups\sgm_cem_<date>.dump (format custom pg_dump, restaurable par pg_restore)
  et vérifie que le fichier est lisible. Ne modifie jamais la base.
#>
param(
  [string]$Container = "sgm-cem-postgres-1",
  [string]$Database = "sgm_cem",
  [string]$User = "postgres",
  [string]$OutDir = (Join-Path $PSScriptRoot "..\backups")
)
$ErrorActionPreference = "Stop"

$running = docker inspect -f "{{.State.Running}}" $Container 2>$null
if ($running -ne "true") { throw "Le conteneur $Container n'est pas démarré (docker compose up -d postgres)." }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$file = Join-Path (Resolve-Path $OutDir) "sgm_cem_$stamp.dump"

# pg_dump écrit DANS le conteneur puis docker cp : la redirection PowerShell corromprait un flux binaire.
docker exec $Container pg_dump -U $User -d $Database -Fc --no-owner -f /tmp/sgm_backup.dump
if ($LASTEXITCODE -ne 0) { throw "pg_dump a échoué." }
docker cp "${Container}:/tmp/sgm_backup.dump" $file
docker exec $Container rm -f /tmp/sgm_backup.dump | Out-Null

# Vérification : le dump doit être lisible par pg_restore
docker cp $file "${Container}:/tmp/sgm_verify.dump"
docker exec $Container pg_restore --list /tmp/sgm_verify.dump | Out-Null
$ok = $LASTEXITCODE -eq 0
docker exec $Container rm -f /tmp/sgm_verify.dump | Out-Null
if (-not $ok) { throw "Le fichier de sauvegarde est illisible : $file" }

$size = [math]::Round((Get-Item $file).Length / 1KB, 1)
$counts = docker exec $Container psql -U $User -d $Database -At -c "select 'utilisateurs=' || (select count(*) from users) || ' contributions=' || (select count(*) from contributions)"
Write-Host "Sauvegarde OK : $file ($size Ko) — $counts"
Write-Host "Restauration : docker cp <fichier> ${Container}:/tmp/r.dump ; docker exec $Container pg_restore -U $User -d $Database --clean --if-exists --no-owner /tmp/r.dump"
