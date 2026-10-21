<#
  SGM-CEM — installation d'un serveur neuf depuis un PC Windows (PowerShell, OpenSSH intégré à Windows 10/11).

  Exemple :
    .\deploy\pc\Installer-Serveur.ps1 -Serveur 203.0.113.10 -Domaine app.exemple.cm -Email admin@exemple.cm

  Prérequis : serveur Ubuntu 24.04 neuf, votre clé SSH installée pour root (choisie à la commande du serveur),
  et le nom de domaine pointant vers l'adresse du serveur (enregistrement DNS A).
#>
param(
  [Parameter(Mandatory = $true)][string]$Serveur,
  [Parameter(Mandatory = $true)][string]$Domaine,
  [Parameter(Mandatory = $true)][string]$Email,
  [string]$Ref = "main",
  [string]$Depot = "git@github.com:DevNet8057/sgm-cem.git"
)
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "..\scripts\installer-serveur.sh"
if (-not (Test-Path $script)) { throw "Script introuvable : $script (lancer depuis le dépôt cloné)" }

Write-Host "▶ Envoi du script d'installation vers root@$Serveur…" -ForegroundColor Green
scp $script "root@${Serveur}:/root/installer-serveur.sh"
if ($LASTEXITCODE -ne 0) { throw "Envoi impossible : vérifier l'adresse et la clé SSH." }

Write-Host "▶ Installation (10 à 20 minutes ; suivez les instructions affichées)…" -ForegroundColor Green
ssh -t "root@$Serveur" "sed -i 's/\r$//' /root/installer-serveur.sh && bash /root/installer-serveur.sh --domaine '$Domaine' --email '$Email' --ref '$Ref' --depot '$Depot'"
if ($LASTEXITCODE -ne 0) { throw "L'installation a échoué : relire les messages ci-dessus (le script peut être relancé sans risque)." }
Write-Host "✔ Terminé. Mises à jour suivantes : .\deploy\pc\Deployer.ps1 -Serveur $Serveur" -ForegroundColor Green
