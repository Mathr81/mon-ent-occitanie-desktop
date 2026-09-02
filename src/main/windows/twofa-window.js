const { BrowserWindow } = require("electron");
const path = require("path");

async function createTwoFaWindow(parent, { question, propositions }) {
  const twoFaWindow = new BrowserWindow({
    width: 480,
    height: 620,
    useContentSize: true,
    // Une fenetre modale sans parent est invalide : Electron echoue au
    // chargement. On ne rend modal que s'il y a effectivement un parent.
    modal: Boolean(parent),
    parent: parent || undefined,
    title: "Double authentification",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  await twoFaWindow.loadFile(
    path.join(__dirname, "..", "..", "renderer", "twofa", "twofa.html")
  );

  twoFaWindow.webContents.send("twofa-question", { question, propositions });

  return twoFaWindow;
}

module.exports = { createTwoFaWindow };
