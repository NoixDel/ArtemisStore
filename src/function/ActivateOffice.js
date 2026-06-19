const { ipcMain, BrowserWindow } = require('electron');
const { exec } = require('child_process');
const logger = require('../bin/logger');
const { ensureOfficeActivationScript } = require('./MASManager');

function setupActivateOfficeListener() {
    logger.info('[ActivateOffice] setupActivateOfficeListener initialise.');

    ipcMain.on('activate-office', async () => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return;

        try {
            const scriptPath = await ensureOfficeActivationScript();
            logger.info(`[ActivateOffice] Lancement du script : ${scriptPath}`);

            exec(`start cmd /c "${scriptPath}"`, { windowsHide: false }, (error) => {
                if (error) {
                    logger.error('[ActivateOffice] Erreur au lancement du script :', error.message);
                    win.webContents.send('office-activation-result', {
                        success: false,
                        error: error.message,
                    });
                } else {
                    win.webContents.send('office-activation-result', { success: true });
                }
            });
        } catch (error) {
            logger.error('[ActivateOffice] Impossible de preparer MAS :', error.message);
            win.webContents.send('office-activation-result', {
                success: false,
                error: error.message,
            });
        }
    });
}

module.exports = setupActivateOfficeListener;
