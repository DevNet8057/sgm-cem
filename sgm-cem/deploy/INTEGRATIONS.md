# Intégrations de production

État vérifié le 23 novembre 2026 pour `https://sgm-cem.16-16-63-155.sslip.io`.

L'audit porte sur les 252 fichiers suivis par Git de l'arbre courant du dépôt, sans exploration de l'historique ni d'autres comptes. Aucune valeur secrète n'est reproduite ici.

| Intégration | État | Condition d'activation |
|---|---|---|
| Google | Non activée | Un identifiant client OAuth public plausible figure dans `docs/reference/README-DEMARRAGE.md:113`. Le domaine gratuit est disponible, mais un projet Google Cloud autorisé par l'utilisateur et la configuration de ses origines restent nécessaires. Aucun secret client Google n'a été trouvé. |
| Yelii | Activée en configuration | L'utilisateur a confirmé que la clé publiée dans `docs/reference/PAYMENT_FLOWS_SGM_CEM.md:64` appartient à son compte marchand et a autorisé son activation. Une lecture authentifiée du wallet répond HTTP 200 avec `success=true` ; la même route sans clé répond HTTP 401. `MOBILE_MONEY_ENABLED=true`, clés en `.env` privé et paramètres secrets en base. La clé reste publiquement exposée et doit être renouvelée chez le fournisseur. Aucun paiement ni envoi d'argent n'a été testé. |
| CinetPay | Désactivée | Aucun jeu d'identifiants exploitable trouvé ; renseigner les identifiants marchands privés et les webhooks. |
| MTN / Orange Money directs | Désactivés | Les valeurs documentées sont des exemples ; identifiants partenaires requis. |
| Email SMTP | Désactivé | Hôte, utilisateur et mot de passe d'application du fournisseur requis. Aucun email extérieur envoyé. |
| WhatsApp / SMS | Désactivés | Identifiants 360dialog/Twilio et numéro validé requis. Aucun message extérieur envoyé. |
| Stockage S3 / R2 | Non configuré | Aucun identifiant exploitable trouvé. Le stockage local persistant dans le volume `uploads` reste opérationnel. |
| Web Push | Configuré localement | Paire VAPID P-256 créée pour cette installation, signature locale vérifiée et `PUSH_ENABLED=true`. L'utilisateur doit autoriser les notifications dans son navigateur et s'y abonner. Aucun abonnement ni envoi de test n'a été créé automatiquement. |

Les exemples de `sgm-cem/.env.example`, ainsi que `docs/reference/GUIDE_SGM_CEM.md:252`, sont des placeholders et ne doivent pas être importés comme identifiants réels. Les autres services de paiement et d'envoi extérieur restent désactivés tant qu'aucun identifiant privé validé n'est fourni.

## Web Push

Depuis `/srv/sgm-cem/sgm-cem` :

```sh
python3 deploy/configure-webpush.py
python3 deploy/configure-webpush.py --check
sudo docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate api
```

Le script conserve les clés existantes et refuse une divergence entre `.env` et la base afin d'éviter une rotation implicite. Les clés sont conservées dans `.env` (permissions `600`) et dans les paramètres applicatifs en base ; `VAPID_PRIVATE_KEY` est marquée secrète, l'historique et l'audit la masquent. Chaque changement est tracé par l'action `DEVELOPER_PANEL_CONFIG_CHANGED` avec le compte administrateur initial.

Le script valide la paire elliptique et une signature JWT VAPID sans appeler de serveur push. Une seconde exécution ne modifie ni les clés ni l'audit. Le redémarrage/recréation de l'API recharge le cache de configuration.

La clé publique est accessible après authentification via `GET /api/notifications/push/public-key`. La clé privée ne doit jamais être ajoutée au frontend, au dépôt ou aux captures.

## Vérification Yelii en lecture seule

La documentation publique `https://api.yelii.xyz/docs` renvoie actuellement HTTP 404. La route de contrôle déjà implémentée par l'application (`getYeliiWalletBalance`, `apps/api/src/services/yelii.service.ts`) a été utilisée sans explorer d'autres URLs :

- `GET https://api.yelii.xyz/api/yelii-pro-pay/v1/wallet/balance` avec `X-Collect-Api-Key` : HTTP 200, enveloppe JSON `success=true`, aucun champ d'erreur.
- Contrôle sur la même route sans clé : HTTP 401.
- Structure constatée, sans recopier les valeurs : `data.collectWallet` numérique, `data.currency` textuel, `data.collectCommissionRate` numérique.

Le lecteur de wallet a été adapté à `data.collectWallet`, avec compatibilité des anciens champs `data.balance`/`balance`. Une réponse sans solde numérique valide est refusée, au lieu de présenter un faux solde nul. Les tests utilisent uniquement des données inventées et un `fetch` simulé, dans un conteneur sans réseau.

La configuration utilise l'URL publique canonique pour `YELII_WEBHOOK_URL` et préserve les autres secrets, les clés VAPID et les URLs. Les modifications sont auditées sous le compte administrateur initial, avec valeurs secrètes masquées. La vérification de lecture confirme l'acceptation de la clé par le fournisseur ; elle ne constitue pas un test de paiement réel de bout en bout. Aucun POST financier, transaction, SMS ou envoi d'argent n'a été déclenché.
