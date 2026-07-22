const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const logger = require('../bin/logger');
const { enableUpdateAppsOnLoginTask, disableUpdateAppsOnLoginTask } = require('./startupTask');

let settingsPath = null;

const defaultSettings = {
    autoUpdate: true,
    AllwaysShowTerminal: false,
    updateAppsOnLogin: false,
    applicationsDbSources: ['https://github.com/NoixDel/ArtemisStore/blob/main/applications.db'],
};

const settingValidators = {
    autoUpdate: (value) => Boolean(value),
    AllwaysShowTerminal: (value) => Boolean(value),
    updateAppsOnLogin: (value) => Boolean(value),
    applicationsDbSources: (value) => {
        if (Array.isArray(value)) return value.map(String).slice(0, 10);
        return String(value || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 10);
    },
};

function getSettingsPath() {
    if (!settingsPath) {
        settingsPath = path.join(app.getPath('userData'), 'settings.json');
    }

    return settingsPath;
}

function normalizeSettings(settings) {
    return { ...defaultSettings, ...settings };
}

function writeSettings(settings) {
    const filePath = getSettingsPath();
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(normalizeSettings(settings), null, 2));
    fs.renameSync(tempPath, filePath);
}

function readSettings() {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) {
        return defaultSettings;
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return normalizeSettings(JSON.parse(raw));
    } catch (err) {
        logger.error('[SETTINGS] Lecture echouee :', err);
        return defaultSettings;
    }
}

function updateSetting(key, value) {
    if (!Object.prototype.hasOwnProperty.call(settingValidators, key)) {
        throw new Error(`Parametre inconnu : ${key}`);
    }

    const settings = readSettings();
    settings[key] = settingValidators[key](value);
    writeSettings(settings);
    return settings;
}

async function applyLoginStartupSetting(enabled) {
    if (enabled) {
        await enableUpdateAppsOnLoginTask();
    } else {
        await disableUpdateAppsOnLoginTask();
    }
}

function initSettingsManager() {
    const filePath = getSettingsPath();

    if (!fs.existsSync(filePath)) {
        writeSettings(defaultSettings);
        logger.info('[SETTINGS] settings.json cree');
    } else {
        const settings = readSettings();
        writeSettings(settings);
    }

    ipcMain.on('get-settings', (event) => {
        const settings = readSettings();
        event.sender.send('settings-data', settings);
    });

    ipcMain.on('update-setting', async (event, key, value) => {
        const updated = updateSetting(key, value);
        try {
            if (key === 'updateAppsOnLogin') {
                await applyLoginStartupSetting(value);
            }

            event.sender.send('setting-updated', { key, value, settings: updated });
        } catch (err) {
            logger.error('[SETTINGS] Echec application parametre : ' + err.message);
            const reverted =
                key === 'updateAppsOnLogin' ? updateSetting(key, !value) : readSettings();
            event.sender.send('setting-updated', {
                key,
                value,
                settings: reverted,
                error: err.message,
            });
        }
    });
}

module.exports = {
    initSettingsManager,
    readSettings,
};
