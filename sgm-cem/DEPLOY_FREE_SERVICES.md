# Déploiement gratuit séparé

Cette cible est réservée aux essais et à la démonstration. Render Free peut mettre
l'API en veille après 15 minutes sans trafic : les jobs `node-cron` et les webhooks
de paiement ne sont donc pas des mécanismes fiables de production. Aucun ping de
maintien n'est prévu.

## Services

| Service | Rôle | Configuration |
| --- | --- | --- |
| Supabase Free | PostgreSQL et fichiers | Projet dans une région proche ; 500 Mo DB et 1 Go Storage inclus à ce jour. |
| Upstash Free | Redis TLS | Une base Redis ; recopier l'URL TCP `rediss://...` dans `REDIS_URL`. |
| Render Free | API Express | Créer via Blueprint depuis `render.yaml`. |
| Netlify Free | Next.js | Déployer avec `apps/web` comme *Package directory* et la racine du dépôt comme *Base directory*. |

## Variables à saisir vous-même

Les secrets et clés persistantes ne sont ni générés ni versionnés. Dans Render,
renseigner les valeurs suivantes après avoir créé les services :

```text
DATABASE_URL=<URL PostgreSQL Supabase avec sslmode=require>
REDIS_URL=<URL TCP rediss:// de Upstash>
APP_URL=https://<site>.netlify.app
API_URL=https://<service-api>.onrender.com
JWT_SECRET=<secret existant ou nouveau secret fourni par l'administrateur>
REFRESH_TOKEN_SECRET=<secret existant ou nouveau secret fourni par l'administrateur>
CSRF_SECRET=<secret existant ou nouveau secret fourni par l'administrateur>
```

Pour Storage, créer le bucket `sgm-cem-uploads` dans Supabase puis activer son
accès S3 et créer une paire d'accès dans le tableau Supabase. Ces actions créent
des identifiants persistants : elles doivent être faites par le propriétaire du
compte. Configurer ensuite uniquement côté API :

```text
S3_BUCKET_NAME=sgm-cem-uploads
S3_REGION=us-east-1
S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
S3_PUBLIC_URL=https://<project-ref>.supabase.co/storage/v1/object/public/sgm-cem-uploads
S3_ACCESS_KEY_ID=<clé S3 Supabase>
S3_SECRET_ACCESS_KEY=<secret S3 Supabase>
```

Le code utilise actuellement une URL directe pour les avatars et reçus. Le bucket
doit donc être public pour cette cible de démonstration. Ne pas y stocker de GED
confidentielle avant de passer à des buckets privés et des URLs signées.

Dans Netlify, définir au moment du build :

```text
NEXT_PUBLIC_API_URL=https://<site>.netlify.app/api
NEXT_PUBLIC_APP_URL=https://<site>.netlify.app
API_PROXY_URL=https://<service-api>.onrender.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client OAuth, si utilisé>
```

`API_PROXY_URL` fait suivre `/api`, `/socket.io` et `/uploads` vers Render. Le
navigateur reste donc sur le domaine Netlify : les cookies `SameSite=Lax`, CSRF et
le polling Socket.IO continuent de fonctionner sans CORS cross-site.

Après les URLs publiques connues, mettre aussi dans la table `system_configs`
(panneau développeur) : `APP_URL`, `API_URL`, `YELII_WEBHOOK_URL` et
`PAYMENT_RETURN_URL`. La base est prioritaire sur les variables Render pour ces
clés.

## Webhooks de test

En sandbox, configurer seulement après le déploiement :

```text
Yelii callback:   https://<service-api>.onrender.com/webhooks/yelii
CinetPay notify:  https://<service-api>.onrender.com/webhooks/cinetpay
CinetPay return:  https://<site>.netlify.app/payment/return
```

Conserver les clés Yelii/CinetPay en variables Render ou dans le panneau
développeur ; ne jamais les exposer au frontend.

## Vérification

1. Ouvrir `https://<service-api>.onrender.com/api/health` et attendre `200`.
2. Ouvrir le site Netlify, se connecter, naviguer puis rafraîchir : la session
   doit rester valide.
3. Tester un upload d'avatar et un reçu PDF avec des données de test.
4. Déclencher un paiement sandbox, puis vérifier le retour et le webhook.
