// Formes reverse-engineerees du SPA EcoleDirecte.
//
//   AuthStore        -> sessionStorage["accounts"]
//   CredentialsStore -> sessionStorage["credentials"]
//
// Les deux sont serialises par WebStorageService avec l'enveloppe
// { payload, lastModified }. L'intercepteur HTTP du SPA lit le token dans
// credentialsStore.snapshot.authToken et le pose en en-tete X-Token.
//
// Ne jamais ecrire "edcommonhydration_auth" : malgre son nom et son
// enveloppe { payload }, c'est un feature-state NgRx de selection d'annee
// et de variante, pas de l'authentification.

function buildSessionState(loginResponse, now) {
  const data = loginResponse.data || {};
  return {
    authToken: loginResponse.token || "",
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    changementMDP: data.changementMDP !== undefined ? data.changementMDP : false,
    nbJourMdpExire: data.nbJourMdpExire !== undefined ? data.nbJourMdpExire : 0,
    isBloque: data.isBloque !== undefined ? data.isBloque : false,
    urlUnblock: data.urlUnblock !== undefined ? data.urlUnblock : "",
    lastModified: now,
  };
}

function toSessionStorageEntries(state) {
  return {
    credentials: JSON.stringify({
      payload: { authToken: state.authToken, fcmToken: "", twoFAToken: "" },
      lastModified: state.lastModified,
    }),
    accounts: JSON.stringify({
      payload: {
        accounts: state.accounts,
        changementMDP: state.changementMDP,
        nbJourMdpExire: state.nbJourMdpExire,
        isBloque: state.isBloque,
        urlUnblock: state.urlUnblock,
      },
      lastModified: state.lastModified,
    }),
  };
}

function toLocalStorageEntries(faKeys) {
  if (!Array.isArray(faKeys) || faKeys.length === 0) return {};
  return { fa: JSON.stringify(faKeys) };
}

// La reponse de login porte deja le compteur affiche par le menu lateral,
// dans accounts[].modules[] sous le code MESSAGERIE.
function messagerieBadgeCount(state) {
  const accounts = state.accounts || [];
  const account = accounts.find((a) => a.current) || accounts[0];
  if (!account || !Array.isArray(account.modules)) return 0;
  const mod = account.modules.find((m) => m.code === "MESSAGERIE");
  return mod && typeof mod.badge === "number" ? mod.badge : 0;
}

module.exports = {
  buildSessionState,
  toSessionStorageEntries,
  toLocalStorageEntries,
  messagerieBadgeCount,
};
