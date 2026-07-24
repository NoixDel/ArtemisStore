const { exec } = require('child_process');
const logger = require('./logger');
const { readSettings } = require('../function/settingsManager');
const { brandPowerShellCommand, encodePowerShellCommand } = require('./terminalBranding');

function buildVisiblePowerShellCommand(command) {
    const encodedCommand = encodePowerShellCommand(brandPowerShellCommand(command));
    const launcher = [
        '$p = Start-Process powershell.exe',
        `-ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}')`,
        '-WindowStyle Normal',
        '-Wait',
        '-PassThru;',
        'exit $p.ExitCode',
    ].join(' ');
    return [
        'powershell -NoLogo -NoProfile -ExecutionPolicy Bypass',
        '-WindowStyle Hidden',
        `-EncodedCommand ${encodePowerShellCommand(launcher)}`,
    ].join(' ');
}

function buildDirectBrandedPowerShellCommand(command) {
    const encodedCommand = encodePowerShellCommand(brandPowerShellCommand(command));
    return [
        'powershell -NoLogo -NoProfile -ExecutionPolicy Bypass',
        `-EncodedCommand ${encodedCommand}`,
    ].join(' ');
}

function runCommand(
    command,
    uac = false,
    showTerminal = false,
    onProgress = null,
    captureOutput = false
) {
    return new Promise((resolve, reject) => {
        const settings = readSettings();
        if (settings.AllwaysShowTerminal === true) {
            showTerminal = true;
            logger.info('Parametre AllwaysShowTerminal actif : terminal force.');
        }

        let finalCommand = command;

        if (uac) {
            const windowStyle = showTerminal ? 'Normal' : 'Hidden';
            const commandToRun = showTerminal ? brandPowerShellCommand(command) : command;
            const encodedCommand = encodePowerShellCommand(commandToRun);
            const psCommand = [
                '$p = Start-Process powershell.exe',
                '-Verb RunAs',
                `-WindowStyle ${windowStyle}`,
                `-ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}')`,
                '-Wait',
                '-PassThru;',
                'exit $p.ExitCode',
            ].join(' ');
            const encodedLauncher = encodePowerShellCommand(psCommand);
            finalCommand = [
                'powershell -NoLogo -NoProfile -ExecutionPolicy Bypass',
                '-WindowStyle Hidden',
                `-EncodedCommand ${encodedLauncher}`,
            ].join(' ');
            logger.info('[UAC] Execution elevee de la commande.');
        } else if (showTerminal) {
            finalCommand = captureOutput
                ? buildDirectBrandedPowerShellCommand(command)
                : buildVisiblePowerShellCommand(command);
        }

        logger.info(`Commande executee : ${finalCommand}`);

        const launchesSeparateTerminal = showTerminal && (uac || !captureOutput);
        const proc = exec(finalCommand, {
            encoding: 'utf8',
            windowsHide: launchesSeparateTerminal || !showTerminal,
            maxBuffer: 20 * 1024 * 1024,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data;
            const cleaned = data.trim();
            if (!cleaned) return;

            logger.info(`[STDOUT] ${cleaned}`);
            if (onProgress) onProgress('stdout', cleaned);
        });

        proc.stderr.on('data', (data) => {
            stderr += data;
            const cleaned = data.trim();
            if (!cleaned) return;

            logger.warn(`[STDERR] ${cleaned}`);
            if (onProgress) onProgress('stderr', cleaned);
        });

        proc.on('close', (code) => {
            logger.info(`Commande terminee avec code : ${code}`);
            if (captureOutput) {
                resolve({ stdout, stderr, exitCode: code });
            } else {
                resolve(code);
            }
        });

        proc.on('error', (err) => {
            logger.error(`Erreur d'execution : ${err.message}`);
            reject(err);
        });
    });
}

module.exports = runCommand;
