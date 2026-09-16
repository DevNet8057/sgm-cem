# Guide de Test Complet - SGM-CEM

## 🧪 Plan de Test Fonctionnel

### Module 1: Authentification & Mots de Passe

#### Test 1.1: Login avec PasswordInput
```
Étapes:
1. Naviguer vers page login
2. Entrer email valide
3. Entrer mot de passe
4. Vérifier qu'il est masqué par défaut
5. Cliquer Eye icon
6. Vérifier que le mot de passe s'affiche
7. Cliquer Eye icon à nouveau
8. Vérifier que c'est remaskué

Résultat attendu: Password toggle fonctionne, UI cohérente
```

#### Test 1.2: Première Connexion (ChangePassword)
```
Étapes:
1. Login avec utilisateur mustChangePassword=true
2. Vérifier redirection vers ChangePassword
3. Entrer mot de passe temporaire reçu
4. Entrer nouveau mot de passe (ex: "Test123@Pass")
5. Vérifier indicateur de force en temps réel
6. Confirmer le mot de passe
7. Cliquer "Définir mon mot de passe"
8. Vérifier succès et redirection

Résultat attendu: 
- Indicateur montre "Fort" pour Test123@Pass
- Les trois premières règles check ✓
- Redirect vers tableau de bord
```

#### Test 1.3: Validation de Force
```
Étapes pour chaque mot de passe:
1. "test" → Faible (< 8 chars)
2. "test1234" → Faible (pas majuscule)
3. "Test1234" → Moyen (3/4 règles)
4. "Test123@" → Fort (4/4 règles, avec special char)

Résultat attendu: Indicateur correct à chaque étape
```

#### Test 1.4: Confirmation Mismatch
```
Étapes:
1. Nouveau: "Test123@"
2. Confirmation: "Test124@"
3. Vérifier message rouge "Les mots de passe ne correspondent pas"
4. Corriger confirmation
5. Vérifier message vert "Les mots de passe correspondent"

Résultat attendu: Validation en temps réel
```

### Module 2: Profil Utilisateur

#### Test 2.1: MonProfil - Change Password
```
Étapes:
1. Naviguer vers "Mon Profil"
2. Scroll vers section "Mot de passe"
3. Entrer mot de passe actuel
4. Vérifier Eye toggle (masqué par défaut)
5. Entrer nouveau mot de passe
6. Vérifier indicateur de force
7. Confirmer et cliquer "Sauvegarder"
8. Vérifier succès message

Résultat attendu: 
- PasswordInput avec Eye icon visible
- Indicateur de force affiche les 3 règles
- Succès après envoi
```

### Module 3: Gestion des Utilisateurs

#### Test 3.1: Créer Utilisateur
```
Étapes:
1. Naviguer vers "Gestion Utilisateurs"
2. Cliquer "+ Créer utilisateur"
3. Remplir formulaire:
   - Prénom: Jean
   - Nom: Dupont
   - Email: jean.dupont@example.com
   - Rôle: Collecteur
   - Mot de passe: Test123@ (ou laisser vide)
4. Cliquer "Créer le compte"
5. Vérifier le mot de passe temporaire affiché

Résultat attendu: 
- Utilisateur créé
- PasswordInput utilisé pour le mot de passe
- Mot de passe temporaire généré
```

#### Test 3.2: Réinitialiser Mot de Passe
```
Étapes:
1. Dans liste utilisateurs, cliquer "Reset Password"
2. Modal s'ouvre
3. Optionnel: Entrer nouveau mot de passe temporaire
4. Vérifier message d'avertissement
5. Cliquer "Réinitialiser"
6. Vérifier que l'utilisateur est déconnecté

Résultat attendu: 
- PasswordInput utilisé
- Mot de passe réinitialisé
- Utilisateur forcé de changer au login
```

### Module 4: Validation des Inputs

#### Test 4.1: Email Validation
```
Cas test:
1. Invalide: "notanemail" → Erreur
2. Invalide: "test@" → Erreur
3. Valide: "test@example.com" → Accepté
4. Valide: "user.name+tag@example.com" → Accepté

Résultat attendu: Validation RFC correcte
```

#### Test 4.2: Password Validation
```
Cas test:
1. "abc" → Erreur (< 8 chars)
2. "abcdefgh" → Erreur (pas majuscule)
3. "Abcdefgh" → Erreur (pas chiffre)
4. "Abcdef1" → Erreur (< 8 chars)
5. "Abcdef1!" → Accepté (4/4 critères)

Résultat attendu: Validation stricte
```

### Module 5: Sécurité

#### Test 5.1: Rate Limiting - Login
```
Étapes:
1. Essayer 5 fois un login incorrect
2. À la 6ème tentative, vérifier l'erreur
3. Attendre 15 minutes et réessayer
4. Devrait fonctionner

Résultat attendu: 
- Message "Trop de tentatives"
- Compte non verrouillé (juste rate limit)
```

#### Test 5.2: Security Headers
```
Terminal:
$ curl -I http://localhost:3001/api/health

Vérifier présence de:
- Content-Security-Policy
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Strict-Transport-Security

Résultat attendu: Tous les headers présents
```

#### Test 5.3: CORS Protection
```
Étapes:
1. Essayer request depuis domaine non autorisé
2. Vérifier CORS error dans console

Résultat attendu: 
- CORS error si domaine non autorisé
- Fonctionne si depuis localhost:3000
```

#### Test 5.4: Webhook CinetPay — HMAC invalide ou forgé
```
Précondition:
- Utiliser une contribution de test en attente, sans effectuer de paiement réel
- Espionner l'appel de vérification distante CinetPay et les écritures en base

Étapes:
1. Envoyer un POST de test vers /webhooks/cinetpay sans en-tête x-token
2. Répéter avec un x-token au format valide mais forgé
3. Répéter avec un corps modifié après calcul d'un x-token de test
4. Recharger la contribution de test

Résultat attendu:
- Chaque requête est rejetée avec le statut HTTP 401
- L'API de vérification distante CinetPay n'est jamais appelée
- La contribution, son statut et son montant restent inchangés
- Aucun reçu et aucune confirmation ne sont générés
```

#### Test 5.5: Webhook CinetPay — montant ou devise incohérents
```
Précondition:
- Utiliser une contribution de test en attente de 100 FCFA
- Simuler une réponse serveur CinetPay ACCEPTED avec un HMAC de test valide
- Ne saisir aucune vraie carte et ne déclencher aucun paiement réel

Étapes:
1. Simuler une vérification CinetPay avec un montant de 105 XAF
2. Vérifier l'état de la contribution
3. Recommencer avec un montant de 100 et une devise différente de XAF
4. Vérifier les alertes destinées aux trésoriers

Résultat attendu:
- La contribution n'est jamais confirmée
- Elle reste dans son état d'attente initial
- Aucun reçu n'est généré
- Une alerte signale le montant ou la devise incohérents aux trésoriers
```

### Module 6: Portail MEMBRE — contribution

#### Test 6.1: Arrivée sur Mes contributions
```
Étapes:
1. Se connecter avec un compte ayant le rôle MEMBRE
2. Vérifier la vue affichée immédiatement après la connexion
3. Vérifier la présence du bouton « Faire une contribution »
4. Cliquer sur ce bouton

Résultat attendu:
- Le membre arrive directement sur Mes contributions
- Seules ses propres contributions sont affichées
- Le bouton « Faire une contribution » ouvre le parcours de contribution
```

#### Test 6.2: Trois catégories et réseaux Mobile Money
```
Étapes:
1. Ouvrir le parcours « Faire une contribution »
2. Vérifier les catégories proposées
3. Sélectionner Mobile Money
4. Vérifier les sous-choix disponibles
5. Revenir au choix du mode sans perdre les données déjà saisies

Résultat attendu:
- Les catégories Mobile Money, Carte bancaire et Espèces sont visibles
- Mobile Money propose MTN Mobile Money et Orange Money
- Le changement de mode ne bloque pas le formulaire
```

#### Test 6.3: Disponibilité et redirection Carte bancaire
```
Étapes — configuration absente:
1. Utiliser un environnement où la configuration CinetPay est incomplète
2. Ouvrir « Faire une contribution »
3. Vérifier l'état de la catégorie Carte bancaire
4. Tenter également l'appel d'initiation côté API

Résultat attendu — configuration absente:
- La carte est désactivée ou clairement signalée comme indisponible
- Le refus API contient un message français actionnable
- Aucune contribution de paiement n'est créée

Étapes — configuration de test présente:
5. Activer une configuration CinetPay de test, sans vraie carte bancaire
6. Saisir un montant multiple de 5 et une adresse email valide
7. Valider le formulaire

Résultat attendu — configuration présente:
- La catégorie Carte bancaire est disponible
- L'utilisateur est redirigé vers la page sécurisée CinetPay
- Aucun secret de configuration n'est exposé dans le navigateur
```

#### Test 6.4: Confirmation Carte uniquement après vérification serveur
```
Précondition:
- Utiliser une transaction et une réponse CinetPay simulées, sans paiement réel

Étapes:
1. Simuler uniquement le retour navigateur après la page CinetPay
2. Consulter la contribution avant toute réponse serveur vérifiée
3. Simuler ensuite une réponse serveur CinetPay ACCEPTED avec montant exact et devise XAF
4. Recharger Mes contributions

Résultat attendu:
- Le retour navigateur seul ne confirme jamais la contribution
- Aucun reçu n'est disponible avant la vérification serveur
- La réponse serveur vérifiée confirme la contribution
- Le statut affiché est rafraîchi sans double confirmation
```

#### Test 6.5: Déclaration d'espèces et confirmation du collecteur
```
Étapes:
1. Choisir la catégorie Espèces
2. Saisir une rubrique et un montant sans sélectionner de collecteur
3. Tenter d'envoyer la déclaration
4. Sélectionner ensuite un collecteur et valider
5. Consulter Mes contributions avant l'action du collecteur
6. Faire confirmer la réception par le collecteur désigné

Résultat attendu:
- Le collecteur est obligatoire et un message français l'indique s'il manque
- La déclaration créée reste EN_ATTENTE_CONFIRMATION
- Le membre ne peut pas la confirmer lui-même
- Après confirmation du collecteur, la contribution passe à CONFIRME
```

#### Test 6.6: Erreurs et nouvelle tentative
```
Étapes:
1. Simuler une indisponibilité lors de l'initiation Mobile Money
2. Vérifier le message et l'état de l'écran
3. Rétablir le service simulé et utiliser l'action de nouvelle tentative
4. Recommencer avec une erreur d'initiation Carte bancaire

Résultat attendu:
- Chaque erreur est affichée en français avec une action possible
- Aucun écran ne reste bloqué sur un chargement infini
- La nouvelle tentative peut être lancée sans recharger toute l'application
- Aucun doublon de contribution n'est créé
```

#### Test 6.7: Reçu après confirmation
```
Étapes:
1. Ouvrir une contribution Mobile Money confirmée dans l'environnement de test
2. Ouvrir une contribution Carte confirmée après vérification serveur simulée
3. Ouvrir une déclaration d'espèces confirmée par son collecteur
4. Télécharger ou afficher le reçu depuis Mes contributions

Résultat attendu:
- Aucun reçu n'est proposé avant confirmation
- Un reçu est disponible après confirmation pour chaque mode
- Le reçu correspond à la bonne contribution et au bon montant
- En cas d'échec de chargement, un message français et une nouvelle tentative sont proposés
```

#### Test 6.8: Responsive mobile et bureau
```
Tailles à tester:
- Mobile: 320 px, 360 px et 390 px de largeur
- Bureau: largeur supérieure ou égale à 1280 px

Étapes:
1. Tester Mes contributions à chaque largeur
2. Ouvrir « Faire une contribution » et parcourir les trois catégories
3. Ouvrir les sous-choix MTN/Orange, les formulaires Carte et Espèces
4. Afficher les états de chargement, d'erreur, vide et de confirmation

Résultat attendu:
- Aucun défilement horizontal ni contenu tronqué
- Les boutons principaux restent visibles et utilisables
- Les formulaires, messages et fenêtres de confirmation restent lisibles
- Le parcours clavier et les zones tactiles restent utilisables
- La mise en page bureau conserve une hiérarchie claire
```

## 🐛 Scénarios de Dépannage

### Problème: Password field affiche "undefined"
```
Cause: Hydration mismatch
Solution: 
1. Vérifier suppressHydrationWarning est present
2. S'assurer que le champ utilise PasswordInput
```

### Problème: Eye icon ne fonctionne pas
```
Cause: Event handler non attaché
Solution:
1. Vérifier onClick sur button
2. Vérifier useState pour showPassword
3. Vérifier type="button" (pas type="submit")
```

### Problème: Build fail avec "EPERM"
```
Cause: Antivirus Windows bloque le fichier
Solution:
1. Ajouter dossier .next à whitelist antivirus
2. Ou: Désactiver scan en temps réel temporairement
3. Ou: Utiliser cache alternatif via env var
```

### Problème: Validation fail sans message
```
Cause: Zod error pas affiché
Solution:
1. Vérifier que error state est affiché
2. Vérifier que le composant a un prop error
3. Vérifier les logs console pour Zod errors
```

## ✅ Checklist Finale

Avant chaque déploiement:

```
Sécurité:
[ ] npm audit - Aucune vulnérabilité critique
[ ] TypeScript compile sans warnings
[ ] No console.error ou console.warn
[ ] rate-limit middleware actif
[ ] helmet configuré

Fonctionnalité:
[ ] Login fonctionne
[ ] Password change fonctionne  
[ ] Tous les password fields masqués par défaut
[ ] Eye toggle fonctionne partout
[ ] Validation de force affichée
[ ] Messages d'erreur clairs

UI/UX:
[ ] Pas de flickering
[ ] Pas de layout shift
[ ] Icons cohérents
[ ] Colors cohérentes
[ ] Responsive design OK

Performance:
[ ] Pas de console errors
[ ] Pas de memory leaks
[ ] Build < 60s (web)
[ ] No unused imports
```

## 📋 Test Execution Log

Date: [À remplir]

| Test ID | Description | Status | Notes |
|---------|-------------|--------|-------|
| 1.1 | Login Password Toggle | ⏳ | - |
| 1.2 | ChangePassword Flow | ⏳ | - |
| 1.3 | Strength Indicator | ⏳ | - |
| 1.4 | Confirmation Match | ⏳ | - |
| 2.1 | MonProfil Change | ⏳ | - |
| 3.1 | Create User | ⏳ | - |
| 3.2 | Reset Password | ⏳ | - |
| 4.1 | Email Validation | ⏳ | - |
| 4.2 | Password Validation | ⏳ | - |
| 5.1 | Rate Limiting | ⏳ | - |
| 5.2 | Security Headers | ⏳ | - |
| 5.3 | CORS Protection | ⏳ | - |
| 5.4 | Webhook CinetPay — HMAC invalide ou forgé | ⏳ | Non exécuté |
| 5.5 | Webhook CinetPay — montant ou devise incohérents | ⏳ | Non exécuté |
| 6.1 | Arrivée MEMBRE sur Mes contributions | ⏳ | Non exécuté |
| 6.2 | Catégories et réseaux Mobile Money | ⏳ | Non exécuté |
| 6.3 | Disponibilité et redirection Carte | ⏳ | Non exécuté |
| 6.4 | Confirmation Carte après vérification serveur | ⏳ | Non exécuté |
| 6.5 | Déclaration d'espèces et confirmation | ⏳ | Non exécuté |
| 6.6 | Erreurs et nouvelle tentative | ⏳ | Non exécuté |
| 6.7 | Reçu après confirmation | ⏳ | Non exécuté |
| 6.8 | Responsive 320/360/390 et bureau | ⏳ | Non exécuté |

## 🎯 Signoff

- [ ] All tests passed
- [ ] No critical issues found
- [ ] Ready for staging
- [ ] Ready for production

Approver: _________________ Date: _____________
