const { autoUpdater } = require('electron-updater');
const { dialog, BrowserWindow } = require('electron');
const logger = require('./logger');

autoUpdater.allowPrerelease = true;

const checkForUpdates = () => {
    autoUpdater.checkForUpdatesAndNotify();
    setInterval(() => {
        autoUpdater.checkForUpdatesAndNotify((err) => {
            if (err) {
                logger.error(`Erreur lors de la recherche de mises à jour : ${err.message}`);
            }
        });
    }, 60000);
};

autoUpdater.on('update-downloaded', () => {
    logger.info('Mise à jour prête');
    dialog
        .showMessageBox({
            type: 'info',
            title: 'Mise à jour prête',
            message: "La mise à jour a été téléchargée. L'application va redémarrer.",
        })
        .then(() => {
            // Fermer toutes les fenêtres avant de redémarrer
            BrowserWindow.getAllWindows().forEach((window) => {
                window.close();
            });
            autoUpdater.quitAndInstall();
        });
});

autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Mise à jour disponible',
        message: `Mise à jour disponible : ${info.version}`,
    });
    logger.info(`Mise à jour disponible : ${info.version}`);
});

autoUpdater.on('error', (err) => {
    logger.error(`Erreur de mise à jour : ${err.message}`);
});

module.exports = { checkForUpdates };
