// CheckIfAppIsInstalled.js
// Cette fonction vérifie si une application est déjà installée sur l'ordinateur de l'utilisateur en utilisant la commande winget list.

const { execSync } = require('child_process');
const logger = require('../bin/logger');

function checkIfInstalled(appId, appName, installedApps) {
    const appNameLower = appName.toLowerCase();
    for (const installedApp of installedApps) {
        const installedAppLower = installedApp.toLowerCase();
        // console.log(`Installed app: ${installedAppLower} - App ID: ${appId} - AppName: ${appName}`);  // Debugging statement
        if (appId && installedAppLower.includes(appId.toLowerCase())) {
            return true;
        }
        if (installedAppLower.includes(appNameLower)) {
            return true;
        }
    }
    return false;
}

function getInstalledApps() {
    try {
        const result = execSync('winget list', { encoding: 'utf-8' });
        const installedApps = result.split('\n');
        return installedApps;
    } catch (e) {
        logger.error(`Error retrieving installed apps: ${e.message}`);
        logger.error(`Stack trace: ${e.stack}`);
        return [];
    }
}

module.exports = { checkIfInstalled, getInstalledApps };