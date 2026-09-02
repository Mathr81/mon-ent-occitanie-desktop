// Raccourcis clavier de l'application.
//
// Historiquement cables sur globalShortcut, ce qui ne marchait qu'a moitie :
// sous Windows, register() refuse F5, F12 et CommandOrControl+R — il renvoie
// false, sans erreur — la ou il accepte Alt+Left et Alt+Right. Seule la
// navigation fonctionnait donc.
//
// globalShortcut etait de toute facon le mauvais outil : il enregistre des
// hotkeys au niveau du systeme, donc confisques a toutes les autres
// applications, y compris quand la fenetre n'a pas le focus. Ce sont des
// raccourcis d'application. before-input-event est attache a un webContents
// et ne se declenche que sur une frappe qui lui est destinee.

/**
 * Traduit une frappe en action, ou null. Partie decidable sans Electron,
 * donc testable — y compris pour les conventions macOS qu'on ne peut pas
 * essayer ici.
 *
 * `input` est l'objet fourni par before-input-event.
 */
function resolveShortcut(input, platform) {
  if (!input || input.type !== "keyDown") return null;

  const isMac = platform === "darwin";
  // La touche « commande » du systeme : Cmd sur macOS, Ctrl ailleurs.
  const cmd = isMac ? input.meta : input.control;
  // Un raccourci a Ctrl sur macOS, ou a Cmd ailleurs, n'est pas le notre.
  const wrongCmd = isMac ? input.control : input.meta;
  if (wrongCmd) return null;

  switch (input.key) {
    case "F5":
      return cmd || input.shift ? "reload-hard" : "reload";
    case "F12":
      return "devtools";
    case "r":
    case "R":
      if (!cmd) return null;
      return input.shift ? "reload-hard" : "reload";
    case "I":
    case "i":
      // Cmd+Alt+I sur macOS, la convention y remplace F12.
      return isMac && cmd && input.alt ? "devtools" : null;
    case "ArrowLeft":
      // Alt+Fleche partout, et Cmd+Fleche en plus sur macOS.
      return input.alt || (isMac && cmd) ? "back" : null;
    case "ArrowRight":
      return input.alt || (isMac && cmd) ? "forward" : null;
    default:
      return null;
  }
}

// Applique l'action sur le webContents qui porte reellement le contenu.
// Dans la fenetre popup c'est le guest <webview>, pas le document d'habillage :
// recharger celui-ci reviendrait a vider la fenetre.
function runShortcut(action, contents) {
  if (!contents || contents.isDestroyed()) return;

  switch (action) {
    case "reload":
      contents.reload();
      return;
    case "reload-hard":
      contents.reloadIgnoringCache();
      return;
    case "devtools":
      contents.isDevToolsOpened()
        ? contents.closeDevTools()
        : contents.openDevTools({ mode: "detach" });
      return;
    case "back":
      contents.navigationHistory.goBack();
      return;
    case "forward":
      contents.navigationHistory.goForward();
      return;
  }
}

/**
 * Ecoute les frappes d'un webContents et agit sur celui que `target` designe.
 * Par defaut on agit sur celui qui a recu la frappe.
 */
function attachShortcuts(contents, target = () => contents) {
  contents.on("before-input-event", (event, input) => {
    const action = resolveShortcut(input, process.platform);
    if (!action) return;
    event.preventDefault();
    runShortcut(action, target());
  });
}

/**
 * Cable les raccourcis d'une fenetre, guests <webview> compris.
 *
 * Les frappes faites dans un <webview> ne remontent pas au webContents de la
 * fenetre : sans cet attachement, les raccourcis cessaient de repondre des
 * qu'on cliquait dans la page de la fenetre popup.
 */
function registerWindowShortcuts(win) {
  let guest = null;

  win.webContents.on("did-attach-webview", (event, webViewContents) => {
    guest = webViewContents;
    attachShortcuts(webViewContents);
    webViewContents.on("destroyed", () => {
      if (guest === webViewContents) guest = null;
    });
  });

  // Depuis l'habillage de la fenetre, on agit sur le guest s'il y en a un.
  attachShortcuts(win.webContents, () => guest || win.webContents);
}

module.exports = { resolveShortcut, runShortcut, registerWindowShortcuts };
