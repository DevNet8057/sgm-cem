# Utiliser SGM-CEM depuis le PC

Le site hébergé est **https://sgm-cem.16-16-63-155.sslip.io**. Le VPS est accessible avec l'alias SSH personnel `sgm-cem` (`ubuntu@16.16.63.155`), son dépôt se trouve dans `/srv/sgm-cem/sgm-cem`.

## Frontend local, API et données hébergées

Ce mode lance uniquement Next.js sur le PC. Il utilise **la même API et la même base que le site public** : toute création, modification, suppression, collecte ou import est une **opération réelle en production**, soumise aux droits et à l'audit du serveur. Pour découvrir l'interface sans modifier les données, utilisez un compte adapté et évitez les actions d'écriture.

Chaîne de connexion : navigateur `http://localhost:3005` → passerelle locale `127.0.0.1:13001` → tunnel SSH `127.0.0.1:13002` → API VPS `127.0.0.1:3001` → PostgreSQL hébergé. Le serveur Next.js et les deux ports intermédiaires écoutent seulement en loopback. Aucune URL de base, clé API, clé SSH ou secret JWT de production n'est copié dans le dépôt ni requis pour ce mode.

Prérequis : Windows PowerShell, OpenSSH, Node.js **22**, pnpm **8.15.4**, alias `sgm-cem` fonctionnel dans `%USERPROFILE%\.ssh\config`, et dépendances du projet déjà installées. La clé SSH personnelle reste dans le dossier `.ssh`. Vérifiez la première connexion et l'empreinte du VPS avec `ssh sgm-cem` avant d'utiliser le lanceur, qui exige une authentification SSH non interactive.

Depuis la racine `sgm-cem` du checkout sur E: :

```powershell
.\deploy\pc\Lancer-Local-VPS.ps1 -WebPort 3005
```

Pour démarrer par double-clic, ouvrez **`deploy\pc\Demarrer-Local.cmd`** dans l'Explorateur Windows. Il lance le même script sur le port `3005`, garde les messages visibles en cas d'erreur et n'ouvre pas automatiquement le navigateur. Ouvrez ensuite **http://localhost:3005**. Gardez sa fenêtre ouverte pendant votre travail ; Ctrl+C termine la session locale.

Le port 3005 évite les services déjà présents sur 3000. Sans -WebPort, le port par défaut est 3000. Le lanceur détecte automatiquement l'installation portable préparée sur ce PC. Pour préciser les outils explicitement :

```powershell
.\deploy\pc\Lancer-Local-VPS.ps1 -WebPort 3005 -NodeExe 'E:\sgm-cem-vps\outils\node-v22.23.5-win-x64\node.exe' -PnpmCli 'E:\sgm-cem-vps\outils\pnpm\node_modules\pnpm\bin\pnpm.cjs'
```

Node **22.23.5** provient de `nodejs.org` ; son archive a été comparée aux [empreintes SHA256 officielles](https://nodejs.org/dist/v22.23.5/SHASUMS256.txt) avant extraction. pnpm **8.15.4** provient du registre officiel npm, avec vérification d'intégrité par npm. Les outils portables, archives et preuves restent hors du dépôt, dans `E:\sgm-cem-vps\outils` et `E:\sgm-cem-vps\reports\outils-pc.json`.

Les dossiers de cache, fichiers temporaires et journaux des assistants vont par défaut dans `E:\sgm-cem-vps\cache` (`-CacheDirectory` permet de les déplacer). Les dépendances `node_modules` et la compilation `.next` restent dans le checkout E:. Si elles manquent, le lanceur s'arrête avec une instruction claire ; il ne télécharge rien. Installez-les séparément, avec les versions indiquées et le lockfile conservé :

```powershell
# Depuis sgm-cem, après avoir sélectionné Node 22 et pnpm 8.15.4 dans le PATH.
$env:TEMP = 'E:\sgm-cem-vps\cache\tmp'
$env:TMP = $env:TEMP
$env:npm_config_cache = 'E:\sgm-cem-vps\cache\npm'
$env:PUPPETEER_SKIP_DOWNLOAD = 'true'
$env:PUPPETEER_CACHE_DIR = 'E:\sgm-cem-vps\cache\puppeteer'
New-Item -ItemType Directory -Force $env:TEMP, $env:npm_config_cache | Out-Null
pnpm install --filter web... --frozen-lockfile --store-dir E:\sgm-cem-vps\cache\pnpm-store
```

Le lanceur vérifie les ports, ouvre son tunnel et sa passerelle, vérifie `/api/health`, compile `packages/shared`, puis lance seulement le frontend au premier plan. Il définit `NEXT_PUBLIC_API_URL=http://localhost:13001`, `NEXT_PUBLIC_APP_URL=http://localhost:3005` et les réécritures Next vers la passerelle pour cette session. Il ne modifie aucun fichier `.env`. Ouvrez **http://localhost:3005** et utilisez votre compte SGM-CEM habituel. Gardez ce même nom d'hôte pour l'application et l'API : les cookies de `localhost` et de `127.0.0.1` sont distincts. **Ctrl+C** arrête le frontend ; le bloc `finally` termine uniquement les deux assistants qu'il a créés et restaure les variables du terminal. Un port déjà occupé provoque un arrêt sans tuer son propriétaire.

La passerelle accepte les deux origines correspondant au seul port choisi par -WebPort (variable de session SGM_LOCAL_WEB_PORT, entier de 1024 à 65535 distinct de 13001 et 13002). Avec la commande ci-dessus, ce sont les origines `http://localhost:3005` et `http://127.0.0.1:3005`, ainsi que les outils sans en-tête `Origin`. Elle refuse les autres origines et les hôtes inattendus, et ne peut joindre qu'une cible fixe. Les en-têtes `Host` et `Origin` transmis à l'API portent l'origine HTTPS publique ; CORS est réécrit pour l'origine locale autorisée. Les cookies gardent `HttpOnly`, `SameSite`, leur chemin et leur expiration. **Uniquement sur cette connexion HTTP loopback**, `Secure` et `Domain` sont retirés pour permettre la session locale ; ne publiez jamais cette passerelle sur le réseau. Les protections CSRF, l'authentification et les autorisations restent traitées par l'API. WebSocket/Socket.IO traverse le même tunnel. Aucun jeton ni contenu de requête n'est journalisé par la passerelle.

Les paiements, notifications et webhooks restent des services de production. Le retour du prestataire peut ouvrir le site public plutôt que l'application locale. La connexion Google sur localhost dépend des origines réellement autorisées dans Google Cloud : elle doit être confirmée et testée séparément. Une session réussie sur le domaine public ne valide pas Google sur localhost.

Pour développer l'API, les jobs ou le schéma Prisma, utilisez une **copie isolée** de la base avec ses propres accès et intégrations de test. Ne démarrez pas une API locale, des crons ou BullMQ contre la production ; n'exécutez pas `prisma db push` sur la base hébergée depuis le PC. Les modes frontend local et consultation SQL ci-dessous n'en ont pas besoin.

## Consulter PostgreSQL dans DBeaver, pgAdmin ou psql

Dans un second terminal, depuis `sgm-cem` :

```powershell
.\deploy\pc\Ouvrir-Base-VPS.ps1
```

La commande utilise `ssh -N sgm-cem-db` et les options de maintien du tunnel. L'alias personnel `sgm-cem-db` doit conserver le transfert local **`127.0.0.1:15432 → VPS 127.0.0.1:5433`**. Gardez le terminal ouvert ; Ctrl+C ferme le tunnel. Le script ne contient aucun mot de passe et ne modifie pas la configuration SSH.

| Paramètre du client PostgreSQL | Valeur |
|---|---|
| Hôte | `127.0.0.1` |
| Port | `15432` |
| Base | `sgm_cem` |
| Utilisateur | `sgm_local_lecture` |
| Mot de passe | remis séparément, hors dépôt |
| Tunnel SSH intégré au client | désactivé, le script l'ouvre déjà |

Le rôle `sgm_local_lecture` est dédié à la consultation. Le fichier personnel `E:\sgm-cem-vps\private\connexion-lecture.env.local`, lorsqu'il est fourni par l'opérateur, contient ses paramètres ; ne le copiez pas dans le dépôt ou les `.env` de l'application. Le tunnel SSH chiffre le trajet PC–VPS. N'utilisez pas le compte historique `sg_remote` disposant de privilèges SUPERUSER pour le développement courant. La connexion à `localhost:5432` désigne un éventuel PostgreSQL du PC et ne désigne pas ce tunnel.

## Importer une liste de membres

Le fichier [exemples/membres-exemple.csv](exemples/membres-exemple.csv) est un modèle **UTF-8** séparé par des points-virgules. Il contient deux identités fictives avec des adresses `@example.invalid` ; **remplacez toutes les lignes d'exemple avant tout import réel**. Il ne contient aucun membre de la communauté.

En-tête exact à conserver :

```text
prenom;nom;email;telephone;categorie;groupe;profil;statut;profession
```

| Colonne | Valeurs attendues |
|---|---|
| `prenom`, `nom` | prénom et nom du membre |
| `email` | adresse unique ; remplacer les exemples fictifs |
| `telephone` | facultatif ; conserver comme texte pour garder le préfixe et les zéros |
| `categorie` | `MCE_EN_SERVICE`, `ENFANTS`, `DIASPORA` |
| `groupe` | `TEMPLE`, `MVOG_BETSI`, `BISCUITERIE`, `OBILI`, `SCIENCES`, `POLYTECHNIQUE` |
| `profil` | `TRAVAILLEUR`, `ETUDIANT`, `COUPLE` |
| `statut` | `EN_OBSERVATION`, `EN_SUIVI`, `FIN_DE_SUIVI`, `DIASPORA` |
| `profession` | texte libre facultatif |

Préparez vos lignes dans Excel ou LibreOffice puis exportez-les en **CSV UTF-8 avec séparateur `;`**. L'interface actuelle importe du **texte CSV collé dans une zone de saisie** : elle ne lit pas directement un `.xlsx`. Ouvrez le CSV dans un éditeur de texte, copiez l'en-tête et les lignes, puis dans **Membres → Importer**, collez le contenu. Vérifiez le nombre de membres détectés et les erreurs avant de cliquer **Importer** avec un compte autorisé.

Limitez un import à **500 membres**. Supprimez les doublons, notamment d'email, dans le fichier et par rapport aux membres déjà enregistrés : ils sont refusés. Le parseur est simple : n'insérez aucun point-virgule ni saut de ligne dans une cellule, même entre guillemets ; évitez les champs entourés de guillemets. Vérifiez l'encodage des accents et les colonnes obligatoires. Un import depuis le frontend local écrit lui aussi dans la production.

## Mettre le site à jour après une modification

Travaillez dans une branche, vérifiez les changements et les tests adaptés, faites relire puis créez un commit et un tag de version. Par exemple, adaptez la version et la branche aux changements effectivement validés :

```powershell
git status --short
pnpm type-check
# Tests et build adaptés au changement, avec une base isolée si nécessaire.
git add <fichiers-valides>
git commit -m "fix: corriger le comportement concerné"
git tag v1.0.1
git push origin <branche-validee>
git push origin v1.0.1
ssh sgm-cem
```

Sur le VPS, gardez la configuration privée et le `.env` existants. Intégrez uniquement la version validée, avec un avancement linéaire :

```bash
cd /srv/sgm-cem
git status --short
git fetch origin --tags
git merge --ff-only v1.0.1
cd /srv/sgm-cem/sgm-cem
sudo ./deploy/update-production.sh
sudo docker compose -p sgm-cem -f docker-compose.prod.yml ps
curl --fail http://127.0.0.1:3001/api/health
```

Le script vérifie que les sources sont propres et que le schéma Prisma reste identique, crée une sauvegarde, construit les deux images API/web puis effectue la bascule avec contrôles de santé. Si les nouveaux services échouent, il tente le retour aux images précédentes. Ce retour concerne les images ; la sauvegarde de base se conserve pour une restauration distincte si nécessaire. Vérifiez également le site public et une connexion utilisateur après la bascule. Si le script signale un changement de schéma, préparez une tâche séparée de mise à jour de base, avec sauvegarde et validation ; ne contournez pas cette protection.

L'utilisateur VPS `ubuntu` n'appartient pas au groupe Docker : les commandes Docker manuelles nécessitent `sudo`. La sauvegarde quotidienne est programmée à **03:20, heure de Douala**, avec conservation de **14 jours**. La copie chiffrée conservée sur le PC utilise une clé protégée par **DPAPI**, liée au profil Windows utilisé : elle ne constitue pas une clé universellement portable vers un autre PC ou un autre compte. La preuve de vérification opérateur se trouve dans `E:\sgm-cem-vps\reports\sauvegarde-verifiee.json` ; ne confondez pas cette preuve avec le fichier de sauvegarde ni avec sa clé.

Si `merge --ff-only` refuse, examinez la divergence avant de poursuivre. Ne remplacez pas cette étape par `git reset --hard`. Ne lancez pas `docker compose down -v` : les volumes portent les données de production. Gardez les secrets hors Git et ne relancez pas les seeds par habitude.

## Vérifier les outils sans contacter le VPS

```powershell
node --test .\deploy\pc\api-vps-gateway.test.cjs
```

Les tests emploient uniquement des serveurs simulés sur `127.0.0.1` ; le port `13002` doit être libre. Ils vérifient la transmission HTTP/CSRF, les cookies, CORS, les refus d'origine et d'hôte, ainsi que les connexions WebSocket autorisées et refusées. Ils n'ouvrent pas SSH et ne touchent aucune donnée de production.
