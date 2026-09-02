// Diagnostic du badge de la barre des taches.
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-badge.js
//
// Separe les deux moities du mecanisme :
//
//   1. TRANSPORT — fabrication de l'image et pose de l'overlay. Teste avec
//      une valeur en dur, sans dependre d'EcoleDirecte.
//   2. COLLECTE  — les selecteurs CSS. Testes en injectant un faux noeud
//      correspondant dans une page vierge.
//
// Ce que ce script ne peut PAS verifier : que les selecteurs correspondent
// au DOM reel d'EcoleDirecte lorsqu'une vraie notification existe. Voir
// docs/ecoledirecte-api.md.
const { app, BrowserWindow } = require("electron");
const { applyBadge, updateBadge } = require("../src/main/features/badge");

const log = (...a) => process.stdout.write("[badge] " + a.join(" ") + "\n");
const HOLD_MS = 15000;

app.setName("Mon EcoleDirecte");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    title: "Diagnostic badge",
    webPreferences: { contextIsolation: true },
  });
  await win.loadURL("about:blank");

  // ---- 1. TRANSPORT ----
  log("--- transport ---");
  const { nativeImage } = require("electron");
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

  // Faux noeud correspondant au 4e selecteur de la liste.
  await win.webContents.executeJavaScript(`
    document.body.innerHTML = '<span class="ed-menu-badge">7</span>';
    true
  `);
  await updateBadge(win.webContents, win);
  const seen = await win.webContents.executeJavaScript(
    `document.querySelectorAll(".ed-menu-badge").length`
  );
  log("noeud injecte trouve   :", seen, seen === 1 ? "OK" : "ECHEC");

  // Deux noeuds : le comptage doit additionner.
  await win.webContents.executeJavaScript(`
    document.body.innerHTML =
      '<span class="ed-menu-badge">4</span><span class="ed-menu-badge">5</span>';
    true
  `);
  await updateBadge(win.webContents, win);
  log("deux noeuds 4 + 5      : le scrutage doit relever 9 (voir [BADGE] ci-dessus)");

  // Page vide : le compteur doit retomber a zero.
  await win.webContents.executeJavaScript(`document.body.innerHTML = ''; true`);
  await updateBadge(win.webContents, win);
  log("page vide              : le scrutage doit relever 0");

  // On repose une valeur visible pour le controle a l'oeil.
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
