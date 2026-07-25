# Tester SGM-CEM dans Chrome avec Claude (claude-in-chrome)

Guide pratique pour laisser Claude (Claude Code / Claude web avec l'extension Chrome)
piloter un navigateur Chrome réel, naviguer dans l'appli en dev, lire les logs et
corriger ce qu'il trouve. Rédigé après une session de test complet (2026-07-24) où
plusieurs pièges d'environnement (pas des bugs applicatifs) ont fait perdre du temps —
ce document sert à ne pas les rejouer.

## 1. Prérequis côté navigateur

- Extension **Claude for Chrome** installée, Chrome ouvert, connecté au même compte
  que Claude Code/Claude web.
- Si les outils `mcp__claude-in-chrome__*` apparaissent comme *deferred* (non
  chargés), les charger en UN seul appel `ToolSearch` avant de commencer, jamais un
  par un :
  ```
  ToolSearch("select:mcp__claude-in-chrome__tabs_context_mcp,
              mcp__claude-in-chrome__navigate,
              mcp__claude-in-chrome__computer,
              mcp__claude-in-chrome__read_page,
              mcp__claude-in-chrome__tabs_create_mcp,
              mcp__claude-in-chrome__read_console_messages,
              mcp__claude-in-chrome__read_network_requests,
              mcp__claude-in-chrome__find,
              mcp__claude-in-chrome__get_page_text,
              mcp__claude-in-chrome__javascript_tool")
  ```

## 2. Démarrer l'appli en local avant de tester

Depuis `sgm-cem/` : `pnpm dev` (voir `docs/reference/README-DEMARRAGE.md`) lance
`scripts/dev.mjs`, qui trouve un port libre pour le web (à partir de 3000) et pour
l'api (à partir de 3001) puis les câble ensemble. **Le port annoncé dans le log
(`🌐 Web : http://localhost:XXXX`) fait foi — ne jamais supposer que c'est 3000.**

Avant de lancer : vérifier qu'aucun ancien process ne traîne (voir piège 3.1
ci-dessous). Sinon `pnpm dev` choisira un port suivant (3001, 3002…) et Chrome
continuera de pointer sur l'ancien port, cassé.

```powershell
Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in 3000,3001} |
  Select-Object LocalPort, OwningProcess
```

## 3. Pièges d'environnement rencontrés (pas des bugs de code)

### 3.1 Process "next dev" zombies qui survivent à un arrêt

Sur cette machine, arrêter une tâche background (`TaskStop`, ou même un process qui
répond "killed") **ne garantit pas** que le process Windows sous-jacent est vraiment
mort — des `next dev`/`next build`/`nodemon`/`ts-node` orphelins peuvent continuer à
tourner, squatter un port (3000, 3001…) et servir du contenu cassé (CSS en 503,
build à moitié fait) alors que Chrome semble pointer sur la bonne URL.

**Diagnostic fiable** : un process listé "actif" n'est pas forcément vivant
fonctionnellement.
```powershell
Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in 3000,3001,3002} |
  Select-Object LocalPort, OwningProcess
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'next|nodemon|ts-node|dev.mjs' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```
Puis `curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT --max-time 5` —
si ça timeout (`000`) ou renvoie une erreur alors qu'un process écoute bien sur ce
port, c'est un zombie : `Stop-Process -Id <pid> -Force`.

### 3.2 `.next` partagé entre `dev` et `build`

Ne jamais lancer `next build` pendant qu'un `next dev` tourne sur le même dossier
`apps/web/.next` (Windows verrouille les fichiers, `EPERM` sur `.next\trace`, ou
le build reste bloqué indéfiniment sans avancer). Arrêter tous les process web
avant un build de vérification, `rm -rf apps/web/.next` si le dossier semble
verrouillé, relancer `next dev` seulement après.

### 3.3 Service Worker PWA qui masque un rendu cassé (ou sain)

`public/sw.js` (cache `sgm-cem-v3`) sert en cache-first. Après un redémarrage du
dev server, un onglet Chrome déjà ouvert peut continuer à afficher une version
figée. Avant de conclure à un bug visuel, vérifier et nettoyer via
`javascript_tool` :
```js
const regs = await navigator.serviceWorker.getRegistrations();
for (const r of regs) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
```
puis recharger la page.

### 3.4 Faux positifs d'hydratation React causés par une extension Chrome

Un avertissement `A tree hydrated but some attributes ... didn't match` sur un
attribut du type `fdprocessedid="..."` sur un `<input>`/`<button>` est presque
toujours causé par une extension de remplissage de formulaire (gestionnaire de
mots de passe, etc.) qui modifie le DOM avant que React n'hydrate — **pas un bug
du code**. React le documente lui-même dans le message d'erreur. Ne pas chercher
à "corriger" ce cas ; vérifier plutôt l'objet du mismatch (attributs `style`,
`className`, structure) pour distinguer un vrai bug (ex. `initial` de
`framer-motion` conditionné par un hook client-only comme `useReducedMotion()`,
cf. correctif du 2026-07-24) d'un artefact d'extension.

## 4. Ce que Claude ne peut pas faire — et ce qu'il faut lui donner à la place

Par règle de sécurité stricte, **Claude ne saisit jamais de mot de passe**, même
pour un compte de test que l'utilisateur autorise explicitement. En pratique :

- Claude ouvre l'onglet, navigue, vérifie une page publique (login, page
  publique de collecte) sans authentification.
- Pour toute vue authentifiée, **l'utilisateur doit se connecter lui-même** dans
  l'onglet ouvert par Claude (même profil Chrome, même onglet). Une fois connecté,
  Claude peut reprendre la navigation dans les vues protégées (le cookie de
  session/JWT persiste dans l'onglet).

## 5. Recette de test complet ("prendre le dessus" sur l'appli)

1. Nettoyer les process zombies (3.1), démarrer `pnpm dev` proprement, noter le
   port réel annoncé.
2. `ToolSearch` pour charger les outils `claude-in-chrome` si besoin (§1).
3. `tabs_context_mcp` (avec `createIfEmpty: true` si aucun onglet), puis
   `navigate` vers l'URL du web.
4. Nettoyer Service Worker/caches si le rendu semble cassé (3.3) avant de creuser
   côté code.
5. `read_console_messages` (pattern `error|Error|failed|Hydration`) et
   `read_network_requests` (filtré `/api/`) à chaque vue pour repérer les 4xx/5xx
   et erreurs JS.
6. Demander à l'utilisateur de se connecter si une vue authentifiée est à tester.
7. Parcourir les vues métier une à une (Dashboard clair/sombre, Contributions,
   Collecteurs, Transferts, GED, Journal d'audit, Paramètres…), captures d'écran
   à l'appui.
8. Tout problème trouvé → diagnostic (cause racine prouvée) → correctif minimal
   via l'équipe d'agents du projet (`frontend-lead`/`backend-lead` planifie,
   `nano` code, `builder` vérifie type-check/build) → revérifier dans Chrome que
   l'erreur a disparu.
9. Ne pas conclure à un bug de code avant d'avoir éliminé les pièges d'environnement
   ci-dessus (3.1 à 3.4) — ce sont eux qui, dans la pratique, causent la majorité
   des rendus "cassés" observés en session de test sur cette machine.

Voir aussi `docs/reference/README-DEMARRAGE.md` (démarrage dev) et
`DEPLOIEMENT_DOCKER.md` (pièges spécifiques à Docker, différents de ceux-ci).
