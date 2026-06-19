const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../bin/logger');

const TASK_NAME = 'ArtemisStore Update Apps On Login';
const LEGACY_TASK_NAME = 'ArtemisStore\\UpdateAppsOnLogin';
const STARTUP_ARG = '--auto-update-apps-on-login';

function psSingleQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function runElevatedPowerShellScript(script) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(
            app.getPath('temp'),
            `artemisstore-startup-task-${Date.now()}.ps1`
        );
        const resultPath = `${scriptPath}.result.log`;

        fs.writeFileSync(
            scriptPath,
            `
$ErrorActionPreference = 'Stop'
try {
${script}
    Set-Content -Path ${psSingleQuote(resultPath)} -Value 'OK' -Encoding UTF8
    exit 0
} catch {
    $message = ($_ | Out-String).Trim()
    Set-Content -Path ${psSingleQuote(resultPath)} -Value $message -Encoding UTF8
    exit 1
}
`,
            'utf8'
        );

        const command = [
            '$p = Start-Process',
            "-FilePath 'powershell.exe'",
            `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${psSingleQuote(
                scriptPath
            )})`,
            '-Verb RunAs',
            '-Wait',
            '-PassThru',
            '-WindowStyle Hidden;',
            'exit $p.ExitCode',
        ].join(' ');

        execFile(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
            { windowsHide: true },
            (error, stdout, stderr) => {
                const elevatedResult = readTempFile(resultPath);

                try {
                    fs.unlinkSync(scriptPath);
                } catch (unlinkErr) {
                    logger.warn(
                        `[STARTUP_TASK] Impossible de supprimer le script temporaire : ${unlinkErr.message}`
                    );
                }
                removeTempFile(resultPath);

                if (error) {
                    const details = elevatedResult || stderr || error.message;
                    logger.error(`[STARTUP_TASK] Echec tache planifiee : ${details}`);
                    reject(new Error(formatTaskError(details)));
                    return;
                }

                resolve({ stdout: elevatedResult || stdout, stderr });
            }
        );
    });
}

function readTempFile(filePath) {
    try {
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() : '';
    } catch (err) {
        return '';
    }
}

function removeTempFile(filePath) {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        logger.warn(`[STARTUP_TASK] Impossible de supprimer ${filePath} : ${err.message}`);
    }
}

function formatTaskError(details) {
    if (!details) {
        return "Creation de la tache planifiee annulee ou refusee par Windows. Relance l'activation et accepte l'UAC.";
    }

    const oneLine = details.replace(/\s+/g, ' ').trim();
    return `Creation de la tache planifiee impossible : ${oneLine}`;
}

function runSchtasks(args) {
    return new Promise((resolve, reject) => {
        execFile('schtasks.exe', args, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || stdout || error.message));
                return;
            }

            resolve({ stdout, stderr });
        });
    });
}

function getTaskCommand() {
    return process.execPath;
}

async function taskExists(taskName) {
    try {
        await runSchtasks(['/Query', '/TN', taskName]);
        return true;
    } catch (err) {
        return false;
    }
}

async function enableUpdateAppsOnLoginTask() {
    if (!app.isPackaged) {
        logger.info('[STARTUP_TASK] Tache planifiee non creee en mode dev.');
        return;
    }

    app.setLoginItemSettings({ openAtLogin: false });

    const currentUser = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    const createTask = `
$ErrorActionPreference = 'Stop'
$taskName = ${psSingleQuote(TASK_NAME)}
$legacyTaskName = ${psSingleQuote(LEGACY_TASK_NAME)}
$exePath = ${psSingleQuote(getTaskCommand())}
$argument = ${psSingleQuote(STARTUP_ARG)}
$userId = ${psSingleQuote(currentUser)}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
schtasks.exe /Delete /TN $legacyTaskName /F | Out-Null

$action = New-ScheduledTaskAction -Execute $exePath -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -Compatibility Win8 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
`;

    await runElevatedPowerShellScript(createTask);

    if (!(await taskExists(TASK_NAME))) {
        throw new Error('La tache planifiee est introuvable apres creation.');
    }

    logger.info(`[STARTUP_TASK] Tache planifiee creee : ${TASK_NAME}`);
}

async function disableUpdateAppsOnLoginTask() {
    if (!app.isPackaged) {
        logger.info('[STARTUP_TASK] Tache planifiee non supprimee en mode dev.');
        return;
    }

    app.setLoginItemSettings({ openAtLogin: false });
    await runElevatedPowerShellScript(`
$ErrorActionPreference = 'SilentlyContinue'
Unregister-ScheduledTask -TaskName ${psSingleQuote(TASK_NAME)} -Confirm:$false
schtasks.exe /Delete /TN ${psSingleQuote(LEGACY_TASK_NAME)} /F | Out-Null
`);
    logger.info('[STARTUP_TASK] Tache planifiee de mise a jour supprimee.');
}

module.exports = {
    STARTUP_ARG,
    enableUpdateAppsOnLoginTask,
    disableUpdateAppsOnLoginTask,
};
