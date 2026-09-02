const { BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { getCustomExtensionPath } = require("../lib/paths");

function loadCustomExtension(session) {
  const extensionPath = getCustomExtensionPath();
  console.log("Chargement extension :", extensionPath);

  if (!fs.existsSync(extensionPath)) {
    console.error("Dossier extension introuvable :", extensionPath);
    return false;
  }

  const manifestPath = path.join(extensionPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("manifest.json introuvable :", manifestPath);
    return false;
  }

  try {
    if (BrowserWindow.addExtension) {
      BrowserWindow.addExtension(extensionPath);
    } else {
      session.extensions.loadExtension(extensionPath);
    }
    console.log("Extension chargée !");
    return true;
  } catch (err) {
    console.error("Erreur chargement extension :", err);
    return false;
  }
}

module.exports = { loadCustomExtension };
