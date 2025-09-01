const { BrowserWindow, app, Menu, ipcMain, safeStorage } = require("electron");
const pie = require("puppeteer-in-electron");
const puppeteer = require("puppeteer-core");
const fs = require('fs');
const path = require('path');

pie.initialize(app);

// Chemin où les identifiants chiffrés seront stockés
const credentialsPath = path.join(app.getPath('userData'), 'credentials.json');

// Chemin vers l'extension CustomDirecte
const extensionPath = path.join(__dirname, 'CustomDirecte');

async function createLoginWindow() {
  const loginWindow = new BrowserWindow({
    width: 400,
    height: 300,
    modal: true,
    parent: BrowserWindow.getFocusedWindow(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  loginWindow.loadFile('login.html');
  
  return loginWindow;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fonction pour lire les identifiants chiffrés
function getStoredCredentials() {
  if (fs.existsSync(credentialsPath)) {
    const data = JSON.parse(fs.readFileSync(credentialsPath));
    if (data.username && data.password) {
      // Déchiffrer les identifiants
      const username = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(data.username, 'base64')) : null;
      const password = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(data.password, 'base64')) : null;
      return { username, password };
    }
  }
  return { username: null, password: null };
}

// Fonction pour stocker les identifiants chiffrés
function storeCredentials(username, password) {
  if (safeStorage.isEncryptionAvailable()) {
    const encryptedUsername = safeStorage.encryptString(username).toString('base64');
    const encryptedPassword = safeStorage.encryptString(password).toString('base64');
    fs.writeFileSync(credentialsPath, JSON.stringify({ username: encryptedUsername, password: encryptedPassword }));
  } else {
    console.error("Encryption is not available on this system.");
  }
}

const main = async () => {
  const browser = await pie.connect(app, puppeteer);
  
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Autoriser l'utilisation des extensions Chrome
      extensions: true
    }
  });

  // Charger l'extension CustomDirecte
  await mainWindow.webContents.session.loadExtension(extensionPath);

  Menu.setApplicationMenu(null);
  const url = "https://www.ecoledirecte.com/login?cameFrom=%2FAccueil";
  await mainWindow.loadURL(url);

  // Vérifier si les identifiants existent
  let { username, password } = getStoredCredentials();

    // Si les identifiants ne sont pas enregistrés, ouvrir la fenêtre modale
  if (!username || !password) {
    const loginWindow = await createLoginWindow();

    // Attendre que l'utilisateur soumette les identifiants via la popup
    ipcMain.once('submit-credentials', (event, credentials) => {
      username = credentials.username;
      password = credentials.password;

      // Enregistrer les identifiants dans le store sécurisé
      storeCredentials(username, password);

      // Fermer la fenêtre de login après la soumission
      loginWindow.close();
    });

    // Attendre que la fenêtre de login soit fermée avant de continuer
    await new Promise((resolve) => {
      loginWindow.on('closed', resolve);
    });
  } else {
    console.log("Identifiants déjà enregistrés !");
  }

  const page = await pie.getPage(browser, mainWindow);

  // Attendre que l'extension soit chargée et initialise ses modifications
  await sleep(2000);

  // Utiliser les identifiants pour la connexion
  await page.type("#username", username);
  await page.type("#password", password);

  await page.click("#connexion");

  await page.waitForNavigation();

  console.log("Connexion réussie");

  // Attendre que l'extension ait le temps de modifier la page après la connexion
  await sleep(2000);

  // Ici, vous pouvez ajouter du code pour interagir avec les modifications apportées par l'extension
  // Par exemple, vous pourriez vérifier si certains éléments ajoutés par l'extension sont présents
  const customElementExists = await page.evaluate(() => {
    return !!document.querySelector('.custom-directe-element');
  });

  if (customElementExists) {
    console.log("L'extension CustomDirecte a bien modifié la page.");
  } else {
    console.log("L'extension CustomDirecte ne semble pas avoir modifié la page comme prévu.");
  }

  // Gardez la fenêtre ouverte
  mainWindow.on('closed', () => {
    app.quit();
  });
};

app.whenReady().then(() => {
  main().catch((err) => {
    console.error("Erreur lors de la connexion :", err);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    main();
  }
});