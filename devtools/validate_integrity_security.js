const { spawnSync } = require('child_process');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const integrityPath = path.join(projectRoot, 'src', 'function', 'IntegrityCheck.js');
const viewPath = path.join(projectRoot, 'src', 'renderer', 'views', 'IntegrityLink.ejs');
const source = fs.readFileSync(integrityPath, 'utf8');

function extractTemplate(marker, fromIndex = 0) {
    const markerIndex = source.indexOf(marker, fromIndex);
    if (markerIndex < 0) throw new Error(`Marqueur introuvable: ${marker}`);

    const start = source.indexOf('`', markerIndex + marker.length);
    if (start < 0) throw new Error(`Template introuvable apres: ${marker}`);

    for (let index = start + 1; index < source.length; index += 1) {
        if (source[index] === '`' && source[index - 1] !== '\\') {
            return {
                literal: source.slice(start, index + 1),
                end: index + 1,
            };
        }
    }

    throw new Error(`Fin de template introuvable apres: ${marker}`);
}

function evaluateTemplate(literal, helpers = '') {
    return Function('SECURITY_ACTION_HELPERS', `"use strict"; return ${literal};`)(helpers);
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
        maxBuffer: 1024 * 1024 * 4,
        timeout: 30000,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${name}: PowerShell invalide\n${result.stdout}\n${result.stderr}`);
    }
}

function validateRendererScript() {
    const view = fs.readFileSync(viewPath, 'utf8');
    ejs.render(
        view,
        {
            author: 'Validation',
            githubLink: 'https://github.com/validation',
            version: '0.0.0-test',
        },
        { filename: viewPath }
    );
    const match = view.match(/<script>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Script renderer introuvable.');
    Function(match[1]);
}

function runReadOnlyPowerShell(name, script, timeout = 60000) {
    const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 8,
            timeout,
        }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${name}: execution en lecture seule impossible\n${result.stderr}`);
    }
    return result.stdout;
}

const helpersTemplate = extractTemplate('const SECURITY_ACTION_HELPERS =');
const helpers = evaluateTemplate(helpersTemplate.literal);
const integrityTemplate = extractTemplate('const INTEGRITY_SCRIPT =');
const scripts = {
    INTEGRITY_SCRIPT: evaluateTemplate(integrityTemplate.literal),
};

for (const actionId of [
    'microsoft-baseline-safe',
    'defender-hardened',
    'recommended-protection-restore',
    'hardware-security-check',
]) {
    const actionIndex = source.indexOf(`'${actionId}':`);
    if (actionIndex < 0) throw new Error(`Action introuvable: ${actionId}`);
    const actionTemplate = extractTemplate('script:', actionIndex);
    scripts[actionId] = evaluateTemplate(actionTemplate.literal, helpers);
}

for (const [name, script] of Object.entries(scripts)) {
    parsePowerShell(name, script);
}
validateRendererScript();

function requireScriptText(scriptName, text) {
    if (!scripts[scriptName].includes(text)) {
        throw new Error(`${scriptName}: garde-fou absent: ${text}`);
    }
}

function rejectScriptText(scriptName, text) {
    if (scripts[scriptName].includes(text)) {
        throw new Error(`${scriptName}: reglage potentiellement disruptif detecte: ${text}`);
    }
}

for (const requiredText of [
    "NetworkCategory -eq 'Public'",
    'Randomization=yes',
    "'SMB1Protocol'",
    "'TelnetClient'",
    "'TFTP'",
    "'MicrosoftWindowsPowerShellV2Root'",
    "'DontDisplayNetworkSelectionUI'",
]) {
    requireScriptText('microsoft-baseline-safe', requiredText);
}
for (const forbiddenText of [
    'Randomization=daily',
    'Disable-NetAdapterBinding',
    'EnableSMB2Protocol $false',
    'Set-NetConnectionProfile',
    'Remove-MpPreference -Exclusion',
]) {
    rejectScriptText('microsoft-baseline-safe', forbiddenText);
}
requireScriptText('recommended-protection-restore', 'ArtemisStore ne l avait pas desactive.');

if (process.argv.includes('--live')) {
    const diagnosticOutput = runReadOnlyPowerShell('INTEGRITY_SCRIPT', scripts.INTEGRITY_SCRIPT);
    const diagnostic = JSON.parse(diagnosticOutput.replace(/^\uFEFF/, '').trim());
    if (!Array.isArray(diagnostic.checks) || diagnostic.checks.length < 15) {
        throw new Error('Le diagnostic Windows retourne une liste incomplete.');
    }

    const hardwareOutput = runReadOnlyPowerShell(
        'hardware-security-check',
        scripts['hardware-security-check']
    );
    const structuredResults = hardwareOutput
        .split(/\r?\n/)
        .filter((line) => /^\[(OK|INFO|WARN|FAIL)\]/.test(line));
    if (structuredResults.length < 3) {
        throw new Error('L audit materiel ne retourne pas assez de controles structures.');
    }
    console.log(
        `Tests Windows en lecture seule OK: ${diagnostic.checks.length} controles generaux et ${structuredResults.length} controles materiels.`
    );
}

console.log(
    `Validation securite OK: ${Object.keys(scripts).length} scripts PowerShell et interface renderer valides.`
);
