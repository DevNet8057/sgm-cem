# Déploiement Render — SGM-CEM

> **⚠️ LECTURE OBLIGATOIRE** avant tout déploiement sur Render. Complète
> `DEPLOIEMENT_DOCKER.md` (lire aussi) : les 8 pièges Docker s'appliquent tout autant
> ici, ce guide n'ajoute que ce qui est spécifique à Render. Référencé par `CLAUDE.md`.
> Config source : `render.yaml` (racine du dépôt).

## 1. Architecture retenue

4 ressources Render, définies dans `render.yaml` (déploiement par Blueprint) :

| Ressource        | Type            | Rôle |
|-------------------|-----------------|------|
| `sgm-cem-db`       | PostgreSQL 15   | Base de données managée |
| `sgm-cem-redis`    | Key Value (Redis-compatible) | Cache + BullMQ |
| `sgm-cem-api`      | Web service (Docker) | Express + Prisma + Puppeteer, disque persistant `uploads/` |
| `sgm-cem-web`      | Web service (Docker) | Next.js 15 |

**Point crucial : le navigateur ne parle QU'AU service `web`.** Il ne connaît jamais
l'URL de l'API. Le service `web` proxifie en interne `/api`, `/socket.io` et `/uploads`
vers `sgm-cem-api` (rewrites `next.config.ts`, cible calculée à partir des variables
`API_PROXY_HOST` / `API_PROXY_PORT` injectées par Render — `fromService` sur le host et
le port internes de l'API).

Pourquoi ce détour, alors qu'en Docker local le web appelle l'API directement (piège n°5
de `DEPLOIEMENT_DOCKER.md`) ? Sur Render, `sgm-cem-web` et `sgm-cem-api` vivent chacun sur
un sous-domaine `*.onrender.com` **distinct**. `onrender.com` est inscrit à la Public
Suffix List : deux sous-domaines onrender.com sont donc considérés **cross-site** l'un
par rapport à l'autre (contrairement à deux sous-domaines d'un même domaine personnel).
Or les cookies de session (`access_token`, `refresh_token`, CSRF) sont posés avec
`sameSite: 'lax'` (voir `apps/api/src/index.ts` et `apps/api/src/routes/auth.ts`) — un
cookie `lax` n'est **jamais** envoyé sur une requête cross-site initiée en JavaScript
(`fetch`/`axios`), même avec `withCredentials: true`. Sans proxy, le login fonctionnerait
(le cookie serait posé) mais **toutes les requêtes authentifiées suivantes échoueraient
en 401**, car le navigateur refuserait de renvoyer le cookie vers le domaine de l'API.

Le proxy contourne le problème : du point de vue du navigateur, tout se passe sur le
domaine `sgm-cem-web-xxxx.onrender.com` (même origine), le cookie circule normalement ;
c'est `sgm-cem-web` qui relaie ensuite la requête vers `sgm-cem-api` côté serveur (réseau
interne Render, pas de notion de cross-site entre deux services backend).

Conséquence sur Socket.IO : l'upgrade vers une connexion WebSocket ne traverse pas ce
proxy applicatif (rewrites Next.js) — le client bascule automatiquement en **polling
HTTP long**. Fonctionnel (le temps réel Socket.IO livré en P4 continue de marcher), mais
avec une latence légèrement supérieure au WebSocket natif utilisé en Docker local.

`apps/web/next.config.ts` lit `API_PROXY_HOST`/`API_PROXY_PORT` et déclare les
`rewrites` correspondantes ; `apps/web/src/lib/api.ts` continue lui d'appeler
`NEXT_PUBLIC_API_URL` en URL absolue (`getBaseURL()`) — ce qui reste correct **à
condition** que cette variable pointe vers l'URL publique du **web** lui-même (voir
§4b) : le navigateur appelle alors sa propre origine, donc pas de cross-site, et
c'est Next.js qui relaie ensuite en interne vers l'API via les `rewrites`.

## 2. Coûts et pièges des plans

- **Postgres `basic-256mb` (~6 $/mois)** : le plan `free` est **supprimé après 30 jours**
  (données perdues, pas juste mis en veille) — inutilisable pour une base de production.
- **Services `free`** (web/API) sont mis en **veille après 15 min d'inactivité** et
  redémarrent à la première requête (délai de plusieurs secondes). Deux conséquences
  concrètes pour ce projet : les jobs `node-cron` (relevé mensuel, réconciliation Yelii)
  ne tournent pas pendant la veille, et les **webhooks Yelii** arrivant pendant la veille
  sont retardés le temps du réveil. **Plan `starter` minimum pour l'API** en production.
- **`starter` (512 Mo)** peut être juste pour Chromium/Puppeteer (génération PDF des
  reçus/rapports) sous charge concurrente. Si des générations de PDF échouent ou que le
  conteneur redémarre en OOM, passer `sgm-cem-api` en plan `standard` (2 Go).
- Le disque persistant (`sgm-cem-uploads`) n'existe que pour le plan `starter` et plus —
  vérifié compatible avec le plan retenu ci-dessus.

## 3. Déploiement pas à pas

1. Pousser le code sur GitHub (`DevNet8057/sgm-cem`, branche `main`) — `render.yaml` doit
   être à la racine du dépôt.
2. Dashboard Render → **New** → **Blueprint**.
3. Connecter le dépôt `DevNet8057/sgm-cem`. Render détecte `render.yaml` et propose les
   4 ressources décrites plus haut.
4. Renseigner les variables marquées `sync: false` dans le formulaire de création.
   Pour les 5 variables d'URL qui ne peuvent être connues qu'**après** création des
   services (`APP_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`), mettre
   un placeholder du type `https://a-completer` — elles seront corrigées à l'étape 4.
   Renseigner `ADMIN_PASSWORD` et `GOOGLE_CLIENT_ID` avec leurs vraies valeurs dès
   maintenant si elles sont connues.
5. **Apply**. Render crée la base, le Redis, puis build et déploie l'API et le web (dans
   cet ordre, les services web n'ayant pas de dépendance explicite entre eux dans
   `render.yaml` mais l'API doit être prête pour que le premier appel du web réussisse).

## 4. Après création (ÉTAPE CRITIQUE)

Chaque service Render obtient une URL publique avec un suffixe aléatoire, par exemple
`https://sgm-cem-web-x7k2.onrender.com` et `https://sgm-cem-api-p9j4.onrender.com`. Ces
URLs ne sont connues qu'une fois les services créés — il faut revenir corriger la config.

**(a) Service `sgm-cem-api` → Environment :**
- `APP_URL` = URL publique du **web** (ex. `https://sgm-cem-web-x7k2.onrender.com`)
- `API_URL` = URL publique de l'**api** (ex. `https://sgm-cem-api-p9j4.onrender.com`)
- **Save Changes** déclenche un redéploiement automatique — suffisant, ces variables sont
  lues à l'exécution (`getConfig()`), pas figées au build.

**(b) Service `sgm-cem-web` → Environment :**
- `NEXT_PUBLIC_API_URL` = `https://sgm-cem-web-x7k2.onrender.com/api` (**l'URL du web**,
  pas celle de l'api — le proxy fait suivre, voir §1 ; piège n°5 de
  `DEPLOIEMENT_DOCKER.md`, encore plus critique ici puisqu'une mauvaise valeur pointerait
  vers un domaine cross-site et romprait l'authentification)
- `NEXT_PUBLIC_APP_URL` = `https://sgm-cem-web-x7k2.onrender.com`
- Ces variables sont **figées au build** par Next.js : un simple redéploiement ne suffit
  pas. Utiliser **Manual Deploy → Clear build cache & deploy**.

**(c) Config déjà seedée en base avec les placeholders (piège n°4 de
`DEPLOIEMENT_DOCKER.md`) :** si l'API a démarré une première fois avant l'étape (a)/(b),
`prisma/seed-config.ts` a copié les placeholders `https://a-completer` (ou les valeurs
`sync:false` provisoires) dans `system_configs` — et cette table prime désormais sur
`.env`/les variables Render pour tout ce qui n'est pas `JWT_SECRET` /
`REFRESH_TOKEN_SECRET` / `CSRF_SECRET` / `DATABASE_URL`. Il faut corriger directement en
base via le **psql** du dashboard Render (page de la base `sgm-cem-db` → **Connect** →
onglet **PSQL**) :

```sql
-- Corriger les URLs seedées avec les placeholders — table system_configs
-- (colonnes "key"/"value" telles que définies dans prisma/schema.prisma, modèle SystemConfig)
UPDATE system_configs SET value = 'https://sgm-cem-api-p9j4.onrender.com'
  WHERE key = 'API_URL';
UPDATE system_configs SET value = 'https://sgm-cem-web-x7k2.onrender.com'
  WHERE key = 'APP_URL';
UPDATE system_configs SET value = 'https://sgm-cem-api-p9j4.onrender.com/webhooks/yelii'
  WHERE key = 'YELII_WEBHOOK_URL';
UPDATE system_configs SET value = 'https://sgm-cem-web-x7k2.onrender.com/payment/return'
  WHERE key = 'PAYMENT_RETURN_URL';
```

Vérifier ensuite dans le panneau développeur (section Infrastructure /
Webhooks & Callbacks) que les 4 valeurs affichées sont correctes.

## 5. Configuration externe

- **Google Cloud Console** → Identifiants → le Client OAuth utilisé → **Authorized
  JavaScript origins** → ajouter l'URL publique du **web**
  (`https://sgm-cem-web-x7k2.onrender.com`). Sans ça, la connexion Google échoue en 403
  (même diagnostic que le 403 déjà rencontré en local, voir `docs/reference/` ou la
  mémoire du projet — origine non autorisée).
- **`YELII_WEBHOOK_URL`** (panneau développeur, section Webhooks) →
  `https://<url-publique-de-l-api>/webhooks/yelii`. Les webhooks Yelii arrivent
  **directement sur `sgm-cem-api`**, sans passer par le proxy du web (route montée
  volontairement hors `/api`, voir piège n°7 de `DEPLOIEMENT_DOCKER.md`) — c'est la seule
  communication externe qui cible l'API directement plutôt que le web.

## 6. Vérifications

- `GET https://<url-api>/api/health` → `200`.
- Connexion (email/mot de passe ou OTP) sur `https://<url-web>` réussit et reste stable
  au fil de la navigation (pas de déconnexion intempestive — signe que le proxy et les
  cookies `sameSite: lax` fonctionnent correctement, voir §1).
- Upload d'un avatar (ou tout document GED) : vérifie que le disque persistant
  `sgm-cem-uploads` est bien monté sur `/app/apps/api/uploads`.
- Génération d'un reçu ou d'un rapport PDF (Puppeteer/Chromium) : vérifie la RAM
  disponible sur le plan `sgm-cem-api` (voir §2 si échec).

## 7. Limites connues

- Le disque persistant Render implique une **brève coupure** à chaque déploiement de
  l'API (le disque ne peut être attaché qu'à une seule instance à la fois — pas de
  zero-downtime deploy tant qu'un disque est monté).
- Sur un plan `free`, les fichiers du disque ne sont **pas sauvegardés** (à réserver au
  strict test, jamais à la production réelle — voir aussi §2).
- Suffixe aléatoire dans les URLs onrender.com : peu lisible pour les utilisateurs et
  fragile (toute recréation d'un service change l'URL, ce qui casse Google OAuth et les
  webhooks Yelii tant qu'ils ne sont pas remis à jour). À terme, brancher un **domaine
  personnalisé** sur `sgm-cem-web` (et éventuellement `sgm-cem-api`) : supprime ce
  suffixe, et permettrait — avec deux sous-domaines du même domaine personnel
  (`app.domaine.com` / `api.domaine.com`, donc plus "cross-site" au sens de la Public
  Suffix List) — de revenir à un appel direct navigateur → API avec WebSocket natif au
  lieu du polling Socket.IO, si on souhaite un jour simplifier ou retirer le proxy.
