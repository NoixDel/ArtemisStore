// function/UpdateApps.js

const iconv = require('iconv-lite');
const logger = require('../bin/logger');
const { ipcMain, BrowserWindow } = require('electron');
const runcmd = require('../bin/runcmd');

function parseWingetOutput(rawOutput) {
    const lines = rawOutput.trim().split('\n');
    const updates = [];
    const blacklist = ['winget', 'microsoft.vclibs', 'vcredist', 'windowsdesktop.runtime'];

    // Trouver la ligne contenant les titres de colonnes
    const headerIndex = lines.findIndex(line => line.includes('Nom') && line.includes('ID'));
    if (headerIndex === -1) return updates; // Rien trouvé

    for (let i = headerIndex + 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || /^[-\s]+$/.test(line)) continue;
        if (line.toLowerCase().includes('numéro') || line.toLowerCase().includes('déterminé')) continue;

        const name = line.slice(0, 24).trim();
        const id = line.slice(24, 48).trim();
        const current_version = line.slice(48, 62).trim();
        const available_version = line.slice(62, 76).trim();
        const source = line.slice(76).trim();

        if (!name || !id || !available_version) continue;
        if (blacklist.some(b => id.toLowerCase().includes(b))) continue;
        if (available_version.toLowerCase().includes('ez --include')) continue;

        updates.push({
            name,
            appid: id,
            current_version,
            new_version: available_version,
            source,
            argument: '--silent',
            needadm: true
        });
    }

    return updates;
}

async function getUpgradableApps() {
    const command = `winget upgrade --accept-source-agreements`;
    logger.info('[UpdatesApps.js] Exécution de : ' + command);

    try {
        const { stdout } = await runcmd(command, false, false, null, true);
        const decoded = iconv.decode(Buffer.from(stdout, 'utf8'), 'utf8');
        const updates = parseWingetOutput(decoded);
        logger.info(`[UpdatesApps.js] ${updates.length} mise(s) à jour trouvée(s).`);
        return updates;
    } catch (err) {
        logger.error('[UpdatesApps.js] Erreur pendant winget upgrade :', err);
        return [];
    }
}

function UpdatesAppsListener() {
    logger.info('[UpdatesApps.js] Initialisation de la fonction UpdatesApps');

    ipcMain.on('update-all-apps', () => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return logger.error('[UpdatesApps.js] Aucune fenêtre active.');

        const command = `winget upgrade --all --accept-package-agreements --accept-source-agreements --silent`;
        logger.info('[UpdatesApps.js] Mise à jour de toutes les applications : ' + command);

        runcmd(command, true, true, (type, data) => {
            win.webContents.send(`install-progress`, { app_id: 'ALL', data });
        });
    });
}

module.exports = {
    getUpgradableApps,
    UpdatesAppsListener
};
