const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const logger = require('../bin/logger');
const { readSettings } = require('./settingsManager');

const DB_FILE_NAME = 'applications.db';
const DB_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_DB_URL =
    'https://raw.githubusercontent.com/NoixDel/ArtemisStore/main/applications.db';

function normalizeDbUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';

    const githubBlob = trimmed.match(
        /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i
    );
    if (githubBlob) {
        const [, owner, repo, branch, filePath] = githubBlob;
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }

    return trimmed;
}

function normalizeDbSources(sources) {
    if (Array.isArray(sources)) {
        return sources.map(normalizeDbUrl).filter(Boolean);
    }

    return String(sources || '')
        .split(/\r?\n/)
        .map(normalizeDbUrl)
        .filter(Boolean);
}

function getApplicationDbPath() {
    return path.join(app.getPath('userData'), DB_FILE_NAME);
}

function getApplicationDbMetaPath() {
    return `${getApplicationDbPath()}.meta.json`;
}

function getDevFallbackDbPath() {
    return path.join(app.getAppPath(), DB_FILE_NAME);
}

function readMeta() {
    try {
        return JSON.parse(fs.readFileSync(getApplicationDbMetaPath(), 'utf8'));
    } catch (err) {
        return {};
    }
}

function writeMeta(meta) {
    fs.writeFileSync(getApplicationDbMetaPath(), JSON.stringify(meta, null, 2));
}

function fileHash(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function isCacheFresh(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const ageMs = Date.now() - fs.statSync(filePath).mtimeMs;
    return ageMs < DB_MAX_AGE_MS;
}

function downloadToBuffer(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                downloadToBuffer(response.headers.location).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode} pour ${url}`));
                return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        });

        request.setTimeout(30000, () => {
            request.destroy(new Error('Timeout telechargement applications.db'));
        });
        request.on('error', reject);
    });
}

async function downloadFirstAvailable(sources) {
    let lastError = null;

    for (const source of sources) {
        try {
            logger.info(`[APPLICATION_DB] Verification source : ${source}`);
            const buffer = await downloadToBuffer(source);
            if (buffer.length < 1024) {
                throw new Error('Fichier applications.db trop petit.');
            }
            return { source, buffer };
        } catch (err) {
            lastError = err;
            logger.warn(`[APPLICATION_DB] Source indisponible ${source}: ${err.message}`);
        }
    }

    throw lastError || new Error('Aucune source applications.db disponible.');
}

function getConfiguredSources() {
    const settings = readSettings();
    const sources = normalizeDbSources(settings.applicationsDbSources);
    return sources.length > 0 ? sources : [DEFAULT_DB_URL];
}

async function refreshApplicationDatabase(force = false) {
    const dbPath = getApplicationDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    if (!force && isCacheFresh(dbPath)) {
        return { updated: false, path: dbPath, reason: 'cache-fresh', meta: readMeta() };
    }

    const currentHash = fs.existsSync(dbPath) ? fileHash(dbPath) : null;
    const { source, buffer } = await downloadFirstAvailable(getConfiguredSources());
    const remoteHash = crypto.createHash('sha256').update(buffer).digest('hex');

    if (!force && currentHash && currentHash === remoteHash) {
        const now = new Date().toISOString();
        fs.utimesSync(dbPath, new Date(), new Date());
        writeMeta({ source, hash: remoteHash, checkedAt: now, updatedAt: readMeta().updatedAt });
        return { updated: false, path: dbPath, reason: 'same-content', meta: readMeta() };
    }

    const tempPath = `${dbPath}.download`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, dbPath);

    const now = new Date().toISOString();
    const meta = { source, hash: remoteHash, checkedAt: now, updatedAt: now };
    writeMeta(meta);
    logger.info(`[APPLICATION_DB] applications.db mis a jour depuis ${source}`);
    return { updated: true, path: dbPath, reason: 'downloaded', meta };
}

async function ensureApplicationDatabase() {
    const dbPath = getApplicationDbPath();

    try {
        await refreshApplicationDatabase(false);
    } catch (err) {
        logger.error(`[APPLICATION_DB] Echec refresh distant : ${err.message}`);
        if (!fs.existsSync(dbPath) && !app.isPackaged) {
            const fallback = getDevFallbackDbPath();
            if (fs.existsSync(fallback)) {
                fs.copyFileSync(fallback, dbPath);
                logger.warn(`[APPLICATION_DB] Fallback dev copie depuis ${fallback}`);
            }
        }
    }

    return dbPath;
}

module.exports = {
    DEFAULT_DB_URL,
    ensureApplicationDatabase,
    refreshApplicationDatabase,
    getApplicationDbPath,
    normalizeDbSources,
};
