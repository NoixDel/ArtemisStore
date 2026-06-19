const { app, ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../bin/logger');

const OPTIMIZATIONS = [
    {
        id: 'disable-ads-suggestions',
        category: 'Confidentialite',
        title: 'Desactiver pubs et suggestions Windows',
        description: 'Coupe les suggestions du menu Demarrer, astuces et contenus recommandes.',
        recommended: true,
        admin: false,
        reboot: false,
        script: `
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager' -Name 'SubscribedContent-338388Enabled' -Type DWord -Value 0 -Force
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager' -Name 'SubscribedContent-338389Enabled' -Type DWord -Value 0 -Force
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager' -Name 'SystemPaneSuggestionsEnabled' -Type DWord -Value 0 -Force
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'Start_IrisRecommendations' -Type DWord -Value 0 -Force
`,
    },
    {
        id: 'disable-advertising-id',
        category: 'Confidentialite',
        title: "Desactiver l'identifiant publicitaire",
        description: 'Limite le suivi publicitaire entre applications.',
        recommended: true,
        admin: false,
        reboot: false,
        script: `
New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo' -Name 'Enabled' -Type DWord -Value 0 -Force
`,
    },
    {
        id: 'disable-feedback',
        category: 'Confidentialite',
        title: 'Limiter les demandes de feedback',
        description: 'Reduit les demandes de commentaires Windows.',
        recommended: true,
        admin: false,
        reboot: false,
        script: `
New-Item -Path 'HKCU:\\Software\\Microsoft\\Siuf\\Rules' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Siuf\\Rules' -Name 'NumberOfSIUFInPeriod' -Type DWord -Value 0 -Force
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Siuf\\Rules' -Name 'PeriodInNanoSeconds' -Type DWord -Value 0 -Force
`,
    },
    {
        id: 'telemetry-security',
        category: 'Confidentialite',
        title: 'Reduire la telemetrie Windows',
        description: 'Force le niveau de diagnostic minimal autorise par edition Windows.',
        recommended: true,
        admin: true,
        reboot: false,
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection' -Name 'AllowTelemetry' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'disable-consumer-features',
        category: 'Confidentialite',
        title: 'Desactiver Consumer Features',
        description:
            'Bloque les installations/suggestions automatiques de contenus grand public Microsoft.',
        recommended: true,
        admin: true,
        reboot: true,
        risk: 'safe',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent' -Name 'DisableWindowsConsumerFeatures' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'disable-activity-history',
        category: 'Confidentialite',
        title: "Desactiver l'historique d'activite",
        description: "Desactive la collecte de l'historique d'activite Windows.",
        recommended: true,
        admin: true,
        reboot: false,
        risk: 'safe',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Name 'EnableActivityFeed' -Type DWord -Value 0 -Force
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Name 'PublishUserActivities' -Type DWord -Value 0 -Force
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Name 'UploadUserActivities' -Type DWord -Value 0 -Force
`,
    },
    {
        id: 'disable-tailored-experiences',
        category: 'Confidentialite',
        title: 'Desactiver experiences personnalisees',
        description:
            'Empeche Windows d utiliser les donnees de diagnostic pour personnaliser conseils et pubs.',
        recommended: true,
        admin: true,
        reboot: false,
        risk: 'safe',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent' -Name 'DisableTailoredExperiencesWithDiagnosticData' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'disable-location',
        category: 'Confidentialite',
        title: 'Desactiver localisation Windows',
        description: 'Coupe le service de localisation pour les apps et Windows.',
        recommended: false,
        admin: true,
        reboot: true,
        risk: 'medium',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\LocationAndSensors' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\LocationAndSensors' -Name 'DisableLocation' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'disable-background-apps',
        category: 'Confidentialite',
        title: 'Limiter apps en arriere-plan',
        description:
            'Desactive globalement les apps Store en arriere-plan pour l utilisateur courant.',
        recommended: false,
        admin: false,
        reboot: false,
        risk: 'medium',
        script: `
New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications' -Name 'GlobalUserDisabled' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'disable-diagtrack',
        category: 'Telemetrie',
        title: 'Desactiver Connected User Experiences',
        description: 'Arrete et desactive le service DiagTrack de telemetrie.',
        recommended: false,
        admin: true,
        reboot: true,
        risk: 'medium',
        script: `
Stop-Service -Name 'DiagTrack' -Force -ErrorAction SilentlyContinue
Set-Service -Name 'DiagTrack' -StartupType Disabled -ErrorAction SilentlyContinue
`,
    },
    {
        id: 'disable-dmwappushservice',
        category: 'Telemetrie',
        title: 'Desactiver dmwappushservice',
        description:
            'Desactive le service de routage WAP push utilise par certains flux de telemetrie.',
        recommended: false,
        admin: true,
        reboot: true,
        risk: 'medium',
        script: `
Stop-Service -Name 'dmwappushservice' -Force -ErrorAction SilentlyContinue
Set-Service -Name 'dmwappushservice' -StartupType Disabled -ErrorAction SilentlyContinue
`,
    },
    {
        id: 'disable-ceip-tasks',
        category: 'Telemetrie',
        title: 'Desactiver taches CEIP/diagnostic',
        description: 'Desactive plusieurs taches planifiees de collecte et compatibilite.',
        recommended: false,
        admin: true,
        reboot: false,
        risk: 'medium',
        script: `
$tasks = @(
    '\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser',
    '\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater',
    '\\Microsoft\\Windows\\Autochk\\Proxy',
    '\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator',
    '\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip',
    '\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector'
)
foreach ($task in $tasks) {
    schtasks.exe /Change /TN $task /Disable | Out-Null
}
`,
    },
    {
        id: 'disable-error-reporting',
        category: 'Telemetrie',
        title: 'Desactiver Windows Error Reporting',
        description: "Desactive l'envoi automatique des rapports d'erreur a Microsoft.",
        recommended: false,
        admin: true,
        reboot: false,
        risk: 'medium',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting' -Name 'Disabled' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'disable-copilot',
        category: 'Debloat',
        title: 'Desactiver Windows Copilot',
        description: 'Masque/desactive Copilot via policy quand disponible.',
        recommended: false,
        admin: true,
        reboot: true,
        risk: 'medium',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot' -Name 'TurnOffWindowsCopilot' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'disable-widgets',
        category: 'Debloat',
        title: 'Desactiver Widgets',
        description: 'Desactive les Widgets Windows et les retire de la barre des taches.',
        recommended: false,
        admin: true,
        reboot: true,
        risk: 'medium',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Dsh' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Dsh' -Name 'AllowNewsAndInterests' -Type DWord -Value 0 -Force
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'TaskbarDa' -Type DWord -Value 0 -Force
`,
    },
    {
        id: 'remove-consumer-apps',
        category: 'Debloat',
        title: 'Supprimer apps preinstallees grand public',
        description:
            'Retire Clipchamp, Bing, Zune, GetHelp, Solitaire, Teams consumer, etc. pour l utilisateur courant.',
        recommended: false,
        admin: false,
        reboot: false,
        risk: 'high',
        script: `
$packages = @(
    'Microsoft.BingNews',
    'Microsoft.BingWeather',
    'Microsoft.GetHelp',
    'Microsoft.Getstarted',
    'Microsoft.MicrosoftSolitaireCollection',
    'Microsoft.People',
    'Microsoft.PowerAutomateDesktop',
    'Microsoft.Todos',
    'Microsoft.WindowsFeedbackHub',
    'Microsoft.WindowsMaps',
    'Microsoft.ZuneMusic',
    'Microsoft.ZuneVideo',
    'Microsoft.Clipchamp',
    'MicrosoftTeams'
)
foreach ($pkg in $packages) {
    Get-AppxPackage -Name $pkg -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
}
`,
    },
    {
        id: 'remove-xbox-apps',
        category: 'Debloat',
        title: 'Supprimer apps Xbox',
        description:
            'Retire les apps Xbox pour l utilisateur courant. A eviter si tu utilises Game Pass/Xbox.',
        recommended: false,
        admin: false,
        reboot: false,
        risk: 'high',
        script: `
$packages = @(
    'Microsoft.Xbox.TCUI',
    'Microsoft.XboxApp',
    'Microsoft.XboxGameOverlay',
    'Microsoft.XboxGamingOverlay',
    'Microsoft.XboxIdentityProvider',
    'Microsoft.XboxSpeechToTextOverlay',
    'Microsoft.GamingApp'
)
foreach ($pkg in $packages) {
    Get-AppxPackage -Name $pkg -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
}
`,
    },
    {
        id: 'remove-onedrive-startup',
        category: 'Debloat',
        title: 'Desactiver OneDrive au demarrage',
        description: 'Retire OneDrive du demarrage utilisateur sans le desinstaller.',
        recommended: false,
        admin: false,
        reboot: false,
        risk: 'medium',
        script: `
Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'OneDrive' -ErrorAction SilentlyContinue
`,
    },
    {
        id: 'detailed-bsod',
        category: 'Diagnostic',
        title: 'Activer BSOD detaille',
        description: "Affiche plus d'informations utiles lors des erreurs systeme critiques.",
        recommended: true,
        admin: true,
        reboot: true,
        risk: 'safe',
        script: `
New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CrashControl' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CrashControl' -Name 'DisplayParameters' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'verbose-logon',
        category: 'Diagnostic',
        title: 'Activer Verbose Login',
        description:
            'Affiche les messages detailles pendant ouverture/fermeture de session et demarrage/arret.',
        recommended: true,
        admin: true,
        reboot: true,
        risk: 'safe',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name 'VerboseStatus' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'enable-crash-dumps',
        category: 'Diagnostic',
        title: 'Activer mini dumps applicatifs',
        description:
            'Configure Windows Error Reporting pour garder des dumps locaux utiles au debug.',
        recommended: false,
        admin: true,
        reboot: false,
        risk: 'medium',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting\\LocalDumps' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting\\LocalDumps' -Name 'DumpFolder' -Type ExpandString -Value '%LOCALAPPDATA%\\CrashDumps' -Force
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting\\LocalDumps' -Name 'DumpCount' -Type DWord -Value 10 -Force
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting\\LocalDumps' -Name 'DumpType' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'explorer-show-extensions',
        category: 'Explorateur',
        title: 'Afficher les extensions de fichiers',
        description: 'Affiche .exe, .txt, .zip, etc. pour eviter les mauvaises surprises.',
        recommended: true,
        admin: false,
        reboot: false,
        script: `
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'HideFileExt' -Type DWord -Value 0 -Force
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
`,
    },
    {
        id: 'explorer-this-pc',
        category: 'Explorateur',
        title: "Ouvrir l'Explorateur sur Ce PC",
        description: "Remplace l'accueil rapide par Ce PC.",
        recommended: true,
        admin: false,
        reboot: false,
        script: `
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'LaunchTo' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'explorer-show-hidden-files',
        category: 'Explorateur',
        title: 'Afficher les fichiers caches',
        description: 'Affiche les fichiers caches dans l Explorateur.',
        recommended: false,
        admin: false,
        reboot: false,
        risk: 'safe',
        script: `
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'Hidden' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'disable-search-web',
        category: 'Explorateur',
        title: 'Desactiver recherche web Start',
        description: 'Garde la recherche Windows locale sans resultats Bing dans le menu Demarrer.',
        recommended: true,
        admin: true,
        reboot: true,
        risk: 'safe',
        script: `
New-Item -Path 'HKCU:\\Software\\Policies\\Microsoft\\Windows\\Explorer' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Policies\\Microsoft\\Windows\\Explorer' -Name 'DisableSearchBoxSuggestions' -Type DWord -Value 1 -Force
New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search' -Name 'AllowCortana' -Type DWord -Value 0 -Force
`,
    },
    {
        id: 'disable-startup-delay',
        category: 'Performances',
        title: 'Reduire le delai des apps au demarrage',
        description: 'Supprime le delai artificiel applique aux programmes de demarrage.',
        recommended: true,
        admin: false,
        reboot: true,
        script: `
New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize' -Name 'StartupDelayInMSec' -Type DWord -Value 0 -Force
`,
    },
    {
        id: 'disable-transparency',
        category: 'Performances',
        title: 'Desactiver les effets de transparence',
        description: 'Allege legerement le rendu graphique Windows.',
        recommended: false,
        admin: false,
        reboot: false,
        script: `
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'EnableTransparency' -Type DWord -Value 0 -Force
`,
    },
    {
        id: 'power-high-performance',
        category: 'Performances',
        title: 'Activer le mode performances elevees',
        description: 'Selectionne le plan energie Hautes performances si disponible.',
        recommended: false,
        admin: true,
        reboot: false,
        script: `
powercfg.exe /setactive SCHEME_MIN
`,
    },
    {
        id: 'ultimate-performance',
        category: 'Performances',
        title: 'Activer Ultimate Performance',
        description: 'Cree/active le plan Ultimate Performance si Windows le permet.',
        recommended: false,
        admin: true,
        reboot: false,
        risk: 'medium',
        script: `
$guid = 'e9a42b02-d5df-448d-aa00-03f14749eb61'
powercfg.exe /duplicatescheme $guid | Out-Null
powercfg.exe /setactive $guid
`,
    },
    {
        id: 'disable-hibernation',
        category: 'Performances',
        title: 'Desactiver hibernation',
        description:
            'Desactive hiberfil.sys et le demarrage rapide. Libere de la place mais retire l hibernation.',
        recommended: false,
        admin: true,
        reboot: true,
        risk: 'high',
        script: `
powercfg.exe /hibernate off
`,
    },
    {
        id: 'clean-temp',
        category: 'Stockage',
        title: 'Nettoyer les fichiers temporaires',
        description: 'Vide les dossiers temporaires utilisateur et Windows accessibles.',
        recommended: true,
        admin: true,
        reboot: false,
        script: `
$paths = @($env:TEMP, "$env:WINDIR\\Temp")
foreach ($item in $paths) {
    if (Test-Path $item) {
        Get-ChildItem -LiteralPath $item -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
}
`,
    },
    {
        id: 'empty-recycle-bin',
        category: 'Stockage',
        title: 'Vider la corbeille',
        description: 'Vide la corbeille de tous les lecteurs.',
        recommended: false,
        admin: false,
        reboot: false,
        script: `
Clear-RecycleBin -Force -ErrorAction SilentlyContinue
`,
    },
    {
        id: 'component-cleanup',
        category: 'Stockage',
        title: 'Nettoyer le component store Windows',
        description: 'Lance DISM StartComponentCleanup pour reduire WinSxS.',
        recommended: false,
        admin: true,
        reboot: false,
        script: `
dism.exe /Online /Cleanup-Image /StartComponentCleanup
`,
    },
    {
        id: 'disable-game-dvr',
        category: 'Gaming',
        title: 'Desactiver Xbox Game DVR',
        description: "Desactive l'enregistrement en arriere-plan et Game DVR.",
        recommended: true,
        admin: false,
        reboot: false,
        script: `
Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_Enabled' -Type DWord -Value 0 -Force
New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Name 'AppCaptureEnabled' -Type DWord -Value 0 -Force
`,
    },
    {
        id: 'enable-game-mode',
        category: 'Gaming',
        title: 'Activer le Mode Jeu',
        description: 'Active Game Mode pour prioriser le jeu quand Windows le detecte.',
        recommended: true,
        admin: false,
        reboot: false,
        script: `
New-Item -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Name 'AllowAutoGameMode' -Type DWord -Value 1 -Force
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Name 'AutoGameModeEnabled' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'flush-dns',
        category: 'Reseau',
        title: 'Vider le cache DNS',
        description: 'Nettoie le cache DNS local.',
        recommended: false,
        admin: false,
        reboot: false,
        script: `
ipconfig.exe /flushdns
`,
    },
    {
        id: 'reset-winsock',
        category: 'Reseau',
        title: 'Reset Winsock',
        description: 'Reinitialise Winsock. Utile apres problemes reseau, redemarrage requis.',
        recommended: false,
        admin: true,
        reboot: true,
        script: `
netsh.exe winsock reset
`,
    },
    {
        id: 'enable-storage-sense',
        category: 'Maintenance',
        title: 'Activer Assistant stockage',
        description: 'Active Storage Sense pour nettoyer automatiquement les fichiers temporaires.',
        recommended: true,
        admin: false,
        reboot: false,
        script: `
New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy' -Name '01' -Type DWord -Value 1 -Force
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy' -Name '04' -Type DWord -Value 1 -Force
`,
    },
    {
        id: 'windows-update-optimized',
        category: 'Maintenance',
        title: 'Optimiser Windows Update',
        description:
            'Active les mises a jour Microsoft Update et limite Delivery Optimization au reseau local.',
        recommended: true,
        admin: true,
        reboot: false,
        risk: 'safe',
        script: `
New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Config' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Config' -Name 'DODownloadMode' -Type DWord -Value 1 -Force
$service = New-Object -ComObject Microsoft.Update.ServiceManager
$service.ClientApplicationID = 'ArtemisStore'
$service.AddService2('7971f918-a847-4430-9279-4a52d1efe18d', 7, '') | Out-Null
`,
    },
    {
        id: 'create-restore-point',
        category: 'Maintenance',
        title: 'Creer un point de restauration',
        description:
            'Cree un point de restauration avant/apres optimisation si la protection systeme est active.',
        recommended: false,
        admin: true,
        reboot: false,
        script: `
Checkpoint-Computer -Description 'ArtemisStore Optimisation' -RestorePointType 'MODIFY_SETTINGS'
`,
    },
];

function getPublicOptimizations() {
    return OPTIMIZATIONS.map(({ script, ...item }) => item);
}

function psSingleQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function buildScript(items) {
    const blocks = items.map(
        (item) => `
$current = ${psSingleQuote(item.title)}
try {
${item.script}
    [PSCustomObject]@{ id = ${psSingleQuote(item.id)}; title = $current; status = 'ok'; output = 'Applique' }
} catch {
    [PSCustomObject]@{ id = ${psSingleQuote(item.id)}; title = $current; status = 'error'; output = ($_ | Out-String).Trim() }
}
`
    );

    return `
$ErrorActionPreference = 'Stop'
$results = @()
${blocks.map((block) => `$results += & { ${block} }`).join('\n')}
$rebootRequired = ${items.some((item) => item.reboot) ? '$true' : '$false'}
[PSCustomObject]@{
    generatedAt = (Get-Date).ToString('s')
    rebootRequired = $rebootRequired
    results = $results
} | ConvertTo-Json -Depth 5 -Compress
`;
}

function runPowerShell(script, elevated = false) {
    if (elevated) return runElevatedPowerShell(script);

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
                resolve(stdout);
            }
        );
    });
}

function runElevatedPowerShell(script) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(app.getPath('temp'), `artemisstore-opti-${Date.now()}.ps1`);
        const resultPath = `${scriptPath}.json`;

        fs.writeFileSync(
            scriptPath,
            `
try {
${script} | Set-Content -Path ${psSingleQuote(resultPath)} -Encoding UTF8
    exit 0
} catch {
    [PSCustomObject]@{
        generatedAt = (Get-Date).ToString('s')
        rebootRequired = $false
        results = @([PSCustomObject]@{ id = 'global'; title = 'Optimisations'; status = 'error'; output = ($_ | Out-String).Trim() })
    } | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path ${psSingleQuote(resultPath)} -Encoding UTF8
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
            { windowsHide: true, maxBuffer: 1024 * 1024 },
            (error) => {
                const result = readTempFile(resultPath);
                removeTempFile(scriptPath);
                removeTempFile(resultPath);

                if (!result) {
                    reject(
                        new Error(
                            "Optimisations annulees ou refusees par Windows. Relance et accepte l'UAC."
                        )
                    );
                    return;
                }

                if (error) {
                    resolve(result);
                    return;
                }

                resolve(result);
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
        logger.warn(`[WinOptimisations] Impossible de supprimer ${filePath} : ${err.message}`);
    }
}

async function applyOptimizations(ids) {
    const selected = OPTIMIZATIONS.filter((item) => ids.includes(item.id));
    if (selected.length === 0) {
        throw new Error('Aucune optimisation selectionnee.');
    }

    const currentUserItems = selected.filter((item) => !item.admin);
    const adminItems = selected.filter((item) => item.admin);
    const allResults = [];
    let rebootRequired = selected.some((item) => item.reboot);

    for (const group of [
        { items: currentUserItems, elevated: false },
        { items: adminItems, elevated: true },
    ]) {
        if (group.items.length === 0) continue;
        const raw = await runPowerShell(buildScript(group.items), group.elevated);
        const parsed = JSON.parse(raw);
        rebootRequired = rebootRequired || Boolean(parsed.rebootRequired);
        const parsedResults = parsed.results
            ? Array.isArray(parsed.results)
                ? parsed.results
                : [parsed.results]
            : [];
        allResults.push(...parsedResults);
    }

    return {
        generatedAt: new Date().toISOString(),
        rebootRequired,
        results: allResults,
    };
}

function setupWinOptimisationsListener() {
    ipcMain.on('get-win-optimizations', (event) => {
        event.sender.send('win-optimizations-data', getPublicOptimizations());
    });

    ipcMain.on('apply-win-optimizations', async (event, ids) => {
        logger.info(`[WinOptimisations] Application de ${ids.length} optimisation(s).`);
        try {
            const result = await applyOptimizations(ids);
            event.sender.send('win-optimizations-result', result);
        } catch (err) {
            logger.error('[WinOptimisations] Echec : ' + err.message);
            event.sender.send('win-optimizations-result', {
                generatedAt: new Date().toISOString(),
                rebootRequired: false,
                results: [
                    {
                        id: 'global',
                        title: 'Optimisations',
                        status: 'error',
                        output: err.message,
                    },
                ],
            });
        }
    });
}

module.exports = {
    setupWinOptimisationsListener,
};
