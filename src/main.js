const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dns = require('dns');
const { exec } = require('child_process');

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

const userDataDir = path.join(app.getPath('appData'), 'artemisstore');
try {
    fs.mkdirSync(userDataDir, { recursive: true });
    app.setPath('userData', userDataDir);
} catch (err) {
    app.setPath('userData', userDataDir);
}

const { checkForUpdates } = require('./bin/updater');
const logger = require('./bin/logger');
const loadPage = require('./bin/loadpage');
const loadApplications = require('./function/LoadApplications');
const { setupInstallUninstallListeners } = require('./function/InstallUninstall');
const getWinOfficeInfo = require('./function/GetWinOfficeInfo');
const {
    getUpgradableApps,
    UpdatesAppsListener,
    runAllWingetUpdates,
} = require('./function/UpdateApps');
const { initSettingsManager, readSettings } = require('./function/settingsManager');
const { setupDownloadOfficeListener } = require('./function/DownloadOffice');
const setupActivateOfficeListener = require('./function/ActivateOffice');
const { STARTUP_ARG } = require('./function/startupTask');
const { setupIntegrityCheckListener } = require('./function/IntegrityCheck');
const { setupWinOptimisationsListener } = require('./function/WinOptimisations');
const { refreshApplicationDatabase } = require('./function/ApplicationDatabaseManager');

let mainWindow = null;

app.setAppUserModelId('artemisstore');

function getAppIconPath() {
    return path.join(app.getAppPath(), 'src', 'renderer', 'static', 'img', 'newfavicon.ico');
}

function getMainWindow() {
    return mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getAllWindows()[0] || null;
}

async function loadApplicationsPage(win) {
    await loadPage(win, 'index', { apps: [] });
    logger.info('Page index.ejs chargee, envoi des applications...');
    loadApplications((apps) => {
        if (!win.isDestroyed()) {
            win.webContents.send('load-apps', apps);
        }
    });
}

async function loadWindowsOfficePage(win) {
    await loadPage(win, 'winoffice');
    logger.info('Getting Windows and Office information in the background');

    try {
        const winOfficeInfo = await getWinOfficeInfo();
        if (!win.isDestroyed()) {
            win.webContents.send('win-office-info', winOfficeInfo);
        }
    } catch (error) {
        logger.error(`Error getting Windows and Office information: ${error}`);
        if (!win.isDestroyed()) {
            win.webContents.send('win-office-info', null);
        }
    }
}

async function loadUpdatesPage(win) {
    await loadPage(win, 'updates');
    const updates = await getUpgradableApps();
    if (!win.isDestroyed()) {
        win.webContents.send('updates-list', updates);
    }
}

const createWindow = () => {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: getAppIconPath(),
        frame: true,
        webPreferences: {
            preload: path.join(app.getAppPath(), 'src', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
        },
    });

    mainWindow = win;
    win.setMenu(null);
    void loadApplicationsPage(win);

    win.on('closed', () => {
        if (mainWindow === win) {
            mainWindow = null;
        }
    });
};

function setupMainIpcListeners() {
    ipcMain.on('navigate-to-page', async (event, page) => {
        const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
        if (!win) return;

        logger.info(`Navigating to page: ${page}`);

        if (page === 'index') {
            await loadApplicationsPage(win);
            return;
        }

        if (page === 'winoffice') {
            await loadWindowsOfficePage(win);
            return;
        }

        if (page === 'updates') {
            await loadUpdatesPage(win);
            return;
        }

        await loadPage(win, page);
    });

    ipcMain.on('refresh-win-office-info', async () => {
        const win = getMainWindow();
        if (!win) return;

        logger.info('[main.js] Actualisation des informations Windows et Office');
        try {
            const winOfficeInfo = await getWinOfficeInfo();
            win.webContents.send('win-office-info', winOfficeInfo);
        } catch (error) {
            logger.error('[main.js] Erreur lors de l actualisation des infos :', error);
            win.webContents.send('win-office-info', null);
        }
    });

    ipcMain.on('open-log-terminal', () => {
        const user = os.userInfo().username;
        const date = new Date();
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const logPath = `C:\\Users\\${user}\\AppData\\Roaming\\artemisstore\\logs\\app-${yyyy}-${mm}-${dd}.log`;
        const command = `start powershell.exe -NoExit -Command "$host.ui.RawUI.WindowTitle = 'ArtemisStore LOG PAGE ${dd + '/' + mm + '/' + yyyy}. La page ne fonctionnera plus a partir de 00h00' ; Get-Content \\"${logPath}\\" -Wait"`;
        logger.info(`[main.js]: show logging terminal ${command}`);
        exec(command);
    });

    ipcMain.on('open-external-url', (event, url) => {
        try {
            const parsedUrl = new URL(url);
            if (!['https:', 'http:'].includes(parsedUrl.protocol)) return;
            shell.openExternal(parsedUrl.toString());
        } catch (err) {
            logger.warn(`[main.js] URL externe ignoree : ${url}`);
        }
    });

    ipcMain.on('refresh-applications-db', async (event) => {
        try {
            const result = await refreshApplicationDatabase(true);
            event.sender.send('applications-db-refresh-result', { success: true, result });
        } catch (err) {
            logger.error(`[main.js] Echec refresh applications.db : ${err.message}`);
            event.sender.send('applications-db-refresh-result', {
                success: false,
                error: err.message,
            });
        }
    });
}

function waitForInternet(maxAttempts = 60, delayMs = 10000) {
    return new Promise((resolve, reject) => {
        let attempts = 0;

        const check = () => {
            attempts += 1;
            dns.lookup('www.microsoft.com', (err) => {
                if (!err) return resolve();

                if (attempts >= maxAttempts) {
                    return reject(new Error('Internet indisponible apres attente.'));
                }

                logger.info(
                    `[main.js] Internet indisponible, nouvelle tentative ${attempts}/${maxAttempts}`
                );
                setTimeout(check, delayMs);
            });
        };

        check();
    });
}

async function runLoginAppUpdatesIfNeeded(settings) {
    const loginSettings = app.getLoginItemSettings();
    const startedForLoginUpdate =
        process.argv.includes(STARTUP_ARG) || loginSettings.wasOpenedAtLogin;

    if (!settings.updateAppsOnLogin || !startedForLoginUpdate) return false;

    logger.info('[main.js] Mise a jour des logiciels au demarrage de session activee.');
    try {
        await waitForInternet();
        await runAllWingetUpdates(null, false);
    } catch (err) {
        logger.error('[main.js] Echec mise a jour au demarrage de session : ' + err.message);
    }

    return true;
}

app.whenReady().then(async () => {
    initSettingsManager();
    const settings = readSettings();

    const handledLoginUpdates = await runLoginAppUpdatesIfNeeded(settings);
    if (handledLoginUpdates) {
        app.quit();
        return;
    }

    logger.info('Application is ready, checking for updates');
    if (settings.autoUpdate) {
        setTimeout(() => checkForUpdates(), 2000);
    } else {
        logger.info('Auto-update is disabled in settings');
    }

    createWindow();
    setupMainIpcListeners();
    setupInstallUninstallListeners();
    UpdatesAppsListener();
    setupDownloadOfficeListener();
    setupActivateOfficeListener();
    setupIntegrityCheckListener();
    setupWinOptimisationsListener();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        logger.info('All windows closed, quitting the application');
        app.quit();
    }
});
