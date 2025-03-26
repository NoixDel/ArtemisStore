// GetWinOfficeInfo.js
// Description: Fonction qui récupère les informations sur le système d'exploitation Windows.
const os = require('os');
const { exec } = require('child_process');
const logger = require('../bin/logger');

async function getWinOfficeInfo() {
    try {
        // Récupération des informations sur le système d'exploitation
        const computerInfo = await new Promise((resolve, reject) => {
            exec('powershell -Command "Get-ComputerInfo | Select-Object OsName,OSDisplayVersion,WindowsEditionId,OsVersion | ConvertTo-Json"', { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
        const info = JSON.parse(computerInfo);

        // Récupération des informations d'activation de Windows
        const ActivationStatut = await new Promise((resolve, reject) => {
            exec(`powershell -Command "Get-CimInstance SoftwareLicensingProduct -Filter \\"Name like 'Windows%'\\" | where { $_.PartialProductKey } | select Description, LicenseStatus | ConvertTo-Json"`, { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
        const activation = JSON.parse(ActivationStatut);

        const WindowsInfo = {
            platform: os.platform(),
            osName: info.OsName,
            osDisplayVersion: info.OSDisplayVersion,
            windowsEditionId: info.WindowsEditionId,
            osVersion: info.OsVersion,
            osActivationType: activation.Description,
            osActivationStatus: activation.LicenseStatus === 1 ? true : false
        };
        logger.info('Windows and Office information retrieved successfully');
        return WindowsInfo;

    } catch (error) {
        logger.error('GetWinOfficeInfo.JS : ', error);
        return {
            platform: "ERROR",
            osName: "ERROR",
            osDisplayVersion: "ERROR",
            windowsEditionId: "ERROR",
            osVersion: "ERROR",
            osActivationType: "ERROR",
            osActivationStatus: false
        };
    }
}

module.exports = getWinOfficeInfo;