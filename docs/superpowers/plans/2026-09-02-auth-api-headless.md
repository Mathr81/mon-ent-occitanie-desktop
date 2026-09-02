# Auth API headless ÉcoleDirecte — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'authentification ÉcoleDirecte pilotée par Puppeteer par une authentification 100 % API exécutée dans le processus principal, et réorganiser l'arborescence vers `src/`.

**Architecture:** Le login se fait par HTTP dans le processus principal via `session.defaultSession.fetch` (les cookies atterrissent dans le jar de la fenêtre). Le token et les comptes obtenus sont écrits dans le `sessionStorage` de la page par un preload qui s'exécute avant le boot d'Angular. Le SPA se croit alors déjà connecté et affiche `/Accueil`.

**Tech Stack:** Electron 42, CommonJS, `node:test` (intégré) pour les tests, pnpm, electron-builder.

**Spec:** `docs/superpowers/specs/2026-09-02-auth-api-headless-design.md`

## Global Constraints

- Runtime CommonJS — `package.json` n'a pas `"type": "module"`. Tout est en `require`/`module.exports`.
- Tests avec `node:test` et `node:assert/strict` uniquement. **Aucune nouvelle dépendance de production.**
- Config de packaging : **modifier `package.json` champ `build`**. `electron-builder.yml` n'est jamais lu (`app-builder-lib/out/util/config/load.js` : le fichier de config n'est cherché que si `build` est absent de `package.json`). Ne pas le modifier, ne pas le supprimer dans ce chantier.
- Sortie du patch d'extension : `.cache/extension/`. Déjà couvert par `.gitignore:105`. **Ne pas ajouter `build/` au `.gitignore`.**
- **Ne pas déplacer le pointeur du submodule `CustomDirecte`.** Il reste read-only.
- API ÉcoleDirecte : `BASE_URL = "https://api.ecoledirecte.com"`, paramètre `v = "4.101.2"` (valeur `packageVersion` du SPA courant).
- Clés de storage du SPA : `sessionStorage["credentials"]`, `sessionStorage["accounts"]`, `localStorage["fa"]`. **Ne jamais écrire `edcommonhydration_auth`** — c'est un feature-state NgRx, pas de l'authentification.
- `ELECTRON_RUN_AS_NODE=1` est positionné dans l'environnement de dev. Tout lancement d'Electron passe par `env -u ELECTRON_RUN_AS_NODE`.
- Aucun secret dans les logs : jamais de mot de passe, token, `cn` ou `cv` en clair. Uniquement longueurs et codes.

## Critère d'acceptation — à valider à la fin de CHAQUE tâche

1. `env -u ELECTRON_RUN_AS_NODE pnpm start` démarre l'application ;
2. elle se connecte et affiche `/Accueil` ;
3. le badge de la barre des tâches se met à jour.

Aucun commit tant que ces trois points ne sont pas vérifiés.

---

## Structure de fichiers

| Fichier | Responsabilité |
|---|---|
| `src/main/index.js` | Lifecycle app, câblage, décide quelle fenêtre afficher |
| `src/main/lib/paths.js` | Résolution userData et chemin d'extension (dev vs packagé) |
| `src/main/lib/logger.js` | Tee console → `app.log` |
| `src/main/auth/ed-api.js` | GTK, login, relogin, doubleauth — HTTP injectable |
| `src/main/auth/session-payload.js` | Réponse API → entrées de storage — pur |
| `src/main/auth/credentials-store.js` | safeStorage : identifiants, deviceUuid, clés `fa` |
| `src/main/auth/auth-flow.js` | Orchestration ; retourne un état, n'ouvre aucune fenêtre |
| `src/main/auth/relogin-guard.js` | Compteur de tentatives + backoff |
| `src/main/windows/*.js` | Création des fenêtres |
| `src/main/features/badge.js` | Badge — reçoit un `webContents` |
| `src/main/features/{extensions,updater,shortcuts}.js` | Extraits d'`index.js` |
| `src/preload/ed-session.js` | Amorce le sessionStorage avant Angular |
| `src/renderer/{login,twofa,popup}/` | Pages de rendu |
| `scripts/patch-extension.js` | Copie + patch vers `.cache/extension/` |
| `scripts/diag-auth.js` | Diagnostic du flux réel, caviardé |
| `test/*.test.js` | Tests `node:test` |

Règles de dépendance, non négociables :

- `features/badge.js` **reçoit un `webContents` en paramètre** et n'importe jamais `windows/`.
- `auth/auth-flow.js` **n'ouvre aucune fenêtre** : il retourne un état discriminé, `index.js` décide.

---

## Task 1 : patch-extension écrit dans `.cache/extension/`

**Files:**
- Modify: `scripts/patch-extension.js` (réécriture complète)
- Modify: `package.json` (scripts `prebuild`, champ `build`)
- Modify: `index.js:63-89` (`getCustomExtensionPath`)

**Interfaces:**
- Consumes: rien
- Produces: `.cache/extension/` contenant une copie patchée de `CustomDirecte/src`, avec `manifest.json` à la racine.

- [ ] **Step 1 : Réécrire `scripts/patch-extension.js`**

Idempotent par construction : on supprime, on recopie, on patche la copie. Le submodule n'est jamais écrit.

```js
// scripts/patch-extension.js
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "CustomDirecte", "src");
const DEST = path.join(__dirname, "..", ".cache", "extension");

const PATCHES = {
  "scripts/background.js": [["browser.storage.sync", "browser.storage.local"]],
  "scripts/main.js": [
    ["browser.storage.sync", "browser.storage.local"],
    ["chrome.storage.sync", "chrome.storage.local"],
  ],
  "pages/popup/interface.js": [["browser.storage.sync", "browser.storage.local"]],
};

if (!fs.existsSync(SRC)) {
  console.error(`[patch] Submodule absent : ${SRC}`);
  console.error("[patch] Lancez : git submodule update --init --recursive");
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });
console.log(`[patch] Copié ${SRC} -> ${DEST}`);

for (const [relPath, patches] of Object.entries(PATCHES)) {
  const file = path.join(DEST, relPath);
  if (!fs.existsSync(file)) {
    console.warn(`[patch] Absent, ignoré : ${relPath}`);
    continue;
  }
  let content = fs.readFileSync(file, "utf8");
  let total = 0;
  for (const [from, to] of patches) {
    const count = content.split(from).length - 1;
    if (count > 0) {
      content = content.replaceAll(from, to);
      total += count;
    }
  }
  if (total > 0) {
    fs.writeFileSync(file, content, "utf8");
    console.log(`[patch] ${relPath} : ${total} remplacement(s)`);
  }
}

if (!fs.existsSync(path.join(DEST, "manifest.json"))) {
  console.error("[patch] manifest.json absent de la sortie !");
  process.exit(1);
}
console.log("[patch] Terminé");
```

- [ ] **Step 2 : Vérifier l'idempotence et la propreté du submodule**

```bash
node scripts/patch-extension.js && node scripts/patch-extension.js
git -C CustomDirecte status --porcelain
grep -c "storage.local" .cache/extension/scripts/main.js
```

Attendu : deux exécutions sans erreur, `git -C CustomDirecte status` **vide** (le submodule n'est plus sali), et au moins un `storage.local` dans la sortie.

- [ ] **Step 3 : Brancher `prebuild` dans `package.json`**

Dans `scripts`, ajouter `prebuild` en gardant `postinstall` et `prestart` :

```json
"prebuild": "node scripts/patch-extension.js",
```

- [ ] **Step 4 : Basculer le packaging dans le champ `build` de `package.json`**

Remplacer `extraFiles` et `asarUnpack` par `extraResources`, et exclure `.cache` de l'asar :

```json
"files": [
  "**/*",
  "!userData/**",
  "!dist/**",
  "!.cache/**",
  "!.git/**"
],
"extraResources": [
  { "from": ".cache/extension", "to": "extension", "filter": ["**/*"] }
]
```

Supprimer les clés `extraFiles` et `asarUnpack` de `package.json`. Ne pas toucher à `electron-builder.yml`.

- [ ] **Step 5 : Adapter la résolution du chemin dans `index.js`**

Remplacer intégralement `getCustomExtensionPath` (`index.js:63-89`) — la remontée à l'aveugle de quatre niveaux disparaît :

```js
function getCustomExtensionPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "extension")
    : path.join(app.getAppPath(), ".cache", "extension");
}
```

- [ ] **Step 6 : Vérifier le critère d'acceptation en développement**

```bash
env -u ELECTRON_RUN_AS_NODE pnpm start
```

Attendu : log `Extension chargée !`, connexion aboutie, badge à jour.

- [ ] **Step 7 : Vérifier le packaging — critère spécifique à cette tâche**

C'est la seule régression de ce chantier invisible en développement.

```bash
env -u ELECTRON_RUN_AS_NODE pnpm run build --win
ls dist/win-unpacked/resources/extension/manifest.json
grep -c "storage.local" dist/win-unpacked/resources/extension/scripts/main.js
```

Attendu : le `manifest.json` existe dans `resources/extension/` et le `main.js` qui s'y trouve est bien patché.

- [ ] **Step 8 : Commit**

```bash
git add scripts/patch-extension.js package.json index.js
git commit -m "refactor: patch-extension écrit dans .cache/extension au lieu du submodule"
```

---

## Task 2 : Réorganisation de l'arborescence vers `src/`

Déplacement pur, sans changement de comportement. `index.js` est éclaté mais sa logique est recopiée telle quelle.

**Files:**
- Create: `src/main/index.js`, `src/main/lib/{paths,logger}.js`, `src/main/windows/{main,login,popup}-window.js`, `src/main/features/{badge,extensions,updater,shortcuts}.js`
- Create: `src/renderer/login/login.html`, `src/renderer/popup/popup.html`
- Delete: `index.js`, `badge.js`, `login.html`, `popup.html`
- Modify: `package.json` (`main`)

**Interfaces:**
- Consumes: `getCustomExtensionPath()` de la Task 1, déplacé dans `src/main/lib/paths.js`
- Produces:
  - `paths.js` → `resolveUserDataPath()`, `getCustomExtensionPath()`
  - `logger.js` → `initLogger(userDataPath)`
  - `features/badge.js` → `startBadgePolling(webContents, browserWindow)`, `stopBadgePolling()`, `updateBadge(webContents, browserWindow)`
  - `features/extensions.js` → `loadCustomExtension(session)`
  - `features/updater.js` → `setupAutoUpdater(browserWindow)`
  - `features/shortcuts.js` → `registerWindowShortcuts(browserWindow)`, `registerGlobalShortcuts()`, `unregisterAll()`
  - `windows/main-window.js` → `createMainWindow()`
  - `windows/login-window.js` → `createLoginWindow(parent)`
  - `windows/popup-window.js` → `createPopupWindow(url)`

- [ ] **Step 1 : Déplacer les fichiers avec `git mv` pour préserver l'historique**

```bash
mkdir -p src/main/lib src/main/windows src/main/features src/renderer/login src/renderer/popup
git mv login.html src/renderer/login/login.html
git mv popup.html src/renderer/popup/popup.html
git mv badge.js src/main/features/badge.js
git mv index.js src/main/index.js
```

- [ ] **Step 2 : Changer la signature de `badge.js` pour recevoir un `webContents`**

Dans `src/main/features/badge.js`, remplacer les appels Puppeteer `page.evaluate(fn, args)` par `webContents.executeJavaScript(string)`. La fonction `updateBadge` devient :

```js
async function updateBadge(webContents, mainWindow) {
  if (!webContents || webContents.isDestroyed()) { badgeLog("webContents absent"); return; }
  if (mainWindow.isDestroyed()) { badgeLog("Fenetre detruite"); return; }
  try {
    const result = await webContents.executeJavaScript(`(() => {
      const selectors = ${JSON.stringify(BADGE_SELECTORS)};
      const debug = [];
      for (const selector of selectors) {
        try {
          const els = document.querySelectorAll(selector);
          debug.push({ selector, found: els.length });
          if (els.length > 0) {
            let total = 0;
            els.forEach((el) => { const n = parseInt(el.textContent.trim(), 10); if (!isNaN(n)) total += n; });
            if (total > 0) return { count: total, matchedSelector: selector, debug };
          }
        } catch (e) { debug.push({ selector, error: String(e) }); }
      }
      return { count: 0, matchedSelector: null, debug };
    })()`);
    applyBadge(result.count, mainWindow);
  } catch (err) { badgeLog("Erreur updateBadge :", err); }
}
```

`applyBadge(count, mainWindow)` extrait la partie `setBadgeCount` / `setOverlayIcon` existante, inchangée. `startBadgePolling(webContents, mainWindow)` propage le `webContents`.

Ce fichier n'importe **rien** de `windows/`.

- [ ] **Step 3 : Extraire `lib/paths.js`**

```js
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function resolveUserDataPath() {
  if (process.env.NODE_ENV === "development") {
    const dir = path.join(app.getAppPath(), "userData");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    app.setPath("userData", dir);
    return dir;
  }
  return app.getPath("userData");
}

function getCustomExtensionPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "extension")
    : path.join(app.getAppPath(), ".cache", "extension");
}

module.exports = { resolveUserDataPath, getCustomExtensionPath };
```

- [ ] **Step 4 : Extraire `lib/logger.js`, `features/{extensions,updater,shortcuts}.js`, `windows/*.js`**

Copier les blocs correspondants d'`index.js` sans en modifier la logique. Les chemins de fichiers changent :

- `loadFile("login.html")` → `loadFile(path.join(__dirname, "../../renderer/login/login.html"))`
- `loadFile("popup.html")` → `loadFile(path.join(__dirname, "../../renderer/popup/popup.html"))`
- `path.join(__dirname, "assets/icons/icon.ico")` → `path.join(app.getAppPath(), "assets/icons/icon.ico")`

- [ ] **Step 5 : Mettre à jour `package.json`**

```json
"main": "src/main/index.js",
```

- [ ] **Step 6 : Vérifier le critère d'acceptation**

```bash
env -u ELECTRON_RUN_AS_NODE pnpm start
```

Attendu : démarrage, connexion (toujours par Puppeteer à ce stade), `/Accueil`, badge à jour. Aucun changement visible.

- [ ] **Step 7 : Commit**

```bash
git add -A
git commit -m "refactor: réorganisation de l'arborescence vers src/"
```

---

## Task 3 : Client API et payloads de session

Première tâche avec des tests. Tout ce qui est écrit ici est pur ou injectable, donc testable sans Electron ni réseau.

**Files:**
- Create: `src/main/auth/ed-api.js`, `src/main/auth/session-payload.js`, `src/main/auth/credentials-store.js`
- Create: `test/session-payload.test.js`, `test/ed-api.test.js`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: rien
- Produces:
  - `createEdApi({ fetchImpl, readGtkCookie, apiVersion, userAgent })` → `{ login, relogin, get2faQuestion, send2faAnswer }`
    - `login({ identifiant, motdepasse, uuid, fa })` → `{ code, token, message, data, twoFaToken }`
    - `get2faQuestion(twoFaToken)` → `{ question, propositions }` (déjà décodés)
    - `send2faAnswer(choix, twoFaToken)` → `{ cn, cv }`
  - `buildSessionState(loginResponse, now)` → `{ authToken, accounts, changementMDP, nbJourMdpExire, isBloque, urlUnblock, lastModified }`
  - `toSessionStorageEntries(state)` → `{ credentials: string, accounts: string }`
  - `toLocalStorageEntries(faKeys)` → `{ fa: string }`
  - `messagerieBadgeCount(state)` → `number`
  - `createCredentialsStore(filePath, safeStorage)` → `{ read, writeCredentials, ensureDeviceUuid, saveFaKeys, clearFaKeys }`

- [ ] **Step 1 : Ajouter le script de test**

Dans `package.json`, section `scripts` :

```json
"test": "node --test test/",
```

- [ ] **Step 2 : Écrire les tests de `session-payload`**

```js
// test/session-payload.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSessionState,
  toSessionStorageEntries,
  toLocalStorageEntries,
  messagerieBadgeCount,
} = require("../src/main/auth/session-payload");

const LOGIN_RESPONSE = {
  code: 200,
  token: "TOKEN123",
  message: "",
  data: {
    accounts: [
      {
        idLogin: 1324, id: 1234, identifiant: "jdoe", typeCompte: "E",
        main: true, prenom: "John", nom: "DOE",
        modules: [
          { code: "MESSAGERIE", badge: 3 },
          { code: "NOTES", badge: 0 },
        ],
      },
    ],
  },
};

test("buildSessionState extrait le token et les comptes", () => {
  const state = buildSessionState(LOGIN_RESPONSE, 1000);
  assert.equal(state.authToken, "TOKEN123");
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].identifiant, "jdoe");
  assert.equal(state.lastModified, 1000);
});

test("buildSessionState applique les valeurs par defaut du SPA", () => {
  const state = buildSessionState(LOGIN_RESPONSE, 1000);
  assert.equal(state.changementMDP, false);
  assert.equal(state.nbJourMdpExire, 0);
  assert.equal(state.isBloque, false);
  assert.equal(state.urlUnblock, "");
});

test("toSessionStorageEntries produit l'enveloppe payload/lastModified", () => {
  const entries = toSessionStorageEntries(buildSessionState(LOGIN_RESPONSE, 1000));
  const credentials = JSON.parse(entries.credentials);
  assert.deepEqual(credentials, {
    payload: { authToken: "TOKEN123", fcmToken: "", twoFAToken: "" },
    lastModified: 1000,
  });
  const accounts = JSON.parse(entries.accounts);
  assert.equal(accounts.lastModified, 1000);
  assert.equal(accounts.payload.accounts[0].id, 1234);
  assert.equal(accounts.payload.changementMDP, false);
});

test("toSessionStorageEntries n'ecrit jamais edcommonhydration_auth", () => {
  const entries = toSessionStorageEntries(buildSessionState(LOGIN_RESPONSE, 1000));
  assert.deepEqual(Object.keys(entries).sort(), ["accounts", "credentials"]);
});

test("toLocalStorageEntries serialise les cles 2FA", () => {
  const entries = toLocalStorageEntries([{ cn: "a", cv: "b", uniq: false }]);
  assert.deepEqual(JSON.parse(entries.fa), [{ cn: "a", cv: "b", uniq: false }]);
});

test("toLocalStorageEntries renvoie un objet vide sans cles", () => {
  assert.deepEqual(toLocalStorageEntries([]), {});
});

test("messagerieBadgeCount lit le module MESSAGERIE", () => {
  assert.equal(messagerieBadgeCount(buildSessionState(LOGIN_RESPONSE, 1000)), 3);
});

test("messagerieBadgeCount vaut 0 sans module MESSAGERIE", () => {
  const state = buildSessionState({ token: "T", data: { accounts: [{ modules: [] }] } }, 1);
  assert.equal(messagerieBadgeCount(state), 0);
});
```

- [ ] **Step 3 : Lancer les tests pour vérifier qu'ils échouent**

```bash
pnpm test
```

Attendu : ÉCHEC, `Cannot find module '../src/main/auth/session-payload'`.

- [ ] **Step 4 : Implémenter `session-payload.js`**

```js
// src/main/auth/session-payload.js
// Formes reverse-engineerées du SPA ÉcoleDirecte, cf. le spec.
// AuthStore  -> sessionStorage["accounts"]
// CredentialsStore -> sessionStorage["credentials"]

function buildSessionState(loginResponse, now) {
  const data = loginResponse.data || {};
  return {
    authToken: loginResponse.token || "",
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    changementMDP: data.changementMDP !== undefined ? data.changementMDP : false,
    nbJourMdpExire: data.nbJourMdpExire !== undefined ? data.nbJourMdpExire : 0,
    isBloque: data.isBloque !== undefined ? data.isBloque : false,
    urlUnblock: data.urlUnblock !== undefined ? data.urlUnblock : "",
    lastModified: now,
  };
}

function toSessionStorageEntries(state) {
  return {
    credentials: JSON.stringify({
      payload: { authToken: state.authToken, fcmToken: "", twoFAToken: "" },
      lastModified: state.lastModified,
    }),
    accounts: JSON.stringify({
      payload: {
        accounts: state.accounts,
        changementMDP: state.changementMDP,
        nbJourMdpExire: state.nbJourMdpExire,
        isBloque: state.isBloque,
        urlUnblock: state.urlUnblock,
      },
      lastModified: state.lastModified,
    }),
  };
}

function toLocalStorageEntries(faKeys) {
  if (!Array.isArray(faKeys) || faKeys.length === 0) return {};
  return { fa: JSON.stringify(faKeys) };
}

function messagerieBadgeCount(state) {
  const account = (state.accounts || []).find((a) => a.current) || state.accounts[0];
  if (!account || !Array.isArray(account.modules)) return 0;
  const mod = account.modules.find((m) => m.code === "MESSAGERIE");
  return mod && typeof mod.badge === "number" ? mod.badge : 0;
}

module.exports = {
  buildSessionState,
  toSessionStorageEntries,
  toLocalStorageEntries,
  messagerieBadgeCount,
};
```

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm test
```

Attendu : 8 tests passants.

- [ ] **Step 6 : Écrire les tests de `ed-api`**

```js
// test/ed-api.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEdApi } = require("../src/main/auth/ed-api");

function makeApi(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (next.headers || {})[name.toLowerCase()] ?? null },
      json: async () => next.body,
    };
  };
  const api = createEdApi({
    fetchImpl,
    readGtkCookie: async () => "GTKVALUE",
    apiVersion: "4.101.2",
    userAgent: "UA",
  });
  return { api, calls };
}

test("login appelle gtk puis login et transmet X-Gtk", async () => {
  const { api, calls } = makeApi([
    { body: {} },
    { body: { code: 200, token: "T", data: { accounts: [] } } },
  ]);
  await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1" });

  assert.match(calls[0].url, /login\.awp\?gtk=1/);
  assert.match(calls[1].url, /v=4\.101\.2/);
  assert.equal(calls[1].init.headers["X-Gtk"], "GTKVALUE");
});

test("login encode le corps en data= urlencode", async () => {
  const { api, calls } = makeApi([
    { body: {} },
    { body: { code: 200, token: "T", data: { accounts: [] } } },
  ]);
  await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1" });

  const params = new URLSearchParams(calls[1].init.body);
  const payload = JSON.parse(params.get("data"));
  assert.equal(payload.identifiant, "u");
  assert.equal(payload.motdepasse, "p");
  assert.equal(payload.isReLogin, false);
  assert.equal(payload.uuid, "U1");
});

test("login joint les cles fa quand elles existent", async () => {
  const { api, calls } = makeApi([
    { body: {} },
    { body: { code: 200, token: "T", data: { accounts: [] } } },
  ]);
  await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1", fa: [{ cn: "c", cv: "v" }] });

  const payload = JSON.parse(new URLSearchParams(calls[1].init.body).get("data"));
  assert.deepEqual(payload.fa, [{ cn: "c", cv: "v" }]);
});

test("login remonte le code 250 et le token 2FA de l'entete", async () => {
  const { api } = makeApi([
    { body: {} },
    { body: { code: 250, token: "", data: {} }, headers: { "x-token": "TWOFA" } },
  ]);
  const res = await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1" });
  assert.equal(res.code, 250);
  assert.equal(res.twoFaToken, "TWOFA");
});

test("login remonte le code 505 sans lever d'exception", async () => {
  const { api } = makeApi([
    { body: {} },
    { body: { code: 505, token: "", message: "Mot de passe invalide !", data: {} } },
  ]);
  const res = await api.login({ identifiant: "u", motdepasse: "bad", uuid: "U1" });
  assert.equal(res.code, 505);
  assert.equal(res.message, "Mot de passe invalide !");
});

test("get2faQuestion decode le base64", async () => {
  const { api } = makeApi([
    {
      body: {
        code: 200,
        data: {
          question: Buffer.from("Question ?").toString("base64"),
          propositions: [Buffer.from("Oui").toString("base64")],
        },
      },
    },
  ]);
  const res = await api.get2faQuestion("TWOFA");
  assert.equal(res.question, "Question ?");
  assert.deepEqual(res.propositions, ["Oui"]);
});

test("send2faAnswer encode le choix en base64 et renvoie cn/cv", async () => {
  const { api, calls } = makeApi([{ body: { code: 200, data: { cn: "C", cv: "V" } } }]);
  const res = await api.send2faAnswer("Oui", "TWOFA");

  const payload = JSON.parse(new URLSearchParams(calls[0].init.body).get("data"));
  assert.equal(payload.choix, Buffer.from("Oui").toString("base64"));
  assert.deepEqual(res, { cn: "C", cv: "V" });
});
```

- [ ] **Step 7 : Lancer les tests pour vérifier qu'ils échouent**

```bash
pnpm test
```

Attendu : ÉCHEC, `Cannot find module '../src/main/auth/ed-api'`.

- [ ] **Step 8 : Implémenter `ed-api.js`**

```js
// src/main/auth/ed-api.js
const BASE_URL = "https://api.ecoledirecte.com";
const DEFAULT_API_VERSION = "4.101.2";

const decodeB64 = (v) => Buffer.from(String(v || ""), "base64").toString("utf8");
const encodeB64 = (v) => Buffer.from(String(v || ""), "utf8").toString("base64");

function createEdApi({ fetchImpl, readGtkCookie, apiVersion = DEFAULT_API_VERSION, userAgent }) {
  function body(payload) {
    return new URLSearchParams({ data: JSON.stringify(payload) }).toString();
  }

  async function post(path, payload, extraHeaders = {}) {
    const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}v=${apiVersion}`;
    const res = await fetchImpl(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
        ...extraHeaders,
      },
      body: body(payload),
    });
    const json = await res.json();
    return { json, headers: res.headers };
  }

  async function login({ identifiant, motdepasse, uuid, fa }) {
    // 1. Le GTK est obligatoire depuis le 24/03/2025 : sans lui l'API
    //    repond "identifiants invalides" meme avec un mot de passe correct.
    await fetchImpl(`${BASE_URL}/v3/login.awp?gtk=1&v=${apiVersion}`, {
      method: "GET",
      credentials: "include",
      headers: { "User-Agent": userAgent },
    });
    const gtk = await readGtkCookie();

    const payload = { identifiant, motdepasse, isReLogin: false, uuid: uuid || "" };
    if (Array.isArray(fa) && fa.length > 0) payload.fa = fa;

    const { json, headers } = await post("/v3/login.awp", payload, gtk ? { "X-Gtk": gtk } : {});
    return {
      code: json.code,
      token: json.token || "",
      message: json.message || "",
      data: json.data || {},
      twoFaToken: headers.get("x-token") || headers.get("2fa-token") || "",
    };
  }

  async function relogin({ identifiant, uuid, typeCompte, accesstoken, fa }) {
    const payload = {
      identifiant, uuid: uuid || "", isReLogin: true,
      motdepasse: "", typeCompte, accesstoken,
    };
    if (Array.isArray(fa) && fa.length > 0) payload.fa = fa;

    const { json, headers } = await post("/v3/login.awp", payload);
    return {
      code: json.code,
      token: json.token || "",
      message: json.message || "",
      data: json.data || {},
      twoFaToken: headers.get("x-token") || headers.get("2fa-token") || "",
    };
  }

  async function get2faQuestion(twoFaToken) {
    const { json } = await post("/v3/connexion/doubleauth.awp?verbe=get", {}, { "X-Token": twoFaToken });
    const data = json.data || {};
    return {
      code: json.code,
      question: decodeB64(data.question),
      propositions: (data.propositions || []).map(decodeB64),
    };
  }

  async function send2faAnswer(choix, twoFaToken) {
    const { json } = await post(
      "/v3/connexion/doubleauth.awp?verbe=post",
      { choix: encodeB64(choix) },
      { "X-Token": twoFaToken }
    );
    const data = json.data || {};
    return { cn: data.cn, cv: data.cv };
  }

  return { login, relogin, get2faQuestion, send2faAnswer };
}

module.exports = { createEdApi, BASE_URL, DEFAULT_API_VERSION };
```

- [ ] **Step 9 : Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm test
```

Attendu : 15 tests passants.

- [ ] **Step 10 : Implémenter `credentials-store.js`**

Le fichier de production existant ne contient que `{ username, password }`. La lecture doit rester tolérante aux champs absents, sinon on casse les installations en place.

```js
// src/main/auth/credentials-store.js
const fs = require("fs");
const crypto = require("crypto");

function createCredentialsStore(filePath, safeStorage) {
  const enc = (v) => safeStorage.encryptString(v).toString("base64");
  const dec = (v) => safeStorage.decryptString(Buffer.from(v, "base64"));

  function readRaw() {
    try {
      if (!fs.existsSync(filePath)) return {};
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      console.error("Erreur lecture credentials :", err.message);
      return {};
    }
  }

  function writeRaw(next) {
    fs.writeFileSync(filePath, JSON.stringify(next));
  }

  function read() {
    const raw = readRaw();
    if (!safeStorage.isEncryptionAvailable()) {
      return { username: null, password: null, deviceUuid: null, faKeys: [] };
    }
    const safe = (v, fallback) => { try { return v ? dec(v) : fallback; } catch { return fallback; } };
    let faKeys = [];
    try { faKeys = raw.faKeys ? JSON.parse(dec(raw.faKeys)) : []; } catch { faKeys = []; }
    return {
      username: safe(raw.username, null),
      password: safe(raw.password, null),
      deviceUuid: safe(raw.deviceUuid, null),
      faKeys: Array.isArray(faKeys) ? faKeys : [],
    };
  }

  function writeCredentials(username, password) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error("Le chiffrement n'est pas disponible.");
      return;
    }
    writeRaw({ ...readRaw(), username: enc(username), password: enc(password) });
  }

  function ensureDeviceUuid() {
    const current = read().deviceUuid;
    if (current) return current;
    const uuid = crypto.randomUUID();
    if (safeStorage.isEncryptionAvailable()) {
      writeRaw({ ...readRaw(), deviceUuid: enc(uuid) });
    }
    return uuid;
  }

  function saveFaKeys(faKeys) {
    if (!safeStorage.isEncryptionAvailable()) return;
    writeRaw({ ...readRaw(), faKeys: enc(JSON.stringify(faKeys)) });
  }

  function clearFaKeys() {
    const raw = readRaw();
    delete raw.faKeys;
    writeRaw(raw);
  }

  return { read, writeCredentials, ensureDeviceUuid, saveFaKeys, clearFaKeys };
}

module.exports = { createCredentialsStore };
```

- [ ] **Step 11 : Vérifier le critère d'acceptation**

Rien n'est encore branché — l'application tourne toujours sur Puppeteer.

```bash
pnpm test && env -u ELECTRON_RUN_AS_NODE pnpm start
```

Attendu : tests verts, démarrage, connexion, badge à jour.

- [ ] **Step 12 : Commit**

```bash
git add src/main/auth test package.json
git commit -m "feat: client API ÉcoleDirecte + construction des payloads de session"
```

---

## Task 4 : Preload d'amorçage de session

**Files:**
- Create: `src/preload/ed-session.js`
- Modify: `src/main/windows/main-window.js` (option `preload`)
- Modify: `src/main/index.js` (handler IPC `ed:session-seed`)

**Interfaces:**
- Consumes: `toSessionStorageEntries(state)`, `toLocalStorageEntries(faKeys)` de la Task 3
- Produces: canal IPC synchrone `ed:session-seed` → `{ session: {credentials, accounts}, local: {fa?} }` ou `null`

- [ ] **Step 1 : Écrire le preload**

La décision d'amorcer appartient au preload : il est le seul à connaître à la fois l'URL et l'état du `sessionStorage`.

```js
// src/preload/ed-session.js
// S'execute a document-start, avant le boot d'Angular. Valide par spike :
// un preload sandbox + contextIsolation ecrit bien dans le storage lu par la page.
const { ipcRenderer } = require("electron");

try {
  const isLoginUrl = location.pathname.toLowerCase().startsWith("/login");
  const hasSession = sessionStorage.getItem("credentials") !== null;

  // On n'ecrase pas une session en cours d'utilisation : elle peut etre
  // plus fraiche que celle detenue par le processus principal.
  if (isLoginUrl || !hasSession) {
    const seed = ipcRenderer.sendSync("ed:session-seed");
    if (seed) {
      for (const [key, value] of Object.entries(seed.session || {})) {
        sessionStorage.setItem(key, value);
      }
      for (const [key, value] of Object.entries(seed.local || {})) {
        localStorage.setItem(key, value);
      }
    }
  }
} catch (err) {
  // Un preload qui leve empeche la page de se charger : on degrade
  // silencieusement vers le formulaire de login normal.
  console.error("[ed-session] amorcage impossible :", err && err.message);
}
```

- [ ] **Step 2 : Brancher le preload sur la fenêtre principale**

Dans `src/main/windows/main-window.js`, ajouter à `webPreferences` (sans toucher à `sandbox: true` ni `contextIsolation: true`) :

```js
preload: path.join(__dirname, "../../preload/ed-session.js"),
```

- [ ] **Step 3 : Exposer la session via IPC dans `src/main/index.js`**

```js
let currentSessionSeed = null;

function setSessionSeed(state, faKeys) {
  currentSessionSeed = state
    ? { session: toSessionStorageEntries(state), local: toLocalStorageEntries(faKeys) }
    : null;
}

ipcMain.on("ed:session-seed", (event) => {
  event.returnValue = currentSessionSeed;
});
```

- [ ] **Step 4 : Vérifier que le preload s'exécute au bon moment**

Lancer l'app, puis dans la console DevTools de la fenêtre principale (F12) :

```js
Object.keys(sessionStorage)
```

Attendu à ce stade : `["edcommonhydration_auth"]` et éventuellement `credentials`/`accounts` posés par le SPA lui-même après le login Puppeteer. Aucune erreur `[ed-session]` dans la console.

- [ ] **Step 5 : Vérifier le critère d'acceptation**

```bash
env -u ELECTRON_RUN_AS_NODE pnpm start
```

Attendu : démarrage, connexion Puppeteer inchangée, badge à jour. Le preload est branché mais `currentSessionSeed` vaut encore `null`.

- [ ] **Step 6 : Commit**

```bash
git add src/preload src/main
git commit -m "feat: preload d'amorçage de session"
```

---

## Task 5 : Flux d'authentification headless

C'est la tâche qui remplace effectivement Puppeteer.

**Files:**
- Create: `src/main/auth/auth-flow.js`, `src/main/auth/relogin-guard.js`
- Create: `src/main/windows/twofa-window.js`, `src/renderer/twofa/twofa.html`
- Create: `test/auth-flow.test.js`, `test/relogin-guard.test.js`
- Create: `scripts/diag-auth.js`
- Modify: `src/main/index.js`

**Interfaces:**
- Consumes: `createEdApi`, `createCredentialsStore`, `buildSessionState`, `messagerieBadgeCount`
- Produces:
  - `createAuthFlow({ edApi, credentialsStore, now })` → `{ authenticate(), submit2faAnswer(answer) }`
    - états retournés : `{ status: "ok", state }` | `{ status: "needs2fa", question, propositions }` | `{ status: "failed", code, message }`
  - `createReloginGuard({ maxAttempts, delays })` → `{ shouldRetry(), nextDelay(), recordAttempt(), reset() }`

- [ ] **Step 1 : Écrire les tests de `relogin-guard`**

```js
// test/relogin-guard.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createReloginGuard } = require("../src/main/auth/relogin-guard");

test("autorise jusqu'a maxAttempts tentatives", () => {
  const guard = createReloginGuard({ maxAttempts: 3, delays: [2000, 4000, 8000] });
  for (let i = 0; i < 3; i++) {
    assert.equal(guard.shouldRetry(), true);
    guard.recordAttempt();
  }
  assert.equal(guard.shouldRetry(), false);
});

test("applique un backoff croissant", () => {
  const guard = createReloginGuard({ maxAttempts: 3, delays: [2000, 4000, 8000] });
  assert.equal(guard.nextDelay(), 2000);
  guard.recordAttempt();
  assert.equal(guard.nextDelay(), 4000);
  guard.recordAttempt();
  assert.equal(guard.nextDelay(), 8000);
});

test("reset relance le compteur apres un succes", () => {
  const guard = createReloginGuard({ maxAttempts: 3, delays: [2000, 4000, 8000] });
  guard.recordAttempt(); guard.recordAttempt(); guard.recordAttempt();
  assert.equal(guard.shouldRetry(), false);
  guard.reset();
  assert.equal(guard.shouldRetry(), true);
  assert.equal(guard.nextDelay(), 2000);
});

test("le dernier delai est reutilise au-dela du tableau", () => {
  const guard = createReloginGuard({ maxAttempts: 5, delays: [2000, 4000] });
  guard.recordAttempt(); guard.recordAttempt(); guard.recordAttempt();
  assert.equal(guard.nextDelay(), 4000);
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
pnpm test
```

Attendu : ÉCHEC, `Cannot find module '../src/main/auth/relogin-guard'`.

- [ ] **Step 3 : Implémenter `relogin-guard.js`**

```js
// src/main/auth/relogin-guard.js
function createReloginGuard({ maxAttempts = 3, delays = [2000, 4000, 8000] } = {}) {
  let attempts = 0;
  return {
    shouldRetry: () => attempts < maxAttempts,
    nextDelay: () => delays[Math.min(attempts, delays.length - 1)],
    recordAttempt: () => { attempts += 1; },
    reset: () => { attempts = 0; },
    get attempts() { return attempts; },
  };
}

module.exports = { createReloginGuard };
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm test
```

Attendu : 4 tests de `relogin-guard` passants.

- [ ] **Step 5 : Écrire les tests de `auth-flow`**

```js
// test/auth-flow.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthFlow } = require("../src/main/auth/auth-flow");

function makeStore(initial = {}) {
  let data = { username: "u", password: "p", deviceUuid: "U1", faKeys: [], ...initial };
  return {
    read: () => data,
    writeCredentials: (username, password) => { data = { ...data, username, password }; },
    ensureDeviceUuid: () => data.deviceUuid,
    saveFaKeys: (faKeys) => { data = { ...data, faKeys }; },
    clearFaKeys: () => { data = { ...data, faKeys: [] }; },
  };
}

const OK = { code: 200, token: "T", data: { accounts: [{ id: 1 }] }, message: "" };

test("authenticate renvoie ok et l'etat de session", async () => {
  const flow = createAuthFlow({
    edApi: { login: async () => OK },
    credentialsStore: makeStore(),
    now: () => 1000,
  });
  const res = await flow.authenticate();
  assert.equal(res.status, "ok");
  assert.equal(res.state.authToken, "T");
  assert.equal(res.state.lastModified, 1000);
});

test("authenticate renvoie failed sur 505 sans lever", async () => {
  const flow = createAuthFlow({
    edApi: { login: async () => ({ code: 505, message: "Mot de passe invalide !", data: {} }) },
    credentialsStore: makeStore(),
    now: () => 1000,
  });
  const res = await flow.authenticate();
  assert.equal(res.status, "failed");
  assert.equal(res.code, 505);
});

test("authenticate renvoie needs2fa et n'ouvre aucune fenetre", async () => {
  const flow = createAuthFlow({
    edApi: {
      login: async () => ({ code: 250, twoFaToken: "TF", data: {} }),
      get2faQuestion: async () => ({ question: "Q ?", propositions: ["A", "B"] }),
    },
    credentialsStore: makeStore(),
    now: () => 1000,
  });
  const res = await flow.authenticate();
  assert.equal(res.status, "needs2fa");
  assert.equal(res.question, "Q ?");
  assert.deepEqual(res.propositions, ["A", "B"]);
});

test("un 250 malgre des cles fa purge les cles et redemande la 2FA", async () => {
  const store = makeStore({ faKeys: [{ cn: "vieux", cv: "mort" }] });
  let sentFa = null;
  const flow = createAuthFlow({
    edApi: {
      login: async ({ fa }) => { sentFa = fa; return { code: 250, twoFaToken: "TF", data: {} }; },
      get2faQuestion: async () => ({ question: "Q ?", propositions: ["A"] }),
    },
    credentialsStore: store,
    now: () => 1000,
  });

  const res = await flow.authenticate();
  assert.deepEqual(sentFa, [{ cn: "vieux", cv: "mort" }]);
  assert.equal(res.status, "needs2fa");
  assert.deepEqual(store.read().faKeys, [], "les cles mortes doivent etre purgees");
});

test("submit2faAnswer persiste cn/cv et rejoue le login", async () => {
  const store = makeStore();
  let secondLoginFa = null;
  let loginCount = 0;
  const flow = createAuthFlow({
    edApi: {
      login: async ({ fa }) => {
        loginCount += 1;
        if (loginCount === 1) return { code: 250, twoFaToken: "TF", data: {} };
        secondLoginFa = fa;
        return OK;
      },
      get2faQuestion: async () => ({ question: "Q ?", propositions: ["A"] }),
      send2faAnswer: async () => ({ cn: "C", cv: "V" }),
    },
    credentialsStore: store,
    now: () => 1000,
  });

  await flow.authenticate();
  const res = await flow.submit2faAnswer("A");

  assert.equal(res.status, "ok");
  assert.deepEqual(secondLoginFa, [{ cn: "C", cv: "V", uniq: false }]);
  assert.deepEqual(store.read().faKeys, [{ cn: "C", cv: "V", uniq: false }]);
});

test("authenticate renvoie failed si aucun identifiant n'est enregistre", async () => {
  const flow = createAuthFlow({
    edApi: { login: async () => OK },
    credentialsStore: makeStore({ username: null, password: null }),
    now: () => 1000,
  });
  const res = await flow.authenticate();
  assert.equal(res.status, "failed");
  assert.equal(res.code, "NO_CREDENTIALS");
});
```

- [ ] **Step 6 : Lancer les tests pour vérifier qu'ils échouent**

```bash
pnpm test
```

Attendu : ÉCHEC, `Cannot find module '../src/main/auth/auth-flow'`.

- [ ] **Step 7 : Implémenter `auth-flow.js`**

```js
// src/main/auth/auth-flow.js
const { buildSessionState } = require("./session-payload");

function createAuthFlow({ edApi, credentialsStore, now = Date.now }) {
  let pendingTwoFaToken = null;

  async function runLogin(faKeys) {
    const { username, password } = credentialsStore.read();
    const uuid = credentialsStore.ensureDeviceUuid();
    return edApi.login({ identifiant: username, motdepasse: password, uuid, fa: faKeys });
  }

  async function toState(res) {
    return { status: "ok", state: buildSessionState(res, now()) };
  }

  async function handle250(res, hadFaKeys) {
    // Un 250 alors qu'on a envoye des cles signifie que le couple cn/cv est
    // mort : le garder ferait boucler indefiniment sur des cles invalides.
    if (hadFaKeys) credentialsStore.clearFaKeys();

    pendingTwoFaToken = res.twoFaToken;
    const question = await edApi.get2faQuestion(pendingTwoFaToken);
    return {
      status: "needs2fa",
      question: question.question,
      propositions: question.propositions,
    };
  }

  async function authenticate() {
    const { username, password, faKeys } = credentialsStore.read();
    if (!username || !password) {
      return { status: "failed", code: "NO_CREDENTIALS", message: "Aucun identifiant enregistré." };
    }

    const res = await runLogin(faKeys);
    if (res.code === 250) return handle250(res, Array.isArray(faKeys) && faKeys.length > 0);
    if (res.code !== 200) {
      return { status: "failed", code: res.code, message: res.message || "Connexion refusée." };
    }
    return toState(res);
  }

  async function submit2faAnswer(answer) {
    if (!pendingTwoFaToken) {
      return { status: "failed", code: "NO_2FA_PENDING", message: "Aucune 2FA en attente." };
    }
    const { cn, cv } = await edApi.send2faAnswer(answer, pendingTwoFaToken);
    if (!cn || !cv) {
      return { status: "failed", code: "BAD_2FA_ANSWER", message: "Réponse incorrecte." };
    }

    const faKeys = [{ cn, cv, uniq: false }];
    credentialsStore.saveFaKeys(faKeys);
    pendingTwoFaToken = null;

    const res = await runLogin(faKeys);
    if (res.code !== 200) {
      return { status: "failed", code: res.code, message: res.message || "Connexion refusée." };
    }
    return toState(res);
  }

  return { authenticate, submit2faAnswer };
}

module.exports = { createAuthFlow };
```

- [ ] **Step 8 : Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm test
```

Attendu : 6 tests de `auth-flow` passants, 25 au total.

- [ ] **Step 9 : Créer la fenêtre 2FA**

`src/renderer/twofa/twofa.html` — même style que `login.html` (Tailwind CDN, `nodeIntegration`) :

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Double authentification</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 flex items-center justify-center min-h-screen">
  <div class="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
    <h2 class="text-2xl font-bold text-gray-800 mb-4 text-center">Double authentification</h2>
    <p id="question" class="text-gray-700 text-center mb-6"></p>
    <div id="propositions" class="space-y-2"></div>
  </div>
  <script>
    const { ipcRenderer } = require("electron");
    ipcRenderer.on("twofa-question", (event, { question, propositions }) => {
      document.getElementById("question").textContent = question;
      const container = document.getElementById("propositions");
      container.innerHTML = "";
      propositions.forEach((proposition) => {
        const button = document.createElement("button");
        button.textContent = proposition;
        button.className =
          "w-full bg-indigo-600 text-white font-semibold py-2 rounded-lg shadow hover:bg-indigo-500 transition";
        button.addEventListener("click", () => {
          container.querySelectorAll("button").forEach((b) => (b.disabled = true));
          ipcRenderer.send("twofa-answer", proposition);
        });
        container.appendChild(button);
      });
    });
  </script>
</body>
</html>
```

`src/main/windows/twofa-window.js` calque `login-window.js` : `width: 480, height: 420, modal: true`, `nodeIntegration: true`, `contextIsolation: false`, puis `loadFile(path.join(__dirname, "../../renderer/twofa/twofa.html"))`.

- [ ] **Step 10 : Câbler le flux dans `src/main/index.js`**

`index.js` est le seul à décider ce qui s'affiche.

```js
async function ensureAuthenticated(mainWindow) {
  let result = await authFlow.authenticate();

  if (result.status === "failed" && result.code === "NO_CREDENTIALS") {
    await promptCredentials(mainWindow);      // fenetre de login existante
    result = await authFlow.authenticate();
  }

  if (result.status === "needs2fa") {
    const answer = await promptTwoFa(mainWindow, result);  // fenetre 2FA
    result = await authFlow.submit2faAnswer(answer);
  }

  if (result.status === "ok") {
    setSessionSeed(result.state, credentialsStore.read().faKeys);
    reloginGuard.reset();
    return result.state;
  }

  console.error(`Authentification échouée (code ${result.code}) : ${result.message}`);
  setSessionSeed(null, []);
  showAuthBanner(mainWindow, result);
  return null;
}
```

Le re-login sur redirection, avec la garde :

```js
mainWindow.webContents.on("did-navigate", async (event, navUrl) => {
  if (!navUrl.includes("/login")) return;
  if (!reloginGuard.shouldRetry()) {
    showAuthBanner(mainWindow, { code: "MAX_RETRIES", message: "Reconnexion automatique abandonnée." });
    return;
  }
  const delay = reloginGuard.nextDelay();
  reloginGuard.recordAttempt();
  console.log(`Redirection login détectée, nouvelle tentative dans ${delay} ms`);
  await new Promise((resolve) => setTimeout(resolve, delay));
  const state = await ensureAuthenticated(mainWindow);
  if (state) await mainWindow.loadURL("https://www.ecoledirecte.com/Accueil");
});
```

Le bandeau d'avertissement, non bloquant — le formulaire ED reste utilisable en dessous :

```js
function showAuthBanner(mainWindow, result) {
  if (mainWindow.isDestroyed()) return;
  const message = `Connexion automatique impossible (code ${result.code}). Connectez-vous manuellement.`;
  mainWindow.webContents.executeJavaScript(`
    (() => {
      let banner = document.getElementById('ed-auth-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'ed-auth-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#7a2233;color:#ffd9e0;padding:8px 16px;font-size:13px;z-index:99999;font-family:Segoe UI,sans-serif;text-align:center;';
        document.body.appendChild(banner);
      }
      banner.textContent = ${JSON.stringify(message)};
    })()
  `).catch(() => {});
}
```

Le badge démarre sur le `webContents` de la fenêtre principale, et la valeur initiale vient de l'API :

```js
startBadgePolling(mainWindow.webContents, mainWindow);
```

- [ ] **Step 11 : Écrire `scripts/diag-auth.js`**

Diagnostic caviardé : longueurs et codes uniquement, jamais de secret.

```js
// scripts/diag-auth.js — lancer avec :
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-auth.js
const { app, session, safeStorage } = require("electron");
const path = require("path");
const { createEdApi } = require("../src/main/auth/ed-api");
const { createCredentialsStore } = require("../src/main/auth/credentials-store");
const { createAuthFlow } = require("../src/main/auth/auth-flow");

const redact = (v) => (v ? `<${String(v).length} caracteres>` : "<vide>");

app.whenReady().then(async () => {
  const store = createCredentialsStore(
    path.join(app.getPath("userData"), "credentials.json"),
    safeStorage
  );
  const creds = store.read();
  console.log("identifiant :", creds.username ? "present" : "ABSENT");
  console.log("mot de passe :", redact(creds.password));
  console.log("deviceUuid  :", creds.deviceUuid ? "present" : "sera genere");
  console.log("cles fa     :", creds.faKeys.length);

  const edApi = createEdApi({
    fetchImpl: (url, init) => session.defaultSession.fetch(url, init),
    readGtkCookie: async () => {
      const cookies = await session.defaultSession.cookies.get({ name: "GTK" });
      return cookies.length > 0 ? cookies[0].value : "";
    },
    userAgent: session.defaultSession.getUserAgent(),
  });

  const flow = createAuthFlow({ edApi, credentialsStore: store });
  const result = await flow.authenticate();

  console.log("statut :", result.status);
  if (result.status === "ok") {
    console.log("token  :", redact(result.state.authToken));
    console.log("comptes:", result.state.accounts.length);
  } else if (result.status === "needs2fa") {
    console.log("question :", result.question);
    console.log("choix    :", result.propositions.length);
  } else {
    console.log("code :", result.code, "message :", result.message);
  }
  app.quit();
});
```

- [ ] **Step 12 : Lancer le diagnostic sur le vrai compte**

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-auth.js
```

Attendu : `statut : ok` avec un token non vide et au moins un compte. En cas de `needs2fa`, la question s'affiche — c'est le comportement normal au premier lancement.

- [ ] **Step 13 : Retirer l'appel Puppeteer du démarrage**

Dans `src/main/index.js`, remplacer la séquence `pie.getPage` / `page.type` / `page.click` / `waitForNavigation` / `setupReloginWatcher` par `await ensureAuthenticated(mainWindow)` **avant** `mainWindow.loadURL("https://www.ecoledirecte.com/Accueil")`. Supprimer `setupReloginWatcher` et `performRelogin`.

- [ ] **Step 14 : Vérifier le critère d'acceptation — le vrai test**

```bash
pnpm test && env -u ELECTRON_RUN_AS_NODE pnpm start
```

Attendu : l'application démarre, **aucune page de login n'apparaît**, `/Accueil` s'affiche directement, le badge se met à jour. Vérifier dans DevTools que `sessionStorage.credentials` contient bien un `authToken`.

- [ ] **Step 15 : Commit**

```bash
git add -A
git commit -m "feat: flux d'auth headless, 2FA, re-login avec garde"
```

---

## Task 6 : Suppression de Puppeteer

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/main/index.js` (imports résiduels)

- [ ] **Step 1 : Rejouer le grep sur tous les fichiers suivis**

Le spec impose de vérifier au-delà d'`index.js`.

```bash
git ls-files | xargs grep -n "puppeteer\|pie\." 2>/dev/null | grep -v pnpm-lock
```

Attendu : plus aucune occurrence hors `package.json`. Toute occurrence résiduelle doit être supprimée avant de continuer.

- [ ] **Step 2 : Retirer les dépendances**

```bash
pnpm remove puppeteer-core puppeteer-in-electron
```

- [ ] **Step 3 : Vérifier qu'il ne reste rien**

```bash
git ls-files | xargs grep -n "puppeteer" 2>/dev/null | grep -v pnpm-lock
```

Attendu : aucune sortie.

- [ ] **Step 4 : Vérifier le critère d'acceptation**

```bash
pnpm test && env -u ELECTRON_RUN_AS_NODE pnpm start
```

Attendu : tests verts, démarrage, connexion, `/Accueil`, badge à jour.

- [ ] **Step 5 : Vérifier le packaging une dernière fois**

```bash
env -u ELECTRON_RUN_AS_NODE pnpm run build --win
ls dist/win-unpacked/resources/extension/manifest.json
```

Attendu : l'installeur se construit et l'extension patchée est présente.

- [ ] **Step 6 : Commit**

```bash
git add package.json pnpm-lock.yaml src/
git commit -m "chore: suppression de puppeteer"
```

---

## Auto-revue

**Couverture du spec.** Persistance de session → Tasks 3 et 4. Flux de login et GTK → Task 3. 2FA, purge des clés mortes → Tasks 3 et 5. Badge → Task 2 (portage `executeJavaScript`) et Task 3 (`messagerieBadgeCount`). Identifiant d'appareil → Task 3 (`ensureDeviceUuid`). Preload conditionnel → Task 4. Garde anti-boucle → Task 5. Bandeau + repli sur le formulaire → Task 5. Migration du patch d'extension, `extraResources`, idempotence → Task 1. Nettoyage Puppeteer → Task 6. Aucune section du spec sans tâche.

**Cohérence des noms.** `buildSessionState`, `toSessionStorageEntries`, `toLocalStorageEntries`, `messagerieBadgeCount`, `createEdApi`, `createCredentialsStore`, `createAuthFlow`, `createReloginGuard`, `startBadgePolling(webContents, mainWindow)` : identiques entre définition et usage.

**Point d'attention connu.** `session.defaultSession.fetch` est supposé écrire les `Set-Cookie` dans le jar de la session, ce dont dépend la lecture du cookie `GTK` en Task 3 Step 8. Le diagnostic de la Task 5 Step 12 est le premier point où cela se vérifie en conditions réelles. Si le cookie `GTK` ressort vide, le repli est de lire l'en-tête `set-cookie` de la réponse GET via `response.headers.getSetCookie()` et de le passer directement en `X-Gtk`, sans passer par le jar — `readGtkCookie` est injecté précisément pour rendre ce changement local.
