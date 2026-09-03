// Detection de l'expiration de session, cote processus principal.
//
// L'API EcoleDirecte repond HTTP 200 avec le code metier dans le corps, mais
// elle le pose AUSSI dans l'en-tete `x-code` — verifie contre le service
// reel avec un jeton bidon :
//
//   HTTP/1.1 200 OK
//   x-code: 520
//   {"code":520, "token":"", "message":"Token invalide !", ...}
//
// C'est ce qui permet de reperer l'expiration depuis webRequest, sans
// injecter de code dans la page ni dependre du DOM du site.
//
// Le SPA tente son propre rafraichissement silencieux avant d'afficher sa
// modale (isReLogin: true, une seule tentative). Sauter sur le premier code
// d'expiration rechargerait donc la page alors qu'elle allait se rattraper
// seule. D'ou la temporisation : un code d'expiration arme, une reponse
// saine desarme, un second code d'expiration declenche tout de suite.

// 520 « Token invalide », 525 « Token expire ». Le SPA les traite ensemble
// sous AccessTokenInvalid.
const EXPIRY_CODES = new Set([520, 525]);

// Delai laisse au SPA pour se rattraper seul.
const GRACE_MS = 2500;

// Les endpoints d'authentification ont leur propre vocabulaire : un 520 y
// designe un jeton de double authentification invalide, et un 250 une 2FA
// demandee. Ni l'un ni l'autre n'est une session expiree, et surtout leurs
// reponses ne doivent pas desarmer la temporisation : l'echec du
// rafraichissement du SPA passe precisement par la.
const AUTH_PATHS = ["/login.awp", "/doubleauth"];

function isAuthEndpoint(url) {
  if (typeof url !== "string") return false;
  const lower = url.toLowerCase();
  return AUTH_PATHS.some((p) => lower.includes(p));
}

/**
 * Lit le code metier dans les en-tetes d'une reponse Electron.
 *
 * `responseHeaders` conserve la casse d'origine et associe chaque nom a un
 * tableau de valeurs, d'ou la recherche insensible a la casse.
 */
function readApiCode(responseHeaders) {
  if (!responseHeaders) return null;

  for (const name of Object.keys(responseHeaders)) {
    if (name.toLowerCase() !== "x-code") continue;

    const raw = responseHeaders[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const code = Number.parseInt(value, 10);
    return Number.isNaN(code) ? null : code;
  }

  return null;
}

/**
 * Machine a etats pure : aucune horloge, aucun minuteur. L'appelant place le
 * minuteur sur "arm", l'annule sur "cancel", et agit sur "fire".
 */
function createExpiryWatcher() {
  let armed = false;

  return {
    /** @returns {"arm"|"cancel"|"fire"|null} */
    note({ url, code }) {
      if (typeof code !== "number" || isAuthEndpoint(url)) return null;

      if (EXPIRY_CODES.has(code)) {
        if (armed) {
          armed = false;
          return "fire";
        }
        armed = true;
        return "arm";
      }

      // Une reponse saine prouve que le jeton est de nouveau accepte.
      if (armed) {
        armed = false;
        return "cancel";
      }

      return null;
    },

    /** Appele quand la temporisation s'est ecoulee sans reponse saine. */
    graceElapsed() {
      if (!armed) return null;
      armed = false;
      return "fire";
    },

    reset() {
      armed = false;
    },

    get armed() {
      return armed;
    },
  };
}

module.exports = { createExpiryWatcher, readApiCode, isAuthEndpoint, EXPIRY_CODES, GRACE_MS };
