const { spawnSync } = require('child_process');
const ejs = require('ejs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const validationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-system-info-'));
process.env.APPDATA = validationRoot;

const getWinOfficeInfo = require(path.join(projectRoot, 'src', 'function', 'GetWinOfficeInfo.js'));
const { buildLogViewerCommand, ensureLogFile, getCurrentLogPath } = require(
    path.join(projectRoot, 'src', 'function', 'LogViewer.js')
);

function parsePowerShell(name, script) {
    const parserCommand = [
        '$inputText = [Console]::In.ReadToEnd()',
        '$tokens = $null',
        '$errors = $null',
        '[System.Management.Automation.Language.Parser]::ParseInput($inputText, [ref]$tokens, [ref]$errors) | Out-Null',
        'if ($errors.Count) { $errors | ForEach-Object { $_.Message }; exit 1 }',
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', parserCommand], {
        input: script,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: 30_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${name}: PowerShell invalide\n${result.stdout}\n${result.stderr}`);
    }
}

function validateRenderer() {
    const viewPath = path.join(projectRoot, 'src', 'renderer', 'views', 'winoffice.ejs');
    const template = fs.readFileSync(viewPath, 'utf8');
    ejs.render(
        template,
        {
            version: '0.1.6-test',
            author: 'Validation',
            githubLink: 'https://example.com',
        },
        { filename: viewPath, views: [path.dirname(viewPath)] }
    );
    const match = template.match(/<script>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Script Windows et Office introuvable.');
    Function(match[1]);
}

async function main() {
    parsePowerShell('Lecture Windows et Office', getWinOfficeInfo.WINDOWS_OFFICE_INFO_SCRIPT);
    validateRenderer();

    const sampleDate = new Date(2026, 6, 24);
    const sampleRoot = path.join(validationRoot, "Noah's Artemis Data");
    const logPath = ensureLogFile(sampleRoot, sampleDate);
    const expectedPath = getCurrentLogPath(sampleRoot, sampleDate);
    if (logPath !== expectedPath || !fs.existsSync(logPath)) {
        throw new Error('Le journal courant n est pas cree au bon emplacement.');
    }
    const logCommand = buildLogViewerCommand(logPath, sampleDate);
    parsePowerShell('Affichage des journaux', logCommand);
    if (!logCommand.includes("Noah''s Artemis Data")) {
        throw new Error('Un chemin de journal avec apostrophe n est pas protege.');
    }

    const info = await getWinOfficeInfo();
    if (
        info.dataAvailable !== true ||
        !info.osName ||
        !info.osVersion ||
        typeof info.osActivationStatus !== 'boolean' ||
        typeof info.officeInstalled !== 'boolean' ||
        !Array.isArray(info.officeLicenses)
    ) {
        throw new Error('Le diagnostic Windows et Office retourne des donnees incompletes.');
    }

    console.log(
        `Validation systeme OK: Windows=${info.osName}, licence=${info.osLicenseStatus}, Office=${info.officeInstalled ? 'detecte' : 'non detecte'}, journaux valides.`
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
