const { app, nativeImage } = require("electron");

// Le badge ne se lit plus dans le DOM.
//
// Les selecteurs CSS d'EcoleDirecte ne correspondaient plus a rien — dont un
// `#menuId-5618` code en dur, l'identifiant eleve d'un seul utilisateur. La
// lecture renvoyait donc 0 et EFFACAIT le compteur juste obtenu a la
// connexion, quelques secondes apres l'avoir pose. D'ou la regle centrale
// ici : une lecture qui echoue conserve la derniere valeur connue.
//
// Trois sources, par ordre de cout croissant :
//
//   1. les authentifications qu'on fait de toute facon (demarrage, reprise
//      sur session expiree) : le compteur est deja dans la reponse, gratuit ;
//   2. sessionStorage["accounts"] de la page, relu localement : gratuit
//      aussi, et capte les rafraichissements que le SPA fait de lui-meme ;
//   3. une connexion API dediee, seule capable de faire apparaitre un
//      NOUVEAU message — le corps des reponses du site nous est inaccessible,
//      onHeadersReceived ne donne que les en-tetes.
//
// La source 3 est donc espacee et bruitee : l'utilisateur est de toute facon
// notifie sur son telephone, et on veut rester discret cote serveur.

let localTimer = null;
let remoteTimer = null;

const DEBUG_BADGE = process.env.NODE_ENV === "development";
function badgeLog(...args) { if (DEBUG_BADGE) console.log("[BADGE]", ...args); }

// Lecture locale : aucune requete, on peut se permettre d'etre frequent.
const LOCAL_INTERVAL_MS = 2 * 60 * 1000;

// Rafraichissement distant : une connexion complete. Espace, et decale
// aleatoirement pour ne jamais tomber au meme instant d'un cycle a l'autre.
const REMOTE_BASE_MS = 30 * 60 * 1000;
const REMOTE_JITTER_MS = 10 * 60 * 1000;

// Premiere lecture locale peu apres le demarrage : le temps que le SPA
// hydrate son store.
const FIRST_LOCAL_MS = 5000;

/**
 * Delai avant le prochain rafraichissement distant : 30 min plus ou moins
 * 10, soit 20 a 40 min. Pur, horloge et alea injectes.
 */
function nextRemoteDelay(random = Math.random) {
  const offset = (random() * 2 - 1) * REMOTE_JITTER_MS;
  return Math.round(REMOTE_BASE_MS + offset);
}

/**
 * Retient le dernier compteur connu. Une lecture qui echoue vaut null et
 * laisse la valeur en place : mieux vaut un badge legerement perime qu'un
 * badge efface a tort.
 */
function createBadgeState(initial = 0) {
  let last = Number.isInteger(initial) && initial >= 0 ? initial : 0;

  return {
    next(count) {
      if (Number.isInteger(count) && count >= 0) last = count;
      return last;
    },
    get value() { return last; },
  };
}

function applyBadge(count, mainWindow) {
  if (process.platform === "darwin" || process.platform === "linux") {
    try { app.setBadgeCount(count); badgeLog("setBadgeCount(" + count + ")"); }
    catch (e) { badgeLog("setBadgeCount non supporte :", e.message); }
  }
  if (process.platform === "win32") {
    if (mainWindow.isDestroyed()) return;
    if (count > 0) { mainWindow.setOverlayIcon(createBadgeImage(count), count + " notification(s)"); badgeLog("Overlay applique"); }
    else { mainWindow.setOverlayIcon(null, ""); badgeLog("Overlay supprime"); }
  }
}

function createBadgeImage(count) {
  badgeLog("Creation image badge :", count);
  const label = count > 99 ? "99+" : String(count);
  try {
    const { createCanvas } = require("canvas");
    const size = 32;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e94560";
    ctx.beginPath(); ctx.arc(size/2, size/2, size/2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "white";
    ctx.font = "bold " + (label.length > 1 ? 14 : 18) + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, size/2, size/2);
    const img = nativeImage.createFromBuffer(canvas.toBuffer("image/png"));
    badgeLog("Canvas OK :", img.isEmpty() ? "VIDE" : "OK");
    return img;
  } catch (e) { badgeLog("Canvas indisponible :", e.message); }
  badgeLog("Fallback bitmap");
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y*size+x)*4;
      const dx = x - size/2 + 0.5, dy = y - size/2 + 0.5;
      if (Math.sqrt(dx*dx+dy*dy) <= size/2) { buf[idx]=233; buf[idx+1]=69; buf[idx+2]=96; buf[idx+3]=255; }
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
  badgeLog("Bitmap :", img.isEmpty() ? "VIDE" : "OK");
  return img;
}

/**
 * Cable les deux cadences.
 *
 * `readLocalCount` et `refreshRemoteCount` renvoient un entier, ou null si la
 * lecture n'a rien donne. Le module ne connait ni auth/ ni windows/ : tout
 * lui est injecte, comme le webContents l'etait deja.
 */
function startBadgePolling({
  mainWindow,
  readLocalCount,
  refreshRemoteCount,
  initialCount = 0,
  random = Math.random,
}) {
  const state = createBadgeState(initialCount);

  async function update(label, read) {
    if (mainWindow.isDestroyed()) return;
    try {
      const raw = await read();
      const count = state.next(raw);
      badgeLog(`${label} : lu ${JSON.stringify(raw)}, retenu ${count}`);
      applyBadge(count, mainWindow);
    } catch (err) {
      badgeLog(`${label} : echec (${err.message}), on garde ${state.value}`);
    }
  }

  badgeLog("Demarrage du suivi du badge");

  setTimeout(() => update("lecture locale initiale", readLocalCount), FIRST_LOCAL_MS);
  localTimer = setInterval(() => update("lecture locale", readLocalCount), LOCAL_INTERVAL_MS);

  // Reprogramme a chaque fois : c'est ce qui rend le decalage aleatoire a
  // chaque cycle, la ou un setInterval fixerait la cadence une fois pour
  // toutes.
  const scheduleRemote = () => {
    const delay = nextRemoteDelay(random);
    badgeLog(`Prochain rafraichissement distant dans ${Math.round(delay / 60000)} min`);
    remoteTimer = setTimeout(async () => {
      await update("rafraichissement distant", refreshRemoteCount);
      if (!mainWindow.isDestroyed()) scheduleRemote();
    }, delay);
  };
  scheduleRemote();

  return state;
}

function stopBadgePolling() {
  if (localTimer) { clearInterval(localTimer); localTimer = null; }
  if (remoteTimer) { clearTimeout(remoteTimer); remoteTimer = null; }
}

module.exports = {
  startBadgePolling,
  stopBadgePolling,
  applyBadge,
  createBadgeState,
  nextRemoteDelay,
  LOCAL_INTERVAL_MS,
  REMOTE_BASE_MS,
  REMOTE_JITTER_MS,
};
