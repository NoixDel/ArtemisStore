const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const logger = require('../bin/logger');

const MAS_ROOT = 'microsoftactivationscript_mas';
const JSON_RELATIVE = path.join('NoixDel-Edited-JSONOuput-Version', 'Check_Activation_JSON.cmd');
const OHOOK_RELATIVE = path.join(
    'Separate-Files-Version',
    'Activators',
    'Ohook_Activation_AIO.cmd'
);

const JSON_DOWNLOAD_URLS = [
    'https://raw.githubusercontent.com/NoixDel/ArtemisStore/main/ressources/microsoftactivationscript_mas/NoixDel-Edited-JSONOuput-Version/Check_Activation_JSON.cmd',
    'https://raw.githubusercontent.com/NoixDel/ArtemisStore/master/ressources/microsoftactivationscript_mas/NoixDel-Edited-JSONOuput-Version/Check_Activation_JSON.cmd',
    'https://raw.githubusercontent.com/NoixDel/ArtemisStore/main/src/bin/microsoftactivationscript_mas/NoixDel-Edited-JSONOuput-Version/Check_Activation_JSON.cmd',
    'https://raw.githubusercontent.com/NoixDel/ArtemisStore/master/src/bin/microsoftactivationscript_mas/NoixDel-Edited-JSONOuput-Version/Check_Activation_JSON.cmd',
];

const MAS_ARCHIVE_URLS = [
    'https://github.com/massgravel/Microsoft-Activation-Scripts/archive/refs/heads/master.zip',
    'https://github.com/massgravel/Microsoft-Activation-Scripts/archive/refs/heads/main.zip',
];

function getMASCacheDir() {
    return path.join(app.getPath('appData'), 'ArtemisStore', 'resources', 'mas');
}

function getBundledMASDir() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'ressources', MAS_ROOT);
    }

    return path.join(app.getAppPath(), 'ressources', MAS_ROOT);
}

function ensureDirForFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyFileIfExists(source, destination) {
    if (!fs.existsSync(source)) return false;
    ensureDirForFile(destination);
    fs.copyFileSync(source, destination);
    logger.info(`[MASManager] Copie MAS: ${source} -> ${destination}`);
    return true;
}

function downloadToFile(url, destination) {
    return new Promise((resolve, reject) => {
        ensureDirForFile(destination);

        const request = https.get(url, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                downloadToFile(response.headers.location, destination).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode} pour ${url}`));
                return;
            }

            const file = fs.createWriteStream(destination);
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
            file.on('error', reject);
        });

        request.on('error', reject);
    });
}

async function downloadFirstAvailable(urls, destination) {
    let lastError = null;
    for (const url of urls) {
        try {
            logger.info(`[MASManager] Telechargement MAS: ${url}`);
            await downloadToFile(url, destination);
            return destination;
        } catch (err) {
            lastError = err;
            logger.warn(`[MASManager] Echec telechargement ${url}: ${err.message}`);
        }
    }

    throw lastError || new Error('Aucune URL MAS disponible.');
}

function expandArchive(zipPath, destination) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(destination, { recursive: true });
        execFile(
            'powershell.exe',
            [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
            ],
            { windowsHide: true },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                    return;
                }

                resolve();
            }
        );
    });
}

function findFile(root, fileName) {
    if (!fs.existsSync(root)) return null;
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            const found = findFile(fullPath, fileName);
            if (found) return found;
        } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
            return fullPath;
        }
    }
    return null;
}

async function ensureMASJsonScript() {
    const destination = path.join(getMASCacheDir(), JSON_RELATIVE);
    if (fs.existsSync(destination)) return destination;

    const bundled = path.join(getBundledMASDir(), JSON_RELATIVE);
    if (copyFileIfExists(bundled, destination)) return destination;

    await downloadFirstAvailable(JSON_DOWNLOAD_URLS, destination);
    return destination;
}

async function ensureOfficeActivationScript() {
    const destination = path.join(getMASCacheDir(), OHOOK_RELATIVE);
    if (fs.existsSync(destination)) return destination;

    const bundled = path.join(getBundledMASDir(), OHOOK_RELATIVE);
    if (copyFileIfExists(bundled, destination)) return destination;

    const tempRoot = path.join(app.getPath('temp'), `artemisstore-mas-${Date.now()}`);
    const zipPath = path.join(tempRoot, 'mas.zip');
    fs.mkdirSync(tempRoot, { recursive: true });

    try {
        await downloadFirstAvailable(MAS_ARCHIVE_URLS, zipPath);
        await expandArchive(zipPath, tempRoot);
        const downloadedScript = findFile(tempRoot, 'Ohook_Activation_AIO.cmd');
        if (!downloadedScript) {
            throw new Error('Ohook_Activation_AIO.cmd introuvable dans l archive MAS.');
        }
        copyFileIfExists(downloadedScript, destination);
        return destination;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

module.exports = {
    ensureMASJsonScript,
    ensureOfficeActivationScript,
};
