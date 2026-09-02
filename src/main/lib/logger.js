const fs = require("fs");
const path = require("path");

// Duplique la console vers app.log. A appeler une seule fois, au demarrage.
function initLogger(userDataPath) {
  const logStream = fs.createWriteStream(path.join(userDataPath, "app.log"), { flags: "a" });

  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  const tee = (level, fn) => (...args) => {
    fn(...args);
    logStream.write(`[${level}] ${new Date().toISOString()} ${args.join(" ")}\n`);
  };

  console.log = tee("LOG", original.log);
  console.warn = tee("WARN", original.warn);
  console.error = tee("ERROR", original.error);

  return logStream;
}

module.exports = { initLogger };
