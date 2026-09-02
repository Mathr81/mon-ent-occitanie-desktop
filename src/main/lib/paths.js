const { app } = require("electron");
const fs = require("fs");
const path = require("path");

// Variable d'environnement de developpement : pointe le profil Electron
// vers le dossier de son choix.
const DEV_USER_DATA_ENV = "ED_DEV_USER_DATA";

// Suffixe du profil de developpement. Il doit etre distinct du profil de
// l'application installee : deux processus Chromium sur un meme profil
// n'arrivent plus a ecrire le cache ni la base des service workers, et
// l'extension cesse silencieusement de fonctionner.
const DEV_PROFILE_SUFFIX = " (dev)";

/**
 * Partie decidable sans Electron, donc testable.
 *
 * Trois regles, dans l'ordre :
 *   1. une surcharge explicite gagne toujours ;
 *   2. en developpement, profil dedie, hors du depot et distinct de celui
 *      de l'application installee ;
 *   3. sinon, le profil normal.
 */
function chooseUserDataPath({ override, isDevelopment, devPath, defaultPath }) {
  if (typeof override === "string" && override.trim() !== "") {
    return path.resolve(override.trim());
  }
  if (isDevelopment) return devPath;
  return defaultPath;
}

function resolveUserDataPath() {
  const defaultPath = app.getPath("userData");

  const chosen = chooseUserDataPath({
    override: process.env[DEV_USER_DATA_ENV],
    isDevelopment: process.env.NODE_ENV === "development",
    devPath: path.join(app.getPath("appData"), app.getName() + DEV_PROFILE_SUFFIX),
    defaultPath,
  });

  if (chosen !== defaultPath) {
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
  DEV_PROFILE_SUFFIX,
};
