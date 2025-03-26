const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { checkForUpdates } = require('./bin/updater');
const logger = require('./bin/logger');
const loadPage = require('./bin/loadpage');

// IMPORTING FUNCTIONS
const loadApplications = require('./function/LoadApplications');
const { setupInstallUninstallListeners } = require('./function/InstallUninstall');
const getWinOfficeInfo = require('./function/GetWinOfficeInfo');

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(app.getAppPath(), 'src', 'renderer', 'static', 'img', 'logo.png'),
    frame: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'src', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    }
  });

  win.setMenu(null);

  loadApplications((apps) => {
    loadPage(win, 'index', { apps });
  });

  let cachedWinOfficeInfo = null;

  ipcMain.on('navigate-to-page', async (event, page) => {
    logger.info(`Navigating to page: ${page}`);
    if (page === 'index') {
      loadApplications((apps) => {
        loadPage(win, page, { apps });
      });
    } else if (page === 'winoffice') {
      loadPage(win, page, { winOfficeInfo: cachedWinOfficeInfo });

      if (!cachedWinOfficeInfo) {
        const win = BrowserWindow.getAllWindows()[0]; // Récupère la fenêtre principale

        win.webContents.once('did-finish-load', () => {
          logger.info('Getting Windows and Office information in the background');

          // Exécuter la récupération des infos en arrière-plan
          getWinOfficeInfo().then((winOfficeInfo) => {
            cachedWinOfficeInfo = winOfficeInfo;
            win.webContents.send('win-office-info', winOfficeInfo);
          }).catch((error) => {
            logger.error(`Error getting Windows and Office information: ${error}`);
            win.webContents.send('win-office-info', null);
          });
        });
      }
    } else {
      loadPage(win, page);
    }
  });
};

app.whenReady().then(async () => {
  logger.info('Application is ready, checking for updates');
  checkForUpdates();
  createWindow();
  setupInstallUninstallListeners();

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