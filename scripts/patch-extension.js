// scripts/patch-extension.js
//
// Copie CustomDirecte/src vers .cache/extension/ puis patche la copie.
// Le submodule n'est jamais ecrit : il reste read-only.
//
// Idempotent par construction : on supprime, on recopie, on patche du neuf.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "CustomDirecte", "src");
const DEST = path.join(__dirname, "..", ".cache", "extension");

const PATCHES = {
  "scripts/background.js": [["browser.storage.sync", "browser.storage.local"]],
  "scripts/main.js": [
    ["browser.storage.sync", "browser.storage.local"],
    ["chrome.storage.sync", "chrome.storage.local"],
  ],
  "pages/popup/interface.js": [["browser.storage.sync", "browser.storage.local"]],
};

if (!fs.existsSync(SRC)) {
  console.error(`[patch] Submodule absent : ${SRC}`);
  console.error("[patch] Lancez : git submodule update --init --recursive");
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });
console.log(`[patch] Copie ${SRC} -> ${DEST}`);

for (const [relPath, patches] of Object.entries(PATCHES)) {
  const file = path.join(DEST, relPath);

  if (!fs.existsSync(file)) {
    console.warn(`[patch] Absent, ignore : ${relPath}`);
    continue;
  }

  let content = fs.readFileSync(file, "utf8");
  let total = 0;

  for (const [from, to] of patches) {
    const count = content.split(from).length - 1;
    if (count > 0) {
      content = content.replaceAll(from, to);
      total += count;
    }
  }

  if (total > 0) {
    fs.writeFileSync(file, content, "utf8");
    console.log(`[patch] ${relPath} : ${total} remplacement(s)`);
  } else {
    console.log(`[patch] ${relPath} : rien a patcher`);
  }
}

if (!fs.existsSync(path.join(DEST, "manifest.json"))) {
  console.error("[patch] manifest.json absent de la sortie !");
  process.exit(1);
}

console.log("[patch] Termine");
