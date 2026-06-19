const { exec } = require('child_process');
const logger = require('./logger');
const { readSettings } = require('../function/settingsManager');

function psSingleQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function buildVisiblePowerShellCommand(command) {
    const encodedCommand = psSingleQuote(command);
    return [
        'powershell -NoProfile -ExecutionPolicy Bypass -Command',
        '"$p = Start-Process powershell.exe',
        `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command',${encodedCommand})`,
        '-WindowStyle Normal',
        '-Wait',
        '-PassThru;',
        'exit $p.ExitCode"',
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
            const escaped = command.replace(/"/g, '""');
            const windowStyle = showTerminal ? 'Normal' : 'Hidden';
            const psCommand = `Start-Process powershell -Verb RunAs -WindowStyle ${windowStyle} -ArgumentList '-NoProfile','-Command','${escaped}'`;
            finalCommand = `powershell -NoProfile -WindowStyle ${windowStyle} -Command "${psCommand}"`;
            logger.info('[UAC] Execution elevee de la commande.');
        } else if (showTerminal && !captureOutput) {
            finalCommand = buildVisiblePowerShellCommand(command);
        }

        logger.info(`Commande executee : ${finalCommand}`);

        const proc = exec(finalCommand, {
            encoding: 'utf8',
            windowsHide: !showTerminal,
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
