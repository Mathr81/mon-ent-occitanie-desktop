const { autoUpdater } = require("electron-updater");

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

function setupAutoUpdater(mainWindow) {
  if (process.env.NODE_ENV === "development") {
    console.log("Auto-updater désactivé en mode développement.");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("Vérification des mises à jour…");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`Mise à jour disponible : v${info.version}`);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        if (!document.getElementById('ed-update-banner')) {
          const banner = document.createElement('div');
          banner.id = 'ed-update-banner';
          banner.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#1a6640;color:#7df5b0;padding:8px 16px;border-radius:8px;font-size:13px;z-index:99999;font-family:Segoe UI,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
          banner.textContent = '⬇ Mise à jour en cours de téléchargement…';
          document.body.appendChild(banner);
        }
      `).catch(() => {});
    }
  });

  autoUpdater.on("update-not-available", () => {
    console.log("Application à jour.");
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`Mise à jour v${info.version} téléchargée.`);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        const banner = document.getElementById('ed-update-banner');
        if (banner) banner.textContent = '✓ Mise à jour prête — sera installée à la fermeture';
      `).catch(() => {});
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("Erreur auto-updater :", err.message);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error("Impossible de vérifier les mises à jour :", err.message);
  });

  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("Erreur vérification périodique :", err.message);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = { setupAutoUpdater };
