// main.js
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fse = require('fs-extra'); 
const os = require('os');
const { exec } = require('child_process');

// --- VERROU SINGLE INSTANCE (évite caches concurrents / 0x5) ---
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// --- FICHER USERDATA AVANT TOUT (corrige "path ... Received null") ---
const userDataDir = path.join(app.getPath('appData'), 'artemisstore');
try { fs.mkdirSync(userDataDir, { recursive: true }); } catch {}
app.setPath('userData', userDataDir);

// --- IMPORTS APRES fix userData (important pour les modules qui lisent des chemins) ---
const { checkForUpdates } = require('./bin/updater');
const logger = require('./bin/logger');
const loadPage = require('./bin/loadpage');

// IMPORTING FUNCTIONS
const loadApplications = require('./function/LoadApplications');
const { setupInstallUninstallListeners } = require('./function/InstallUninstall');
const getWinOfficeInfo = require('./function/GetWinOfficeInfo');
const { checkServiceStatus, setupServiceCheckListener } = require('./function/CheckService');
const { getUpgradableApps, UpdatesAppsListener } = require('./function/UpdateApps');
const { initSettingsManager, readSettings } = require('./function/settingsManager');
const { setupDownloadOfficeListener } = require('./function/DownloadOffice');
const setupActivateOfficeListener = require('./function/ActivateOffice');
console.log('[main.js] Type de setupActivateOfficeListener:', typeof setupActivateOfficeListener);

// Initialise le settings manager maintenant que userData est fixé
initSettingsManager();
const settings = readSettings() || { autoUpdate: false };

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(app.getAppPath(), 'src', 'renderer', 'static', 'img', 'newlogorbg.png'),
    frame: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'src', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
    },
  });

  win.setMenu(null);

  loadPage(win, 'index', { apps: [] });

  win.webContents.once('did-finish-load', () => {
    logger.info('Page index.ejs chargée, envoi des applications...');
    loadApplications((apps) => {
      win.webContents.send('load-apps', apps);
    });
  });

  ipcMain.on('navigate-to-page', async (_event, page) => {
    logger.info(`Navigating to page: ${page}`);

    if (page === 'index') {
      loadPage(win, 'index', { apps: [] });
      win.webContents.once('did-finish-load', () => {
        loadApplications((apps) => {
          win.webContents.send('load-apps', apps);
        });
      });

    } else if (page === 'winoffice') {
      loadPage(win, page);

      const winRef = BrowserWindow.getAllWindows()[0];
      winRef.webContents.once('did-finish-load', () => {
        logger.info('Getting Windows and Office information in the background');

        getWinOfficeInfo()
          .then((winOfficeInfo) => {
            winRef.webContents.send('win-office-info', winOfficeInfo);
          })
          .catch((error) => {
            logger.error(`Error getting Windows and Office information: ${error}`);
            winRef.webContents.send('win-office-info', null);
          });
      });

    } else if (page === 'updates') {
      loadPage(win, 'updates'); // pas besoin d’envoyer de données
      const updates = await getUpgradableApps();
      win.webContents.send('updates-list', updates); // données JS

    } else if (page === 'settings') {
      loadPage(win, page);

    } else {
      loadPage(win, page);
    }
  });

  // TEMPORAIRE : A rajouter dans WinOffice Listener
  ipcMain.on('refresh-win-office-info', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    logger.info('[main.js] Actualisation des informations Windows et Office');
    try {
      const winOfficeInfo = await getWinOfficeInfo();
      win.webContents.send('win-office-info', winOfficeInfo);
    } catch (error) {
      logger.error('[main.js] Erreur lors de l’actualisation des infos :', error);
      win.webContents.send('win-office-info', null);
    }
  });

  // Terminal de logs (guillemets corrigés)
ipcMain.on('open-log-terminal', () => {
  const user = os.userInfo().username;
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const logPath = `C:\\Users\\${user}\\AppData\\Roaming\\artemisstore\\logs\\app-${yyyy}-${mm}-${dd}.log`;
  const title = `ArtemisStore LOG PAGE ${dd}/${mm}/${yyyy}. La page ne fonctionnera plus à partir de 00h00`;

  const command = `start powershell.exe -NoExit -Command `
    + `"$host.ui.RawUI.WindowTitle='${title}'; `
    + `Get-Content '${logPath}' -Wait | ForEach-Object { `
    + `if ($_ -match 'ERROR') { Write-Host $_ -ForegroundColor Red } `
    + `elseif ($_ -match 'WARN') { Write-Host $_ -ForegroundColor Yellow } `
    + `elseif ($_ -match 'INFO') { Write-Host $_ -ForegroundColor Cyan } `
    + `else { Write-Host $_ } }"`;

  logger.info(`[main.js]: show logging terminal ${command}`);
  exec(command);
});

};

// Assure la copie des ressources au lancement
function ensureResourcesCopied() {
    const source = path.join(process.resourcesPath, 'ressources');
    const dest = path.join(app.getPath('appData'), 'ArtemisStore', 'resources');

    try {
        if (!fs.existsSync(dest)) {
            logger.info('[main.js] Création du dossier resources dans AppData...');
            fs.mkdirSync(dest, { recursive: true });
        }

        logger.info(`[main.js] Copie du dossier ressources -> ${dest}`);
        fse.copySync(source, dest, { overwrite: true });
    } catch (err) {
        logger.error('[main.js] Erreur copie ressources :', err);
    }
}


// --- Optimisations/Workarounds cache Chromium ---
// 1) éviter le shader disk cache (souvent source du 0x5 quand droits foireux)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');



const { fixWingetSources, updateWingetClient } = require('./function/WingetManager');
const runCommand = require('./bin/runcmd');

ipcMain.on('winget-fix-sources', async (event) => {
  await fixWingetSources();
  event.sender.send('winget-status-msg', '✔️ Sources Winget réparées');
});

ipcMain.on('winget-update-client', async (event) => {
  await updateWingetClient();
  event.sender.send('winget-status-msg', '✔️ Winget mis à jour');
});

ipcMain.on('winget-test', async (event) => {
  // ouvre un terminal visible avec une commande Winget
  await runCommand("winget --version", false, true); 
  event.sender.send('winget-status-msg', '🖥️ Fenêtre CMD ouverte pour tester Winget');
});

app.whenReady().then(async () => {
  logger.info('Application is ready, checking for updates');

  // 2) nettoyage doux des caches au démarrage (GPUCache / Code Cache)
  try {
    const gpuCache = path.join(userDataDir, 'GPUCache');
    const codeCache = path.join(userDataDir, 'Code Cache');
    if (fs.existsSync(gpuCache)) fs.rmSync(gpuCache, { recursive: true, force: true });
    if (fs.existsSync(codeCache)) fs.rmSync(codeCache, { recursive: true, force: true });
    try {
      await session.defaultSession.clearStorageData({ storages: ['shader_cache'] });
    } catch (e) {
      logger.warn('[CACHE] clearStorageData(shader_cache) warning:', e);
    }
  } catch (e) {
    logger.warn('[CACHE] Cleanup warning:', e);
  }

  if (settings.autoUpdate) {
    setTimeout(() => checkForUpdates(), 2000);
  } else {
    logger.info('Auto-update is disabled in settings');
  }

  createWindow();
  ensureResourcesCopied();
  setupInstallUninstallListeners();
  UpdatesAppsListener();
  setupDownloadOfficeListener();
  setupActivateOfficeListener();
  // setupServiceCheckListener('artemisinstallerservice.exe');

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
