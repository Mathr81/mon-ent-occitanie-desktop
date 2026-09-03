const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createExpiryWatcher,
  readApiCode,
  isAuthEndpoint,
  GRACE_MS,
} = require("../src/main/auth/expiry-watcher");

const API = "https://api.ecoledirecte.com/v3/eleves/5618/notes.awp?verbe=get";
const LOGIN = "https://api.ecoledirecte.com/v3/login.awp?v=4.101.2";
const DOUBLEAUTH = "https://api.ecoledirecte.com/v3/connexion/doubleauth.awp?verbe=get";

// ---- Lecture de l'en-tete --------------------------------------------

test("lit x-code quelle que soit la casse", () => {
  assert.equal(readApiCode({ "X-Code": ["520"] }), 520);
  assert.equal(readApiCode({ "x-code": ["200"] }), 200);
});

test("accepte une valeur non encapsulee dans un tableau", () => {
  assert.equal(readApiCode({ "x-code": "525" }), 525);
});

test("renvoie null sans en-tete x-code", () => {
  assert.equal(readApiCode({ "content-type": ["application/json"] }), null);
  assert.equal(readApiCode(null), null);
});

test("renvoie null sur une valeur illisible", () => {
  assert.equal(readApiCode({ "x-code": ["abc"] }), null);
});

// ---- Endpoints d'authentification ------------------------------------

test("reconnait les endpoints d'authentification", () => {
  assert.equal(isAuthEndpoint(LOGIN), true);
  assert.equal(isAuthEndpoint(DOUBLEAUTH), true);
  assert.equal(isAuthEndpoint(API), false);
});

// ---- Machine a etats -------------------------------------------------

test("un premier code d'expiration arme la temporisation", () => {
  const w = createExpiryWatcher();
  assert.equal(w.note({ url: API, code: 520 }), "arm");
  assert.equal(w.armed, true);
});

test("525 arme aussi", () => {
  const w = createExpiryWatcher();
  assert.equal(w.note({ url: API, code: 525 }), "arm");
});

test("une reponse saine annule : le SPA s'est rattrape seul", () => {
  const w = createExpiryWatcher();
  w.note({ url: API, code: 520 });
  assert.equal(w.note({ url: API, code: 200 }), "cancel");
  assert.equal(w.armed, false);
});

test("un second code d'expiration declenche sans attendre", () => {
  const w = createExpiryWatcher();
  w.note({ url: API, code: 520 });
  assert.equal(w.note({ url: API, code: 520 }), "fire");
  assert.equal(w.armed, false);
});

test("la temporisation ecoulee declenche", () => {
  const w = createExpiryWatcher();
  w.note({ url: API, code: 520 });
  assert.equal(w.graceElapsed(), "fire");
});

test("la temporisation ecoulee ne declenche rien si rien n'est arme", () => {
  const w = createExpiryWatcher();
  assert.equal(w.graceElapsed(), null);
});

test("une reponse saine hors temporisation ne produit rien", () => {
  const w = createExpiryWatcher();
  assert.equal(w.note({ url: API, code: 200 }), null);
});

// C'est le coeur du probleme : le rafraichissement silencieux du SPA passe
// par login.awp. Si sa reponse desarmait, l'echec du rattrapage annulerait
// notre propre reprise — exactement le cas qu'on veut traiter.
test("la reponse du rafraichissement du SPA ne desarme pas", () => {
  const w = createExpiryWatcher();
  w.note({ url: API, code: 520 });
  assert.equal(w.note({ url: LOGIN, code: 250 }), null);
  assert.equal(w.note({ url: LOGIN, code: 505 }), null);
  assert.equal(w.armed, true, "doit rester arme");
  assert.equal(w.graceElapsed(), "fire");
});

test("un 520 sur un endpoint d'authentification n'arme pas", () => {
  const w = createExpiryWatcher();
  assert.equal(w.note({ url: DOUBLEAUTH, code: 520 }), null);
  assert.equal(w.armed, false);
});

test("une reponse sans code ne change rien", () => {
  const w = createExpiryWatcher();
  w.note({ url: API, code: 520 });
  assert.equal(w.note({ url: API, code: null }), null);
  assert.equal(w.armed, true);
});

test("reset desarme", () => {
  const w = createExpiryWatcher();
  w.note({ url: API, code: 520 });
  w.reset();
  assert.equal(w.armed, false);
  assert.equal(w.graceElapsed(), null);
});

test("la temporisation laisse au SPA de quoi tenter son rafraichissement", () => {
  assert.ok(GRACE_MS >= 2000, "trop court pour un aller-retour reseau");
  assert.ok(GRACE_MS <= 5000, "trop long, l'utilisateur reste bloque");
});
