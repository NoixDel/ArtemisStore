const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const logger = require('../bin/logger');

// 📍 Définir le chemin globalement (il sera valide après app.whenReady())
let settingsPath = null;

// 📦 Valeurs par défaut
const defaultSettings = {
    autoUpdate: true,
    AllwaysShowTerminal: false,
};

// 🧠 Lire les paramètres
function readSettings() {
    try {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        logger.error('[SETTINGS] Lecture échouée :', err);
        return defaultSettings;
    }
}

function updateSetting(key, value) {
    const settings = readSettings();
    settings[key] = value;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return settings;
}

function initSettingsManager() {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');

    if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
        logger.info('[SETTINGS] settings.json créé');
    }

    ipcMain.on('get-settings', (event) => {
        const settings = readSettings();
        event.sender.send('settings-data', settings);
    });

    ipcMain.on('update-setting', (event, key, value) => {
        const updated = updateSetting(key, value);
        event.sender.send('setting-updated', { key, value, settings: updated });
    });
}

module.exports = {
    initSettingsManager,
    readSettings
};
