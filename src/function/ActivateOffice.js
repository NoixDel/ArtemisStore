const path = require('path');
const fs = require('fs');
const https = require('https');
const { app, ipcMain, BrowserWindow } = require('electron');
const { exec } = require('child_process');
const os = require('os');
const logger = require('../bin/logger');
const AdmZip = require('adm-zip');

const SCRIPT_NAME = 'Ohook_Activation_AIO.cmd';
const LOCAL_DEST = path.join(app.getPath('appData'), 'ArtemisStore', 'resources', 'mas');
const SCRIPT_FULL_PATH = path.join(LOCAL_DEST, 'Separate-Files-Version', 'Activators', SCRIPT_NAME);
const MAS_ZIP_URL = 'https://github.com/massgravel/Microsoft-Activation-Scripts/archive/refs/heads/master.zip';

// 🔹 Lire version MAS locale
function getLocalMASVersion() {
    const dirs = ['All-In-One-Version', 'All-In-One-Version-KL'];
    for (const dir of dirs) {
        const file = path.join(LOCAL_DEST, dir, 'MAS_AIO.cmd');
        if (fs.existsSync(file)) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const match = content.match(/@set masver=([\d.]+)/);
                if (match) return match[1];
            } catch (err) {
                logger.error(`[ActivateOffice] Erreur lecture version MAS depuis ${file} : ${err.message}`);
            }
        }
    }
    return null;
}

// 🔹 Lire version MAS distante
function getRemoteMASVersion() {
    return new Promise((resolve, reject) => {
        const url = 'https://raw.githubusercontent.com/massgravel/Microsoft-Activation-Scripts/master/MAS/All-In-One-Version-KL/MAS_AIO.cmd';

        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const match = data.match(/@set masver=([\d.]+)/);
                if (match) resolve(match[1]);
                else reject(new Error('Version MAS non trouvée dans le fichier distant.'));
            });
        }).on('error', reject);
    });
}

// 🔹 Trouver le dossier MAS dans le zip
function findMASFolder(root) {
    const stack = [root];

    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);

            if (entry.isDirectory()) {
                if (entry.name === 'MAS') {
                    logger.info(`[ActivateOffice] ✅ Dossier MAS trouvé : ${fullPath}`);
                    return fullPath;
                }
                stack.push(fullPath);
            }
        }
    }

    logger.warn('[ActivateOffice] Aucun dossier MAS trouvé.');
    return null;
}

// 🔹 Copier récursivement
function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const item of fs.readdirSync(src)) {
            copyRecursive(path.join(src, item), path.join(dest, item));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

// 🔹 Gérer le téléchargement du zip (avec redirection)
function updateMAS(callback) {
    const tmpZipPath = path.join(os.tmpdir(), 'mas_update.zip');
    const extractPath = path.join(os.tmpdir(), 'mas_extracted');

    const file = fs.createWriteStream(tmpZipPath);
    https.get(MAS_ZIP_URL, (res) => {
        logger.info('[ActivateOffice] Téléchargement du ZIP MAS en cours...');
        if (res.statusCode === 302 && res.headers.location) {
            logger.warn('[ActivateOffice] Redirection détectée...');
            https.get(res.headers.location, (redirectedRes) => {
                downloadAndExtract(redirectedRes);
            });
        } else {
            downloadAndExtract(res);
        }
    }).on('error', err => {
        logger.error('[ActivateOffice] ❌ Échec téléchargement MAS : ' + err.message);
        callback(false);
    });

    function downloadAndExtract(res) {
        res.pipe(file);
        file.on('finish', () => {
            file.close();

            logger.info(`[ActivateOffice] ZIP MAS téléchargé (${fs.statSync(tmpZipPath).size} octets).`);
            logger.info('[ActivateOffice] Extraction du ZIP MAS avec adm-zip...');

            try {
                const zip = new AdmZip(tmpZipPath);
                zip.extractAllTo(extractPath, true);
                logger.info('[ActivateOffice] Extraction terminée.');

                const masFolder = findMASFolder(extractPath);
                if (!masFolder) {
                    logger.warn('[ActivateOffice] Aucun dossier MAS trouvé.');
                    callback(false);
                    return;
                }

                if (fs.existsSync(LOCAL_DEST)) {
                    fs.rmSync(LOCAL_DEST, { recursive: true, force: true });
                }

                copyRecursive(masFolder, LOCAL_DEST);
                logger.info('[ActivateOffice] ✅ MAS mis à jour avec succès.');
                callback(true);
            } catch (err) {
                logger.error('[ActivateOffice] ❌ Erreur lors de l\'extraction du ZIP : ' + err.message);
                callback(false);
            } finally {
                try { fs.rmSync(tmpZipPath, { force: true }); } catch (_) {}
            }
        });
    }
}

// 🔹 Lancer le script principal (Office)
function launchScript(win) {
    logger.info(`[ActivateOffice] ▶️ Lancement du script : ${SCRIPT_FULL_PATH}`);
    win.webContents.send('office-activation-status', `▶️ Lancement du script : ${SCRIPT_NAME}`);

    exec(`start cmd /c "${SCRIPT_FULL_PATH}"`, { windowsHide: false }, (err) => {
        if (err) {
            logger.error('[ActivateOffice] ❌ Erreur exécution script : ' + err.message);
            win.webContents.send('office-activation-result', { success: false, error: err.message });
        } else {
            win.webContents.send('office-activation-result', { success: true });
        }
    });
}

// 🔹 Lancer un script arbitraire
function launchSpecificScript(win, scriptName) {
    const basePath = path.join(app.getPath('appData'), 'ArtemisStore', 'resources', 'mas');

    const possiblePaths = [
        path.join(basePath, 'Separate-Files-Version', 'Activators', scriptName),
        path.join(basePath, 'Separate-Files-Version', scriptName),
        path.join(basePath, 'All-In-One-Version-KL', scriptName),
        path.join(basePath, 'All-In-One-Version', scriptName),
    ];

    let foundPath = null;
    for (const possible of possiblePaths) {
        if (fs.existsSync(possible)) {
            foundPath = possible;
            break;
        }
    }

    if (!foundPath) {
        logger.error(`[ActivateOffice] ❌ Script non trouvé : ${scriptName}`);
        win.webContents.send('office-activation-status', `❌ Script introuvable : ${scriptName}`);
        return;
    }

    logger.info(`[ActivateOffice] ▶️ Exécution du script trouvé : ${foundPath}`);
    win.webContents.send('office-activation-status', `▶️ Lancement du script : ${scriptName}`);

    exec(`start cmd /c "${foundPath}"`, { windowsHide: false }, (err) => {
        if (err) {
            logger.error(`[ActivateOffice] ❌ Erreur lors de l'exécution de ${scriptName} : ${err.message}`);
            win.webContents.send('office-activation-status', `❌ Erreur : ${scriptName}`);
        } else {
            logger.info(`[ActivateOffice] ✅ Script ${scriptName} lancé avec succès.`);
            win.webContents.send('office-activation-status', `✅ Script ${scriptName} lancé`);
        }
    });
}

// 🔹 Vérifier / mettre à jour MAS avant exécution
function ensureMASUpToDateAndRun(win, callback) {
    const localVersion = getLocalMASVersion();
    logger.info(`[ActivateOffice] 🔄 Version locale MAS : ${localVersion || 'Aucune'}`);
    win.webContents.send('office-activation-status', `🔄 Vérification version locale : ${localVersion || 'Aucune'}`);

    getRemoteMASVersion().then(remoteVersion => {
        logger.info(`[ActivateOffice] 🌍 Version distante MAS : ${remoteVersion}`);
        win.webContents.send('office-activation-status', `🌍 Version distante : ${remoteVersion}`);

        if (localVersion !== remoteVersion) {
            logger.info('[ActivateOffice] ⬇️ Mise à jour nécessaire. Téléchargement en cours...');
            win.webContents.send('office-activation-status', '⬇️ Mise à jour MAS en cours...');

            updateMAS((success) => {
                if (success) {
                    logger.info('[ActivateOffice] ✅ MAS à jour');
                    win.webContents.send('office-activation-status', '✅ MAS mis à jour');
                    callback();
                } else {
                    logger.error('[ActivateOffice] ❌ La mise à jour MAS a échoué');
                    win.webContents.send('office-activation-status', '❌ Échec de la mise à jour MAS. Merci de vérifier votre antivirus ou votre connexion.');
                }
            });
        } else {
            logger.info('[ActivateOffice] ✅ MAS déjà à jour');
            win.webContents.send('office-activation-status', '✅ MAS déjà à jour');
            callback();
        }
    }).catch(err => {
        logger.warn('[ActivateOffice] ⚠️ Erreur récupération version distante MAS : ' + err.message);
        win.webContents.send('office-activation-status', `⚠️ Erreur version distante. Utilisation locale.`);
        callback();
    });
}

// 🔹 Listener principal
function setupActivateOfficeListener() {
    ipcMain.on('activate-office', () => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return;

        ensureMASUpToDateAndRun(win, () => {
            win.webContents.send('office-activation-status', '▶️ Lancement activation Office... Dans la fenêtre qui s\'ouvre, choisissez l\'option 1 afin d\'activer Office.');
            launchScript(win);
        });
    });

    ipcMain.on("start-script", (event, scriptName) => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return;

        ensureMASUpToDateAndRun(win, () => launchSpecificScript(win, scriptName));
    });
}

module.exports = setupActivateOfficeListener;
