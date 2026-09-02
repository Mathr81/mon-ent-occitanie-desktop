const test = require("node:test");
const assert = require("node:assert/strict");
const { computeWindowSize, WORK_AREA_MARGIN } = require("../src/main/windows/fit-to-content");

// Zone de travail d'un 1366x768 sous Windows : ~728 px utiles une fois la
// barre des taches deduite. C'est la resolution ou les fenetres cassent.
const SMALL = 728;
const LARGE = 912;

test("suit la hauteur naturelle du contenu entre le min et le max", () => {
  assert.equal(computeWindowSize({ natural: 400, min: 300, max: 600, workArea: LARGE }), 400);
});

test("ne descend pas sous le minimum", () => {
  assert.equal(computeWindowSize({ natural: 120, min: 300, max: 600, workArea: LARGE }), 300);
});

test("ne depasse pas le maximum", () => {
  assert.equal(computeWindowSize({ natural: 2000, min: 300, max: 600, workArea: LARGE }), 600);
});

test("ne depasse jamais la zone de travail, marge comprise", () => {
  const h = computeWindowSize({ natural: 2000, min: 300, max: 5000, workArea: SMALL });
  assert.equal(h, SMALL - WORK_AREA_MARGIN);
  assert.ok(h < SMALL, "doit rester sous la zone de travail");
});

test("sur petit ecran, la contrainte d'ecran l'emporte sur le minimum", () => {
  // Un minimum de contenu plus grand que l'ecran ne doit pas produire une
  // fenetre hors ecran : mieux vaut une fenetre qui defile.
  const h = computeWindowSize({ natural: 900, min: 900, max: 900, workArea: 400 });
  assert.equal(h, 400 - WORK_AREA_MARGIN);
});

test("1366x768 : la fenetre 2FA la plus haute reste a l'ecran", () => {
  const h = computeWindowSize({ natural: 482, min: 320, max: 620, workArea: SMALL });
  assert.ok(h <= SMALL - WORK_AREA_MARGIN, `hauteur ${h} hors zone de travail`);
  assert.equal(h, 482, "elle tient telle quelle sur cet ecran");
});

test("1366x768 : une 2FA tres longue est bornee, pas hors ecran", () => {
  const h = computeWindowSize({ natural: 1200, min: 320, max: 620, workArea: SMALL });
  assert.equal(h, 620, "bornee par le maximum, pas par l'ecran");
});
