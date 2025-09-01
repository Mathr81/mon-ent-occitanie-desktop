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
  const url = "https://www.ecoledirecte.com/login?cameFrom=%2FAccueil";
  await window.loadURL(url);

  const page = await pie.getPage(browser, window);

  await page.type("#username", "matheo.barthes"); // Remplacez 'votre_identifiant' par votre identifiant réel
  await page.type("#password", "M@th5o122009"); // Remplacez 'votre_mot_de_passe' par votre mot de passe réel

  await page.click("#connexion");

  await page.waitForNavigation();

  console.log("Connexion réussie");

  await sleep(500);

  // Déconnecter Puppeteer du navigateur
  //await browser.disconnect();

  //console.log('Puppeteer déconnecté, le navigateur reste ouvert.');

  //window.destroy();
};

main();