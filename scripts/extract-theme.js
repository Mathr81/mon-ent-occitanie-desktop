// Releve les valeurs de style reelles du site EcoleDirecte, pour que
// src/renderer/shared/tokens.css soit derive du site et non devine.
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/extract-theme.js
//
// La page de login est utilisee comme reference : elle est accessible sans
// authentification et contient exactement les elements que nos fenetres
// reproduisent (champs, bouton principal, libelles, message d'erreur).
const { app, BrowserWindow } = require("electron");

const out = (...a) => process.stdout.write("[theme] " + a.join(" ") + "\n");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadURL("https://www.ecoledirecte.com/login");
  await new Promise((r) => setTimeout(r, 4000));

  const result = await win.webContents.executeJavaScript(`(() => {
    const cs = (el) => el ? getComputedStyle(el) : null;
    const pick = (el, props) => {
      const s = cs(el);
      if (!s) return null;
      const o = {};
      for (const p of props) o[p] = s.getPropertyValue(p);
      return o;
    };

    const body = document.body;
    const input = document.querySelector('input[type="text"], input[type="password"], #username');
    const button = document.querySelector('#connexion, button[type="submit"], .btn-primary, button');
    const label = document.querySelector('label');
    const link = document.querySelector('a');
    const heading = document.querySelector('h1, h2, h3');

    // Toutes les couleurs de fond et de texte reellement employees, par frequence.
    const freq = (fn) => {
      const m = new Map();
      document.querySelectorAll('*').forEach((el) => {
        const v = fn(getComputedStyle(el));
        if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'none') return;
        m.set(v, (m.get(v) || 0) + 1);
      });
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    };

    return {
      body: pick(body, ['font-family','font-size','color','background-color','line-height']),
      heading: heading ? { tag: heading.tagName, ...pick(heading, ['font-size','font-weight','color','margin-bottom']) } : null,
      label: pick(label, ['font-size','font-weight','color','margin-bottom']),
      input: pick(input, ['height','padding','font-size','color','background-color','border','border-radius','box-shadow']),
      button: button ? { text: button.textContent.trim().slice(0,30), ...pick(button, ['height','padding','font-size','font-weight','color','background-color','border','border-radius','text-transform']) } : null,
      link: pick(link, ['color','text-decoration-line']),
      topColors: freq((s) => s.backgroundColor),
      topTextColors: freq((s) => s.color),
      radii: freq((s) => s.borderRadius),
      fonts: freq((s) => s.fontFamily),
    };
  })()`);

  out(JSON.stringify(result, null, 2));
  app.quit();
}).catch((e) => { out("ERREUR :", e && e.message); app.quit(); });

app.on("window-all-closed", () => app.quit());
