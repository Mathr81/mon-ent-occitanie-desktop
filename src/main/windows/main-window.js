const { BrowserWindow, session } = require("electron");
const path = require("path");
const { getAssetPath } = require("../lib/paths");
const { registerNavigationShortcuts } = require("../features/shortcuts");
const { createPopupWindow } = require("./popup-window");

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: getAssetPath("icons", "icon.ico"),
    webPreferences: {
      session: session.defaultSession,
      sandbox: true,
      contextIsolation: true,
      devTools: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("about:") || url.startsWith("devtools:")) {
      return { action: "allow" };
    }

    // blob: et data: sont des telechargements generes par la page.
    // Electron ne sait pas les telecharger directement, on laisse la
    // page les gerer elle-meme.
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      return { action: "allow" };
    }

    if (url.includes("api.ecoledirecte.com")) {
      return { action: "allow" };
    }

    createPopupWindow(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.executeJavaScript(`
      const _originalOpen = window.open.bind(window);
      window.open = function(url, ...args) {
        if (url && (url.startsWith('blob:') || url.startsWith('data:'))) {
          const a = document.createElement('a');
          a.href = url;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          return null;
        }
        return _originalOpen(url, ...args);
      };
    `).catch(() => {});
  });

  registerNavigationShortcuts(mainWindow);

  return mainWindow;
}

module.exports = { createMainWindow };
