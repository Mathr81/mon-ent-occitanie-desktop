const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chooseUserDataPath } = require("../src/main/lib/paths");

const PROD = path.join("C:", "Users", "x", "AppData", "Roaming", "Mon EcoleDirecte");
const DEV = path.join("C:", "Users", "x", "AppData", "Roaming", "Mon EcoleDirecte (dev)");

test("hors developpement, le profil normal", () => {
  assert.equal(
    chooseUserDataPath({ override: undefined, isDevelopment: false, devPath: DEV, defaultPath: PROD }),
    PROD
  );
});

// Deux processus Chromium sur un meme profil cassent le cache et la base
// des service workers : l'extension cesse de fonctionner. Le developpement
// ne doit donc jamais partager le profil de l'application installee.
test("en developpement, un profil distinct de l'application installee", () => {
  const result = chooseUserDataPath({
    override: undefined, isDevelopment: true, devPath: DEV, defaultPath: PROD,
  });
  assert.equal(result, DEV);
  assert.notEqual(result, PROD);
});

test("la surcharge gagne sur le profil de developpement", () => {
  const result = chooseUserDataPath({
    override: "autre-profil", isDevelopment: true, devPath: DEV, defaultPath: PROD,
  });
  assert.equal(path.basename(result), "autre-profil");
  assert.equal(path.isAbsolute(result), true);
});

test("une surcharge vide est ignoree", () => {
  assert.equal(
    chooseUserDataPath({ override: "   ", isDevelopment: false, devPath: DEV, defaultPath: PROD }),
    PROD
  );
});

test("une surcharge absolue est conservee telle quelle", () => {
  const abs = path.join("D:", "profils", "ed-dev");
  assert.equal(
    chooseUserDataPath({ override: abs, isDevelopment: false, devPath: DEV, defaultPath: PROD }),
    path.resolve(abs)
  );
});
