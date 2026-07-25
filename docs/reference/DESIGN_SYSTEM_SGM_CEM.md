# Design System SGM-CEM

Dernière mise à jour : 2026-07-23

Ce document est la référence vivante de l’interface authentifiée SGM-CEM. Il complète les
conventions frontend et ne modifie ni les contrats API, ni le RBAC serveur, ni les flux métier.

## 1. Direction visuelle

L’interface vise un produit financier sobre et haut de gamme : forte lisibilité, densité
maîtrisée, interactions rapides et signalétique sémantique explicite. Les références sont
Stripe Dashboard, Mercury, Linear, Vercel, Apple et Revolut Business. Les effets néon et le
glassmorphism décoratif sont exclus.

L’espace authentifié utilise le thème sombre canonique. Les pages publiques de paiement et
d’authentification conservent leur propre contexte visuel afin de ne pas hériter de styles
RBAC ou de styles de portail Ant Design.

## 2. Socle technique

- Ant Design 5 reste la bibliothèque de composants.
- `DashboardThemeProvider` applique `dashboardTheme` une seule fois dans
  `apps/web/src/app/(app)/layout.tsx`.
- `apps/web/src/lib/antd-theme.ts` contient les tokens Ant Design.
- `apps/web/src/app/globals.css` contient les variables CSS, les adaptations des écrans
  historiques et les micro-interactions.
- `apps/web/tailwind.config.ts` expose les mêmes valeurs sous les clés `dash-*`.
- `apps/web/src/config/navigation.ts` est l’unique source de vérité de la navigation,
  des titres, des icônes Lucide et de la visibilité par rôle.
- Un composant Ant Design ne doit pas être remplacé par un équivalent HTML maison.
  Les wrappers partagés doivent conserver leur API publique quand ils migrent vers Ant Design.

## 3. Tokens canoniques

| Usage | Valeur |
|---|---|
| Fond principal | `#07120D` |
| Sidebar | `#081A12` |
| Carte | `#0E1C16` |
| Carte au survol | `#13261E` |
| Primaire | `#2ECC71` |
| Succès | `#22C55E` |
| Avertissement | `#FACC15` |
| Danger | `#EF4444` |
| Texte | `#FFFFFF` |
| Texte secondaire | `#94A3B8` |
| Bordure | `rgba(255,255,255,.06)` |
| Ombre | `0 8px 30px rgba(0,0,0,.25)` |
| Ombre au survol | `0 20px 40px rgba(0,0,0,.35)` |
| Transition | `250ms` |

Rayons : cartes `20px`, boutons/champs/selects `14px`, tables `18px`, badges et
progressions `999px`.

## 4. Typographie et espacements

La police unique du produit est Inter. JetBrains Mono est réservée aux identifiants techniques.
Poppins et Montserrat ne doivent pas être introduites.

| Élément | Taille de référence |
|---|---|
| Titre du dashboard | `48px` desktop, réduction fluide mobile |
| Montant principal | `36px` |
| Titre de carte | `20px` |
| Corps | `15px` |
| Label | `13px` |

La grille desktop utilise un padding global de `32px`, des gouttières de `24px`, un espace
de `32px` entre sections et `24px` à l’intérieur des cartes. Sur mobile, le padding descend
à `16px` sans réduire les cibles tactiles sous `44px`.

## 5. Composants

### Navigation

La sidebar repose sur `Layout.Sider`, `Drawer` et `Menu` Ant Design. L’item actif possède un
fond vert translucide, un texte blanc, une icône vert clair et une barre jaune à gauche.
Le menu mobile affiche au plus cinq destinations réellement autorisées pour le rôle courant.

### Header

Le header est flottant. Il contient le titre de la vue, une recherche limitée aux destinations
autorisées, l’état du thème sombre, les notifications réelles et le menu du profil. Tous les
déclencheurs utilisent `Button`, `Dropdown`, `Badge`, `Input` et `Tooltip` Ant Design.

### Cartes et statistiques

Les surfaces principales utilisent `Card`. Les valeurs financières sont animées avec
`react-countup`. Les cartes KPI réunissent icône ronde, label, valeur, contexte et mini-courbe.
Le survol est réservé aux périphériques qui le supportent.

### Tableaux et listes

Les tables Ant Design et les tableaux historiques partagent un fond sombre, un en-tête sans
bordure lourde, des lignes espacées et un survol discret. Sous `768px`, les tables marquées
`table-mobile-cards` deviennent des cartes lisibles sans défilement horizontal imposé.
Les transactions récentes utilisent le wrapper `ActivityCard` fondé sur `Card`.

### Formulaires, modales et statuts

Les champs utilisent `Input`, `Input.Password`, `Select` et `DatePicker` Ant Design avec une
hauteur de `46px`. Le focus est vert et visible. Les modales utilisent `Modal` Ant Design avec
masque sombre, focus piégé et fermeture Échap. Les statuts utilisent `Tag` avec une icône
Lucide et une couleur sémantique ; la couleur n’est jamais le seul signal.

### Graphiques et progression

Les courbes Recharts utilisent un trait vert, un gradient discret et un tooltip sombre.
Le donut possède un anneau épais et affiche le total en son centre. `Progress` Ant Design
utilise une piste de `10px`, un rayon complet et un remplissage animé.

## 6. Mouvement et accessibilité

- Cartes : élévation de `-2px` au survol, durée `250ms`.
- Boutons : échelle maximale `1.02`, retour tactile visible.
- Icônes : rotation discrète au survol.
- Graphiques, compteurs et progressions : animation courte, jamais bloquante.
- `prefers-reduced-motion: reduce` désactive les mouvements et transitions décoratives.
- Tous les contrôles ont un libellé accessible et un focus visible.
- La structure et les textes restent utilisables à `320px` de large.

## 7. Recette visuelle obligatoire

Tester au minimum les largeurs `320`, `360`, `390`, `768`, `1280` et `1440px`, avec les rôles
MEMBRE, COLLECTEUR, RESPONSABLE, TRESORIER, ADMIN et DEVELOPER. Vérifier :

1. aucune destination interdite ou morte dans la sidebar, le header et la navigation mobile ;
2. aucune surface claire résiduelle dans l’espace authentifié ;
3. aucun composant Ant Design reconnaissable par son style par défaut ;
4. aucun débordement horizontal ou contrôle sous `44px` sur mobile ;
5. contraste, focus clavier, fermeture des modales et réduction des animations ;
6. chargement, vide, erreur et données longues sur chaque vue critique.

Les résultats de recette sont consignés dans `TEST_PLAN.md`.
