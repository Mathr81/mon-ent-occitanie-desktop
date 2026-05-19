// scripts/patch-extension.js
const fs = require("fs");
const path = require("path");

const files = [
  {
    path: path.join(__dirname, "../CustomDirecte/src/scripts/background.js"),
    patches: [
      {
        from: "browser.storage.sync",
        to: "browser.storage.local",
      },
    ],
  },
  {
    path: path.join(__dirname, "../CustomDirecte/src/scripts/main.js"),
    patches: [
      {
        from: "browser.storage.sync",
        to: "browser.storage.local",
      },
      {
        from: "chrome.storage.sync",
        to: "chrome.storage.local",
      },
    ],
  },
  {
    path: path.join(__dirname, "../CustomDirecte/src/pages/popup/interface.js"),
    patches: [
      {
        from: "browser.storage.sync",
        to: "browser.storage.local",
      },
    ],
  },
];

let anyError = false;

for (const file of files) {
  if (!fs.existsSync(file.path)) {
    console.warn(`[patch] Fichier introuvable, ignoré : ${file.path}`);
    continue;
  }

  let content = fs.readFileSync(file.path, "utf8");
  let changed = false;

  for (const { from, to } of file.patches) {
    const count = (content.match(new RegExp(from.replace(/\./g, "\\."), "g")) || []).length;
    if (count > 0) {
      content = content.replaceAll(from, to);
      console.log(`[patch] ${path.basename(file.path)} : "${from}" → "${to}" (${count} occurrence(s))`);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file.path, content, "utf8");
    console.log(`[patch] ✓ ${path.basename(file.path)} patché`);
  } else {
    console.log(`[patch] ${path.basename(file.path)} : rien à patcher`);
  }
}

if (!anyError) console.log("[patch] Terminé ✓");