// Empeche la boucle infinie de re-login : une redirection vers /login
// relance le flux, mais avec un mot de passe devenu faux ou EcoleDirecte
// indisponible, cela tournerait sans fin.
function createReloginGuard({ maxAttempts = 3, delays = [2000, 4000, 8000] } = {}) {
  let attempts = 0;

  return {
    shouldRetry: () => attempts < maxAttempts,
    nextDelay: () => delays[Math.min(attempts, delays.length - 1)],
    recordAttempt: () => { attempts += 1; },
    reset: () => { attempts = 0; },
    get attempts() { return attempts; },
  };
}

module.exports = { createReloginGuard };
