const { autoUpdater } = require('electron-updater');
const { dialog, BrowserWindow } = require('electron');
const logger = require('./logger');

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let updateInterval = null;

autoUpdater.allowPrerelease = true;

function runUpdateCheck() {
    return autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        logger.error(`Erreur lors de la recherche de mises a jour : ${err.message}`);
    });
}

const checkForUpdates = () => {
    void runUpdateCheck();

    if (updateInterval) return;
    updateInterval = setInterval(() => {
        void runUpdateCheck();
    }, UPDATE_CHECK_INTERVAL_MS);
};

autoUpdater.on('update-downloaded', () => {
    logger.info('Mise a jour prete');
    dialog
        .showMessageBox({
            type: 'info',
            title: 'Mise a jour prete',
            message: "La mise a jour a ete telechargee. L'application va redemarrer.",
        })
        .then(() => {
            BrowserWindow.getAllWindows().forEach((window) => {
                window.close();
            });
            autoUpdater.quitAndInstall();
        });
});

autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Mise a jour disponible',
        message: `Mise a jour disponible : ${info.version}`,
    });
    logger.info(`Mise a jour disponible : ${info.version}`);
});

autoUpdater.on('error', (err) => {
    logger.error(`Erreur de mise a jour : ${err.message}`);
});

module.exports = { checkForUpdates };
