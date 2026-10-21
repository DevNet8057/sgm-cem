<#
  SGM-CEM — installation d'un serveur neuf depuis un PC Windows (PowerShell, OpenSSH intégré à Windows 10/11).

  Exemples :
    .\deploy\pc\Installer-Serveur.ps1 -Serveur 203.0.113.10 -Domaine app.exemple.cm -Email admin@exemple.cm
    # Images publiées par la CI (le plus rapide : rien n'est construit sur le serveur)
    .\deploy\pc\Installer-Serveur.ps1 -Serveur 203.0.113.10 -Domaine app.exemple.cm -Email admin@exemple.cm -Registre ghcr.io/devnet8057
    # Archive hors ligne (serveur sans accès GitHub) : envoyée par scp (~1,5 Go)
    .\deploy\pc\Installer-Serveur.ps1 -Serveur 203.0.113.10 -Domaine app.exemple.cm -Email admin@exemple.cm -Archive .\sgm-cem-1.0.0.tar

  Prérequis : serveur Ubuntu 24.04 neuf, votre clé SSH installée pour root (choisie à la commande du serveur),
  et le nom de domaine pointant vers l'adresse du serveur (enregistrement DNS A).
#>
param(
  [Parameter(Mandatory = $true)][string]$Serveur,
  [Parameter(Mandatory = $true)][string]$Domaine,
  [Parameter(Mandatory = $true)][string]$Email,
  [string]$Ref = "main",
  [string]$Depot = "https://github.com/DevNet8057/sgm-cem.git",
  [string]$Registre = "",
  [string]$Archive = ""
)
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "..\scripts\installer-serveur.sh"
if (-not (Test-Path $script)) { throw "Script introuvable : $script (lancer depuis le dépôt cloné)" }
if ($Registre -ne "" -and $Archive -ne "") { throw "Choisir -Registre OU -Archive, pas les deux." }
$options = "--domaine '$Domaine' --email '$Email' --ref '$Ref' --depot '$Depot'"
if ($Registre -ne "") { $options += " --registre '$Registre'" }
if ($Archive -ne "") {
  if (-not (Test-Path $Archive)) { throw "Archive introuvable : $Archive" }
  $nom = Split-Path $Archive -Leaf
  Write-Host "▶ Envoi de l'archive $nom (quelques minutes selon la connexion)…" -ForegroundColor Green
  scp $Archive "root@${Serveur}:/root/$nom"
  if ($LASTEXITCODE -ne 0) { throw "Envoi de l'archive impossible." }
  $options += " --archive '/root/$nom'"
}

Write-Host "▶ Envoi du script d'installation vers root@$Serveur…" -ForegroundColor Green
scp $script "root@${Serveur}:/root/installer-serveur.sh"
if ($LASTEXITCODE -ne 0) { throw "Envoi impossible : vérifier l'adresse et la clé SSH." }

Write-Host "▶ Installation (10 à 20 minutes ; suivez les instructions affichées)…" -ForegroundColor Green
ssh -t "root@$Serveur" "sed -i 's/\r$//' /root/installer-serveur.sh && bash /root/installer-serveur.sh $options"
if ($LASTEXITCODE -ne 0) { throw "L'installation a échoué : relire les messages ci-dessus (le script peut être relancé sans risque)." }
Write-Host "✔ Terminé. Mises à jour suivantes : .\deploy\pc\Deployer.ps1 -Serveur $Serveur" -ForegroundColor Green
