const { screen } = require("electron");

// Marge laissee autour d'une fenetre par rapport a la zone de travail, pour
// qu'elle ne colle jamais aux bords ni ne passe sous la barre des taches.
const WORK_AREA_MARGIN = 48;

/**
 * Partie decidable sans Electron, donc testable — y compris pour des
 * resolutions dont on ne dispose pas (1366x768 typiquement).
 *
 * Une fenetre ne doit jamais s'ouvrir plus grande que la zone de travail,
 * ni plus petite que ce que son contenu exige, dans cet ordre de priorite :
 * la contrainte d'ecran l'emporte sur le minimum de contenu.
 */
function computeWindowSize({ natural, min, max, workArea }) {
  const available = Math.max(1, workArea - WORK_AREA_MARGIN);

  const upper = Math.min(max, available);
  const lower = Math.min(min, available);

  return Math.max(lower, Math.min(natural, upper));
}

/**
 * Mesure la hauteur naturelle du contenu puis redimensionne la fenetre
 * dessus. Au-dela du maximum, c'est .ed-body qui defile : les actions,
 * situees hors de ce conteneur, restent visibles quoi qu'il arrive.
 */
async function fitWindowToContent(win, { width, minHeight, maxHeight }) {
  if (win.isDestroyed()) return;

  // On ne cherche pas a mesurer la hauteur "naturelle" de .ed-window : elle
  // fait height:100%, et la contourner donnait des resultats a quelques
  // pixels pres. On mesure le DEFICIT du conteneur defilant, c'est-a-dire
  // exactement ce qui manque, et on l'ajoute a la hauteur visible actuelle.
  let natural = minHeight;
  try {
    const raw = await win.webContents.executeJavaScript(`(() => {
      const body = document.querySelector('.ed-body');
      return JSON.stringify({
        viewport: document.documentElement.clientHeight,
        deficit: body ? Math.max(0, Math.ceil(body.scrollHeight - body.clientHeight)) : 0,
      });
    })()`);
    const m = JSON.parse(raw);
    // Marge sous-pixel : bordures et hauteurs de ligne fractionnaires
    // suffisent a couper la derniere ligne d'un champ.
    natural = m.viewport + m.deficit + 4;
  } catch {
    // On garde minHeight : mieux vaut une fenetre au minimum utilisable
    // qu'une fenetre non dimensionnee.
  }

  const workArea = screen.getDisplayMatching(win.getBounds()).workAreaSize;

  const height = computeWindowSize({
    natural,
    min: minHeight,
    max: maxHeight,
    workArea: workArea.height,
  });

  const finalWidth = computeWindowSize({
    natural: width,
    min: width,
    max: width,
    workArea: workArea.width,
  });

  if (win.isDestroyed()) return;
  win.setContentSize(finalWidth, height);
  win.center();
}

module.exports = { computeWindowSize, fitWindowToContent, WORK_AREA_MARGIN };
