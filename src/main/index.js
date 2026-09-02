const { app, ipcMain, Menu, safeStorage, session } = require("electron");
const { ElectronChromeExtensions } = require("electron-chrome-extensions");
const pie = require("puppeteer-in-electron");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const { resolveUserDataPath } = require("./lib/paths");
const { initLogger } = require("./lib/logger");
const { loadCustomExtension } = require("./features/extensions");
const { setupAutoUpdater } = require("./features/updater");
const { registerGlobalShortcuts, unregisterAll } = require("./features/shortcuts");
const { startBadgePolling, stopBadgePolling } = require("./features/badge");
const { createMainWindow } = require("./windows/main-window");
const { createLoginWindow } = require("./windows/login-window");

// =========================
// CHEMINS ET LOGGING
// =========================

console.log("NODE_ENV =", process.env.NODE_ENV);

const userDataPath = resolveUserDataPath();
initLogger(userDataPath);

console.log("userData =", userDataPath);

// =========================
// PUPPETEER INIT
// =========================

pie.initialize(app);

// =========================
// CREDENTIALS
// =========================

const credentialsPath = path.join(userDataPath, "credentials.json");

function getStoredCredentials() {
  try {
    if (fs.existsSync(credentialsPath)) {
      const data = JSON.parse(fs.readFileSync(credentialsPath));

      if (data.username && data.password) {
        const username = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(data.username, "base64"))
          : null;

        const password = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(data.password, "base64"))
          : null;

        return { username, password };
      }
    }
  } catch (err) {
    console.error("Erreur lecture credentials :", err);
  }

  return { username: null, password: null };
}

function storeCredentials(username, password) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error("Le chiffrement n'est pas disponible.");
      return;
    }

    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        username: safeStorage.encryptString(username).toString("base64"),
        password: safeStorage.encryptString(password).toString("base64"),
      })
    );

    console.log("Identifiants enregistrés.");
  } catch (err) {
    console.error("Erreur sauvegarde credentials :", err);
  }
}

// =========================
// UTILS
// =========================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =========================
// MAIN
// =========================

async function main() {
  const browser = await pie.connect(app, puppeteer);

  const extensions = new ElectronChromeExtensions({
    session: session.defaultSession,
    license: "GPL-3.0",
  });

  loadCustomExtension(session.defaultSession);

  const mainWindow = createMainWindow();
  extensions.addTab(mainWindow.webContents, mainWindow);

  Menu.setApplicationMenu(null);

  registerGlobalShortcuts();

  const url = "https://www.ecoledirecte.com/login?cameFrom=%2FAccueil";
  await mainWindow.loadURL(url);

  // =========================
  // GET CREDS
  // =========================

  let { username, password } = getStoredCredentials();

  if (!username || !password) {
    const loginWindow = await createLoginWindow(mainWindow);

    ipcMain.once("submit-credentials", (event, credentials) => {
      username = credentials.username;
      password = credentials.password;
      storeCredentials(username, password);
      loginWindow.close();
    });

    await new Promise((resolve) => {
      loginWindow.on("closed", resolve);
    });
  } else {
    console.log("Identifiants déjà enregistrés !");
  }

  // =========================
  // PUPPETEER
  // =========================

  const page = await pie.getPage(browser, mainWindow);

  await page.waitForSelector("#username");
  await page.waitForSelector("#password");

  const currentUsername = await page.$eval("#username", (el) => el.value);
  const currentPassword = await page.$eval("#password", (el) => el.value);

  console.log("Username field =", currentUsername);
  console.log("Password field =", currentPassword ? "[REMPLI]" : "[VIDE]");

  if (!currentUsername.trim()) {
    await page.type("#username", username);
  } else {
    console.log("Nom d'utilisateur déjà rempli.");
  }

  if (!currentPassword.trim()) {
    await page.type("#password", password);
  } else {
    console.log("Mot de passe déjà rempli.");
  }

  try {
    const rememberMeChecked = await page.$eval("#seSouvenirDeMoi", (el) => el.checked);
    if (!rememberMeChecked) {
      await page.click("#seSouvenirDeMoi");
    }
  } catch {
    console.warn("Checkbox souvenir introuvable.");
  }

  await page.click("#connexion");
  await page.waitForNavigation({ waitUntil: "networkidle2" });

  console.log("Connexion réussie");

  await sleep(500);

  await setupReloginWatcher(page, mainWindow, password);

  startBadgePolling(mainWindow.webContents, mainWindow);

  setupAutoUpdater(mainWindow);
}

// =========================
// RE-LOGIN WATCHER
// =========================

async function setupReloginWatcher(page, mainWindow, password) {
  await page.evaluateOnNewDocument(() => {
    let watcherActive = false;

    function startWatcher() {
      if (watcherActive) return;
      watcherActive = true;

      const observer = new MutationObserver(() => {
        const passwordFields = document.querySelectorAll('input[type="password"]');

        passwordFields.forEach((field) => {
          if (field.offsetParent !== null) {
            const isLoginPage = window.location.pathname.includes("/login");

            if (!isLoginPage && !field.dataset.edWatcherFired) {
              field.dataset.edWatcherFired = "1";
              window.dispatchEvent(new CustomEvent("ed-relogin-needed", { detail: field.id }));
            }
          }
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startWatcher);
    } else {
      startWatcher();
    }
  });

  await page.exposeFunction("__edTriggerRelogin", async () => {
    console.log("Re-login nécessaire détecté !");
    await performRelogin(page, password);
  });

  await page.evaluate(() => {
    window.addEventListener("ed-relogin-needed", () => {
      if (typeof window.__edTriggerRelogin === "function") {
        window.__edTriggerRelogin();
      }
    });
  });

  mainWindow.webContents.on("did-navigate", async (event, navUrl) => {
    if (navUrl.includes("/login")) {
      console.log("Redirection login détectée, re-login en cours…");
      await sleep(800);
      await performRelogin(page, password, true);
    }
  });
}

async function performRelogin(page, password, isFullLogin = false) {
  try {
    await page.waitForSelector('input[type="password"]', { timeout: 5000 });

    if (isFullLogin) {
      const usernameField = await page.$("#username");
      if (usernameField) {
        const val = await page.$eval("#username", (el) => el.value);
        if (!val.trim()) {
          const { username } = getStoredCredentials();
          if (username) await page.type("#username", username);
        }
      }
    }

    const passwordFields = await page.$$('input[type="password"]');
    for (const field of passwordFields) {
      const isVisible = await field.evaluate((el) => el.offsetParent !== null);
      if (isVisible) {
        await field.click({ clickCount: 3 });
        await field.type(password);
        break;
      }
    }

    const connectBtn =
      (await page.$("#connexion")) ||
      (await page.$('button[type="submit"]')) ||
      (await page.$(".btn-connexion"));

    if (connectBtn) {
      await connectBtn.click();
      console.log("Re-login effectué avec succès.");
    } else {
      console.warn("Bouton de connexion introuvable pour le re-login.");
    }
  } catch (err) {
    console.error("Erreur lors du re-login :", err.message);
  }
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
