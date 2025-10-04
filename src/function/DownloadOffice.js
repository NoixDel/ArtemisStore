const { ipcMain, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { exec } = require('child_process');
const logger = require('../bin/logger');

function setupDownloadOfficeListener() {
    ipcMain.on('download-office', async () => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return;

        const url = 'https://c2rsetup.officeapps.live.com/c2r/download.aspx?ProductreleaseID=O365AppsBasicRetail&platform=x64&language=fr-fr&version=O16GA';
        const fileName = 'OfficeSetup.exe';
        const tempDir = os.tmpdir();
        const filePath = path.join(tempDir, fileName);

        win.webContents.send('office-download-progress', `📥 Téléchargement de ${fileName}...`);

        try {
            await downloadFile(url, filePath, (percent) => {
                win.webContents.send('office-download-progress', `Téléchargement : ${percent}%`);
            });

            win.webContents.send('office-download-progress', `✅ Téléchargement terminé. Lancement de l'installation...`);

            exec(`"${filePath}"`, (error) => {
                if (error) {
                    logger.error(`[OfficeDownload] Erreur au lancement : ${error.message}`);
                    win.webContents.send('office-download-progress', `❌ Erreur au lancement du setup.`);
                }
            });

        } catch (err) {
            logger.error(`[OfficeDownload] Erreur lors du téléchargement : ${err.message}`);
            win.webContents.send('office-download-progress', `❌ Erreur lors du téléchargement de Office.`);
        }
    });
}

function downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        let receivedBytes = 0;
        let totalBytes = 0;

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                return reject(new Error(`Statut HTTP : ${response.statusCode}`));
            }

            totalBytes = parseInt(response.headers['content-length'], 10);

            response.on('data', (chunk) => {
                receivedBytes += chunk.length;
                const percent = Math.round((receivedBytes / totalBytes) * 100);
                onProgress(percent);
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close(resolve);
            });

        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

module.exports = { setupDownloadOfficeListener };
