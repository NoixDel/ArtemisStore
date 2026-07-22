const os = require('os');
const { execFile } = require('child_process');
const logger = require('../bin/logger');
const { ensureMASJsonScript } = require('./MASManager');

async function getActivationJSON() {
    const scriptPath = await ensureMASJsonScript();

    return new Promise((resolve, reject) => {
        execFile(
            'cmd.exe',
            ['/d', '/s', '/c', scriptPath],
            { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 * 4 },
            (error, stdout, stderr) => {
                if (error) {
                    logger.error(
                        `[GetWinOfficeInfo.js] Erreur execution script : ${stderr || error.message}`
                    );
                    reject(error);
                    return;
                }

                try {
                    resolve(JSON.parse(stdout.trim()));
                } catch (err) {
                    logger.error(`[GetWinOfficeInfo.js] Erreur parsing JSON : ${err.message}`);
                    reject(err);
                }
            }
        );
    });
}

async function getWinOfficeInfo() {
    try {
        const data = await getActivationJSON();
        const windows = data.windows || {};
        const office = data.office || {};

        const WindowsInfo = {
            platform: os.platform(),
            osName: windows.osName || 'N/A',
            osDisplayVersion: windows.osDisplayVersion || 'N/A',
            windowsEditionId: windows.windowsEditionId || 'N/A',
            osVersion: windows.osVersion || 'N/A',
            osActivationType: windows.productKeyChannel || 'N/A',
            osActivationStatus: windows.isLicensed || false,
            osPartialProductKey: windows.partialProductKey || null,
            osActivationId: windows.activationId || null,
            isDigitalLicense: windows.isDigitalLicense,
            officeInstalled: office.officeInstalled || false,
            officeVersion: office.officeVersion || 'Unknown',
            officeActivated:
                office.officeActivated === true ||
                (Array.isArray(office.officeLicenses) &&
                    office.officeLicenses.some((lic) => lic.LicenseState === 'Licensed')),
            officeApps: office.officeApps || [],
            officeLicenses: office.officeLicenses || [],
        };

        logger.info('[GetWinOfficeInfo.js] Informations Windows et Office recuperees.');
        return WindowsInfo;
    } catch (error) {
        logger.error(
            `[GetWinOfficeInfo.js] Error on retrieving Windows and Office information: ${error.message}`
        );
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
            officeLicenses: [],
        };
    }
}

module.exports = getWinOfficeInfo;
