const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { checkForUpdates } = require('./bin/updater');
const logger = require('./bin/logger');
const loadPage = require('./bin/loadpage');
const os = require('os');
const { exec } = require('child_process');

// IMPORTING FUNCTIONS
const loadApplications = require('./function/LoadApplications');
const { setupInstallUninstallListeners } = require('./function/InstallUninstall');
const getWinOfficeInfo = require('./function/GetWinOfficeInfo');
const { checkServiceStatus, setupServiceCheckListener } = require('./function/CheckService');

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
            enableRemoteModule: false,
        },
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
                    getWinOfficeInfo()
                        .then((winOfficeInfo) => {
                            cachedWinOfficeInfo = winOfficeInfo;
                            win.webContents.send('win-office-info', winOfficeInfo);
                        })
                        .catch((error) => {
                            logger.error(`Error getting Windows and Office information: ${error}`);
                            win.webContents.send('win-office-info', null);
                        });
                });
            }
        } else if (page === 'settings') {
            loadPage(win, page);
        } else {
            loadPage(win, page);
        }
    });
    ipcMain.on('open-log-terminal', () => {
        const user = os.userInfo().username;
        const date = new Date();
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const logPath = `C:\\Users\\${user}\\AppData\\Roaming\\artemisstore\\logs\\app-${yyyy}-${mm}-${dd}.log`;
        const command = `start powershell.exe -NoExit -Command "$host.ui.RawUI.WindowTitle = “ArtemisStore LOG PAGE ${dd + '/' + mm + '/' + yyyy}. La page ne fonctionnera plus à partir de 00h00” ; Get-Content \\"${logPath}\\" -Wait"`;
        logger.info(`[main.js]: show logging terminal ${command}`);
        exec(command);
    });
};

app.whenReady().then(async () => {
    logger.info('Application is ready, checking for updates');
    checkForUpdates();
    createWindow();
    setupInstallUninstallListeners();
    //setupServiceCheckListener('artemisinstallerservice.exe');

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
