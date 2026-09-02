const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSessionState,
  toSessionStorageEntries,
  toLocalStorageEntries,
  messagerieBadgeCount,
} = require("../src/main/auth/session-payload");

const LOGIN_RESPONSE = {
  code: 200,
  token: "TOKEN123",
  message: "",
  data: {
    accounts: [
      {
        idLogin: 1324, id: 1234, identifiant: "jdoe", typeCompte: "E",
        main: true, prenom: "John", nom: "DOE",
        modules: [
          { code: "MESSAGERIE", badge: 3 },
          { code: "NOTES", badge: 0 },
        ],
      },
    ],
  },
};

test("buildSessionState extrait le token et les comptes", () => {
  const state = buildSessionState(LOGIN_RESPONSE, 1000);
  assert.equal(state.authToken, "TOKEN123");
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].identifiant, "jdoe");
  assert.equal(state.lastModified, 1000);
});

test("buildSessionState applique les valeurs par defaut du SPA", () => {
  const state = buildSessionState(LOGIN_RESPONSE, 1000);
  assert.equal(state.changementMDP, false);
  assert.equal(state.nbJourMdpExire, 0);
  assert.equal(state.isBloque, false);
  assert.equal(state.urlUnblock, "");
});

test("toSessionStorageEntries produit l'enveloppe payload/lastModified", () => {
  const entries = toSessionStorageEntries(buildSessionState(LOGIN_RESPONSE, 1000));
  const credentials = JSON.parse(entries.credentials);
  assert.deepEqual(credentials, {
    payload: { authToken: "TOKEN123", fcmToken: "", twoFAToken: "" },
    lastModified: 1000,
  });
  const accounts = JSON.parse(entries.accounts);
  assert.equal(accounts.lastModified, 1000);
  assert.equal(accounts.payload.accounts[0].id, 1234);
  assert.equal(accounts.payload.changementMDP, false);
});

test("toSessionStorageEntries n'ecrit jamais edcommonhydration_auth", () => {
  const entries = toSessionStorageEntries(buildSessionState(LOGIN_RESPONSE, 1000));
  assert.deepEqual(Object.keys(entries).sort(), ["accounts", "credentials"]);
});

test("toLocalStorageEntries serialise les cles 2FA", () => {
  const entries = toLocalStorageEntries([{ cn: "a", cv: "b", uniq: false }]);
  assert.deepEqual(JSON.parse(entries.fa), [{ cn: "a", cv: "b", uniq: false }]);
});

test("toLocalStorageEntries renvoie un objet vide sans cles", () => {
  assert.deepEqual(toLocalStorageEntries([]), {});
});

test("messagerieBadgeCount lit le module MESSAGERIE", () => {
  assert.equal(messagerieBadgeCount(buildSessionState(LOGIN_RESPONSE, 1000)), 3);
});

test("messagerieBadgeCount vaut 0 sans module MESSAGERIE", () => {
  const state = buildSessionState({ token: "T", data: { accounts: [{ modules: [] }] } }, 1);
  assert.equal(messagerieBadgeCount(state), 0);
});

test("messagerieBadgeCount vaut 0 sans aucun compte", () => {
  const state = buildSessionState({ token: "T", data: { accounts: [] } }, 1);
  assert.equal(messagerieBadgeCount(state), 0);
});
