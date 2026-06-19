const { app, ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../bin/logger');

const INTEGRITY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'

function New-Check($id, $title, $status, $summary, $details = @()) {
    [PSCustomObject]@{
        id = $id
        title = $title
        status = $status
        summary = $summary
        details = @($details | Where-Object { $_ -ne $null -and $_ -ne '' })
    }
}

$checks = New-Object System.Collections.Generic.List[object]

$os = Get-CimInstance Win32_OperatingSystem
$uptime = (Get-Date) - $os.LastBootUpTime
$checks.Add((New-Check 'windows' 'Windows' 'ok' "$($os.Caption) $($os.Version)" @(
    "Build: $($os.BuildNumber)",
    "Dernier demarrage: $($os.LastBootUpTime)",
    "Uptime: $([math]::Round($uptime.TotalHours, 1)) h"
)))

$securityProducts = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct
if ($securityProducts) {
    $checks.Add((New-Check 'antivirus' 'Antivirus detecte' 'ok' ($securityProducts.displayName -join ', ') @(
        $securityProducts | ForEach-Object { "$($_.displayName) - state: $($_.productState)" }
    )))
} else {
    $checks.Add((New-Check 'antivirus' 'Antivirus detecte' 'warning' 'Aucun antivirus remonte par Security Center.' @(
        'Si Microsoft Defender est desactive volontairement par une solution tierce, ce point peut etre normal.'
    )))
}

$mp = Get-MpComputerStatus
if ($mp) {
    $defenderStatus = if ($mp.AntivirusEnabled -and $mp.RealTimeProtectionEnabled) { 'ok' } else { 'warning' }
    $checks.Add((New-Check 'defender' 'Microsoft Defender' $defenderStatus "Protection temps reel: $($mp.RealTimeProtectionEnabled)" @(
        "Antivirus active: $($mp.AntivirusEnabled)",
        "Antispyware active: $($mp.AntispywareEnabled)",
        "Signature AV: $($mp.AntivirusSignatureVersion)",
        "Derniere MAJ signature: $($mp.AntivirusSignatureLastUpdated)",
        "Dernier scan rapide: $($mp.QuickScanEndTime)",
        "Menaces actives: $($mp.FullScanRequired -or $mp.RebootRequired)"
    )))
} else {
    $checks.Add((New-Check 'defender' 'Microsoft Defender' 'warning' 'Statut Defender indisponible.' @(
        'La commande Get-MpComputerStatus est indisponible ou Defender est remplace par un autre antivirus.'
    )))
}

$firewallProfiles = Get-NetFirewallProfile
if ($firewallProfiles) {
    $disabled = @($firewallProfiles | Where-Object { -not $_.Enabled })
    $status = if ($disabled.Count -eq 0) { 'ok' } else { 'warning' }
    $checks.Add((New-Check 'firewall' 'Pare-feu Windows' $status "$(3 - $disabled.Count)/3 profils actifs" @(
        $firewallProfiles | ForEach-Object { "$($_.Name): Enabled=$($_.Enabled)" }
    )))
} else {
    $checks.Add((New-Check 'firewall' 'Pare-feu Windows' 'warning' 'Statut pare-feu indisponible.'))
}

$services = @(
    @{ Name = 'wuauserv'; Label = 'Windows Update' },
    @{ Name = 'WinDefend'; Label = 'Service Defender' },
    @{ Name = 'SecurityHealthService'; Label = 'Sante securite Windows' },
    @{ Name = 'BITS'; Label = 'BITS' }
)
$serviceDetails = foreach ($svc in $services) {
    $item = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
    if ($item) { "$($svc.Label): $($item.Status)" } else { "$($svc.Label): introuvable" }
}
$missingOrStopped = @($serviceDetails | Where-Object { $_ -notmatch ': Running$' })
$checks.Add((New-Check 'services' 'Services Windows essentiels' ($(if ($missingOrStopped.Count -eq 0) { 'ok' } else { 'warning' })) 'Services critiques pour update/securite' $serviceDetails))

$drives = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
$driveWarnings = @()
$driveDetails = foreach ($drive in $drives) {
    $freePct = if ($drive.Size -gt 0) { [math]::Round(($drive.FreeSpace / $drive.Size) * 100, 1) } else { 0 }
    if ($freePct -lt 15) { $driveWarnings += $drive.DeviceID }
    "$($drive.DeviceID) libre: $([math]::Round($drive.FreeSpace / 1GB, 1)) Go / $([math]::Round($drive.Size / 1GB, 1)) Go ($freePct%)"
}
$checks.Add((New-Check 'disk-space' 'Espace disque' ($(if ($driveWarnings.Count -eq 0) { 'ok' } else { 'warning' })) ($(if ($driveWarnings.Count -eq 0) { 'Espace disque OK' } else { 'Espace faible sur: ' + ($driveWarnings -join ', ') })) $driveDetails))

$diskHealth = Get-PhysicalDisk
if ($diskHealth) {
    $badDisks = @($diskHealth | Where-Object { $_.HealthStatus -ne 'Healthy' })
    $checks.Add((New-Check 'disk-health' 'Sante des disques' ($(if ($badDisks.Count -eq 0) { 'ok' } else { 'error' })) ($(if ($badDisks.Count -eq 0) { 'Tous les disques sont Healthy' } else { 'Un ou plusieurs disques ne sont pas Healthy' })) @(
        $diskHealth | ForEach-Object { "$($_.FriendlyName): $($_.HealthStatus) / $($_.OperationalStatus -join ',')" }
    )))
} else {
    $checks.Add((New-Check 'disk-health' 'Sante des disques' 'warning' 'Statut disque indisponible.'))
}

$bitlocker = Get-BitLockerVolume -ErrorAction SilentlyContinue
if ($bitlocker) {
    $unprotected = @($bitlocker | Where-Object { $_.ProtectionStatus -ne 'On' -and $_.VolumeStatus -eq 'FullyEncrypted' })
    $checks.Add((New-Check 'bitlocker' 'BitLocker' ($(if ($unprotected.Count -eq 0) { 'ok' } else { 'warning' })) 'Etat du chiffrement des volumes' @(
        $bitlocker | ForEach-Object { "$($_.MountPoint): $($_.VolumeStatus), protection $($_.ProtectionStatus)" }
    )))
} else {
    $checks.Add((New-Check 'bitlocker' 'BitLocker' 'info' 'Aucun volume BitLocker detecte ou module indisponible.'))
}

$pendingRebootKeys = @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending',
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired'
)
$pendingReboot = $pendingRebootKeys | Where-Object { Test-Path $_ }
$checks.Add((New-Check 'reboot' 'Redemarrage requis' ($(if ($pendingReboot) { 'warning' } else { 'ok' })) ($(if ($pendingReboot) { 'Un redemarrage est en attente.' } else { 'Aucun redemarrage en attente detecte.' })) $pendingReboot))

$updateSession = New-Object -ComObject Microsoft.Update.Session
$updateSearcher = $updateSession.CreateUpdateSearcher()
$historyCount = $updateSearcher.GetTotalHistoryCount()
$history = if ($historyCount -gt 0) { $updateSearcher.QueryHistory(0, [Math]::Min(5, $historyCount)) } else { @() }
$lastUpdate = $history | Select-Object -First 1
$checks.Add((New-Check 'windows-update-history' 'Historique Windows Update' ($(if ($lastUpdate) { 'ok' } else { 'warning' })) ($(if ($lastUpdate) { "Derniere activite: $($lastUpdate.Date)" } else { 'Aucun historique recent trouve.' })) @(
    $history | ForEach-Object { "$($_.Date): $($_.Title) (result=$($_.ResultCode))" }
)))

$errors = @($checks | Where-Object { $_.status -eq 'error' }).Count
$warnings = @($checks | Where-Object { $_.status -eq 'warning' }).Count
$overall = if ($errors -gt 0) { 'error' } elseif ($warnings -gt 0) { 'warning' } else { 'ok' }

[PSCustomObject]@{
    generatedAt = (Get-Date).ToString('s')
    overall = $overall
    errors = $errors
    warnings = $warnings
    checks = $checks
} | ConvertTo-Json -Depth 6 -Compress
`;

const ADVANCED_CHECKS = {
    'defender-signature-update': {
        title: 'Mettre a jour les signatures Defender',
        admin: false,
        script: `
$ErrorActionPreference = 'Continue'
Update-MpSignature 2>&1 | Out-String
Get-MpComputerStatus | Select-Object AntivirusSignatureVersion,AntivirusSignatureLastUpdated | Format-List | Out-String
`,
    },
    'defender-quick-scan': {
        title: 'Scan rapide Microsoft Defender',
        admin: false,
        script: `
$ErrorActionPreference = 'Continue'
Start-MpScan -ScanType QuickScan 2>&1 | Out-String
Get-MpComputerStatus | Select-Object QuickScanStartTime,QuickScanEndTime,FullScanRequired,RebootRequired | Format-List | Out-String
`,
    },
    'sfc-verifyonly': {
        title: 'SFC verification seule',
        admin: true,
        script: `& sfc.exe /verifyonly 2>&1 | Out-String`,
    },
    'sfc-scannow': {
        title: 'SFC scan et reparation',
        admin: true,
        script: `& sfc.exe /scannow 2>&1 | Out-String`,
    },
    'dism-checkhealth': {
        title: 'DISM CheckHealth',
        admin: true,
        script: `& dism.exe /Online /Cleanup-Image /CheckHealth 2>&1 | Out-String`,
    },
    'dism-scanhealth': {
        title: 'DISM ScanHealth',
        admin: true,
        script: `& dism.exe /Online /Cleanup-Image /ScanHealth 2>&1 | Out-String`,
    },
    'dism-restorehealth': {
        title: 'DISM RestoreHealth',
        admin: true,
        script: `& dism.exe /Online /Cleanup-Image /RestoreHealth 2>&1 | Out-String`,
    },
    'dism-analyze-component-store': {
        title: 'DISM analyse du component store',
        admin: true,
        script: `& dism.exe /Online /Cleanup-Image /AnalyzeComponentStore 2>&1 | Out-String`,
    },
    'chkdsk-scan': {
        title: 'CHKDSK scan en ligne',
        admin: true,
        script: `& chkdsk.exe C: /scan 2>&1 | Out-String`,
    },
    'network-basics': {
        title: 'Check reseau de base',
        admin: false,
        script: `
$ErrorActionPreference = 'Continue'
"=== IP ==="
Get-NetIPConfiguration | Format-List InterfaceAlias,IPv4Address,IPv4DefaultGateway,DNSServer | Out-String
"=== DNS microsoft.com ==="
Resolve-DnsName microsoft.com 2>&1 | Out-String
"=== Connexion HTTPS Microsoft ==="
Test-NetConnection www.microsoft.com -Port 443 | Format-List | Out-String
`,
    },
};

function runIntegrityChecks() {
    return new Promise((resolve, reject) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', INTEGRITY_SCRIPT],
            { windowsHide: true, maxBuffer: 1024 * 1024 * 4 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                    return;
                }

                try {
                    resolve(JSON.parse(stdout));
                } catch (err) {
                    reject(new Error(`Resultat integrity invalide: ${err.message}`));
                }
            }
        );
    });
}

function psSingleQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeOutput(output) {
    return String(output || '')
        .replace(/\r/g, '')
        .trim();
}

function parseAdvancedStatus(exitCode, output) {
    const text = output.toLowerCase();
    if (exitCode !== 0) return 'warning';
    if (
        text.includes('found corrupt') ||
        text.includes('repairable') ||
        text.includes('not repaired') ||
        text.includes('could not be performed') ||
        text.includes('répar') ||
        text.includes('failed') ||
        text.includes('cannot') ||
        text.includes('erreur') ||
        text.includes('error')
    ) {
        return 'warning';
    }
    return 'ok';
}

function buildAdvancedResult(check, output, exitCode, startedAt) {
    const durationMs = Date.now() - startedAt;
    const normalized = normalizeOutput(output);
    return {
        id: check.id,
        title: check.title,
        status: parseAdvancedStatus(exitCode, normalized),
        exitCode,
        durationMs,
        admin: check.admin,
        output: normalized || 'Commande terminee sans sortie texte.',
    };
}

function runPowerShellScript(script) {
    return new Promise((resolve) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { windowsHide: true, maxBuffer: 1024 * 1024 * 12 },
            (error, stdout, stderr) => {
                resolve({
                    exitCode: error && typeof error.code === 'number' ? error.code : 0,
                    output: [stdout, stderr].filter(Boolean).join('\n'),
                });
            }
        );
    });
}

function runElevatedPowerShellScript(script) {
    return new Promise((resolve) => {
        const scriptPath = path.join(
            app.getPath('temp'),
            `artemisstore-advanced-${Date.now()}.ps1`
        );
        const resultPath = `${scriptPath}.json`;

        fs.writeFileSync(
            scriptPath,
            `
$ErrorActionPreference = 'Continue'
$output = try {
${script}
} catch {
    $_ | Out-String
}
$exitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }
[PSCustomObject]@{
    exitCode = $exitCode
    output = ($output | Out-String)
} | ConvertTo-Json -Depth 4 | Set-Content -Path ${psSingleQuote(resultPath)} -Encoding UTF8
exit 0
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
            { windowsHide: true, maxBuffer: 1024 * 1024 },
            (error) => {
                const rawResult = readTempFile(resultPath);
                removeTempFile(scriptPath);
                removeTempFile(resultPath);

                if (rawResult) {
                    try {
                        resolve(JSON.parse(rawResult));
                        return;
                    } catch (err) {
                        resolve({ exitCode: 1, output: rawResult });
                        return;
                    }
                }

                resolve({
                    exitCode: error && typeof error.code === 'number' ? error.code : 1,
                    output: "Commande admin annulee ou aucun resultat retourne. Verifie que l'UAC a bien ete accepte.",
                });
            }
        );
    });
}

function readTempFile(filePath) {
    try {
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    } catch (err) {
        return '';
    }
}

function removeTempFile(filePath) {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        logger.warn(`[IntegrityCheck] Impossible de supprimer ${filePath} : ${err.message}`);
    }
}

async function runAdvancedIntegrityCheck(id) {
    const check = ADVANCED_CHECKS[id];
    if (!check) {
        throw new Error(`Check avance inconnu: ${id}`);
    }

    const startedAt = Date.now();
    const runnable = { ...check, id };
    const result = check.admin
        ? await runElevatedPowerShellScript(check.script)
        : await runPowerShellScript(check.script);

    return buildAdvancedResult(runnable, result.output, result.exitCode, startedAt);
}

function setupIntegrityCheckListener() {
    ipcMain.on('run-integrity-check', async (event) => {
        logger.info('[IntegrityCheck] Diagnostic systeme lance.');
        try {
            const result = await runIntegrityChecks();
            event.sender.send('integrity-result', result);
        } catch (err) {
            logger.error('[IntegrityCheck] Echec diagnostic : ' + err.message);
            event.sender.send('integrity-result', {
                generatedAt: new Date().toISOString(),
                overall: 'error',
                errors: 1,
                warnings: 0,
                checks: [
                    {
                        id: 'integrity-error',
                        title: 'Diagnostic impossible',
                        status: 'error',
                        summary: err.message,
                        details: [],
                    },
                ],
            });
        }
    });

    ipcMain.on('run-integrity-advanced-check', async (event, id) => {
        logger.info(`[IntegrityCheck] Check avance lance : ${id}`);
        try {
            const result = await runAdvancedIntegrityCheck(id);
            event.sender.send('integrity-advanced-result', result);
        } catch (err) {
            logger.error('[IntegrityCheck] Echec check avance : ' + err.message);
            event.sender.send('integrity-advanced-result', {
                id,
                title: ADVANCED_CHECKS[id]?.title || id,
                status: 'error',
                exitCode: 1,
                durationMs: 0,
                admin: Boolean(ADVANCED_CHECKS[id]?.admin),
                output: err.message,
            });
        }
    });
}

module.exports = {
    setupIntegrityCheckListener,
};
