const { ipcMain, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { execFile } = require('child_process');
const logger = require('../bin/logger');

const OFFICE_SETUP_URL =
    'https://c2rsetup.officeapps.live.com/c2r/download.aspx?ProductreleaseID=O365AppsBasicRetail&platform=x64&language=fr-fr&version=O16GA';
const OFFICE_SETUP_NAME = 'OfficeSetup.exe';

function setupDownloadOfficeListener() {
    ipcMain.on('download-office', async () => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return;

        const filePath = path.join(os.tmpdir(), OFFICE_SETUP_NAME);
        win.webContents.send(
            'office-download-progress',
            `Telechargement de ${OFFICE_SETUP_NAME}...`
        );

        try {
            await downloadFile(OFFICE_SETUP_URL, filePath, (percent) => {
                win.webContents.send('office-download-progress', `Telechargement : ${percent}%`);
            });

            win.webContents.send(
                'office-download-progress',
                "Telechargement termine. Lancement de l'installation..."
            );

            execFile(filePath, { windowsHide: false }, (error) => {
                if (error) {
                    logger.error(`[OfficeDownload] Erreur au lancement : ${error.message}`);
                    win.webContents.send(
                        'office-download-progress',
                        'Erreur au lancement du setup.'
                    );
                }
            });
        } catch (err) {
            logger.error(`[OfficeDownload] Erreur lors du telechargement : ${err.message}`);
            win.webContents.send(
                'office-download-progress',
                'Erreur lors du telechargement de Office.'
            );
        }
    });
}

function downloadFile(url, destination, onProgress) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                downloadFile(response.headers.location, destination, onProgress)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Statut HTTP : ${response.statusCode}`));
                return;
            }

            const file = fs.createWriteStream(destination);
            const totalBytes = Number(response.headers['content-length']) || 0;
            let receivedBytes = 0;
            let lastPercent = -1;

            response.on('data', (chunk) => {
                if (!totalBytes) return;

                receivedBytes += chunk.length;
                const percent = Math.round((receivedBytes / totalBytes) * 100);
                if (percent !== lastPercent) {
                    lastPercent = percent;
                    onProgress(percent);
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close(resolve);
            });

            file.on('error', (err) => {
                fs.rm(destination, { force: true }, () => reject(err));
            });
        });

        request.on('error', (err) => {
            fs.rm(destination, { force: true }, () => reject(err));
        });
    });
}

module.exports = { setupDownloadOfficeListener };
