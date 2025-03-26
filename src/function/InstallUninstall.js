// InstallUninstall.js
// InstallUninstall.js est un fichier qui contient des fonctions pour installer et désinstaller des applications. 
// Il est utilisé pour écouter les événements de l'interface utilisateur et exécuter les commandes d'installation et de désinstallation des applications. 
// Ces fonctions sont appelées dans le fichier main.js pour gérer les événements d'installation et de désinstallation des applications.

const { ipcMain, BrowserWindow } = require('electron');
const { exec } = require('child_process');
const logger = require('../bin/logger');

function setupInstallUninstallListeners() {
  ipcMain.on('install-app', (event, appId, appSource, appArgument) => {
    const win = BrowserWindow.getFocusedWindow();
    logger.info(`Installing app: ${appId} from ${appSource} with argument ${appArgument}`);

    // Execute winget install command
    const installCommand = `${appSource} ${appArgument}`;
    logger.info(`Install command: ${installCommand}`);
    const installProcess = exec(installCommand);

    installProcess.stdout.on('data', (data) => {
      logger.info(`Install progress: ${data}`);
      win.webContents.send('install-progress', { app_id: appId, data });
    });

    installProcess.stderr.on('data', (data) => {
      logger.error(`Install error: ${data}`);
      win.webContents.send('install-progress', { app_id: appId, data });
    });

    installProcess.on('close', (code) => {
      if (code === 0) {
        win.webContents.send('install-complete', { app_id: appId, status: 'success', message: 'Installation completed successfully.' });
      } else {
        win.webContents.send('install-complete', { app_id: appId, status: 'error', message: 'Installation failed.' });
      }
    });
  });

  ipcMain.on('uninstall-app', (event, appId, appArgument) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!appArgument) {
      logger.error('Uninstall argument is missing');
      win.webContents.send('uninstall-complete', { app_id: appId, status: 'error', message: 'Uninstall argument is missing.' });
      return;
    }

    const appIdArgument = appArgument.includes('--id ') ? appArgument.split('--id ')[1] : null;

    // Execute winget uninstall command
    const uninstallCommand = `winget uninstall ${appIdArgument}`;
    logger.info(`Uninstalling app: ${appIdArgument} with command: ${uninstallCommand}`);
    const uninstallProcess = exec(uninstallCommand);

    uninstallProcess.stdout.on('data', (data) => {
      logger.info(`Uninstall progress: ${data}`);
      win.webContents.send('uninstall-progress', { app_id: appId, data });
    });

    uninstallProcess.stderr.on('data', (data) => {
      logger.error(`Uninstall error: ${data}`);
      win.webContents.send('uninstall-progress', { app_id: appId, data });
    });

    uninstallProcess.on('close', (code) => {
      if (code === 0) {
        win.webContents.send('uninstall-complete', { app_id: appId, status: 'success', message: 'Uninstallation completed successfully.' });
      } else {
        win.webContents.send('uninstall-complete', { app_id: appId, status: 'error', message: 'Uninstallation failed.' });
      }
    });
  });
}

module.exports = { setupInstallUninstallListeners };