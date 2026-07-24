const { ipcMain, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const logger = require('../bin/logger');
const { brandPowerShellCommand, encodePowerShellCommand } = require('../bin/terminalBranding');
const { ensureOfficeActivationScript } = require('./MASManager');

function psSingleQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function setupActivateOfficeListener() {
    logger.info('[ActivateOffice] setupActivateOfficeListener initialise.');

    ipcMain.on('activate-office', async () => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return;

        try {
            const scriptPath = await ensureOfficeActivationScript();
            logger.info(`[ActivateOffice] Lancement du script : ${scriptPath}`);

            const activationCommand = [
                `$scriptPath = ${psSingleQuote(scriptPath)}`,
                "$cmdCommand = 'call \"' + $scriptPath + '\"'",
                '& $env:ComSpec /d /s /c $cmdCommand',
                'exit $LASTEXITCODE',
            ].join('; ');
            const encodedActivationCommand = encodePowerShellCommand(
                brandPowerShellCommand(activationCommand)
            );
            const command = [
                '$p = Start-Process powershell.exe',
                `-ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedActivationCommand}')`,
                '-WindowStyle Normal',
                '-PassThru',
                '-ErrorAction Stop;',
                'if (-not $p) { exit 1 }',
            ].join(' ');

            execFile(
                'powershell.exe',
                ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
                { windowsHide: true },
                (error) => {
                    if (error) {
                        logger.error(
                            `[ActivateOffice] Erreur au lancement du script : ${error.message}`
                        );
                        win.webContents.send('office-activation-result', {
                            success: false,
                            error: error.message,
                        });
                    } else {
                        win.webContents.send('office-activation-result', { success: true });
                    }
                }
            );
        } catch (error) {
            logger.error('[ActivateOffice] Impossible de preparer MAS :', error.message);
            win.webContents.send('office-activation-result', {
                success: false,
                error: error.message,
            });
        }
    });
}

module.exports = setupActivateOfficeListener;
