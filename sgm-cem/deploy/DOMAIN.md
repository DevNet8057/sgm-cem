# Adresse publique SGM-CEM

Adresse canonique : **https://sgm-cem.16-16-63-155.sslip.io**.

Cette adresse gratuite utilise le service DNS partage **sslip.io**. Son nom encode
l'IPv4 `16.16.63.155` du serveur Ubuntu. Il depend de la disponibilite de SSLIP et
de la conservation de cette IP. Aucun compte fournisseur ni domaine enregistre
au nom du proprietaire n'a ete cree.

## HTTPS et redirections

- Certificat public Let's Encrypt `sgm-cem-domain` pour le nom DNS, obtenu par
  Certbot 5.10 en mode webroot. Emplacement :
  `/etc/letsencrypt/live/sgm-cem-domain/`.
- Certificat IP `sgm-cem-ip` conserve pour que les anciens liens HTTPS sur
  `https://16.16.63.155` redirigent vers le domaine avec un TLS valide.
- HTTP sur l'IP et sur le domaine redirige en `308` vers le domaine HTTPS.
- `/.well-known/acme-challenge/` reste servi sur le port 80 pour le renouvellement
  des deux certificats, sans arreter Nginx.
- `snap.certbot.renew.timer` renouvelle les certificats ; le hook
  `/etc/letsencrypt/renewal-hooks/deploy/sgm-cem-nginx` valide puis recharge Nginx.

Verifier sans afficher de cle privee :

```bash
sudo /snap/bin/certbot certificates
systemctl list-timers --all | grep certbot
curl -I https://sgm-cem.16-16-63-155.sslip.io/
curl -I https://16.16.63.155/
```

## Configuration et donnees preservees

Le script `deploy/configure-public-origin.py` ajuste uniquement :

- `.env` : `APP_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`,
  `PAYMENT_RETURN_URL`, `YELII_WEBHOOK_URL`, `VAPID_SUBJECT` ;
- PostgreSQL : les cinq entrees correspondantes, hors variables de compilation
  `NEXT_PUBLIC_*`, avec historique et audit `DEVELOPER_PANEL_CONFIG_CHANGED` ;
- le champ `URL` de `.deployment-credentials.env.local`.

Les mots de passe, les cles privees, les cles VAPID, les flags des integrations,
les volumes PostgreSQL/Redis/uploads et le profil prive d'acces a la base restent
conserves. Les sauvegardes `.env.backup-public-origin-*` sont privees (`600`).
Le script est idempotent : une seconde execution sur la meme origine n'ajoute
pas de changement ni d'audit superflu.

## Appliquer une origine publique

Une modification d'origine impose une reconstruction du web (Next.js fige les
variables publiques au build), puis une recreation de l'API et du web.

```bash
cd /srv/sgm-cem/sgm-cem
python3 deploy/configure-public-origin.py
python3 deploy/configure-public-origin.py --apply
sudo docker compose -p sgm-cem -f docker-compose.prod.yml build web
sudo docker compose -p sgm-cem -f docker-compose.prod.yml up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 api web
sudo install -m 0644 deploy/nginx.conf /etc/nginx/sites-available/sgm-cem
sudo nginx -t && sudo systemctl reload nginx
```

Le script refuse une origine sans HTTPS, avec chemin ou avec identifiants dans
l'URL. Une erreur de transaction DB restaure automatiquement le `.env` precedent.
Les redirections Nginx doivent toujours pointer vers la meme origine que le
bundle web et les configurations de l'API.

## Retour temporaire a l'IP

La configuration Nginx IP precedente est conservee sur le serveur dans
`/etc/nginx/sites-available/sgm-cem.ip-rollback.conf`.

```bash
cd /srv/sgm-cem/sgm-cem
python3 deploy/configure-public-origin.py --origin https://16.16.63.155 --apply
sudo docker compose -p sgm-cem -f docker-compose.prod.yml build web
sudo docker compose -p sgm-cem -f docker-compose.prod.yml up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 api web
sudo cp /etc/nginx/sites-available/sgm-cem.ip-rollback.conf deploy/nginx.conf
sudo install -m 0644 deploy/nginx.conf /etc/nginx/sites-available/sgm-cem
sudo nginx -t && sudo systemctl reload nginx
```

Ce retour ajuste seulement les URLs publiques ; il ne restaure pas une ancienne
copie complete du `.env` et ne remplace donc pas les secrets modifies entre-temps.

## Integrations externes

Le changement de domaine ne cree ni identifiants OAuth Google, ni compte SMTP,
ni compte de paiement. Aucune configuration d'un autre compte ou projet cloud
n'a ete utilisee. Le build Compose peut recevoir un eventuel `GOOGLE_CLIENT_ID`
fourni ulterieurement, avec une valeur vide par defaut. Il ne faut activer OAuth
qu'apres autorisation du compte adequat et enregistrement des bonnes origines.

Une nouvelle origine implique aussi un nouvel enregistrement de service worker
et de nouvelles souscriptions push par navigateur ; les cles VAPID existantes
restent reutilisees.

## Controles de la bascule

La bascule a ete appliquee avec les seuls conteneurs API/web recrees. PostgreSQL
et Redis ont conserve leurs conteneurs et volumes ; les compteurs sont restes
a un utilisateur, zero membre et zero contribution.

Controles effectues apres bascule :

- page publique HTTPS du domaine : `200`, certificat verifie normalement ;
- `/api/health` sur le domaine : `200`, statut `ok` ;
- HTTPS sur l'IP et HTTP sur le domaine : `308` vers l'origine canonique ;
- fichier sonde ACME servi en `200` sur HTTP pour l'IP et le domaine, puis retire ;
- quatre conteneurs `healthy`, Nginx et Docker actifs ;
- configuration publique du bundle web et de l'API alignee sur le domaine ;
- aucune configuration Google embarquee dans le bundle web ;
- syntaxe Nginx, syntaxe Python, idempotence du script et `git diff --check` valides.

La recette authentifiee et visuelle de l'application est realisee separement
sur cette adresse canonique.
