// function/UpdateApps.js

const iconv = require('iconv-lite');
const logger = require('../bin/logger');
const { ipcMain, BrowserWindow } = require('electron');
const runcmd = require('../bin/runcmd');

function parseWingetOutput(rawOutput) {
    const lines = rawOutput
        .replace(/\r/g, '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const updates = [];
    const blacklist = ['winget', 'microsoft.vclibs', 'vcredist', 'windowsdesktop.runtime'];

    const headerIndex = lines.findIndex(line =>
        (line.includes('Nom') && line.includes('ID')) ||
        (line.includes('Name') && line.includes('Id'))
    );
    if (headerIndex === -1) return updates;

    const headerLine = lines[headerIndex];
    const isFrench = headerLine.includes('Nom');
    const startIndex = headerLine.indexOf(isFrench ? 'Nom' : 'Name');
    const headerPart = headerLine.slice(startIndex);

    const nameIndex = headerPart.indexOf(isFrench ? 'Nom' : 'Name');
    const idIndex = headerPart.indexOf(isFrench ? 'ID' : 'Id');
    const versionIndex = headerPart.indexOf('Version');
    const availableIndex = headerPart.indexOf(isFrench ? 'Disponible' : 'Available');
    const sourceIndex = headerPart.indexOf('Source');

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];

        if (/^[-\s]+$/.test(line)) continue;
        if (/^\d+ mises? à niveau/.test(line)) continue;
        if (/^\d+ upgrade/.test(line)) continue;
        if (/^1 package\(s\)/.test(line)) continue;

        // ⚠️ NE PAS découper ici → les données sont déjà alignées
        const name = line.slice(nameIndex, idIndex).trim();
        const id = line.slice(idIndex, versionIndex).trim();
        const current_version = line.slice(versionIndex, availableIndex).trim();
        const available_version = line.slice(availableIndex, sourceIndex).trim();
        const source = line.slice(sourceIndex).trim();

        if (!name || !id || !available_version) continue;
        if (blacklist.some(b => id.toLowerCase().includes(b))) continue;

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
