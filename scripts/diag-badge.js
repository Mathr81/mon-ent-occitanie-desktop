// Diagnostic du badge de la barre des taches.
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-badge.js
//
// Separe les deux moities du mecanisme :
//
//   1. TRANSPORT — fabrication de l'image et pose de l'overlay. Teste avec
//      une valeur en dur, sans dependre d'EcoleDirecte.
//   2. COLLECTE  — la lecture du store du SPA dans le sessionStorage de la
//      page, exercee sur une valeur injectee dans une page vierge.
//
// La collecte ne repose plus sur des selecteurs CSS : le parsing est une
// fonction pure couverte par test/session-payload.test.js. Ce script verifie
// le raccordement, c'est-a-dire qu'on lit bien la bonne cle au bon endroit.
const { app, BrowserWindow } = require("electron");
const path = require("path");
const { applyBadge, createBadgeState, nextRemoteDelay,
        REMOTE_BASE_MS, REMOTE_JITTER_MS } = require("../src/main/features/badge");
const { messagerieBadgeFromStoredAccounts } = require("../src/main/auth/session-payload");

const log = (...a) => process.stdout.write("[badge] " + a.join(" ") + "\n");
const HOLD_MS = 15000;

app.setName("Mon EcoleDirecte");

// Meme forme que ce qu'ecrit le SPA : enveloppe { payload, lastModified }.
function fakeAccounts(badge) {
  return JSON.stringify({
    payload: {
      accounts: [{
        id: 5618,
        typeCompte: "E",
        current: true,
        modules: [{ code: "MESSAGERIE", enable: true, badge }],
      }],
    },
    lastModified: Date.now(),
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    title: "Diagnostic badge",
    webPreferences: { contextIsolation: true },
  });
  // Une vraie origine est indispensable : sur about:blank comme sur une URL
  // data:, l'origine est opaque et l'acces au sessionStorage leve.
  await win.loadFile(path.join(__dirname, "..", "src", "renderer", "loading", "loading.html"));

  // ---- 1. TRANSPORT ----
  log("--- transport ---");
  const canvasOk = (() => {
    try { require("canvas"); return true; } catch { return false; }
  })();
  log("module canvas          :", canvasOk ? "disponible" : "ABSENT (fallback bitmap)");

  applyBadge(3, win);
  log("applyBadge(3)          : pose sans erreur");
  log("plateforme             :", process.platform,
      process.platform === "win32" ? "(overlay barre des taches)" : "(setBadgeCount)");

  // ---- 2. COLLECTE ----
  log("--- collecte ---");

  const readFromPage = async () => {
    const raw = await win.webContents.executeJavaScript('sessionStorage.getItem("accounts")');
    return messagerieBadgeFromStoredAccounts(raw);
  };

  log("store absent           :", JSON.stringify(await readFromPage()),
      (await readFromPage()) === null ? "OK (null, pas 0)" : "ECHEC");

  await win.webContents.executeJavaScript(
    `sessionStorage.setItem("accounts", ${JSON.stringify(fakeAccounts(7))}); true`
  );
  const sept = await readFromPage();
  log("store a 7              :", sept, sept === 7 ? "OK" : "ECHEC");

  await win.webContents.executeJavaScript(
    `sessionStorage.setItem("accounts", ${JSON.stringify(fakeAccounts(0))}); true`
  );
  const zero = await readFromPage();
  log("store a 0              :", zero, zero === 0 ? "OK" : "ECHEC");

  await win.webContents.executeJavaScript(
    `sessionStorage.setItem("accounts", "pas du json"); true`
  );
  const casse = await readFromPage();
  log("store illisible        :", JSON.stringify(casse),
      casse === null ? "OK (null, pas 0)" : "ECHEC");

  // ---- 3. CONSERVATION ----
  // Le coeur de la correction : un echec de lecture ne doit pas effacer un
  // compteur juste.
  log("--- conservation ---");
  const state = createBadgeState(0);
  state.next(7);
  const garde = state.next(null);
  log("7 puis lecture nulle   :", garde, garde === 7 ? "OK (valeur conservee)" : "ECHEC");
  const remis = state.next(0);
  log("puis un vrai 0         :", remis, remis === 0 ? "OK (0 explicite accepte)" : "ECHEC");

  // ---- 4. CADENCE ----
  log("--- cadence ---");
  const min = Math.round((REMOTE_BASE_MS - REMOTE_JITTER_MS) / 60000);
  const max = Math.round((REMOTE_BASE_MS + REMOTE_JITTER_MS) / 60000);
  const tirages = Array.from({ length: 8 }, () => Math.round(nextRemoteDelay() / 60000));
  log(`fenetre attendue       : ${min} a ${max} min`);
  log("huit tirages (min)     :", tirages.join(", "));
  log("tous dans la fenetre   :",
      tirages.every((d) => d >= min && d <= max) ? "OK" : "ECHEC");

  applyBadge(3, win);
  log("");
  log(`>>> REGARDE LA BARRE DES TACHES : une pastille "3" doit etre visible`);
  log(`>>> sur l'icone pendant ${HOLD_MS / 1000} secondes.`);

  setTimeout(() => app.quit(), HOLD_MS);
}).catch((err) => {
  log("ERREUR :", err && err.message);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
