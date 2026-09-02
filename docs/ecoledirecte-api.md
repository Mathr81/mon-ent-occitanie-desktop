# Faits d'API ÉcoleDirecte et de packaging

Notes de rétro-ingénierie établies pendant la migration vers
l'authentification headless (septembre 2026). Ces comportements ne sont
documentés nulle part officiellement et ont chacun coûté un aller-retour de
débogage. Ils sont vérifiés contre l'API et le build réels, pas déduits.

Base : `https://api.ecoledirecte.com`, paramètre `v=4.101.2`
(valeur `packageVersion` du SPA au moment de l'analyse).

---

## L'en-tête de la double authentification est `2FA-Token`, pas `X-Token`

`/v3/connexion/doubleauth.awp` **rejette** `X-Token` :

```
en-tete X-Token   -> code 520  "Token invalide !"
en-tete 2FA-Token -> code 200  question + propositions
```

Le SPA définit d'ailleurs deux constantes distinctes :
`De = { token: "X-Token", twoFAToken: "2FA-Token", … }`. `X-Token` porte le
jeton de session pour les appels métier ; `2FA-Token` porte le jeton de la
double authentification. Ils ne sont pas interchangeables.

Testé dans `test/ed-api.test.js`.

## Sur un code 250, le jeton exploitable est celui du corps, pas de `x-token`

La réponse `250` d'un login porte **deux** jetons différents :

- `body.token` — celui qui fonctionne avec `2FA-Token` ;
- l'en-tête `x-token` — un autre jeton, qui mène au 520.

Mesuré : `token du corps === entête x-token` → `false`. Les en-têtes présents
sur cette réponse sont `2fa-token`, `x-code` et `x-token`.

C'est contre-intuitif, l'en-tête paraissant le canal naturel. La
documentation non officielle dit seulement « gardez bien le token mis dans la
réponse », sans préciser lequel.

## Le message d'erreur d'un 250 est trompeur

Un code `250` s'accompagne du message
`"Identifiant et/ou mot de passe invalide !"` alors que les identifiants sont
corrects et que la double authentification est simplement requise. **C'est le
code qui fait foi, jamais le message.** Le SPA nomme d'ailleurs cette valeur
`Auht2Factor` dans son énumération.

## Le cookie GTK est obligatoire depuis le 24/03/2025

Sans lui, `/v3/login.awp` répond « identifiant et/ou mot de passe invalide »
même avec des identifiants corrects. Séquence :

1. `GET /v3/login.awp?gtk=1` — pose un cookie `GTK` (~550 à 650 caractères) ;
2. `POST /v3/login.awp` avec sa valeur dans l'en-tête **`X-Gtk`**.

`session.defaultSession.fetch` d'Electron écrit bien les `Set-Cookie` dans le
jar de la session : le cookie est donc relisible via
`session.cookies.get({ name: "GTK" })` et atterrit dans la fenêtre. Vérifié.

## Les clés `cn`/`cv` sont réutilisables, mais peuvent mourir

`doubleauth.awp?verbe=post` renvoie un couple `{ cn, cv }` à joindre au champ
`fa[]` des logins suivants, ce qui évite de reposer la question.

Si un login **renvoie quand même un 250 alors qu'on a envoyé des `fa[]`**, le
couple est mort : il faut le purger et repasser par la question, sinon on
renvoie éternellement des clés invalides. Implémenté dans
`src/main/auth/auth-flow.js`, testé dans `test/auth-flow.test.js`.

## Où le SPA range sa session

Persistance via un `WebStorageService` qui utilise **`sessionStorage`**, avec
l'enveloppe `JSON.stringify({ payload, lastModified })` :

| Clé | Store | `payload` |
|---|---|---|
| `credentials` | `CredentialsStore` | `{ authToken, fcmToken, twoFAToken }` |
| `accounts` | `AuthStore` | `{ accounts[], changementMDP, nbJourMdpExire, isBloque, urlUnblock }` |

L'intercepteur HTTP pose `X-Token: credentialsStore.snapshot.authToken` sur
chaque requête. Les clés 2FA vivent dans `localStorage["fa"]` sous la forme
`[{ cn, cv, uniq }]`, 10 entrées maximum en FIFO.

Comme il s'agit de `sessionStorage`, la session est perdue à chaque
redémarrage de l'application : c'est pour cela qu'il faut réauthentifier et
réinjecter au lancement.

### Piège : `edcommonhydration_auth` n'est pas de l'authentification

La page expose aussi `sessionStorage["edcommonhydration_auth"]`, qui vaut
`{"payload":{}}` hors session. Le nom et l'enveloppe `{ payload }` en font un
sosie convaincant des clés ci-dessus.

C'est en réalité l'hydratation d'un feature-state NgRx de forme
`{ datas, selectedAnneeScolaire, selectedEntityUser, selectedVariant }`, écrit
par un helper distinct préfixant toutes ses clés :
`` Yx = s => `edcommonhydration_${s}` ``. Il ne porte ni jeton ni compte.
**Ne pas l'écrire, ne pas le confondre avec `credentials` / `accounts`.**

## Un preload sandboxé écrit bien dans le storage lu par la page

Vérifié par spike : avec `sandbox: true` et `contextIsolation: true`, un
preload s'exécute à `document.readyState === "loading"`, donc avant le boot
d'Angular, et le monde principal de la page relit exactement ce qu'il a
écrit. Le storage est cloisonné par origine, pas par monde isolé.
`ipcRenderer.sendSync` y fonctionne également.

C'est ce qui rend l'injection de session possible sans piloter le DOM.

## Le badge est déjà dans la réponse de login

`accounts[].modules[]` contient `{ code, badge }`, dont
`{ code: "MESSAGERIE", badge: N }` — la valeur qu'affiche la pastille du menu
latéral. Inutile de scruter le DOM pour la valeur initiale.

### Ce qui reste non vérifié sur le badge

Le compteur affiché en continu est en revanche relevé dans le DOM, et cette
partie n'a **jamais pu être vérifiée sur une vraie notification** : le compte
de test n'en a aucune, les quatre sélecteurs remontent donc systématiquement
zéro élément.

Ce qui est vérifié (`scripts/diag-badge.js`) :

- **transport** — fabrication de l'image et pose de l'overlay, avec une
  valeur en dur ;
- **collecte** — les sélecteurs, en injectant de faux nœuds dans une page
  vierge : un nœud `7` donne 7, deux nœuds `4` et `5` donnent 9, une page
  vide donne 0 et retire l'overlay.

Ce qui ne l'est pas : que ces sélecteurs correspondent au DOM réel
d'ÉcoleDirecte quand une notification existe. Les sélecteurs concernés,
essayés dans cet ordre :

```
#menuId-5618 > li:nth-child(5) > ed-menu-block-item > div > a > span.badge.alert-danger.ed-menu-badge
span.badge.alert-danger.ed-menu-badge
.badge.alert-danger
.ed-menu-badge
```

Le premier est particulièrement fragile : `menuId-5618` est un identifiant
d'établissement, il ne vaudra pas la même chose ailleurs. Les trois suivants
servent de repli.

À revérifier dès qu'une vraie notification est disponible. La valeur initiale,
elle, vient de l'API et ne dépend d'aucun sélecteur.

---

## Packaging : `package.json` a la priorité sur `electron-builder.yml`

`app-builder-lib/out/util/config/load.js` :

```js
const data = packageMetadata[request.packageKey];      // package.json "build"
return data == null ? findAndReadConfig(request) : { result: data, configFile: null };
```

Le fichier de configuration n'est cherché **que si** le champ `build` est
absent de `package.json`. Quand les deux existent, le `.yml` n'est jamais lu.
Le build le confirme dans sa sortie :

```
• loaded configuration  file=package.json ("build" field)
```

Conséquence : toute modification de packaging doit se faire dans
`package.json`. La faire dans un `.yml` n'aurait aucun effet et ne se verrait
qu'à la release. `electron-builder.yml` a été supprimé pour cette raison.

## L'extension ne peut pas être chargée depuis l'asar

`session.loadExtension()` exige un vrai dossier sur disque. L'extension
patchée est donc copiée par `extraResources` et résolue au runtime via
`process.resourcesPath` en packagé, `app.getAppPath()` en développement.

## `app.getAppPath()` dépend du script lancé

Pour l'application (`electron .`) il vaut la racine du projet ; pour un script
lancé directement (`electron scripts/diag-auth.js`) il vaut le dossier du
script. Un utilitaire qui doit retrouver le profil de l'application ne peut
donc pas s'appuyer dessus, et doit en outre appeler `app.setName()`, faute de
quoi il retombe sur `AppData/Roaming/Electron`.

## Monter de version Electron casse `install-app-deps` tant que `node-abi` retarde

Le `postinstall` lance `electron-builder install-app-deps`, qui délègue à
`@electron/rebuild`, qui interroge `node-abi` pour connaître l'ABI de la
version d'Electron visée. La copie de `node-abi` embarquée par
`@electron/rebuild` est souvent en retard de quelques versions : au moment du
passage à Electron 44 elle était en 4.31.0, qui ne connaissait pas encore
l'ABI 149, et l'installation échouait avec un `getAbi` en erreur — pnpm
annulait alors la mise à jour de `package.json`.

Le correctif est une surcharge dans `package.json` :

```json
"pnpm": { "overrides": { "node-abi": "^4.35.0" } }
```

À relever pour chaque montée majeure d'Electron. Elle est sans effet sur
`canvas`, seul module natif du projet : il est compilé en N-API 7, donc
stable d'une ABI à l'autre — c'est uniquement l'interrogation de `node-abi`
qui échouait, pas la recompilation.

## `ELECTRON_RUN_AS_NODE` traîne dans certains terminaux

VS Code exporte `ELECTRON_RUN_AS_NODE=1` dans l'environnement de ses
terminaux intégrés. Un `electron .` lancé depuis là démarre en Node pur :
`process.type` vaut `undefined` et `require("electron")` ne renvoie plus le
module intégré mais la chaîne exportée par le paquet npm, c'est-à-dire le
chemin du binaire. Le symptôme est un `Cannot read properties of undefined`
sur `app`, `BrowserWindow` ou n'importe quel export, souvent depuis un module
de `node_modules` — ce qui fait accuser à tort la dépendance ou la version
d'Electron.

Lancer avec `env -u ELECTRON_RUN_AS_NODE …` pour trancher.
