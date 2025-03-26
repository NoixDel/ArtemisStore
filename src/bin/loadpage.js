// loadPage.js
// Description: Fonction qui charge une page HTML dans une fenêtre Electron.

const { app } = require('electron');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');
const logger = require('../bin/logger');
const packageJson = require('../../package.json'); 

const appData = {
  version: packageJson.version,
  author: packageJson.author,
  githubLink: packageJson.homepage
};

const loadPage = (win, page, data = {}) => {
    const viewsPath = path.join(app.getAppPath(), 'src', 'renderer', 'views');
    const templatePath = path.join(viewsPath, `${page}.ejs`);
    const outputPath = path.join(app.getPath('temp'), `${page}.html`);
    logger.info(`Loading page: ${viewsPath}/${page}.ejs`);
    fs.readFile(templatePath, 'utf-8', (err, template) => {
      if (err) {
        logger.error(`Error reading the template file: ${err}`);
        return;
      }
      const html = ejs.render(template, { ...data, ...appData }, { views: [viewsPath] });
      fs.writeFile(outputPath, html, (err) => {
        if (err) {
          logger.error(`Error writing the HTML file: ${err}`);
          return;
        }
        win.loadFile(outputPath).catch((loadErr) => {
          logger.error(`Error loading the HTML file: ${loadErr}`);
        });
      });
    });
};

module.exports = loadPage;