//GetWinOfficeInfo.js
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { app } = require('electron');
const logger = require('../bin/logger');

// Lance le .cmd et récupère la sortie JSON
function getScriptPath() {
    const basePath = path.join(app.getPath('appData'), 'ArtemisStore', 'resources');
    return path.join(basePath, 'microsoftactivationscript_mas', 'NoixDel-Edited-JSONOuput-Version', 'Check_Activation_JSON.cmd');
}

async function getActivationJSON() {
    const scriptPath = getScriptPath();

    return new Promise((resolve, reject) => {
        exec(`cmd /c "${scriptPath}"`, { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
            if (error) {
                logger.error('[GetWinOfficeInfo.js] Erreur lors de l\'exécution du script :', error);
                return reject(error);
            }

            try {
                const json = JSON.parse(stdout.trim());
                resolve(json);
            } catch (err) {
                logger.error('[GetWinOfficeInfo.js] Erreur parsing JSON :', err.message);
                reject(err);
            }
        });
    });
}

// Fonction principale
async function getWinOfficeInfo() {
    try {
        const data = await getActivationJSON();
        const windows = data.windows || {};
        const office = data.office || {};

        const WindowsInfo = {
            platform: os.platform(),

            // --- Infos Windows ---
            osName: windows.osName || 'N/A',
            osDisplayVersion: windows.osDisplayVersion || 'N/A',
            windowsEditionId: windows.windowsEditionId || 'N/A',
            osVersion: windows.osVersion || 'N/A',
            osActivationType: windows.productKeyChannel || 'N/A',
            osActivationStatus: windows.isLicensed || false,
            osPartialProductKey: windows.partialProductKey || null,
            osActivationId: windows.activationId || null,
            isDigitalLicense: windows.isDigitalLicense,

            // --- Infos Office ---
            officeInstalled: office.officeInstalled || false,
            officeVersion: office.officeVersion || 'Unknown',
            officeActivated:
                office.officeActivated === true ||
                (Array.isArray(office.officeLicenses) &&
                office.officeLicenses.some(lic => lic.LicenseState === 'Licensed')),
            officeApps: office.officeApps || [],
            officeLicenses: office.officeLicenses || []
        };


        logger.info('[GetWinOfficeInfo.js] : Windows and Office information retrieved successfully');
        //logger.info(`Windows Info: ${JSON.stringify(WindowsInfo, null, 2)}`);
        return WindowsInfo;

    } catch (error) {
        logger.error('[GetWinOfficeInfo.js] : Error on retrieving Windows and Office information', error);
        return {
            platform: os.platform(),

            osName: 'ERROR',
            osDisplayVersion: 'ERROR',
            windowsEditionId: 'ERROR',
            osVersion: 'ERROR',
            osActivationType: 'ERROR',
            osActivationStatus: false,
            osPartialProductKey: null,
            osActivationId: null,
            isDigitalLicense: null,

            officeInstalled: false,
            officeVersion: 'ERROR',
            officeActivated: false,
            officeApps: [],
            officeLicenses: []
        };
    }
}

module.exports = getWinOfficeInfo;