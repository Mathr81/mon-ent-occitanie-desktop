const { app, ipcMain, Menu, safeStorage, session } = require("electron");
const { ElectronChromeExtensions } = require("electron-chrome-extensions");
const path = require("path");

const { resolveUserDataPath } = require("./lib/paths");
const { initLogger } = require("./lib/logger");
const { loadCustomExtension } = require("./features/extensions");
const { setupAutoUpdater } = require("./features/updater");
const { registerGlobalShortcuts, unregisterAll } = require("./features/shortcuts");
const { startBadgePolling, stopBadgePolling, applyBadge } = require("./features/badge");
const { createMainWindow } = require("./windows/main-window");
const { createLoginWindow } = require("./windows/login-window");
const { createTwoFaWindow } = require("./windows/twofa-window");
const { createEdApi } = require("./auth/ed-api");
const { createAuthFlow } = require("./auth/auth-flow");
const { createReloginGuard } = require("./auth/relogin-guard");
const { createCredentialsStore } = require("./auth/credentials-store");
const {
  toSessionStorageEntries,
  toLocalStorageEntries,
  messagerieBadgeCount,
} = require("./auth/session-payload");

const HOME_URL = "https://www.ecoledirecte.com/Accueil";
const LOGIN_URL = "https://www.ecoledirecte.com/login?cameFrom=%2FAccueil";

// =========================
// CHEMINS ET LOGGING
// =========================

console.log("NODE_ENV =", process.env.NODE_ENV);

const userDataPath = resolveUserDataPath();
initLogger(userDataPath);

console.log("userData =", userDataPath);

// =========================
// AMORCAGE DE SESSION (lu par src/preload/ed-session.js)
// =========================

let currentSessionSeed = null;

function setSessionSeed(state, faKeys) {
  currentSessionSeed = state
    ? { session: toSessionStorageEntries(state), local: toLocalStorageEntries(faKeys) }
    : null;
}

ipcMain.on("ed:session-seed", (event) => {
  event.returnValue = currentSessionSeed;
});

// =========================
// BANDEAU D'AVERTISSEMENT
// =========================

// Non bloquant : le formulaire EcoleDirecte reste utilisable en dessous.
//
// Reprend a l'identique le traitement d'erreur des fenetres maison
// (.ed-error dans src/renderer/shared/base.css) : memes couleurs, meme
// typographie. Les valeurs sont dupliquees ici parce que la feuille est
// injectee dans une page distante que l'on ne controle pas.
const AUTH_BANNER_STYLE = [
  "position:fixed",
  "top:0",
  "left:0",
  "right:0",
  "z-index:99999",
  "padding:8px 12px",
  "color:#58151c",                      // --ed-danger-text
  "background:#f8d7da",                 // --ed-danger-bg
  "border-bottom:1px solid #f1aeb5",    // --ed-danger-border
  "font-family:Tahoma,Helvetica,Arial,sans-serif", // --ed-font
  "font-size:12px",                     // --ed-font-size-sm
  "text-align:center",
].join(";");

function showAuthBanner(mainWindow, code) {
  if (mainWindow.isDestroyed()) return;

  const message =
    `Connexion automatique impossible (${code}). ` +
    "Connectez-vous manuellement ci-dessous. Détails dans app.log.";

  mainWindow.webContents.executeJavaScript(`
    (() => {
      let banner = document.getElementById('ed-auth-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'ed-auth-banner';
        banner.style.cssText = ${JSON.stringify(AUTH_BANNER_STYLE)};
        document.body.appendChild(banner);
      }
      banner.textContent = ${JSON.stringify(message)};
    })()
  `).catch(() => {});
}

function clearAuthBanner(mainWindow) {
  if (mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(`
    (() => {
      const banner = document.getElementById('ed-auth-banner');
      if (banner) banner.remove();
    })()
  `).catch(() => {});
}

// =========================
// FENETRES D'IDENTIFICATION
// =========================

async function promptCredentials(parent, credentialsStore) {
  const loginWindow = await createLoginWindow(parent);

  ipcMain.once("submit-credentials", (event, credentials) => {
    credentialsStore.writeCredentials(credentials.username, credentials.password);
    console.log("Identifiants enregistrés.");
    if (!loginWindow.isDestroyed()) loginWindow.close();
  });

  await new Promise((resolve) => loginWindow.on("closed", resolve));
}

async function promptTwoFa(parent, { question, propositions }) {
  const twoFaWindow = await createTwoFaWindow(parent, { question, propositions });

  return new Promise((resolve) => {
    let answered = false;

    ipcMain.once("twofa-answer", (event, answer) => {
      answered = true;
      if (!twoFaWindow.isDestroyed()) twoFaWindow.close();
      resolve(answer);
    });

    twoFaWindow.on("closed", () => {
      if (answered) return;
      ipcMain.removeAllListeners("twofa-answer");
      resolve(null);
    });
  });
}

// =========================
// AUTHENTIFICATION
// =========================

async function ensureAuthenticated(mainWindow, deps) {
  const { authFlow, credentialsStore, reloginGuard } = deps;

  let result = await authFlow.authenticate();

  if (result.status === "failed" && result.code === "NO_CREDENTIALS") {
    await promptCredentials(mainWindow, credentialsStore);
    result = await authFlow.authenticate();
  }

  if (result.status === "needs2fa") {
    console.log("Double authentification demandée.");
    const answer = await promptTwoFa(mainWindow, result);

    result = answer === null
      ? { status: "failed", code: "2FA_ANNULEE", message: "Fenêtre 2FA fermée." }
      : await authFlow.submit2faAnswer(answer);
  }

  if (result.status === "ok") {
    setSessionSeed(result.state, credentialsStore.read().faKeys);
    reloginGuard.reset();
    console.log(`Authentification réussie (${result.state.accounts.length} compte(s)).`);
    return result.state;
  }

  console.error(`Authentification échouée (${result.code}) : ${result.message}`);
  setSessionSeed(null, []);
  return null;
}

// =========================
// RE-LOGIN SUR REDIRECTION
// =========================

function setupReloginOnRedirect(mainWindow, deps) {
  let inProgress = false;

  mainWindow.webContents.on("did-navigate", async (event, navUrl) => {
    if (!navUrl.includes("/login") || inProgress) return;

    if (!deps.reloginGuard.shouldRetry()) {
      console.error("Reconnexion automatique abandonnée après trop de tentatives.");
      showAuthBanner(mainWindow, "TROP_DE_TENTATIVES");
      return;
    }

    inProgress = true;
    try {
      const delay = deps.reloginGuard.nextDelay();
      deps.reloginGuard.recordAttempt();
      console.log(`Redirection login détectée, nouvelle tentative dans ${delay} ms.`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      const state = await ensureAuthenticated(mainWindow, deps);
      if (state) {
        clearAuthBanner(mainWindow);
        await mainWindow.loadURL(HOME_URL);
        applyBadge(messagerieBadgeCount(state), mainWindow);
      } else {
        showAuthBanner(mainWindow, "AUTH_ECHOUEE");
      }
    } finally {
      inProgress = false;
    }
  });
}

// =========================
// MAIN
// =========================

async function main() {
  const credentialsStore = createCredentialsStore(
    path.join(userDataPath, "credentials.json"),
    safeStorage
  );

  const ses = session.defaultSession;

  const edApi = createEdApi({
    fetchImpl: (url, init) => ses.fetch(url, init),
    readGtkCookie: async () => {
      const cookies = await ses.cookies.get({ name: "GTK" });
      return cookies.length > 0 ? cookies[0].value : "";
    },
    userAgent: ses.getUserAgent(),
  });

  const deps = {
    authFlow: createAuthFlow({ edApi, credentialsStore }),
    credentialsStore,
    reloginGuard: createReloginGuard(),
  };

  const extensions = new ElectronChromeExtensions({ session: ses, license: "GPL-3.0" });
  loadCustomExtension(ses);

  const mainWindow = createMainWindow();
  extensions.addTab(mainWindow.webContents, mainWindow);

  Menu.setApplicationMenu(null);
  registerGlobalShortcuts();

  setupReloginOnRedirect(mainWindow, deps);

  // L'authentification a lieu AVANT toute navigation : le preload trouve
  // ainsi la session prete et l'ecrit avant le boot d'Angular.
  const state = await ensureAuthenticated(mainWindow, deps);

  await mainWindow.loadURL(state ? HOME_URL : LOGIN_URL);

  // Si l'injection de session avait echoue, le SPA nous renverrait ici
  // vers /login : cette ligne est le temoin le plus direct.
  console.log("URL après chargement :", mainWindow.webContents.getURL());

  if (state) {
    // Le compteur du badge est deja dans la reponse de login, inutile
    // d'attendre le premier scrutage du DOM.
    applyBadge(messagerieBadgeCount(state), mainWindow);
  } else {
    showAuthBanner(mainWindow, "AUTH_ECHOUEE");
  }

  startBadgePolling(mainWindow.webContents, mainWindow);
  setupAutoUpdater(mainWindow);
}

// =========================
// APP LIFECYCLE
// =========================

app.whenReady().then(() => {
  main().catch((err) => {
    console.error("Erreur lors du lancement :", err);
  });
});

app.on("window-all-closed", () => {
  stopBadgePolling();
  unregisterAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  stopBadgePolling();
  unregisterAll();
});
