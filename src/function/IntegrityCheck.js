const { app, ipcMain, Notification } = require('electron');
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

const SECURITY_ACTIONS = {
    'microsoft-baseline-safe': {
        title: 'Baseline Microsoft officielle',
        admin: true,
        script: `
$ErrorActionPreference = 'Continue'
"=== Pare-feu Windows ==="
Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True -DefaultInboundAction Block -DefaultOutboundAction Allow -NotifyOnListen True
Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction | Format-Table -AutoSize | Out-String

"=== Defender baseline ==="
Set-MpPreference -DisableRealtimeMonitoring $false
Set-MpPreference -DisableBehaviorMonitoring $false
Set-MpPreference -DisableIOAVProtection $false
Set-MpPreference -DisableScriptScanning $false
Set-MpPreference -MAPSReporting Advanced
Set-MpPreference -SubmitSamplesConsent SendSafeSamples
Set-MpPreference -PUAProtection Enabled
Get-MpPreference | Select-Object DisableRealtimeMonitoring,DisableBehaviorMonitoring,DisableIOAVProtection,DisableScriptScanning,MAPSReporting,SubmitSamplesConsent,PUAProtection | Format-List | Out-String
`,
    },
    'defender-hardened': {
        title: 'Protections Defender renforcees',
        admin: true,
        script: `
$ErrorActionPreference = 'Continue'
"=== Defender renforce ==="
Set-MpPreference -CloudBlockLevel High
Set-MpPreference -CloudExtendedTimeout 50
Set-MpPreference -EnableControlledFolderAccess AuditMode
Set-MpPreference -EnableNetworkProtection AuditMode
Set-MpPreference -ScanArchive $true
Set-MpPreference -CheckForSignaturesBeforeRunningScan $true
Update-MpSignature 2>&1 | Out-String
Get-MpPreference | Select-Object CloudBlockLevel,CloudExtendedTimeout,EnableControlledFolderAccess,EnableNetworkProtection,ScanArchive,CheckForSignaturesBeforeRunningScan | Format-List | Out-String
`,
    },
    'hardware-security-check': {
        title: 'Chiffrement + protections materielles',
        admin: true,
        script: `
$ErrorActionPreference = 'Continue'
"=== TPM ==="
Get-Tpm 2>&1 | Format-List | Out-String
"=== Secure Boot ==="
Confirm-SecureBootUEFI 2>&1 | Out-String
"=== BitLocker ==="
Get-BitLockerVolume 2>&1 | Select-Object MountPoint,VolumeStatus,ProtectionStatus,EncryptionPercentage,EncryptionMethod | Format-Table -AutoSize | Out-String
"=== Virtualization Based Security ==="
Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard 2>&1 | Select-Object SecurityServicesConfigured,SecurityServicesRunning,VirtualizationBasedSecurityStatus | Format-List | Out-String
"Aucune activation automatique de BitLocker ou Memory Integrity n'a ete effectuee. Ces protections dependent du materiel, des drivers et de la cle de recuperation."
`,
    },
};

const ASR_MODES = {
    none: 'Disabled',
    audit: 'AuditMode',
    on: 'Enabled',
};

const ASR_RULES = [
    {
        id: '56a863a9-875e-4185-98a7-b882c64b5ce5',
        title: 'Bloquer les drivers vulnerables signes',
        category: 'Standard',
        defaultMode: 'on',
    },
    {
        id: '9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2',
        title: 'Bloquer le vol LSASS',
        category: 'Standard sensible',
        defaultMode: 'audit',
    },
    {
        id: 'e6db77e5-3df2-4cf1-b95a-636979351e5b',
        title: 'Bloquer la persistance WMI',
        category: 'Standard sensible',
        defaultMode: 'audit',
    },
    {
        id: 'be9ba2d9-53ea-4cdc-84e5-9b1eeee46550',
        title: 'Bloquer executables depuis email/webmail',
        category: 'Email',
        defaultMode: 'on',
    },
    {
        id: '7674ba52-37eb-4a4f-a9a1-f0f9a1619a2c',
        title: 'Bloquer Adobe Reader creant des processus enfants',
        category: 'Adobe Reader',
        defaultMode: 'audit',
    },
    {
        id: '5beb7efe-fd9a-4556-801d-275e5ffc04cc',
        title: 'Bloquer scripts obfusques',
        category: 'Scripts',
        defaultMode: 'on',
    },
    {
        id: 'd3e037e1-3eb8-44c8-a917-57927947596d',
        title: 'Bloquer JS/VBS qui lance du contenu telecharge',
        category: 'Scripts',
        defaultMode: 'on',
    },
    {
        id: '92e97fa1-2edf-4476-bdd6-9dd0b4dddc7b',
        title: 'Bloquer appels Win32 depuis macros Office',
        category: 'Office',
        defaultMode: 'on',
    },
    {
        id: '3b576869-a4ec-4529-8536-b80a7769e899',
        title: 'Bloquer Office creant du contenu executable',
        category: 'Office',
        defaultMode: 'audit',
    },
    {
        id: 'd4f940ab-401b-4efc-aadc-ad5f3c50688a',
        title: 'Bloquer Office creant des processus enfants',
        category: 'Office',
        defaultMode: 'audit',
    },
    {
        id: '75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84',
        title: 'Bloquer Office injectant du code',
        category: 'Office',
        defaultMode: 'audit',
    },
    {
        id: '26190899-1602-49e8-8b27-eb1d0a1ce869',
        title: 'Bloquer Outlook/Teams creant des processus enfants',
        category: 'Office/email',
        defaultMode: 'audit',
    },
    {
        id: '01443614-cd74-433a-b99e-2ecdc07bfc25',
        title: 'Bloquer executables peu reputes',
        category: 'Reputation',
        defaultMode: 'audit',
    },
    {
        id: 'c1db55ab-c21a-4637-bb3f-a12568109d35',
        title: 'Protection avancee ransomware',
        category: 'Ransomware',
        defaultMode: 'audit',
    },
    {
        id: 'b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4',
        title: 'Bloquer processus non signes depuis USB',
        category: 'USB',
        defaultMode: 'audit',
    },
    {
        id: 'd1e49aac-8f56-4280-b9ba-993a6d77406c',
        title: 'Bloquer creations depuis PSExec/WMI',
        category: 'Lateral movement',
        defaultMode: 'audit',
    },
    {
        id: '33ddedf1-c6e0-47cb-833e-de6133960387',
        title: 'Bloquer redemarrage en mode sans echec',
        category: 'Systeme',
        defaultMode: 'audit',
    },
    {
        id: 'c0033c00-d16d-4114-a5a0-dc9b3a7d2ceb',
        title: 'Bloquer outils systeme copies/usurpes',
        category: 'Systeme',
        defaultMode: 'audit',
    },
    {
        id: 'a8f5898e-1dc8-49a9-9878-85004b8a61e6',
        title: 'Bloquer creation de Webshell sur serveurs',
        category: 'Serveur',
        defaultMode: 'audit',
    },
];

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

function modeFromDefenderValue(value) {
    const normalized = String(value || '').toLowerCase();
    if (['1', 'enabled', 'block'].includes(normalized)) return 'on';
    if (['2', 'auditmode', 'audit'].includes(normalized)) return 'audit';
    return 'none';
}

function validateAsrModes(modes) {
    const allowedIds = new Set(ASR_RULES.map((rule) => rule.id.toLowerCase()));
    const validated = {};

    for (const [id, mode] of Object.entries(modes || {})) {
        const normalizedId = id.toLowerCase();
        if (!allowedIds.has(normalizedId)) {
            throw new Error(`Regle ASR inconnue: ${id}`);
        }
        if (!Object.prototype.hasOwnProperty.call(ASR_MODES, mode)) {
            throw new Error(`Mode ASR invalide pour ${id}: ${mode}`);
        }
        validated[normalizedId] = mode;
    }

    return validated;
}

function getDefaultAsrModes() {
    return Object.fromEntries(ASR_RULES.map((rule) => [rule.id, rule.defaultMode]));
}

function runJsonPowerShell(script) {
    return new Promise((resolve, reject) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                    return;
                }

                try {
                    resolve(JSON.parse(stdout || '{}'));
                } catch (err) {
                    reject(new Error(`JSON PowerShell invalide: ${err.message}`));
                }
            }
        );
    });
}

async function getAsrState() {
    const result = await runJsonPowerShell(`
$pref = Get-MpPreference
$ids = @($pref.AttackSurfaceReductionRules_Ids)
$actions = @($pref.AttackSurfaceReductionRules_Actions)
$items = @()
for ($i = 0; $i -lt $ids.Count; $i++) {
    $items += [PSCustomObject]@{
        id = [string]$ids[$i]
        action = [string]$actions[$i]
    }
}
[PSCustomObject]@{ rules = $items } | ConvertTo-Json -Depth 4 -Compress
`);
    const configured = {};
    for (const item of result.rules || []) {
        configured[String(item.id).toLowerCase()] = modeFromDefenderValue(item.action);
    }

    return ASR_RULES.map((rule) => ({
        ...rule,
        mode: configured[rule.id.toLowerCase()] || 'none',
    }));
}

async function applyAsrRules(modes) {
    const validated = validateAsrModes(modes);
    const ids = Object.keys(validated);
    const actions = ids.map((id) => ASR_MODES[validated[id]]);
    const startedAt = Date.now();

    if (!ids.length) {
        throw new Error('Aucune regle ASR a appliquer.');
    }

    const script = `
$ErrorActionPreference = 'Continue'
$ids = @(${ids.map(psSingleQuote).join(',')})
$actions = @(${actions.map(psSingleQuote).join(',')})
Set-MpPreference -AttackSurfaceReductionRules_Ids $ids -AttackSurfaceReductionRules_Actions $actions
Get-MpPreference | Select-Object AttackSurfaceReductionRules_Ids,AttackSurfaceReductionRules_Actions | Format-List | Out-String
`;

    const result = await runElevatedPowerShellScript(script);
    return {
        ...buildAdvancedResult(
            { id: 'asr-rules', title: 'Regles ASR', admin: true },
            result.output,
            result.exitCode,
            startedAt
        ),
        rules: await getAsrState(),
    };
}

async function getAsrHistory(limit = 30) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const result = await runJsonPowerShell(`
$ids = 1121,1122,1125,1126,1131,1132,1133,1134
$events = Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-Windows Defender/Operational'; Id=$ids } -MaxEvents ${boundedLimit} -ErrorAction SilentlyContinue
$items = @($events | ForEach-Object {
    [PSCustomObject]@{
        id = $_.Id
        timeCreated = $_.TimeCreated.ToString('s')
        message = ($_.Message -replace "\\r?\\n", " ").Trim()
    }
})
[PSCustomObject]@{ events = $items } | ConvertTo-Json -Depth 4 -Compress
`);

    return result.events || [];
}

let lastAsrEventTime = null;
let asrMonitorStarted = false;

async function notifyRecentAsrEvents() {
    try {
        const events = await getAsrHistory(5);
        const newest = events[0];
        if (!newest) return;

        const newestTime = newest.timeCreated;
        if (!lastAsrEventTime) {
            lastAsrEventTime = newestTime;
            return;
        }
        if (newestTime <= lastAsrEventTime) return;

        lastAsrEventTime = newestTime;
        if (Notification.isSupported()) {
            new Notification({
                title: 'Detection ASR Microsoft Defender',
                body: String(newest.message || 'Evenement ASR detecte.').slice(0, 180),
            }).show();
        }
    } catch (err) {
        logger.warn(`[IntegrityCheck] Monitoring ASR indisponible : ${err.message}`);
    }
}

function startAsrEventMonitor() {
    if (asrMonitorStarted) return;
    asrMonitorStarted = true;
    setInterval(() => {
        void notifyRecentAsrEvents();
    }, 60000);
    void notifyRecentAsrEvents();
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

async function runSecurityAction(id) {
    const action = SECURITY_ACTIONS[id];
    if (!action) {
        throw new Error(`Action securite inconnue: ${id}`);
    }

    const startedAt = Date.now();
    const runnable = { ...action, id };
    const result = action.admin
        ? await runElevatedPowerShellScript(action.script)
        : await runPowerShellScript(action.script);

    return buildAdvancedResult(runnable, result.output, result.exitCode, startedAt);
}

function setupIntegrityCheckListener() {
    startAsrEventMonitor();

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

    ipcMain.on('run-security-action', async (event, id) => {
        logger.info(`[IntegrityCheck] Action securite lancee : ${id}`);
        try {
            const result = await runSecurityAction(id);
            event.sender.send('security-action-result', result);
        } catch (err) {
            logger.error('[IntegrityCheck] Echec action securite : ' + err.message);
            event.sender.send('security-action-result', {
                id,
                title: SECURITY_ACTIONS[id]?.title || id,
                status: 'error',
                exitCode: 1,
                durationMs: 0,
                admin: Boolean(SECURITY_ACTIONS[id]?.admin),
                output: err.message,
            });
        }
    });

    ipcMain.on('get-asr-state', async (event) => {
        logger.info('[IntegrityCheck] Lecture etat ASR.');
        try {
            event.sender.send('asr-state-result', {
                success: true,
                rules: await getAsrState(),
                defaults: getDefaultAsrModes(),
            });
        } catch (err) {
            logger.error('[IntegrityCheck] Echec lecture ASR : ' + err.message);
            event.sender.send('asr-state-result', {
                success: false,
                error: err.message,
                rules: ASR_RULES.map((rule) => ({ ...rule, mode: 'none' })),
                defaults: getDefaultAsrModes(),
            });
        }
    });

    ipcMain.on('set-asr-rules', async (event, modes) => {
        logger.info('[IntegrityCheck] Application regles ASR.');
        try {
            const result = await applyAsrRules(modes);
            event.sender.send('asr-rules-result', { success: true, result });
        } catch (err) {
            logger.error('[IntegrityCheck] Echec application ASR : ' + err.message);
            event.sender.send('asr-rules-result', {
                success: false,
                error: err.message,
            });
        }
    });

    ipcMain.on('get-asr-history', async (event) => {
        logger.info('[IntegrityCheck] Lecture historique ASR.');
        try {
            event.sender.send('asr-history-result', {
                success: true,
                events: await getAsrHistory(50),
            });
        } catch (err) {
            logger.error('[IntegrityCheck] Echec historique ASR : ' + err.message);
            event.sender.send('asr-history-result', {
                success: false,
                error: err.message,
                events: [],
            });
        }
    });
}

module.exports = {
    setupIntegrityCheckListener,
};
