# Guide de Test Complet - SGM-CEM

## 🧪 Plan de Test Fonctionnel

### Module 1: Authentification & Mots de Passe

#### Test 1.1: Login avec PasswordInput ✅
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

## 🎯 Signoff

- [ ] All tests passed
- [ ] No critical issues found
- [ ] Ready for staging
- [ ] Ready for production

Approver: _________________ Date: _____________
