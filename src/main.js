const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { checkForUpdates } = require('./bin/updater');
const logger = require('./bin/logger');

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(app.getAppPath(), 'src', 'renderer', 'static', 'img', 'logo.png'),
    frame: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'src', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.setMenu(null);

  const loadPage = (page, data = {}) => {
    const viewsPath = path.join(app.getAppPath(), 'src', 'renderer', 'views');
    const templatePath = path.join(viewsPath, `${page}.ejs`);
    const outputPath = path.join(app.getPath('temp'), `${page}.html`);
    logger.info(`Loading page: ${viewsPath}/${page}.ejs`);
    fs.readFile(templatePath, 'utf-8', (err, template) => {
      if (err) {
        logger.error(`Error reading the template file: ${err}`);
        return;
      }
      const html = ejs.render(template, data, { views: [viewsPath] });
      fs.writeFile(outputPath, html, (err) => {
        if (err) {
          logger.error(`Error writing the HTML file: ${err}`);
          return;
        }
        win.loadFile(outputPath);
      });
    });
  };

  const loadApplications = (callback) => {
    const userDbPath = path.join(app.getPath('userData'), 'applications.db');
    const defaultDbPath = path.join(process.resourcesPath, 'applications.db');
    logger.info(`Reading the database: ${userDbPath}`);

    // Copier la base de données si elle n'existe pas encore dans userData
    if (!fs.existsSync(userDbPath)) {
      if (fs.existsSync(defaultDbPath) && fs.statSync(defaultDbPath).size > 0) {
        fs.copyFileSync(defaultDbPath, userDbPath);
        logger.info(`Database copied to ${userDbPath}`);
      } else {
        logger.error(`ERROR: Default database is missing or empty at ${defaultDbPath}`);
      }
    }
    if (fs.existsSync(userDbPath) && fs.statSync(userDbPath).size === 0) {
      logger.warn(`WARNING: Database is empty! Replacing with default database.`);
      fs.unlinkSync(userDbPath);  // Supprimer la base vide
      fs.copyFileSync(defaultDbPath, userDbPath); // Recopier la base originale
  }
  
    try {
      const db = new sqlite3.Database(userDbPath, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
          logger.error(`Erreur ouverture DB: ${err.message}`);
        }
      });
      db.all("SELECT * FROM applications", (err, rows) => {
        if (err) {
          logger.error(`Error reading the database: ${err}. ${userDbPath}`);
          callback([]);
          return;
        }
        callback(rows);
      });

      db.close((err) => {
        if (err) {
          logger.error(`Error closing the database: ${err}`);
        }
      });
    } catch (err) {
      logger.error(`Unexpected error: ${err}`);
      callback([]);
    }
  };

  loadApplications((apps) => {
    loadPage('index', { apps });
  });

  ipcMain.on('navigate-to-page', (event, page) => {
    loadApplications((apps) => {
      loadPage(page, { apps });
    });
  });
};

app.whenReady().then(() => {
  logger.info('Application is ready, checking for updates');
  checkForUpdates();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    logger.info('All windows closed, quitting the application');
    app.quit();
  }
});