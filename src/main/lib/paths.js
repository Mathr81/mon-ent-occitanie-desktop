const { app } = require("electron");
const fs = require("fs");
const path = require("path");

// Variable d'environnement de developpement : pointe le profil Electron
// vers un dossier HORS du depot, pour garder une session persistante sans
// laisser d'identifiants chiffres dans l'arborescence du projet.
const DEV_USER_DATA_ENV = "ED_DEV_USER_DATA";

// Partie decidable sans Electron, donc testable.
function chooseUserDataPath({ override, defaultPath }) {
  if (typeof override === "string" && override.trim() !== "") {
    return path.resolve(override.trim());
  }
  return defaultPath;
}

function resolveUserDataPath() {
  const chosen = chooseUserDataPath({
    override: process.env[DEV_USER_DATA_ENV],
    defaultPath: app.getPath("userData"),
  });

  if (chosen !== app.getPath("userData")) {
    if (!fs.existsSync(chosen)) fs.mkdirSync(chosen, { recursive: true });
    app.setPath("userData", chosen);
  }

  return chosen;
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

module.exports = {
  chooseUserDataPath,
  resolveUserDataPath,
  getCustomExtensionPath,
  getAssetPath,
  DEV_USER_DATA_ENV,
};
