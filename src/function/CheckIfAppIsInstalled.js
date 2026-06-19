// CheckIfAppIsInstalled.js
// Cette fonction vérifie si une application est déjà installée sur l'ordinateur de l'utilisateur en utilisant la commande winget list.

const { execSync } = require('child_process');
const logger = require('../bin/logger');

function checkIfInstalled(appId, appName, installedApps) {
    const appNameLower = String(appName || '').toLowerCase();
    const appIdLower = String(appId || '').toLowerCase();

    for (const installedApp of installedApps) {
        if (appIdLower && installedApp.includes(appIdLower)) {
            return true;
        }
        if (appNameLower && installedApp.includes(appNameLower)) {
            return true;
        }
    }
    return false;
}

function getInstalledApps() {
    try {
        const result = execSync('winget list', {
            encoding: 'utf-8',
            windowsHide: true,
            maxBuffer: 20 * 1024 * 1024,
        });
        return result
            .split('\n')
            .map((line) => line.toLowerCase())
            .filter(Boolean);
    } catch (e) {
        logger.error(`Error retrieving installed apps: ${e.message}`);
        logger.error(`Stack trace: ${e.stack}`);
        return [];
    }
}

module.exports = { checkIfInstalled, getInstalledApps };
