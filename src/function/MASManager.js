const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const logger = require('../bin/logger');
const { normalizeHttpsUrl } = require('../bin/security');

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
const ALLOWED_MAS_HOSTS = ['raw.githubusercontent.com', 'github.com', 'codeload.github.com'];
const MAX_CMD_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

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
    logger.info(`[MASManager] Copie MAS locale: ${source} -> ${destination}`);
    return true;
}

function fileHash(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function bufferHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assertSafeZipEntry(entryName) {
    const normalized = entryName.replace(/\\/g, '/');
    if (path.isAbsolute(normalized) || normalized.includes('../') || normalized.startsWith('..')) {
        throw new Error(`Entree ZIP MAS suspecte refusee : ${entryName}`);
    }
}

function assertCmdBuffer(buffer, label, maxBytes = MAX_CMD_BYTES) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error(`${label} vide.`);
    }
    if (buffer.length > maxBytes) {
        throw new Error(`${label} trop volumineux (${buffer.length} octets).`);
    }
    const preview = buffer.subarray(0, 512).toString('utf8').toLowerCase();
    if (!preview.includes('@echo') && !preview.includes('powershell') && !preview.includes('cmd')) {
        throw new Error(`${label} ne ressemble pas a un script CMD attendu.`);
    }
}

function downloadToBuffer(url, maxBytes) {
    return new Promise((resolve, reject) => {
        let safeUrl;
        try {
            safeUrl = normalizeHttpsUrl(url, ALLOWED_MAS_HOSTS);
        } catch (err) {
            reject(err);
            return;
        }

        const request = https.get(safeUrl, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                const location = new URL(response.headers.location, safeUrl).toString();
                downloadToBuffer(location, maxBytes).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode} pour ${safeUrl}`));
                return;
            }

            const chunks = [];
            let receivedBytes = 0;
            response.on('data', (chunk) => {
                receivedBytes += chunk.length;
                if (receivedBytes > maxBytes) {
                    request.destroy(new Error(`Telechargement MAS trop volumineux: ${safeUrl}`));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks)));
        });

        request.setTimeout(30000, () => {
            request.destroy(new Error(`Timeout telechargement MAS: ${safeUrl}`));
        });
        request.on('error', reject);
    });
}

async function downloadFirstAvailable(urls, maxBytes) {
    let lastError = null;
    for (const url of urls) {
        try {
            logger.info(`[MASManager] Telechargement MAS controle: ${url}`);
            return { source: url, buffer: await downloadToBuffer(url, maxBytes) };
        } catch (err) {
            lastError = err;
            logger.warn(`[MASManager] Echec telechargement ${url}: ${err.message}`);
        }
    }

    throw lastError || new Error('Aucune source MAS disponible.');
}

function writeVerifiedScript(destination, buffer, source, label) {
    assertCmdBuffer(buffer, label);
    ensureDirForFile(destination);
    fs.writeFileSync(destination, buffer, { mode: 0o600 });
    logger.info(`[MASManager] ${label} telecharge depuis ${source}. sha256=${bufferHash(buffer)}`);
    return destination;
}

function findScriptInArchive(archiveBuffer, expectedFileName) {
    const zip = new AdmZip(archiveBuffer);
    const entries = zip.getEntries();
    for (const entry of entries) {
        assertSafeZipEntry(entry.entryName);
        if (entry.isDirectory) continue;

        const fileName = path.basename(entry.entryName).toLowerCase();
        if (fileName === expectedFileName.toLowerCase()) {
            const data = entry.getData();
            assertCmdBuffer(data, expectedFileName);
            return data;
        }
    }

    throw new Error(`${expectedFileName} introuvable dans l archive MAS.`);
}

async function ensureScript(relativePath, label, downloadFallback) {
    const destination = path.join(getMASCacheDir(), relativePath);
    if (fs.existsSync(destination)) {
        logger.info(`[MASManager] ${label} cache present. sha256=${fileHash(destination)}`);
        return destination;
    }

    const bundled = path.join(getBundledMASDir(), relativePath);
    if (copyFileIfExists(bundled, destination)) return destination;

    return downloadFallback(destination);
}

async function ensureMASJsonScript() {
    return ensureScript(JSON_RELATIVE, 'Script MAS JSON', async (destination) => {
        const { source, buffer } = await downloadFirstAvailable(JSON_DOWNLOAD_URLS, MAX_CMD_BYTES);
        return writeVerifiedScript(destination, buffer, source, 'Script MAS JSON');
    });
}

async function ensureOfficeActivationScript() {
    return ensureScript(OHOOK_RELATIVE, 'Script activation Office', async (destination) => {
        const { source, buffer } = await downloadFirstAvailable(
            MAS_ARCHIVE_URLS,
            MAX_ARCHIVE_BYTES
        );
        const script = findScriptInArchive(buffer, 'Ohook_Activation_AIO.cmd');
        return writeVerifiedScript(destination, script, source, 'Script activation Office');
    });
}

module.exports = {
    ensureMASJsonScript,
    ensureOfficeActivationScript,
};
