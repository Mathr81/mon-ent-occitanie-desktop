const { BrowserWindow } = require("electron");
const path = require("path");

async function createTwoFaWindow(parent, { question, propositions }) {
  const twoFaWindow = new BrowserWindow({
    width: 480,
    height: 520,
    modal: true,
    parent,
    title: "Double authentification",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  await twoFaWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "twofa", "twofa.html"));
  twoFaWindow.webContents.send("twofa-question", { question, propositions });

  return twoFaWindow;
}

module.exports = { createTwoFaWindow };
