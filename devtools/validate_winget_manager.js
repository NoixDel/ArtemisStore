const { spawnSync } = require('child_process');
const ejs = require('ejs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const managerPath = path.join(projectRoot, 'src', 'function', 'WingetManager.js');
const settingsPath = path.join(projectRoot, 'src', 'renderer', 'views', 'settings.ejs');
const preloadPath = path.join(projectRoot, 'src', 'preload.js');
const mainPath = path.join(projectRoot, 'src', 'main.js');
const managerSource = fs.readFileSync(managerPath, 'utf8');

function extractTemplate(marker) {
    const markerIndex = managerSource.indexOf(marker);
    if (markerIndex < 0) throw new Error(`Marqueur introuvable: ${marker}`);
    const start = managerSource.indexOf('`', markerIndex + marker.length);
    const end = managerSource.indexOf('`', start + 1);
    if (start < 0 || end < 0) throw new Error(`Script introuvable: ${marker}`);
    return Function(`"use strict"; return ${managerSource.slice(start, end + 1)};`)();
}

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

function validateRenderer() {
    const template = fs.readFileSync(settingsPath, 'utf8');
    const rendered = ejs.render(
        template,
        {
            version: '0.1.6-test',
            author: 'Validation',
            githubLink: 'https://example.com',
        },
        { filename: settingsPath, views: [path.dirname(settingsPath)] }
    );
    const match = template.match(/<script>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Script de la page Parametres introuvable.');
    Function(match[1]);
    return rendered;
}

function requireText(filePath, text) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (!source.includes(text)) {
        throw new Error(`${path.basename(filePath)}: element absent: ${text}`);
    }
}

async function main() {
    parsePowerShell(
        'Recherche du paquet App Installer',
        extractTemplate('const FIND_WINGET_PACKAGE_SCRIPT =')
    );
    parsePowerShell('Reparation Winget', extractTemplate('const REPAIR_WINGET_SCRIPT ='));
    const renderedSettings = validateRenderer();

    for (const action of ['check', 'install-repair', 'update-client', 'update-sources']) {
        if (!managerSource.includes(`'${action}'`)) {
            throw new Error(`Action Winget absente: ${action}`);
        }
    }
    if (managerSource.includes('source reset')) {
        throw new Error('La maintenance normale ne doit pas supprimer les sources personnalisees.');
    }
    for (const requiredText of [
        'Repair-WinGetPackageManager -Force -Latest',
        "'source', 'update'",
        "'upgrade'",
        "'Microsoft.AppInstaller'",
    ]) {
        if (!managerSource.includes(requiredText)) {
            throw new Error(`Garde-fou Winget absent: ${requiredText}`);
        }
    }

    requireText(preloadPath, "'winget-manager-action'");
    requireText(preloadPath, "'winget-manager-result'");
    requireText(mainPath, 'setupWingetManagerListeners();');

    process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-winget-validation-'));
    const status = await require(managerPath).checkWinget();
    if (
        typeof status.installed !== 'boolean' ||
        typeof status.working !== 'boolean' ||
        typeof status.sourcesReady !== 'boolean'
    ) {
        throw new Error('Le diagnostic Winget retourne un format invalide.');
    }

    console.log(
        `Validation Winget OK: diagnostic=${status.working ? 'operationnel' : 'indisponible ou a reparer'}, interface et scripts valides.`
    );

    const renderArgument = process.argv.find((argument) => argument.startsWith('--render='));
    if (renderArgument) {
        const outputPath = path.resolve(renderArgument.slice('--render='.length));
        const baseHref = `${path.dirname(settingsPath).replace(/\\/g, '/')}/`;
        const preview = renderedSettings.replace(
            /<head>/i,
            `<head>\n<base href="file:///${baseHref}">`
        );
        fs.writeFileSync(outputPath, preview, 'utf8');
        console.log(`Apercu Parametres genere: ${outputPath}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
