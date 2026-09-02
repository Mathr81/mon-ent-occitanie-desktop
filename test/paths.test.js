const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chooseUserDataPath } = require("../src/main/lib/paths");

const DEFAULT = path.join("C:", "Users", "x", "AppData", "Roaming", "Mon EcoleDirecte");

test("sans surcharge, retombe sur le chemin normal", () => {
  assert.equal(chooseUserDataPath({ override: undefined, defaultPath: DEFAULT }), DEFAULT);
});

test("une surcharge vide est ignoree", () => {
  assert.equal(chooseUserDataPath({ override: "", defaultPath: DEFAULT }), DEFAULT);
  assert.equal(chooseUserDataPath({ override: "   ", defaultPath: DEFAULT }), DEFAULT);
});

test("une surcharge est resolue en chemin absolu", () => {
  const result = chooseUserDataPath({ override: "dev-profile", defaultPath: DEFAULT });
  assert.equal(path.isAbsolute(result), true);
  assert.equal(path.basename(result), "dev-profile");
});

test("une surcharge absolue est conservee telle quelle", () => {
  const abs = path.join("D:", "profils", "ed-dev");
  assert.equal(chooseUserDataPath({ override: abs, defaultPath: DEFAULT }), path.resolve(abs));
});
