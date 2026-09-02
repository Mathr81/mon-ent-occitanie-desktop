const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { getAssetPath } = require("../lib/paths");
const { registerNavigationShortcuts } = require("../features/shortcuts");

function createPopupWindow(url) {
  const popup = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 500,
    minHeight: 300,
    title: "Lien externe",
    icon: getAssetPath("icons", "icon.ico"),
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  });

  popup.loadFile(path.join(__dirname, "..", "..", "renderer", "popup", "popup.html"));

  popup.webContents.once("did-finish-load", () => {
    popup.webContents.send("load-url", url);
  });

  const openDevTools = () => {
    if (!popup.isDestroyed()) popup.webContents.openDevTools({ mode: "detach" });
  };
  ipcMain.on("popup-devtools", openDevTools);
  popup.on("closed", () => ipcMain.removeListener("popup-devtools", openDevTools));

  registerNavigationShortcuts(popup);

  return popup;
}

module.exports = { createPopupWindow };
