# Transfert des données locales — 24 novembre 2026

La base PostgreSQL native utilisée par l'API locale a été transférée dans la base du VPS. Le propriétaire a choisi cette source ; l'ancienne base Docker, indisponible lors de l'inventaire, ne fait pas partie du transfert.

Les catalogues réels sont compatibles : 27 tables, sans différence de colonnes ou de types. Aucun changement de schéma n'a été appliqué. Les sources de certaines branches du dépôt décrivent une architecture plus récente ; elles n'ont pas servi à modifier la structure de cette base.

## Données reprises

| Données | Nombre après transfert |
|---|---:|
| Comptes | 35 |
| Membres | 29 |
| Rubriques | 13 |
| Contributions | 90 |
| Commissions | 5 |
| Versements bancaires | 1 |
| Transferts de fonds | 2 |
| Types de documents | 8 |
| Notifications historiques importées | 92 |
| Fichiers copiés et contrôlés | 45 |

Le total des montants des contributions est de **1 771 305 FCFA**, identique à la source. Les 43 contributions confirmées, 37 en attente et 10 annulées conservent leur statut. Les 598 audits locaux sont repris ; un nouvel audit `DataMigration` décrit le transfert. Les données de présence sont conservées comme historique fermé pour ne pas faire apparaître d'anciens utilisateurs connectés.

## Accès et intégrations

Le compte Développeur distant est rapproché du compte local par son adresse email ; son identifiant, son mot de passe et son rôle distants sont conservés. Un autre compte local avait le même numéro de membre que ce Développeur : son numéro a été remplacé par le prochain numéro libre. Les correspondances détaillées sont privées.

À la demande explicite du propriétaire, les 34 comptes importés conservent leurs mots de passe locaux et doivent les changer lors de leur prochaine connexion. Les sessions, codes OTP et abonnements push locaux ne sont pas copiés. Les rôles et états actif/inactif des comptes importés sont préservés.

Les 54 paramètres d'intégration distants, leur historique et les réglages métier sont conservés. Les anciennes clés locales ne remplacent pas les clés Google, SMTP, Yelii et VAPID du VPS. Leurs secrets et les mots de passe ne figurent pas dans ce document ni dans Git.

Les URL locales des reçus et fichiers associés sont réécrites vers le domaine public ; 36 références de fichiers présentes dans la source ont été vérifiées. Les références du compte Développeur fusionné donnent priorité à son profil distant actuel.

## Contrôles

- Sauvegarde locale `pg_dump` vérifiée et sauvegarde du serveur avant transfert, dans des emplacements privés.
- Instantané local cohérent en lecture seule ; les 20 tables importées ont été relues pour vérifier leur absence de modification après l'instantané.
- Répétition de la fusion sur un PostgreSQL 15 jetable contenant une copie de la base distante.
- Contrôles des identifiants, relations, comptages et totaux financiers dans une transaction unique.
- API temporairement arrêtée pendant l'application pour éviter les écritures concurrentes, puis redémarrée en bonne santé.
- Empreintes de chaque fichier vérifiées ; aucun fichier divergent existant écrasé.
- Empreintes des paramètres, réglages et accès protégés inchangées après transfert.

Les rapports et sauvegardes détaillés sont conservés sur le poste dans les dossiers `E:\sgm-cem-vps\reports` et `E:\sgm-cem-vps\private`. Les sauvegardes et les exports SQL contenant les données ne doivent jamais être versionnés.
