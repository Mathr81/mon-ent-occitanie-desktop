// Previsualise et mesure les fenetres maison.
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-windows.js [dossier-de-sortie]
//
// Capture chaque fenetre et verifie qu'aucune n'ouvre plus grande que la
// zone de travail. La fenetre 2FA est testee avec le pire cas realiste :
// question tres longue et propositions verbeuses, puisque les deux viennent
// de l'API et que leur longueur varie.
const { app, screen } = require("electron");
const fs = require("fs");
const path = require("path");

const { createLoginWindow } = require("../src/main/windows/login-window");
const { createTwoFaWindow } = require("../src/main/windows/twofa-window");
const { createPopupWindow } = require("../src/main/windows/popup-window");

const outDir = process.argv[2] || path.join(__dirname, "..", ".cache", "window-shots");
const log = (...a) => process.stdout.write("[win] " + a.join(" ") + "\n");

const LONG_QUESTION =
  "Quel est le nom de jeune fille de votre mère, tel qu'il figure sur votre " +
  "dossier d'inscription déposé auprès de l'établissement scolaire ?";

const VERBOSE_PROPOSITIONS = [
  "SECONDE GÉNÉRALE ET TECHNOLOGIQUE — GROUPE 2 (ENSEIGNEMENT D'EXPLORATION)",
  "PREMIÈRE GÉNÉRALE SPÉCIALITÉ MATHÉMATIQUES ET PHYSIQUE-CHIMIE",
  "TERMINALE PROFESSIONNELLE MÉTIERS DE L'ACCUEIL ET DE LA RELATION CLIENT",
  "QUATRIÈME SECTION EUROPÉENNE ANGLAIS — CLASSE À HORAIRES AMÉNAGÉS",
  "TROISIÈME PRÉPARATOIRE AUX FORMATIONS PROFESSIONNELLES (3e PREPA-METIERS)",
  "CINQUIÈME SEGPA — SECTION D'ENSEIGNEMENT GÉNÉRAL ET PROFESSIONNEL ADAPTÉ",
];

async function shoot(win, name, workArea) {
  await new Promise((r) => setTimeout(r, 900));

  const [w, h] = win.getSize();
  const [cw, ch] = win.getContentSize();
  const fitsW = w <= workArea.width;
  const fitsH = h <= workArea.height;

  log(
    `${name.padEnd(7)} fenetre ${w}x${h}  contenu ${cw}x${ch}  ` +
      `zone de travail ${workArea.width}x${workArea.height}  ` +
      `${fitsW && fitsH ? "OK" : "TROP GRANDE"}`
  );

  // Le debordement peut se produire DANS un conteneur defilant (.ed-body)
  // sans que le document lui-meme defile : mesurer seulement le document
  // laisse passer un champ coupe.
  try {
    const raw = await win.webContents.executeJavaScript(`
      JSON.stringify({
        doc: {
          scroll: document.documentElement.scrollHeight,
          client: document.documentElement.clientHeight,
        },
        inner: [...document.querySelectorAll('.ed-body')].map((el) => ({
          scroll: el.scrollHeight,
          client: el.clientHeight,
        })),
        naturalHeight: (() => {
          const w = document.querySelector('.ed-window');
          if (!w) return null;
          const prev = w.style.height;
          w.style.height = 'auto';
          const body = w.querySelector('.ed-body');
          const prevB = body && body.style.overflow;
          if (body) body.style.overflow = 'visible';
          const h = w.scrollHeight;
          w.style.height = prev;
          if (body) body.style.overflow = prevB;
          return h;
        })(),
        actionsVisible: (() => {
          const a = document.querySelector('.ed-actions');
          if (!a) return null;
          const r = a.getBoundingClientRect();
          return r.bottom <= window.innerHeight + 1 && r.top >= 0;
        })(),
      })
    `);
    const o = JSON.parse(raw);
    const docOverflow = o.doc.scroll > o.doc.client;
    const innerOverflow = o.inner.filter((i) => i.scroll > i.client + 1);

    log(
      `${" ".repeat(8)}document ${o.doc.scroll}/${o.doc.client}` +
        (docOverflow ? " DEFILE" : "") +
        (innerOverflow.length
          ? `  .ed-body DEBORDE ${innerOverflow.map((i) => i.scroll + "/" + i.client).join(", ")}`
          : "  .ed-body sans debordement") +
        (o.naturalHeight ? `  hauteur naturelle ${o.naturalHeight}px` : "") +
        (o.actionsVisible === null ? "" : `  actions: ${o.actionsVisible ? "visibles" : "MASQUEES"}`)
    );
  } catch (err) {
    log(`${" ".repeat(8)}mesure impossible : ${err.message}`);
  }

  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });

  const display = screen.getPrimaryDisplay();
  const workArea = display.workAreaSize;
  log(`echelle ecran ${display.scaleFactor}x  zone de travail ${workArea.width}x${workArea.height}`);
  log("");

  // On garde les fenetres ouvertes jusqu'a la fin : detruire la derniere
  // fenetre declencherait window-all-closed, donc app.quit(), et les
  // chargements suivants echoueraient en ERR_FAILED.
  const windows = [];

  const login = await createLoginWindow(null);
  windows.push(login);
  await shoot(login, "login", workArea);

  const twofa = await createTwoFaWindow(null, {
    question: LONG_QUESTION,
    propositions: VERBOSE_PROPOSITIONS,
  });
  windows.push(twofa);
  await shoot(twofa, "twofa", workArea);

  const popup = createPopupWindow("https://example.com/");
  windows.push(popup);
  await shoot(popup, "popup", workArea);

  log("");
  log("captures :", outDir);
  windows.forEach((w) => w.destroy());
  app.quit();
}).catch((err) => {
  log("ERREUR :", err && err.stack);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
