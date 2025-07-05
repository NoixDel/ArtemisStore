/*
    exec.js
    This script is responsible for executing commands in the system, such as installing or uninstalling applications.
*/

const logger = require('./logger');
const { exec } = require('child_process');
const { readSettings } = require('../function/settingsManager'); // <-- Mets le bon chemin ici

/**
 * Exécute une commande avec options UAC, affichage terminal et callback de progression.
 * @param {string} command - La commande à exécuter.
 * @param {boolean} uac - Si true, exécution avec privilèges administrateur.
 * @param {boolean} showTerminal - Si true, affiche la fenêtre du terminal.
 * @param {function|null} onProgress - Callback (type: 'stdout' | 'stderr', data: string)
 * @param {boolean} captureOutput - Si true, capture la sortie standard et d'erreur.
 */
function runCommand(command, uac = false, showTerminal = false, onProgress = null, captureOutput = false) {
    return new Promise((resolve, reject) => {
        // 🔥 Toujours relire les paramètres les plus récents
        const settings = readSettings();
        if (settings.AllwaysShowTerminal === true) {
            showTerminal = true;
            logger.info('Paramètre AllwaysShowTerminal actif : terminal forcé.');
        }

        let finalCommand = command;

        if (uac) {
            const escaped = command.replace(/"/g, '""');
            const psCommand = `Start-Process powershell -Verb RunAs -WindowStyle ${showTerminal ? 'Normal' : 'Hidden'} -ArgumentList '-NoProfile','-Command','${escaped}'`;
            finalCommand = `powershell -NoProfile -WindowStyle ${showTerminal ? 'Normal' : 'Hidden'} -Command "${psCommand}"`;
            logger.info(`[UAC] Exécution élevée de la commande.`);
        }

        logger.info(`Commande exécutée : ${finalCommand}`);

        const proc = exec(finalCommand, { encoding: 'utf8' });

        let stdout = '', stderr = '';

        proc.stdout.on('data', (data) => {
            const cleaned = data.trim();
            stdout += data;
            logger.info(`[STDOUT] ${cleaned}`);
            if (onProgress) onProgress('stdout', cleaned);
        });

        proc.stderr.on('data', (data) => {
            const cleaned = data.trim();
            stderr += data;
            logger.warn(`[STDERR] ${cleaned}`);
            if (onProgress) onProgress('stderr', cleaned);
        });

        proc.on('close', (code) => {
            logger.info(`Commande terminée avec code : ${code}`);
            if (captureOutput) {
                resolve({ stdout, stderr, exitCode: code });
            } else {
                resolve(code);
            }
        });

        proc.on('error', (err) => {
            logger.error(`Erreur d'exécution : ${err.message}`);
            reject(err);
        });
    });
}

module.exports = runCommand;