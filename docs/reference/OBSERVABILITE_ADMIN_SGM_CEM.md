# Observabilité administrateur — SGM-CEM

Date de conception : 16 septembre 2026. Statut : contrat arrêté, réalisation et validation en cours.

## 1. Objectif et périmètre

Donner aux rôles ADMIN et DEVELOPER une vue de la présence des utilisateurs, de leurs sessions, des sections consultées, des durées actives et des opérations métier déjà auditées. Le suivi concerne l'espace authentifié. Les formulaires publics, les liens de collecte, la page de connexion et le retour de paiement ne sont pas instrumentés.

Le terme « temps réel » désigne ici une actualisation automatique toutes les 30 secondes. Une présence sans signal depuis 90 secondes devient inactive. Cette approximation reste utilisable après une coupure réseau ou la fermeture brutale du navigateur. Une absence de signal ne constitue jamais la preuve d'une déconnexion volontaire.

## 2. État initial vérifié

- Les connexions email, OTP et Google écrivent déjà des événements LOGIN dans AuditLog ; LOGOUT existe pour la déconnexion volontaire. Un échec de mot de passe peut également produire LOGIN avec success=false : il faut le distinguer d'une connexion réussie.
- UserSession contient l'identifiant serveur, l'utilisateur, un refresh token et sa date d'expiration. Les lignes sont supprimées lors de la déconnexion.
- Le JWT d'accès ne contient pas d'identifiant de session. L'instrumentation ne doit modifier ni sa structure ni les cookies.
- Le tableau de bord conserve la section dans useAppStore.activeView. Suivre seulement l'URL /dashboard ne permettrait pas de distinguer les sections.
- Un développeur peut se connecter en tant qu'un autre utilisateur. Ces visites sont exclues du suivi d'usage afin de ne pas les attribuer au compte simulé.
- Socket.IO existe dans le dépôt, mais des modifications préexistantes de index.ts ont retiré son démarrage. La fonctionnalité utilise HTTP et ne rétablit pas ce changement utilisateur.
- Plusieurs fichiers de paiement et deux documents de référence sont déjà modifiés. Le lot observabilité doit rester identifiable séparément.

Les conventions annoncées dans AGENTS.md sous .Codex/instructions sont présentes dans ce checkout sous .claude/instructions. Ces fichiers et DEPLOIEMENT_DOCKER.md ont été lus.

## 3. Contrat avant implémentation

Le contrat canonique est packages/shared/src/activity.ts, réexporté par packages/shared/src/index.ts. Toutes les réponses suivent { success: true, data } ou l'enveloppe d'erreur AppError existante.

| Méthode et chemin | Accès | Entrées principales | Résultat |
| --- | --- | --- | --- |
| POST /api/activity/heartbeat | Compte authentifié actif | tabId UUID, seq entier, pageKey allowlist, isActive booléen | Acceptation, heure serveur, fin estimée de présence |
| POST /api/activity/end | Compte authentifié actif | tabId UUID, seq entier | Fermeture de cet onglet seulement |
| GET /api/activity/overview | ADMIN, DEVELOPER | days : 7, 30 ou 90 | Présence, sessions, durées, actions, pages et jours |
| GET /api/activity/users | ADMIN, DEVELOPER | days, page, limit, q, role, presence | Liste paginée de tous les comptes, y compris sans observation |
| GET /api/activity/sessions | ADMIN, DEVELOPER | page, limit, userId, state, from, to | Sessions, onglets et temps par section |
| GET /api/activity/actions | ADMIN, DEVELOPER | page, limit, userId, action, from, to, success | Actions métier assainies issues du journal existant |

Les listes utilisent items, total, page, pageSize et totalPages. Les dates sont des chaînes ISO. Les durées sont des secondes entières. Les périodes et limites sont validées et bornées côté serveur.

L'identité, le rôle, l'identifiant de session d'authentification et les timestamps ne proviennent jamais du corps reçu. Le cookie de rafraîchissement permet uniquement de retrouver une UserSession valide appartenant à l'utilisateur authentifié. Le token n'est jamais copié dans les nouvelles tables ou les réponses.

Une impersonation, une session navigateur absente/expirée ou un signal dupliqué peuvent être ignorés avec accepted=false et une raison contrôlée. Une validation incorrecte reste une erreur HTTP. Les événements reçus n'autorisent aucune opération métier.

## 4. Stockage additif

Trois tables nouvelles, validées par le backend-lead :

| Modèle | Responsabilité | Contraintes |
| --- | --- | --- |
| ActivitySession | Session observée associée à une connexion réelle, dernières présences, dernier instant comptabilisé, temps actif, fin volontaire | authSessionId unique ; userId et authSessionId sont des scalaires, sans modification de User ou UserSession |
| ActivityTab | Dernier état connu d'un onglet, section, séquence, activité et fermeture | Unicité sessionId + tabId ; UUID renouvelé au montage du tracker |
| ActivityPageAggregate | Temps par session, section et jour UTC | Unicité sessionId + pageKey + day ; index de période |

Seules les nouvelles tables ont des relations entre elles, avec suppression en cascade de leurs agrégats. Aucun champ d'authentification ni enum métier existant n'est modifié. Le déploiement utilise prisma db push, sans migration et sans accept-data-loss.

Le journal AuditLog reste la source des opérations métier : aucune recopie des détails financiers ou personnels dans la télémétrie. L'écran ne promet pas une journalisation de tous les clics ; il présente les opérations déjà auditées.

## 5. Mesure et concurrence

Le navigateur émet un signal toutes les 30 secondes et lors des changements de section, visibilité, focus ou connexion réseau. Un onglet est actif seulement lorsqu'il est visible, possède le focus et a reçu une interaction depuis moins de deux minutes. Le contenu et la nature des interactions ne sont pas transmis.

Le serveur mesure l'intervalle écoulé depuis le signal précédent. Le premier signal et la reprise après un état inactif n'ajoutent aucun temps. Le crédit est attribué à la section précédente lorsque l'onglet était actif. Chaque intervalle est plafonné à 45 secondes, ce qui évite de comptabiliser une longue coupure ou une machine suspendue.

La séquence est strictement croissante par onglet. Un doublon ou un événement plus ancien ne modifie ni le temps ni la section. Une transaction verrouille la session et conserve un curseur de comptabilisation commun : deux onglets de la même connexion ne peuvent créditer deux fois le même intervalle. Les intervalles traversant minuit UTC sont répartis entre les deux journées.

Les durées actives représentent une estimation de l'utilisation de l'application, pas une mesure de productivité. Un utilisateur disposant de connexions distinctes sur plusieurs appareils peut cumuler des durées entre appareils ; la déduplication garantit l'absence de double comptage à l'intérieur d'une même connexion.

Le temps actif et le temps écoulé d'une session sont distincts. L'interface montre les dates d'observation et d'expiration. LOGGED_OUT désigne une déconnexion explicitement observée, EXPIRED une expiration de session, INACTIVE un signal trop ancien, ONLINE une présence récente. Une fermeture d'onglet ne déconnecte pas les autres onglets.

## 6. Sécurité, confidentialité et disponibilité

- Les lectures nécessitent ADMIN ou DEVELOPER, contrôlé dans le middleware et revalidé depuis le compte en base ; un ancien rôle dans le JWT ne suffit pas.
- L'ingestion vérifie également l'activité du compte, l'appartenance et la validité de la session navigateur.
- Les clés de sections sont une liste fermée partagée. Aucune URL libre, query string, champ saisi, contenu de formulaire, mot de passe, token, IP ou empreinte navigateur n'est enregistré dans ces tables.
- La liste d'actions expose uniquement l'identité de l'acteur, le type d'action, l'entité, la date et un indicateur de réussite contrôlé. Les details bruts, anciennes/nouvelles configurations et secrets ne sont pas renvoyés.
- L'impersonation est exclue côté client et serveur. L'exclusion client seule ne serait pas une barrière suffisante.
- CSRF reste applicable à heartbeat et end. Aucun endpoint de télémétrie n'est ajouté aux exemptions existantes.
- Un limiteur propre au domaine activité, avec clé d'utilisateur authentifié, évite de consommer le quota global partagé d'une adresse réseau. Le trafic refusé ou non authentifié reste borné. Les consultations automatiques sont limitées à la vue ouverte.
- Les erreurs de télémétrie ne doivent pas annuler une action métier. La clôture lors du logout est best effort et précède la suppression de la session d'authentification.
- Les réponses de consultation ne doivent pas être mises en cache par un cache partagé.
- La rétention des observations est de 90 jours par défaut. Le nettoyage ne vise que les nouvelles tables ; il ne supprime pas les audits métier existants.
- Les paramètres métier passent par getConfig avec des valeurs par défaut bornées. Aucune nouvelle variable d'environnement, clé secrète ou dépendance Redis n'est nécessaire.

Une information non bloquante dans Mon profil explique les données mesurées, leur usage administrateur et l'absence de collecte des contenus saisis.

## 7. Découpage de réalisation

Chaque tâche de code porte sur un seul fichier. Les rôles backend-lead et frontend-lead établissent les plans ; les tâches d'exécution suivent ces plans sans arbitrage d'architecture.

| Lot | Fichiers principaux | Livraison attendue |
| --- | --- | --- |
| Contrat | packages/shared/src/activity.ts ; packages/shared/src/index.ts | DTO et clés canoniques |
| Schéma | apps/api/prisma/schema.prisma | Trois tables additives et index |
| Écriture backend | apps/api/src/services/activity-write.service.ts | Sessions, séquences, durées, clôture et rétention |
| Lecture backend | apps/api/src/services/activity-admin.service.ts | Agrégats et listes paginées assainies |
| API | apps/api/src/routes/activity.ts ; src/index.ts ; routes/auth.ts | Validation, autorisations, quotas, montage et hook logout |
| Collecte web | apps/web/src/hooks/useActivityTracker.ts ; app/(app)/layout.tsx | Signaux de présence et sections |
| Interface | components/views/Observabilite.tsx ; layout/Sidebar.tsx ; layout/TopBar.tsx ; app/(app)/dashboard/page.tsx | Navigation administrateur et quatre panneaux |
| Information | components/views/MonProfil.tsx | Transparence de la mesure d'usage |
| Vérification | Nouveaux tests activité API et web | Cas de sécurité, mesure et interface |

La plateforme limite l'arbre à quatre agents et conserve les slots des leads terminés. Après analyse, les leads peuvent donc être explicitement réaffectés à des tâches d'exécution courtes. La revue finale est croisée : aucun auteur ne valide seul son propre lot. Cette adaptation ne change pas l'interdiction pour l'architecte d'écrire le code.

## 8. Recette et critères d'acceptation

Vérifications automatiques prévues : compilation shared, génération et validation Prisma, type-check API et web, tests ciblés, build Next.js. Les tests nouveaux utilisent des doubles pour ne pas manipuler involontairement la base de développement. Les suites historiques qui écrivent dans cette base doivent être signalées séparément.

Cas essentiels :

1. Accès anonyme refusé ; MEMBRE, COLLECTEUR, responsables et TRESORIER refusés sur les lectures ; ADMIN et DEVELOPER autorisés ; compte désactivé et rôle révoqué refusés.
2. CSRF absent refusé ; utilisateur/session incompatibles ignorés ou refusés ; body arbitraire et section inconnue rejetés ; absence totale de token ou details sensibles dans les réponses.
3. Premier signal sans durée ; signaux espacés de 30 secondes ; plafond après coupure ; retour d'inactivité ; séquence dupliquée et désordonnée ; concurrence de deux onglets ; séparation UTC minuit.
4. Fin d'un onglet sans fermeture de l'autre ; logout volontaire ; absence réseau ; expiration ; exclusion impersonation ; reprise après actualisation.
5. Tous les comptes visibles dans la liste, même sans historique ; période et pagination cohérentes ; LOGIN échoué distingué des connexions réussies.
6. Tracker absent des pages publiques ; navigation interne correctement identifiée ; états chargement/vide/erreur/succès en français ; accès Sidebar cohérent avec l'API.

La recette verify du projet rappelle que PostgreSQL natif Windows et PostgreSQL Docker peuvent être deux bases différentes. Le serveur Docker est indisponible sur cette machine au début de ce chantier : un build local réussi ne doit pas être présenté comme un déploiement Docker vérifié.

## 9. Livraison et déploiement

Le dépôt Git réel est la racine CF MELEN, malgré le dossier sgm-cem/.git présent. La branche et la cible distante doivent être revérifiées avant publication. Les changements préexistants de paiement, configuration et documentation ne font pas partie de ce lot.

Le commit de fonctionnalité doit inclure les nouveaux fichiers et les seules intégrations observabilité dans les fichiers déjà modifiés. Les hunks préexistants de index.ts doivent rester hors de ce commit. Une revue du diff indexé est obligatoire avant le push autorisé par l'utilisateur.

Après validation : compiler shared/API/web ; sur la cible, reconstruire l'API et le web ; laisser l'entrypoint appliquer le schéma additif via db push ; vérifier /api/health puis le refus RBAC et une mesure administrateur. Ne jamais utiliser down -v, force-reset ou accept-data-loss. Si l'environnement de déploiement n'est pas accessible, indiquer exactement que le code a été publié mais que l'application distante n'a pas été vérifiée.

## 10. Résultats de vérification

Exécuté le 16 septembre 2026 : compilation du contrat partagé (`pnpm --filter @sgm-cem/shared build`), génération Prisma et validation Prisma réussies. `git diff --check` ne remonte pas d'erreur d'espacement.

La relecture indépendante a imposé la suppression de toute lecture ou réponse de `AuditLog.details`, la transformation des sessions vers le DTO public administrateur, l'en-tête `Cache-Control: no-store`, le limiteur par utilisateur et l'intégration de la clôture logout et de la purge. Ces corrections ont été appliquées avant publication.

Les type-check globaux API et web restent bloqués par des modifications préexistantes hors lot : `src/index.ts` importe `./routes/webhooks` absent, `routes/contributions.ts` importe `../services/payment` absent, et `web/src/components/views/Contributions.tsx` n'envoie pas la prop requise `onSuccess` à `ContributionStepper`. Ces erreurs ne sont pas corrigées par ce lot afin de ne pas écraser le chantier paiement en cours. Par conséquent, aucun déploiement de production ne doit être déclaré vérifié tant que le build global n'est pas vert.
