const { BrowserWindow } = require("electron");
const path = require("path");

async function createLoginWindow(parent) {
  const loginWindow = new BrowserWindow({
    width: 420,
    height: 300,
    // Les dimensions decrivent la zone utile, pas le cadre.
    useContentSize: true,
    resizable: false,
    // Une fenetre modale sans parent est invalide : Electron echoue au
    // chargement. On ne rend modal que s'il y a effectivement un parent.
    modal: Boolean(parent),
    parent: parent || undefined,
    title: "Connexion",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  await loginWindow.loadFile(
    path.join(__dirname, "..", "..", "renderer", "login", "login.html")
  );

  return loginWindow;
}

module.exports = { createLoginWindow };
