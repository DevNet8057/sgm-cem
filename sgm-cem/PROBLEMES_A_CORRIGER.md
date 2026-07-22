# Suivi des problèmes — UI Contributions/Paiements & Dashboard

Ce fichier liste les problèmes constatés, en cours ou à corriger. **Règle : un problème corrigé et vérifié est supprimé de ce fichier.** Ce qui reste ici = pas encore fait.

---

## ✅ Tout ce qui était listé a été corrigé et vérifié

### Bug reçu bloqué après paiement (tous modes)

**Cause réelle (deux niveaux)** :
1. Frontend (`PaymentStepper.tsx`) : `receiptUrl` n'était récupéré qu'une seule fois sans nouvelle tentative → corrigé par un polling de secours (1,5 s × 10, ~15 s max) + état d'échec actionnable (bouton « Voir le reçu » vers l'endpoint auto-régénérant + « Réessayer »).
2. Backend (`apps/api/src/services/receipt.ts`) : **cause racine réelle**, trouvée en reproduisant le bug directement (script isolé + navigation directe vers l'endpoint reçu, hors UI). `generateReceiptPdf` ne fermait jamais le navigateur Puppeteer si `page.setContent`/`page.pdf` échouait (`browser.close()` jamais atteint) → fuite de process Chrome headless. Sur le serveur de dev de longue durée de cette session (beaucoup de paiements testés), l'accumulation a fini par faire échouer TOUTE génération de reçu (`SERVER_ERROR` systématique). Corrigé avec un `try/finally` garantissant `browser.close()` dans tous les cas.

**Vérifié en direct dans le navigateur** : paiement Espèces via le stepper Guidé → reçu généré quasi instantanément, PDF ouvert et contrôlé visuellement (en-tête vert de marque, badge « PAIEMENT CONFIRMÉ », montants, mode, référence, signatures — rendu correct et complet). Comme tous les modes de paiement passent par la même fonction serveur, le correctif est universel (pas re-testé individuellement pour MTN MoMo/Orange Money/CinetPay, la cause et le correctif ne dépendent pas du mode).

### Refonte visuelle Contributions & Dashboard

- Couleurs : verts Tailwind par défaut (`green-*`, `#16A34A`) remplacés par le vert de marque (`#1A6B1A`) pour les actions/accents et par l'emerald sémantique (`#065F46`/`#A7F3D0`/`#ECFDF5`) pour les statuts « succès ».
- Bouton « traçabilité » bleu neutralisé en gris ; survol de ligne rendu visible (`hover:bg-[#E8F5E8]/60`).
- Carte « Grand contributeur » (Dashboard) : fond vert posé sur le body antd via `styles` (évite texte blanc sur blanc).
- Animations : `transition-all` (animait le layout → saccades) remplacé par `transition` partout dans Contributions ; double ombre au survol supprimée dans `ActivityCard.tsx`.
- Espacements : `p-3.5` → `p-4` (ActivityCard) ; marges verticales normalisées sur `mb-4` (Contributions).
- Cohérence des gris : les 46 occurrences de `gray-*` dans `Contributions.tsx` unifiées sur `slate-*` (aligné sur `Dashboard.tsx` et le token `--cem-text-muted`).

**Vérifié dans le navigateur** : Contributions et Dashboard s'affichent correctement après ce dernier changement, aucune régression visible.

---

## ⚠️ Non vérifié — limitation d'outil, à contrôler par l'utilisateur

**Responsive (mobile 375px / tablette 768px / desktop 1440px)** : l'outil de redimensionnement de fenêtre du navigateur automatisé n'a pas fonctionné dans cette session (la fenêtre reste bloquée à sa taille actuelle quelle que soit la taille demandée) — impossible de faire un vrai test visuel à ces tailles. Un audit de code (grep ciblé) montre un usage cohérent des classes Tailwind mobile-first (`grid-cols-1` par défaut avec surcharges `sm:`/`md:`/`xl:`, pattern `table-mobile-cards` + `overflow-x-auto` sur les tableaux, aucune largeur fixe en pixels trouvée) — donc probablement correct, mais **non confirmé visuellement**. À vérifier en ouvrant l'app sur un vrai mobile/tablette ou via les DevTools du navigateur.
