// Le badge doit-il passer par l'API ? Deux questions a trancher.
//
//   1. une seconde connexion invalide-t-elle le jeton deja en place ?
//      Si oui, rafraichir le badge par login.awp casserait la session de
//      la page et declencherait la reprise sur expiration en boucle.
//   2. le compteur de la reponse de login est-il bien celui affiche ?
//
// Lancer avec :
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-badge-api.js
//
// Ne journalise jamais de secret : uniquement des longueurs et des codes.
const { app, session, safeStorage } = require("electron");
const path = require("path");

app.setName("Mon EcoleDirecte");
const { resolveUserDataPath } = require("../src/main/lib/paths");
const userDataPath = resolveUserDataPath();

const { createEdApi } = require("../src/main/auth/ed-api");
const { createCredentialsStore } = require("../src/main/auth/credentials-store");
const { messagerieBadgeCount } = require("../src/main/auth/session-payload");

const log = (...a) => process.stdout.write("[diag] " + a.join(" ") + "\n");
const redact = (v) => (v ? `<${String(v).length} caracteres>` : "<vide>");

const API = "https://api.ecoledirecte.com/v3";
const VERSION = "4.101.2";

// Appel authentifie quelconque, uniquement pour savoir si un jeton vit
// encore. On lit le code, jamais le contenu.
async function tokenStillValid(ses, token, eleveId) {
  const res = await ses.fetch(
    `${API}/eleves/${eleveId}/notes.awp?verbe=get&v=${VERSION}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Token": token },
      body: "data={}",
    }
  );
  const json = await res.json().catch(() => ({}));
  return { xCode: res.headers.get("x-code"), code: json.code, message: json.message };
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  const store = createCredentialsStore(path.join(userDataPath, "credentials.json"), safeStorage);
  const creds = store.read();

  if (!creds.username || !creds.password) {
    log("Aucun identifiant enregistre dans", userDataPath);
    app.exit(1);
    return;
  }

  const edApi = createEdApi({
    fetchImpl: (url, init) => ses.fetch(url, init),
    readGtkCookie: async () => {
      const cookies = await ses.cookies.get({ name: "GTK" });
      return cookies.length > 0 ? cookies[0].value : "";
    },
    userAgent: ses.getUserAgent(),
  });

  const login = () =>
    edApi.login({
      identifiant: creds.username,
      motdepasse: creds.password,
      uuid: store.ensureDeviceUuid(),
      fa: creds.faKeys,
    });

  // ---- Premiere connexion : celle que la page utiliserait ----
  const first = await login();
  log("connexion 1  : code", first.code, "jeton", redact(first.token));
  if (first.code !== 200) {
    log("ECHEC : impossible de tester sans une premiere connexion valide.");
    app.exit(1);
    return;
  }

  const account = (first.data.accounts || [])[0] || {};
  const eleveId = account.id;
  log("eleve id     :", eleveId, "| type", account.typeCompte);
  log("badge login 1:", messagerieBadgeCount({ accounts: first.data.accounts }));

  const before = await tokenStillValid(ses, first.token, eleveId);
  log("jeton 1 avant: x-code", before.xCode, "| code", before.code);

  // ---- Seconde connexion, comme le ferait un rafraichissement de badge ----
  const second = await login();
  log("connexion 2  : code", second.code, "jeton", redact(second.token));
  log("badge login 2:", messagerieBadgeCount({ accounts: second.data.accounts }));
  log("meme jeton ? :", first.token === second.token ? "oui" : "non");

  // ---- LA question ----
  const after = await tokenStillValid(ses, first.token, eleveId);
  log("jeton 1 apres: x-code", after.xCode, "| code", after.code, "|", after.message);

  const survives = after.code === 200;
  log("");
  log(survives
    ? "VERDICT : le jeton en place survit a une seconde connexion."
    : "VERDICT : une seconde connexion TUE le jeton en place. Ne pas rafraichir le badge par login.awp.");

  app.exit(survives ? 0 : 2);
});
