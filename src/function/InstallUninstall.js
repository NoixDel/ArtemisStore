// InstallUninstall.js
// InstallUninstall.js est un fichier qui contient des fonctions pour installer et désinstaller des applications.
// Il est utilisé pour écouter les événements de l'interface utilisateur et exécuter les commandes d'installation et de désinstallation des applications.
// Ces fonctions sont appelées dans le fichier main.js pour gérer les événements d'installation et de désinstallation des applications.

const { ipcMain, BrowserWindow } = require('electron');
const { exec } = require('child_process');
const logger = require('../bin/logger');

// Utilitaire pour exécuter une commande et envoyer les events à la fenêtre
function runCommand(command, win, appId, type) {
    let fullStdout = '';
    let fullStderr = '';

    const proc = exec(command, { encoding: 'utf8' });

    proc.stdout.on('data', (data) => {
        const cleanedData = data.replace(/[\r\n]+/g, ' ').trim();
        fullStdout += data;
        logger.info(`${type} progress: ${cleanedData}`);
        win.webContents.send(`${type}-progress`, { app_id: appId, data: cleanedData });
    });

    proc.stderr.on('data', (data) => {
        fullStderr += data;
        logger.error(`${type} error: ${data}`);
        win.webContents.send(`${type}-progress`, { app_id: appId, data });
    });

    proc.on('close', (code) => {
        logger.info(`==== ${type.toUpperCase()} PROCESS FINISHED ====`);
        logger.info(`COMMAND: ${command}`);
        logger.info(`EXIT CODE: ${code}`);
        if (fullStdout.trim()) logger.info(`STDOUT:\n${fullStdout}`);
        if (fullStderr.trim()) logger.error(`STDERR:\n${fullStderr}`);
        logger.info(`============================================`);

        const success = code === 0;
        win.webContents.send(`${type}-complete`, {
            app_id: appId,
            status: success ? 'success' : 'error',
            message: `${type === 'install' ? 'Installation' : 'Uninstallation'} ${success ? 'completed' : 'failed'}.`,
        });
    });
}

// Utilitaire pour exécuter en élévation
function runElevated(command, win, appId, type) {
    const escapedCommand = command.replace(/"/g, '""');
    const powershellCmd = `Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','${escapedCommand}'`;
    const fullCommand = `powershell -NoProfile -WindowStyle Hidden -Command "${powershellCmd}"`;

    runCommand(fullCommand, win, appId, type);
}

function setupInstallUninstallListeners() {
    ipcMain.on('install-app', (event, appId, appSource, appArgument, appNeedAdm) => {
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
        appNeedAdm == 1 ? runElevated(installCmd, win, appId, 'install') : runCommand(installCmd, win, appId, 'install');
    });

    ipcMain.on('uninstall-app', (event, appId, appSource, appArgument, appNeedAdm) => {
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
        appNeedAdm == 1 ? runElevated(uninstallCmd, win, appId, 'uninstall') : runCommand(uninstallCmd, win, appId, 'uninstall');
    });
}

module.exports = { setupInstallUninstallListeners };