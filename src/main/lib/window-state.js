const { app } = require("electron");
const fs = require("fs");
const path = require("path");

// Conserve la taille choisie par l'utilisateur d'une ouverture a l'autre.
// Fichier separe des identifiants : rien de sensible ici.
function stateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readAll() {
  try {
    if (!fs.existsSync(stateFile())) return {};
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function loadWindowState(name) {
  const entry = readAll()[name];
  if (!entry || !Number.isFinite(entry.width) || !Number.isFinite(entry.height)) return null;
  return { width: entry.width, height: entry.height };
}

function saveWindowState(name, { width, height }) {
  try {
    const all = readAll();
    all[name] = { width: Math.round(width), height: Math.round(height) };
    fs.writeFileSync(stateFile(), JSON.stringify(all));
  } catch (err) {
    console.warn("Impossible d'enregistrer la taille de fenêtre :", err.message);
  }
}

module.exports = { loadWindowState, saveWindowState };
