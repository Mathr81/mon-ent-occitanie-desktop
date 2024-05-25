const { BrowserWindow, app, Menu } = require("electron");
const pie = require("puppeteer-in-electron");
const puppeteer = require("puppeteer-core");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const main = async () => {
  await pie.initialize(app);
  const browser = await pie.connect(app, puppeteer);

  const window = new BrowserWindow();
  Menu.setApplicationMenu(null);
  const url =
    "https://cas.mon-ent-occitanie.fr/login?service=https%3A%2F%2Fles-portanelles-lautrec.mon-ent-occitanie.fr%2Fsg.do%3FPROC%3DPAGE_ACCUEIL";
  await window.loadURL(url);

  const page = await pie.getPage(browser, window);

  const buttonSelector =
    "button.btn.btn--naked.js-wayftoggle.btn--lg.btn--as-link.btn--full";
  await page.waitForSelector(buttonSelector);
  const isExpanded = await page.$eval(
    buttonSelector,
    (button) => button.getAttribute("aria-expanded") === "true",
  );
  if (!isExpanded) {
    await page.click(buttonSelector);
  }

  await page.click("#idp-TOULO-EDU_parent_eleve");
  await page.click("#button-submit");

  await page.waitForNavigation();

  const eleveButtonSelector = "#bouton_eleve";
  const eleveButton = await page.$(eleveButtonSelector);
  if (eleveButton) {
    await eleveButton.click();
  }

  await page.type("#username", "********"); // Remplacez 'votre_identifiant' par votre identifiant réel
  await page.type("#password", "********"); // Remplacez 'votre_mot_de_passe' par votre mot de passe réel

  await page.click("#bouton_valider");

  await page.waitForNavigation();

  console.log("Connexion réussie");

  await sleep(3000);

  const acceptButtonSelector = "#tarteaucitronPersonalize2";
  const acceptButton = await page.$(acceptButtonSelector);
  if (acceptButton) {
    await acceptButton.click();
    console.log('Bouton "Tout accepter" cliqué');
  } else {
    console.log('Le bouton "Tout accepter" n\'a pas été trouvé');
  }

  // Déconnecter Puppeteer du navigateur
  //await browser.disconnect();

  //console.log('Puppeteer déconnecté, le navigateur reste ouvert.');

  //window.destroy();
};

main();
