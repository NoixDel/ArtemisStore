// InstallUninstall.js
// Gère l’installation/désinstallation des apps via IPC + runcmd

const { ipcMain, BrowserWindow } = require('electron');
const logger = require('../bin/logger');
const runcmd = require('../bin/runcmd');

function setupInstallUninstallListeners() {
    ipcMain.on('install-app', async (event, appId, appSource, appArgument, appNeedAdm) => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return logger.error('No focused window for install.');

        logger.info(`Installing app: ${appId}, admin: ${appNeedAdm}`);
        if (!appId || appSource !== 'winget') {
            logger.error('Unsupported install source or missing appId');
            win.webContents.send('install-complete', {
                app_id: appId,
                status: 'error',
                message: 'Install source is not supported or appID is missing.',
            });
            return;
        }

        const installCmd = `winget install -e --id ${appId} ${appArgument || ''} --accept-source-agreements --accept-package-agreements --silent`.trim();

        try {
            await runcmd(
                installCmd,
                appNeedAdm == 1,
                false,
                (type, data) => {
                    win.webContents.send('install-progress', { app_id: appId, data });
                }
            );

            win.webContents.send('install-complete', {
                app_id: appId,
                status: 'success',
                message: 'Installation completed.',
            });
        } catch (err) {
            logger.error(`[Install] Error for ${appId}: ${err.message}`);
            win.webContents.send('install-complete', {
                app_id: appId,
                status: 'error',
                message: 'Installation failed.',
            });
        }
    });

    ipcMain.on('uninstall-app', async (event, appId, appSource, appArgument, appNeedAdm) => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return logger.error('No focused window for uninstall.');

        logger.info(`Uninstalling app: ${appId}, admin: ${appNeedAdm}`);
        if (!appId || appSource !== 'winget') {
            logger.error('Unsupported uninstall source or missing appId');
            win.webContents.send('uninstall-complete', {
                app_id: appId,
                status: 'error',
                message: 'Uninstall source is not supported or appID is missing.',
            });
            return;
        }

        const uninstallCmd = `winget uninstall -e --id ${appId} ${appArgument || ''} --accept-source-agreements --silent`.trim();

        try {
            await runcmd(
                uninstallCmd,
                appNeedAdm == 1,
                false,
                (type, data) => {
                    win.webContents.send('uninstall-progress', { app_id: appId, data });
                }
            );

            win.webContents.send('uninstall-complete', {
                app_id: appId,
                status: 'success',
                message: 'Uninstallation completed.',
            });
        } catch (err) {
            logger.error(`[Uninstall] Error for ${appId}: ${err.message}`);
            win.webContents.send('uninstall-complete', {
                app_id: appId,
                status: 'error',
                message: 'Uninstallation failed.',
            });
        }
    });
}

module.exports = { setupInstallUninstallListeners };
