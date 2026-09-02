const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function resolveUserDataPath() {
  if (process.env.NODE_ENV === "development") {
    const dir = path.join(app.getAppPath(), "userData");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    app.setPath("userData", dir);
    return dir;
  }
  return app.getPath("userData");
}

// La sortie patchee de scripts/patch-extension.js. Jamais dans l'asar :
// session.loadExtension() exige un vrai dossier sur disque.
function getCustomExtensionPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "extension")
    : path.join(app.getAppPath(), ".cache", "extension");
}

function getAssetPath(...segments) {
  return path.join(app.getAppPath(), "assets", ...segments);
}

module.exports = { resolveUserDataPath, getCustomExtensionPath, getAssetPath };
