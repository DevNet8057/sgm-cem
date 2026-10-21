<#
  SGM-CEM — mise à jour de la production depuis un PC Windows, en une commande.

    .\deploy\pc\Deployer.ps1 -Serveur 203.0.113.10                 # branche réglée sur le serveur (DEPLOY_REF)
    .\deploy\pc\Deployer.ps1 -Serveur 203.0.113.10 -Ref v1.2.0     # version précise
    .\deploy\pc\Deployer.ps1 -Serveur 203.0.113.10 -Retour         # revenir à la version précédente
    .\deploy\pc\Deployer.ps1 -Serveur 203.0.113.10 -Etat           # version en service

  Pousser d'abord le code sur GitHub (git push) : le serveur récupère lui-même le code.
#>
param(
  [Parameter(Mandatory = $true)][string]$Serveur,
  [string]$Ref = "",
  [switch]$Retour,
  [switch]$Etat,
  [string]$Utilisateur = "sgm"
)
$ErrorActionPreference = "Stop"
$options = ""
if ($Retour) { $options = "--retour" }
elseif ($Etat) { $options = "--etat" }
elseif ($Ref -ne "") { $options = "--ref '$Ref'" }

ssh -t "$Utilisateur@$Serveur" "/opt/sgm-cem/scripts/deployer.sh $options"
if ($LASTEXITCODE -ne 0) { throw "Le déploiement a échoué (le serveur est resté sur la version précédente si elle existait)." }
