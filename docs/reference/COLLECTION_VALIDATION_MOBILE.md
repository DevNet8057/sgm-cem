# Collectes : périmètres, validation et interface mobile

Architecture du 18 septembre 2026. Ce document décrit le contrat cible et la recette de livraison ; les vérifications effectives sont consignées en fin de document.

## Décisions métier

Une notification de paiement à confirmer ouvre la vue `validations` et cible l'identifiant exact de la contribution. La lecture, le focus et le défilement ne modifient aucun statut. Seul le clic explicite sur **Confirmer** déclenche la mutation. Le bouton de la ligne concernée affiche le chargement ; après succès, la ligne quitte la file et l'utilisateur reste dans cette vue. Le reçu reste accessible sur demande, sans ouverture automatique d'une fenêtre couvrant les données.

| Rôle | Contributions visibles | Confirmation et refus | Litige |
| --- | --- | --- | --- |
| MEMBRE | Ses paiements comme contributeur | Déclaration uniquement | Aucun pouvoir de supervision |
| COLLECTEUR | Contributions attribuées à son identifiant | Ses déclarations manuelles en attente | Réservé aux superviseurs |
| RESPONSABLE / ADJOINT_RESPONSABLE | Tous les collecteurs | Pas de substitution à un autre collecteur | Signalement et résolution non confirmante |
| TRESORIER | Tous les collecteurs | Ses propres attentes ; autrui uniquement avec autorisation administrative explicite | Signalement ; une résolution confirmante respecte également l'autorisation |
| ADMIN / DEVELOPER | Tous les collecteurs | Substitution autorisée, avec identification de l'acteur | Supervision complète |

La faculté de voir les personnes et de rechercher leur nom est conservée. Elle ne donne pas accès aux contributions attribuées à un autre collecteur. Les permissions portent sur les enregistrements et les agrégats côté API, pas seulement sur les boutons du web.

Un refus de collecte est distinct d'un litige : il annule une déclaration non confirmée. Une mise en litige de fonds déjà transférés ou déposés nécessite de préserver la comptabilité existante ; aucune annulation rétroactive silencieuse n'est ajoutée.

Une réception de transfert concerne des fonds déjà confirmés. Elle demeure une action du destinataire du transfert et ne vaut pas confirmation initiale de contribution.

## Contrat API commun

Conserver les enveloppes `{ success: true, data }` et `{ success: false, error: { code, message } }`. Les listes restent des tableaux dans `data`, avec `pagination` au niveau actuellement consommé par les vues.

Chaque contribution des vues financières expose les capacités calculées par le serveur :

- `actions.canConfirm`, `actions.canRefuse`, `actions.canDispute`, `actions.canResolveDispute`, `actions.canGrantConfirmation` ;
- `confirmedBy: { id, fullName, role } | null` ;
- `confirmationAuthorization` : résumé d'une autorisation nominative, expirante, éventuellement consommée/révoquée.

| Endpoint | Contrat |
| --- | --- |
| `GET /api/contributions` | Pagination bornée, recherche, filtres ; intersection obligatoire avec le périmètre du rôle |
| `GET /api/contributions/summary` | Comptes et montants calculés sur tout le périmètre autorisé, indépendamment de la page de résultats |
| `GET /api/contributions/validations` | Déclarations manuelles en attente ; même périmètre, pagination et cible `focusId` |
| `GET /api/contributions/:id` | Lecture ciblée hors pagination ; 404 pour une contribution hors périmètre |
| `PATCH /api/contributions/:id/confirm` | Confirmation explicite et atomique |
| `PATCH /api/contributions/:id/refuse` | `{ motif }`, 10 à 500 caractères ; annulation d'une attente autorisée |
| `PATCH /api/contributions/:id/litige` | Superviseur ; motif requis, transition contrôlée |
| `PATCH /api/contributions/:id/resolve-litige` | Résolution contrôlée ; `CONFIRME` réapplique la permission de confirmation |
| `PATCH /api/contributions/:id/confirmation-authorization` | ADMIN/DEVELOPER : `{ treasurerId, expiresAt, motif }` |
| `DELETE /api/contributions/:id/confirmation-authorization` | ADMIN/DEVELOPER : révocation de l'autorisation |

Une autorisation administrative porte sur **une contribution et un trésorier**, pas sur un rôle entier. Elle ne modifie pas le modèle d'authentification. L'ajout nullable `Contribution.confirmationAuthorization Json?` contient `treasurerId`, `grantedById`, `grantedAt`, `expiresAt`, `motif`, `consumedAt?`, `revokedAt?`. Les anciennes lignes n'ont aucune autorisation implicite. La validité du JSON, du compte trésorier et de l'administrateur émetteur est recontrôlée lors de l'action.

La mutation compare le statut et `updatedAt` précédemment lus. Confirmation, consommation de permission, audit et notification persistée sont atomiques. Un conflit renvoie 409 et ne produit pas une seconde notification. La contribution conserve son attribution ; `confirmedById` désigne le véritable valideur. Le collecteur reçoit le nom et le rôle de l'administrateur ou du trésorier autorisé.

Les paiements liés à un fournisseur ne deviennent pas confirmables manuellement : les preuves fournisseur et les webhooks conservent leurs contrôles existants.

## Plan backend validé par backend-lead

Chaque tâche nano modifie un seul fichier et préserve le travail multi-rubrique non commité.

1. `apps/api/prisma/schema.prisma` : ajouter le JSON nullable à `Contribution` sans toucher `PaymentBatch`, aux secrets ni au modèle d'authentification.
2. `packages/shared/src/contribution-access.ts` et, séparément, `packages/shared/src/index.ts` : publier le contrat des capacités, de l'autorisation et du résumé.
3. `apps/api/src/services/contribution-access.service.ts` : centraliser périmètre, modes manuels, matrice des capacités, validation du grant et erreurs d'accès.
4. `apps/api/src/services/audit.service.ts` : permettre un client transactionnel et une écriture stricte optionnels sans changer le comportement des appelants historiques.
5. `apps/api/src/routes/contributions.ts` : filtrer listes/recherches/statuts ; ajouter résumé, détail, refus et autorisation ; transitions conditionnelles ; audit et notification de substitution. Les routes `/declare`, `/me`, `/receipt`, `/timeline`, `/proof` appelées par le web sont absentes du fichier constaté : restaurer les routes nécessaires à partir de l'historique et des contrats consommés, en appliquant le même périmètre.
6. `apps/api/src/routes/collecteurs.ts` : limiter `flowGroups` et `modeGroups` en plus de la liste déjà filtrée ; fermer l'appropriation arbitraire par `/claim`. Les réceptions doivent passer par un transfert désignant explicitement le destinataire.
7. `apps/api/src/routes/membres.ts` : conserver la recherche des personnes ; filtrer leurs contributions imbriquées pour un collecteur.
8. `apps/api/src/routes/rubriques.ts` : filtrer les compteurs et montants accessibles au collecteur ; distinguer un total personnel d'un total global.
9. `apps/api/src/routes/payments.ts` : filtrer le suivi avant le polling fournisseur ; isoler les réservations dédupliquées par attribution ; contrôler `collecteurId` lors des lots ; conserver toutes les modifications multi-rubrique déjà présentes.
10. Services Socket.IO et webhooks : vérifier les destinataires des événements financiers, sans modifier les signatures ni les exemptions CSRF.

Les endpoints globaux `stats` et rapports exigent déjà le niveau 3. Les notifications et l'audit sont déjà limités à l'utilisateur selon son rôle. Les transferts `funds` vérifient le destinataire ; leur consultation et leur réception restent distinctes du grant de confirmation initiale.

Limite de modèle préexistante : une réception par un autre collecteur remplace actuellement `collecteurId`. Ce champ représente donc aussi le détenteur actuel, et non uniquement l'auteur historique de la collecte. Le filtrage immédiat suit cette attribution courante. Un indicateur historique immuable de collecte exige une séparation attribution/détention et un traitement explicite des anciennes lignes ; ne pas prétendre avoir reconstruit l'historique à partir de la seule valeur actuelle.

## Plan frontend et inventaire mobile

Les défauts constatés sont structurels : `Modal.tsx` n'utilise pas de portail ni de hauteur bornée ; `SearchableSelect.tsx` rend sa liste absolue dans des parents défilants, qui peuvent la couper ; plusieurs fenêtres contournent la primitive commune. La correction doit couvrir ces primitives puis les exceptions.

Primitives et shell :

- `components/ui/Modal.tsx` : portail, focus contenu/restauré, Escape, fermeture accessible, hauteur bornée au viewport visible et corps défilant. Réutiliser les garanties d'Ant Design déjà installé.
- `components/ui/SearchableSelect.tsx` : liste portalisée, largeur bornée, collision haut/bas, recherche et clavier/ARIA. Réutiliser `antd Select` avec `showSearch`, des options conservant les sous-libellés, une hauteur de liste limitée.
- `components/ui/Input.tsx` et primitive de sélection simple : couleur lisible, libellé relié au champ ; choix tactiles adaptés. Les sélecteurs natifs peuvent ouvrir un écran propre au système d'exploitation : le CSS seul ne peut pas garantir la hauteur de leur liste. Les sélecteurs applicatifs doivent utiliser une primitive contrôlée commune pour obtenir cette garantie.
- `app/providers.tsx` : exposer les dimensions et décalages de `window.visualViewport`, écouter resize/scroll et garder le champ actif visible sans forcer le retour en haut.
- `app/globals.css` : saisie à 16 px sur mobile, cibles tactiles, safe areas, limites de largeur et hauteur des listes/modales, défilement interne ; borne de liste autour de 224 px et d'une fraction du viewport visible.
- `app/layout.tsx` : autoriser le zoom utilisateur ; ne pas bloquer l'accessibilité par `maximumScale: 1`.

Inventaire exhaustif des familles de sélection constatées par recherche du code :

| Fichier sous `apps/web/src` | Famille |
| --- | --- |
| `components/ui/Input.tsx` | Primitive native `Select` |
| `components/ui/SearchableSelect.tsx` | Recherche personnalisée |
| `components/views/Dashboard.tsx` | Select Ant Design |
| `components/views/ContributionStepper.tsx` | Recherche membre/rubrique |
| `components/views/Contributions.tsx` | Recherche membre/rubrique/mode/collecteur |
| `components/payments/PaymentStepper.tsx` | Recherche et select natif collecteur |
| `components/payments/AllocationEditor.tsx` | Select natif rubrique, travail multi-rubrique à préserver |
| `components/public/PublicCollecteStepper.tsx` | Select natif champs publics |
| `components/views/Collecteurs.tsx` | Selects natifs destinataire/localisation |
| `components/views/CollectesPubliques.tsx` | Select natif type de champ |
| `components/views/Ged.tsx` | Selects locaux natifs et filtre statut |
| `components/views/GestionUtilisateurs.tsx` | Selects natifs rôle |
| `components/views/Journal.tsx` | Selects natifs action/entité/utilisateur |
| `components/views/Membres.tsx` | Selects locaux natifs catégorie/groupe/statut/profil |
| `components/views/Observabilite.tsx` | Select natif période |
| `components/views/Rubriques.tsx` | Selects locaux type/priorité/ciblage |
| `components/views/Prestations.tsx` | Select natif mode de paiement |

Fenêtres hors primitive à migrer : `ContributionStepper.tsx`, `Developer.tsx` (historique), `Ged.tsx` (refus), `TransferValidations.tsx` (refus). Les autres consommateurs `Modal` héritent de la correction commune : Collecteurs, CollectesPubliques, Contributions/timeline, Membres, Rubriques, Prestations, GestionUtilisateurs, Litiges, Validations et ReceiptSuccessModal. Les modales Ant Design de `app/page.tsx`, `PaymentStepper.tsx`, `ContributionGuideeStepper.tsx` reçoivent les limites globales. Le Drawer du Sidebar et le Dropdown du TopBar doivent rester accessibles dans le viewport visible. SplashScreen n'est pas un formulaire et ne nécessite pas une migration en modale.

Flow et permissions web :

- `components/views/Validations.tsx` : consommer les capacités serveur, refus distinct, action administrative de grant/révocation, erreurs par ligne, chargement du seul bouton cliqué, état erreur/vide/chargement, pagination. Cible notification hors page chargée explicitement ; élément traité ou inaccessible expliqué sans mutation.
- `components/views/Litiges.tsx` : utiliser les capacités serveur pour la résolution confirmante ; ne pas proposer une confirmation interdite au trésorier.
- `components/views/DashboardCollecteur.tsx` : lire le résumé complet au lieu de calculer les KPI sur les 20 dernières contributions.
- `hooks/useFocusHighlight.ts` : effectuer le focus et le défilement une seule fois, respecter les animations réduites, ne pas perdre le délai de surbrillance en nettoyant la cible du store.
- `app/(app)/dashboard/page.tsx` : le switch COLLECTEUR omet actuellement `transfer-validations` et `rubriques`, pourtant affichés au Sidebar. Rétablir ces routes autorisées.
- `components/views/TransferValidations.tsx` : chargement par identifiant, invalidation séparée des clés de requête (le tableau composite actuel n'invalide pas deux clés), reçu à la demande, refus via la primitive commune.

## Recette et état de livraison

Les tests API historiques écrivent dans la base locale. La recette automatique de ce chantier doit utiliser Prisma, fournisseurs, notifications et réseau mockés ; ne pas importer l'application complète qui démarre les jobs. Exécuter les suites mockées avec isolation activée car la configuration historique utilise `isolate: false`.

Cas indispensables : collecteur A ne lit ni ne confirme B ; tentative de substitution par filtre/body refusée ; montants et compteurs cohérents ; recherche de personne conservée ; refus propre distinct du litige ; administrateur identifiable et notification unique ; trésorier sans grant refusé, grant expiré/révoqué/consommé refusé, course de deux confirmations sans double effet ; résolution de litige sans contournement ; notification lue sans mutation ; cible hors première page ; clavier et liste/modale aux largeurs 320/390/768 px, paysage et viewport réduit.

Checks : shared build, API/web type-check, tests ciblés, build Next.js production. Aucun paiement réel, aucune écriture de base de recette existante, aucun `db push`, aucun déploiement ni commit pendant la préparation. Le schéma nullable devra être appliqué sur la bonne base au déploiement conformément à `DEPLOIEMENT_DOCKER.md`.

État initial : analyse du code et plan backend terminés. Implémentation et vérifications à compléter ; ce document ne vaut pas preuve de tests réussis.
