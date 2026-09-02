# Auth API headless + réorganisation — Design

Date : 2026-09-02
Statut : validé, prêt pour le plan d'implémentation

## Objectif

Supprimer Puppeteer de `ecole-directe-desktop` et remplacer l'authentification
par pilotage du DOM par une authentification 100 % API, exécutée dans le
processus principal d'Electron. Réorganiser au passage l'arborescence, qui est
aujourd'hui presque entièrement à la racine.

Le site ÉcoleDirecte et l'extension CustomDirecte restent affichés tels quels :
seule la façon d'ouvrir la session change.

## Contexte

L'application empaquette le site ecoledirecte.com dans Electron. Aujourd'hui
`index.js` connecte `puppeteer-in-electron` à la fenêtre, attend les sélecteurs
`#username` / `#password`, tape les identifiants, coche « se souvenir de moi »
et clique sur `#connexion`. Un `MutationObserver` réinjecte le mot de passe
quand un champ password réapparaît.

Coûts de cette approche : ~50 Mo de dépendances, dépendance à des sélecteurs
CSS que ÉcoleDirecte peut changer, et une fenêtre qui doit être visible et
rendue pour que la connexion aboutisse.

## Découvertes (rétro-ingénierie du SPA)

Vérifié en analysant `main-VA3K7GUY.js` et les 77 chunks de
`https://www.ecoledirecte.com`, recoupé avec la documentation non officielle
[EduWireApps/ecoledirecte-api-docs](https://github.com/EduWireApps/ecoledirecte-api-docs).

### Persistance de session

Le SPA Angular persiste ses stores via un `WebStorageService` qui utilise
**`sessionStorage`** (fallback `localStorage`), avec l'enveloppe
`JSON.stringify({ payload, lastModified })` :

| Clé sessionStorage | Store | Contenu de `payload` |
|---|---|---|
| `credentials` | `CredentialsStore` | `{ authToken, fcmToken, twoFAToken }` |
| `accounts` | `AuthStore` | `{ accounts[], changementMDP, nbJourMdpExire, isBloque, urlUnblock }` |

L'intercepteur HTTP pose `X-Token: credentialsStore.snapshot.authToken` sur
chaque requête. C'est le seul point d'entrée de l'authentification côté page.

`accounts[]` est exactement `data.accounts[]` de la réponse de login : le SPA
le passe à un constructeur qui recopie les champs sans les renommer.

Les clés 2FA vivent dans `localStorage["fa"]` sous la forme
`[{ cn, cv, uniq }]` (10 entrées max, FIFO), doublées en cookies.

**Piège écarté :** la page expose aussi `sessionStorage["edcommonhydration_auth"]`.
Ce n'est **pas** l'authentification — c'est l'hydratation d'un feature-state
NgRx `{ datas, selectedAnneeScolaire, selectedEntityUser, selectedVariant }`,
préfixé par `` edcommonhydration_${nom} ``. On n'y touche pas.

### Flux de login

1. `GET /v3/login.awp?gtk=1` → pose un cookie `GTK`
2. `POST /v3/login.awp` avec header `X-Gtk` + le cookie, corps
   `data=<json urlencodé>` : `{ identifiant, motdepasse, isReLogin: false, uuid, fa: [...] }`
3. Réponse `code: 200` → `token` (le futur `X-Token`) + `data.accounts[]`
4. `code: 250` → 2FA requise ; `code: 505` → identifiants invalides

2FA : `GET /v3/connexion/doubleauth.awp?verbe=get` renvoie
`{ question, propositions[] }` en base64 ; `POST …?verbe=post` avec
`{ choix: base64(réponse) }` renvoie `{ cn, cv }`, réutilisables indéfiniment.

### Badge barre des tâches

La réponse de login contient déjà la source du badge :
`accounts[].modules[]` où chaque module porte `{ code, badge }`, dont
`{ code: "MESSAGERIE", badge: N }`. C'est la valeur qu'affiche le badge du menu
latéral que `badge.js` scrape aujourd'hui.

### Validation de l'hypothèse porteuse (spike, exécuté)

Un preload en `sandbox: true` + `contextIsolation: true` sur
`https://www.ecoledirecte.com/login` :

- `ipcRenderer.sendSync` fonctionne ;
- l'écriture a lieu à `document.readyState === "loading"`, donc avant le boot
  Angular ;
- le **monde principal de la page relit exactement** ce que le preload a écrit.

Le storage est cloisonné par origine, pas par monde isolé. L'option retenue
est donc valide. Spike supprimé après vérification.

## Approche retenue

Login API dans le processus principal, puis amorçage du `sessionStorage` par un
preload avant le boot d'Angular.

Le login utilise `net.fetch` lié à `session.defaultSession` : les cookies `GTK`
et ceux posés par le login atterrissent directement dans le jar de la fenêtre,
sans gestion manuelle.

Alternatives écartées :

- **Interception réseau du POST login.** Il faudrait que la page émette
  elle-même la requête, donc soumettre le formulaire, donc revenir au DOM.
- **Client natif complet.** Ferait perdre le site ED et l'extension
  CustomDirecte. Hors sujet.

## Architecture cible

```
src/
  main/
    index.js                 lifecycle app, câblage, décide quelle fenêtre afficher
    auth/
      ed-api.js              GTK, login, relogin, doubleauth — fetch pur
      session-payload.js     réponse API → { credentials, accounts } — fonction pure
      credentials-store.js   safeStorage : identifiants + clés cn/cv
      auth-flow.js           orchestration ; retourne un état, n'ouvre aucune fenêtre
    windows/
      main-window.js
      login-window.js
      twofa-window.js
      popup-window.js
    features/
      badge.js               reçoit un webContents en paramètre
      extensions.js
      updater.js
      shortcuts.js
    lib/
      logger.js
      paths.js
  preload/
    ed-session.js            amorce sessionStorage avant Angular
  renderer/
    login/    login.html + js + css
    twofa/    twofa.html + js + css
    popup/    popup.html + js + css
scripts/
  patch-extension.js
  diag-auth.js
build/                        sortie du patch d'extension — gitignoré
```

`package.json` : `main` → `src/main/index.js`.

### Contraintes de dépendances

Deux règles issues de la revue de design, à respecter :

- **`features/badge.js` reçoit un `webContents` en paramètre**, il n'importe
  jamais `windows/`. Sinon `features/` et `windows/` deviennent mutuellement
  dépendants.
- **`auth/auth-flow.js` n'ouvre aucune fenêtre.** Il retourne un état
  discriminé — `{ status: "ok", session }`, `{ status: "needs2fa", question,
  propositions, token }`, `{ status: "failed", code, message }` — et
  `main/index.js` décide de l'affichage. C'est ce qui rend le flux testable
  sans Electron.

## Flux d'exécution

1. `main/index.js` lit les identifiants via `credentials-store`.
2. Aucun identifiant → fenêtre de login → stockage chiffré.
3. `auth-flow.login()` : GTK, puis POST login avec les `fa[]` connus.
4. `status: "needs2fa"` → `index.js` ouvre la fenêtre 2FA, renvoie le choix à
   `auth-flow`, qui rejoue le login avec les `cn`/`cv` obtenus et les persiste.
5. `status: "ok"` → la session est passée au preload, la fenêtre principale
   navigue vers `/Accueil` déjà connectée.
6. `status: "failed"` → bandeau d'avertissement + formulaire ED normal.

### Preload — quand amorcer

Le preload **ne réamorce pas à chaque navigation** ecoledirecte.com. Il n'écrit
que si l'une de ces conditions est vraie :

- l'URL de navigation correspond à `/login` ;
- `sessionStorage.credentials` est absent.

Sinon on risquerait d'écraser en pleine utilisation une session plus fraîche que
celle détenue par le processus principal (rotation de token côté serveur).

### Re-login — garde anti-boucle

`did-navigate` vers `/login` relance le flux. Avec un mot de passe devenu faux
ou ÉcoleDirecte en carafe, cela boucle indéfiniment. Garde :

- 3 tentatives maximum par session applicative ;
- backoff exponentiel entre les tentatives (2 s, 4 s, 8 s) ;
- au-delà, plus aucune tentative automatique : bandeau d'avertissement et le
  formulaire ED reste utilisable.

Le compteur se remet à zéro sur un login réussi.

### 2FA expirée

Si le login renvoie `250` **alors qu'on a envoyé des `fa[]`**, le couple stocké
est mort. Dans ce cas : purge des `cn`/`cv` du stockage chiffré et de
`localStorage["fa"]`, puis retour à la fenêtre 2FA. Sans cette purge on
renverrait éternellement un couple invalide.

### Identifiant d'appareil

Le corps du login accepte un `uuid`, identifiant d'appareil. On en génère un
(UUIDv4) au premier lancement et on le persiste avec les identifiants. Il sert
à deux choses : permettre le renouvellement de token par `isReLogin` sans
remot de passe, et éviter que ÉcoleDirecte considère chaque démarrage comme un
nouvel appareil — ce qui redéclencherait la 2FA.

## Gestion d'erreurs

Filet de sécurité en deux temps, comme demandé :

- si après navigation l'URL est toujours `/login`, un bandeau discret est
  injecté dans la fenêtre indiquant l'étape et le code API en échec, avec un
  lien vers `app.log` ;
- le formulaire ÉcoleDirecte normal reste utilisable en dessous.

L'application n'est jamais bloquée par un échec d'injection.

## Migration du patch d'extension

`scripts/patch-extension.js` écrit aujourd'hui **dans le submodule**
(`CustomDirecte/src`), ce qui le laisse durablement sale et fera échouer ses
futures mises à jour. Il doit copier `CustomDirecte/src` vers
`build/extension/` puis patcher **la copie**. Le submodule devient
read-only.

Points de vérification obligatoires — c'est le piège classique de ce
déplacement :

1. **`.gitignore`** ne contient que `build/Release`, pas `build/`. Il faut
   ajouter `build/`.
2. **`electron-builder.yml` — `extraFiles`** pointe sur `CustomDirecte`. À
   basculer sur `from: build/extension` / `to: CustomDirecte`, ce qui garde le
   chemin d'exécution inchangé. L'extension doit rester hors de l'asar :
   Chromium ne charge pas une extension depuis une archive asar.
3. **`asarUnpack: [CustomDirecte]`** devient sans objet — à retirer.
4. **Ordre d'exécution.** Le patch tourne aujourd'hui en `postinstall` et
   `prestart`. La CI enchaîne `pnpm install` puis `pnpm run build` : le
   postinstall couvre le cas, mais un script `prebuild` explicite doit être
   ajouté pour que `build/extension/` existe toujours au moment du packaging.
5. **Résolution du chemin au runtime.** `getCustomExtensionPath()` remonte
   depuis `app.asar` pour trouver `CustomDirecte/src`. En développement il
   pointe sur `CustomDirecte/src` : il doit désormais pointer sur
   `build/extension`.

Ce travail fait l'objet d'un commit séparé.

## Anomalies constatées, hors périmètre

Relevées pendant l'analyse, **à ne pas corriger dans ce chantier** sauf
décision contraire :

- La configuration electron-builder est dupliquée : `electron-builder.yml` et
  le champ `build` de `package.json`. electron-builder ne lit qu'une source ;
  si le `.yml` gagne, les cibles `mac` et `dmg`/`linux` déclarées uniquement
  dans `package.json` ne s'appliquent pas, alors que la CI construit bien
  `--mac` et `--linux`. À confirmer par un build avant toute correction.
- `api-researchs/` n'est pas suivi par git ni ignoré.

## Stratégie de test

Aucun framework de test aujourd'hui. On ajoute **`node:test`** (intégré à
Node, zéro dépendance).

Unitaire, sans réseau ni Electron :

- `session-payload.js` — réponse de login → payloads `credentials` / `accounts`,
  y compris l'enveloppe `{ payload, lastModified }` ;
- `ed-api.js` avec `fetch` mocké — codes 200, 250, 505, propagation du header
  `X-Gtk`, encodage `data=` du corps ;
- `auth-flow.js` avec `ed-api` mocké — chemin nominal, 250 puis résolution 2FA,
  250 malgré `fa[]` (purge), garde anti-boucle.

Intégration : `scripts/diag-auth.js`, script Electron qui rejoue le vrai flux
avec les identifiants stockés et affiche un diagnostic **caviardé** — jamais de
token, de mot de passe ni de `cn`/`cv` en clair, uniquement des longueurs et des
codes.

Note d'environnement : `ELECTRON_RUN_AS_NODE=1` est positionné dans ce shell.
Les scripts Electron doivent être lancés avec `env -u ELECTRON_RUN_AS_NODE`,
sinon `require("electron")` renvoie un chemin et non l'API.

## Nettoyage

`puppeteer-core` et `puppeteer-in-electron` sont supprimés. Grep effectué sur
l'ensemble des fichiers suivis par git : les seules références de premier plan
sont `index.js` lignes 13, 14, 315, 482 et `package.json` lignes 24-25 (plus
`pnpm-lock.yaml`, régénéré). Le grep sera rejoué avant la suppression.

## Découpage en commits

Un tag est posé avant de commencer, pour pouvoir revenir en arrière
proprement : beaucoup de fichiers quittent la racine.

0. Pose du tag `pre-auth-api` sur le HEAD actuel — ce n'est pas un commit,
   juste le point de retour.
1. `refactor: patch-extension écrit dans build/ au lieu du submodule`
3. `refactor: réorganisation de l'arborescence vers src/`
4. `feat: client API ÉcoleDirecte + construction des payloads de session`
5. `feat: preload d'amorçage de session`
6. `feat: flux d'auth headless, 2FA, re-login avec garde`
7. `chore: suppression de puppeteer`

Chaque commit laisse l'application démarrable.
