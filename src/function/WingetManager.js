const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../bin/logger');
const { redactSecrets } = require('../bin/security');

const WINGET_ACTIONS = new Set(['check', 'install-repair', 'update-client', 'update-sources']);
const DEFAULT_TIMEOUT = 60_000;
const MAINTENANCE_TIMEOUT = 15 * 60_000;

const FIND_WINGET_PACKAGE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$package = Get-AppxPackage -Name Microsoft.DesktopAppInstaller |
    Sort-Object Version -Descending |
    Select-Object -First 1
if ($package -and $package.InstallLocation) {
    $candidate = Join-Path $package.InstallLocation 'winget.exe'
    if (Test-Path -LiteralPath $candidate) {
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
        $candidate
    }
}
`;

const REPAIR_WINGET_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Install-PackageProvider -Name NuGet -Force -Scope CurrentUser | Out-Null
Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery -Scope CurrentUser -AllowClobber -Confirm:$false | Out-Null
Import-Module Microsoft.WinGet.Client -Force
Repair-WinGetPackageManager -Force -Latest
`;

function runFile(file, args, timeout = DEFAULT_TIMEOUT) {
    return new Promise((resolve) => {
        execFile(
            file,
            args,
            {
                encoding: 'utf8',
                windowsHide: true,
                timeout,
                maxBuffer: 20 * 1024 * 1024,
            },
            (error, stdout = '', stderr = '') => {
                const numericCode =
                    error && typeof error.code === 'number' ? error.code : error ? null : 0;
                resolve({
                    exitCode: numericCode,
                    stdout: String(stdout || ''),
                    stderr: String(stderr || ''),
                    error: error ? String(error.message || error) : '',
                    timedOut: Boolean(error && error.killed),
                });
            }
        );
    });
}

function runPowerShell(script, timeout = DEFAULT_TIMEOUT) {
    return runFile(
        'powershell.exe',
        [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            script,
        ],
        timeout
    );
}

function addDirectoryToProcessPath(directory) {
    const currentPath = process.env.Path || process.env.PATH || '';
    const entries = currentPath
        .split(path.delimiter)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    if (!entries.includes(directory.toLowerCase())) {
        process.env.Path = `${currentPath}${path.delimiter}${directory}`;
    }
}

function validWingetPath(candidate) {
    const normalized = String(candidate || '').trim();
    if (!normalized || path.basename(normalized).toLowerCase() !== 'winget.exe') return null;
    return path.isAbsolute(normalized) && fs.existsSync(normalized) ? normalized : null;
}

async function resolveWingetExecutable() {
    const whereResult = await runFile('where.exe', ['winget.exe'], 10_000);
    if (whereResult.exitCode === 0) {
        for (const candidate of whereResult.stdout.split(/\r?\n/)) {
            const validPath = validWingetPath(candidate);
            if (validPath) return validPath;
        }
    }

    if (process.env.LOCALAPPDATA) {
        const windowsAppsDirectory = path.join(
            process.env.LOCALAPPDATA,
            'Microsoft',
            'WindowsApps'
        );
        const aliasPath = validWingetPath(path.join(windowsAppsDirectory, 'winget.exe'));
        if (aliasPath) {
            addDirectoryToProcessPath(windowsAppsDirectory);
            return aliasPath;
        }
    }

    const packageResult = await runPowerShell(FIND_WINGET_PACKAGE_SCRIPT, 20_000);
    if (packageResult.exitCode === 0) {
        for (const candidate of packageResult.stdout.split(/\r?\n/)) {
            const validPath = validWingetPath(candidate);
            if (validPath) return validPath;
        }
    }

    return null;
}

function readVersion(output) {
    const match = String(output || '').match(/\bv?\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?\b/i);
    return match ? match[0].replace(/^v/i, '') : null;
}

function conciseFailure(result, fallback) {
    if (result.timedOut) return 'L operation a pris trop de temps. Verifie la connexion Internet.';
    const lines = `${result.stderr}\n${result.stdout}\n${result.error}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const detail = lines.slice(-3).join(' ');
    return redactSecrets(detail || fallback).slice(0, 700);
}

async function checkWinget() {
    const executable = await resolveWingetExecutable();
    if (!executable) {
        return {
            installed: false,
            working: false,
            version: null,
            sourcesReady: false,
            message: 'Winget n est pas disponible pour cette session Windows.',
        };
    }

    const versionResult = await runFile(executable, ['--version'], 20_000);
    if (versionResult.exitCode !== 0) {
        return {
            installed: true,
            working: false,
            version: null,
            sourcesReady: false,
            message: 'Winget est installe mais ne demarre pas correctement.',
        };
    }

    const version = readVersion(versionResult.stdout);
    const sourcesResult = await runFile(
        executable,
        ['source', 'list', '--disable-interactivity'],
        DEFAULT_TIMEOUT
    );
    const sourcesReady = sourcesResult.exitCode === 0;

    return {
        installed: true,
        working: sourcesReady,
        version,
        sourcesReady,
        message: sourcesReady
            ? 'Winget fonctionne et ses sources sont accessibles.'
            : 'Winget demarre, mais ses sources ont besoin d etre actualisees ou reparees.',
    };
}

async function installOrRepairWinget() {
    logger.info('[WingetManager] Installation ou reparation de Winget.');
    const result = await runPowerShell(REPAIR_WINGET_SCRIPT, MAINTENANCE_TIMEOUT);
    const status = await checkWinget();

    if (result.exitCode !== 0 || !status.working) {
        return {
            success: false,
            status,
            message:
                result.exitCode !== 0
                    ? conciseFailure(result, 'Installation ou reparation de Winget impossible.')
                    : status.message,
        };
    }

    return {
        success: true,
        status,
        message: `Winget ${status.version || ''} est installe et operationnel.`.trim(),
    };
}

async function updateWingetClient() {
    const before = await checkWinget();
    if (!before.working) {
        const repaired = await installOrRepairWinget();
        if (repaired.success) {
            repaired.message =
                'Winget a ete installe ou repare avec la derniere version disponible.';
        }
        return repaired;
    }

    const executable = await resolveWingetExecutable();
    logger.info('[WingetManager] Mise a jour de Microsoft App Installer.');
    const result = await runFile(
        executable,
        [
            'upgrade',
            'Microsoft.AppInstaller',
            '--accept-source-agreements',
            '--accept-package-agreements',
            '--disable-interactivity',
        ],
        MAINTENANCE_TIMEOUT
    );

    if (result.exitCode !== 0) {
        logger.warn(
            `[WingetManager] Mise a jour directe non appliquee, verification par l outil de reparation Microsoft : ${conciseFailure(result, 'code inconnu')}`
        );
        const repaired = await installOrRepairWinget();
        if (repaired.success) {
            repaired.message =
                'Winget est deja a jour ou a ete remis sur la derniere version disponible.';
        }
        return repaired;
    }

    const status = await checkWinget();
    return {
        success: status.working,
        status,
        message:
            before.version && status.version && before.version !== status.version
                ? `Winget a ete mis a jour de ${before.version} vers ${status.version}.`
                : 'Winget est deja a jour.',
    };
}

async function updateWingetSources() {
    const before = await checkWinget();
    if (!before.installed) {
        return {
            success: false,
            status: before,
            message: 'Installe ou repare Winget avant d actualiser ses sources.',
        };
    }

    const executable = await resolveWingetExecutable();
    logger.info('[WingetManager] Actualisation des sources Winget.');
    const result = await runFile(
        executable,
        ['source', 'update', '--disable-interactivity'],
        MAINTENANCE_TIMEOUT
    );
    const status = await checkWinget();

    if (result.exitCode !== 0) {
        return {
            success: false,
            status,
            message: conciseFailure(result, 'Actualisation des sources Winget impossible.'),
        };
    }

    return {
        success: status.working,
        status,
        message: status.working
            ? 'Les sources Winget ont ete actualisees sans supprimer les sources personnalisees.'
            : status.message,
    };
}

async function runWingetAction(action) {
    if (action === 'check') {
        const status = await checkWinget();
        return { success: status.working, status, message: status.message };
    }
    if (action === 'install-repair') return installOrRepairWinget();
    if (action === 'update-client') return updateWingetClient();
    if (action === 'update-sources') return updateWingetSources();
    throw new Error('Action Winget inconnue.');
}

function setupWingetManagerListeners() {
    const { ipcMain } = require('electron');
    let runningAction = null;

    ipcMain.on('winget-manager-action', async (event, requestedAction) => {
        const action = String(requestedAction || '');
        if (!WINGET_ACTIONS.has(action)) {
            event.sender.send('winget-manager-result', {
                action,
                success: false,
                message: 'Action Winget refusee.',
            });
            return;
        }

        if (runningAction) {
            event.sender.send('winget-manager-result', {
                action,
                success: false,
                busy: true,
                message: 'Une operation Winget est deja en cours.',
            });
            return;
        }

        runningAction = action;
        try {
            const result = await runWingetAction(action);
            if (!event.sender.isDestroyed()) {
                event.sender.send('winget-manager-result', { action, ...result });
            }
        } catch (error) {
            logger.error(`[WingetManager] ${action}: ${error.message}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('winget-manager-result', {
                    action,
                    success: false,
                    message: redactSecrets(error.message || 'Operation Winget impossible.'),
                });
            }
        } finally {
            runningAction = null;
        }
    });
}

module.exports = {
    checkWinget,
    installOrRepairWinget,
    setupWingetManagerListeners,
    updateWingetClient,
    updateWingetSources,
};
