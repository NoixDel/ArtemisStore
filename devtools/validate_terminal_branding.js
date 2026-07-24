const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const { brandPowerShellCommand, encodePowerShellCommand, getTerminalBannerLines } = require(
    path.join(projectRoot, 'src', 'bin', 'terminalBranding.js')
);
const { buildLogViewerCommand } = require(
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
        timeout: 30_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${name}: PowerShell invalide\n${result.stdout}\n${result.stderr}`);
    }
}

function assertIntegration(file, expectedImport) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    if (!source.includes(expectedImport) || !source.includes('terminalBranding')) {
        throw new Error(`La banniere commune n est pas utilisee dans ${file}.`);
    }
}

const lines = getTerminalBannerLines();
if (lines.length < 9 || new Set(lines.map((line) => line.length)).size !== 1) {
    throw new Error('Le cadre de la banniere est incomplet ou mal aligne.');
}
if (
    !lines.some((line) => line.includes('Merci de ne pas toucher')) ||
    !lines.join('\n').includes('____')
) {
    throw new Error('Le nom ASCII ou le message de protection est absent.');
}

const sampleCommand = "Write-Output 'validation ArtemisStore'";
const brandedCommand = brandPowerShellCommand(sampleCommand);
parsePowerShell('Banniere commune', brandedCommand);

const encoded = encodePowerShellCommand(brandedCommand);
if (Buffer.from(encoded, 'base64').toString('utf16le') !== brandedCommand) {
    throw new Error('L encodage PowerShell de la banniere est invalide.');
}

parsePowerShell(
    'Journal avec banniere',
    buildLogViewerCommand("C:\\Users\\Noah's PC\\ArtemisStore.log", new Date(2026, 6, 24))
);

assertIntegration('src/bin/runcmd.js', 'brandPowerShellCommand');
assertIntegration('src/function/ActivateOffice.js', 'brandPowerShellCommand');
assertIntegration('src/function/LogViewer.js', 'buildPowerShellBannerScript');

const commandRunner = fs.readFileSync(path.join(projectRoot, 'src', 'bin', 'runcmd.js'), 'utf8');
if (
    !commandRunner.includes('buildDirectBrandedPowerShellCommand') ||
    !commandRunner.includes('launchesSeparateTerminal')
) {
    throw new Error('Un parcours de terminal visible pourrait contourner la banniere.');
}

console.log(
    `Validation terminal OK: banniere encadree sur ${lines[0].length} colonnes et 3 parcours visibles.`
);
