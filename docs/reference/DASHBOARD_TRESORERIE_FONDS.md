# Tableau de bord trésorerie et position des fonds

Décision d'architecture du 18 septembre 2026.

## Finalité

Le trésorier, l'administrateur et le développeur voient une vue consolidée des fonds confirmés : total, chez les collecteurs, en transit, remis au trésorier, en caisse, en banque et dans les comptes virtuels. Les responsables autorisés disposent de la même vue en lecture seule selon leur niveau. Un collecteur ne voit que son propre portefeuille et ses propres transferts.

## Règles de mouvements

Une demande de remise ne déplace jamais de fonds. Le trésorier demande une remise à un collecteur identifié ; le collecteur reçoit une notification ciblée et initie lui-même le transfert en choisissant ses contributions et le moyen (espèces, MTN, Orange ou autre). Le trésorier confirme ensuite la réception, avec preuve et audit. La localisation est alors mise à jour atomiquement. L'administrateur et le développeur peuvent superviser ; toute action porte l'identité réelle de son auteur.

## Vue interactive

Les cartes de montant ouvrent la liste filtrée correspondante : collecteurs détenteurs, transferts en attente, caisse, banque ou comptes virtuels. Le tableau des collecteurs expose montant, nombre de contributions, moyen de collecte, dernière activité et action « demander une remise » seulement pour les rôles autorisés. Les actions ne sont jamais déduites du seul frontend : l'API renvoie les permissions effectives.

## Livraison prévue

1. Endpoint résumé/positions avec périmètre RBAC et liens de filtre.
2. Notification de demande de remise, sans changement d'état comptable.
3. Cartes et tableau trésorerie mobile-first, puis navigation contextualisée.
4. Tests d'accès, transitions de fonds et réception ; revue et commit/push après chaque lot.
