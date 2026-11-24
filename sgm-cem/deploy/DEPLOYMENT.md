# Exploitation de SGM-CEM sur Ubuntu

URL publique : **https://16.16.63.155**. Sources : `/srv/sgm-cem` ; monorepo et configuration : `/srv/sgm-cem/sgm-cem`.

Les quatre services Docker sont PostgreSQL 15, Redis 7, l'API Express et le web Next.js. Nginx est installé sur l'hôte. Seuls Nginx (80/443) et SSH sont publics ; API et web écoutent sur la boucle locale, Redis reste dans le réseau Docker. PostgreSQL est aussi publié exclusivement sur `127.0.0.1:5433` pour un accès administrateur par tunnel SSH ; aucun port de base de données n'est ouvert publiquement. Les volumes `sgm-cem_pgdata`, `sgm-cem_redisdata` et `sgm-cem_uploads` persistent après un redémarrage.

## État constaté le 23 novembre 2026

- Le certificat Let's Encrypt pour l'IP est émis. Le timer Certbot et le hook de rechargement Nginx sont installés et activés. Le test de renouvellement à blanc est en cours de vérification ; son succès ne doit pas être présumé.
- Les unités de démarrage de l'application et de sauvegarde sont installées ; le démarrage automatique et le timer quotidien sont activés.
- Le bootstrap a créé **un seul utilisateur**, au rôle **DEVELOPER**, et **21 paramètres techniques**. Aucun membre, compte staff, paiement ou montant de démonstration n'a été importé.
- Les intégrations externes restent désactivées ou non configurées. Le compte initial et les secrets ont été générés dans les fichiers privés indiqués ci-dessous.
- Les builds finaux et la recette API/navigateur, y compris le rendu mobile, sont encore en cours à cette étape. La présence d'unités systemd et d'un certificat ne constitue pas une validation complète de l'application.

Les corrections de sécurité et les fichiers de déploiement sont présents dans le **working tree du serveur**, sur la base du commit `ca99669ee15829c00067804609430dc1135a8d19`. Ils ne sont pas encore commités ni publiés sur GitHub ; aucun commit/push n'a été demandé. Les conserver avant toute mise à jour des sources.

## Configuration privée et premier compte

`python3 deploy/configure-env.py` crée `.env` et `.deployment-credentials.env.local` en permissions `600`, sans jamais remplacer des secrets existants. Les deux fichiers sont ignorés par Git. Le second contient l'adresse du site, l'email du compte initial et son mot de passe aléatoire. Le lire uniquement dans un terminal privé :

```bash
cd /srv/sgm-cem/sgm-cem
cat .deployment-credentials.env.local
```

Le compte initial dispose des droits administrateur puis développeur après `seed-config`. Aucun compte, membre ou montant de démonstration n'est créé. Son mot de passe est fort et propre à ce déploiement ; le changer depuis le compte après la première connexion. Le fichier d'identifiants contient seulement le mot de passe initial et ne suit pas les changements ultérieurs.

Google OAuth, Mobile Money, carte bancaire, email, WhatsApp, SMS et push restent désactivés/non configurés tant que les identifiants externes réels ne sont pas fournis. Ils nécessitent les comptes fournisseurs, les clés réelles et les URL de callback autorisées ; ils ne sont pas déclarés testés sans cette configuration. Le stockage local persistant est configuré. Les espèces restent activées. Après la première initialisation, les paramètres métier se modifient depuis le panneau développeur : la table `system_configs` prime sur `.env`. Ne pas copier les fausses clés de `.env.example` en production.

`.env` et `.deployment-credentials.env.local` sont exclus de Git et du contexte de build Docker. Ne jamais les ajouter à un commit, une capture d'écran ou des logs partagés.

## Connexion PostgreSQL depuis un PC

La base de cette application est **PostgreSQL**, pas MySQL. Utiliser le pilote PostgreSQL de **DBeaver** ou **pgAdmin**, plutôt que MySQL Workbench. Le compte dédié `sgm_remote` possède désormais le profil **administrateur PostgreSQL demandé par l'utilisateur**, sans réutiliser les identifiants `postgres` de l'application.

Le profil comporte explicitement **`SUPERUSER`, `CREATEDB` et `CREATEROLE`**. Ces attributs permettent l'administration de **tout le cluster PostgreSQL de cette instance**, notamment les bases, rôles, schémas, tables et données ; ils ne limitent pas le compte à `sgm_cem`. Les droits explicites sur les tables/séquences de `sgm_cem` et sur les futurs objets du rôle `postgres` sont également conservés. Les écritures SQL directes contournent les validations et le journal métier de l'application : préférer l'interface pour les opérations métier. Cette configuration ne change pas les comptes SSH de l'hôte Ubuntu ni les comptes ou ACL Windows.

Le provisionnement est reproductible :

```bash
cd /srv/sgm-cem/sgm-cem
python3 deploy/configure-db-access.py
```

Le script crée ou rétablit le **profil administrateur géré**, vérifie l'authentification PostgreSQL par mot de passe et conserve les identifiants dans **`/srv/sgm-cem/sgm-cem/.database-access.env.local`**, en permissions `600`. Les métadonnées indiquent `ACCESS_PROFILE=POSTGRESQL_SUPERUSER` et `PRIVILEGES=SUPERUSER,CREATEDB,CREATEROLE`. Le fichier est ignoré par Git et exclu du contexte Docker. Son mot de passe n'est jamais passé dans la ligne de commande ni affiché dans les logs. Une nouvelle exécution conserve les mêmes identifiants, ne rétrograde pas le profil administrateur et ne réinitialise pas le mot de passe. Un rôle préexistant sans marqueur et fichier privé correspondants est refusé, sans rotation aveugle.

Le script cible explicitement le rôle **`sgm_remote`** et la base applicative **`sgm_cem`**, codés dans le fichier. Les attributs administrateur sont globaux au cluster ; les instructions de restauration et de grants complémentaires ciblent `sgm_cem`. Si la base applicative est renommée, adapter et examiner ce script avant de le réutiliser ; ne pas le lancer sur une base de contrôle en supposant que son nom est paramétrable.

Deux modes de connexion sont possibles ; ne pas les combiner.

### Tunnel SSH manuel puis client local

Dans PowerShell, garder cette commande active :

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:15432:127.0.0.1:5433 -i "$env:USERPROFILE\.ssh\ec2-lgm" ubuntu@16.16.63.155
```

La phrase secrète demandée déverrouille la clé SSH. Elle est distincte du mot de passe PostgreSQL contenu dans le fichier privé.

| Champ du client PostgreSQL | Valeur |
| --- | --- |
| Pilote | PostgreSQL |
| Hôte | `127.0.0.1` |
| Port | `15432` |
| Base | `sgm_cem` |
| Utilisateur | `sgm_remote` |
| Mot de passe | Celui du fichier privé `.database-access.env.local` |
| Tunnel SSH intégré du client | Désactivé, puisque PowerShell crée déjà le tunnel |

Le trafic entre le PC et le serveur est chiffré par SSH. Aucun accès direct à `16.16.63.155:5433` n'est nécessaire.

La connexion peut aussi être vérifiée avec le client PostgreSQL installé sur le PC :

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 15432 -U sgm_remote -d sgm_cem -W
```

Saisir le mot de passe PostgreSQL à l'invite, puis :

```sql
SELECT current_user, current_database();
```

Le résultat attendu est `sgm_remote` et `sgm_cem`. Le profil demandé se contrôle par :

```sql
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname = current_user;
```

Les trois attributs doivent être à `true`. Fermer le terminal du tunnel coupe la connexion de la base depuis le PC, sans arrêter l'application.

### Tunnel intégré de DBeaver ou pgAdmin

Ne pas lancer le tunnel PowerShell dans ce mode. Dans les paramètres de connexion PostgreSQL, utiliser l'hôte **`127.0.0.1` et le port `5433`** (adresse vus depuis le serveur SSH), la base `sgm_cem` et les identifiants `sgm_remote`. Activer ensuite le tunnel SSH du client : hôte `16.16.63.155`, port `22`, utilisateur `ubuntu`, authentification par la clé privée `ec2-lgm` et sa phrase secrète. Le client crée et gère le port local automatiquement.

## Corrections de sécurité et limites connues

Les changements préparés pour ce déploiement comprennent :

- Next.js et `eslint-config-next` **15.5.29**, avec le lockfile actualisé, pour remplacer la version vulnérable 15.1.6.
- Images API et web sous **Node.js 22 / Debian Bookworm**, à la place de Node.js 20 en fin de support.
- Prise en compte d'un seul proxy de confiance dans Express (`trust proxy = 1`), avec l'API accessible uniquement via la boucle locale et Nginx. Les cookies `Secure` et la protection CSRF sont conservés.
- Copie des assets de l'API dans l'image, notamment le logo utilisé par les reçus/PDF. Les uploads restent dans leur volume persistant et les documents GED passent par leurs routes authentifiées.
- Mise à jour de **bcrypt 6** et **Nodemailer 10**, avec les correctifs de dépendances associés.
- Garde de complexité JSON en amont de la validation Zod : au plus **1 000 éléments par tableau**, **10 000 nœuds** et **32 niveaux de profondeur**. Les sept tests ciblés de cette garde sont passés (**7/7**).

Le dernier audit des dépendances de production rapporte **0 critique, 4 élevées, 5 modérées et 1 faible**. Les quatre alertes élevées restantes se répartissent ainsi : trois concernent la chaîne de téléchargement de Puppeteer, dont le téléchargement de navigateur est désactivé (`PUPPETEER_SKIP_DOWNLOAD=true`) au profit du Chromium système ; une concerne Zod 3, dont l'exposition aux requêtes excessivement complexes est réduite par la garde JSON ci-dessus. Ces mesures ne font pas disparaître les alertes de l'audit : suivre les mises à jour amont et planifier leur résolution complète. Le build final et les tests fonctionnels doivent encore confirmer la compatibilité des correctifs.

**Point applicatif préexistant avant tout import réel de membres :** les chemins existants de création/import peuvent utiliser un mot de passe par défaut. Le compte initial de ce déploiement n'utilise pas ce mot de passe. Faire revoir la gestion des accès et imposer un changement ou une réinitialisation des mots de passe des comptes créés/importés avant une utilisation réelle ; ne pas importer des membres en supposant que ces accès sont déjà personnalisés. Cette logique métier n'a pas été modifiée dans le déploiement.

## Premier déploiement — ordre impératif

Ne pas démarrer l'API sur une base vide avant le bootstrap ci-dessous : son entrypoint standard lancerait le seed de démonstration.

```bash
cd /srv/sgm-cem/sgm-cem
python3 deploy/configure-env.py
sudo docker compose -p sgm-cem -f docker-compose.prod.yml config --quiet
sudo docker compose -p sgm-cem -f docker-compose.prod.yml build api web
sudo docker compose -p sgm-cem -f docker-compose.prod.yml up -d --wait postgres redis
sudo docker compose -p sgm-cem -f docker-compose.prod.yml run --rm --no-deps --workdir /app/apps/api api sh -c 'pnpm exec prisma db push --skip-generate && node /app/deploy/bootstrap-admin.cjs && pnpm exec ts-node prisma/seed-config.ts'
sudo docker compose -p sgm-cem -f docker-compose.prod.yml up -d --wait
```

Le bootstrap est idempotent et ne remplace aucun mot de passe. Il refuse de créer un nouvel administrateur dans une base déjà peuplée si le compte attendu n'existe pas. L'entrypoint normal conserve ensuite les données et synchronise le schéma sans `--accept-data-loss`.

Installer Nginx après l'émission du certificat `sgm-cem-ip` :

```bash
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/sgm-cem
sudo ln -sfn /etc/nginx/sites-available/sgm-cem /etc/nginx/sites-enabled/sgm-cem
sudo nginx -t
sudo systemctl reload nginx
```

Le vhost conserve le challenge ACME HTTP sous `/var/www/html/.well-known/acme-challenge/` et redirige les autres accès HTTP vers HTTPS. Les routes API, WebSocket, webhooks et uploads sont transmises à Express ; les fichiers GED ne sont jamais servis directement par Nginx. La limite des requêtes est de 25 Mo et les délais de proxy de 120 secondes.

## Démarrage automatique et état

Après le premier bootstrap uniquement :

```bash
sudo install -m 644 deploy/sgm-cem.service /etc/systemd/system/sgm-cem.service
sudo systemctl daemon-reload
sudo systemctl enable --now sgm-cem.service
sudo systemctl enable docker nginx
sudo docker compose -p sgm-cem -f docker-compose.prod.yml ps
sudo systemctl status sgm-cem.service nginx --no-pager
```

Les conteneurs utilisent aussi `restart: unless-stopped`. L'unité système démarre/recharge Compose avec `--no-build` : elle utilise les images déjà validées et ne construit pas de nouveaux binaires au démarrage du serveur. Les logs Docker sont limités à trois fichiers de 10 Mo par service.

```bash
sudo docker compose -p sgm-cem -f docker-compose.prod.yml logs --tail 100 api web
curl --fail https://16.16.63.155/api/health
```

Le healthcheck de l'API compte dans son quota global de requêtes ; éviter une surveillance agressive. Les appels de santé intégrés ont un intervalle de 30 secondes.

## HTTPS et renouvellement

Le certificat Let's Encrypt couvre directement l'IP. Il utilise le profil `shortlived` et doit se renouveler automatiquement, car sa durée est d'environ six jours. Certbot est installé via Snap ; son timer `snap.certbot.renew.timer` effectue le renouvellement. Les ports HTTP 80 et HTTPS 443 doivent rester accessibles depuis Internet pour l'application et la validation ACME.

```bash
sudo install -m 755 deploy/certbot-deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/sgm-cem-nginx
sudo systemctl status snap.certbot.renew.timer --no-pager
sudo certbot certificates
sudo certbot renew --dry-run
```

Le hook vérifie Nginx puis le recharge après un renouvellement. Les fichiers TLS sont `/etc/letsencrypt/live/sgm-cem-ip/fullchain.pem` et `privkey.pem`. Une modification de l'IP publique nécessite un nouveau certificat et une reconstruction du web avec les nouvelles URL. Une IP élastique AWS évite ce changement au redémarrage de l'instance.

## Sauvegardes quotidiennes

```bash
sudo install -d -m 700 /var/backups/sgm-cem
sudo chmod 755 deploy/backup.sh
sudo install -m 644 deploy/sgm-cem-backup.service /etc/systemd/system/sgm-cem-backup.service
sudo install -m 644 deploy/sgm-cem-backup.timer /etc/systemd/system/sgm-cem-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now sgm-cem-backup.timer
sudo systemctl start sgm-cem-backup.service
sudo systemctl status sgm-cem-backup.service --no-pager
sudo systemctl list-timers sgm-cem-backup.timer
```

Le timer s'exécute à **03h20, fuseau Africa/Douala**, avec un décalage aléatoire maximal de dix minutes. Chaque dossier daté sous `/var/backups/sgm-cem` contient un dump PostgreSQL personnalisé, les uploads compressés, la configuration privée, les fichiers de déploiement, le commit et le diff applicatif, les nouveaux fichiers applicatifs non suivis, les images utilisées et les empreintes SHA-256. Le dump est analysé par `pg_restore --list` et l'archive des uploads est vérifiée avant de déclarer la sauvegarde terminée. La rétention locale est de quatorze jours. Les dossiers `.partial-*` sont conservés en cas d'échec pour diagnostic.

Le diff Git seul ne contient pas les fichiers nouveaux non suivis. `untracked-app-files.tar.gz` les conserve séparément : la liste est produite avec `git ls-files --others --exclude-standard -z`, limitée à `sgm-cem/apps` et `sgm-cem/packages`, puis lue par `tar --null -T`. Elle inclut notamment la garde de complexité JSON et ses tests ajoutés pour ce déploiement. Les secrets ignorés, le store pnpm et les autres fichiers hors de ces deux périmètres ne sont pas inclus. `deployment-files.tar.gz` conserve séparément le dossier `deploy/`. Les archives, le patch et les fichiers métier sont couverts par `SHA256SUMS`.

Les nouveaux dumps utilisent `pg_dump -Fc --no-owner --no-acl` : ils ne transportent pas les droits du compte administrateur distant et restent restaurables dans une base de contrôle sans recréer ce rôle. Les rôles PostgreSQL sont des objets du cluster et ne sont pas recréés par un dump d'une seule base. Le fichier privé `database-access.env.local`, lorsqu'il existe, est sauvegardé séparément en permissions `600`, métadonnées administrateur comprises, et couvert par une empreinte. Le script de reprovisionnement du **profil administrateur** et des grants applicatifs est inclus dans l'archive `deployment-files.tar.gz`.

Ces sauvegardes contiennent des secrets et des données personnelles : le dossier reste accessible uniquement à root. Elles résident sur le même serveur ; une copie chiffrée hors serveur doit être ajoutée pour couvrir la perte complète de l'instance. Redis sert de cache/file de travail et n'est pas inclus dans le dump métier PostgreSQL.

## Vérifier une restauration sans toucher à la base active

Choisir un dossier de sauvegarde et un nom de base de contrôle neuf :

```bash
cd /srv/sgm-cem/sgm-cem
BACKUP_DIR=/var/backups/sgm-cem/AAAAMMJJTHHMMSSZ
sudo sh -c 'cd "$1" && sha256sum -c SHA256SUMS' sh "$BACKUP_DIR"
sudo docker compose -p sgm-cem -f docker-compose.prod.yml exec -T postgres createdb -U postgres sgm_cem_restore_check
sudo cat "$BACKUP_DIR/postgres.dump" | sudo docker compose -p sgm-cem -f docker-compose.prod.yml exec -T postgres pg_restore -U postgres -d sgm_cem_restore_check --no-owner --no-privileges
sudo docker compose -p sgm-cem -f docker-compose.prod.yml exec -T postgres psql -U postgres -d sgm_cem_restore_check -c 'SELECT count(*) FROM users;'
sudo tar -tzf "$BACKUP_DIR/uploads.tar.gz"
sudo tar -tzf "$BACKUP_DIR/untracked-app-files.tar.gz"
sudo tar -tzf "$BACKUP_DIR/deployment-files.tar.gz"
```

Vérifier les tables et fichiers restaurés avant toute bascule. Une restauration de production doit se faire en fenêtre de maintenance, après une sauvegarde de l'état courant, vers une nouvelle base et un nouveau volume d'uploads, puis par changement contrôlé de configuration. Ne jamais écraser une base/volume actif pour un simple test.

Pour reconstruire les sources, utiliser **un nouveau checkout** au commit indiqué par `source-commit.txt`, y vérifier puis appliquer `deployment-changes.patch`. Extraire ensuite `untracked-app-files.tar.gz` à la racine de ce nouveau dépôt (les chemins commencent par `sgm-cem/apps` ou `sgm-cem/packages`), et `deployment-files.tar.gz` dans son monorepo `sgm-cem/` (chemins `deploy/`). Ne pas appliquer le patch ni extraire les archives sur le checkout actif pour une simple recette. Restaurer la configuration privée depuis `production.env` uniquement dans le nouvel emplacement contrôlé, en permissions `600`, et ne pas activer ses unités de production avant une bascule planifiée. Cette étape conserve les correctifs nouveaux qui ne figurent ni dans GitHub ni dans le diff des seuls fichiers suivis.

Après une restauration **de production** dans la base `sgm_cem`, restaurer si disponible `database-access.env.local` sous le nom `.database-access.env.local` (permissions `600`), puis exécuter `python3 deploy/configure-db-access.py` depuis le monorepo restauré. Le script recrée le rôle s'il est absent ou reconnaît le rôle géré existant, rétablit explicitement **`SUPERUSER CREATEDB CREATEROLE`**, puis réapplique les grants sur les tables/séquences et les privilèges par défaut de `sgm_cem`, sans remplacer le mot de passe. Cette étape n'est pas nécessaire pour la simple base de contrôle `sgm_cem_restore_check` et le script n'accepte pas son nom comme paramètre. Un rôle ou fichier d'identifiants inattendu doit être examiné, pas écrasé.

## Mettre à jour l'application

Sauvegarder d'abord, examiner le diff, puis reconstruire les images depuis la version validée. Les correctifs de déploiement locaux doivent être conservés et intégrés avant un `git pull`. Ne pas lancer `git reset --hard` sur ce checkout.

```bash
cd /srv/sgm-cem/sgm-cem
sudo systemctl start sgm-cem-backup.service
git status --short
sudo docker compose -p sgm-cem -f docker-compose.prod.yml build api web
sudo docker compose -p sgm-cem -f docker-compose.prod.yml up -d --wait
```

Toute modification de `NEXT_PUBLIC_*` impose une reconstruction du web. Ne jamais exécuter `docker compose down -v`, `prisma db push --force-reset` ou accepter une perte de données pour contourner un échec de déploiement.
