const { BrowserWindow } = require("electron");
const path = require("path");

async function createLoginWindow(parent) {
  const loginWindow = new BrowserWindow({
    width: 400,
    height: 300,
    modal: true,
    parent,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  await loginWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "login", "login.html"));

  return loginWindow;
}

module.exports = { createLoginWindow };
