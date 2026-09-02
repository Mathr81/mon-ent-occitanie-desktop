// Diagnostic du flux d'authentification, sur le vrai compte enregistre.
//
// Lancer avec :
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-auth.js
//
// Ne journalise jamais de secret : uniquement des longueurs et des codes.
const { app, session, safeStorage } = require("electron");
const path = require("path");

// Sans setName, un script lance directement retombe sur
// AppData/Roaming/Electron au lieu du profil de l'application.
app.setName("Mon EcoleDirecte");
const { resolveUserDataPath } = require("../src/main/lib/paths");
const userDataPath = resolveUserDataPath();

const { createEdApi } = require("../src/main/auth/ed-api");
const { createCredentialsStore } = require("../src/main/auth/credentials-store");
const { createAuthFlow } = require("../src/main/auth/auth-flow");

const log = (...a) => process.stdout.write("[diag] " + a.join(" ") + "\n");
const redact = (v) => (v ? `<${String(v).length} caracteres>` : "<vide>");

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  const store = createCredentialsStore(
    path.join(userDataPath, "credentials.json"),
    safeStorage
  );

  const creds = store.read();
  log("userData     :", userDataPath);
  log("chiffrement  :", safeStorage.isEncryptionAvailable() ? "disponible" : "INDISPONIBLE");
  log("identifiant  :", creds.username ? "present" : "ABSENT");
  log("mot de passe :", redact(creds.password));
  log("deviceUuid   :", creds.deviceUuid ? "present" : "sera genere");
  log("cles fa      :", creds.faKeys.length);

  const edApi = createEdApi({
    fetchImpl: (url, init) => ses.fetch(url, init),
    readGtkCookie: async () => {
      const cookies = await ses.cookies.get({ name: "GTK" });
      log("cookie GTK   :", cookies.length ? redact(cookies[0].value) : "ABSENT");
      return cookies.length > 0 ? cookies[0].value : "";
    },
    userAgent: ses.getUserAgent(),
  });

  const result = await createAuthFlow({ edApi, credentialsStore: store }).authenticate();

  log("statut       :", result.status);
  if (result.status === "ok") {
    log("token        :", redact(result.state.authToken));
    log("comptes      :", result.state.accounts.length);
  } else if (result.status === "needs2fa") {
    log("question     :", result.question);
    log("propositions :", result.propositions.length);
  } else {
    log("code         :", result.code);
    log("message      :", result.message);
  }

  app.quit();
}).catch((err) => {
  log("ERREUR :", err && err.message);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
