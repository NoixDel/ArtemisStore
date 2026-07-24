const { app, ipcMain, Notification } = require('electron');
const { execFile } = require('child_process');
const { createHash, randomUUID } = require('crypto');
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

$securityProducts = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct)
$thirdPartyProducts = @($securityProducts | Where-Object { $_.displayName -notmatch 'Microsoft Defender|Windows Defender' })
if ($securityProducts) {
    $checks.Add((New-Check 'antivirus' 'Antivirus detecte' 'ok' ($securityProducts.displayName -join ', ') @(
        $securityProducts | ForEach-Object { "$($_.displayName) (enregistre dans le Centre de securite)" }
    )))
} else {
    $checks.Add((New-Check 'antivirus' 'Antivirus detecte' 'warning' 'Aucun antivirus remonte par Security Center.' @(
        'Le Centre de securite Windows ne signale aucun fournisseur antivirus.'
    )))
}

$mp = Get-MpComputerStatus
$mpPreference = Get-MpPreference
if ($mp) {
    $defenderActive = $mp.AntivirusEnabled -and $mp.AMServiceEnabled
    $defenderStatus = if ($defenderActive -and $mp.RealTimeProtectionEnabled) {
        'ok'
    } elseif ($thirdPartyProducts.Count -gt 0) {
        'info'
    } else {
        'warning'
    }
    $defenderSummary = if ($defenderActive) {
        "Protection temps reel: $($mp.RealTimeProtectionEnabled)"
    } elseif ($thirdPartyProducts.Count -gt 0) {
        'Mode passif probable: antivirus tiers detecte.'
    } else {
        'Defender Antivirus ne semble pas actif.'
    }
    $signatureAge = if ($mp.AntivirusSignatureLastUpdated) {
        [math]::Round(((Get-Date) - $mp.AntivirusSignatureLastUpdated).TotalDays, 1)
    } else {
        $null
    }
    if ($defenderStatus -eq 'ok' -and $signatureAge -ne $null -and $signatureAge -gt 7) {
        $defenderStatus = 'warning'
        $defenderSummary = "Signatures Defender anciennes: $signatureAge jours."
    }
    $checks.Add((New-Check 'defender' 'Microsoft Defender Antivirus' $defenderStatus $defenderSummary @(
        "Antivirus active: $($mp.AntivirusEnabled)",
        "Service antimalware actif: $($mp.AMServiceEnabled)",
        "Protection comportementale: $($mp.BehaviorMonitorEnabled)",
        "Analyse des telechargements: $($mp.IoavProtectionEnabled)",
        "Protection contre les falsifications: $($mp.IsTamperProtected)",
        "Signature AV: $($mp.AntivirusSignatureVersion)",
        "Derniere MAJ signature: $($mp.AntivirusSignatureLastUpdated)",
        "Dernier scan rapide: $($mp.QuickScanEndTime)",
        "Scan complet requis: $($mp.FullScanRequired)",
        "Redemarrage Defender requis: $($mp.RebootRequired)"
    )))
} else {
    $status = if ($thirdPartyProducts.Count -gt 0) { 'info' } else { 'warning' }
    $checks.Add((New-Check 'defender' 'Microsoft Defender Antivirus' $status 'Statut Defender indisponible.' @(
        'Defender peut etre en mode passif lorsqu un antivirus tiers est actif.'
    )))
}

if ($mpPreference -and $mp -and $mp.AntivirusEnabled) {
    $puaEnabled = [string]$mpPreference.PUAProtection -in @('1', 'Enabled')
    $cloudEnabled = [string]$mpPreference.MAPSReporting -notin @('0', 'Disabled')
    $sampleSubmissionEnabled = [string]$mpPreference.SubmitSamplesConsent -notin @('2', 'NeverSend')
    $networkProtection = [string]$mpPreference.EnableNetworkProtection
    $defenderConfigurationStatus = if ($puaEnabled -and $cloudEnabled -and $sampleSubmissionEnabled) { 'ok' } else { 'warning' }
    $checks.Add((New-Check 'defender-configuration' 'Configuration Defender' $defenderConfigurationStatus ($(if ($defenderConfigurationStatus -eq 'ok') { 'Protections cloud et PUA configurees.' } else { 'Certaines protections recommandees sont inactives.' })) @(
        "Applications potentiellement indesirables (PUA): $($mpPreference.PUAProtection)",
        "Protection cloud (MAPS): $($mpPreference.MAPSReporting)",
        "Envoi des echantillons surs: $($mpPreference.SubmitSamplesConsent)",
        "Blocage au premier signal desactive: $($mpPreference.DisableBlockAtFirstSeen)",
        "Protection reseau: $networkProtection",
        "Acces controle aux dossiers: $($mpPreference.EnableControlledFolderAccess)"
    )))
} elseif ($thirdPartyProducts.Count -gt 0) {
    $checks.Add((New-Check 'defender-configuration' 'Configuration Defender' 'info' 'Non evaluee: antivirus tiers detecte.'))
} else {
    $checks.Add((New-Check 'defender-configuration' 'Configuration Defender' 'warning' 'Non evaluee: Defender est inactif et aucun antivirus tiers n est signale.'))
}

$firewallProfiles = Get-NetFirewallProfile
if ($firewallProfiles) {
    $disabled = @($firewallProfiles | Where-Object { -not $_.Enabled })
    $unsafeInbound = @($firewallProfiles | Where-Object { [string]$_.DefaultInboundAction -eq 'Allow' })
    $status = if ($disabled.Count -eq 0 -and $unsafeInbound.Count -eq 0) { 'ok' } else { 'warning' }
    $checks.Add((New-Check 'firewall' 'Pare-feu Windows' $status "$($firewallProfiles.Count - $disabled.Count)/$($firewallProfiles.Count) profils actifs" @(
        $firewallProfiles | ForEach-Object { "$($_.Name): actif=$($_.Enabled), entrant=$($_.DefaultInboundAction), sortant=$($_.DefaultOutboundAction)" }
    )))
} else {
    $checks.Add((New-Check 'firewall' 'Pare-feu Windows' 'warning' 'Statut pare-feu indisponible.'))
}

$uacPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'
$uac = Get-ItemProperty -Path $uacPath
$uacEnabled = $uac.EnableLUA -eq 1
$uacSecureDesktop = $uac.PromptOnSecureDesktop -eq 1
$checks.Add((New-Check 'uac' 'Controle de compte utilisateur (UAC)' ($(if ($uacEnabled -and $uacSecureDesktop) { 'ok' } else { 'warning' })) ($(if ($uacEnabled) { 'UAC actif.' } else { 'UAC desactive: risque eleve.' })) @(
    "UAC actif: $uacEnabled",
    "Demande sur le bureau securise: $uacSecureDesktop",
    "Niveau de consentement administrateur: $($uac.ConsentPromptBehaviorAdmin)"
)))

$smartScreenExplorer = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer').SmartScreenEnabled
$smartScreenWeb = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppHost').EnableWebContentEvaluation
$smartScreenStatus = if ($smartScreenExplorer -in @('Warn', 'RequireAdmin') -and $smartScreenWeb -ne 0) { 'ok' } else { 'warning' }
$checks.Add((New-Check 'smartscreen' 'Microsoft Defender SmartScreen' $smartScreenStatus ($(if ($smartScreenStatus -eq 'ok') { 'Verification de reputation active.' } else { 'SmartScreen est desactive ou incomplet.' })) @(
    "Applications et fichiers: $smartScreenExplorer",
    "Contenu web des applications Store: $smartScreenWeb"
)))

$lockPolicyPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System'
$lockPolicies = Get-ItemProperty -Path $lockPolicyPath
$networkLocked = $lockPolicies.DontDisplayNetworkSelectionUI -eq 1
$notificationsHidden = $lockPolicies.DisableLockScreenAppNotifications -eq 1
$accessibilityFiles = @('utilman.exe', 'sethc.exe', 'osk.exe', 'Narrator.exe', 'Magnify.exe')
$accessibilityHijacks = @()
$invalidAccessibilitySignatures = @()
foreach ($fileName in $accessibilityFiles) {
    $ifeoPath = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\$fileName"
    $debugger = (Get-ItemProperty -Path $ifeoPath -Name Debugger).Debugger
    if ($debugger) {
        $accessibilityHijacks += "$fileName -> $debugger"
    }
    $filePath = Join-Path $env:SystemRoot "System32\\$fileName"
    if (Test-Path $filePath) {
        $signature = Get-AuthenticodeSignature -FilePath $filePath
        $publisher = [string]$signature.SignerCertificate.Subject
        if ([string]$signature.Status -ne 'Valid' -or $publisher -notmatch 'Microsoft') {
            $invalidAccessibilitySignatures += "$fileName ($($signature.Status), editeur Microsoft=$($publisher -match 'Microsoft'))"
        }
    } else {
        $invalidAccessibilitySignatures += "$fileName (fichier absent)"
    }
}
$lockScreenStatus = if ($networkLocked -and $notificationsHidden -and $accessibilityHijacks.Count -eq 0 -and $invalidAccessibilitySignatures.Count -eq 0) { 'ok' } else { 'warning' }
$checks.Add((New-Check 'lock-screen-security' 'Protection quand le PC est verrouille' $lockScreenStatus ($(if ($lockScreenStatus -eq 'ok') { 'Ecran verrouille protege sans desactiver l accessibilite.' } else { 'Certaines protections de l ecran verrouille peuvent etre renforcees.' })) @(
    "Modification du reseau avant connexion bloquee: $networkLocked",
    "Notifications privees masquees: $notificationsHidden",
    "Detournements des outils d accessibilite: $($accessibilityHijacks.Count)",
    "Signatures d accessibilite invalides: $($invalidAccessibilitySignatures.Count)",
    $accessibilityHijacks,
    $invalidAccessibilitySignatures
)))

$services = @(
    @{ Name = 'wuauserv'; Label = 'Windows Update' },
    @{ Name = 'SecurityHealthService'; Label = 'Sante securite Windows' },
    @{ Name = 'BITS'; Label = 'BITS' }
)
if ($mp -and $mp.AntivirusEnabled) {
    $services += @{ Name = 'WinDefend'; Label = 'Service Defender' }
}
$serviceDetails = foreach ($svc in $services) {
    $item = Get-CimInstance Win32_Service -Filter "Name='$($svc.Name)'"
    if ($item) { "$($svc.Label): etat=$($item.State), demarrage=$($item.StartMode)" } else { "$($svc.Label): introuvable" }
}
$disabledServices = @($serviceDetails | Where-Object { $_ -match 'demarrage=Disabled' -or $_ -match 'introuvable' })
$checks.Add((New-Check 'services' 'Services Windows essentiels' ($(if ($disabledServices.Count -eq 0) { 'ok' } else { 'warning' })) 'Les services a demarrage manuel ne sont pas signales a tort.' $serviceDetails))

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

$bitlockerCommand = Get-Command Get-BitLockerVolume
$systemVolume = if ($bitlockerCommand) { Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction SilentlyContinue } else { $null }
if ($systemVolume) {
    $fullyProtected = [string]$systemVolume.VolumeStatus -eq 'FullyEncrypted' -and [string]$systemVolume.ProtectionStatus -eq 'On'
    $bitlockerStatus = if ($fullyProtected) { 'ok' } elseif ([string]$systemVolume.VolumeStatus -eq 'EncryptionInProgress') { 'info' } else { 'warning' }
    $protectorTypes = @($systemVolume.KeyProtector | ForEach-Object { [string]$_.KeyProtectorType }) -join ', '
    $checks.Add((New-Check 'bitlocker' 'Chiffrement du disque systeme' $bitlockerStatus ($(if ($fullyProtected) { 'BitLocker chiffre et protege le volume systeme.' } else { 'Le volume systeme n est pas entierement protege.' })) @(
        "Volume: $($systemVolume.MountPoint)",
        "Etat: $($systemVolume.VolumeStatus)",
        "Protection: $($systemVolume.ProtectionStatus)",
        "Progression: $($systemVolume.EncryptionPercentage)%",
        "Methode: $($systemVolume.EncryptionMethod)",
        "Types de protecteurs: $protectorTypes"
    )))
} else {
    $checks.Add((New-Check 'bitlocker' 'Chiffrement du disque systeme' 'info' 'Etat BitLocker indisponible sur cette edition ou sans elevation.' @(
        "Volume systeme: $env:SystemDrive",
        'Utilise la verification Chiffrement et materiel pour obtenir un diagnostic complet avec UAC.'
    )))
}

$tpm = Get-Tpm
$secureBoot = $null
$secureBootSupported = $true
try {
    $secureBoot = Confirm-SecureBootUEFI -ErrorAction Stop
} catch {
    $secureBootSupported = $false
}
$hardwareReady = $tpm -and $tpm.TpmPresent -and $tpm.TpmReady -and $secureBoot -eq $true
$checks.Add((New-Check 'hardware-security' 'Securite materielle' ($(if ($hardwareReady) { 'ok' } else { 'warning' })) ($(if ($hardwareReady) { 'TPM pret et demarrage securise actif.' } else { 'Une protection materielle est absente, inactive ou indisponible.' })) @(
    "TPM present: $($tpm.TpmPresent)",
    "TPM pret: $($tpm.TpmReady)",
    "Secure Boot supporte: $secureBootSupported",
    "Secure Boot actif: $secureBoot"
)))

$deviceGuard = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard
if ($deviceGuard) {
    $runningServices = @($deviceGuard.SecurityServicesRunning)
    $vbsRunning = $deviceGuard.VirtualizationBasedSecurityStatus -eq 2
    $memoryIntegrityRunning = $runningServices -contains 2
    $checks.Add((New-Check 'vbs' 'Isolation du noyau (VBS)' ($(if ($vbsRunning -and $memoryIntegrityRunning) { 'ok' } else { 'info' })) ($(if ($memoryIntegrityRunning) { 'Integrite de la memoire active.' } elseif ($vbsRunning) { 'VBS actif, integrite de la memoire non detectee.' } else { 'VBS non actif ou non pris en charge.' })) @(
        "Etat VBS: $($deviceGuard.VirtualizationBasedSecurityStatus)",
        "Integrite de la memoire active: $memoryIntegrityRunning",
        "Credential Guard actif: $($runningServices -contains 1)",
        "Proprietes materielles disponibles: $(@($deviceGuard.AvailableSecurityProperties) -join ', ')"
    )))
} else {
    $checks.Add((New-Check 'vbs' 'Isolation du noyau (VBS)' 'info' 'Etat VBS indisponible.'))
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

const SECURITY_ACTION_HELPERS = `
function Write-ArtemisResult($Level, $Name, $Detail) {
    "[$Level] $Name - $Detail"
    if ($Level -eq 'FAIL') {
        $global:ArtemisExitCode = 1
    }
}

function Test-ArtemisExpected($Actual, [string[]]$Expected) {
    $actualText = [string]$Actual
    foreach ($candidate in $Expected) {
        if ($actualText -ieq [string]$candidate) {
            return $true
        }
    }
    return $false
}

function Set-ArtemisMpPreference($Name, $Value, [string[]]$Expected, $Label) {
    $command = Get-Command Set-MpPreference -ErrorAction SilentlyContinue
    if (-not $command -or -not $command.Parameters.ContainsKey($Name)) {
        Write-ArtemisResult 'SKIP' $Label "Parametre non disponible sur cette version de Defender."
        return
    }

    try {
        $arguments = @{ ErrorAction = 'Stop' }
        $arguments[$Name] = $Value
        Set-MpPreference @arguments
        Start-Sleep -Milliseconds 150
        $actual = (Get-MpPreference -ErrorAction Stop).$Name
        if (Test-ArtemisExpected $actual $Expected) {
            Write-ArtemisResult 'OK' $Label "Valeur verifiee: $actual"
        } else {
            Write-ArtemisResult 'WARN' $Label "Windows a conserve la valeur $actual (strategie ou protection contre les falsifications possible)."
        }
    } catch {
        Write-ArtemisResult 'WARN' $Label $_.Exception.Message
    }
}

function Set-ArtemisRegistryValue($Path, $Name, $Value, $Type, [string[]]$Expected, $Label) {
    try {
        if (-not (Test-Path $Path)) {
            New-Item -Path $Path -Force -ErrorAction Stop | Out-Null
        }
        New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force -ErrorAction Stop | Out-Null
        $actual = (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
        if (Test-ArtemisExpected $actual $Expected) {
            Write-ArtemisResult 'OK' $Label "Valeur verifiee: $actual"
        } else {
            Write-ArtemisResult 'WARN' $Label "Valeur attendue non appliquee (actuel: $actual)."
        }
    } catch {
        Write-ArtemisResult 'WARN' $Label $_.Exception.Message
    }
}
`;

const SECURITY_ACTIONS = {
    'microsoft-baseline-safe': {
        title: 'Protection Windows recommandee',
        admin: true,
        script: `
${SECURITY_ACTION_HELPERS}
$ErrorActionPreference = 'Continue'
$global:ArtemisExitCode = 0
$lockScreenPolicyPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System'
$lockScreenBackupPath = 'HKLM:\\SOFTWARE\\ArtemisStore\\SecurityBackup\\LockScreen'
$legacyBackupPath = 'HKLM:\\SOFTWARE\\ArtemisStore\\SecurityBackup\\LegacyFeatures'

function Backup-ArtemisRegistryValue($Path, $Name, $BackupPath) {
    if (-not (Test-Path $BackupPath)) {
        New-Item -Path $BackupPath -Force | Out-Null
    }
    $presentName = $Name + '_Present'
    $valueName = $Name + '_Value'
    $alreadyBackedUp = (Get-ItemProperty -Path $BackupPath -Name $presentName -ErrorAction SilentlyContinue).$presentName
    if ($null -ne $alreadyBackedUp) {
        return
    }

    $source = Get-ItemProperty -Path $Path -ErrorAction SilentlyContinue
    $property = if ($source) { $source.PSObject.Properties[$Name] } else { $null }
    if ($property) {
        New-ItemProperty -Path $BackupPath -Name $presentName -Value 1 -PropertyType DWord -Force | Out-Null
        New-ItemProperty -Path $BackupPath -Name $valueName -Value ([int]$property.Value) -PropertyType DWord -Force | Out-Null
    } else {
        New-ItemProperty -Path $BackupPath -Name $presentName -Value 0 -PropertyType DWord -Force | Out-Null
    }
}

function Backup-ArtemisEnabledFeature($FeatureName) {
    if (-not (Test-Path $legacyBackupPath)) {
        New-Item -Path $legacyBackupPath -Force | Out-Null
    }
    $existing = (Get-ItemProperty -Path $legacyBackupPath -Name $FeatureName -ErrorAction SilentlyContinue).$FeatureName
    if ($null -eq $existing) {
        New-ItemProperty -Path $legacyBackupPath -Name $FeatureName -Value 1 -PropertyType DWord -Force | Out-Null
    }
}

"=== Socle Windows non disruptif ==="
$computerSystem = Get-CimInstance Win32_ComputerSystem
$mdmAccounts = Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Provisioning\\OMADM\\Accounts' -ErrorAction SilentlyContinue
if ($computerSystem.PartOfDomain -or $mdmAccounts) {
    Write-ArtemisResult 'INFO' 'Poste gere' 'Les strategies de domaine ou MDM restent prioritaires. Les valeurs forcees par l organisation ne seront pas contournees.'
}

"=== Pare-feu Windows ==="
try {
    Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True -DefaultInboundAction Block -DefaultOutboundAction Allow -ErrorAction Stop
    $profiles = @(Get-NetFirewallProfile -ErrorAction Stop)
    $invalidProfiles = @($profiles | Where-Object {
        -not $_.Enabled -or [string]$_.DefaultInboundAction -eq 'Allow' -or [string]$_.DefaultOutboundAction -eq 'Block'
    })
    if ($invalidProfiles.Count -eq 0) {
        Write-ArtemisResult 'OK' 'Pare-feu' 'Tous les profils sont actifs; trafic entrant bloque par defaut et trafic sortant autorise.'
    } else {
        Write-ArtemisResult 'WARN' 'Pare-feu' "Un ou plusieurs profils restent imposes par une strategie: $($invalidProfiles.Name -join ', ')."
    }
    $profiles | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction | Format-Table -AutoSize | Out-String
} catch {
    Write-ArtemisResult 'FAIL' 'Pare-feu' $_.Exception.Message
}

"=== UAC standard ==="
$uacPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'
$uacBefore = Get-ItemProperty -Path $uacPath -ErrorAction SilentlyContinue
Set-ArtemisRegistryValue $uacPath 'EnableLUA' 1 'DWord' @('1') 'UAC'
Set-ArtemisRegistryValue $uacPath 'ConsentPromptBehaviorAdmin' 5 'DWord' @('5') 'Consentement administrateur'
Set-ArtemisRegistryValue $uacPath 'PromptOnSecureDesktop' 1 'DWord' @('1') 'Bureau securise UAC'
if ($uacBefore.EnableLUA -ne 1) {
    Write-ArtemisResult 'INFO' 'Redemarrage' 'Un redemarrage est necessaire pour finaliser la reactivation de l UAC.'
}

"=== SmartScreen ==="
$smartScreenPolicy = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Name EnableSmartScreen -ErrorAction SilentlyContinue
if ($null -ne $smartScreenPolicy.EnableSmartScreen) {
    Write-ArtemisResult 'SKIP' 'SmartScreen applications' 'Reglage gere par une strategie Windows.'
} else {
    Set-ArtemisRegistryValue 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer' 'SmartScreenEnabled' 'Warn' 'String' @('Warn', 'RequireAdmin') 'SmartScreen applications'
}
Set-ArtemisRegistryValue 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppHost' 'EnableWebContentEvaluation' 1 'DWord' @('1') 'SmartScreen contenu web'

"=== Defender essentiel ==="
$mpStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
$securityProducts = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue)
$thirdPartyProducts = @($securityProducts | Where-Object { $_.displayName -notmatch 'Microsoft Defender|Windows Defender' })
if (-not $mpStatus -or (-not $mpStatus.AntivirusEnabled -and $thirdPartyProducts.Count -gt 0)) {
    Write-ArtemisResult 'SKIP' 'Defender Antivirus' "Antivirus tiers actif ou Defender indisponible; aucune tentative de conflit. Produits tiers: $($thirdPartyProducts.displayName -join ', ')"
} else {
    Set-ArtemisMpPreference 'DisableRealtimeMonitoring' $false @('False', '0') 'Protection temps reel'
    Set-ArtemisMpPreference 'DisableBehaviorMonitoring' $false @('False', '0') 'Protection comportementale'
    Set-ArtemisMpPreference 'DisableIOAVProtection' $false @('False', '0') 'Analyse des telechargements'
    Set-ArtemisMpPreference 'DisableScriptScanning' $false @('False', '0') 'Analyse des scripts'
    Set-ArtemisMpPreference 'DisableArchiveScanning' $false @('False', '0') 'Analyse des archives'
    Set-ArtemisMpPreference 'DisableBlockAtFirstSeen' $false @('False', '0') 'Blocage au premier signal'
    Set-ArtemisMpPreference 'MAPSReporting' 'Advanced' @('Advanced', '2') 'Protection cloud'
    Set-ArtemisMpPreference 'SubmitSamplesConsent' 'SendSafeSamples' @('SendSafeSamples', '1') 'Echantillons surs'
    Set-ArtemisMpPreference 'PUAProtection' 'Enabled' @('Enabled', '1') 'Blocage des applications indesirables'
}

"=== Protection quand le PC est verrouille ==="
Backup-ArtemisRegistryValue $lockScreenPolicyPath 'DontDisplayNetworkSelectionUI' $lockScreenBackupPath
Backup-ArtemisRegistryValue $lockScreenPolicyPath 'DisableLockScreenAppNotifications' $lockScreenBackupPath
Set-ArtemisRegistryValue $lockScreenPolicyPath 'DontDisplayNetworkSelectionUI' 1 'DWord' @('1') 'Modification du Wi-Fi avant connexion'
Set-ArtemisRegistryValue $lockScreenPolicyPath 'DisableLockScreenAppNotifications' 1 'DWord' @('1') 'Notifications sur l ecran verrouille'
Write-ArtemisResult 'INFO' 'Connexion reseau' 'Le PC garde sa connexion automatique; seule la modification du reseau avant ouverture de session est masquee.'

& powercfg.exe /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 1 2>&1 | Out-String
$acLockResult = $LASTEXITCODE
& powercfg.exe /SETDCVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 1 2>&1 | Out-String
$dcLockResult = $LASTEXITCODE
& powercfg.exe /SETACTIVE SCHEME_CURRENT 2>&1 | Out-String
$activeSchemeResult = $LASTEXITCODE
if ($acLockResult -eq 0 -and $dcLockResult -eq 0 -and $activeSchemeResult -eq 0) {
    Write-ArtemisResult 'OK' 'Reprise de veille' 'Authentification obligatoire sur secteur comme sur batterie.'
} else {
    Write-ArtemisResult 'WARN' 'Reprise de veille' 'Le mode d alimentation actuel n a pas accepte tous les reglages.'
}

$accessibilityFiles = @('utilman.exe', 'sethc.exe', 'osk.exe', 'Narrator.exe', 'Magnify.exe')
foreach ($fileName in $accessibilityFiles) {
    $ifeoPath = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\$fileName"
    $debugger = (Get-ItemProperty -Path $ifeoPath -Name Debugger -ErrorAction SilentlyContinue).Debugger
    if ($debugger) {
        if (-not (Test-Path $lockScreenBackupPath)) {
            New-Item -Path $lockScreenBackupPath -Force | Out-Null
        }
        $backupName = 'RemovedDebugger_' + ($fileName -replace '[^A-Za-z0-9]', '_')
        New-ItemProperty -Path $lockScreenBackupPath -Name $backupName -Value ([string]$debugger) -PropertyType String -Force | Out-Null
        Remove-ItemProperty -Path $ifeoPath -Name Debugger -Force -ErrorAction SilentlyContinue
        $remainingDebugger = (Get-ItemProperty -Path $ifeoPath -Name Debugger -ErrorAction SilentlyContinue).Debugger
        if ($remainingDebugger) {
            Write-ArtemisResult 'WARN' $fileName 'Une redirection suspecte reste configuree.'
        } else {
            Write-ArtemisResult 'OK' $fileName 'Redirection suspecte retiree; l outil Windows normal est restaure.'
        }
    }

    $filePath = Join-Path $env:SystemRoot "System32\\$fileName"
    if (Test-Path $filePath) {
        $signature = Get-AuthenticodeSignature -FilePath $filePath
        $publisher = [string]$signature.SignerCertificate.Subject
        if ([string]$signature.Status -eq 'Valid' -and $publisher -match 'Microsoft') {
            Write-ArtemisResult 'OK' $fileName 'Signature Microsoft valide.'
        } else {
            Write-ArtemisResult 'WARN' $fileName "Signature ou editeur inattendu: $($signature.Status). Lance une verification SFC."
        }
    } else {
        Write-ArtemisResult 'WARN' $fileName 'Fichier Windows absent. Lance une verification SFC.'
    }
}
Write-ArtemisResult 'INFO' 'Accessibilite' 'Les fonctions d assistance restent disponibles; seules les redirections suspectes sont retirees.'

"=== Composants anciens rarement utiles sur un PC personnel ==="
$legacyFeatures = @(
    @{ Name = 'SMB1Protocol'; Label = 'Partage de fichiers SMB1' },
    @{ Name = 'TelnetClient'; Label = 'Client Telnet' },
    @{ Name = 'TFTP'; Label = 'Client TFTP' },
    @{ Name = 'MicrosoftWindowsPowerShellV2Root'; Label = 'Moteur PowerShell 2' }
)
$legacyRestartNeeded = $false
foreach ($feature in $legacyFeatures) {
    try {
        $currentFeature = Get-WindowsOptionalFeature -Online -FeatureName $feature.Name -ErrorAction Stop
        if ([string]$currentFeature.State -eq 'Enabled') {
            Backup-ArtemisEnabledFeature $feature.Name
            $disableResult = Disable-WindowsOptionalFeature -Online -FeatureName $feature.Name -NoRestart -ErrorAction Stop
            $verifiedFeature = Get-WindowsOptionalFeature -Online -FeatureName $feature.Name -ErrorAction Stop
            if ([string]$verifiedFeature.State -like 'Disabled*') {
                Write-ArtemisResult 'OK' $feature.Label 'Composant ancien desactive.'
            } else {
                Write-ArtemisResult 'WARN' $feature.Label "Etat final inattendu: $($verifiedFeature.State)."
            }
            if ($disableResult.RestartNeeded) {
                $legacyRestartNeeded = $true
            }
        } elseif ([string]$currentFeature.State -like 'Disabled*') {
            Write-ArtemisResult 'OK' $feature.Label 'Deja desactive.'
        } else {
            Write-ArtemisResult 'SKIP' $feature.Label "Composant indisponible ou etat non modifiable: $($currentFeature.State)."
        }
    } catch {
        Write-ArtemisResult 'SKIP' $feature.Label 'Composant absent de cette version de Windows ou gere par le systeme.'
    }
}
if ($legacyRestartNeeded) {
    Write-ArtemisResult 'INFO' 'Redemarrage' 'Un redemarrage finalisera la desactivation des anciens composants.'
}
Write-ArtemisResult 'INFO' 'Compatibilite reseau' 'IPv6, SMB2/3, la decouverte locale, les imprimantes, le Bureau a distance et les partages modernes ne sont pas modifies.'

"=== Adresse Wi-Fi privee sur les reseaux publics ==="
$wifiAdapters = @(
    Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object {
        [int]$_.NdisPhysicalMedium -eq 9 -or
        [string]$_.MediaType -eq '802.11' -or
        [string]$_.InterfaceDescription -match 'Wireless|Wi-Fi|802\\.11'
    }
)
if ($wifiAdapters.Count -eq 0) {
    Write-ArtemisResult 'SKIP' 'Adresse Wi-Fi aleatoire' 'Aucune carte Wi-Fi physique detectee.'
} else {
    foreach ($adapter in $wifiAdapters) {
        $interfaceName = [string]$adapter.Name
        $randomizationOutput = & netsh.exe wlan set randomization enabled=yes interface="$interfaceName" 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-ArtemisResult 'SKIP' "Wi-Fi $interfaceName" 'La carte ou une strategie Windows ne prend pas en charge les adresses aleatoires.'
            continue
        }

        Write-ArtemisResult 'OK' "Wi-Fi $interfaceName" 'Adresse aleatoire activee pendant la recherche de reseaux.'
        $publicProfiles = @(
            Get-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue |
                Where-Object { [string]$_.NetworkCategory -eq 'Public' }
        )
        if ($publicProfiles.Count -eq 0) {
            Write-ArtemisResult 'INFO' "Wi-Fi $interfaceName" 'Aucun reseau Wi-Fi public connecte; les reseaux prives enregistres restent inchanges.'
            continue
        }

        foreach ($profile in $publicProfiles) {
            $profileName = [string]$profile.Name
            $profileOutput = & netsh.exe wlan set profileparameter name="$profileName" interface="$interfaceName" Randomization=yes 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
                Write-ArtemisResult 'OK' "Reseau public $profileName" 'Adresse privee stable activee pour ce reseau.'
            } else {
                Write-ArtemisResult 'WARN' "Reseau public $profileName" 'Windows n a pas pu modifier ce profil; la carte peut ne pas prendre cette fonction en charge.'
            }
        }
    }
}
Write-ArtemisResult 'INFO' 'Reseaux prives' 'Les profils Wi-Fi marques Prive, comme le reseau de la maison, ne sont pas modifies.'

"=== Verification finale ==="
Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction | Format-Table -AutoSize | Out-String
if (Get-Command Get-MpPreference -ErrorAction SilentlyContinue) {
    Get-MpPreference | Select-Object DisableRealtimeMonitoring,DisableBehaviorMonitoring,DisableIOAVProtection,DisableScriptScanning,DisableArchiveScanning,DisableBlockAtFirstSeen,MAPSReporting,SubmitSamplesConsent,PUAProtection | Format-List | Out-String
}
"Les regles applicatives, ports existants, services, RDP, partages reseau et exclusions antivirus n ont pas ete modifies."
`,
    },
    'defender-hardened': {
        title: 'Defender renforce sans blocage applicatif',
        admin: true,
        script: `
${SECURITY_ACTION_HELPERS}
$ErrorActionPreference = 'Continue'
$global:ArtemisExitCode = 0

"=== Preconditions Defender ==="
$mpStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
$securityProducts = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue)
$thirdPartyProducts = @($securityProducts | Where-Object { $_.displayName -notmatch 'Microsoft Defender|Windows Defender' })
if (-not $mpStatus) {
    Write-ArtemisResult 'FAIL' 'Defender' 'Les commandes Microsoft Defender ne sont pas disponibles.'
} elseif (-not $mpStatus.AntivirusEnabled -and $thirdPartyProducts.Count -gt 0) {
    Write-ArtemisResult 'SKIP' 'Defender' "Mode passif conserve pour eviter un conflit avec: $($thirdPartyProducts.displayName -join ', ')."
} else {
    "=== Protection cloud et analyses ==="
    Set-ArtemisMpPreference 'CloudBlockLevel' 'High' @('High', '2') 'Niveau de blocage cloud'
    Set-ArtemisMpPreference 'CloudExtendedTimeout' 20 @('20') 'Delai cloud etendu'
    Set-ArtemisMpPreference 'CheckForSignaturesBeforeRunningScan' $true @('True', '1') 'MAJ avant analyse planifiee'
    Set-ArtemisMpPreference 'DisableRemovableDriveScanning' $false @('False', '0') 'Analyse des supports amovibles'
    Set-ArtemisMpPreference 'DisableArchiveScanning' $false @('False', '0') 'Analyse des archives'

    "=== Protections avancees en surveillance ==="
    Set-ArtemisMpPreference 'EnableNetworkProtection' 'AuditMode' @('AuditMode', '2') 'Protection reseau'
    Set-ArtemisMpPreference 'EnableControlledFolderAccess' 'AuditMode' @('AuditMode', '2') 'Protection anti-ransomware des dossiers'
    Write-ArtemisResult 'INFO' 'Surveillance sans blocage' 'Les protections avancees reperent les comportements suspects sans bloquer les applications.'

    "=== Mise a jour des signatures ==="
    try {
        Update-MpSignature -ErrorAction Stop | Out-String
        $updatedStatus = Get-MpComputerStatus -ErrorAction Stop
        Write-ArtemisResult 'OK' 'Signatures Defender' "$($updatedStatus.AntivirusSignatureVersion), mises a jour le $($updatedStatus.AntivirusSignatureLastUpdated)"
    } catch {
        Write-ArtemisResult 'WARN' 'Signatures Defender' $_.Exception.Message
    }

    "=== Verification finale ==="
    Get-MpPreference | Select-Object CloudBlockLevel,CloudExtendedTimeout,EnableControlledFolderAccess,EnableNetworkProtection,DisableRemovableDriveScanning,DisableArchiveScanning,CheckForSignaturesBeforeRunningScan | Format-List | Out-String
}
"Aucune exclusion Defender existante n a ete supprimee ou remplacee."
`,
    },
    'recommended-protection-restore': {
        title: 'Restaurer les options de compatibilite',
        admin: true,
        script: `
${SECURITY_ACTION_HELPERS}
$ErrorActionPreference = 'Continue'
$global:ArtemisExitCode = 0
$policyPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System'
$lockScreenBackupPath = 'HKLM:\\SOFTWARE\\ArtemisStore\\SecurityBackup\\LockScreen'
$legacyBackupPath = 'HKLM:\\SOFTWARE\\ArtemisStore\\SecurityBackup\\LegacyFeatures'

function Restore-ArtemisRegistryValue($Path, $Name, $BackupPath, $Label) {
    $presentName = $Name + '_Present'
    $valueName = $Name + '_Value'
    $backup = Get-ItemProperty -Path $BackupPath -ErrorAction SilentlyContinue
    $presentProperty = if ($backup) { $backup.PSObject.Properties[$presentName] } else { $null }
    if (-not $presentProperty) {
        Write-ArtemisResult 'SKIP' $Label 'Aucune sauvegarde ArtemisStore disponible; aucun changement effectue.'
        return
    }

    if ([int]$presentProperty.Value -eq 1) {
        $previousValue = [int]$backup.$valueName
        Set-ArtemisRegistryValue $Path $Name $previousValue 'DWord' @([string]$previousValue) $Label
    } else {
        Remove-ItemProperty -Path $Path -Name $Name -Force -ErrorAction SilentlyContinue
        $remaining = (Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue).$Name
        if ($null -eq $remaining) {
            Write-ArtemisResult 'OK' $Label 'Reglage Windows par defaut restaure.'
        } else {
            Write-ArtemisResult 'WARN' $Label "La valeur $remaining reste appliquee."
        }
    }
}

Restore-ArtemisRegistryValue $policyPath 'DontDisplayNetworkSelectionUI' $lockScreenBackupPath 'Options reseau avant connexion'
Restore-ArtemisRegistryValue $policyPath 'DisableLockScreenAppNotifications' $lockScreenBackupPath 'Notifications sur l ecran verrouille'
Write-ArtemisResult 'INFO' 'Reprise de veille' 'La demande d authentification reste active pour proteger la session.'
Write-ArtemisResult 'INFO' 'Accessibilite' 'Aucune ancienne redirection suspecte n est restauree.'
if (Test-Path $lockScreenBackupPath) {
    Remove-Item -Path $lockScreenBackupPath -Recurse -Force -ErrorAction SilentlyContinue
}

"=== Compatibilite avec les anciens appareils ==="
$legacyFeatures = @(
    @{ Name = 'SMB1Protocol'; Label = 'Partage de fichiers SMB1' },
    @{ Name = 'TelnetClient'; Label = 'Client Telnet' },
    @{ Name = 'TFTP'; Label = 'Client TFTP' },
    @{ Name = 'MicrosoftWindowsPowerShellV2Root'; Label = 'Moteur PowerShell 2' }
)
$legacyRestartNeeded = $false
foreach ($feature in $legacyFeatures) {
    $wasDisabledByArtemis = (Get-ItemProperty -Path $legacyBackupPath -Name $feature.Name -ErrorAction SilentlyContinue).$($feature.Name)
    if ([int]$wasDisabledByArtemis -ne 1) {
        Write-ArtemisResult 'SKIP' $feature.Label 'ArtemisStore ne l avait pas desactive.'
        continue
    }
    try {
        $enableResult = Enable-WindowsOptionalFeature -Online -FeatureName $feature.Name -All -NoRestart -ErrorAction Stop
        $verifiedFeature = Get-WindowsOptionalFeature -Online -FeatureName $feature.Name -ErrorAction Stop
        if ([string]$verifiedFeature.State -eq 'Enabled') {
            Write-ArtemisResult 'OK' $feature.Label 'Composant ancien reactive.'
            Remove-ItemProperty -Path $legacyBackupPath -Name $feature.Name -Force -ErrorAction SilentlyContinue
        } else {
            Write-ArtemisResult 'WARN' $feature.Label "Etat final inattendu: $($verifiedFeature.State)."
        }
        if ($enableResult.RestartNeeded) {
            $legacyRestartNeeded = $true
        }
    } catch {
        Write-ArtemisResult 'WARN' $feature.Label $_.Exception.Message
    }
}
if ($legacyRestartNeeded) {
    Write-ArtemisResult 'INFO' 'Redemarrage' 'Un redemarrage finalisera la restauration des anciens composants.'
}
if (Test-Path $legacyBackupPath) {
    $remainingBackup = Get-ItemProperty -Path $legacyBackupPath -ErrorAction SilentlyContinue
    $remainingFeatures = @($remainingBackup.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' })
    if ($remainingFeatures.Count -eq 0) {
        Remove-Item -Path $legacyBackupPath -Force -ErrorAction SilentlyContinue
    }
}
`,
    },
    'hardware-security-check': {
        title: 'Verification chiffrement et securite materielle',
        admin: true,
        script: `
$ErrorActionPreference = 'Continue'
$global:ArtemisExitCode = 0
function Write-ArtemisResult($Level, $Name, $Detail) {
    "[$Level] $Name - $Detail"
    if ($Level -eq 'FAIL') {
        $global:ArtemisExitCode = 1
    }
}

"=== TPM ==="
$tpm = Get-Tpm -ErrorAction SilentlyContinue
if (-not $tpm -or -not $tpm.TpmPresent) {
    Write-ArtemisResult 'WARN' 'TPM' 'Aucun TPM detecte. Verifie son activation dans l UEFI.'
} elseif (-not $tpm.TpmReady) {
    Write-ArtemisResult 'WARN' 'TPM' 'TPM present mais non initialise.'
} else {
    Write-ArtemisResult 'OK' 'TPM' "Pret=$($tpm.TpmReady), active=$($tpm.TpmActivated), version fabricant=$($tpm.ManufacturerVersion)"
}

"=== Secure Boot ==="
try {
    $secureBoot = Confirm-SecureBootUEFI -ErrorAction Stop
    if ($secureBoot) {
        Write-ArtemisResult 'OK' 'Secure Boot' 'Actif.'
    } else {
        Write-ArtemisResult 'WARN' 'Secure Boot' 'UEFI compatible mais protection desactivee.'
    }
} catch {
    Write-ArtemisResult 'WARN' 'Secure Boot' 'Indisponible: demarrage Legacy/BIOS, materiel non compatible ou acces refuse.'
}

"=== BitLocker ==="
$bitLockerCommand = Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue
if ($bitLockerCommand) {
    $systemVolume = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction SilentlyContinue
    if ($systemVolume) {
        $protectorTypes = @($systemVolume.KeyProtector | ForEach-Object { [string]$_.KeyProtectorType })
        $fullyProtected = [string]$systemVolume.VolumeStatus -eq 'FullyEncrypted' -and [string]$systemVolume.ProtectionStatus -eq 'On'
        if ($fullyProtected) {
            Write-ArtemisResult 'OK' 'BitLocker systeme' "Chiffre avec $($systemVolume.EncryptionMethod); protection active."
        } elseif ([string]$systemVolume.VolumeStatus -eq 'EncryptionInProgress') {
            Write-ArtemisResult 'INFO' 'BitLocker systeme' "Chiffrement en cours: $($systemVolume.EncryptionPercentage)%."
        } else {
            Write-ArtemisResult 'WARN' 'BitLocker systeme' "Etat=$($systemVolume.VolumeStatus), protection=$($systemVolume.ProtectionStatus)."
        }
        if ($protectorTypes -contains 'RecoveryPassword') {
            Write-ArtemisResult 'OK' 'Cle de recuperation' 'Un protecteur de recuperation existe. Aucune cle secrete n est affichee.'
        } elseif ($fullyProtected) {
            Write-ArtemisResult 'WARN' 'Cle de recuperation' 'Aucun protecteur RecoveryPassword detecte; sauvegarde une methode de recuperation avant toute modification UEFI.'
        }
        "Volume=$($systemVolume.MountPoint); progression=$($systemVolume.EncryptionPercentage)%; methode=$($systemVolume.EncryptionMethod); protecteurs=$($protectorTypes -join ', ')"
    } else {
        Write-ArtemisResult 'WARN' 'BitLocker systeme' 'Volume systeme non retourne par Get-BitLockerVolume.'
    }
} else {
    Write-ArtemisResult 'INFO' 'BitLocker PowerShell' 'Module absent sur cette edition; utilisation de manage-bde en lecture seule.'
    & "$env:SystemRoot\\System32\\manage-bde.exe" -status $env:SystemDrive 2>&1 | Out-String
}

"=== Virtualization Based Security ==="
$deviceGuard = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard -ErrorAction SilentlyContinue
if ($deviceGuard) {
    $running = @($deviceGuard.SecurityServicesRunning)
    $available = @($deviceGuard.AvailableSecurityProperties)
    if ($deviceGuard.VirtualizationBasedSecurityStatus -eq 2) {
        Write-ArtemisResult 'OK' 'VBS' 'La securite basee sur la virtualisation est active et en cours d execution.'
    } elseif ($deviceGuard.VirtualizationBasedSecurityStatus -eq 1) {
        Write-ArtemisResult 'WARN' 'VBS' 'Configuree mais non demarree; un redemarrage ou un prerequis materiel peut manquer.'
    } else {
        Write-ArtemisResult 'INFO' 'VBS' 'Non activee.'
    }
    if ($running -contains 2) {
        Write-ArtemisResult 'OK' 'Integrite de la memoire' 'Active et en cours d execution.'
    } else {
        Write-ArtemisResult 'INFO' 'Integrite de la memoire' 'Non activee automatiquement afin d eviter un probleme avec un ancien pilote.'
    }
    if ($available -contains 3) {
        Write-ArtemisResult 'OK' 'Protection DMA' 'Capacite materielle disponible.'
    } else {
        Write-ArtemisResult 'INFO' 'Protection DMA' 'Non signalee par Windows.'
    }
    "Services configures=$(@($deviceGuard.SecurityServicesConfigured) -join ', '); actifs=$($running -join ', '); capacites=$($available -join ', ')"
} else {
    Write-ArtemisResult 'WARN' 'VBS' 'Classe Win32_DeviceGuard indisponible.'
}

"=== Recommandations sans modification ==="
"- BitLocker n est volontairement pas active automatiquement: la cle de recuperation doit d abord etre sauvegardee hors du PC."
"- L integrite de la memoire n est pas activee automatiquement: Microsoft signale un risque d incompatibilite avec certains pilotes."
"- Secure Boot et le TPM se configurent dans l UEFI; ArtemisStore ne modifie jamais le firmware."
"Aucun chiffrement, protecteur, parametre UEFI, VBS ou pilote n a ete modifie."
`,
    },
};

const ASR_MODES = {
    none: 'Disabled',
    audit: 'AuditMode',
    warn: 'Warn',
    on: 'Enabled',
};

const ASR_RULES = [
    {
        id: '56a863a9-875e-4185-98a7-b882c64b5ce5',
        title: 'Pilotes signes vulnerables',
        category: 'Standard',
        defaultMode: 'on',
    },
    {
        id: '9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2',
        title: 'Vol des identifiants Windows',
        category: 'Identifiants',
        defaultMode: 'audit',
    },
    {
        id: 'e6db77e5-3df2-4cf1-b95a-636979351e5b',
        title: 'Persistance malveillante via WMI',
        category: 'Windows',
        defaultMode: 'audit',
    },
    {
        id: 'be9ba2d9-53ea-4cdc-84e5-9b1eeee46550',
        title: 'Executables recus par e-mail',
        category: 'Email',
        defaultMode: 'audit',
    },
    {
        id: '7674ba52-37eb-4a4f-a9a1-f0f9a1619a2c',
        title: 'Processus suspects lances par Adobe Reader',
        category: 'Adobe Reader',
        defaultMode: 'audit',
    },
    {
        id: '5beb7efe-fd9a-4556-801d-275e5ffc04cc',
        title: 'Scripts masques ou obfusques',
        category: 'Scripts',
        defaultMode: 'audit',
    },
    {
        id: 'd3e037e1-3eb8-44c8-a917-57927947596d',
        title: 'Scripts JS/VBS lancant du contenu telecharge',
        category: 'Scripts',
        defaultMode: 'audit',
    },
    {
        id: '92e97fa1-2edf-4476-bdd6-9dd0b4dddc7b',
        title: 'Appels systeme depuis les macros Office',
        category: 'Office',
        defaultMode: 'audit',
    },
    {
        id: '3b576869-a4ec-4529-8536-b80a7769e899',
        title: 'Contenu executable cree par Office',
        category: 'Office',
        defaultMode: 'audit',
    },
    {
        id: 'd4f940ab-401b-4efc-aadc-ad5f3c50688a',
        title: 'Processus suspects lances par Office',
        category: 'Office',
        defaultMode: 'audit',
    },
    {
        id: '75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84',
        title: 'Injection de code par Office',
        category: 'Office',
        defaultMode: 'audit',
    },
    {
        id: '26190899-1602-49e8-8b27-eb1d0a1ce869',
        title: 'Processus suspects lances par Outlook ou Teams',
        category: 'Office/email',
        defaultMode: 'audit',
    },
    {
        id: '01443614-cd74-433a-b99e-2ecdc07bfc25',
        title: 'Executables inconnus ou peu fiables',
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
        title: 'Programmes non signes lances depuis une cle USB',
        category: 'USB',
        defaultMode: 'audit',
    },
    {
        id: 'd1e49aac-8f56-4280-b9ba-993a6d77406c',
        title: 'Lancements distants via PSExec ou WMI',
        category: 'Acces distant',
        defaultMode: 'audit',
    },
    {
        id: '33ddedf1-c6e0-47cb-833e-de6133960387',
        title: 'Redemarrage malveillant en mode sans echec',
        category: 'Systeme',
        defaultMode: 'audit',
    },
    {
        id: 'c0033c00-d16d-4114-a5a0-dc9b3a7d2ceb',
        title: 'Faux outils systeme ou copies suspectes',
        category: 'Systeme',
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
        text.includes('[fail]') ||
        text.includes('[warn]') ||
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
    if (['6', 'warn', 'warning'].includes(normalized)) return 'warn';
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
                    resolve(JSON.parse(String(stdout || '{}').replace(/^\uFEFF/, '')));
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
    const returnedRules = Array.isArray(result.rules)
        ? result.rules
        : result.rules
          ? [result.rules]
          : [];
    for (const item of returnedRules) {
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
$ErrorActionPreference = 'Stop'
$global:ArtemisExitCode = 0
$requestedIds = @(${ids.map(psSingleQuote).join(',')})
$requestedActions = @(${actions.map(psSingleQuote).join(',')})

function Convert-ArtemisAsrMode($Value) {
    $text = ([string]$Value).ToLowerInvariant()
    if ($text -in @('1', 'enabled', 'block')) { return 'on' }
    if ($text -in @('2', 'auditmode', 'audit')) { return 'audit' }
    if ($text -in @('6', 'warn', 'warning')) { return 'warn' }
    return 'none'
}

try {
    $current = Get-MpPreference
    $currentIds = @($current.AttackSurfaceReductionRules_Ids)
    $currentActions = @($current.AttackSurfaceReductionRules_Actions)
    $merged = [ordered]@{}
    for ($i = 0; $i -lt $currentIds.Count; $i++) {
        if ($currentIds[$i]) {
            $merged[[string]$currentIds[$i]] = [string]$currentActions[$i]
        }
    }
    $preservedCount = $merged.Count
    for ($i = 0; $i -lt $requestedIds.Count; $i++) {
        $merged[[string]$requestedIds[$i]] = [string]$requestedActions[$i]
    }

    Set-MpPreference -AttackSurfaceReductionRules_Ids @($merged.Keys) -AttackSurfaceReductionRules_Actions @($merged.Values) -ErrorAction Stop

    $verified = Get-MpPreference
    $verifiedIds = @($verified.AttackSurfaceReductionRules_Ids)
    $verifiedActions = @($verified.AttackSurfaceReductionRules_Actions)
    $verifiedMap = @{}
    for ($i = 0; $i -lt $verifiedIds.Count; $i++) {
        $verifiedMap[[string]$verifiedIds[$i]] = Convert-ArtemisAsrMode $verifiedActions[$i]
    }

    $mismatch = 0
    for ($i = 0; $i -lt $requestedIds.Count; $i++) {
        $id = [string]$requestedIds[$i]
        $expected = Convert-ArtemisAsrMode $requestedActions[$i]
        $actual = $verifiedMap[$id]
        if ($actual -eq $expected) {
            "[OK] $id - $actual"
        } else {
            "[WARN] $id - attendu=$expected, actuel=$actual (reglage Windows prioritaire ou protection contre les falsifications possible)"
            $mismatch++
        }
    }
    "[INFO] Regles deja presentes preservees avant fusion: $preservedCount"
    if ($mismatch -gt 0) {
        "[WARN] $mismatch regle(s) non appliquee(s) comme demande."
    }
} catch {
    $global:ArtemisExitCode = 1
    "[FAIL] Application des protections - $($_.Exception.Message)"
}
`;

    const result = await runElevatedPowerShellScript(script);
    return {
        ...buildAdvancedResult(
            { id: 'asr-rules', title: 'Protections anti-attaque Defender', admin: true },
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

    if (Array.isArray(result.events)) return result.events;
    return result.events ? [result.events] : [];
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
                title: 'Protection Microsoft Defender',
                body: String(newest.message || 'Comportement suspect detecte.').slice(0, 180),
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
            `artemisstore-advanced-${randomUUID()}.ps1`
        );
        const resultPath = `${scriptPath}.json`;
        const scriptContent = `
param([Parameter(Mandatory = $true)][string]$ArtemisExpectedHash)

$actualHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
if ($actualHash -ne $ArtemisExpectedHash) {
    exit 87
}

$ErrorActionPreference = 'Continue'
$global:ArtemisExitCode = 0
$output = try {
    & {
${script}
    } *>&1
} catch {
    $global:ArtemisExitCode = 1
    $_ | Out-String
}
$nativeExitCode = if ($LASTEXITCODE -ne $null) { [int]$LASTEXITCODE } else { 0 }
$exitCode = if ($global:ArtemisExitCode -ne 0) { [int]$global:ArtemisExitCode } else { $nativeExitCode }
[PSCustomObject]@{
    exitCode = $exitCode
    output = ($output | Out-String)
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ${psSingleQuote(resultPath)} -Encoding UTF8
exit 0
`;
        const scriptHash = createHash('sha256')
            .update(scriptContent, 'utf8')
            .digest('hex')
            .toUpperCase();

        fs.writeFileSync(scriptPath, scriptContent, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });

        const command = [
            `$argumentList = '-NoProfile -ExecutionPolicy Bypass -File "' + ${psSingleQuote(
                scriptPath
            )} + '" -ArtemisExpectedHash "' + ${psSingleQuote(scriptHash)} + '"';`,
            '$p = Start-Process',
            "-FilePath 'powershell.exe'",
            '-ArgumentList $argumentList',
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
        return fs.existsSync(filePath)
            ? fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
            : '';
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
