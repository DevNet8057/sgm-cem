# Contributions réparties entre plusieurs rubriques

Décision d'architecture du 17 septembre 2026. Chantier en cours : les vérifications et la livraison sont consignées en fin de document.

## Besoin et parcours

Le membre connecté saisit un budget, par exemple 5 000 FCFA, puis ajoute des lignes « rubrique + montant ». Après 3 000 FCFA affectés à une première rubrique, le solde à répartir est de 2 000 FCFA ; après 1 000 FCFA sur une deuxième, il reste 1 000 FCFA. Une ligne peut être corrigée ou supprimée. Une rubrique ne figure qu'une fois et seuls des montants entiers positifs sont acceptés.

Le budget reste distinct de la somme répartie. Si le membre conserve un reste, il choisit explicitement de poursuivre avec la somme répartie : le reste n'est ni attribué automatiquement ni encaissé. Les frais Mobile Money éventuels s'ajoutent à cette somme et sont annoncés dans le récapitulatif.

La demande concerne les contributions financières existantes. Aucun catalogue de vêtements ou de dons en nature n'est introduit sur la base du mot isolé présent dans la dictée.

## Constat vérifié avant modification

- `PaymentStepper` est commun aux entrées membre de `MesContributions`, `RubriquesMembre` et `ContributionGuideeStepper`.
- Le staff utilise aussi un ancien `ContributionStepper`, et `/payments/initiate` reçoit historiquement une seule rubrique.
- Une `Contribution` représente une affectation comptable à une rubrique. `externalTransactionId` y est unique : le réutiliser sur plusieurs contributions violerait cette contrainte.
- Webhooks, polling et réconciliation confirment historiquement une seule contribution. Une boucle de paiements par rubrique provoquerait plusieurs demandes opérateur et ne satisferait pas le paiement unique demandé.
- Les endpoints `/contributions/me`, `/contributions/me/balance` et `/contributions/declare` sont appelés par l'interface mais absents du routeur dans le commit de départ `42059b6` ; les surfaces nécessaires au nouveau parcours doivent être traitées explicitement.
- Les conventions se trouvent dans `.claude/instructions/` dans ce checkout ; `.Codex/instructions/` n'existe pas. `DEPLOIEMENT_DOCKER.md` impose `prisma db push`, sans migrations ni réinitialisation.

## Contrat API de couplage

Types source dans `packages/shared/src/payment-batches.ts`, exportés par `packages/shared/src/index.ts`.

`POST /api/payments/batches/initiate`, authentifié, niveau minimum 1 :

```json
{
  "idempotencyKey": "identifiant-stable-de-la-tentative",
  "membreId": "membre-connecte",
  "budgetAmount": 5000,
  "allocations": [
    { "rubriqueId": "rubrique-1", "montant": 3000 },
    { "rubriqueId": "rubrique-2", "montant": 1000 },
    { "rubriqueId": "rubrique-3", "montant": 1000 }
  ],
  "modePaiement": "YELII",
  "mobileMoneyPhone": "6XXXXXXXX",
  "paymentChannel": "MTN"
}
```

Modes : `YELII`, `CARTE_VISA`, `ESPECES`. La carte utilise `customerPhone`. Une déclaration espèces membre exige un `collecteurId` éligible. Le membre ne peut initier ou suivre que ses propres paiements. Les rôles staff conservent leurs accès existants, dont `DEVELOPER`.

Réponse enveloppée `{ success: true, data }` : identifiant du lot, identifiant fournisseur éventuel, URL carte éventuelle, état, budget, somme répartie (`dueAmount`), reste (`remainingAmount`), frais (`commissionAmount`), montant total débité (`totalToPay`) et liste des contributions par rubrique avec état et reçu. Les erreurs respectent `{ success: false, error: { code, message } }`.

`GET /api/payments/status/:id` conserve les champs historiques et accepte également l'identifiant du lot ou sa transaction fournisseur. Les anciennes contributions et les liens de retour carte continuent à fonctionner.

Validation serveur : 1 à 50 lignes, rubriques ouvertes, identifiants non répétés, montants entiers strictement positifs, somme inférieure ou égale au budget, bornes compatibles avec les entiers PostgreSQL. Le multiple de 5 imposé pour la carte s'applique à la somme payée, pas à chaque ligne.

## Persistance et traitement de l'argent

Un nouveau `PaymentBatch` représente le règlement unique. Ses enfants `Contribution` restent les écritures comptables, avec leur vrai montant et rubrique. La nouvelle relation de contribution est nullable : les anciennes données restent valides. L'identifiant fournisseur est porté par le lot et les enfants ne le dupliquent pas dans leur champ unique.

La réservation du lot et de toutes les lignes est atomique. La clé d'idempotence appartient à une tentative et une empreinte de requête empêche sa réutilisation avec un autre contenu. Les tentatives en cours identiques sont rapprochées avant tout nouvel appel fournisseur, y compris avec une nouvelle clé navigateur.

Un seul appel Yelii ou CinetPay est effectué pour la somme des lignes. La commission Mobile Money est calculée une seule fois selon le taux dynamique `getConfig()`. Les frais et le net sont répartis entre les enfants de façon déterministe en conservant exactement leur somme, afin que les reçus et rapports n'additionnent pas plusieurs fois les frais du même paiement.

La confirmation fournisseur et celle de tous les enfants sont atomiques et idempotentes. Les vérifications de montant et de devise précèdent les écritures. Webhook, polling et réconciliation réutilisent la même transition. Un enfant numérique ne peut pas être confirmé manuellement indépendamment du lot. Les reçus et notifications sont produits après la transaction, sans qu'un échec PDF ne transforme un paiement confirmé en échec.

Pour les espèces membre, toutes les lignes sont créées en attente avec le collecteur choisi. Leur réception passe par la validation humaine ; aucune confirmation automatique n'est accordée au membre. Le suivi du lot espèces reflète les états des lignes.

Une réponse fournisseur incertaine ne vaut pas échec définitif. Yelii ne fournit actuellement aucune clé marchande persistée dans notre intégration : une coupure après acceptation mais avant réception de son identifiant ne permet pas de promettre une reprise externe exactement une fois. Une tentative incertaine reste bloquée et signalée, sans renvoyer automatiquement une nouvelle demande de débit.

## Vérification et livraison

Contrôles attendus : compilation shared/API/web, validation Prisma, tests des invariants d'allocation et de la réservation, transitions atomiques concurrentes, refus d'accès d'un autre membre, carte et Mobile Money simulés, espèces en attente, ancien flux mono-rubrique conservé, récapitulatif et solde sur mobile.

Aucun test ne déclenche de paiement réel. Aucun changement d'authentification, de secret ou de `docker-compose.yml` n'est prévu. Le schéma est additif et sa synchronisation est une condition préalable au déploiement de l'API. Le web est ensuite reconstruit. Commit, push et déploiement ne sont rapportés comme réalisés que sur preuve d'exécution.

État de recette : à compléter après implémentation et revue.
