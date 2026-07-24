const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildPowerShellBannerScript } = require('../bin/terminalBranding');

function powershellSingleQuoted(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function getCurrentLogPath(userDataPath, date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return path.join(userDataPath, 'logs', `app-${yyyy}-${mm}-${dd}.log`);
}

function buildLogViewerCommand(logPath, date = new Date()) {
    const dateLabel = date.toLocaleDateString('fr-FR');
    const title = `ArtemisStore - Journal du ${dateLabel}`;
    return [
        `try { $Host.UI.RawUI.WindowTitle = ${powershellSingleQuoted(title)} } catch { }`,
        buildPowerShellBannerScript(),
        "Write-Host 'Journal en direct. Fermez cette fenetre pour quitter.' -ForegroundColor DarkCyan",
        `Get-Content -LiteralPath ${powershellSingleQuoted(logPath)} -Tail 200 -Wait`,
    ].join('; ');
}

function ensureLogFile(userDataPath, date = new Date()) {
    const logPath = getCurrentLogPath(userDataPath, date);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const descriptor = fs.openSync(logPath, 'a');
    fs.closeSync(descriptor);
    return logPath;
}

function openLogViewer(userDataPath, date = new Date()) {
    const logPath = ensureLogFile(userDataPath, date);
    const command = buildLogViewerCommand(logPath, date);

    return new Promise((resolve, reject) => {
        const child = spawn(
            'powershell.exe',
            ['-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', command],
            {
                detached: true,
                windowsHide: false,
                stdio: 'ignore',
            }
        );

        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve({ logPath, pid: child.pid });
        });
    });
}

module.exports = {
    buildLogViewerCommand,
    ensureLogFile,
    getCurrentLogPath,
    openLogViewer,
};
