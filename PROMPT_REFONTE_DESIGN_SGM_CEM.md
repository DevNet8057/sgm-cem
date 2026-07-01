# PROMPT MAÎTRE — AUDIT + REFONTE DESIGN + FONCTIONNALITÉS AVANCÉES
## SGM-CEM · Culte d'Enfants de Melen · EEC Yaoundé
## Version 6.0 — Document de Pilotage avec Audit de Conformité Préalable

---

## À LIRE EN PREMIER — COMMENT UTILISER CE DOCUMENT

Ce projet a déjà connu plusieurs sessions de travail. Avant cette mission, une session précédente a produit des documents de sécurité (`FIX_SUMMARY.md`, `NEXT_STEPS.md`, `SECURITY_HARDENING_REPORT.md`, `TEST_PLAN.md`) et un guide utilisateur (`GUIDE_SGM_CEM.md`). **Ces documents existent dans le projet et contiennent des engagements pris, des tâches cochées comme faites, et des tâches explicitement laissées en suspens.**

Avant toute nouvelle ligne de code, tu dois donc faire un travail d'auditeur : vérifier ce qui a été réellement implémenté dans le code par rapport à ce que ces documents affirment, puis seulement après, dérouler la mission de refonte design et fonctionnalités décrite dans les parties A à H.

**Ce document remplace toute version précédente du prompt de refonte. Ne pas s'appuyer sur une version antérieure si elle existe dans l'historique du projet.**

---

## ÉTAPE 0 — AUDIT DE CONFORMITÉ DES DOCUMENTS EXISTANTS (OBLIGATOIRE, EN PREMIER)

### 0.1 Documents à auditer

Le projet contient ces fichiers de suivi antérieurs. Lis-les intégralement :
- `FIX_SUMMARY.md` — résumé de corrections de sécurité/UX déjà appliquées
- `NEXT_STEPS.md` — plan d'action en 4 phases avec un planning sur 3 semaines
- `SECURITY_HARDENING_REPORT.md` — rapport de sécurité avec checklist détaillée
- `TEST_PLAN.md` — plan de test avec 12 scénarios numérotés (1.1 à 5.3)
- `GUIDE_SGM_CEM.md` — guide utilisateur final, contient en section 9 une table "GAPS IDENTIFIÉS" de 10 fonctionnalités non implémentées

### 0.2 Méthode d'audit — pour chaque affirmation, vérifier dans le code réel

Pour chaque item marqué ✅ ou "Implémenté"/"Complété" dans ces documents, **ouvre le fichier de code concerné et vérifie que l'implémentation existe réellement et fonctionne**, plutôt que de faire confiance à la déclaration du document. Concrètement :

| Document source | Affirmation à vérifier | Fichier(s) à inspecter |
|---|---|---|
| FIX_SUMMARY.md | `PasswordInput.tsx` créé et utilisé à 4 emplacements | `apps/web/src/components/ui/PasswordInput.tsx` + ses imports dans `ChangePassword.tsx`, `MonProfil.tsx`, `GestionUtilisateurs.tsx` (2 endroits) |
| FIX_SUMMARY.md | Validation Zod frontend et backend créée | `apps/web/src/lib/validation.ts`, `apps/api/src/middleware/validation.ts` |
| FIX_SUMMARY.md | Helmet renforcé (CSP, HSTS, X-Frame-Options) | `apps/api/src/index.ts` |
| FIX_SUMMARY.md | Rate limiting par endpoint (login 5/15min, change-password 3/1h, API 100/15min) | Middleware de rate limiting dans `apps/api/src/index.ts` ou fichier dédié |
| FIX_SUMMARY.md | TypeScript compile sans erreur | Lancer `tsc --noEmit` toi-même et constater le résultat réel, pas supposer |
| SECURITY_HARDENING_REPORT.md | JWT validation avec distinction expiré/invalide | Middleware d'authentification API |
| SECURITY_HARDENING_REPORT.md | RBAC avec niveaux de permission | Vérifier contre `CLAUDE.md` section RBAC, tester un appel API avec un rôle insuffisant |
| GUIDE_SGM_CEM.md §4.2 | Webhook MTN MoMo confirme automatiquement le paiement | Présence réelle d'un endpoint webhook MTN dans le code, pas seulement documenté |
| GUIDE_SGM_CEM.md §7 | Notifications WhatsApp + SMS fallback fonctionnelles | Vérifier l'intégration réelle (360Dialog, Twilio) ou son absence |

### 0.3 Points CRITIQUES explicitement non résolus — à traiter en priorité absolue

Ces deux failles de sécurité sont documentées comme non résolues dans `NEXT_STEPS.md` et `SECURITY_HARDENING_REPORT.md`. **Elles doivent être corrigées avant toute autre tâche de cette mission**, car elles concernent une application qui manipule de l'argent réel :

1. **Tokens JWT stockés en `localStorage`** (`apps/web/src/store/authStore.ts`) — vulnérabilité XSS critique. Migrer vers des cookies `HttpOnly`, `Secure` (en production), `SameSite=Strict`, positionnés par le serveur à la connexion. Le store frontend ne doit plus jamais lire ni écrire de token, seulement l'état utilisateur (nom, rôle, etc.) reçu après authentification. Vérifier que toutes les requêtes API envoient bien `credentials: 'include'` pour que le cookie soit transmis automatiquement.

2. **Absence de protection CSRF** — ajouter une protection sur toutes les routes `POST`/`PUT`/`PATCH`/`DELETE`. Utiliser soit le pattern double-submit cookie, soit une librairie maintenue équivalente à `csurf` (`csurf` est aujourd'hui déprécié et non maintenu — chercher l'alternative recommandée actuelle avant de l'installer, par exemple vérifier si `csrf-csrf` ou une solution native Next.js/Express plus récente est préférable au moment de l'implémentation).

3. **Build EPERM bloquant sous Windows** (documenté dans `NEXT_STEPS.md` et `TEST_PLAN.md`) — si tu travailles dans un environnement où ce problème peut se reproduire, vérifier la configuration `next.config.ts` pour un `distDir` alternatif, et s'assurer que `.next/` est dans `.gitignore`. Si l'environnement de travail actuel ne reproduit pas ce problème, le noter quand même comme point de vigilance pour le déploiement final de l'utilisateur.

### 0.4 Restitution de l'audit — format obligatoire

Une fois l'audit terminé, produis un tableau dans `PROGRESS_SGM_CEM.md` (voir Étape 1 pour sa structure complète) avec, pour CHAQUE item des documents listés en 0.1 :

```markdown
## AUDIT DE CONFORMITÉ — ÉTAT RÉEL VS DOCUMENTÉ
| Source | Affirmation documentée | État réel constaté | Action requise |
|---|---|---|---|
| FIX_SUMMARY.md | PasswordInput utilisé à 4 emplacements | [✅ confirmé / ⚠️ partiel / ❌ absent] | [aucune / corriger X / créer X] |
```

Toute affirmation non confirmée devient automatiquement une tâche dans la todo-list de l'Étape 1, avec la mention explicite "régression détectée — documenté comme fait mais absent du code" pour ne pas la confondre avec une tâche jamais entamée.

---

## ÉTAPE 1 — CRÉER/METTRE À JOUR LE FICHIER DE SUIVI

Crée (ou mets à jour s'il existe déjà) un fichier `PROGRESS_SGM_CEM.md` à la racine du projet avec cette structure exacte. Si une version antérieure de ce fichier existe déjà avec des cases cochées, **vérifie chaque case cochée contre le code réel avant de lui faire confiance**, exactement selon la méthode de l'Étape 0.

```markdown
# SUIVI D'AVANCEMENT — SGM-CEM v6.0
Dernière mise à jour : [DATE]
Avancement global : [X]%

## Légende
✅ Terminé et vérifié dans le code · 🔄 En cours · 🔶 Bloqué · ⬜ Non commencé · ⚠️ RÉGRESSION (documenté comme fait, absent en réalité)

## AUDIT DE CONFORMITÉ — ÉTAT RÉEL VS DOCUMENTÉ
(tableau de l'Étape 0.4)

## 0. SÉCURITÉ CRITIQUE (priorité absolue, issue de l'audit)
- [ ] 0.1. Migration tokens JWT vers cookies HttpOnly/Secure/SameSite
- [ ] 0.2. Protection CSRF sur toutes les routes mutatives
- [ ] 0.3. Vérification build complet sans erreur EPERM ou équivalent
- [ ] 0.4. Champs password restants non encore migrés vers PasswordInput (si trouvés à l'audit)
- [ ] 0.5. npm audit exécuté, vulnérabilités critiques/hautes traitées

## A. REFONTE DESIGN SYSTEM
- [ ] A1. Palette de couleurs étendue (au-delà de vert/jaune)
- [ ] A2. Typographie — hiérarchie et cohérence
- [ ] A3. Système d'icônes cohérent et différencié
- [ ] A4. Animations et micro-interactions globales
- [ ] A5. Responsive mobile/tablette complet
- [ ] A6. Emplacement logo + favicon (en attente de fichier logo)
- [ ] A7. Nettoyage des artefacts visuels (données de test, overlays de dev)

## B. FLOW FINANCIER COMPLET
- [ ] B1. Collecteur encaisse en présentiel + notification au contributeur
- [ ] B2. Contributeur déclare une remise + notification au collecteur
- [ ] B3. Collecteur valide la réception d'une déclaration
- [ ] B4. Transfert collecteur → trésorier ou collecteur → collecteur
- [ ] B5. Traçabilité complète du trajet de l'argent (qui détient quoi, où)
- [ ] B6. Trésorier marque les fonds comme déposés en banque
- [ ] B7. Génération de reçu à CHAQUE transaction + partage/téléchargement (vérifier service receipt.ts mentionné dans GUIDE_SGM_CEM.md comme "créé, à brancher")

## C. PROFILS ET NOTIFICATIONS
- [ ] C1. Upload de photo de profil membre (vérifier état réel — GUIDE_SGM_CEM.md mentionne déjà une UI "glisser-déposer, max 5 Mo")
- [ ] C2. Affichage de la photo partout (sidebar, listes, profils)
- [ ] C3. Notifications in-app type Telegram (toast + son configurable)
- [ ] C4. Permission navigateur + sélection du son de notification (vérifier — VAPID mentionné comme "configuré mais pas branché" dans GUIDE_SGM_CEM.md)

## D. FILTRES AVANCÉS — QUERY BUILDER
- [ ] D1. Query builder sur Contributions (année, type, personne, montant...)
- [ ] D2. Extension du query builder aux autres tableaux (Membres, Rubriques)

## E. RÈGLES FINANCIÈRES PARAMÉTRABLES
- [ ] E1. Configuration de répartition par pourcentage et sous-profil
- [ ] E2. Gestion des cas de chevauchement de profils (couple = travailleur+travailleur)

## F. MODE HORS LIGNE (PWA)
- [ ] F1. Configuration du Service Worker + manifest PWA
- [ ] F2. Stockage local IndexedDB des actions hors ligne
- [ ] F3. Synchronisation automatique au retour de connexion

## G. INTÉGRATIONS API EXTERNES
- [ ] G1. MTN Mobile Money (vérifier — webhook mentionné dans le guide, à confirmer dans le code)
- [ ] G2. Orange Money
- [ ] G3. WhatsApp Business (vérifier 360Dialog — DIALOG360_API_KEY listé dans .env mais intégration à confirmer)
- [ ] G4. SMS Twilio (variables d'env déjà listées dans GUIDE_SGM_CEM.md — vérifier le code d'envoi réel)
- [ ] G5. Stockage fichiers (S3 ou équivalent) pour photos et documents

## H. DETTE TECHNIQUE ISSUE DU GUIDE UTILISATEUR (section 9 "GAPS IDENTIFIÉS")
- [ ] H1. Mode offline collecteur (IndexedDB) — doublon avec F, à fusionner
- [ ] H2. Upload S3 réel pour GED — actuellement formulaire de métadonnées seul
- [ ] H3. Reçu PDF envoyé automatiquement — service receipt.ts existant à brancher
- [ ] H4. Relevé mensuel automatique (cron) — service prêt, planification manquante
- [ ] H5. Tests automatisés API — aucun test présent actuellement
- [ ] H6. CI/CD GitHub Actions — pipeline à créer
- [ ] H7. Preuve de paiement par photo — upload + association à un litige
- [ ] H8. Portefeuille temps réel WebSocket — marqué FUTURE, basse priorité

## JOURNAL DE BORD
| Date | Tâche | Statut | Détail |
|------|-------|--------|--------|

## BILAN DE SESSION (mis à jour à chaque session)
(à compléter)
```

Calcule le pourcentage global ainsi : `(nombre de cases ✅) / (nombre total de cases) × 100`, arrondi à l'entier. Une case marquée `⚠️ RÉGRESSION` compte comme NON faite dans ce calcul, même si un document antérieur la présentait comme faite.

---

## RÈGLE DE FONCTIONNEMENT CONTINU — VÉRIFICATION APRÈS CHAQUE CHANGEMENT

Ceci est la règle la plus importante de ce document et s'applique à toutes les parties A à H, sans exception :

**Après CHAQUE modification de code, même petite, avant de passer à la tâche suivante :**

1. Relis le code que tu viens de produire ou modifier.
2. Vérifie qu'il correspond exactement à la spécification décrite dans la partie concernée.
3. Si le projet a un compilateur TypeScript ou un linter configuré, exécute-le sur les fichiers modifiés.
4. Vérifie que la modification n'a pas cassé une fonctionnalité adjacente déjà fonctionnelle (par exemple : si tu modifies le composant de carte de rubrique pour le design, vérifie que le bouton "Modifier" fonctionne toujours).
5. Mets à jour `PROGRESS_SGM_CEM.md` : cocher la tâche seulement si les points 1 à 4 sont passés, sinon la laisser en `🔄 En cours` avec une note précise de ce qui manque.
6. Seulement après ces 5 points, continue vers la tâche suivante.

**Ne jamais accumuler plusieurs tâches non vérifiées avant de mettre à jour le fichier de suivi.** C'est exactement le type de pratique qui a produit la situation actuelle où des documents affirment des choses non vérifiées dans le code (voir Étape 0).

Si tes tokens s'épuisent en plein milieu d'une tâche, mets IMMÉDIATEMENT à jour `PROGRESS_SGM_CEM.md` avec l'état exact d'avancement de cette tâche précise (quels fichiers ont été modifiés, lesquels restent, la prochaine micro-étape exacte) avant de t'arrêter.

---

## CONTEXTE DU PROJET

Application : SGM-CEM, PWA de gestion financière pour le Culte d'Enfants de Melen (EEC, Yaoundé, Cameroun). Stack : Next.js 15, TypeScript, Tailwind CSS, Prisma/PostgreSQL, Express.js API. Référence architecturale complète dans `CLAUDE.md` — **le lire avant de commencer**, il contient le design system actuel, les modèles de données, les règles métier RB-01 à RB-29.

L'application gère : membres, rubriques de contribution, collecteurs, transferts de fonds, validations, litiges, statistiques, GED, prestations, utilisateurs et rôles.

Identifiants par défaut (issus de `GUIDE_SGM_CEM.md`, à ne jamais committer en dur dans le code, uniquement dans la documentation de setup) : compte admin `admin@cem-melen.cm`, mot de passe initial à changer immédiatement après premier accès.

---

## PARTIE A — REFONTE COMPLÈTE DU DESIGN

### Constat actuel (analysé sur captures d'écran réelles de l'application)

L'interface actuelle repose presque exclusivement sur deux couleurs (vert EEC `#1A6B1A`/`#0F4A0F` et jaune `#F5C400`), ce qui produit les problèmes suivants observés concrètement :
- Les badges de statut (Confirmé/En attente/Litige) sont les seuls éléments différenciés par couleur sur des pages entières — l'œil ne sait pas où regarder.
- Le rouge "URGENT" et les icônes colorées dans les KPI cards (bleu, violet) apparaissent de façon isolée, sans système cohérent derrière.
- Le titre en police serif (Cormorant Garamond) est appliqué de façon incohérente : parfois sur un état vide neutre, parfois sur un vrai titre de page — ça brouille la hiérarchie.
- Aucune animation n'existe : pas de transition au clic, pas de hover perceptible, pas de skeleton loader pendant un chargement, pas de feedback visuel après une action. Pour une app qui manipule de l'argent en temps réel, c'est un manque grave.
- Beaucoup d'espace vide non exploité sur les pages avec peu de contenu (Statistiques, Tableau de bord).
- Des artefacts de développement visibles dans l'interface (aperçu de fichier flottant) et des données de test non nettoyées (nom de membre incohérent) — à purger avant toute démo ou mise en production.
- Aucune preuve de responsive réel ; la sidebar fixe et les tableaux denses risquent de casser sur mobile sans travail dédié.

### A1. Palette de couleurs — Étendre au-delà de vert/jaune

Garde le vert EEC (`#0F4A0F`/`#1A6B1A`) et le jaune (`#F5C400`) comme couleurs d'identité de marque (sidebar, boutons primaires, logo), mais construis un véritable système de couleurs sémantiques pour tout le reste :

```
SUCCÈS / CONFIRMÉ     : vert émeraude #10B981 (fond clair #ECFDF5)
ATTENTE / EN COURS    : ambre #F59E0B (fond clair #FFFBEB)
ERREUR / LITIGE       : rouge #EF4444 (fond clair #FEF2F2)
INFO / NEUTRE         : bleu ardoise #3B82F6 (fond clair #EFF6FF)
URGENCE CRITIQUE      : rouge profond #DC2626 avec animation pulse — réservé aux vraies urgences
ESPÈCES               : vert EEC (cohérent avec la marque)
MTN MOMO              : jaune MTN officiel #FFCC00
ORANGE MONEY          : orange officiel #FF6600
CARTE / VIREMENT      : bleu #3B82F6
NEUTRE / GRIS         : échelle de gris #F8FAFC → #1E293B
```

Règle d'application : chaque couleur sémantique doit être utilisée de façon SYSTÉMATIQUE et PRÉVISIBLE. Documente cette table dans `CLAUDE.md` une fois faite.

### A2. Typographie — Hiérarchie cohérente

- Cormorant Garamond : UNIQUEMENT titres de page (H1) et montants hero. Jamais sur un état vide, un label, un sous-titre.
- Plus Jakarta Sans : tout le reste.
- Échelle stricte à documenter : H1 (32px/Cormorant/bold), H2 (24px/Jakarta/semibold), H3 (18px/Jakarta/semibold), body (14px/Jakarta/regular), caption (12px/Jakarta/medium), montant hero (40px/Cormorant/bold).
- Vérifie chaque page existante et corrige les incohérences.

### A3. Système d'icônes cohérent

- Une seule librairie d'icônes dans toute l'app (vérifier laquelle est en place, probablement Lucide React).
- Couleur d'icône cohérente par domaine fonctionnel : Finances en vert, Membres en bleu, Gestion (GED/Prestations/Litiges) en violet, Outils en ambre, Système en gris foncé.
- Les icônes des KPI cards doivent correspondre à la couleur sémantique de la donnée représentée, pas une couleur arbitraire.
- Taille cohérente : 16px sidebar/boutons, 20px en-têtes de carte, 24px KPI cards.

### A4. Animations et micro-interactions — Obligatoire, actuellement absent

- Transitions de page (fade-in + slide-up léger, 200ms) à chaque changement de vue.
- Hover perceptible sur tout élément cliquable, en moins de 150ms.
- Skeleton loaders pendant tout chargement de données, jamais d'écran blanc figé.
- Feedback de clic immédiat (spinner inline pendant l'appel API) puis toast de confirmation/erreur.
- Toasts in-app style Telegram (voir Partie C).
- Animation de compteur sur les montants FCFA du dashboard (comptage 0 → valeur finale, 300-600ms).
- Modales/drawers en scale+fade, jamais de `display:block` brutal.
- Transitions animées sur les graphiques Recharts au chargement et au changement de filtre.

Vérifier dans `package.json` si Framer Motion est déjà présent avant de choisir entre lui et les transitions Tailwind natives.

### A5. Responsive — Audit et correction complets

- Sidebar en menu hamburger/drawer sous 768px.
- Tableaux denses → vue carte empilée sur mobile.
- KPI cards : 4 colonnes desktop → 2 tablette → 1 mobile.
- Vérifier chaque page sur 375px, 768px, 1280px+.
- Boutons d'action multiples sur mobile : empilement vertical ou menu kebab "...".

### A6. Logo et favicon — Instructions précises

**Le logo n'est pas encore fourni.** Quand l'utilisateur le fournira :

1. **Sidebar** : remplacer le badge texte "CEM" dans le composant de layout principal, fallback texte conservé si l'image ne charge pas.
2. **Page de connexion** : logo au-dessus du titre "Connexion", centré, ~64-80px de hauteur.
3. **Favicon** : `favicon.ico` (multi-résolution 16/32/48), `apple-touch-icon.png` (180x180), `icon-192.png`/`icon-512.png` pour le manifest PWA.
4. **Manifest PWA** : mettre à jour `icons`, `name`, `short_name`, `theme_color` (`#0F4A0F`), `background_color`.
5. Documenter dans `CLAUDE.md` le chemin exact de chaque fichier une fois posé.

Si SVG fourni : privilégier SVG pour la sidebar, générer les PNG seulement pour favicon/manifest.

### A7. Nettoyage

- Supprimer toute donnée de test visible (noms incohérents en seed ou en dur).
- Vérifier l'absence d'overlay de développement en mode production.
- Repasser sur chaque état vide : icône cohérente avec A3, texte en Jakarta (pas Cormorant), CTA contextuel si pertinent.

---

## PARTIE B — FLOW FINANCIER COMPLET (Collecteur / Contributeur / Trésorier / Banque)

**Avant d'implémenter, vérifier l'état réel contre `GUIDE_SGM_CEM.md` section 4** qui décrit déjà un flux proche (notification WhatsApp + in-app au collecteur, confirmation dans Validations, transfert vers caisse/banque). Ne pas dupliquer ce qui existe déjà — l'étendre et le corriger là où il manque des étapes.

### B1. Le collecteur encaisse en présentiel

Le collecteur enregistre directement le paiement (montant, rubrique, contributeur). Statut CONFIRMÉ immédiat. Le contributeur reçoit une notification ("Votre contribution de [montant] pour [rubrique] a été enregistrée par [collecteur]"). Un reçu est généré (voir B7).

### B2. Le contributeur déclare une remise en présentiel

Le contributeur déclare avoir remis de l'argent à un collecteur. Statut EN_ATTENTE_CONFIRMATION. Le collecteur désigné est notifié.

### B3. Le collecteur valide la réception

Le collecteur voit la déclaration dans sa file de validations personnelles. Deux actions : Confirmer (CONFIRMÉ, reçu généré, contributeur notifié) ou Contester (LITIGE avec motif obligatoire, trésorier notifié — réutiliser le mécanisme de litige déjà existant).

### B4. Transfert de fonds entre acteurs

Le collecteur transfère vers le trésorier OU un autre collecteur. Initié par le détenteur actuel des fonds. Crée un transfert en attente visible par le destinataire. Le destinataire doit confirmer pour finaliser ; tant que non confirmé, l'argent reste tracé "en transit", toujours rattaché à l'expéditeur dans les rapports.

### B5. Traçabilité complète du trajet de l'argent

Vue de traçabilité (dans "Fonds Collecteurs") montrant pour chaque montant son trajet complet en timeline :
```
[Contributeur] → encaissé par [Collecteur A] (date/heure)
              → transféré à [Collecteur B] (date/heure, statut)
              → remis au [Trésorier] (date/heure, statut)
              → déposé en banque (date/heure) — voir B6
```
Chaque contribution cliquable pour afficher sa timeline. Filtre "Où se trouve l'argent actuellement" : Chez le collecteur / En transit / Chez le trésorier / En banque.

### B6. Le trésorier marque les fonds comme déposés en banque

Action dédiée pour sélectionner des contributions en sa possession, les marquer "Déposées en banque" avec date et référence de bordereau. Statut de localisation passe à "En banque", visible dans toute la chaîne (B5). Montant total en banque visible sur le dashboard trésorier.

### B7. Génération de reçu à chaque transaction, avec partage et téléchargement

**S'applique à TOUTE transaction sans exception.** `GUIDE_SGM_CEM.md` section 9 mentionne qu'un "service receipt.ts créé, à brancher" existe déjà — **vérifier ce fichier avant d'en créer un nouveau**, le compléter/brancher plutôt que dupliquer.

Chaque reçu doit contenir : nom de l'organisation, logo (une fois fourni), numéro de reçu unique, date/heure, expéditeur/destinataire, montant, rubrique, mode de paiement, statut. Actions après génération : **Télécharger** et **Partager** (`navigator.share()` avec fallback `wa.me/?text=...`). Stocker chaque reçu pour consultation ultérieure depuis l'historique.

---

## PARTIE C — PROFILS MEMBRES ET NOTIFICATIONS STYLE TELEGRAM

**Avant d'implémenter C1/C2** : `GUIDE_SGM_CEM.md` section 6 mentionne déjà "Photo de profil : glisser-déposer ou cliquer pour télécharger (max 5 Mo)" comme fonctionnalité existante. Vérifier l'état réel de cette UI dans le code (probablement `MonProfil.tsx`, déjà modifié dans la session sécurité précédente). Ne pas recréer si fonctionnel ; corriger/connecter au stockage réel si c'est juste un formulaire sans backend (cas fréquent observé dans ce projet, voir GED en G5).

### C1 et C2. Photo de profil

- Vérifier le champ photo dans le modèle Membre/Utilisateur (schéma Prisma, voir `CLAUDE.md`).
- Stockage via service S3 (voir G5) plutôt qu'en base64.
- Affichage partout où l'avatar initiales est actuellement utilisé (sidebar, listes, profils) — fallback initiales conservé si pas de photo.

### C3 et C4. Notifications in-app type Telegram, avec son configurable

`GUIDE_SGM_CEM.md` section 9 indique "VAPID configuré mais pas branché" — vérifier les clés VAPID existantes avant de tout reconfigurer.

1. **Permission** : `Notification.requestPermission()` au premier lancement ou via bouton Paramètres. Si refusée, ne jamais re-demander automatiquement.
2. **Toast visuel** : composant flottant avec icône contextuelle, titre, corps, durée d'affichage avant disparition, clic pour aller à l'élément concerné.
3. **Son configurable** : section "Notifications" dans Paramètres/Profil, sélecteur parmi 3-5 sons courts (`public/sounds/`, fichiers libres de droits), bouton "Tester le son", préférence stockée (localStorage ou en base liée à l'utilisateur).
4. **Déclenchement** : à chaque événement reçu, jouer le son via `new Audio(chemin).play()` et afficher le toast.
5. Distinguer le mécanisme de permission navigateur (Notification API) du son personnalisé qui peut jouer indépendamment de cette permission, en restant dans l'onglet actif.

---

## PARTIE D — QUERY BUILDER / FILTRES AVANCÉS

### D1. Query builder sur Contributions (priorité)

Remplacer le dropdown simple "Tous les statuts" par un constructeur de filtres combinables : Année, Rubrique, Membre/Contributeur (autocomplete), Collecteur, Mode de paiement, Statut, Plage de montant, Plage de dates. Interface en "chips" ajoutables/supprimables, combinables en ET logique (OU en bonus si le temps permet). Résultat mis à jour dynamiquement via requête API filtrée. Bonus : "Sauvegarder ce filtre".

### D2. Extension aux autres tableaux

Une fois D1 stable, réutiliser le composant pour Membres et Rubriques avec leurs champs pertinents.

---

## PARTIE E — RÈGLES FINANCIÈRES PARAMÉTRABLES PAR POURCENTAGE

Exemple de référence : contribution ponctuelle de 50 000 FCFA où les étudiants donnent ensemble 10% du total, les travailleurs 40%, les couples le reste (50%), avec gestion du cas où un membre d'un couple est individuellement travailleur.

### E1. Interface de configuration de répartition par pourcentage

Dans la création/édition de rubrique, mode alternatif "Répartition par pourcentage" : montant cible global, champ pourcentage par profil financier, validation temps réel (somme = 100% exactement, alerte visuelle rouge/verte avec total calculé en direct). Calcul automatique du montant cible par catégorie puis par personne (montant catégorie ÷ nombre de membres actifs dans cette catégorie, calculé dynamiquement).

### E2. Gestion du chevauchement de profils

Vérifier dans le schéma Prisma actuel comment le profil financier est structuré. Si champ simple (Travailleur OU Étudiant OU Couple), proposer l'évolution : `statutProfessionnel` (Travailleur/Étudiant) ET `statutMarital` (Célibataire/Marié + référence conjoint, cohérent avec la colonne "Couple" déjà visible dans l'interface membres). La catégorie "Couple" de la répartition ne s'applique qu'aux foyers où les deux conjoints sont membres et liés. Un travailleur célibataire reste en "Travailleurs". Documenter cette règle explicitement dans le code et `CLAUDE.md`. Si ambiguïté sur un cas limite (ex: couple où un seul est membre du système), marquer `🔶 BLOQUÉ` avec la question précise plutôt que deviner.

---

## PARTIE F — MODE HORS LIGNE (PWA)

**Doublon à fusionner avec H1** (déjà identifié dans `GUIDE_SGM_CEM.md` comme priorité HAUTE, non implémenté). Une seule série de tâches doit exister au final dans `PROGRESS_SGM_CEM.md`, pas deux entrées séparées une fois ce travail commencé.

### F1. Service Worker et manifest PWA

Utiliser `next-pwa` ou l'approche native Next.js 15 (vérifier la meilleure pratique compatible avec la version exacte du projet). Configurer `manifest.json`/`app/manifest.ts` (nom, icônes voir A6, couleur de thème, mode `standalone`). Stratégie de cache : assets statiques en `CacheFirst`, données API critiques en `StaleWhileRevalidate`.

### F2. Stockage local des actions hors ligne

IndexedDB (librairie `idb` recommandée) pour la file d'attente d'actions hors ligne. Détection via `navigator.onLine` et événements `online`/`offline`. Indicateur visuel "Mode hors ligne actif" quand la connexion est perdue.

### F3. Synchronisation automatique

Dès l'événement `online`, envoyer automatiquement la file IndexedDB vers l'API dans l'ordre chronologique. Stratégie de conflit à définir (priorité serveur ou notification utilisateur). Vider l'entrée locale après succès, notifier l'utilisateur du nombre d'actions synchronisées.

---

## PARTIE G — INTÉGRATIONS API EXTERNES : PROCÉDURE COMPLÈTE

**Vérifier d'abord l'état réel** : `GUIDE_SGM_CEM.md` section 10 liste déjà toutes les variables d'environnement attendues (MTN, Orange, 360Dialog, Twilio, Google OAuth). Cela signifie qu'une session précédente a probablement préparé la structure sans forcément l'avoir connectée à du code fonctionnel. Pour chaque intégration ci-dessous, vérifier d'abord si le code d'appel existe et fonctionne, avant de considérer la tâche comme non commencée.

**Règle générale impérative**, pour chaque intégration :
1. Vérifier/compléter `.env.example` avec commentaire sur l'origine de chaque valeur.
2. Documenter dans `PROGRESS_SGM_CEM.md` la procédure exacte pour que l'utilisateur obtienne lui-même les clés.
3. Ne jamais committer de clé réelle. Toujours `process.env.NOM_VARIABLE`.
4. Si la clé n'est pas fournie, le code doit tourner en mode simulation/sandbox clairement signalé dans l'UI, jamais planter l'application.

### G1. MTN Mobile Money

Portail développeur MTN MoMo (momodeveloper.mtn.com), Subscription "Collections", `Primary Key` + `API User`/`API Key` générés via le portail. Variables : `MOMO_SUBSCRIPTION_KEY`, `MOMO_API_USER`, `MOMO_API_KEY`, `MOMO_TARGET_ENVIRONMENT`, `MOMO_BASE_URL`. Sandbox gratuit disponible avant validation production (délai à anticiper). **Vérifier si le webhook MTN mentionné dans `GUIDE_SGM_CEM.md` §4.2 existe réellement dans le code API.**

### G2. Orange Money

Intégration directe (partenariat Orange Cameroun) ou agrégateur tiers supportant MTN+Orange via une seule API (recommandé si l'intégration directe est trop lourde administrativement). Variables selon le choix : `ORANGE_CLIENT_ID`/`ORANGE_CLIENT_SECRET`/`ORANGE_MERCHANT_KEY` ou `AGGREGATOR_API_KEY`/`AGGREGATOR_SECRET`.

### G3. WhatsApp Business (notifications)

Compte WhatsApp Business via Meta Business Suite, API Cloud officielle Meta ou fournisseur tiers (Twilio, 360dialog — `DIALOG360_API_KEY` déjà présent dans `.env` documenté par `GUIDE_SGM_CEM.md`, vérifier si réellement utilisé dans le code d'envoi). Validation préalable des templates de message par Meta à anticiper (délai de quelques jours).

### G4. SMS (Twilio)

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` déjà documentés dans `GUIDE_SGM_CEM.md`. Vérifier le code d'envoi réel et son branchement au flow de fallback (WhatsApp échoue → SMS).

### G5. Stockage de fichiers (photos de profil, documents GED, reçus PDF)

Bucket S3-compatible (AWS S3, ou Cloudflare R2 recommandé pour le rapport coût/simplicité). Variables : `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`. **`GUIDE_SGM_CEM.md` confirme que la GED n'a actuellement qu'un "formulaire de métadonnées" sans upload S3 réel (H2)** — donc cette tâche est confirmée non commencée, contrairement à d'autres qui pourraient être partiellement faites. Si aucune clé fournie, stockage temporaire local (`public/uploads`) avec avertissement explicite que ce n'est pas viable en production.

---

## PARTIE H — DETTE TECHNIQUE COMPLÉMENTAIRE (issue de GUIDE_SGM_CEM.md §9)

Ces items recoupent partiellement les parties précédentes (notamment B7, F, G5) mais en ajoutent qui n'étaient pas dans le périmètre initial A-G. Les traiter une fois A-G stabilisées, sauf H5/H6 qui peuvent être menées en parallèle sans dépendance bloquante :

- **H4. Relevé mensuel automatique (cron)** : "service prêt, planification manquante" selon le guide — vérifier le service existant, ajouter la planification (node-cron ou équivalent déjà présent dans les dépendances).
- **H5. Tests automatisés API** : aucun test présent actuellement (confirmé par `TEST_PLAN.md` qui ne contient que des scénarios manuels non automatisés). Prioriser les tests sur les flux financiers critiques (B1-B7) et l'authentification (0.1/0.2).
- **H6. CI/CD GitHub Actions** : pipeline à créer — build + test + lint à chaque push, déploiement seulement après ces étapes vertes.
- **H7. Preuve de paiement par photo** : upload + association à un litige, dépend de G5 (stockage fichiers) pour être fait proprement.
- **H8. Portefeuille temps réel WebSocket** : marqué FUTURE par le guide précédent, basse priorité, ne pas commencer avant que tout le reste soit stable.

---

## MÉTHODOLOGIE DE TRAVAIL — GESTION DE TÂCHES ET QA

1. **Avant de coder une fonctionnalité complexe** (notamment Partie E), reformule ta compréhension de la règle métier en une phrase claire avant de continuer si quelque chose semble ambigu.
2. **Découpe chaque grande partie en sous-tâches vérifiables** — ne marque jamais une tâche ✅ sans avoir relu le code produit et vérifié sa conformité, conformément à la règle de vérification continue.
3. **Teste mentalement chaque flow critique** avant de le considérer terminé, en particulier le tour complet de la Partie B (collecteur → contributeur → trésorier → banque).
4. **Signale proactivement les risques**, notamment tout conflit avec les règles métier RB-01 à RB-29 de `CLAUDE.md`.
5. **Mets à jour `CLAUDE.md`** à chaque évolution significative du design system ou du modèle de données — il reste la référence technique pérenne, distincte de `PROGRESS_SGM_CEM.md` qui sert au suivi de tâches.
6. **Ne fais jamais confiance à un document de suivi antérieur sans vérification dans le code réel** — c'est la leçon de l'Étape 0 de ce document, à appliquer pour toute la suite du projet, y compris dans des sessions futures qui liraient ce prompt.

---

## ORDRE DE PRIORITÉ RECOMMANDÉ

1. **Étape 0** (audit de conformité) et **Partie 0** (sécurité critique : HttpOnly cookies, CSRF) — non négociable, à faire avant tout le reste, application financière.
2. Partie A (design system) — base visuelle pour tout le reste.
3. Partie B (flow financier) — cœur métier, en s'appuyant sur ce qui existe déjà selon `GUIDE_SGM_CEM.md`.
4. Partie C (profils + notifications) — forte valeur perçue, vérifier l'existant avant de recréer.
5. Partie D (query builder).
6. Partie F/H1 (mode hors ligne, fusionnées).
7. Partie E (règles financières par pourcentage) — la plus complexe métier, validation humaine des cas limites avant de coder.
8. Partie G (APIs externes) — au fur et à mesure des clés fournies, jamais bloquant pour le reste.
9. Partie H restante (H4 à H8) — dette technique, en parallèle si possible sans dépendance bloquante.

---

*Document de pilotage SGM-CEM v6.0 — Culte d'Enfants de Melen, EEC Yaoundé*
*Ce fichier remplace toute version antérieure du prompt de refonte et s'ajoute à CLAUDE.md (référence technique). Mettre à jour PROGRESS_SGM_CEM.md à chaque session, sans exception, et ne jamais cocher une tâche sans vérification réelle dans le code.*
