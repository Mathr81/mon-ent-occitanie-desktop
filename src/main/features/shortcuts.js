const { app, BrowserWindow, globalShortcut } = require("electron");

// Alt+fleches sont enregistres au focus et liberes au blur : les
// raccourcis globaux d'Electron ne sont pas lies a une fenetre.
function registerNavigationShortcuts(win) {
  win.on("focus", () => {
    globalShortcut.register("Alt+Left", () => {
      if (!win.isDestroyed()) win.webContents.navigationHistory.goBack();
    });
    globalShortcut.register("Alt+Right", () => {
      if (!win.isDestroyed()) win.webContents.navigationHistory.goForward();
    });
  });

  win.on("blur", () => {
    globalShortcut.unregister("Alt+Left");
    globalShortcut.unregister("Alt+Right");
  });

  win.on("closed", () => {
    globalShortcut.unregister("Alt+Left");
    globalShortcut.unregister("Alt+Right");
  });
}

function registerGlobalShortcuts() {
  app.on("browser-window-focus", () => {
    globalShortcut.register("F5", () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) focused.webContents.reload();
    });
    globalShortcut.register("F12", () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) focused.webContents.openDevTools({ mode: "detach" });
    });
    globalShortcut.register("CommandOrControl+R", () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) focused.webContents.reload();
    });
  });
}

function unregisterAll() {
  globalShortcut.unregisterAll();
}

module.exports = { registerNavigationShortcuts, registerGlobalShortcuts, unregisterAll };
