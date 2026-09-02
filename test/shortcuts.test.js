const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveShortcut } = require("../src/main/features/shortcuts");

// Frappe telle que before-input-event la fournit. Tous les modificateurs
// sont explicites : un champ absent vaut undefined, ce qui masquerait un
// bug de logique.
function key(overrides) {
  return {
    type: "keyDown",
    key: "",
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...overrides,
  };
}

const WIN = "win32";
const MAC = "darwin";

test("ignore les relachements de touche", () => {
  assert.equal(resolveShortcut(key({ type: "keyUp", key: "F5" }), WIN), null);
});

test("ignore une frappe sans raccourci", () => {
  assert.equal(resolveShortcut(key({ key: "a" }), WIN), null);
});

// ---- Rechargement -----------------------------------------------------

test("F5 recharge", () => {
  assert.equal(resolveShortcut(key({ key: "F5" }), WIN), "reload");
});

test("Ctrl+R recharge sous Windows", () => {
  assert.equal(resolveShortcut(key({ key: "r", control: true }), WIN), "reload");
});

test("Ctrl+Maj+R recharge sans le cache, majuscule comprise", () => {
  assert.equal(resolveShortcut(key({ key: "R", control: true, shift: true }), WIN), "reload-hard");
});

test("R seul ne recharge pas", () => {
  assert.equal(resolveShortcut(key({ key: "r" }), WIN), null);
});

test("Ctrl+F5 et Maj+F5 rechargent sans le cache", () => {
  assert.equal(resolveShortcut(key({ key: "F5", control: true }), WIN), "reload-hard");
  assert.equal(resolveShortcut(key({ key: "F5", shift: true }), WIN), "reload-hard");
});

test("Cmd+R recharge sous macOS", () => {
  assert.equal(resolveShortcut(key({ key: "r", meta: true }), MAC), "reload");
});

test("Ctrl+R ne recharge pas sous macOS, ou la touche commande est Cmd", () => {
  assert.equal(resolveShortcut(key({ key: "r", control: true }), MAC), null);
});

test("Cmd+R ne recharge pas sous Windows", () => {
  assert.equal(resolveShortcut(key({ key: "r", meta: true }), WIN), null);
});

// ---- Outils de developpement -----------------------------------------

test("F12 ouvre les outils", () => {
  assert.equal(resolveShortcut(key({ key: "F12" }), WIN), "devtools");
});

test("Cmd+Alt+I ouvre les outils sous macOS", () => {
  assert.equal(resolveShortcut(key({ key: "i", meta: true, alt: true }), MAC), "devtools");
});

test("Ctrl+Alt+I n'ouvre rien sous Windows", () => {
  assert.equal(resolveShortcut(key({ key: "i", control: true, alt: true }), WIN), null);
});

// ---- Navigation -------------------------------------------------------

test("Alt+Fleches naviguent dans l'historique", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft", alt: true }), WIN), "back");
  assert.equal(resolveShortcut(key({ key: "ArrowRight", alt: true }), WIN), "forward");
});

test("Alt+Fleches naviguent aussi sous macOS", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft", alt: true }), MAC), "back");
});

test("Cmd+Fleches naviguent sous macOS", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft", meta: true }), MAC), "back");
  assert.equal(resolveShortcut(key({ key: "ArrowRight", meta: true }), MAC), "forward");
});

test("les fleches seules ne naviguent pas : elles defilent la page", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft" }), WIN), null);
  assert.equal(resolveShortcut(key({ key: "ArrowRight" }), MAC), null);
});

test("Ctrl+Fleches ne navigue pas sous Windows : c'est le deplacement par mot", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft", control: true }), WIN), null);
});

// ---- Robustesse -------------------------------------------------------

test("une entree absente ne fait pas planter", () => {
  assert.equal(resolveShortcut(null, WIN), null);
  assert.equal(resolveShortcut(undefined, WIN), null);
});
