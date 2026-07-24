const os = require('os');
const { execFile } = require('child_process');
const logger = require('../bin/logger');

const WINDOWS_OFFICE_INFO_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

function Get-ArtemisLicenseState([int]$Status) {
    switch ($Status) {
        0 { 'Unlicensed' }
        1 { 'Licensed' }
        2 { 'InitialGrace' }
        3 { 'AdditionalGrace' }
        4 { 'NonGenuineGrace' }
        5 { 'Notification' }
        6 { 'ExtendedGrace' }
        default { 'Unknown' }
    }
}

function Get-ArtemisLicenseChannel([string]$Description) {
    if (-not $Description) {
        return 'Unknown'
    }
    if ($Description -match '([A-Z0-9_]+) channel') {
        return [string]$Matches[1]
    }
    if ($Description -match 'OEM_DM') {
        return 'OEM_DM'
    }
    if ($Description -match 'RETAIL') {
        return 'RETAIL'
    }
    return 'Unknown'
}

function Get-ArtemisVNextLicenseState($DecodedLicense) {
    try {
        $now = Get-Date
        $notAfterValue = [string]$DecodedLicense.Metadata.NotAfter
        if ($notAfterValue) {
            $notAfter = Get-Date $notAfterValue -ErrorAction Stop
            if ($now -gt $notAfter) {
                return 'RFM'
            }
        }

        $expiresOnValue = [string]$DecodedLicense.ExpiresOn
        if (-not $expiresOnValue) {
            return 'Licensed'
        }
        $expiresOn = Get-Date $expiresOnValue -ErrorAction Stop
        if ($now -lt $expiresOn) {
            return 'Licensed'
        }
        return 'Grace'
    } catch {
        return 'Unknown'
    }
}

$windowsDiagnostics = [System.Collections.Generic.List[string]]::new()
$officeDiagnostics = [System.Collections.Generic.List[string]]::new()
$root = [ordered]@{}

"=== Windows ===" | Out-Null
$currentVersion = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -ErrorAction SilentlyContinue
$operatingSystem = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$windowsAppId = '55c92734-d682-4d71-983e-d6ec3f16059f'
$windowsProducts = @()
try {
    $windowsProducts = @(
        Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='$windowsAppId'" -ErrorAction Stop |
            Where-Object { $_.PartialProductKey }
    )
} catch {
    $windowsDiagnostics.Add('Le service de licence Windows a refuse la premiere lecture.') | Out-Null
}
if ($windowsProducts.Count -eq 0) {
    try {
        $windowsProducts = @(
            Get-CimInstance SoftwareLicensingProduct -ErrorAction Stop |
                Where-Object { $_.PartialProductKey -and $_.Name -like '*Windows*' }
        )
    } catch {
        $windowsDiagnostics.Add('Le service de licence Windows est inaccessible.') | Out-Null
    }
}
$licensedWindowsProducts = @($windowsProducts | Where-Object { [int]$_.LicenseStatus -eq 1 })
$primaryWindowsLicense = $licensedWindowsProducts | Select-Object -First 1
if (-not $primaryWindowsLicense) {
    $primaryWindowsLicense = $windowsProducts |
        Sort-Object LicenseStatus -Descending |
        Select-Object -First 1
}

$windowsLicensed = $licensedWindowsProducts.Count -gt 0
$windowsLicenseStatus = if ($primaryWindowsLicense) {
    Get-ArtemisLicenseState ([int]$primaryWindowsLicense.LicenseStatus)
} else {
    'Unknown'
}
$windowsChannel = if ($primaryWindowsLicense) {
    Get-ArtemisLicenseChannel ([string]$primaryWindowsLicense.Description)
} else {
    'Unknown'
}

if ($windowsProducts.Count -eq 0) {
    $windowsDiagnostics.Add('Aucune entree de licence Windows lisible.') | Out-Null
}

$displayVersion = [string]$currentVersion.DisplayVersion
if (-not $displayVersion) {
    $displayVersion = [string]$currentVersion.ReleaseId
}

$root.windows = [ordered]@{
    osName = if ($operatingSystem.Caption) { [string]$operatingSystem.Caption } else { [string]$currentVersion.ProductName }
    osDisplayVersion = $displayVersion
    windowsEditionId = [string]$currentVersion.EditionID
    osVersion = if ($operatingSystem.Version) { [string]$operatingSystem.Version } else { [string]$currentVersion.CurrentBuild }
    osArchitecture = [string]$operatingSystem.OSArchitecture
    productName = if ($primaryWindowsLicense) { [string]$primaryWindowsLicense.Name } else { $null }
    productKeyChannel = $windowsChannel
    partialProductKey = if ($primaryWindowsLicense) { [string]$primaryWindowsLicense.PartialProductKey } else { $null }
    activationId = if ($primaryWindowsLicense) { [string]$primaryWindowsLicense.ID } else { $null }
    licenseStatus = $windowsLicenseStatus
    licenseStatusCode = if ($primaryWindowsLicense) { [int]$primaryWindowsLicense.LicenseStatus } else { $null }
    isLicensed = $windowsLicensed
}

"=== Office ===" | Out-Null
$programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$officeBasePaths = @(
    (Join-Path $env:ProgramFiles 'Microsoft Office\\root\\Office16'),
    (Join-Path $env:ProgramFiles 'Microsoft Office\\Office16')
)
if ($programFilesX86) {
    $officeBasePaths += (Join-Path $programFilesX86 'Microsoft Office\\root\\Office16')
    $officeBasePaths += (Join-Path $programFilesX86 'Microsoft Office\\Office16')
}
$officeBasePaths = @($officeBasePaths | Select-Object -Unique)

$c2rConfiguration = $null
foreach ($configurationPath in @(
    'HKLM:\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Office\\ClickToRun\\Configuration'
)) {
    $candidate = Get-ItemProperty -Path $configurationPath -ErrorAction SilentlyContinue
    if ($candidate) {
        $c2rConfiguration = $candidate
        break
    }
}

$knownApps = @(
    @{ File = 'WINWORD.EXE'; Name = 'Word' },
    @{ File = 'EXCEL.EXE'; Name = 'Excel' },
    @{ File = 'POWERPNT.EXE'; Name = 'PowerPoint' },
    @{ File = 'OUTLOOK.EXE'; Name = 'Outlook' },
    @{ File = 'ONENOTE.EXE'; Name = 'OneNote' },
    @{ File = 'MSACCESS.EXE'; Name = 'Access' },
    @{ File = 'MSPUB.EXE'; Name = 'Publisher' }
)
$officeApps = [System.Collections.Generic.List[string]]::new()
foreach ($basePath in $officeBasePaths) {
    foreach ($knownApp in $knownApps) {
        if (Test-Path -LiteralPath (Join-Path $basePath $knownApp.File)) {
            if (-not $officeApps.Contains([string]$knownApp.Name)) {
                $officeApps.Add([string]$knownApp.Name)
            }
        }
    }
}

$officeInstalled = [bool]$c2rConfiguration -or $officeApps.Count -gt 0
$officeProductIds = if ($c2rConfiguration.ProductReleaseIds) {
    @([string]$c2rConfiguration.ProductReleaseIds -split ',' | Where-Object { $_ })
} else {
    @()
}
$officeVersion = if ($c2rConfiguration.VersionToReport) {
    [string]$c2rConfiguration.VersionToReport
} elseif ($officeInstalled) {
    'Version 16'
} else {
    $null
}

$officeLicenses = [System.Collections.Generic.List[object]]::new()
$seenOfficeLicenses = @{}
$officeAppId = '0ff1ce15-a989-479d-af46-f275c6370663'
$officeSoftwareLicenses = @()
try {
    $officeSoftwareLicenses = @(
        Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='$officeAppId'" -ErrorAction Stop |
            Where-Object { $_.PartialProductKey }
    )
} catch {
    $officeDiagnostics.Add('Le service de licence Office classique est inaccessible.') | Out-Null
}
if ($officeSoftwareLicenses.Count -eq 0) {
    try {
        $officeSoftwareLicenses = @(
            Get-CimInstance SoftwareLicensingProduct -ErrorAction Stop |
                Where-Object { $_.PartialProductKey -and $_.Name -like '*Office*' }
        )
    } catch {
        # Les licences Microsoft 365 modernes sont lues separement ci-dessous.
    }
}
foreach ($officeLicense in $officeSoftwareLicenses) {
    $licenseId = [string]$officeLicense.ID
    if ($licenseId -and $seenOfficeLicenses.ContainsKey($licenseId)) {
        continue
    }
    if ($licenseId) {
        $seenOfficeLicenses[$licenseId] = $true
    }
    $officeLicenses.Add([PSCustomObject]@{
        Product = [string]$officeLicense.Name
        LicenseType = Get-ArtemisLicenseChannel ([string]$officeLicense.Description)
        LicenseState = Get-ArtemisLicenseState ([int]$officeLicense.LicenseStatus)
        PartialProductKey = [string]$officeLicense.PartialProductKey
        NotAfter = $null
        NextRenewal = $null
        EntitlementStatus = $null
    })
}

$vNextLocations = @(
    @{ Path = (Join-Path $env:LOCALAPPDATA 'Microsoft\\Office\\Licenses'); Type = 'User' },
    @{ Path = (Join-Path $env:PROGRAMDATA 'Microsoft\\Office\\Licenses'); Type = 'Device' }
)
foreach ($location in $vNextLocations) {
    if (-not (Test-Path -LiteralPath $location.Path)) {
        continue
    }

    try {
        $licenseFiles = @(Get-ChildItem -LiteralPath $location.Path -Recurse -File -ErrorAction Stop)
        foreach ($licenseFile in $licenseFiles) {
            try {
                $outerLicense = Get-Content -LiteralPath $licenseFile.FullName -Encoding Unicode -Raw -ErrorAction Stop |
                    ConvertFrom-Json -ErrorAction Stop
                if (-not $outerLicense.License) {
                    continue
                }
                $decodedText = [System.Text.Encoding]::UTF8.GetString(
                    [System.Convert]::FromBase64String([string]$outerLicense.License)
                )
                $decodedLicense = $decodedText | ConvertFrom-Json -ErrorAction Stop
                $licenseId = [string]$decodedLicense.LicenseId
                if ($licenseId -and $seenOfficeLicenses.ContainsKey($licenseId)) {
                    continue
                }
                if ($licenseId) {
                    $seenOfficeLicenses[$licenseId] = $true
                }

                $officeLicenses.Add([PSCustomObject]@{
                    Product = [string]$decodedLicense.ProductReleaseId
                    LicenseType = "$($location.Type)|$([string]$decodedLicense.LicenseType)"
                    LicenseState = Get-ArtemisVNextLicenseState $decodedLicense
                    PartialProductKey = $null
                    NotAfter = [string]$decodedLicense.Metadata.NotAfter
                    NextRenewal = [string]$decodedLicense.Metadata.RenewAfter
                    EntitlementStatus = [string]$decodedLicense.Status
                })
            } catch {
                continue
            }
        }
    } catch {
        $officeDiagnostics.Add("Licences Office $($location.Type) inaccessibles.") | Out-Null
    }
}

$officeActivated = @($officeLicenses | Where-Object { $_.LicenseState -eq 'Licensed' }).Count -gt 0
if ($officeInstalled -and $officeLicenses.Count -eq 0) {
    $officeDiagnostics.Add('Office est installe mais aucune licence lisible n a ete trouvee.') | Out-Null
}

$root.office = [ordered]@{
    officeInstalled = $officeInstalled
    officeVersion = $officeVersion
    officeProductIds = $officeProductIds
    officePlatform = if ($c2rConfiguration.Platform) { [string]$c2rConfiguration.Platform } else { $null }
    officeActivated = $officeActivated
    officeApps = @($officeApps)
    officeLicenses = @($officeLicenses)
}
$root.windowsDiagnostics = @($windowsDiagnostics)
$root.officeDiagnostics = @($officeDiagnostics)
$root | ConvertTo-Json -Depth 7 -Compress
`;

function runPowerShellJson(script) {
    return new Promise((resolve, reject) => {
        execFile(
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
            {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 60_000,
                maxBuffer: 8 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
                if (error) {
                    logger.error(
                        `[GetWinOfficeInfo.js] Lecture PowerShell impossible : ${stderr || error.message}`
                    );
                    reject(error);
                    return;
                }

                const output = String(stdout || '')
                    .replace(/^\uFEFF/, '')
                    .trim();
                try {
                    resolve(JSON.parse(output));
                } catch (parseError) {
                    logger.error(
                        `[GetWinOfficeInfo.js] Reponse Windows invalide : ${parseError.message}`
                    );
                    reject(parseError);
                }
            }
        );
    });
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
}

async function getWinOfficeInfo() {
    try {
        const data = await runPowerShellJson(WINDOWS_OFFICE_INFO_SCRIPT);
        const windows = data.windows || {};
        const office = data.office || {};
        const officeLicenses = asArray(office.officeLicenses);

        const result = {
            dataAvailable: true,
            platform: os.platform(),
            osName: windows.osName || 'Windows',
            osDisplayVersion: windows.osDisplayVersion || 'Inconnue',
            windowsEditionId: windows.windowsEditionId || 'Inconnue',
            osVersion: windows.osVersion || 'Inconnue',
            osArchitecture: windows.osArchitecture || os.arch(),
            osActivationType: windows.productKeyChannel || 'Inconnu',
            osActivationStatus: windows.isLicensed === true,
            osLicenseStatus: windows.licenseStatus || 'Unknown',
            osPartialProductKey: windows.partialProductKey || null,
            osActivationId: windows.activationId || null,
            officeInstalled: office.officeInstalled === true,
            officeVersion: office.officeVersion || null,
            officeProductIds: asArray(office.officeProductIds),
            officePlatform: office.officePlatform || null,
            officeActivated:
                office.officeActivated === true ||
                officeLicenses.some((license) => license.LicenseState === 'Licensed'),
            officeApps: asArray(office.officeApps),
            officeLicenses,
            windowsDiagnostics: asArray(data.windowsDiagnostics),
            officeDiagnostics: asArray(data.officeDiagnostics),
        };

        logger.info('[GetWinOfficeInfo.js] Informations Windows et Office recuperees.');
        return result;
    } catch (error) {
        logger.error(
            `[GetWinOfficeInfo.js] Echec de recuperation Windows et Office : ${error.message}`
        );
        return {
            dataAvailable: false,
            platform: os.platform(),
            osName: 'Windows',
            osDisplayVersion: 'Indisponible',
            windowsEditionId: 'Indisponible',
            osVersion: 'Indisponible',
            osArchitecture: os.arch(),
            osActivationType: 'Indisponible',
            osActivationStatus: false,
            osLicenseStatus: 'Unknown',
            osPartialProductKey: null,
            osActivationId: null,
            officeInstalled: false,
            officeVersion: null,
            officeProductIds: [],
            officePlatform: null,
            officeActivated: false,
            officeApps: [],
            officeLicenses: [],
            windowsDiagnostics: ['La lecture des informations Windows a echoue.'],
            officeDiagnostics: ['La lecture des informations Office a echoue.'],
        };
    }
}

module.exports = getWinOfficeInfo;
module.exports.WINDOWS_OFFICE_INFO_SCRIPT = WINDOWS_OFFICE_INFO_SCRIPT;
